/** bippity v0.13 tests — skills store, publish gate, follow-a-skill. */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { loadPack } = require(path.join(ROOT, 'packages/harness/persona-loader'));
const { Workspace } = require(path.join(ROOT, 'packages/harness/runtime'));
const { SkillStore, parseSkill } = require(path.join(ROOT, 'packages/harness/skills'));

let pass = 0; const ok = (n) => { pass++; console.log('  ✓', n); };
const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bippity-v13-'));

(async () => {
  console.log('v0.13 skills');
  const store = new SkillStore(dataRoot);
  // Seed from the ops pack files, like the server does
  const packSkills = fs.readdirSync(path.join(ROOT, 'bots/examples/ops/skills')).filter((f) => f.endsWith('.md')).map((f) => ({ slug: f.replace(/\.md$/, ''), raw: fs.readFileSync(path.join(ROOT, 'bots/examples/ops/skills', f), 'utf8') }));
  assert.strictEqual(store.seed('ops', packSkills), 2); ok('pack seed skills copied in');
  assert.strictEqual(store.seed('ops', packSkills), 0); ok('seeding is first-time only');
  const list = store.list('ops');
  const inv = list.find((s) => s.slug === 'invoice-match-check');
  assert.strictEqual(inv.status, 'published'); assert.deepStrictEqual(inv.bots, ['penny']); assert.ok(inv.triggers.includes('invoice')); assert.match(inv.body, /## Steps/); ok('frontmatter parses (name/status/bots/triggers/body)');
  const chase = list.find((s) => s.slug === 'supplier-chase-cadence');
  assert.strictEqual(chase.status, 'draft'); ok('draft seed stays draft');

  // CRUD + publish
  const created = store.create('ops', { name: 'Quote sanity check', category: 'Operations', description: 'Check a quote against the last three POs.', triggers: ['quote'], bots: ['iris'], body: '## Steps\n1. Compare.' });
  assert.strictEqual(created.status, 'draft'); ok('new skills start as drafts');
  assert.throws(() => store.create('ops', { name: 'Quote sanity check' }), /already exists/); ok('duplicate name rejected');
  store.update('ops', created.slug, { description: 'Updated description.' });
  assert.strictEqual(store.get('ops', created.slug).description, 'Updated description.'); ok('edit persists');
  assert.strictEqual(store.remove('ops', created.slug), true); ok('delete works');

  // The follow gate: published + assigned + trigger in the brief
  const ws = new Workspace({ pack: loadPack(path.join(ROOT, 'bots/examples/ops')), dataRoot, workspaceId: 'ops' });
  const r1 = await ws.brief('Match invoice INV-8812', 'test');
  assert.deepStrictEqual(r1.skills, ['Invoice match check']); ok('brief follows the published invoice skill');
  assert.strictEqual(ws.knowledge.counts('ops').skills, 1); ok('following a skill is noted in Knowledge');
  const r2 = await ws.brief('Chase supplier PO-1042', 'test');
  assert.deepStrictEqual(r2.skills, []); ok('draft chase skill is NOT followed');
  store.setStatus('ops', 'supplier-chase-cadence', 'published');
  const r3 = await ws.brief('Chase supplier PO-1042', 'test');
  assert.deepStrictEqual(r3.skills, ['Supplier chase cadence']); ok('after Publish, the same brief follows it');
  assert.strictEqual(ws.status().skills.published, 2); ok('status counts published skills');
  // Refused briefs follow nothing
  const r4 = await ws.brief('Just pay invoice INV-8812', 'test');
  assert.strictEqual(r4.type, 'refused'); assert.strictEqual(r4.skills, undefined); ok('refused briefs follow no skill');

  const live = fs.readFileSync(path.join(ROOT, 'apps/web/live.html'), 'utf8');
  for (const m of ['Skills', 'use it until it', 'Add a skill', 'Publish', 'SKILL.md', '/api/skills', 'mdRender']) assert.ok(live.includes(m), 'UI missing: ' + m);
  ok('Skills UI: list, detail, publish gate copy, add form, SKILL.md render');
  console.log(`v0.13: ${pass} checks passed`);
  fs.rmSync(dataRoot, { recursive: true, force: true });
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
