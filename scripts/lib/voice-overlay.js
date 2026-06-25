/*
 * ESCC per-account voice overlay storage (NEW for ESCC; ADR-0015).
 *
 * Persists the per-account STYLE register produced by scripts/lib/account-register.js
 * as a markdown overlay layered on the rep's base [VOICE PROFILE]. A draft is
 * then: rep base voice × buyer-role register × this-account register × mirrored
 * lexicon — while FACTS stay sourced only from approved product-knowledge.
 *
 * Storage: <ESCC_AGENT_DATA_HOME>/escc/voice/account/<sanitized-id>.md
 *   - mirrors the rep base profile path (.claude/escc/voice/<rep-slug>.md)
 *   - already gitignored (.claude/escc/voice/) — it is mined from real
 *     correspondence and never belongs in the source repo.
 *
 * The rendered overlay carries register stats + the buyer's recurring lexicon
 * ONLY. It never echoes a source sentence, claim, metric, or number — the
 * style/content split (ADR-0013) is enforced at write time, not by a prompt.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const { resolveAgentDataHome } = require('./agent-data-home');
const { atomicWriteFile, getDateString } = require('./utils');
const { sanitizeAccountId } = require('./account-memory');

const VOICE_ACCOUNT_SUBDIR = path.join('escc', 'voice', 'account');

/** Absolute path to the per-account voice overlay directory. */
function resolveVoiceAccountDir(options = {}) {
  return path.join(resolveAgentDataHome(options), VOICE_ACCOUNT_SUBDIR);
}

/** Absolute path to an account's voice overlay file (throws on an unusable id). */
function voiceOverlayFile(account, options = {}) {
  const stem = sanitizeAccountId(account);
  if (!stem) throw new TypeError(`voice-overlay: unusable account id: ${account}`);
  return path.join(resolveVoiceAccountDir(options), `${stem}.md`);
}

/**
 * Render a register into the overlay markdown. STYLE ONLY by construction:
 * register stats + the buyer lexicon, never a source sentence or a claim/number.
 * @param {string} account original (unsanitized) account id, for the header
 * @param {object} register result of account-register.extractRegister
 * @param {{lastUpdated?:string}} [options]
 * @returns {string}
 */
function renderOverlay(account, register, options = {}) {
  const r = register || {};
  const lex = Array.isArray(r.lexicon) ? r.lexicon : [];
  const date = options.lastUpdated || getDateString();
  const pct = Math.round((Number(r.questionRate) || 0) * 100);
  const lines = [
    `# Account voice overlay: ${account}`,
    '',
    '> STYLE OVERLAY ONLY. Captures HOW this account writes so a draft can mirror',
    '> their register and vocabulary, layered on the rep base [VOICE PROFILE]. It',
    '> carries NO claims, metrics, or facts — those come only from approved',
    "> product-knowledge. The lexicon mirrors the buyer's recurring WORDS, never",
    '> their numbers or assertions.',
    '',
    `Account: ${account}`,
    `Confidence: ${r.confidence || 'low'}`,
    `Sample count: ${r.sampleCount || 0}`,
    `Last updated: ${date}`,
    '',
    '## Register',
    `- Formality: ${r.formality || 'neutral'}`,
    `- Avg sentence length: ${r.avgSentenceLength || 0} words`,
    `- Question rate: ${pct}% of sentences`,
    `- Greeting: ${r.greeting || '—'}`,
    `- Sign-off: ${r.signOff || '—'}`,
    '',
    "## Lexicon to mirror (buyer's recurring terms)",
    ...(lex.length ? lex.map(t => `- ${t}`) : ['- (none extracted yet)']),
    '',
  ];
  return lines.join('\n');
}

/**
 * Atomically write/refresh an account's voice overlay.
 * @returns {string} the overlay file path
 */
function writeOverlay(account, register, options = {}) {
  const file = voiceOverlayFile(account, options); // throws on bad id
  atomicWriteFile(file, renderOverlay(account, register, options));
  return file;
}

/** Read an account's overlay markdown; tolerates a missing file (''). */
function readOverlay(account, options = {}) {
  let file;
  try {
    file = voiceOverlayFile(account, options);
  } catch (_err) {
    return '';
  }
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return '';
    throw err;
  }
}

module.exports = {
  VOICE_ACCOUNT_SUBDIR,
  resolveVoiceAccountDir,
  voiceOverlayFile,
  renderOverlay,
  writeOverlay,
  readOverlay,
};
