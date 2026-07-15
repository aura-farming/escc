/*
 * ESCC canonical account identity (NEW for ESCC; ADR-0018).
 *
 * THE join key for every per-account store. Before this module, an account's
 * name ("Example Co"), its domain ("company.example"), and its HubSpot company id ("12345")
 * each sanitized to a DIFFERENT filename stem — three disjoint account-memory
 * files, voice overlays, and promise keys that never joined. This module gives
 * every store one canonical key:
 *
 *   tier 1  company_<hubspot-company-id>   — HubSpot is the identity authority
 *   tier 2  domain_<email-domain>          — pre-CRM prospecting fallback
 *   tier 3  deal_<id> / sanitized name     — legacy/lossy tiers an alias fixes
 *
 * Resolution is DETERMINISTIC Node (no MCP): typed inputs canonicalize by
 * grammar; everything else consults the ALIAS INDEX — an append-only JSONL at
 * <data-home>/escc/identity/aliases.jsonl, written by `escc identity link`
 * after a skill/agent resolves the identity via a HubSpot search. Skills link
 * once; every store joins forever after.
 *
 * Backfill: `escc identity backfill` (DRY-RUN by default) merges the account
 * fragments that now resolve to one canonical key — account-memory JSONL+md,
 * voice overlays, and promise rows — after copying every touched file into a
 * timestamped backup dir (reversible by copying back). Idempotent: a second
 * run finds nothing to merge.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { resolveAgentDataHome } = require('./agent-data-home');

const IDENTITY_SUBDIR = path.join('escc', 'identity');
const ALIASES_FILE = 'aliases.jsonl';
const MAX_ID_LENGTH = 80;

// --- stems -------------------------------------------------------------------

/**
 * Map an arbitrary account identifier to a safe filename stem. This is the
 * ORIGINAL account-memory sanitizer, now owned here (account-memory re-exports
 * it) so identity is the leaf module and no require cycle forms.
 */
function sanitizeStem(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const lowered = raw.trim().toLowerCase();
  if (!lowered) return null;
  const safe = lowered
    .replace(/[^a-z0-9._-]+/g, '_')
    .replace(/\.{2,}/g, '_')
    .replace(/^[._-]+/, '')
    .slice(0, MAX_ID_LENGTH);
  return safe || null;
}

/** Strip a leading www. from a domain. */
function stripWww(domain) {
  return String(domain).replace(/^www\./, '');
}

/**
 * Canonicalize a raw identifier by GRAMMAR alone (no alias lookup).
 * Idempotent over its own outputs (company_12345 -> company_12345, etc.).
 * @returns {{key: string|null, tier: 'company'|'domain'|'deal'|'name'|null}}
 */
function canonicalizeInput(raw) {
  if (!raw || typeof raw !== 'string') return { key: null, tier: null };
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return { key: null, tier: null };

  let m = trimmed.match(/^company[:_]\s*(\d+)$/);
  if (m) return { key: `company_${m[1]}`, tier: 'company' };

  // A bare all-digits id is treated as a HubSpot company id (documented in
  // ADR-0018): legacy bare-digit stems merge into company_<id> via backfill.
  if (/^\d{2,}$/.test(trimmed)) return { key: `company_${trimmed}`, tier: 'company' };

  m = trimmed.match(/^[^@\s]+@([a-z0-9.-]+\.[a-z]{2,})$/);
  if (m) return { key: `domain_${sanitizeStem(stripWww(m[1]))}`, tier: 'domain' };

  m = trimmed.match(/^domain[:_]\s*(.+)$/);
  if (m) return { key: `domain_${sanitizeStem(stripWww(m[1]))}`, tier: 'domain' };

  // A bare domain ("company.example", "www.company.example.au"). Legacy stores keyed this as
  // plain "company.example"; canonicalizing to domain_* heals that split via backfill.
  if (/^(www\.)?[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(trimmed)) {
    return { key: `domain_${sanitizeStem(stripWww(trimmed))}`, tier: 'domain' };
  }

  m = trimmed.match(/^deal[:_]\s*(.+)$/);
  if (m) return { key: `deal_${sanitizeStem(m[1])}`, tier: 'deal' };

  const stem = sanitizeStem(trimmed);
  return stem ? { key: stem, tier: 'name' } : { key: null, tier: null };
}

// --- alias index ---------------------------------------------------------------

function resolveIdentityDir(options = {}) {
  return path.join(resolveAgentDataHome(options), IDENTITY_SUBDIR);
}

function aliasesFile(options = {}) {
  return path.join(resolveIdentityDir(options), ALIASES_FILE);
}

// Per-file cache invalidated by mtime, so hot paths (every accountFile call)
// pay one stat, not a full read.
const aliasCache = new Map(); // file -> { mtimeMs, map }

function readAliasMap(options = {}) {
  const file = aliasesFile(options);
  let stat;
  try {
    stat = fs.statSync(file);
  } catch (_err) {
    aliasCache.delete(file);
    return new Map();
  }
  const cached = aliasCache.get(file);
  if (cached && cached.mtimeMs === stat.mtimeMs) return cached.map;

  const map = new Map(); // alias stem -> canonical key (last write wins)
  let contents = '';
  try {
    contents = fs.readFileSync(file, 'utf8');
  } catch (_err) {
    return map;
  }
  for (const line of contents.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      const row = JSON.parse(t);
      if (row && row.alias && row.canonical) map.set(String(row.alias), String(row.canonical));
    } catch (_err) {
      /* skip torn line */
    }
  }
  aliasCache.set(file, { mtimeMs: stat.mtimeMs, map });
  return map;
}

/**
 * Link an alias to a canonical identity. The canonical side is canonicalized
 * by grammar; linking to a lossy name-tier canonical is allowed but reported.
 * @returns {{alias:string, canonical:string, tier:string}}
 */
function linkAlias(aliasRaw, canonicalRaw, options = {}) {
  const alias = sanitizeStem(aliasRaw);
  if (!alias) throw new TypeError(`account-identity: unusable alias: ${aliasRaw}`);
  const canon = canonicalizeInput(canonicalRaw);
  if (!canon.key) throw new TypeError(`account-identity: unusable canonical id: ${canonicalRaw}`);
  if (alias === canon.key) throw new TypeError('account-identity: alias and canonical are the same key');

  const file = aliasesFile(options);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const row = {
    alias,
    canonical: canon.key,
    source: options.source || 'operator',
    ts: options.now || new Date().toISOString(),
  };
  fs.appendFileSync(file, `${JSON.stringify(row)}\n`);
  aliasCache.delete(file); // invalidate; next read re-stats
  return { alias, canonical: canon.key, tier: canon.tier };
}

function listAliases(options = {}) {
  return [...readAliasMap(options).entries()].map(([alias, canonical]) => ({ alias, canonical }));
}

/**
 * Resolve ANY raw account identifier to its canonical key.
 * Order: alias index (on the sanitized input, then on its grammar-canonical
 * form — one hop, no cycles) -> grammar canonicalization.
 * @returns {{key: string|null, tier: string|null, via: string|null}}
 */
function resolveAccountKey(raw, options = {}) {
  const aliases = options.aliases || readAliasMap(options);

  const inputStem = sanitizeStem(raw);
  if (inputStem && aliases.has(inputStem)) {
    return { key: aliases.get(inputStem), tier: 'alias', via: inputStem };
  }

  const canon = canonicalizeInput(raw);
  if (canon.key && aliases.has(canon.key)) {
    // e.g. domain_company.example itself linked forward to company_12345.
    return { key: aliases.get(canon.key), tier: 'alias', via: canon.key };
  }
  return { key: canon.key, tier: canon.tier, via: null };
}

/** Convenience: the canonical stem for a raw id (null when unusable). */
function accountKey(raw, options = {}) {
  return resolveAccountKey(raw, options).key;
}

/**
 * Every stem that refers to the same identity as `raw` — the canonical key
 * plus every alias stem pointing at it (and the raw's own stems). Used by
 * privacy-purge so erasure reaches legacy fragments too.
 * @returns {string[]} unique stems
 */
function equivalentStems(raw, options = {}) {
  const aliases = readAliasMap(options);
  const out = new Set();
  const inputStem = sanitizeStem(raw);
  if (inputStem) out.add(inputStem);
  const canon = canonicalizeInput(raw);
  if (canon.key) out.add(canon.key);
  const resolved = resolveAccountKey(raw, { ...options, aliases });
  if (resolved.key) out.add(resolved.key);
  for (const [alias, canonical] of aliases.entries()) {
    if (out.has(canonical)) out.add(alias);
  }
  return [...out];
}

// --- backfill ------------------------------------------------------------------

function listStems(dir, ext) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (_err) {
    return [];
  }
  return entries
    .filter(e => e.isFile() && e.name.endsWith(ext))
    .map(e => e.name.slice(0, -ext.length));
}

/**
 * Compute the merge plan: every store fragment whose stem RESOLVES to a
 * different canonical key. Pure read — safe to show as a dry run.
 * @returns {{groups: object[], promiseUpdates: object[], empty: boolean}}
 */
function backfillPlan(options = {}) {
  const home = resolveAgentDataHome(options);
  const accountsDir = path.join(home, 'escc', 'accounts');
  const voiceDir = path.join(home, 'escc', 'voice', 'account');
  const aliases = readAliasMap(options);

  const groups = new Map(); // canonical -> { accountStems:[], voiceStems:[] }
  function groupFor(canonical) {
    if (!groups.has(canonical)) groups.set(canonical, { canonical, accountStems: [], voiceStems: [] });
    return groups.get(canonical);
  }

  for (const stem of listStems(accountsDir, '.jsonl')) {
    const key = resolveAccountKey(stem, { ...options, aliases }).key;
    if (key && key !== stem) groupFor(key).accountStems.push(stem);
  }
  for (const stem of listStems(voiceDir, '.md')) {
    const key = resolveAccountKey(stem, { ...options, aliases }).key;
    if (key && key !== stem) groupFor(key).voiceStems.push(stem);
  }

  // Promise rows store the RAW account id; plan an update when it no longer
  // matches its canonical key.
  const promiseUpdates = [];
  try {
    const { createStateStoreSync } = require('./state-store');
    const store = createStateStoreSync(options.storeOptions || {});
    try {
      // Only OPEN promises are re-keyed: they are what session-start hydrates.
      const open = store.listOpenPromises();
      for (const row of open) {
        if (!row.account_id) continue;
        const key = resolveAccountKey(row.account_id, { ...options, aliases }).key;
        if (key && key !== row.account_id) {
          promiseUpdates.push({ id: row.id, from: row.account_id, to: key });
        }
      }
    } finally {
      store.close();
    }
  } catch (_err) {
    /* state store unavailable — plan proceeds without promise updates */
  }

  const groupList = [...groups.values()];
  return { groups: groupList, promiseUpdates, empty: groupList.length === 0 && promiseUpdates.length === 0 };
}

function copyIntoBackup(backupDir, file) {
  if (!fs.existsSync(file)) return;
  fs.mkdirSync(backupDir, { recursive: true });
  fs.copyFileSync(file, path.join(backupDir, path.basename(file)));
}

/**
 * Apply a backfill plan. Every touched file is first copied into a timestamped
 * backup dir (restore = copy the backups back). Merged account events keep
 * their original rows verbatim, followed by an identity_backfill provenance
 * event; the markdown view is re-rendered; merged fragments are removed.
 * @returns {{backupDir, mergedAccounts, mergedVoice, promisesUpdated}}
 */
function backfillApply(plan, options = {}) {
  const home = resolveAgentDataHome(options);
  const accountsDir = path.join(home, 'escc', 'accounts');
  const voiceDir = path.join(home, 'escc', 'voice', 'account');
  const stamp = (options.now || new Date().toISOString()).replace(/[:.]/g, '-');
  const backupDir = path.join(resolveIdentityDir(options), `backfill-${stamp}`);

  // Lazy require avoids a static cycle (account-memory requires this module).
  const accountMemory = require('./account-memory');

  let mergedAccounts = 0;
  let mergedVoice = 0;

  for (const group of plan.groups || []) {
    const canonicalFile = path.join(accountsDir, `${group.canonical}.jsonl`);
    for (const stem of group.accountStems) {
      const src = path.join(accountsDir, `${stem}.jsonl`);
      const srcMd = path.join(accountsDir, `${stem}.md`);
      if (!fs.existsSync(src)) continue;
      copyIntoBackup(backupDir, src);
      copyIntoBackup(backupDir, srcMd);
      if (fs.existsSync(canonicalFile)) copyIntoBackup(backupDir, canonicalFile);

      fs.mkdirSync(accountsDir, { recursive: true });
      fs.appendFileSync(canonicalFile, fs.readFileSync(src, 'utf8'));
      fs.unlinkSync(src);
      if (fs.existsSync(srcMd)) fs.unlinkSync(srcMd);
      mergedAccounts += 1;

      accountMemory.appendEvent(group.canonical, {
        type: 'identity_backfill',
        text: `merged account fragment "${stem}" into ${group.canonical} (backup: ${backupDir})`,
        source: 'identity-backfill',
      }, options);
    }

    const canonicalVoice = path.join(voiceDir, `${group.canonical}.md`);
    for (const stem of group.voiceStems) {
      const src = path.join(voiceDir, `${stem}.md`);
      if (!fs.existsSync(src)) continue;
      copyIntoBackup(backupDir, src);
      if (!fs.existsSync(canonicalVoice)) {
        fs.renameSync(src, canonicalVoice);
      } else {
        // Keep the newer overlay; the other is preserved in the backup.
        copyIntoBackup(backupDir, canonicalVoice);
        const keepSrc = fs.statSync(src).mtimeMs > fs.statSync(canonicalVoice).mtimeMs;
        if (keepSrc) fs.renameSync(src, canonicalVoice);
        else fs.unlinkSync(src);
      }
      mergedVoice += 1;
    }
  }

  let promisesUpdated = 0;
  if ((plan.promiseUpdates || []).length) {
    try {
      const { createStateStoreSync } = require('./state-store');
      const store = createStateStoreSync(options.storeOptions || {});
      try {
        const open = store.listOpenPromises();
        const byId = new Map(open.map(r => [r.id, r]));
        for (const upd of plan.promiseUpdates) {
          const row = byId.get(upd.id);
          if (!row) continue;
          store.upsertPromise({ ...row, account_id: upd.to });
          promisesUpdated += 1;
        }
      } finally {
        store.close();
      }
    } catch (_err) {
      /* promise updates are best-effort; account files already merged + backed up */
    }
  }

  return { backupDir, mergedAccounts, mergedVoice, promisesUpdated };
}

module.exports = {
  IDENTITY_SUBDIR,
  sanitizeStem,
  canonicalizeInput,
  resolveIdentityDir,
  aliasesFile,
  readAliasMap,
  linkAlias,
  listAliases,
  resolveAccountKey,
  accountKey,
  equivalentStems,
  backfillPlan,
  backfillApply,
};
