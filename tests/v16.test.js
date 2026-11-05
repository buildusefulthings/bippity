/** bippity v0.16 tests — Get Started interactive demo surface. */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { loadPack } = require(path.join(ROOT, 'packages/harness/persona-loader'));
const { Workspace } = require(path.join(ROOT, 'packages/harness/runtime'));

let pass = 0; const ok = (n) => { pass++; console.log('  ✓', n); };
console.log('v0.16 get started demo');
const live = fs.readFileSync(path.join(ROOT, 'apps/web/live.html'), 'utf8');
for (const m of ['Get started', 'demoBar', 'Guided demo', 'Configure bippity for you', 'Full school setup', 'Can’t reach the bippity server', 'startDemo', 'demoConfigure', '/api/settings']) assert.ok(live.includes(m), 'console missing: ' + m);
ok('console: Get started button, demo bar, configure CTA, offline-friendly error');

// The demo scripts only use briefs the packs actually handle
const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bippity-v16-'));
(async () => {
  const enr = new Workspace({ pack: loadPack(path.join(ROOT, 'bots/examples/enrollment')), dataRoot, workspaceId: 'enrollment' });
  const script = ['New inquiry from a parent on Facebook', 'The 10am tour was a no-show', 'An application has stalled for 5 days', 'Just pay the deposit for them'];
  const types = [];
  for (const b of script) types.push((await enr.brief(b, 'demo')).type);
  assert.deepStrictEqual(types, ['queued', 'queued', 'queued', 'refused']); ok('enrollment demo script plays: three approvals queued → pay refused');
  const ops = new Workspace({ pack: loadPack(path.join(ROOT, 'bots/examples/ops')), dataRoot, workspaceId: 'ops' });
  assert.strictEqual((await ops.brief('Match invoice INV-8812', 'demo')).type, 'queued');
  assert.strictEqual((await ops.brief('Just pay invoice INV-8812 to keep them happy', 'demo')).type, 'refused'); ok('ops demo script plays: queued match → refused pay');
  console.log(`v0.16: ${pass} checks passed`);
  fs.rmSync(dataRoot, { recursive: true, force: true });
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
