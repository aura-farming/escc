/*
 * Adapted from Everything Claude Code (ECC) scripts/lib/state-store/queries.js
 * (MIT, (c) Affaan Mustafa) https://github.com/affaan-m/ECC.
 * Re-namespaced ECC_*->ESCC_*.
 *
 * JSONL REWRITE: the helper layer (normalize*Input, map*Row, classifyOutcome,
 * summarize*) is preserved in contract. The SQL-prepared-statement query layer
 * is replaced by in-memory folding over the JSONL store's readTable/appendRecord
 * primitives. Records are stored as native JSON objects (no JSON string columns),
 * so map*Row reads object fields directly and no stringifyJson step is needed.
 * createQueryApi now takes the JSONL `store` instead of a sql.js database, but
 * returns the SAME method surface and values as ECC, plus additive ESCC methods
 * for promises, forecast snapshots, and outcomes.
 */

'use strict';

const { assertValidEntity } = require('./schema');

const ACTIVE_SESSION_STATES = ['active', 'running', 'idle'];
const ACTIVE_SESSION_STATE_SET = new Set(ACTIVE_SESSION_STATES);
const SUCCESS_OUTCOMES = new Set(['success', 'succeeded', 'passed']);
const FAILURE_OUTCOMES = new Set(['failure', 'failed', 'error']);
const CLOSED_WORK_ITEM_STATUSES = new Set(['done', 'closed', 'resolved', 'merged', 'cancelled']);
const ATTENTION_WORK_ITEM_STATUSES = new Set(['blocked', 'needs-review', 'failed', 'stalled']);

const DEFAULT_RECENT_SESSION_LIMIT = 10;
const DEFAULT_WORK_ITEM_LIMIT = 20;
const DEFAULT_ACTIVE_LIMIT = 5;
const DEFAULT_RECENT_SKILL_RUN_LIMIT = 20;
const DEFAULT_PENDING_LIMIT = 5;
const DEFAULT_STATUS_WORK_ITEM_LIMIT = 10;

function normalizeLimit(value, fallback) {
  if (value === undefined || value === null) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid limit: ${value}`);
  }

  return parsed;
}

// -------------------------------------------------------------------------
// Row mappers: read native JSON objects from the JSONL store. JSON-shaped
// fields (snapshot, alternatives, modules, operations, metadata, payload) are
// already objects/arrays — no parse step. Fallbacks match ECC behavior.
// -------------------------------------------------------------------------

function coalesceObject(value, fallback) {
  return value === null || value === undefined ? fallback : value;
}

function mapSessionRow(row) {
  const snapshot = coalesceObject(row.snapshot, {});
  return {
    id: row.id,
    adapterId: row.adapter_id,
    harness: row.harness,
    state: row.state,
    repoRoot: row.repo_root,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    snapshot,
    workerCount: Array.isArray(snapshot && snapshot.workers) ? snapshot.workers.length : 0,
  };
}

function mapSkillRunRow(row) {
  return {
    id: row.id,
    skillId: row.skill_id,
    skillVersion: row.skill_version,
    sessionId: row.session_id,
    taskDescription: row.task_description,
    outcome: row.outcome,
    failureReason: row.failure_reason,
    tokensUsed: row.tokens_used,
    durationMs: row.duration_ms,
    userFeedback: row.user_feedback,
    createdAt: row.created_at,
  };
}

function mapSkillVersionRow(row) {
  return {
    skillId: row.skill_id,
    version: row.version,
    contentHash: row.content_hash,
    amendmentReason: row.amendment_reason,
    promotedAt: row.promoted_at,
    rolledBackAt: row.rolled_back_at,
  };
}

function mapDecisionRow(row) {
  return {
    id: row.id,
    sessionId: row.session_id,
    title: row.title,
    rationale: row.rationale,
    alternatives: coalesceObject(row.alternatives, []),
    supersedes: row.supersedes,
    status: row.status,
    createdAt: row.created_at,
  };
}

function mapInstallStateRow(row) {
  const modules = coalesceObject(row.modules, []);
  const operations = coalesceObject(row.operations, []);
  const status = row.source_version && row.installed_at ? 'healthy' : 'warning';

  return {
    targetId: row.target_id,
    targetRoot: row.target_root,
    profile: row.profile,
    modules,
    operations,
    installedAt: row.installed_at,
    sourceVersion: row.source_version,
    moduleCount: Array.isArray(modules) ? modules.length : 0,
    operationCount: Array.isArray(operations) ? operations.length : 0,
    status,
  };
}

function mapGovernanceEventRow(row) {
  return {
    id: row.id,
    sessionId: row.session_id,
    eventType: row.event_type,
    payload: coalesceObject(row.payload, null),
    resolvedAt: row.resolved_at,
    resolution: row.resolution,
    createdAt: row.created_at,
  };
}

function mapWorkItemRow(row) {
  return {
    id: row.id,
    source: row.source,
    sourceId: row.source_id,
    title: row.title,
    status: row.status,
    priority: row.priority,
    url: row.url,
    owner: row.owner,
    repoRoot: row.repo_root,
    sessionId: row.session_id,
    metadata: coalesceObject(row.metadata, null),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function classifyOutcome(outcome) {
  const normalized = String(outcome || '').toLowerCase();
  if (SUCCESS_OUTCOMES.has(normalized)) {
    return 'success';
  }

  if (FAILURE_OUTCOMES.has(normalized)) {
    return 'failure';
  }

  return 'unknown';
}

function classifyWorkItemStatus(status) {
  const normalized = String(status || '').toLowerCase();
  if (CLOSED_WORK_ITEM_STATUSES.has(normalized)) {
    return 'closed';
  }

  if (ATTENTION_WORK_ITEM_STATUSES.has(normalized)) {
    return 'attention';
  }

  return 'open';
}

function toPercent(numerator, denominator) {
  if (denominator === 0) {
    return null;
  }

  return Number(((numerator / denominator) * 100).toFixed(1));
}

function summarizeSkillRuns(skillRuns) {
  const summary = {
    totalCount: skillRuns.length,
    knownCount: 0,
    successCount: 0,
    failureCount: 0,
    unknownCount: 0,
    successRate: null,
    failureRate: null,
  };

  for (const skillRun of skillRuns) {
    const classification = classifyOutcome(skillRun.outcome);
    if (classification === 'success') {
      summary.successCount += 1;
      summary.knownCount += 1;
    } else if (classification === 'failure') {
      summary.failureCount += 1;
      summary.knownCount += 1;
    } else {
      summary.unknownCount += 1;
    }
  }

  summary.successRate = toPercent(summary.successCount, summary.knownCount);
  summary.failureRate = toPercent(summary.failureCount, summary.knownCount);
  return summary;
}

function summarizeInstallHealth(installations) {
  if (installations.length === 0) {
    return {
      status: 'missing',
      totalCount: 0,
      healthyCount: 0,
      warningCount: 0,
      installations: [],
    };
  }

  const summary = installations.reduce((result, installation) => {
    if (installation.status === 'healthy') {
      result.healthyCount += 1;
    } else {
      result.warningCount += 1;
    }
    return result;
  }, {
    totalCount: installations.length,
    healthyCount: 0,
    warningCount: 0,
  });

  return {
    status: summary.warningCount > 0 ? 'warning' : 'healthy',
    ...summary,
    installations,
  };
}

function summarizeWorkItems(workItems) {
  const summary = {
    totalCount: workItems.length,
    openCount: 0,
    blockedCount: 0,
    closedCount: 0,
    items: workItems,
  };

  for (const workItem of workItems) {
    const classification = classifyWorkItemStatus(workItem.status);
    if (classification === 'closed') {
      summary.closedCount += 1;
    } else if (classification === 'attention') {
      summary.openCount += 1;
      summary.blockedCount += 1;
    } else {
      summary.openCount += 1;
    }
  }

  return summary;
}

function summarizeReadiness({ activeSessionCount, skillRuns, installHealth, pendingGovernanceCount, workItems }) {
  const failedSkillRuns = skillRuns.summary.failureCount;
  const warningInstallations = installHealth.warningCount;
  const pendingGovernanceEvents = pendingGovernanceCount;
  const blockedWorkItems = workItems.blockedCount;
  const attentionCount = failedSkillRuns + warningInstallations + pendingGovernanceEvents + blockedWorkItems;

  return {
    status: attentionCount > 0 ? 'attention' : 'ok',
    attentionCount,
    activeSessions: activeSessionCount,
    failedSkillRuns,
    warningInstallations,
    pendingGovernanceEvents,
    blockedWorkItems,
  };
}

// -------------------------------------------------------------------------
// Input normalizers: produce the validated entity shape that is persisted.
// JSON-shaped fields stay as native objects/arrays in the JSONL store.
// -------------------------------------------------------------------------

function normalizeSessionInput(session) {
  return {
    id: session.id,
    adapterId: session.adapterId,
    harness: session.harness,
    state: session.state,
    repoRoot: session.repoRoot ?? null,
    startedAt: session.startedAt ?? null,
    endedAt: session.endedAt ?? null,
    snapshot: session.snapshot ?? {},
  };
}

function normalizeSkillRunInput(skillRun) {
  return {
    id: skillRun.id,
    skillId: skillRun.skillId,
    skillVersion: skillRun.skillVersion,
    sessionId: skillRun.sessionId,
    taskDescription: skillRun.taskDescription,
    outcome: skillRun.outcome,
    failureReason: skillRun.failureReason ?? null,
    tokensUsed: skillRun.tokensUsed ?? null,
    durationMs: skillRun.durationMs ?? null,
    userFeedback: skillRun.userFeedback ?? null,
    createdAt: skillRun.createdAt || new Date().toISOString(),
  };
}

function normalizeSkillVersionInput(skillVersion) {
  return {
    skillId: skillVersion.skillId,
    version: skillVersion.version,
    contentHash: skillVersion.contentHash,
    amendmentReason: skillVersion.amendmentReason ?? null,
    promotedAt: skillVersion.promotedAt ?? null,
    rolledBackAt: skillVersion.rolledBackAt ?? null,
  };
}

function normalizeDecisionInput(decision) {
  return {
    id: decision.id,
    sessionId: decision.sessionId,
    title: decision.title,
    rationale: decision.rationale,
    alternatives: decision.alternatives === undefined || decision.alternatives === null
      ? []
      : decision.alternatives,
    supersedes: decision.supersedes ?? null,
    status: decision.status,
    createdAt: decision.createdAt || new Date().toISOString(),
  };
}

function normalizeInstallStateInput(installState) {
  return {
    targetId: installState.targetId,
    targetRoot: installState.targetRoot,
    profile: installState.profile ?? null,
    modules: installState.modules === undefined || installState.modules === null
      ? []
      : installState.modules,
    operations: installState.operations === undefined || installState.operations === null
      ? []
      : installState.operations,
    installedAt: installState.installedAt || new Date().toISOString(),
    sourceVersion: installState.sourceVersion ?? null,
  };
}

function normalizeGovernanceEventInput(governanceEvent) {
  return {
    id: governanceEvent.id,
    sessionId: governanceEvent.sessionId ?? null,
    eventType: governanceEvent.eventType,
    payload: governanceEvent.payload ?? null,
    resolvedAt: governanceEvent.resolvedAt ?? null,
    resolution: governanceEvent.resolution ?? null,
    createdAt: governanceEvent.createdAt || new Date().toISOString(),
  };
}

function normalizeWorkItemInput(workItem) {
  const now = new Date().toISOString();
  return {
    id: workItem.id,
    source: workItem.source,
    sourceId: workItem.sourceId ?? null,
    title: workItem.title,
    status: workItem.status,
    priority: workItem.priority ?? null,
    url: workItem.url ?? null,
    owner: workItem.owner ?? null,
    repoRoot: workItem.repoRoot ?? null,
    sessionId: workItem.sessionId ?? null,
    metadata: workItem.metadata ?? null,
    createdAt: workItem.createdAt || now,
    updatedAt: workItem.updatedAt || now,
  };
}

// ESCC-additive normalizers (snake_case entities per schema $defs).

function normalizePromiseInput(promiseInput) {
  const now = new Date().toISOString();
  return {
    id: promiseInput.id,
    account_id: promiseInput.account_id ?? promiseInput.accountId ?? null,
    deal_id: promiseInput.deal_id ?? promiseInput.dealId ?? null,
    text: promiseInput.text,
    due_date: promiseInput.due_date ?? promiseInput.dueDate ?? null,
    status: promiseInput.status || 'open',
    source_session: promiseInput.source_session ?? promiseInput.sourceSession ?? null,
    created_at: promiseInput.created_at || promiseInput.createdAt || now,
    updated_at: promiseInput.updated_at || promiseInput.updatedAt || now,
  };
}

function normalizeForecastSnapshotInput(forecast) {
  return {
    id: forecast.id,
    period: forecast.period,
    captured_at: forecast.captured_at || forecast.capturedAt || new Date().toISOString(),
    commit: forecast.commit ?? null,
    best_case: forecast.best_case ?? forecast.bestCase ?? null,
    pipeline: forecast.pipeline ?? null,
    snapshot: forecast.snapshot ?? null,
    session_id: forecast.session_id ?? forecast.sessionId ?? null,
  };
}

function normalizeOutcomeInput(outcome) {
  return {
    id: outcome.id,
    type: outcome.type,
    fingerprint: outcome.fingerprint ?? null,
    account_id: outcome.account_id ?? outcome.accountId ?? null,
    deal_id: outcome.deal_id ?? outcome.dealId ?? null,
    session_id: outcome.session_id ?? outcome.sessionId ?? null,
    payload: outcome.payload ?? null,
    created_at: outcome.created_at || outcome.createdAt || new Date().toISOString(),
  };
}

// -------------------------------------------------------------------------
// Sort/compare helpers mirroring ECC's SQL ORDER BY clauses.
// -------------------------------------------------------------------------

function descStringCompare(a, b) {
  if (a === b) {
    return 0;
  }
  return a > b ? -1 : 1;
}

// ORDER BY COALESCE(started_at, ended_at, '') DESC, id DESC
function compareSessionsRecent(a, b) {
  const aKey = a.started_at || a.ended_at || '';
  const bKey = b.started_at || b.ended_at || '';
  const primary = descStringCompare(aKey, bKey);
  return primary !== 0 ? primary : descStringCompare(String(a.id), String(b.id));
}

// ORDER BY created_at DESC, id DESC
function compareCreatedAtDesc(a, b) {
  const primary = descStringCompare(a.created_at || '', b.created_at || '');
  return primary !== 0 ? primary : descStringCompare(String(a.id), String(b.id));
}

// ORDER BY updated_at DESC, id DESC
function compareUpdatedAtDesc(a, b) {
  const primary = descStringCompare(a.updated_at || '', b.updated_at || '');
  return primary !== 0 ? primary : descStringCompare(String(a.id), String(b.id));
}

// ORDER BY installed_at DESC, target_id ASC
function compareInstallState(a, b) {
  const primary = descStringCompare(a.installed_at || '', b.installed_at || '');
  if (primary !== 0) {
    return primary;
  }
  const aId = String(a.target_id);
  const bId = String(b.target_id);
  if (aId === bId) {
    return 0;
  }
  return aId < bId ? -1 : 1;
}

function isActiveSession(row) {
  return (row.ended_at === null || row.ended_at === undefined) && ACTIVE_SESSION_STATE_SET.has(row.state);
}

function isPendingGovernance(row) {
  return row.resolved_at === null || row.resolved_at === undefined;
}

function createQueryApi(store) {
  // Raw table readers (already folded last-write-wins by primary key).
  const readSessions = () => store.readTable('sessions');
  const readSkillRuns = () => store.readTable('skill_runs');
  const readSkillVersions = () => store.readTable('skill_versions');
  const readDecisions = () => store.readTable('decisions');
  const readInstallState = () => store.readTable('install_state');
  const readGovernanceEvents = () => store.readTable('governance_events');
  const readWorkItems = () => store.readTable('work_items');
  const readPromises = () => store.readTable('promises');
  const readForecastSnapshots = () => store.readTable('forecast_snapshots');
  const readOutcomes = () => store.readTable('outcomes');

  function getSessionById(id) {
    const row = readSessions().find(session => session.id === id);
    return row ? mapSessionRow(row) : null;
  }

  function getWorkItemById(id) {
    const row = readWorkItems().find(item => item.id === id);
    return row ? mapWorkItemRow(row) : null;
  }

  function getSkillVersionByKey(skillId, version) {
    return readSkillVersions().find(
      row => row.skill_id === skillId && row.version === version
    ) || null;
  }

  function listRecentSessions(options = {}) {
    const limit = normalizeLimit(options.limit, DEFAULT_RECENT_SESSION_LIMIT);
    const rows = readSessions();
    const sorted = rows.slice().sort(compareSessionsRecent);
    return {
      totalCount: rows.length,
      sessions: sorted.slice(0, limit).map(mapSessionRow),
    };
  }

  function getSessionDetail(id) {
    const session = getSessionById(id);
    if (!session) {
      return null;
    }

    const workers = Array.isArray(session.snapshot && session.snapshot.workers)
      ? session.snapshot.workers.map(worker => ({ ...worker }))
      : [];

    const skillRuns = readSkillRuns()
      .filter(row => row.session_id === id)
      .sort(compareCreatedAtDesc)
      .map(mapSkillRunRow);
    const decisions = readDecisions()
      .filter(row => row.session_id === id)
      .sort(compareCreatedAtDesc)
      .map(mapDecisionRow);

    return {
      session,
      workers,
      skillRuns,
      decisions,
    };
  }

  function listWorkItems(options = {}) {
    const limit = normalizeLimit(options.limit, DEFAULT_WORK_ITEM_LIMIT);
    const rows = readWorkItems();
    const sorted = rows.slice().sort(compareUpdatedAtDesc);
    return {
      totalCount: rows.length,
      items: sorted.slice(0, limit).map(mapWorkItemRow),
    };
  }

  function getStatus(options = {}) {
    const activeLimit = normalizeLimit(options.activeLimit, DEFAULT_ACTIVE_LIMIT);
    const recentSkillRunLimit = normalizeLimit(options.recentSkillRunLimit, DEFAULT_RECENT_SKILL_RUN_LIMIT);
    const pendingLimit = normalizeLimit(options.pendingLimit, DEFAULT_PENDING_LIMIT);
    const workItemLimit = normalizeLimit(options.workItemLimit, DEFAULT_STATUS_WORK_ITEM_LIMIT);

    const sessionRows = readSessions();
    const activeRows = sessionRows.filter(isActiveSession).sort(compareSessionsRecent);
    const activeSessions = activeRows.slice(0, activeLimit).map(mapSessionRow);
    const activeSessionCount = activeRows.length;

    const recentSkillRuns = readSkillRuns()
      .slice()
      .sort(compareCreatedAtDesc)
      .slice(0, recentSkillRunLimit)
      .map(mapSkillRunRow);

    const installations = readInstallState()
      .slice()
      .sort(compareInstallState)
      .map(mapInstallStateRow);

    const pendingGovernanceRows = readGovernanceEvents()
      .filter(isPendingGovernance)
      .sort(compareCreatedAtDesc);
    const pendingGovernanceCount = pendingGovernanceRows.length;
    const pendingGovernanceEvents = pendingGovernanceRows
      .slice(0, pendingLimit)
      .map(mapGovernanceEventRow);

    const allWorkItemRows = readWorkItems().slice().sort(compareUpdatedAtDesc);
    const workItems = summarizeWorkItems(allWorkItemRows.map(mapWorkItemRow));
    workItems.items = allWorkItemRows.slice(0, workItemLimit).map(mapWorkItemRow);

    const skillRuns = {
      windowSize: recentSkillRunLimit,
      summary: summarizeSkillRuns(recentSkillRuns),
      recent: recentSkillRuns,
    };
    const installHealth = summarizeInstallHealth(installations);

    return {
      generatedAt: new Date().toISOString(),
      readiness: summarizeReadiness({
        activeSessionCount,
        skillRuns,
        installHealth,
        pendingGovernanceCount,
        workItems,
      }),
      activeSessions: {
        activeCount: activeSessionCount,
        sessions: activeSessions,
      },
      skillRuns,
      installHealth,
      governance: {
        pendingCount: pendingGovernanceCount,
        events: pendingGovernanceEvents,
      },
      workItems,
    };
  }

  return {
    getSessionById,
    getSessionDetail,
    getWorkItemById,
    getStatus,
    insertDecision(decision) {
      const normalized = normalizeDecisionInput(decision);
      assertValidEntity('decision', normalized);
      store.appendRecord('decisions', {
        id: normalized.id,
        session_id: normalized.sessionId,
        title: normalized.title,
        rationale: normalized.rationale,
        alternatives: normalized.alternatives,
        supersedes: normalized.supersedes,
        status: normalized.status,
        created_at: normalized.createdAt,
      });
      return normalized;
    },
    insertGovernanceEvent(governanceEvent) {
      const normalized = normalizeGovernanceEventInput(governanceEvent);
      assertValidEntity('governanceEvent', normalized);
      store.appendRecord('governance_events', {
        id: normalized.id,
        session_id: normalized.sessionId,
        event_type: normalized.eventType,
        payload: normalized.payload,
        resolved_at: normalized.resolvedAt,
        resolution: normalized.resolution,
        created_at: normalized.createdAt,
      });
      return normalized;
    },
    insertSkillRun(skillRun) {
      const normalized = normalizeSkillRunInput(skillRun);
      assertValidEntity('skillRun', normalized);
      store.appendRecord('skill_runs', {
        id: normalized.id,
        skill_id: normalized.skillId,
        skill_version: normalized.skillVersion,
        session_id: normalized.sessionId,
        task_description: normalized.taskDescription,
        outcome: normalized.outcome,
        failure_reason: normalized.failureReason,
        tokens_used: normalized.tokensUsed,
        duration_ms: normalized.durationMs,
        user_feedback: normalized.userFeedback,
        created_at: normalized.createdAt,
      });
      return normalized;
    },
    listRecentSessions,
    listWorkItems,
    upsertInstallState(installState) {
      const normalized = normalizeInstallStateInput(installState);
      assertValidEntity('installState', normalized);
      store.appendRecord('install_state', {
        target_id: normalized.targetId,
        target_root: normalized.targetRoot,
        profile: normalized.profile,
        modules: normalized.modules,
        operations: normalized.operations,
        installed_at: normalized.installedAt,
        source_version: normalized.sourceVersion,
      });
      return normalized;
    },
    upsertWorkItem(workItem) {
      const normalized = normalizeWorkItemInput(workItem);
      assertValidEntity('workItem', normalized);
      store.appendRecord('work_items', {
        id: normalized.id,
        source: normalized.source,
        source_id: normalized.sourceId,
        title: normalized.title,
        status: normalized.status,
        priority: normalized.priority,
        url: normalized.url,
        owner: normalized.owner,
        repo_root: normalized.repoRoot,
        session_id: normalized.sessionId,
        metadata: normalized.metadata,
        created_at: normalized.createdAt,
        updated_at: normalized.updatedAt,
      });
      return getWorkItemById(normalized.id);
    },
    upsertSession(session) {
      const normalized = normalizeSessionInput(session);
      assertValidEntity('session', normalized);
      store.appendRecord('sessions', {
        id: normalized.id,
        adapter_id: normalized.adapterId,
        harness: normalized.harness,
        state: normalized.state,
        repo_root: normalized.repoRoot,
        started_at: normalized.startedAt,
        ended_at: normalized.endedAt,
        snapshot: normalized.snapshot,
      });
      return getSessionById(normalized.id);
    },
    upsertSkillVersion(skillVersion) {
      const normalized = normalizeSkillVersionInput(skillVersion);
      assertValidEntity('skillVersion', normalized);
      store.appendRecord('skill_versions', {
        skill_id: normalized.skillId,
        version: normalized.version,
        content_hash: normalized.contentHash,
        amendment_reason: normalized.amendmentReason,
        promoted_at: normalized.promotedAt,
        rolled_back_at: normalized.rolledBackAt,
      });
      const row = getSkillVersionByKey(normalized.skillId, normalized.version);
      return row ? mapSkillVersionRow(row) : null;
    },

    // --------------------------------------------------------------------
    // ESCC-additive: promises, forecast snapshots, outcomes.
    // Stored as native snake_case objects; returned objects match storage.
    // --------------------------------------------------------------------
    upsertPromise(promiseInput) {
      const normalized = normalizePromiseInput(promiseInput);
      assertValidEntity('promise', normalized);
      store.appendRecord('promises', normalized);
      return readPromises().find(row => row.id === normalized.id) || normalized;
    },
    listOpenPromises(options = {}) {
      const accountId = options.accountId ?? options.account_id ?? null;
      return readPromises()
        .filter(row => row.status === 'open')
        .filter(row => (accountId == null ? true : row.account_id === accountId))
        .sort(compareCreatedAtDesc);
    },
    getPromisesByAccount(accountId) {
      return readPromises()
        .filter(row => row.account_id === accountId)
        .sort(compareCreatedAtDesc);
    },
    insertForecastSnapshot(forecast) {
      const normalized = normalizeForecastSnapshotInput(forecast);
      assertValidEntity('forecastSnapshot', normalized);
      store.appendRecord('forecast_snapshots', normalized);
      return normalized;
    },
    listForecastSnapshots(options = {}) {
      const period = options.period ?? null;
      return readForecastSnapshots()
        .filter(row => (period == null ? true : row.period === period))
        .slice()
        .sort((a, b) => descStringCompare(a.captured_at || '', b.captured_at || ''));
    },
    insertOutcome(outcome) {
      const normalized = normalizeOutcomeInput(outcome);
      assertValidEntity('outcome', normalized);
      store.appendRecord('outcomes', normalized);
      return normalized;
    },
    listOutcomes(options = {}) {
      const type = options.type ?? null;
      const accountId = options.accountId ?? options.account_id ?? null;
      return readOutcomes()
        .filter(row => (type == null ? true : row.type === type))
        .filter(row => (accountId == null ? true : row.account_id === accountId))
        .slice()
        .sort(compareCreatedAtDesc);
    },
  };
}

module.exports = {
  ACTIVE_SESSION_STATES,
  FAILURE_OUTCOMES,
  SUCCESS_OUTCOMES,
  createQueryApi,
};
