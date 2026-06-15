'use strict';

/*
 * Unit tests for scripts/lib/agent-data-home.js.
 *
 * resolveAgentDataHome honors ESCC_AGENT_DATA_HOME and falls back to ~/.claude.
 * expandHomePath handles ~ expansion and absolute paths.
 */

const os = require('os');
const path = require('path');

const {
  resolveAgentDataHome,
  expandHomePath,
  getDefaultClaudeAgentDataHome,
  AGENT_DATA_HOME_ENV,
  DEFAULT_CLAUDE_DIR_NAME,
} = require('../../scripts/lib/agent-data-home.js');

function withEnv(key, value, fn) {
  const had = Object.prototype.hasOwnProperty.call(process.env, key);
  const saved = process.env[key];
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
  try {
    return fn();
  } finally {
    if (had) {
      process.env[key] = saved;
    } else {
      delete process.env[key];
    }
  }
}

test('agent-data-home: resolveAgentDataHome honors ESCC_AGENT_DATA_HOME', () => {
  const custom = path.join(os.tmpdir(), 'escc-custom-home');
  withEnv(AGENT_DATA_HOME_ENV, custom, () => {
    assert.equal(resolveAgentDataHome(), path.resolve(custom));
  });
});

test('agent-data-home: resolveAgentDataHome falls back to ~/.claude when env unset', () => {
  withEnv(AGENT_DATA_HOME_ENV, undefined, () => {
    const resolved = resolveAgentDataHome();
    assert.equal(resolved, getDefaultClaudeAgentDataHome());
    // The default ends with the .claude directory name.
    assert.equal(path.basename(resolved), DEFAULT_CLAUDE_DIR_NAME);
  });
});

test('agent-data-home: ESCC_AGENT_DATA_HOME supports ~ expansion', () => {
  withEnv(AGENT_DATA_HOME_ENV, '~/escc-data', () => {
    // getHomeDirFromEnv prefers HOME/USERPROFILE; fall back to os.homedir().
    const home = (process.env.HOME && process.env.HOME.trim())
      || (process.env.USERPROFILE && process.env.USERPROFILE.trim())
      || os.homedir();
    assert.equal(resolveAgentDataHome(), path.join(path.resolve(home), 'escc-data'));
  });
});

test('agent-data-home: expandHomePath expands ~ to the home directory', () => {
  const home = (process.env.HOME && process.env.HOME.trim())
    || (process.env.USERPROFILE && process.env.USERPROFILE.trim())
    || os.homedir();

  assert.equal(expandHomePath('~'), path.resolve(home));
  assert.equal(expandHomePath('~/sub/dir'), path.join(path.resolve(home), 'sub', 'dir'));
});

test('agent-data-home: expandHomePath returns absolute paths unchanged (resolved)', () => {
  const abs = path.join(os.tmpdir(), 'escc-abs-path');
  assert.equal(expandHomePath(abs), path.resolve(abs));
  assert.ok(path.isAbsolute(expandHomePath(abs)));
});

test('agent-data-home: expandHomePath returns null for empty/invalid input', () => {
  assert.equal(expandHomePath(''), null);
  assert.equal(expandHomePath('   '), null);
  assert.equal(expandHomePath(null), null);
  assert.equal(expandHomePath(undefined), null);
});

test('agent-data-home: expandHomePath resolves a relative path against a base dir', () => {
  const base = path.join(os.tmpdir(), 'escc-base');
  assert.equal(expandHomePath('child', base), path.resolve(base, 'child'));
});
