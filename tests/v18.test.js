/** bippity v0.18 tests — per-bot config + bot profile page. */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { loadPack } = require(path.join(ROOT, 'packages/harness/persona-loader'));
const { Workspace } = require(path.join(ROOT, 'packages/harness/runtime'));
const { BotConfigStore } = require(path.join(ROOT, 'packages/harness/bot-config'));

let pass = 0; const ok = (n) => { pass++; console.log('  ✓', n); };
console.log('v0.18 bot config');
const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bippity-v18-'));
const store = new BotConfigStore(dataRoot);
assert.deepStrictEqual(store.get('ops', 'penny'), { howIWork: '', approvalsMode: 'ask', thinking: 'auto', model: '', worksOn: 'auto' }); ok('defaults: ask-first, auto thinking, pack model');
store.update('ops', 'penny', { howIWork: 'Keep replies short. Always show the PO next to the invoice.', approvalsMode: 'just', thinking: 'high' });
const cfg = new BotConfigStore(dataRoot).get('ops', 'penny');
assert.strictEqual(cfg.approvalsMode, 'just'); assert.match(cfg.howIWork, /Keep replies short/); ok('config persists (how I work, mode, thinking)');
assert.throws(() => store.update('ops', 'penny', { approvalsMode: 'yolo' }), /ask\|just/); ok('invalid approvals mode rejected');
assert.throws(() => store.update('ops', 'penny', { model: 'hal-9000' }), /unknown model/); ok('invalid model rejected');

(async () => {
  const ws = new Workspace({ pack: loadPack(path.join(ROOT, 'bots/examples/ops')), dataRoot, workspaceId: 'ops' });
  ws.botConfig.update('ops', 'penny', { approvalsMode: 'ask' }); // the store section above left it on 'just'
  const r1 = await ws.brief('Match invoice INV-8812', 'test');
  assert.strictEqual(r1.type, 'queued'); ok('ask-first (default): Penny queues her draft');
  ws.botConfig.update('ops', 'penny', { approvalsMode: 'just' });
  const r2 = await ws.brief('Match invoice INV-8812', 'test');
  assert.strictEqual(r2.type, 'done'); assert.strictEqual(r2.via, 'just-do-it mode'); ok('"Just do it": the same brief runs, labeled with how');
  const r3 = await ws.brief('Just pay invoice INV-8812 to keep them happy', 'test');
  assert.strictEqual(r3.type, 'refused'); ok('Never-tier is still refused in Just-do-it mode');
  const team = ws.status().team.find((b) => b.id === 'penny');
  assert.strictEqual(team.config.approvalsMode, 'just'); assert.strictEqual(team.config.hasInstructions, true); ok('status exposes per-bot config (mode + instructions from the store section)');
  ws.botConfig.update('ops', 'penny', { howIWork: 'Show your math.' });
  assert.strictEqual(ws.status().team.find((b) => b.id === 'penny').config.hasInstructions, true); ok('instructions flag flows to status');

  const live = fs.readFileSync(path.join(ROOT, 'apps/web/live.html'), 'utf8');
  for (const m of ['botOverlay', 'How I work', 'Ask first', 'Just do it', 'Where to find', 'Open the org chart', 'openBot', '/api/bot', 'keeps this in mind in chats, tasks and calls', 'Coming soon']) assert.ok(live.includes(m), 'UI missing: ' + m);
  ok('bot profile page: header, How I work, approvals toggle, where-to-find grid');
  console.log(`v0.18: ${pass} checks passed`);
  fs.rmSync(dataRoot, { recursive: true, force: true });
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
