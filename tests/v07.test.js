/** bippity v0.7 tests — R3: billing (Stripe) + metering completion. */
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const ROOT = path.join(__dirname, '..');
const { TenantRegistry } = require(path.join(ROOT, 'packages/hosted/tenants'));
const { UsageMeter } = require(path.join(ROOT, 'packages/hosted/metering'));
const { BillingService, verifyStripeSignature } = require(path.join(ROOT, 'packages/hosted/billing'));
const { sanitizeEvents, verifyReport, reportUsage } = require(path.join(ROOT, 'packages/hosted/reporter'));

let pass = 0; const ok = (n) => { pass++; console.log('  ✓', n); };
const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bippity-v07-'));
const ENV = { STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: 'whsec_test', STRIPE_PRICE_PRO: 'price_pro', STRIPE_PRICE_MAX: 'price_max' };

(async () => {
  console.log('v0.7 R3 billing + metering');
  const reg = new TenantRegistry(dataRoot);
  const t = reg.create({ name: 'Delta', plan: 'free', targetUrl: 'http://127.0.0.1:1', workspaces: ['delta'] });

  // 1. Stripe webhook signature: valid + tampered + stale
  const raw = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed', data: { object: { client_reference_id: t.id, customer: 'cus_1', subscription: 'sub_1' } } });
  const ts = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac('sha256', ENV.STRIPE_WEBHOOK_SECRET).update(`${ts}.${raw}`).digest('hex');
  const header = `t=${ts},v1=${sig}`;
  assert.strictEqual(verifyStripeSignature({ secret: ENV.STRIPE_WEBHOOK_SECRET, header, rawBody: raw }), true); ok('stripe signature verifies');
  assert.strictEqual(verifyStripeSignature({ secret: ENV.STRIPE_WEBHOOK_SECRET, header, rawBody: raw + ' ' }), false); ok('tampered stripe body rejected');
  assert.strictEqual(verifyStripeSignature({ secret: ENV.STRIPE_WEBHOOK_SECRET, header: `t=${ts - 10000},v1=${sig}`, rawBody: raw }), false); ok('stale stripe signature rejected');

  // 2. Event flow: checkout completed links; subscription.updated sets plan; failed payment past_due (still relay-served); deleted -> free + blocked
  const calls = [];
  const mockFetch = async (url, opts) => { calls.push({ url, body: opts.body }); return { ok: true, json: async () => ({ id: 'cs_test', url: 'https://checkout.stripe.com/x' }) }; };
  const billing = new BillingService(ENV, mockFetch, reg);
  let r = billing.handleEvent(JSON.parse(raw));
  assert.strictEqual(r.handled, true); assert.strictEqual(reg.byId(t.id).billing.customerId, 'cus_1'); assert.strictEqual(reg.byId(t.id).status, 'active'); ok('checkout.session.completed links customer + activates');
  r = billing.handleEvent({ type: 'customer.subscription.updated', data: { object: { id: 'sub_1', customer: 'cus_1', status: 'active', items: { data: [{ price: { id: 'price_pro' } }] } } } });
  assert.strictEqual(reg.byId(t.id).plan, 'pro'); ok('subscription.updated moves tenant to pro');
  r = billing.handleEvent({ type: 'invoice.payment_failed', data: { object: { customer: 'cus_1' } } });
  assert.strictEqual(reg.byId(t.id).status, 'past_due'); assert.ok(reg.byToken(reg.byId(t.id).relayToken)); ok('past_due keeps relay access (dunning window)');
  r = billing.handleEvent({ type: 'customer.subscription.deleted', data: { object: { customer: 'cus_1' } } });
  const after = reg.byId(t.id);
  assert.strictEqual(after.plan, 'free'); assert.strictEqual(after.status, 'canceled'); assert.strictEqual(reg.byToken(after.relayToken), null); ok('subscription.deleted -> free + relay access off');

  // 3. Checkout session creation: form-encoded, subscription mode, right price
  const s = await billing.createCheckout({ tenant: reg.byId(t.id), plan: 'max', successUrl: 'https://x/ok', cancelUrl: 'https://x/no' });
  assert.strictEqual(s.url, 'https://checkout.stripe.com/x');
  const sent = new URLSearchParams(calls[0].body);
  assert.strictEqual(sent.get('mode'), 'subscription'); assert.strictEqual(sent.get('line_items[0][price]'), 'price_max'); ok('checkout session posts subscription + plan price');
  assert.strictEqual(billing.status().configured, true); assert.strictEqual(new BillingService({}, mockFetch, reg).status().configured, false); ok('billing status is honest when unconfigured');

  // 4. Reporter: sanitize drops junk; verifyReport gates on instanceSecret
  const clean = sanitizeEvents([{ kind: 'brief', n: 2 }, { kind: 'hack', n: 1 }, { kind: 'delivery', n: -5 }, { kind: 'approval', n: 1.7 }]);
  assert.strictEqual(clean.length, 2); assert.strictEqual(clean[1].n, 1); ok('usage sanitize drops bad kinds/amounts');
  assert.strictEqual(verifyReport(reg, t.id, 'wrong').ok, false); assert.strictEqual(verifyReport(reg, t.id, reg.byId(t.id).instanceSecret).ok, true); ok('usage report requires the tenant instance secret');

  // 5. Relay metering: hosted relay appends brief usage; plan cap then blocks with 402
  const regF = new TenantRegistry(dataRoot);
  const tf = regF.create({ name: 'Freebie', plan: 'free', targetUrl: 'http://127.0.0.1:4105', workspaces: ['freews'] });
  const usageFile = path.join(dataRoot, 'hosted', 'usage.jsonl');
  const meter = new UsageMeter(dataRoot);
  meter.record(tf.id, 'brief', 199); // one under the free cap of 200
  const stub = http.createServer((rq, rs) => { let b = ''; rq.on('data', (c) => b += c); rq.on('end', () => { rs.writeHead(200, { 'content-type': 'application/json' }); rs.end('{"ok":true}'); }); });
  await new Promise((r_) => stub.listen(4105, '127.0.0.1', r_));
  const relay = spawn(process.execPath, [path.join(ROOT, 'apps/relay/relay.js')], { env: { ...process.env, RELAY_PORT: '3302', TENANTS_FILE: path.join(dataRoot, 'hosted', 'tenants.json'), USAGE_FILE: usageFile }, stdio: 'pipe' });
  await new Promise((r_) => setTimeout(r_, 800));
  const post = () => fetch(`http://127.0.0.1:3302/hook/telegram/freews/${tf.relayToken}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  let resp = await post();
  assert.strictEqual(resp.status, 200); ok('brief #200 passes under the cap');
  assert.strictEqual(meter.summary(tf.id).briefs, 200); ok('relay appended the forwarded brief to usage');
  resp = await post();
  assert.strictEqual(resp.status, 402); const j = await resp.json(); assert.match(j.error, /over its free plan brief limit/); ok('brief #201 blocked with a friendly 402');
  relay.kill(); stub.close();

  console.log(`v0.7: ${pass} checks passed`);
  fs.rmSync(dataRoot, { recursive: true, force: true });
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
