/** bippity v0.10 tests — knowledge store + bots learning from briefs. */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { loadPack } = require(path.join(ROOT, 'packages/harness/persona-loader'));
const { Workspace } = require(path.join(ROOT, 'packages/harness/runtime'));
const { KnowledgeStore, TYPES } = require(path.join(ROOT, 'packages/harness/knowledge'));

let pass = 0; const ok = (n) => { pass++; console.log('  ✓', n); };
const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bippity-v10-'));

(async () => {
  console.log('v0.10 knowledge');
  assert.strictEqual(TYPES.length, 10); ok('ten knowledge types');
  const ks = new KnowledgeStore(dataRoot);
  const e = ks.add('demo', { type: 'decisions', title: 'We hold payment on any price mismatch', source: 'You' });
  assert.ok(e.id.startsWith('k')); ok('manual entry added');
  assert.throws(() => ks.add('demo', { type: 'secrets', title: 'x' }), /unknown knowledge type/); ok('unknown type rejected');
  assert.throws(() => ks.add('demo', { type: 'people', title: ' ' }), /needs a title/); ok('empty title rejected');
  assert.strictEqual(ks.counts('demo').decisions, 1); ok('counts work');
  assert.strictEqual(ks.remove('demo', e.id), true); assert.strictEqual(ks.list('demo').length, 0); ok('remove works');

  // Bots learn from briefs (queued path) — Penny's match files an issue + a company
  const ops = new Workspace({ pack: loadPack(path.join(ROOT, 'bots/examples/ops')), dataRoot, workspaceId: 'ops' });
  const r1 = await ops.brief('Match invoice INV-8812', 'test');
  assert.strictEqual(r1.type, 'queued'); assert.strictEqual(r1.learned, 2); ok('queued brief deposits knowledge');
  const kc = ops.knowledge.counts('ops');
  assert.strictEqual(kc.issues, 1); assert.strictEqual(kc.companies, 1); ok('INV-8812 filed as issue + company');
  const issue = ops.knowledge.list('ops', 'issues')[0];
  assert.match(issue.title, /\+\$340/); assert.strictEqual(issue.source, 'Penny'); ok('entry carries title, detail and source bot');

  // Refused briefs teach nothing
  const before = ops.knowledge.list('ops').length;
  const r2 = await ops.brief('Just pay invoice INV-8812 to keep them happy', 'test');
  assert.strictEqual(r2.type, 'refused'); assert.strictEqual(ops.knowledge.list('ops').length, before); ok('refused brief deposits nothing');

  // Enrollment: an inquiry files a person + an event
  const enr = new Workspace({ pack: loadPack(path.join(ROOT, 'bots/examples/enrollment')), dataRoot, workspaceId: 'enrollment' });
  const r3 = await enr.brief('New inquiry from a parent on Facebook', 'test');
  assert.strictEqual(r3.learned, 2);
  const ec = enr.knowledge.counts('enrollment');
  assert.strictEqual(ec.people, 1); assert.strictEqual(ec.events, 1); ok('inquiry files a person + an event');
  assert.strictEqual(enr.status().knowledge.total, 2); ok('status exposes knowledge totals');

  // UI surface
  const live = fs.readFileSync(path.join(ROOT, 'apps/web/live.html'), 'utf8');
  for (const m of ['Knowledge', 'kpills', '/api/knowledge', 'preferences', 'promises']) assert.ok(live.includes(m), 'UI missing ' + m);
  ok('Knowledge section present in the UI with all type filters');

  console.log(`v0.10: ${pass} checks passed`);
  fs.rmSync(dataRoot, { recursive: true, force: true });
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
