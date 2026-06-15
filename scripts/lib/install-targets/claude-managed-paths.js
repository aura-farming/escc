/*
 * Adapted from Everything Claude Code (ECC) scripts/lib/install-targets/claude-home.js
 * and claude-project.js (MIT, (c) Affaan Mustafa) https://github.com/affaan-m/ECC.
 * Re-namespaced ECC_*->ESCC_*.
 *
 * Shared destination remapping + operation planning for the claude-home and
 * claude-project adapters. In ECC this helper was duplicated verbatim in both
 * adapter files; ESCC extracts it so both adapters are thin configs. Managed
 * ESCC content (rules/, skills/) lands under an `escc` namespace inside the
 * target root; docs/ is preserved verbatim.
 *
 * Foreign-path filtering ALWAYS uses the platform owner literal 'claude' (the
 * owner of '.claude-plugin'), never adapter.target — claude-project's target is
 * 'claude-project', and using it would misclassify '.claude-plugin' as foreign.
 */

'use strict';

const path = require('path');

const {
  createRemappedOperation,
  isForeignPlatformPath,
  normalizeRelativePath,
} = require('./helpers');

const CLAUDE_ESCC_NAMESPACE = 'escc';
const CLAUDE_PLATFORM_OWNER = 'claude';

function getClaudeManagedDestinationPath(adapter, sourceRelativePath, input) {
  const normalizedSourcePath = normalizeRelativePath(sourceRelativePath);
  const targetRoot = adapter.resolveRoot(input);

  if (normalizedSourcePath === 'rules') {
    return path.join(targetRoot, 'rules', CLAUDE_ESCC_NAMESPACE);
  }

  if (normalizedSourcePath.startsWith('rules/')) {
    return path.join(
      targetRoot,
      'rules',
      CLAUDE_ESCC_NAMESPACE,
      normalizedSourcePath.slice('rules/'.length)
    );
  }

  if (normalizedSourcePath === 'skills') {
    return path.join(targetRoot, 'skills', CLAUDE_ESCC_NAMESPACE);
  }

  if (normalizedSourcePath.startsWith('skills/')) {
    return path.join(
      targetRoot,
      'skills',
      CLAUDE_ESCC_NAMESPACE,
      normalizedSourcePath.slice('skills/'.length)
    );
  }

  if (normalizedSourcePath === 'docs' || normalizedSourcePath.startsWith('docs/')) {
    return path.join(targetRoot, normalizedSourcePath);
  }

  return null;
}

function planOperations(input, adapter) {
  const modules = Array.isArray(input.modules)
    ? input.modules
    : (input.module ? [input.module] : []);
  const planningInput = {
    repoRoot: input.repoRoot,
    projectRoot: input.projectRoot,
    homeDir: input.homeDir,
  };

  return modules.flatMap(module => {
    const paths = Array.isArray(module.paths) ? module.paths : [];
    return paths
      .filter(p => !isForeignPlatformPath(p, CLAUDE_PLATFORM_OWNER))
      .map(sourceRelativePath => {
        const managedDestinationPath = getClaudeManagedDestinationPath(
          adapter,
          sourceRelativePath,
          planningInput
        );

        if (managedDestinationPath) {
          return createRemappedOperation(
            adapter,
            module.id,
            sourceRelativePath,
            managedDestinationPath,
            { strategy: 'preserve-relative-path' }
          );
        }

        return adapter.createScaffoldOperation(module.id, sourceRelativePath, planningInput);
      });
  });
}

module.exports = {
  CLAUDE_ESCC_NAMESPACE,
  getClaudeManagedDestinationPath,
  planOperations,
};
