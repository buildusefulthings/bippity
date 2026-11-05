/** bippity v0.19 tests — the pre-populated toy school. */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { loadPack } = require(path.join(ROOT, 'packages/harness/persona-loader'));
const { Workspace } = require(path.join(ROOT, 'packages/harness/runtime'));
const toy = require(path.join(ROOT, 'packages/harness/toy-school'));

let pass = 0; const ok = (n) => { pass++; console.log('  ✓', n); };
console.log('v0.19 toy school');
const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bippity-v19-'));
const ws = new Workspace({ pack: loadPack(path.join(ROOT, 'bots/examples/enrollment')), dataRoot, workspaceId: 'enrollment' });

(async () => {
  assert.strictEqual(toy.isSeeded(ws), false); ok('starts empty, as always');
  const r = await toy.seedToySchool(ws);
  assert.strictEqual(r.seeded, true); assert.strictEqual(r.school, 'Willow Creek Microschool'); ok('one call loads Willow Creek');
  assert.ok(r.knowledge >= 10, 'knowledge=' + r.knowledge); ok('Knowledge pre-filled: school, families, waitlist promise, never-promises, voice');
  const kn = ws.knowledge.list('enrollment');
  assert.ok(kn.some((e) => e.type === 'promises' && /Nguyen/.test(e.title))); assert.ok(kn.filter((e) => e.type === 'decisions').length >= 2); ok('waitlist promise + both never-promise decisions present');
  assert.ok(fs.existsSync(path.join(ws.dir, 'SCHOOL.md'))); assert.match(fs.readFileSync(path.join(ws.dir, 'SCHOOL.md'), 'utf8'), /22.*2 open/); ok('SCHOOL.md profile written (22 seats, 2 open)');
  assert.strictEqual(ws.settings.get('enrollment').profile.name, 'Robin Ellis'); ok('founder profile set — no typing required');
  assert.match(ws.botConfig.get('enrollment', 'chief').howIWork, /seat math/); ok('Chief arrives with working instructions');
  assert.strictEqual(r.approvals, 3); assert.strictEqual(ws.status().counters.waiting, 3); ok('three real approvals waiting (inquiry, no-show rescue, deposit)');
  const again = await toy.seedToySchool(ws);
  assert.strictEqual(again.seeded, false); assert.match(again.reason, /Reset/); ok('second load is a safe no-op that points at Reset');
  toy.resetToySchool(ws);
  assert.strictEqual(ws.knowledge.list('enrollment').length, 0); assert.strictEqual(ws.status().counters.waiting, 0); ok('reset wipes state + knowledge cleanly');
  const r2 = await toy.seedToySchool(ws);
  assert.strictEqual(r2.seeded, true); assert.strictEqual(r2.approvals, 3); ok('reset → reload works: the fast feature-test loop');
  assert.ok(r2.routine && r2.routine.kind === 'schedule'); ok('a starter routine rides along');

  const live = fs.readFileSync(path.join(ROOT, 'apps/web/live.html'), 'utf8');
  for (const m of ['toyCard', 'toySchool(', '/api/toy-school', 'Load the toy school']) assert.ok(live.includes(m), 'console missing: ' + m);
  const school = fs.readFileSync(path.join(ROOT, 'apps/web/school.html'), 'utf8');
  assert.ok(school.includes('Open the toy school')); ok('toy school is one click from the console AND the landing page');
  console.log(`v0.19: ${pass} checks passed`);
  fs.rmSync(dataRoot, { recursive: true, force: true });
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
