/** bippity v0.5 tests — Slack/Telegram adapters, dispatcher, relay. */
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { loadPack } = require(path.join(ROOT, 'packages/harness/persona-loader'));
const { Workspace } = require(path.join(ROOT, 'packages/harness/runtime'));
const slack = require(path.join(ROOT, 'packages/channels/slack'));
const tg = require(path.join(ROOT, 'packages/channels/telegram'));
const { ChannelDispatcher } = require(path.join(ROOT, 'packages/channels/dispatcher'));

let pass = 0; const ok = (n) => { pass++; console.log('  ✓', n); };
const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bippity-v05-'));
const ops = new Workspace({ pack: loadPack(path.join(ROOT, 'bots/examples/ops')), dataRoot, workspaceId: 'ops' });

(async () => {
  console.log('v0.5 slack/telegram/dispatcher');
  // 1. Slack signature verify: valid + tampered
  const secret = 'test-signing-secret';
  const ts = String(Math.floor(Date.now() / 1000));
  const raw = JSON.stringify({ type: 'event_callback', event: { type: 'app_mention', user: 'U1', channel: 'C1', text: '<@UBOT> chase supplier PO-1042' } });
  const sig = 'v0=' + crypto.createHmac('sha256', secret).update(`v0:${ts}:${raw}`).digest('hex');
  assert.strictEqual(slack.verifySignature({ signingSecret: secret, timestamp: ts, rawBody: raw, signature: sig }), true); ok('slack signature verifies');
  assert.strictEqual(slack.verifySignature({ signingSecret: secret, timestamp: ts, rawBody: raw + 'x', signature: sig }), false); ok('tampered body rejected');
  assert.strictEqual(slack.verifySignature({ signingSecret: secret, timestamp: '1000000000', rawBody: raw, signature: sig }), false); ok('stale timestamp rejected');

  // 2. Slack event parse + challenge
  assert.strictEqual(slack.parseEvent({ type: 'url_verification', challenge: 'abc' }).challenge, 'abc'); ok('url_verification challenge parsed');
  const ev = slack.parseEvent(JSON.parse(raw));
  assert.strictEqual(ev.kind, 'brief'); assert.strictEqual(ev.text, 'chase supplier PO-1042'); ok('app_mention parsed, mention stripped');

  // 3. Dispatcher: stranger is message-taken, owner briefs + queues
  const disp = new ChannelDispatcher({ workspaces: { ops }, defaultWorkspace: 'ops' });
  const stranger = await disp.brief({ text: 'chase supplier PO-1042', user: 'U999', ownerId: 'U1', channel: 'slack' });
  assert.strictEqual(stranger.type, 'message-taken'); ok('non-owner gets message-taken');
  const r = await disp.brief({ text: 'chase supplier PO-1042', user: 'U1', ownerId: 'U1', channel: 'slack' });
  assert.strictEqual(r.type, 'queued'); assert.strictEqual(r.wsId, 'ops'); ok('owner brief queues Otto approval');

  // 4. Slack approval blocks carry the approval id; interaction round-trips
  const blocks = slack.approvalBlocks(r, 'ops');
  const val = JSON.parse(blocks[1].elements[0].value);
  assert.strictEqual(val.id, r.approval.id); ok('slack blocks embed approval id');
  const ix = slack.parseInteraction(JSON.stringify({ type: 'block_actions', user: { id: 'U1' }, channel: { id: 'C1' }, actions: [{ action_id: 'bippity_approve', value: blocks[1].elements[0].value }] }));
  assert.strictEqual(ix.action, 'approve'); assert.strictEqual(ix.ws, 'ops'); ok('slack interaction parses to approve');

  // 5. Dispatcher act: non-owner blocked; owner approves (shadow)
  const denied = await disp.act({ action: 'approve', wsId: 'ops', id: r.approval.id, user: 'U999', ownerId: 'U1' });
  assert.strictEqual(denied.ok, false); ok('non-owner cannot approve from chat');
  const done = await disp.act({ action: ix.action, wsId: ix.ws, id: ix.id, user: 'U1', ownerId: 'U1' });
  assert.strictEqual(done.ok, true); assert.match(done.text, /delivery: shadow/); ok('owner approve via chat button delivers (shadow)');

  // 6. Telegram: update parse + keyboard + callback parse
  const upd = { message: { from: { id: 42 }, chat: { id: 99 }, text: 'ops: reconcile supplier invoices' } };
  const tev = tg.parseUpdate(upd);
  assert.strictEqual(tev.kind, 'brief'); assert.strictEqual(tev.user, '42'); ok('telegram message parsed');
  const r2 = await disp.brief({ text: tev.text, user: tev.user, ownerId: '42', channel: 'telegram' });
  assert.strictEqual(r2.type, 'queued'); assert.strictEqual(r2.wsId, 'ops'); ok('telegram "ops:" prefix targets workspace');
  const kb = tg.approvalKeyboard(r2, 'ops');
  assert.strictEqual(kb.inline_keyboard[0][0].callback_data, `approve:ops:${r2.approval.id}`); ok('telegram keyboard embeds approval id');
  const cb = tg.parseUpdate({ callback_query: { id: 'cb1', from: { id: 42 }, message: { chat: { id: 99 } }, data: kb.inline_keyboard[0][1].callback_data } });
  assert.strictEqual(cb.action, 'hold'); const held = await disp.act({ action: cb.action, wsId: cb.ws, id: cb.id, user: cb.user, ownerId: '42' });
  assert.strictEqual(held.ok, true); ok('telegram hold callback holds the approval');

  // 7. Refused brief formats cleanly for chat
  const refused = await disp.brief({ text: 'pay invoice INV-8812 now', user: 'U1', ownerId: 'U1', channel: 'slack' });
  assert.strictEqual(refused.type, 'refused'); assert.match(refused.text, /Refused by guardrails/); ok('pay brief refused in chat too');

  // 8. Relay: token-in-path forward to a stub target
  const http = require('http');
  let seen = null;
  const target = http.createServer((rq, rs) => { let b = ''; rq.on('data', (c) => b += c); rq.on('end', () => { seen = { url: rq.url, secret: rq.headers['x-bippity-relay-secret'], sig: rq.headers['x-slack-signature'], body: b }; rs.writeHead(200, { 'content-type': 'application/json' }); rs.end('{"ok":true}'); }); });
  await new Promise((r_) => target.listen(0, '127.0.0.1', r_));
  process.env.RELAY_SECRET = 'tok123'; process.env.BIPPITY_TARGET_URL = `http://127.0.0.1:${target.address().port}`; process.env.RELAY_PORT = '0';
  const relayPath = path.join(ROOT, 'apps/relay/relay.js');
  const { spawn } = require('child_process');
  const child = spawn(process.execPath, [relayPath], { env: { ...process.env, RELAY_PORT: '3299' }, stdio: 'pipe' });
  await new Promise((r_) => setTimeout(r_, 700));
  const good = await fetch('http://127.0.0.1:3299/hook/slack/ops/tok123', { method: 'POST', headers: { 'x-slack-signature': 'v0=zzz', 'content-type': 'application/json' }, body: raw });
  assert.strictEqual(good.status, 200); assert.strictEqual(seen.url, '/api/relay/slack'); assert.strictEqual(seen.sig, 'v0=zzz'); assert.strictEqual(seen.secret, 'tok123'); ok('relay forwards body + slack headers, adds its secret');
  const bad = await fetch('http://127.0.0.1:3299/hook/slack/ops/wrong', { method: 'POST', body: '{}' });
  assert.strictEqual(bad.status, 401); ok('relay rejects bad token');
  child.kill(); target.close();

  console.log(`v0.5: ${pass} checks passed`);
  fs.rmSync(dataRoot, { recursive: true, force: true });
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
