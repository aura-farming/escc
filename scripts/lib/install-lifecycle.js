/*
 * Adapted from Everything Claude Code (ECC) scripts/lib/install-lifecycle.js
 * (MIT, (c) Affaan Mustafa) https://github.com/affaan-m/ECC.
 * Re-namespaced ECC_*->ESCC_*.
 *
 * Barrel re-exporting the install-lifecycle public surface so existing callers
 * (require('./install-lifecycle')) are unchanged after the split into
 * -ops, -operations, -discovery, and -mutations modules.
 */

'use strict';

const {
  DEFAULT_REPO_ROOT,
  buildDoctorReport,
  discoverInstalledStates,
  normalizeTargets,
} = require('./install-lifecycle-discovery');
const {
  repairInstalledStates,
  uninstallInstalledStates,
} = require('./install-lifecycle-mutations');

module.exports = {
  DEFAULT_REPO_ROOT,
  buildDoctorReport,
  discoverInstalledStates,
  normalizeTargets,
  repairInstalledStates,
  uninstallInstalledStates,
};
