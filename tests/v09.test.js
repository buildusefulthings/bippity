/** bippity v0.9 tests — Apple-style UI refresh keeps every surface + behavior hook. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
let pass = 0; const ok = (n) => { pass++; console.log('  ✓', n); };
console.log('v0.9 UI refresh');
const live = fs.readFileSync(path.join(ROOT, 'apps/web/live.html'), 'utf8');
for (const marker of ['Needs your attention', 'Practice mode', 'Tell me what you need', 'Money is always blocked', '/api/brief', '/api/approve', '/api/workspaces', '/api/packs/install', '/api/watches/tick']) assert.ok(live.includes(marker), 'live UI missing: ' + marker);
ok('live UI has the simple surfaces + every API hook');
assert.ok(!live.includes('--bg:#0f1115')); ok('dark developer theme is gone');
for (const hook of ['decide(', 'sendBrief(', 'quickSend(', 'refreshMeta(']) assert.ok(live.includes(hook), 'missing behavior: ' + hook);
ok('brief / approve / hold / install / watches behaviors preserved');
const signup = fs.readFileSync(path.join(ROOT, 'apps/web/signup.html'), 'utf8');
for (const marker of ['#f5f5f7', 'border-radius:20px', '/api/public/signup', '/api/public/status', 'company_website']) assert.ok(signup.includes(marker), 'signup missing: ' + marker);
ok('signup page matches the design system + keeps its API + honeypot');
console.log(`v0.9: ${pass} checks passed`);
