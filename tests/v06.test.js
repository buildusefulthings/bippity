/** bippity v0.6 tests — hosted R2: tenants, vault, metering, relay routing, provisioning. */
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const ROOT = path.join(__dirname, '..');
const { TenantRegistry, PLANS } = require(path.join(ROOT, 'packages/hosted/tenants'));
const { KeyVault } = require(path.join(ROOT, 'packages/hosted/vault'));
const { UsageMeter } = require(path.join(ROOT, 'packages/hosted/metering'));
const { provisionTenant } = require(path.join(ROOT, 'packages/hosted/provision'));

let pass = 0; const ok = (n) => { pass++; console.log('  ✓', n); };
const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bippity-v06-'));
const KEY = crypto.randomBytes(32).toString('hex');

(async () => {
  console.log('v0.6 hosted R2');
  // 1. Registry: create, resolve by token, plan workspace cap
  const reg = new TenantRegistry(dataRoot);
  const t1 = reg.create({ name: 'Willow Creek', plan: 'free', targetUrl: 'http://127.0.0.1:3999', workspaces: ['willow'] });
  assert.strictEqual(reg.byToken(t1.relayToken).id, t1.id); ok('tenant resolves by relay token');
  assert.throws(() => reg.addWorkspace(t1.id, 'second'), /allows 1 workspace/); ok('free plan workspace cap enforced');
  const oldTok = t1.relayToken; reg.rotate(t1.id);
  assert.strictEqual(reg.byToken(oldTok), null); assert.ok(reg.byToken(t1.relayToken)); ok('token rotation kills the old token');
  assert.strictEqual(reg.list()[0].relayToken.includes('…'), true); ok('list() masks tokens');

  // 2. Vault: round-trip, wrong key fails, no plaintext on disk
  const vault = new KeyVault(dataRoot, { BIPPITY_VAULT_KEY: KEY });
  vault.put(t1.id, { SLACK_BOT_TOKEN: 'xoxb-secret', OPENAI_API_KEY: 'sk-secret' });
  const got = vault.get(t1.id);
  assert.strictEqual(got.SLACK_BOT_TOKEN, 'xoxb-secret'); ok('vault round-trips secrets');
  const onDisk = fs.readFileSync(path.join(dataRoot, 'hosted', 'vault.json'), 'utf8');
  assert.ok(!onDisk.includes('xoxb-secret') && !onDisk.includes('sk-secret')); ok('vault stores ciphertext only');
  const wrong = new KeyVault(dataRoot, { BIPPITY_VAULT_KEY: crypto.randomBytes(32).toString('hex') });
  assert.throws(() => wrong.get(t1.id)); ok('wrong master key fails loudly');

  // 3. Metering: record + monthly summary + brief cap
  const meter = new UsageMeter(dataRoot);
  meter.record(t1.id, 'brief', 3); meter.record(t1.id, 'approval', 1); meter.record(t1.id, 'model_tokens', 1200);
  const s = meter.summary(t1.id);
  assert.strictEqual(s.briefs, 3); assert.strictEqual(s.modelTokens, 1200); ok('usage summary aggregates counts only');
  const allowed = meter.briefAllowed(t1);
  assert.strictEqual(allowed.limit, PLANS.free.briefsPerMonth); assert.strictEqual(allowed.allowed, true); ok('briefAllowed checks plan cap');

  // 4. Provisioning: pack installed + tenant + webhook URLs + vault + proxmox plan
  const reg2 = new TenantRegistry(dataRoot);
  const r = provisionTenant({ registry: reg2, vault, meter, dataRoot, packsRoot: path.join(ROOT, 'bots/examples'), relayBase: 'https://hooks.example.com', name: 'Delta Sign', plan: 'pro', pack: 'ops', workspaceName: 'delta', targetUrl: 'http://127.0.0.1:3998', secrets: { TELEGRAM_BOT_TOKEN: 'tg-secret' }, computer: 'proxmox' });
  assert.strictEqual(r.ok, true); assert.ok(fs.existsSync(path.join(dataRoot, 'workspaces', 'delta', 'manifest.json'))); ok('provisioning installs the pack as a workspace');
  assert.ok(r.webhooks.telegram.includes('/hook/telegram/delta/')); ok('provisioning returns webhook URLs');
  assert.strictEqual(vault.get(r.tenant.id).TELEGRAM_BOT_TOKEN, 'tg-secret'); ok('provisioning stores secrets in the vault');
  assert.strictEqual(r.computerPlan.driver, 'proxmox'); assert.ok(r.computerPlan.clones.length >= 2); ok('provisioning emits a Proxmox clone plan per bot');
  const badPack = provisionTenant({ registry: reg2, dataRoot, packsRoot: path.join(ROOT, 'bots/examples'), relayBase: 'x', name: 'Nope', pack: 'does-not-exist', targetUrl: 'x' });
  assert.strictEqual(badPack.ok, false); ok('provisioning refuses a bad pack before creating a tenant');

  // 5. Relay hosted mode: two tenants route to their own targets; limits apply
  const hits = [];
  const stub = (port) => new Promise((res) => { const srv = http.createServer((rq, rs) => { let b = ''; rq.on('data', (c) => b += c); rq.on('end', () => { hits.push({ port, url: rq.url, ws: rq.headers['x-bippity-workspace'], tenant: rq.headers['x-bippity-tenant'] }); rs.writeHead(200, { 'content-type': 'application/json' }); rs.end('{"ok":true}'); }); }); srv.listen(port, '127.0.0.1', () => res(srv)); });
  const sA = await stub(4101); const sB = await stub(4102);
  const reg3 = new TenantRegistry(dataRoot);
  const ta = reg3.create({ name: 'A', plan: 'pro', targetUrl: 'http://127.0.0.1:4101', workspaces: ['alpha'] });
  const tb = reg3.create({ name: 'B', plan: 'pro', targetUrl: 'http://127.0.0.1:4102', workspaces: ['beta'] });
  const env = { ...process.env, RELAY_PORT: '3301', TENANTS_FILE: path.join(dataRoot, 'hosted', 'tenants.json'), USAGE_FILE: path.join(dataRoot, 'hosted', 'usage.jsonl'), RELAY_RATE_PER_MIN: '3' };
  // reg3 wrote tenants.json under dataRoot/hosted — point the relay at that exact file:
  env.TENANTS_FILE = path.join(dataRoot, 'hosted', 'tenants.json');
  const relay = spawn(process.execPath, [path.join(ROOT, 'apps/relay/relay.js')], { env, stdio: 'pipe' });
  await new Promise((r_) => setTimeout(r_, 800));
  const post = (p) => fetch('http://127.0.0.1:3301' + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  let resp = await post(`/hook/telegram/alpha/${ta.relayToken}`);
  assert.strictEqual(resp.status, 200); assert.strictEqual(hits[0].port, 4101); assert.strictEqual(hits[0].tenant, ta.id); ok('relay routes tenant A to target A');
  resp = await post(`/hook/slack/beta/${tb.relayToken}`);
  assert.strictEqual(resp.status, 200); assert.strictEqual(hits[1].port, 4102); ok('relay routes tenant B to target B');
  resp = await post(`/hook/telegram/alpha/not-a-token`);
  assert.strictEqual(resp.status, 404); ok('unknown tenant token rejected');
  resp = await post(`/hook/telegram/beta/${ta.relayToken}`);
  assert.strictEqual(resp.status, 404); ok('workspace not on tenant rejected');
  // rate limit = 3/min for tenant A: 1 used, 2 more pass, 4th trips
  await post(`/hook/telegram/alpha/${ta.relayToken}`); await post(`/hook/telegram/alpha/${ta.relayToken}`);
  resp = await post(`/hook/telegram/alpha/${ta.relayToken}`);
  assert.strictEqual(resp.status, 429); ok('per-tenant rate limit trips');
  const met = await (await fetch('http://127.0.0.1:3301/metrics')).json();
  assert.ok(met.forwarded >= 4 && met.rateLimited >= 1); ok('relay metrics count forwards + limits');
  relay.kill(); sA.close(); sB.close();

  console.log(`v0.6: ${pass} checks passed`);
  fs.rmSync(dataRoot, { recursive: true, force: true });
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
