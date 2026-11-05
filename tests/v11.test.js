/** bippity v0.11 tests — settings store + Settings UI surface. */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { WorkspaceSettings } = require(path.join(ROOT, 'packages/harness/settings'));

let pass = 0; const ok = (n) => { pass++; console.log('  ✓', n); };
console.log('v0.11 settings');
const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bippity-v11-'));
const st = new WorkspaceSettings(dataRoot);
assert.deepStrictEqual(st.get('ws1'), { profile: { name: '', email: '' }, askPolicy: 'everyone' }); ok('defaults: empty profile, askPolicy everyone');
const u = st.update('ws1', { profile: { name: 'Mark Cav', email: 'buildusefulthings@gmail.com' }, askPolicy: 'up_and_down' });
assert.strictEqual(u.askPolicy, 'up_and_down'); ok('profile + askPolicy persist');
assert.strictEqual(new WorkspaceSettings(dataRoot).get('ws1').profile.name, 'Mark Cav'); ok('settings survive reload');
assert.throws(() => st.update('ws1', { askPolicy: 'nobody' }), /everyone\|up_and_down/); ok('bad askPolicy rejected');
const u2 = st.update('ws1', { hacker: 'x', askPolicy: 'everyone' });
assert.strictEqual('hacker' in u2, false); ok('non-whitelisted keys are dropped');

const live = fs.readFileSync(path.join(ROOT, 'apps/web/live.html'), 'utf8');
for (const label of ['Profile', 'Plan and credit', 'Usage', 'How bots reach you', 'Privacy', 'This computer', 'General', 'Team', 'Org chart', 'Bots', 'Logins', 'Email and phone']) assert.ok(live.includes(label), 'settings nav missing: ' + label);
ok('all twelve settings items from the reference are in the nav');
for (const m of ['Sees every bot', 'Up and down only', 'Your next bot goes here', 'Bots can ask each other', '/api/settings']) assert.ok(live.includes(m), 'org chart missing: ' + m);
ok('org chart: You -> Chief -> specialists, ask-policy toggle, next-bot card');
console.log(`v0.11: ${pass} checks passed`);
fs.rmSync(dataRoot, { recursive: true, force: true });
