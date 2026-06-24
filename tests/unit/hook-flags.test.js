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

// The fail-closed send-gate must NEVER be silently switched off — that would open
// the gate with no audit trail (a second, undocumented off-switch). ESCC_DISABLED_HOOKS
// and profiles cannot disable it; the only supported relaxation is ESCC_OUTBOUND_GATE=off.

test('hook-flags: a fail-closed hook is NON-disableable via ESCC_DISABLED_HOOKS, but normal hooks still are', () => {
  withEnv({ ESCC_HOOK_PROFILE: undefined, ESCC_DISABLED_HOOKS: 'pre:outbound-send-gate,normal-hook' }, () => {
    assert.equal(isHookEnabled('pre:outbound-send-gate'), true);
    assert.equal(isHookEnabled('PRE:OUTBOUND-SEND-GATE'), true); // case-insensitive
    // A normal hook in the same list IS disabled (contrast).
    assert.equal(isHookEnabled('normal-hook'), false);
  });
});

test('hook-flags: a fail-closed hook stays enabled even under a non-matching profile', () => {
  withEnv({ ESCC_HOOK_PROFILE: 'minimal', ESCC_DISABLED_HOOKS: undefined }, () => {
    // minimal would gate out a [standard,strict]-only hook; the gate ignores it.
    assert.equal(isHookEnabled('pre:outbound-send-gate', { profiles: ['standard', 'strict'] }), true);
    // A normal [standard,strict] hook IS gated out under minimal (contrast).
    assert.equal(isHookEnabled('normal-hook', { profiles: ['standard', 'strict'] }), false);
  });
});
