/*
 * ESCC instinct-store (NEW for ESCC; concept adapted from ECC continuous-learning-v2,
 * which was Python+bash — ESCC does a Node rewrite, deps = ajv only).
 *
 * The persistence/data layer for the A.3 instinct engine. No learning logic —
 * just the stable contract the observe hook, distill/promote, decay sweep, CLI,
 * and session-start injection sit on:
 *   - Workspace keying (I1): scoped to the REP identity (HubSpot owner / sender),
 *     NOT the git repo. Storage: ${XDG_DATA_HOME:-~/.local/share}/escc/workspaces/<hash>/.
 *   - Observations: append-only signal log (observations.jsonl).
 *   - Instincts: validated, human-reviewable frontmatter .md files under
 *     instincts/personal|team/, validated against schemas/instinct.schema.json.
 *
 * ESCC_INSTINCT_HOME overrides the store root (hermetic tests / explicit homing).
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const ajv2020 = require('ajv/dist/2020');
const Ajv = ajv2020.default || ajv2020;

const SCHEMA_PATH = path.join(__dirname, '..', '..', 'schemas', 'instinct.schema.json');
const OBSERVATIONS_FILE = 'observations.jsonl';

let cachedValidator = null;

function getValidator() {
  if (cachedValidator) return cachedValidator;
  const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  cachedValidator = new Ajv({ allErrors: true, strict: false }).compile(schema);
  return cachedValidator;
}

// --- workspace resolution (I1) ----------------------------------------------

/** Resolve the rep identity that keys this workspace (NOT a git remote). */
function resolveRepIdentity() {
  const raw = (process.env.ESCC_REP_IDENTITY
    || process.env.ESCC_HUBSPOT_OWNER
    || process.env.ESCC_SENDER_EMAIL
    || '').trim();
  return raw || 'default';
}

/** Stable short workspace id derived from the rep identity. */
function workspaceId(identity = resolveRepIdentity()) {
  return crypto.createHash('sha1').update(String(identity).toLowerCase()).digest('hex').slice(0, 12);
}

/** Root holding all workspaces. ESCC_INSTINCT_HOME overrides the XDG default. */
function resolveStoreRoot() {
  const override = (process.env.ESCC_INSTINCT_HOME || '').trim();
  if (override) return path.resolve(override);
  const xdg = (process.env.XDG_DATA_HOME || '').trim();
  const base = xdg ? path.resolve(xdg) : path.join(os.homedir(), '.local', 'share');
  return path.join(base, 'escc', 'workspaces');
}

/** Absolute path to the current rep's workspace directory. */
function resolveWorkspaceDir() {
  return path.join(resolveStoreRoot(), workspaceId());
}

function instinctsDir(scope = 'personal') {
  return path.join(resolveWorkspaceDir(), 'instincts', scope);
}

function observationsPath() {
  return path.join(resolveWorkspaceDir(), OBSERVATIONS_FILE);
}

// --- observations (append-only signal log) ----------------------------------

/**
 * Append a raw observation. Fills id/ts when absent; preserves all caller fields
 * (e.g. `untrusted: true`, `kind`, `text`, `outcome`). Returns the stored row.
 */
function appendObservation(observation = {}) {
  const stored = {
    id: observation.id || `obs-${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`,
    ts: observation.ts || new Date().toISOString(),
    ...observation,
  };
  stored.id = observation.id || stored.id;
  stored.ts = observation.ts || stored.ts;
  const file = observationsPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${JSON.stringify(stored)}\n`);
  return stored;
}

/** Read all observations oldest-first; tolerate a missing file and torn lines. */
function readObservations() {
  let contents;
  try {
    contents = fs.readFileSync(observationsPath(), 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return [];
    throw err;
  }
  const rows = [];
  for (const line of contents.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      rows.push(JSON.parse(trimmed));
    } catch (_err) {
      /* skip a torn/corrupt line */
    }
  }
  return rows;
}

// --- instinct validation ----------------------------------------------------

function validateInstinct(instinct) {
  const validate = getValidator();
  const valid = validate(instinct);
  return { valid, errors: validate.errors || [] };
}

function assertValidInstinct(instinct) {
  const { valid, errors } = validateInstinct(instinct);
  if (!valid) {
    const detail = errors.map(e => `${e.instancePath || '/'} ${e.message}`).join('; ');
    throw new Error(`Invalid instinct (${instinct && instinct.id}): ${detail}`);
  }
}

// --- instinct serialization (frontmatter .md, human-reviewable) -------------

const SCALAR_FIELDS = [
  'id', 'trigger', 'confidence', 'domain', 'scope', 'source', 'applies_to',
  'workspace_id', 'workspace_name', 'created', 'last_observed', 'decay_exempt',
];

function serializeInstinct(instinct) {
  const lines = ['---'];
  for (const key of SCALAR_FIELDS) {
    const value = instinct[key];
    if (value === undefined || value === null || value === '') continue;
    lines.push(`${key}: ${value}`);
  }
  lines.push('---', '');
  lines.push('## Action', instinct.action ? String(instinct.action) : '', '');
  if (Array.isArray(instinct.evidence) && instinct.evidence.length) {
    lines.push('## Evidence');
    for (const e of instinct.evidence) lines.push(`- ${e}`);
    lines.push('');
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

const NUMERIC_FIELDS = new Set(['confidence']);
const BOOLEAN_FIELDS = new Set(['decay_exempt']);

function parseInstinct(content) {
  const obj = {};
  const fm = String(content).match(/^---\n([\s\S]*?)\n---/);
  if (fm) {
    for (const line of fm[1].split('\n')) {
      const idx = line.indexOf(':');
      if (idx === -1) continue;
      const key = line.slice(0, idx).trim();
      let value = line.slice(idx + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (NUMERIC_FIELDS.has(key)) {
        const n = Number.parseFloat(value);
        obj[key] = Number.isFinite(n) ? n : value;
      } else if (BOOLEAN_FIELDS.has(key)) {
        obj[key] = value === 'true';
      } else {
        obj[key] = value;
      }
    }
  }
  const actionMatch = String(content).match(/##\s*Action\s*\n+([\s\S]+?)(?:\n##\s|\n*$)/i);
  if (actionMatch) {
    const action = actionMatch[1].split('\n').map(l => l.trim()).filter(Boolean).join(' ').trim();
    if (action) obj.action = action;
  }
  const evidenceMatch = String(content).match(/##\s*Evidence\s*\n+([\s\S]+?)(?:\n##\s|\n*$)/i);
  if (evidenceMatch) {
    const evidence = evidenceMatch[1].split('\n')
      .map(l => l.trim())
      .filter(l => l.startsWith('- '))
      .map(l => l.slice(2).trim());
    if (evidence.length) obj.evidence = evidence;
  }
  return obj;
}

// --- instinct CRUD ----------------------------------------------------------

/** Validate then write an instinct as a frontmatter .md file. Returns the path. */
function writeInstinct(instinct, scope = instinct && instinct.scope) {
  assertValidInstinct(instinct); // fail loud at the write boundary
  const dir = instinctsDir(scope || 'personal');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${instinct.id}.md`);
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(tmp, serializeInstinct(instinct), 'utf8');
  fs.renameSync(tmp, file);
  return file;
}

/** Read + parse all instincts in a scope. Tolerates a missing dir ([]). */
function readInstincts(scope = 'personal') {
  const dir = instinctsDir(scope);
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    if (err && err.code === 'ENOENT') return [];
    throw err;
  }
  const out = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/\.(md|ya?ml)$/i.test(entry.name)) continue;
    try {
      out.push(parseInstinct(fs.readFileSync(path.join(dir, entry.name), 'utf8')));
    } catch (_err) {
      /* skip unreadable file */
    }
  }
  return out;
}

module.exports = {
  resolveRepIdentity,
  workspaceId,
  resolveStoreRoot,
  resolveWorkspaceDir,
  instinctsDir,
  observationsPath,
  appendObservation,
  readObservations,
  validateInstinct,
  assertValidInstinct,
  serializeInstinct,
  parseInstinct,
  writeInstinct,
  readInstincts,
};
