'use strict';

/*
 * Content guard: the candidate/approved firewall is STRUCTURAL (ADR-0012).
 *
 * The wall is physical separation: drafting contexts are pointed only at the
 * approved store and NEVER at the candidate path. These threat-level assertions
 * pin that from the test side:
 *   1. no agent (and no skill) references or is globbed at the candidate store;
 *   2. the location drafters read (the approved seed) holds zero unapproved /
 *      untrusted rows;
 *   3. the candidate example holds ONLY not-approved + untrusted rows;
 *   4. readApproved() defensively refuses to surface a tainted row.
 *
 * A prose-only drafter cannot run code, so its only reachable knowledge is the
 * approved file — enforced by where the files live, not by a prompt instruction.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const AGENTS_DIR = path.join(ROOT, 'agents');
const SKILLS_DIR = path.join(ROOT, 'skills');

// "Pointed at the candidate store" = the path/file markers, not the word
// "candidate" (a skill may DISCUSS candidates in prose without reading them).
const CANDIDATE_MARKERS = [/product[\/\\]candidate/i, /candidates\.jsonl/i];

function listFiles(dir, suffix) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      // skills/<name>/SKILL.md
      for (const inner of fs.readdirSync(path.join(dir, entry.name))) {
        if (inner.endsWith(suffix)) out.push(path.join(dir, entry.name, inner));
      }
    } else if (entry.name.endsWith(suffix)) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

test('firewall: no agent is pointed at the candidate store', () => {
  for (const file of listFiles(AGENTS_DIR, '.md')) {
    const content = fs.readFileSync(file, 'utf8');
    for (const marker of CANDIDATE_MARKERS) {
      assert.ok(!marker.test(content), `${path.basename(file)} must not reference the candidate store (${marker})`);
    }
  }
});

test('firewall: no skill is pointed at the candidate store', () => {
  for (const file of listFiles(SKILLS_DIR, '.md')) {
    const content = fs.readFileSync(file, 'utf8');
    for (const marker of CANDIDATE_MARKERS) {
      assert.ok(!marker.test(content), `${path.relative(SKILLS_DIR, file)} must not reference the candidate store (${marker})`);
    }
  }
});

test('firewall: the approved example seed contains zero unapproved/untrusted rows', () => {
  const seed = JSON.parse(fs.readFileSync(path.join(ROOT, 'examples', 'product-knowledge.example.json'), 'utf8'));
  for (const e of seed) {
    assert.equal(e.approved, true, `${e.id}: the approved store must hold only approved rows`);
    assert.notEqual(e.untrusted, true, `${e.id}: the approved store must never hold an untrusted row`);
  }
});

test('firewall: the candidate example holds ONLY not-approved + untrusted rows', () => {
  const raw = fs.readFileSync(path.join(ROOT, 'examples', 'product-knowledge.candidate.example.jsonl'), 'utf8');
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
  assert.ok(lines.length >= 1);
  for (const line of lines) {
    const e = JSON.parse(line);
    assert.equal(e.approved, false, `${e.id}: a candidate must be approved:false`);
    assert.equal(e.untrusted, true, `${e.id}: a candidate must be untrusted:true`);
  }
});

test('firewall: readApproved refuses to surface a tainted row even if one leaks into the approved file', () => {
  const pk = require('../../scripts/lib/product-knowledge');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'escc-fw-'));
  const prev = process.env.ESCC_AGENT_DATA_HOME;
  process.env.ESCC_AGENT_DATA_HOME = home;
  try {
    const dir = path.join(home, 'escc', 'product');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'product-knowledge.json'), JSON.stringify([
      { id: 'ok', type: 'claim', text: 'x', source_type: 'public', approved: true },
      { id: 'leak', type: 'claim', text: 'x', source_type: 'call', approved: true, untrusted: true },
    ]));
    assert.deepEqual(pk.readApproved().map(r => r.id), ['ok']);
  } finally {
    if (prev === undefined) delete process.env.ESCC_AGENT_DATA_HOME;
    else process.env.ESCC_AGENT_DATA_HOME = prev;
  }
});
