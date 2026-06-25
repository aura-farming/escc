'use strict';

/*
 * Content guard: the /ingest knowledge-intake skill (v1.4.0, ADR-0014) must
 * preserve the load-bearing invariants by construction, in its TEXT:
 *
 *   1. untrusted / third-party content is read only by a read-only quarantine
 *      subagent (transcript-analyzer / competitor-analyst) — never the
 *      privileged orchestrator;
 *   2. the candidate/approved firewall (ADR-0012) is intact — every product
 *      CLAIM enters as a candidate (approved:false) and is promoted only by a
 *      human via `escc product approve`; only STYLE + account CONTEXT auto-apply;
 *   3. it ingests transcript-derived candidates via `escc product mine --input`
 *      and explicitly refuses `--from-transcript` (which bypasses the quarantine
 *      hook by reading raw bytes in the CLI);
 *   4. it is never pointed at the candidate store path (the structural firewall);
 *   5. it actually ships: a thin command delegates to it and a manifest module
 *      installs it.
 *
 * These grep an authored skill's invariants — the same shape as
 * content-guard-knowledge-firewall.test.js. They are intentionally about the
 * skill's TEXT (its instructions), not runtime behavior.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const SKILL = path.join(ROOT, 'skills', 'knowledge-intake', 'SKILL.md');
const COMMAND = path.join(ROOT, 'commands', 'ingest.md');
const MODULES = path.join(ROOT, 'manifests', 'install-modules.json');

// Same path/file markers the firewall test forbids in every skill/agent.
const CANDIDATE_STORE_MARKERS = [/product[\/\\]candidate/i, /candidates\.jsonl/i];

function skillText() {
  return fs.readFileSync(SKILL, 'utf8');
}

test('knowledge-intake: skill file exists and is non-empty', () => {
  assert.ok(fs.existsSync(SKILL), 'skills/knowledge-intake/SKILL.md must exist');
  assert.ok(skillText().trim().length > 0, 'SKILL.md must be non-empty');
});

test('knowledge-intake: untrusted content is quarantined to a read-only subagent', () => {
  const s = skillText();
  assert.ok(/transcript-analyzer/.test(s), 'must route call transcripts to transcript-analyzer');
  assert.ok(/quarantine/i.test(s), 'must invoke the quarantine discipline for untrusted content');
  assert.ok(
    /read[\s-]only subagent/i.test(s),
    'must state the privileged orchestrator works from a read-only subagent summary'
  );
});

test('knowledge-intake: claims enter as candidates, promoted only by a human', () => {
  const s = skillText();
  assert.ok(/candidate/i.test(s), 'must describe claims entering as candidates');
  assert.ok(/approved:false/.test(s), 'must state candidates are approved:false');
  assert.ok(
    /escc product approve/.test(s),
    'must point promotion at the human gate `escc product approve`'
  );
  // Only STYLE + account CONTEXT auto-apply — the two legs must be named.
  assert.ok(/brand-voice/.test(s), 'style leg (brand-voice) must be named as the auto-apply path');
  assert.ok(/discovery-notes/.test(s), 'account-context leg (discovery-notes) must be named');
});

test('knowledge-intake: ingests via `mine --input`, never `--from-transcript`', () => {
  const s = skillText();
  assert.ok(/mine --input/.test(s), 'must document the safe `escc product mine --input` ingest path');
  // Every mention of the quarantine-bypassing flag must warn it bypasses quarantine.
  const flag = '--from-transcript';
  const idxs = [];
  for (let i = s.indexOf(flag); i !== -1; i = s.indexOf(flag, i + 1)) idxs.push(i);
  assert.ok(idxs.length >= 1, 'must mention --from-transcript in order to warn against it');
  for (const idx of idxs) {
    assert.ok(
      /bypass/i.test(s.slice(idx, idx + 180)),
      `each --from-transcript mention must warn it bypasses the quarantine hook (near index ${idx})`
    );
  }
});

test('knowledge-intake: never pointed at the candidate store path (structural firewall)', () => {
  const s = skillText();
  for (const marker of CANDIDATE_STORE_MARKERS) {
    assert.ok(!marker.test(s), `knowledge-intake must not reference the candidate store path (${marker})`);
  }
});

test('knowledge-intake: outbound is untouched (send-gate still owns sending)', () => {
  assert.ok(/send-gate/.test(skillText()), 'must state the send-gate still owns outbound');
});

test('knowledge-intake: a thin command delegates to it and a manifest module ships it', () => {
  const cmd = fs.readFileSync(COMMAND, 'utf8');
  assert.ok(
    /Apply the `knowledge-intake` skill/.test(cmd),
    'commands/ingest.md must delegate to the knowledge-intake skill'
  );
  const modules = fs.readFileSync(MODULES, 'utf8');
  assert.ok(
    modules.includes('skills/knowledge-intake'),
    'install-modules.json must install skills/knowledge-intake (else /ingest never ships)'
  );
});
