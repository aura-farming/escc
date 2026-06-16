'use strict';

/*
 * Progressive-strictness reporter shared by the ESCC CI validators (CLAUDE.md
 * §6: "pre-existing issues warn, new ones error under CI_STRICT. Fix the
 * source — do not weaken a validator to pass").
 *
 * Two finding tiers:
 *   error(file, msg)   — ALWAYS an error: structural defects and the security
 *                        invariants (read-only agents, crm-operator sole writer,
 *                        prompt-defense preamble, personal-path leaks).
 *   finding(file, msg) — a soft/lint finding (curly quotes, tilde paths, a
 *                        missing optional field): WARNS by default so a
 *                        pre-existing cosmetic issue does not block CI, and is
 *                        promoted to an ERROR under strict mode.
 *
 * Strict mode: `--strict` argument or CI_STRICT=1 / CI_STRICT=true.
 */

const STRICT = process.argv.includes('--strict')
  || process.env.CI_STRICT === '1'
  || process.env.CI_STRICT === 'true';

/**
 * Create a reporter for a single validator.
 * @param {string} label short validator label used in the FAIL summary
 */
function createReporter(label) {
  const errors = [];
  const warnings = [];

  return {
    strict: STRICT,

    /** Record an always-fatal error. */
    error(file, msg) {
      errors.push(`${file}: ${msg}`);
    },

    /** Record an unconditional warning (never fails CI on its own). */
    warn(file, msg) {
      warnings.push(`${file}: ${msg}`);
    },

    /** Record a soft finding: warns by default, errors under strict mode. */
    finding(file, msg) {
      (STRICT ? errors : warnings).push(`${file}: ${msg}`);
    },

    get errorCount() {
      return errors.length;
    },

    /**
     * Print collected findings and exit the process: 0 when there are no
     * errors, 1 otherwise.
     * @param {string} summary success line, e.g. "Validated 18 agent files"
     */
    finish(summary) {
      for (const warning of warnings) console.warn(`WARN: ${warning}`);
      for (const error of errors) console.error(`ERROR: ${error}`);

      const warnNote = warnings.length
        ? `, ${warnings.length} warning${warnings.length === 1 ? '' : 's'}`
        : '';

      if (errors.length > 0) {
        console.error(`${label}: FAIL (${errors.length} error${errors.length === 1 ? '' : 's'}${warnNote})`);
        process.exit(1);
      }

      const tail = warnings.length
        ? ` (${warnings.length} warning${warnings.length === 1 ? '' : 's'})`
        : '';
      console.log(`${summary}${tail}`);
      process.exit(0);
    },
  };
}

module.exports = { createReporter, STRICT };
