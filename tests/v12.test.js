/** bippity v0.12 tests — routine parsing + Routines UI surface. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { parseRoutineText, describeSchedule, parseTime } = require(path.join(ROOT, 'packages/channels/routine-parse'));
const { RoutineRunner } = require(path.join(ROOT, 'packages/channels/routines'));

let pass = 0; const ok = (n) => { pass++; console.log('  ✓', n); };
console.log('v0.12 routines');
assert.strictEqual(parseTime('8:30'), '08:30'); assert.strictEqual(parseTime('5 PM'), '17:00'); assert.strictEqual(parseTime('12 am'), '00:00'); ok('time parsing incl. am/pm');

let p = parseRoutineText('Every weekday at 8:30, summarize my inbox');
assert.strictEqual(p.kind, 'schedule'); assert.strictEqual(p.routine.at, '08:30'); assert.deepStrictEqual(p.routine.days, [1, 2, 3, 4, 5]); assert.strictEqual(p.routine.brief, 'summarize my inbox'); ok('"every weekday at 8:30" parses');
p = parseRoutineText('Every Friday at 5 PM, send me what we did this week');
assert.deepStrictEqual(p.routine.days, [5]); assert.strictEqual(p.routine.at, '17:00'); ok('"every Friday at 5 PM" parses');
p = parseRoutineText('Every day at 7, morning brief');
assert.strictEqual(p.routine.days.length, 7); assert.strictEqual(describeSchedule(p.routine), 'every day at 07:00'); ok('"every day" parses + describes');
p = parseRoutineText('Watch https://example.com/prices and tell me when the price drops');
assert.strictEqual(p.kind, 'watch'); assert.strictEqual(p.watch.type, 'http'); assert.strictEqual(p.watch.target, 'https://example.com/prices'); ok('watch sentence becomes an http watch');
assert.strictEqual(parseRoutineText('do the thing sometimes'), null); assert.strictEqual(parseRoutineText('every someday at 9, x'), null); ok('unparseable sentences return null (no guessing)');

(async () => {
  // A parsed routine fires through the normal brief path
  const fired = [];
  const fakeWs = { brief: async (text, ch) => { fired.push([text, ch]); return { type: 'queued' }; } };
  const runner = new RoutineRunner(fakeWs, [parseRoutineText('Every weekday at 8:30, summarize my inbox').routine]);
  const monday0830 = new Date('2026-11-09T08:30:00'); // a Monday
  await runner.tick(monday0830);
  assert.strictEqual(fired.length, 1); assert.strictEqual(fired[0][0], 'summarize my inbox'); ok('parsed routine fires on schedule through brief()');
  await runner.tick(monday0830);
  assert.strictEqual(fired.length, 1); ok('same minute does not double-fire');

  const live = fs.readFileSync(path.join(ROOT, 'apps/web/live.html'), 'utf8');
  for (const m of ['Routines', 'No routines yet', 'Every Friday at 5 PM', '/api/routines', 'Watch a page and tell me when the price drops']) assert.ok(live.includes(m), 'UI missing: ' + m);
  ok('Routines section: list, empty state, suggestion chips, API wiring');
  console.log(`v0.12: ${pass} checks passed`);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
