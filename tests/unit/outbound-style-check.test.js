'use strict';

const hook = require('../../scripts/hooks/outbound-style-check');

function writeInput(filePath, content) {
  return JSON.stringify({
    hook_event_name: 'PostToolUse',
    tool_name: 'Write',
    tool_input: { file_path: filePath, content: content || '' },
  });
}

function editInput(filePath, newString) {
  return JSON.stringify({
    hook_event_name: 'PostToolUse',
    tool_name: 'Edit',
    tool_input: { file_path: filePath, new_string: newString || '' },
  });
}

// ---- path gating -----------------------------------------------------------

test('isOutboundContent flags outbound/sequence/email/template paths', () => {
  assert.ok(hook.isOutboundContent('deliverables/outbound/sequences/step-1.md'));
  assert.ok(hook.isOutboundContent('campaigns/sequences/day-1.txt'));
  assert.ok(hook.isOutboundContent('/abs/emails/intro.html'));
  assert.ok(hook.isOutboundContent('templates/cold-open.md'));
  assert.ok(hook.isOutboundContent('deliverables/outbound-q3/step.md'));
});

test('isOutboundContent ignores non-outbound and non-doc paths', () => {
  assert.ok(!hook.isOutboundContent('skills/cold-calling/SKILL.md'));
  assert.ok(!hook.isOutboundContent('src/components/Hero.tsx'));
  assert.ok(!hook.isOutboundContent('outbound/logo.png'));
  assert.ok(!hook.isOutboundContent(''));
});

test('run returns undefined for files outside outbound content', () => {
  const result = hook.run(writeInput('docs/guide.md', 'Subject: act now free guarantee {{}}'));
  assert.equal(result, undefined);
});

test('run returns undefined when outbound copy is clean', () => {
  const clean = 'Subject: Quick question about your hiring\n\nHi {{firstName}}, noticed you are growing. Reply STOP to unsubscribe.';
  const result = hook.run(writeInput('deliverables/outbound/sequences/step-1.md', clean));
  assert.equal(result, undefined);
});

// ---- subject length --------------------------------------------------------

test('extractSubject reads Subject: header and subject JSON field', () => {
  assert.equal(hook.extractSubject('Subject: Hello there\n\nbody'), 'Hello there');
  assert.equal(hook.extractSubject('{ "subject": "Hi there" }'), 'Hi there');
  assert.equal(hook.extractSubject('no subject here'), '');
});

test('run warns on an over-long subject line', () => {
  const longSubject = 'Subject: ' + 'x'.repeat(70) + '\n\nbody here. unsubscribe.';
  const result = hook.run(writeInput('emails/intro.md', longSubject));
  assert.ok(result && typeof result.additionalContext === 'string');
  assert.match(result.additionalContext, /subject line is 70 chars/i);
});

test('run does not warn on a subject within the length limit', () => {
  const ok = 'Subject: ' + 'x'.repeat(40) + '\n\nbody. unsubscribe.';
  const result = hook.run(writeInput('emails/intro.md', ok));
  assert.equal(result, undefined);
});

// ---- spam words ------------------------------------------------------------

test('findSpamWords detects curated trigger words as whole words/phrases', () => {
  const found = hook.findSpamWords('This is a FREE, risk-free, act now offer with $$$');
  assert.ok(found.includes('free'));
  assert.ok(found.includes('risk-free'));
  assert.ok(found.includes('act now'));
  assert.ok(found.includes('$$$'));
});

test('findSpamWords does not match spam words embedded in larger words', () => {
  // "freedom" should not trip "free"; "freelance" should not either.
  const found = hook.findSpamWords('We value freedom and freelance work.');
  assert.ok(!found.includes('free'));
});

test('run warns when spam-trigger words are present', () => {
  const result = hook.run(writeInput('templates/promo.md', 'Act now for a free trial. unsubscribe link below.'));
  assert.ok(result && typeof result.additionalContext === 'string');
  assert.match(result.additionalContext, /spam-trigger words/i);
});

// ---- unsubscribe (sequence only) -------------------------------------------

test('run warns when a sequence file lacks an unsubscribe block', () => {
  const result = hook.run(writeInput('deliverables/outbound/sequences/step-1.md', 'Hi {{firstName}}, quick note.'));
  assert.ok(result && typeof result.additionalContext === 'string');
  assert.match(result.additionalContext, /unsubscribe/i);
});

test('run does not raise the unsubscribe finding for a non-sequence template', () => {
  // templates/ is outbound content but not a sequence path → no unsubscribe nag.
  const result = hook.run(writeInput('templates/snippet.md', 'Hi {{firstName}}, quick note.'));
  assert.equal(result, undefined);
});

// ---- broken merge fields ---------------------------------------------------

test('findBrokenMergeFields catches empty, undefined, and unbalanced fields', () => {
  assert.ok(hook.findBrokenMergeFields('Hi {{}}').some((s) => /empty/i.test(s)));
  assert.ok(hook.findBrokenMergeFields('Hi {{ }}').some((s) => /empty/i.test(s)));
  assert.ok(hook.findBrokenMergeFields('Hi {{undefined}}').some((s) => /undefined/i.test(s)));
  assert.ok(hook.findBrokenMergeFields('Hi {{ firstName }').some((s) => /unbalanced/i.test(s)));
});

test('findBrokenMergeFields accepts well-formed merge fields', () => {
  assert.equal(hook.findBrokenMergeFields('Hi {{firstName}}, from {{company}}.').length, 0);
});

test('run warns on broken merge fields in outbound copy', () => {
  const result = hook.run(editInput('emails/intro.md', 'Hi {{ }}, welcome. unsubscribe.'));
  assert.ok(result && typeof result.additionalContext === 'string');
  assert.match(result.additionalContext, /merge field/i);
});

// ---- aggregation, strictness, fail-open ------------------------------------

test('run collects multiple findings into one additionalContext message', () => {
  const bad = 'Subject: ' + 'y'.repeat(70) + '\n\nAct now for a free deal {{}}';
  const result = hook.run(writeInput('deliverables/outbound/sequences/step-1.md', bad));
  assert.ok(result && typeof result.additionalContext === 'string');
  assert.match(result.additionalContext, /subject line is 70 chars/i);
  assert.match(result.additionalContext, /spam-trigger words/i);
  assert.match(result.additionalContext, /unsubscribe/i);
  assert.match(result.additionalContext, /merge field/i);
});

test('strict mode firms the wording but still only warns', () => {
  const prev = process.env.ESCC_QUALITY_GATE_STRICT;
  process.env.ESCC_QUALITY_GATE_STRICT = 'true';
  try {
    const result = hook.run(writeInput('templates/promo.md', 'Act now! free offer.'));
    assert.ok(result && typeof result.additionalContext === 'string');
    assert.match(result.additionalContext, /STRICT/);
    assert.ok(result.exitCode === undefined || result.exitCode === 0, 'never blocks');
  } finally {
    if (prev === undefined) delete process.env.ESCC_QUALITY_GATE_STRICT;
    else process.env.ESCC_QUALITY_GATE_STRICT = prev;
  }
});

test('run fails open (no throw) on malformed input', () => {
  assert.doesNotThrow(() => hook.run('not json at all'));
  assert.doesNotThrow(() => hook.run(undefined));
  assert.doesNotThrow(() => hook.run('{ "tool_input": null }'));
});
