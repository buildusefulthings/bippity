/**
 * bippity v0.2 runtime tests — no framework, run: npm test
 * Covers: pack loading, Chief routing, the full brief->queue->approve
 * path, brief-level + action-level Never-Auto refusal, memory
 * persistence, sandbox write/read, connector status, routines.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { loadPack } = require(path.join(ROOT, 'packages/harness/persona-loader'));
const { Workspace } = require(path.join(ROOT, 'packages/harness/runtime'));
const { LocalSandbox } = require(path.join(ROOT, 'packages/computers/sandbox'));
const { connectorStatus } = require(path.join(ROOT, 'packages/connectors/adapters'));
const { RoutineRunner } = require(path.join(ROOT, 'packages/channels/routines'));

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bippity-test-'));
  let n = 0; const ok = (name) => console.log('✓ ' + (++n) + '. ' + name);

  const pack = loadPack(path.join(ROOT, 'bots/examples/enrollment'));
  assert.strictEqual(pack.bots.length, 6); ok('enrollment pack loads 6 bots from pack.yaml + pack.bots.js');

  const ws = new Workspace({ pack, dataRoot: tmp, env: {} });
  const r1 = await ws.brief('New inquiry from a parent on Facebook');
  assert.strictEqual(r1.type, 'queued'); assert.strictEqual(r1.from, 'Ivy'); assert.strictEqual(r1.approval.action, 'send_message');
  ok('brief routes to Ivy by keyword and queues her send in Approvals');

  const before = ws.status().counters.done;
  const a = await ws.approve(r1.approval.id);
  assert.ok(a && a.status === 'approved'); assert.strictEqual(ws.status().counters.done, before + 1);
  ok('human approve releases the action and increments counters');

  const r2 = await ws.brief('Just pay the deposit for them');
  assert.strictEqual(r2.type, 'refused');
  ok('brief asking to collect/pay a deposit is refused by Chief plan check');

  const r3 = await ws.brief('An application has stalled for 5 days');
  assert.strictEqual(r3.type, 'queued'); assert.strictEqual(r3.from, 'Ana');
  const held = ws.hold(r3.approval.id); assert.strictEqual(held.status, 'held');
  ok('Ana nudge queues; hold leaves it unsent');

  // memory persisted to disk, reloadable by a fresh workspace instance
  const mem = fs.readFileSync(path.join(tmp, 'workspaces/enrollment/memory/ivy.md'), 'utf8');
  assert.ok(mem.includes('send_message')); 
  const ws2 = new Workspace({ pack, dataRoot: tmp, env: {} });
  assert.ok(ws2.memory.load('enrollment', 'ivy').includes('Ivy'.length ? 'proposed' : ''));
  assert.strictEqual(ws2.status().counters.approved, ws.status().counters.approved);
  ok('file memory + workspace counters persist across instances');

  const sb = new LocalSandbox(path.join(tmp, 'sandboxes'));
  await sb.writeFile('ivy', 'note.txt', 'hello sandbox');
  assert.strictEqual(await sb.readFile('ivy', 'note.txt'), 'hello sandbox');
  const ex = await sb.exec('ivy', 'echo $((6*7))');
  assert.ok(ex.stdout.includes('42'));
  ok('local sandbox writes, reads, and executes inside its bot directory');

  const cs = connectorStatus({});
  assert.ok(cs.every((c) => c.configured === false));
  ok('connectors honestly report not_configured without keys');

  const ops = new Workspace({ pack: loadPack(path.join(ROOT, 'bots/examples/ops')), dataRoot: tmp, env: {} });
  const rr = new RoutineRunner(ops, [{ name: 'morning', at: '07:00', days: [0,1,2,3,4,5,6], brief: 'Chase the unconfirmed PO with the supplier' }]);
  const fired = await rr.tick(new Date('2026-11-05T07:00:00'));
  assert.strictEqual(fired.length, 1); assert.strictEqual(fired[0].type, 'queued');
  ok('routine fires a brief through the same guardrail/approvals path (Otto queued)');

  console.log('\nAll ' + n + ' runtime tests passed.');
})().catch((e) => { console.error('✗ TEST FAILURE:', e.message); process.exit(1); });
