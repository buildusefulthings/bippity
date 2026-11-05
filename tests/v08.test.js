/** bippity v0.8 tests — public signup site + endpoint guards. */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const ROOT = path.join(__dirname, '..');

let pass = 0; const ok = (n) => { pass++; console.log('  ✓', n); };
(async () => {
  console.log('v0.8 public signup');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bippity-v08-'));
  const env = { ...process.env, BIPPITY_PORT: '3303', SIGNUP_RATE_PER_HOUR: '3', HOSTED_ADMIN_TOKEN: 'adm' };
  const srv = spawn(process.execPath, [path.join(ROOT, 'apps/server/server.js')], { env, cwd: tmp, stdio: 'pipe' });
  // server writes .data under ROOT (its own dir), not cwd — copy approach: run against repo but with a scratch HOME? Simpler: the server uses ROOT/.data; tests use unique workspace names and clean up after.
  await new Promise((r) => setTimeout(r, 1200));
  const base = 'http://127.0.0.1:3303';
  const post = (p, body, headers = {}) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

  const page = await (await fetch(base + '/signup')).text();
  assert.ok(page.includes('Create your workspace') && page.includes('$200')); ok('signup page serves with pricing');

  // 1. Free signup: active, token + webhooks returned, NO instanceSecret
  let r = await post('/api/public/signup', { name: 'Willow Creek', email: 'a@b.co', pack: 'enrollment', plan: 'free', workspace: 'willow-v08' });
  let j = await r.json();
  assert.strictEqual(r.status, 200); assert.strictEqual(j.status, 'active'); ok('free signup activates immediately');
  assert.ok(j.relayToken && j.webhooks.telegram.includes('/hook/telegram/willow-v08/')); ok('signup returns webhook URL + token');
  assert.strictEqual(JSON.stringify(j).includes('instanceSecret'), false); ok('public response never leaks the instance secret');

  // 2. Status check: right token works, wrong token 401
  const good = await fetch(`${base}/api/public/status?tenant=${j.tenant.id}&token=${j.relayToken}`);
  assert.strictEqual(good.status, 200); ok('status check works with the token');
  const bad = await fetch(`${base}/api/public/status?tenant=${j.tenant.id}&token=nope`);
  assert.strictEqual(bad.status, 401); ok('status check rejects a wrong token');

  // 3. Honeypot: fake success, nothing created (tenant count via admin stays same)
  const before = await (await fetch(base + '/api/hosted/tenants', { headers: { 'x-bippity-admin': 'adm' } })).json();
  r = await post('/api/public/signup', { name: 'Bot', email: 'bot@spam.co', pack: 'ops', plan: 'free', workspace: 'botws', company_website: 'http://spam' });
  j = await r.json();
  assert.strictEqual(j.ok, true);
  const after = await (await fetch(base + '/api/hosted/tenants', { headers: { 'x-bippity-admin': 'adm' } })).json();
  assert.strictEqual(after.tenants.length, before.tenants.length); ok('honeypot signup creates nothing');

  // 4. Validation + paid plan pending
  r = await post('/api/public/signup', { name: 'X', email: 'not-an-email', pack: 'ops', plan: 'free', workspace: 'x1' });
  assert.strictEqual(r.status, 400); ok('bad email rejected');
  r = await post('/api/public/signup', { name: 'Delta', email: 'd@e.co', pack: 'ops', plan: 'pro', workspace: 'delta-v08' });
  j = await r.json();
  assert.strictEqual(j.status, 'pending'); assert.ok(j.checkout && (j.checkout.url || j.checkout.error)); ok('paid signup is pending + returns a checkout attempt');

  // 5. Rate limit: limit=3/hour per IP; used so far from this IP: willow(1) + honeypot(0, not counted) + bad email(0, rejected before count) + delta(1) = 2. Two more signups: 3rd passes, 4th is 429.
  r = await post('/api/public/signup', { name: 'Three', email: 't@t.co', pack: 'ops', plan: 'free', workspace: 'three-v08' });
  assert.strictEqual(r.status, 200);
  r = await post('/api/public/signup', { name: 'Four', email: 'f@f.co', pack: 'ops', plan: 'free', workspace: 'four-v08' });
  assert.strictEqual(r.status, 429); ok('per-IP signup rate limit trips');

  srv.kill();
  // cleanup installed test workspaces
  for (const w of ['willow-v08', 'delta-v08', 'three-v08']) fs.rmSync(path.join(ROOT, '.data', 'workspaces', w), { recursive: true, force: true });
  const tf = path.join(ROOT, '.data', 'hosted', 'tenants.json');
  if (fs.existsSync(tf)) { const all = JSON.parse(fs.readFileSync(tf, 'utf8')); fs.writeFileSync(tf, JSON.stringify(all.filter((x) => !String(x.name).match(/Willow Creek|Delta|Three/) || !JSON.stringify(x).includes('v08')), null, 2)); }
  console.log(`v0.8: ${pass} checks passed`);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
