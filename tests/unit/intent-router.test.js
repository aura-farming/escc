'use strict';

/*
 * Tests for the prompt:intent-router hook (ADR-0016) — the budget-independent
 * skill-routing layer. Exercises the REAL config/skill-keywords.json table so
 * priority-order regressions (compliance first, specific before general) fail
 * here, not in the field.
 */

const router = require('../../scripts/hooks/intent-router');

function promptInput(prompt) {
  return JSON.stringify({
    hook_event_name: 'UserPromptSubmit',
    session_id: 'sess-router-1',
    prompt,
  });
}

/** Run the router and return the skill named in the hint (or null). */
function routedSkill(prompt) {
  const result = router.run(promptInput(prompt));
  if (!result || !result.additionalContext) return null;
  const m = result.additionalContext.match(/escc:([a-z0-9-]+)/);
  return m ? m[1] : null;
}

// --- the config itself -------------------------------------------------------

test('routing table loads, compiles, and every route names a real skill directory', () => {
  const fs = require('fs');
  const path = require('path');
  const routes = router.loadRoutes();
  assert.ok(routes.length >= 40, `expected a broad routing table (got ${routes.length})`);
  const skillsDir = path.join(__dirname, '..', '..', 'skills');
  for (const r of routes) {
    assert.ok(
      fs.existsSync(path.join(skillsDir, r.skill, 'SKILL.md')),
      `route "${r.skill}" must point at an existing skill`
    );
    assert.ok(r.regexes.length > 0, `route "${r.skill}" compiled no patterns`);
  }
});

test('compliance routes first: an opt-out phrase beats every other match', () => {
  assert.equal(routedSkill('they replied saying please remove me from your list'), 'opt-out-handling');
  assert.equal(routedSkill('draft a follow-up — actually they said unsubscribe'), 'opt-out-handling');
});

// --- collision-cluster ownership (the audit's 5 clusters) --------------------

test('FORECAST cluster: accuracy vs rollup vs capacity route distinctly', () => {
  assert.equal(routedSkill('how good is our forecast accuracy, commit vs actual?'), 'forecast-accuracy');
  assert.equal(routedSkill("what's our forecast for the quarter"), 'forecast-rollup');
  assert.equal(routedSkill('do we have enough reps to hit target headcount'), 'capacity-planning');
});

test('FOLLOW-UP cluster: replied vs no-reply vs recap route distinctly', () => {
  assert.equal(routedSkill('the prospect replied to my email, how should I respond'), 'reply-handling');
  assert.equal(routedSkill("they haven't replied in eight days, what next"), 'follow-up-ops');
  assert.equal(routedSkill('send the recap from this morning'), 'meeting-followthrough');
});

test('CALL cluster: prep vs review vs dial vs notes route distinctly', () => {
  assert.equal(routedSkill('prep for my call with Acme tomorrow'), 'call-prep');
  assert.equal(routedSkill('review this call and give me coaching notes from it'), 'call-review');
  assert.equal(routedSkill('I have a call block this afternoon, need a voicemail script'), 'cold-calling');
  assert.equal(routedSkill('process my call notes from the Acme discovery'), 'discovery-notes');
});

test('PIPELINE cluster: hygiene vs prospecting route distinctly', () => {
  assert.equal(routedSkill('run a pipeline hygiene sweep, what deals are stale'), 'pipeline-hygiene');
  assert.equal(routedSkill('build me a prospect list for mid-market'), 'prospecting-pipeline');
});

test('DEAL cluster: review vs inspection vs desk route distinctly', () => {
  assert.equal(routedSkill('review this deal, is it commit-able?'), 'deal-review');
  assert.equal(routedSkill('inspect this deal before my pipeline review'), 'deal-inspection');
  assert.equal(routedSkill('non-standard terms here — who has to sign off on this?'), 'deal-desk');
});

test('specific-before-general: MEDDPICC audit beats single-deal MEDDPICC', () => {
  assert.equal(routedSkill('run a meddpicc audit across the team pipeline'), 'methodology-audit');
  assert.equal(routedSkill('run meddpicc on the Globex deal'), 'deal-review');
});

// --- skip rules ---------------------------------------------------------------

test('skips prompts that are already routed', () => {
  assert.equal(router.run(promptInput('/daily')), undefined, 'slash command is already routed');
  assert.equal(
    router.run(promptInput('use escc:cold-outreach to draft a first touch')),
    undefined,
    'an explicit escc:<skill> mention means the user chose'
  );
  assert.equal(router.run(promptInput('thanks!')), undefined, 'too short to route');
});

test('returns undefined when nothing matches', () => {
  assert.equal(router.run(promptInput('what is the weather like in Brisbane today?')), undefined);
});

test('only ONE hint is injected (first match wins)', () => {
  const result = router.run(promptInput('review this deal and also build me a prospect list'));
  assert.ok(result && result.additionalContext);
  const mentions = result.additionalContext.match(/escc:[a-z0-9-]+/g) || [];
  assert.equal(mentions.length, 1, `expected one skill mention, got: ${mentions.join(', ')}`);
});

test('hint carries the command shim when one exists', () => {
  const result = router.run(promptInput('triage my inbox please, lots of unread'));
  assert.ok(result && /\(\/inbox\)/.test(result.additionalContext), 'hint names /inbox');
});

// --- fail-open ----------------------------------------------------------------

test('fails open on malformed input and never throws', () => {
  assert.equal(router.run('not json at all'), undefined);
  assert.equal(router.run(''), undefined);
  assert.equal(router.run(null), undefined);
});

test('loadRoutes cache is keyed by plugin root (no cross-root bleed)', () => {
  const real = router.loadRoutes(); // default root — populated table
  assert.ok(real.length > 0);
  const missing = router.loadRoutes('/nonexistent-root-xyz');
  assert.deepEqual(missing, [], 'a different root reloads (and fails open to []) instead of returning the cached table');
  assert.ok(router.loadRoutes().length > 0, 'default root loads fresh again');
});
