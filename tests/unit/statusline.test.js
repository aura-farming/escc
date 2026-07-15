'use strict';

const fs = require('fs');
const path = require('path');

const ajv2020 = require('ajv/dist/2020');
const Ajv = ajv2020.default || ajv2020;

const sl = require('../../scripts/hooks/escc-statusline.js');

const ROOT = path.resolve(__dirname, '..', '..');

function stripAnsi(s) {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

test('buildContextBar uses the documented color thresholds (% used)', () => {
  // remaining is post-buffer; assert color codes by used-bucket.
  // remaining 100 -> used 0 (green 32)
  assert.match(sl.buildContextBar(100), /\x1b\[32m/);
  // pick a remaining that lands in red (>=80% used): remaining ~16.5 -> used ~100
  assert.match(sl.buildContextBar(16.5), /\x1b\[1;31m/);
  assert.equal(sl.buildContextBar(null), '');
  assert.equal(sl.buildContextBar(undefined), '');
});

test('buildContextBar renders a 10-cell bar', () => {
  const bar = stripAnsi(sl.buildContextBar(60)).trim();
  const cells = (bar.match(/[█░]/g) || []).length;
  assert.equal(cells, 10, 'bar should be exactly 10 cells');
});

test('formatDuration formats seconds/minutes/hours', () => {
  const now = Date.now();
  assert.equal(sl.formatDuration(new Date(now - 5000).toISOString()), '5s');
  assert.equal(sl.formatDuration(new Date(now - 12 * 60000).toISOString()), '12m');
  assert.equal(sl.formatDuration(new Date(now - (83 * 60000)).toISOString()), '1h23m');
  assert.equal(sl.formatDuration(''), '?');
});

test('buildPersonaWorkspace combines persona and workspace', () => {
  const prev = process.env.ESCC_PERSONA;
  delete process.env.ESCC_PERSONA;
  try {
    assert.equal(sl.buildPersonaWorkspace({ persona: 'ae', workspace_name: 'example-co' }, '/x/y'), 'ae/example-co');
    assert.equal(sl.buildPersonaWorkspace(null, '/x/myproj'), 'myproj');
    process.env.ESCC_PERSONA = 'sdr';
    assert.equal(sl.buildPersonaWorkspace({ workspace_name: 'sample-co' }, '/x/y'), 'sdr/sample-co');
  } finally {
    if (prev === undefined) delete process.env.ESCC_PERSONA;
    else process.env.ESCC_PERSONA = prev;
  }
});

test('buildMetrics renders $cost Nt Nf and duration', () => {
  const now = Date.now();
  const out = stripAnsi(sl.buildMetrics({
    total_cost_usd: 1.234, tool_count: 47, files_modified_count: 5,
    first_timestamp: new Date(now - 15 * 60000).toISOString(),
  }));
  assert.match(out, /\$1\.23/);
  assert.match(out, /47t/);
  assert.match(out, /5f/);
  assert.match(out, /15m/);
  assert.equal(sl.buildMetrics(null), '');
});

test('composeStatusline joins present segments with a separator', () => {
  const out = stripAnsi(sl.composeStatusline({
    model: 'Opus 4.8', task: 'Drafting', metrics: '$1.23 47t', personaWorkspace: 'ae/example-co', ctx: ' ███ 30%',
  }));
  assert.match(out, /Opus 4\.8/);
  assert.match(out, /Drafting/);
  assert.match(out, /ae\/example-co/);
  assert.match(out, /│/);
});

test('examples/statusline.json registers escc-statusline via ${CLAUDE_PLUGIN_ROOT}', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'examples', 'statusline.json'), 'utf8'));
  assert.equal(cfg.statusLine.type, 'command');
  assert.match(cfg.statusLine.command, /\$\{CLAUDE_PLUGIN_ROOT\}/);
  assert.match(cfg.statusLine.command, /escc-statusline\.js/);
});

test('hud-status-contract schema compiles and accepts a representative bridge', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(ROOT, 'schemas', 'hud-status-contract.schema.json'), 'utf8'));
  const ajv = new Ajv({ strict: false });
  const validate = ajv.compile(schema);
  const ok = validate({
    session_id: 's1', total_cost_usd: 1.23, tool_count: 47, files_modified_count: 5,
    first_timestamp: new Date().toISOString(), context_remaining_pct: 62, persona: 'ae', workspace_name: 'example-co',
  });
  assert.ok(ok, `bridge sample failed: ${JSON.stringify(validate.errors)}`);
});
