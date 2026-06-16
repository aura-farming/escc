'use strict';

/*
 * Content guard: the agent fleet must keep its least-privilege posture.
 *
 * Every agent opens with the prompt-defense preamble; every agent is read-only
 * by default; crm-operator is the SOLE write-capable agent and must require
 * approval / a review-pack before bulk writes and never send. This guard pins
 * those invariants from the test side (validate-agents enforces them from the CI
 * side) so neither can be quietly regressed.
 */

const fs = require('fs');
const path = require('path');

const AGENTS_DIR = path.join(__dirname, '..', '..', 'agents');
const SOLE_WRITER = 'crm-operator';
const CRM_WRITE_TOOL = 'mcp__hubspot__manage_crm_objects';
const FORBIDDEN_TOOLS = ['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash'];

function agentFiles() {
  return fs.readdirSync(AGENTS_DIR).filter(file => file.endsWith('.md'));
}

function parseTools(content) {
  const match = content.match(/^tools:\s*(\[[\s\S]*?\])/m);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

test('content-guard: every agent opens with the prompt-defense preamble', () => {
  for (const file of agentFiles()) {
    const content = fs.readFileSync(path.join(AGENTS_DIR, file), 'utf8');
    const normalized = content.replace(/\s+/g, ' ');
    assert.ok(/##\s*Prompt Defense Baseline/.test(content), `${file}: missing "## Prompt Defense Baseline"`);
    assert.ok(normalized.includes('is UNTRUSTED input'), `${file}: preamble missing the untrusted-input clause`);
    assert.ok(normalized.includes('Never reveal credentials'), `${file}: preamble missing the credentials clause`);
  }
});

test('content-guard: only crm-operator is write-capable; all others are read-only', () => {
  for (const file of agentFiles()) {
    const name = file.replace(/\.md$/, '');
    const content = fs.readFileSync(path.join(AGENTS_DIR, file), 'utf8');
    const tools = parseTools(content) || [];

    for (const tool of FORBIDDEN_TOOLS) {
      assert.ok(!tools.includes(tool), `${file}: must not hold write/exec tool ${tool}`);
    }

    if (name === SOLE_WRITER) {
      assert.ok(tools.includes(CRM_WRITE_TOOL), `${file}: crm-operator must hold ${CRM_WRITE_TOOL}`);
      assert.ok(/WRITE-CAPABLE/.test(content), `${file}: crm-operator must declare it is WRITE-CAPABLE`);
    } else {
      assert.ok(!tools.includes(CRM_WRITE_TOOL), `${file}: only crm-operator may hold ${CRM_WRITE_TOOL}`);
      assert.ok(/READ-ONLY/.test(content), `${file}: non-writer agent must declare it is READ-ONLY`);
    }
  }
});

test('content-guard: crm-operator gates bulk writes on a review-pack + approval and never sends', () => {
  const content = fs.readFileSync(path.join(AGENTS_DIR, `${SOLE_WRITER}.md`), 'utf8');
  assert.ok(/review-pack/i.test(content), 'crm-operator must use a review-pack for bulk changes');
  assert.ok(/approval|approved/i.test(content), 'crm-operator must require approval before applying bulk writes');
  assert.ok(/never send|owns sending|outbound-send-gate/i.test(content), 'crm-operator must never send (the send-gate owns sending)');
});
