'use strict';

/*
 * Unit tests for scripts/lib/hook-flags.js.
 *
 * isHookEnabled honors ESCC_HOOK_PROFILE and ESCC_DISABLED_HOOKS. Each test
 * mutates process.env locally and restores it in a finally block.
 */

const { isHookEnabled, getHookProfile } = require('../../scripts/lib/hook-flags.js');

function withEnv(overrides, fn) {
  const keys = Object.keys(overrides);
  const saved = {};
  for (const key of keys) {
    saved[key] = Object.prototype.hasOwnProperty.call(process.env, key)
      ? process.env[key]
      : undefined;
    if (overrides[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = overrides[key];
    }
  }
  try {
    return fn();
  } finally {
    for (const key of keys) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
  }
}

test('hook-flags: default profile is standard and standard hooks are enabled', () => {
  withEnv({ ESCC_HOOK_PROFILE: undefined, ESCC_DISABLED_HOOKS: undefined }, () => {
    assert.equal(getHookProfile(), 'standard');
    // Default allowed profiles are [standard, strict]; standard => enabled.
    assert.equal(isHookEnabled('my-hook'), true);
  });
});

test('hook-flags: ESCC_HOOK_PROFILE gates by profile membership', () => {
  withEnv({ ESCC_HOOK_PROFILE: 'minimal', ESCC_DISABLED_HOOKS: undefined }, () => {
    assert.equal(getHookProfile(), 'minimal');
    // minimal not in default [standard, strict] => disabled.
    assert.equal(isHookEnabled('my-hook'), false);
    // but enabled when the hook explicitly allows the minimal profile.
    assert.equal(isHookEnabled('my-hook', { profiles: ['minimal'] }), true);
  });
});

test('hook-flags: an invalid profile falls back to standard', () => {
  withEnv({ ESCC_HOOK_PROFILE: 'bogus', ESCC_DISABLED_HOOKS: undefined }, () => {
    assert.equal(getHookProfile(), 'standard');
    assert.equal(isHookEnabled('my-hook'), true);
  });
});

test('hook-flags: ESCC_DISABLED_HOOKS disables listed hooks (case/space-insensitive)', () => {
  withEnv({ ESCC_HOOK_PROFILE: undefined, ESCC_DISABLED_HOOKS: ' My-Hook , other-hook ' }, () => {
    // Disabled wins regardless of profile.
    assert.equal(isHookEnabled('my-hook'), false);
    assert.equal(isHookEnabled('MY-HOOK'), false);
    assert.equal(isHookEnabled('other-hook'), false);
    // A hook not in the disabled list stays enabled.
    assert.equal(isHookEnabled('kept-hook'), true);
  });
});

test('hook-flags: disabled list overrides an otherwise-allowed profile', () => {
  withEnv({ ESCC_HOOK_PROFILE: 'strict', ESCC_DISABLED_HOOKS: 'gate' }, () => {
    assert.equal(isHookEnabled('gate', { profiles: ['standard', 'strict'] }), false);
    assert.equal(isHookEnabled('open', { profiles: ['standard', 'strict'] }), true);
  });
});
