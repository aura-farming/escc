/*
 * Adapted from Everything Claude Code (ECC) scripts/lib/install-targets/claude-home.js
 * (MIT, (c) Affaan Mustafa) https://github.com/affaan-m/ECC.
 * Re-namespaced ECC_*->ESCC_*.
 *
 * Install-target adapter for the user home Claude Code directory (~/.claude).
 * Thin config: destination remapping + operation planning live in the shared
 * ./claude-managed-paths module, reused by claude-project.
 */

'use strict';

const { createInstallTargetAdapter } = require('./helpers');
const { planOperations } = require('./claude-managed-paths');

module.exports = createInstallTargetAdapter({
  id: 'claude-home',
  target: 'claude',
  kind: 'home',
  rootSegments: ['.claude'],
  installStatePathSegments: ['escc', 'install-state.json'],
  nativeRootRelativePath: '.claude-plugin',
  planOperations,
});
