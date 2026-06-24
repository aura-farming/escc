#!/usr/bin/env node
/*
 * Adapted from Everything Claude Code (ECC) scripts/lib/hook-flags.js
 * (MIT, (c) Affaan Mustafa) https://github.com/affaan-m/ECC.
 * Re-namespaced ECC_*->ESCC_*.
 */
/**
 * Shared hook enable/disable controls.
 *
 * Controls:
 * - ESCC_HOOK_PROFILE=minimal|standard|strict (default: standard)
 * - ESCC_DISABLED_HOOKS=comma,separated,hook,ids
 */

'use strict';

const VALID_PROFILES = new Set(['minimal', 'standard', 'strict']);

// Hooks that must NEVER be silently disabled. CLAUDE.md §4/§5: every hook fails
// open EXCEPT pre:outbound-send-gate, which fails CLOSED ("on any doubt, block").
// A fail-closed hook is therefore non-disableable through the generic controls —
// neither ESCC_DISABLED_HOOKS nor a profile may switch it off, because doing so
// would silently open the gate with no audit trail (a second, undocumented
// off-switch). The ONLY supported way to relax it is the documented, gate-logged
// ESCC_OUTBOUND_GATE=off, which the hook itself honors. The canonical set lives
// here; run-with-flags.js imports it for its crash/cannot-run-to-verdict backstop.
const FAIL_CLOSED_HOOKS = new Set(['pre:outbound-send-gate']);

function normalizeId(value) {
  return String(value || '').trim().toLowerCase();
}

function getHookProfile() {
  const raw = String(process.env.ESCC_HOOK_PROFILE || 'standard').trim().toLowerCase();
  return VALID_PROFILES.has(raw) ? raw : 'standard';
}

function getDisabledHookIds() {
  const raw = String(process.env.ESCC_DISABLED_HOOKS || '');
  if (!raw.trim()) return new Set();

  return new Set(
    raw
      .split(',')
      .map(v => normalizeId(v))
      .filter(Boolean)
  );
}

function parseProfiles(rawProfiles, fallback = ['standard', 'strict']) {
  if (!rawProfiles) return [...fallback];

  if (Array.isArray(rawProfiles)) {
    const parsed = rawProfiles
      .map(v => String(v || '').trim().toLowerCase())
      .filter(v => VALID_PROFILES.has(v));
    return parsed.length > 0 ? parsed : [...fallback];
  }

  const parsed = String(rawProfiles)
    .split(',')
    .map(v => v.trim().toLowerCase())
    .filter(v => VALID_PROFILES.has(v));

  return parsed.length > 0 ? parsed : [...fallback];
}

function isHookEnabled(hookId, options = {}) {
  const id = normalizeId(hookId);
  if (!id) return true;

  // A fail-closed hook is always enabled: it cannot be silently switched off via
  // ESCC_DISABLED_HOOKS or a profile (that would open the gate with no audit
  // trail). Use the documented ESCC_OUTBOUND_GATE=off instead — the hook logs it.
  if (FAIL_CLOSED_HOOKS.has(id)) return true;

  const disabled = getDisabledHookIds();
  if (disabled.has(id)) {
    return false;
  }

  const profile = getHookProfile();
  const allowedProfiles = parseProfiles(options.profiles);
  return allowedProfiles.includes(profile);
}

module.exports = {
  VALID_PROFILES,
  FAIL_CLOSED_HOOKS,
  normalizeId,
  getHookProfile,
  getDisabledHookIds,
  parseProfiles,
  isHookEnabled,
};
