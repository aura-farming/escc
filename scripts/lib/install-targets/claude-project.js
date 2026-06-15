/*
 * Adapted from Everything Claude Code (ECC) scripts/lib/install-targets/claude-project.js
 * (MIT, (c) Affaan Mustafa) https://github.com/affaan-m/ECC.
 * Re-namespaced ECC_*->ESCC_*.
 *
 * Install-target adapter for a per-project Claude Code directory
 * (<projectRoot>/.claude). Thin config reusing the SAME shared planOperations
 * as claude-home; foreign-path filtering inside that helper always tests
 * against the platform owner 'claude' (not this adapter's 'claude-project'
 * target) so '.claude-plugin' is correctly treated as native.
 */

'use strict';

const { createInstallTargetAdapter } = require('./helpers');
const { planOperations } = require('./claude-managed-paths');

module.exports = createInstallTargetAdapter({
  id: 'claude-project',
  target: 'claude-project',
  kind: 'project',
  rootSegments: ['.claude'],
  installStatePathSegments: ['escc', 'install-state.json'],
  nativeRootRelativePath: '.claude-plugin',
  planOperations,
});
