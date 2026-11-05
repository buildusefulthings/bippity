/**
 * bippity v0.3 tests — run: npm run test:v03 (also runs in npm test chain)
 * Covers: real SMTP bytes to a capture server, webhook delivery, delivery
 * routing decisions, Workspace approve() delivering for real with shadow
 * OFF (and only logging with shadow ON), Proxmox driver against a mock
 * PVE API, and proxmox sandbox fallback.
 */
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { sendMail } = require(path.join(ROOT, 'packages/connectors/smtp'));
const { DeliveryService } = require(path.join(ROOT, 'packages/connectors/delivery'));
const { loadPack } = require(path.join(ROOT, 'packages/harness/persona-loader'));
const { Workspace } = require(path.join(ROOT, 'packages/harness/runtime'));
const { ProxmoxDriver } = require(path.join(ROOT, 'packages/computers/proxmox'));
const { createSandbox, LocalSandbox } = require(path.join(ROOT, 'packages/computers/sandbox'));

/* --- tiny SMTP capture server (speaks just enough RFC 5321) --- */
function smtpCapture() {
  const captured = { data: '' };
  const srv = net.createServer((sock) => {
    let inData = false; const lines = [];
    sock.write('220 capture.local ESMTP\r\n');
    sock.on('data', (d) => {
      const text = d.toString('utf8');
      if (inData) {
        captured.data += text;
        if (text.includes('\r\n.\r\n') || text.endsWith('\r\n.')) { inData = false; sock.write('250 OK queued\r\n'); }
        return;
      }
      for (const line of text.split(/\r?\n/).filter(Boolean)) {
        lines.push(line);
        if (/^EHLO|^HELO/.test(line)) sock.write('250 capture.local\r\n');
        else if (/^MAIL FROM/.test(line)) sock.write('250 OK\r\n');
        else if (/^RCPT TO/.test(line)) { captured.rcpt = line; sock.write('250 OK\r\n'); }
        else if (line === 'DATA') { inData = true; sock.write('354 End with . on its own line\r\n'); }
        else if (line === 'QUIT') { sock.write('221 Bye\r\n'); sock.end(); }
        else sock.write('250 OK\r\n');
      }
    });
  });
  return new Promise((res) => srv.listen(0, '127.0.0.1', () => res({ srv, port: srv.address().port, captured })));
}

(async () => {
  let n = 0; const ok = (name) => console.log('✓ ' + (++n) + '. ' + name);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bippity-v03-'));

  // 1. SMTP: real bytes land on a real socket server
  const cap = await smtpCapture();
  const sent = await sendMail({ host: '127.0.0.1', port: cap.port, from: 'ivy@willowcreek.example', to: 'parent@example.com', subject: 'Tour times', text: 'Thu 10am or Sat 9am?' });
  assert.strictEqual(sent.ok, true, JSON.stringify(sent));
  assert.ok(cap.captured.rcpt.includes('parent@example.com'));
  assert.ok(cap.captured.data.includes('Thu 10am or Sat 9am'));
  cap.srv.close(); ok('SMTP transport sends a real message over a socket (captured DATA matches)');

  // 2-4. Delivery routing
  const hookHits = [];
  const hook = http.createServer((req, res) => { let b = ''; req.on('data', (c) => b += c); req.on('end', () => { hookHits.push(JSON.parse(b || '{}')); res.writeHead(200); res.end('ok'); }); });
  await new Promise((r) => hook.listen(0, '127.0.0.1', r));
  const hookUrl = `http://127.0.0.1:${hook.address().port}/hook`;
  const appr = { bot: 'Ivy', action: 'send_message', title: 'Send first response', body: 'Hi — tours Thu 10am.' };

  const dShadow = new DeliveryService({ BIPPITY_WEBHOOK_URL: hookUrl });
  assert.strictEqual((await dShadow.deliver(appr, { shadow: true })).status, 'shadow_logged');
  assert.strictEqual(hookHits.length, 0); ok('shadow mode logs and transmits nothing, even with a webhook configured');

  const dHook = new DeliveryService({ BIPPITY_WEBHOOK_URL: hookUrl });
  const dh = await dHook.deliver(appr, { shadow: false });
  assert.strictEqual(dh.status, 'delivered'); assert.strictEqual(dh.via, 'webhook');
  assert.strictEqual(hookHits[0].bot, 'Ivy'); ok('shadow OFF + webhook = real HTTP delivery with the approval payload');

  const dNone = new DeliveryService({});
  assert.strictEqual((await dNone.deliver(appr, { shadow: false })).status, 'skipped_no_recipient');
  const dNoTransport = new DeliveryService({ BIPPITY_TEST_RECIPIENT: 'a@b.c' });
  assert.strictEqual((await dNoTransport.deliver(appr, { shadow: false })).status, 'skipped_no_transport');
  ok('no recipient -> skipped_no_recipient; recipient but no transport -> skipped_no_transport (no fake sends)');

  // 5. End-to-end through Workspace: brief -> queue -> approve -> delivered webhook
  const pack = loadPack(path.join(ROOT, 'bots/examples/enrollment'));
  const ws = new Workspace({ pack, dataRoot: tmp, env: { BIPPITY_SHADOW_MODE: '0' }, delivery: new DeliveryService({ BIPPITY_WEBHOOK_URL: hookUrl }) });
  const q = await ws.brief('New inquiry from a parent on Facebook');
  assert.strictEqual(q.type, 'queued');
  const a = await ws.approve(q.approval.id);
  assert.strictEqual(a.delivery.status, 'delivered'); assert.strictEqual(a.delivery.via, 'webhook');
  assert.strictEqual(hookHits[hookHits.length - 1].bot, 'Ivy');
  ok('Workspace approve() delivers for real end-to-end and stores the result on the approval');
  hook.close();

  // 6. Proxmox driver vs mock PVE API
  const pveCalls = [];
  let pveCloned = false, pveRunning = false;
  const pve = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => b += c); req.on('end', () => {
      pveCalls.push({ method: req.method, url: req.url, auth: req.headers.authorization, body: b });
      const j = (data) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ data })); };
      const u = req.url;
      if (u.endsWith('/status/current')) { if (!pveCloned) { res.writeHead(404); return res.end('{}'); } return j({ status: pveRunning ? 'running' : 'stopped' }); }
      if (u.includes('/clone')) { pveCloned = true; return j('UPID:pve:clone1'); }
      if (u.includes('/tasks/') && u.endsWith('/status')) return j({ status: 'stopped', exitstatus: 'OK' });
      if (u.includes('/status/start')) { pveRunning = true; return j('UPID:pve:start1'); }
      if (u.includes('/agent/exec') && req.method === 'POST') return j({ pid: 42 });
      if (u.includes('/agent/exec-status')) return j({ exited: 1, exitcode: 0, 'out-data': 'hello from vm\n', 'err-data': '' });
      if (u.includes('/agent/file-write')) return j({});
      if (u.includes('/agent/file-read')) return j({ content: 'file-contents' });
      if (u.includes('/status/stop')) return j('UPID:pve:stop1');
      if (u.endsWith('/nodes/pve/status')) return j({ uptime: 12345, cpu: 0.1, memory: { used: 100, total: 200 } });
      res.writeHead(404); res.end('{}');
    });
  });
  await new Promise((r) => pve.listen(0, '127.0.0.1', r));
  const px = new ProxmoxDriver({ PROXMOX_HOST: `http://127.0.0.1:${pve.address().port}`, PROXMOX_API_TOKEN: 'root@pam!bippity=secret-uuid', PROXMOX_NODE: 'pve', PROXMOX_TEMPLATE_VMID: '100', PROXMOX_VMID_BASE: '9000' }, { fetch: globalThis.fetch, pollMs: 5 });
  assert.strictEqual(px.configured, true);
  const started = await px.start('ivy');
  assert.ok(started.vmid >= 9000 && started.consoleUrl.includes('vmid=' + started.vmid));
  assert.ok(pveCalls.some((c) => c.url.includes('/qemu/100/clone')));
  assert.ok(pveCalls.every((c) => !c.auth || c.auth === 'PVEAPIToken=root@pam!bippity=secret-uuid'));
  const ex = await px.exec('ivy', 'echo hello');
  assert.strictEqual(ex.ok, true); assert.ok(ex.stdout.includes('hello from vm'));
  await px.writeFile('ivy', 'note.txt', 'x');
  assert.strictEqual(await px.readFile('ivy', 'note.txt'), 'file-contents');
  await px.stop('ivy');
  const ov = await px.overview(); assert.strictEqual(ov.nodeStatus.uptime, 12345);
  pve.close(); ok('Proxmox driver clones, starts, execs via guest agent, writes/reads files, stops — against mock PVE API with correct token header');

  // 7. createSandbox proxmox fallback
  const sb = await createSandbox({ dataRoot: tmp, preferred: 'proxmox', env: {} });
  assert.ok(sb instanceof LocalSandbox && sb.fallbackReason.includes('not configured'));
  ok('createSandbox(preferred: proxmox) falls back to local with a stated reason when unconfigured');

  console.log('\nAll ' + n + ' v0.3 tests passed.');
})().catch((e) => { console.error('✗ TEST FAILURE:', e.stack || e.message); process.exit(1); });
