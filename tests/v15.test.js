/** bippity v0.15 tests — microschool configure wizard + profile wiring. */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const ROOT = path.join(__dirname, '..');

let pass = 0; const ok = (n) => { pass++; console.log('  ✓', n); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, tries = 40) { for (let i = 0; i < tries; i++) { try { if (await fn()) return true; } catch { /* retry */ } await wait(250); } return false; }

(async () => {
  console.log('v0.15 configure wizard');
  const page = fs.readFileSync(path.join(ROOT, 'apps/web/configure.html'), 'utf8');
  for (const m of ['First, your school', 'how families find you', 'Your voice &amp; your context', 'Create your team', 'Never promise', 'What makes your school special', 'company_website', "/api/public/signup", 'Create my enrollment team', 'What your bots now know']) assert.ok(page.includes(m), 'wizard missing: ' + m);
  ok('wizard: 4 steps, custom-context fields, honeypot, confirmation');
  const school = fs.readFileSync(path.join(ROOT, 'apps/web/school.html'), 'utf8');
  assert.ok(!school.includes('href="/signup"')); assert.ok(school.includes('/configure')); ok('landing page now routes to /configure, not the generic signup');
  const signup = fs.readFileSync(path.join(ROOT, 'apps/web/signup.html'), 'utf8');
  assert.ok(signup.includes('/configure')); ok('generic signup points microschools to the wizard');

  // Live: a wizard-shaped signup stores the profile and seeds the workspace
  const PORT = 3315;
  const srv = spawn('node', [path.join(ROOT, 'apps/server/server.js')], { env: { ...process.env, BIPPITY_PORT: String(PORT) }, stdio: 'ignore' });
  try {
    const up = await until(async () => (await fetch(`http://127.0.0.1:${PORT}/configure`)).ok);
    assert.ok(up); ok('server serves /configure');
    const r = await (await fetch(`http://127.0.0.1:${PORT}/api/public/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Fern Diaz', email: 'fern@fernwood.example', plan: 'free', pack: 'enrollment', workspace: 'fernwood-test', school: { schoolName: 'Fernwood Microschool', city: 'Austin, TX', ages: ['Elementary (7–11)'], seats: '18', seatsOpen: '3', tuition: '$7,500 / year', tourDays: ['Thu', 'Sat'], tourTimes: 'Thu 10 AM, Sat 9 AM', approach: ['Nature-based'], about: 'A garden school under live oaks.', faqs: 'Aftercare? Yes, until 5.', neverPromise: ['A seat', 'Financial aid'], channels: ['Facebook', 'Website form'], founderName: 'Fern Diaz' } }) })).json();
    assert.ok(r.ok, JSON.stringify(r)); ok('wizard signup accepted');
    const st = await (await fetch(`http://127.0.0.1:${PORT}/api/public/status?tenant=${r.tenant.id}&token=${r.relayToken}`)).json();
    assert.strictEqual(st.profile.schoolName, 'Fernwood Microschool'); assert.deepStrictEqual(st.profile.neverPromise, ['A seat', 'Financial aid']); ok('school profile stored on the tenant and returned by status');
    const wsDir = path.join(ROOT, '.data/workspaces/fernwood-test');
    assert.ok(fs.existsSync(path.join(wsDir, 'SCHOOL.md'))); assert.match(fs.readFileSync(path.join(wsDir, 'SCHOOL.md'), 'utf8'), /garden school under live oaks/); ok('SCHOOL.md context written into the workspace');
    const knowledge = JSON.parse(fs.readFileSync(path.join(wsDir, 'knowledge.json'), 'utf8'));
    const flat = JSON.stringify(knowledge);
    assert.ok(flat.includes('Never promise: A seat')); assert.ok(flat.includes('Fernwood Microschool')); ok('context seeded into workspace Knowledge (incl. never-promise decisions)');
    const settings = JSON.parse(fs.readFileSync(path.join(wsDir, 'settings.json'), 'utf8'));
    assert.strictEqual(settings.profile.email, 'fern@fernwood.example'); ok('user profile created (settings carry founder name + email)');
  } finally { srv.kill(); }
  console.log(`v0.15: ${pass} checks passed`);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
