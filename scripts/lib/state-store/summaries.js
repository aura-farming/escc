'use strict';

/*
 * Read-model summary helpers for the state-store query API: outcome/status
 * classification and the skill-run / install-health / work-item / readiness
 * roll-ups consumed by createQueryApi's status view. Extracted from queries.js
 * so each state-store module stays small and under the 800-line machinery cap.
 */

const SUCCESS_OUTCOMES = new Set(['success', 'succeeded', 'passed']);
const FAILURE_OUTCOMES = new Set(['failure', 'failed', 'error']);
const CLOSED_WORK_ITEM_STATUSES = new Set(['done', 'closed', 'resolved', 'merged', 'cancelled']);
const ATTENTION_WORK_ITEM_STATUSES = new Set(['blocked', 'needs-review', 'failed', 'stalled']);

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

module.exports = {
  SUCCESS_OUTCOMES,
  FAILURE_OUTCOMES,
  CLOSED_WORK_ITEM_STATUSES,
  ATTENTION_WORK_ITEM_STATUSES,
  classifyOutcome,
  classifyWorkItemStatus,
  toPercent,
  summarizeSkillRuns,
  summarizeInstallHealth,
  summarizeWorkItems,
  summarizeReadiness,
};
