/** bippity v0.17 tests — connections store + live apply. */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { ConnectionsStore, SERVICES } = require(path.join(ROOT, 'packages/harness/connections'));
const { loadPack } = require(path.join(ROOT, 'packages/harness/persona-loader'));
const { Workspace } = require(path.join(ROOT, 'packages/harness/runtime'));

let pass = 0; const ok = (n) => { pass++; console.log('  ✓', n); };
console.log('v0.17 connections');
const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bippity-v17-'));
const store = new ConnectionsStore(dataRoot);
assert.ok(SERVICES.length >= 10); assert.ok(SERVICES.some((s) => s.id === 'slack') && SERVICES.some((s) => s.id === 'smtp') && SERVICES.some((s) => s.id === 'anthropic')); ok('catalog covers models, chat, email, apps, sms');
let st = store.status({});
assert.strictEqual(st.find((s) => s.id === 'smtp').configured, false); ok('nothing configured at first');
store.set('smtp', { SMTP_HOST: 'smtp.gmail.com', SMTP_PORT: '465', SMTP_USER: 'fern@gmail.com', SMTP_PASS: 'abcd efgh ijkl mnop', SMTP_FROM: 'fern@gmail.com' });
st = store.status({});
const smtp = st.find((s) => s.id === 'smtp');
assert.strictEqual(smtp.configured, true); assert.strictEqual(smtp.source, 'ui'); assert.strictEqual(smtp.masked.SMTP_PASS, '••••mnop'); ok('save works; secret is masked to its last 4, never returned in full');
assert.ok(!JSON.stringify(st).includes('abcd efgh')); ok('no full secret anywhere in the status payload');
store.set('smtp', { SMTP_HOST: '' }); // empty field must not wipe
assert.strictEqual(store.read().SMTP_HOST, 'smtp.gmail.com'); ok('empty inputs keep the saved value (update-friendly)');
const env = {}; store.overlay(env);
assert.strictEqual(env.SMTP_HOST, 'smtp.gmail.com'); ok('stored values overlay onto env at boot');
// Live apply: a workspace rebuilt with the new env delivers via SMTP
const ws = new Workspace({ pack: loadPack(path.join(ROOT, 'bots/examples/ops')), dataRoot, workspaceId: 'ops', env: {} });
assert.strictEqual(ws.delivery.status().smtp, false);
ws.applyEnv(env);
assert.strictEqual(ws.delivery.status().smtp, true); ok('applyEnv rebuilds delivery live — no restart, no .env edit');
store.disconnect('smtp');
assert.strictEqual(store.status({}).find((s) => s.id === 'smtp').configured, false); ok('disconnect removes the service');
assert.throws(() => store.set('nope', {}), /unknown service/); ok('unknown services rejected');

const live = fs.readFileSync(path.join(ROOT, 'apps/web/live.html'), 'utf8');
for (const m of ['Connections', 'connGrid', '/api/connections', 'no config files', 'never shown back in full']) assert.ok(live.includes(m), 'UI missing: ' + m);
ok('Connections section present with the no-config-files promise');
console.log(`v0.17: ${pass} checks passed`);
fs.rmSync(dataRoot, { recursive: true, force: true });
