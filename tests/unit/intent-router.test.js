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
  assert.equal(routedSkill('prep for my call with Example Co tomorrow'), 'call-prep');
  assert.equal(routedSkill('review this call and give me coaching notes from it'), 'call-review');
  assert.equal(routedSkill('I have a call block this afternoon, need a voicemail script'), 'cold-calling');
  assert.equal(routedSkill('process my call notes from the Example Co discovery'), 'discovery-notes');
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

// --- batch/worklist on-ramp (regression guard for the mass-draft routing gap) --

test('BATCH cluster: mass/bulk/count/list phrasings reach the worklist on-ramp', () => {
  assert.equal(routedSkill('mass draft 38 emails to these prospects'), 'worklist');
  assert.equal(routedSkill('bulk draft cold outreach for my whole list'), 'worklist');
  assert.equal(routedSkill('draft 40 emails for the territory'), 'worklist');
  assert.equal(routedSkill('work through my overdue tasks'), 'worklist');
  assert.equal(routedSkill('reach out to everyone on the list'), 'worklist');
  assert.equal(routedSkill('these 25 contacts need a first touch'), 'worklist');
});

test('BATCH on-ramp is precise: single-message and prospect-list asks are untouched', () => {
  assert.equal(routedSkill('write a cold email to Jane at Example Co'), 'cold-outreach');
  assert.equal(routedSkill('build me a prospect list for mid-market'), 'prospecting-pipeline');
  // bare "batch" of NON-outbound work must NOT hijack to the outbound worklist…
  assert.notEqual(routedSkill('process this batch of call transcripts'), 'worklist');
  assert.notEqual(routedSkill('run a batch update on these deal stages'), 'worklist');
  // …but an outbound batch phrasing with "batch" still routes there.
  assert.equal(routedSkill('batch prospect these 20 accounts'), 'worklist');
});

test('routing-precision fixes (review batch): disambiguated pairs route correctly', () => {
  // demo-prep vs call-prep (call-prep no longer swallows "prep for my demo")
  assert.equal(routedSkill('prep for my demo with Acme tomorrow'), 'demo-prep');
  assert.equal(routedSkill('prep for my call with Acme tomorrow'), 'call-prep');
  // cold-outreach catches the plural "cold emails"
  assert.equal(routedSkill('draft cold emails to these leads'), 'cold-outreach');
  // "approve this discount" is deal-desk (approval), not quote-desk (pricing math)
  assert.equal(routedSkill('can I approve this discount'), 'deal-desk');
  assert.equal(routedSkill('what discount can I give on this quote'), 'quote-desk');
  // natural-language forecast-accuracy no longer falls through to forecast-rollup
  assert.equal(routedSkill('how accurate were our forecasts last quarter'), 'forecast-accuracy');
});

test('INGEST on-ramp beats vocabulary overlap: doc drops reach knowledge-intake, pricing math stays at quote-desk', () => {
  // "pricing" inside an ingest ask used to shadow-route to quote-desk.
  assert.equal(routedSkill('ingest this pricing doc'), 'knowledge-intake');
  // the "here's our <doc>" drop phrasings were dead behind quote-desk/battlecards.
  assert.equal(routedSkill("here's our pricing from marketing"), 'knowledge-intake');
  assert.equal(routedSkill('here is our battlecard for the team'), 'knowledge-intake');
  // …without stealing the genuine pricing-math and competitive asks:
  assert.equal(routedSkill('what should I quote for 200 seats'), 'quote-desk');
  assert.equal(routedSkill('how do we beat Dealify'), 'competitor-battlecards');
  // brand-voice keeps ownership of the writing-style phrasing.
  assert.equal(routedSkill('learn my writing style from these emails'), 'brand-voice');
});

test('ATTACK on-ramp: plan-of-attack / get-into phrasings reach account-attack-plan', () => {
  assert.equal(routedSkill('build me a plan of attack for Globex'), 'account-attack-plan');
  assert.equal(routedSkill('how do I get into Acme Corp'), 'account-attack-plan');
  assert.equal(routedSkill('what is the best way into this account'), 'account-attack-plan');
  assert.equal(routedSkill('game plan for cracking Initech'), 'account-attack-plan');
  // must NOT steal the brief-only or list asks:
  assert.equal(routedSkill('research this account for me'), 'account-research');
  assert.equal(routedSkill('who should I target in mid-market'), 'prospecting-pipeline');
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
  assert.equal(router.run(promptInput('what is the weather like in Springfield today?')), undefined);
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
