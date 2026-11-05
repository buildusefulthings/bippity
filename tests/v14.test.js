/** bippity v0.14 tests — microschool landing page. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

let pass = 0; const ok = (n) => { pass++; console.log('  ✓', n); };
console.log('v0.14 microschool landing');
const page = fs.readFileSync(path.join(ROOT, 'apps/web/school.html'), 'utf8');
assert.ok(page.includes('Fill') && page.includes('every') && page.includes('seat.')); ok('hero headline present');
for (const m of ['NEEDS YOU', 'Done today', 'Configure bippity for your school', '/configure', 'Practice mode', 'Willow Creek']) assert.ok(page.includes(m), 'landing missing: ' + m);
ok('hero cards + CTAs + honest demo labeling');
// The eight steps, in order
const flow = ['Inquiry', 'Tour', 'Application', 'Shadow Day', 'Accepted', 'Deposit', 'Enrolled', 'Re-enrollment'];
let last = -1;
for (const step of flow) { const i = page.indexOf("'" + step + "'", last + 1); assert.ok(i > last, 'step out of order or missing: ' + step); last = i; }
ok('enrollment flow: all eight steps in order');
for (const bot of ['Ivy', 'Tess', 'Ana', 'Walt', 'Rae']) assert.ok(page.includes(bot), 'landing missing bot ' + bot);
ok('the enrollment team is named');
const server = fs.readFileSync(path.join(ROOT, 'apps/server/server.js'), 'utf8');
assert.ok(server.includes("'/school'") && server.includes('school.html')); ok('server serves /school');
console.log(`v0.14: ${pass} checks passed`);
