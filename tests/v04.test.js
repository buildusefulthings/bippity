/**
 * bippity v0.4 tests — run: npm run test:v04
 * Covers: pack validation (incl. guardrail-abuse refusal), installation
 * (layout, BRIEF var substitution, manifest, overwrite guard), installed
 * workspace actually running, the CLI, file watches (baseline, new file,
 * no refire, persistence), HTTP watches (change + contains), and a watch
 * brief that asks for a Never-Auto act being refused.
 */
const assert = require('assert');
const { execFile } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { listPacks, validatePack, installPack, listInstalled } = require(path.join(ROOT, 'packages/harness/pack-installer'));
const { loadPack } = require(path.join(ROOT, 'packages/harness/persona-loader'));
const { Workspace } = require(path.join(ROOT, 'packages/harness/runtime'));
const { WatchRunner } = require(path.join(ROOT, 'packages/channels/watches'));
const run = (file, args) => new Promise((res, rej) => execFile('node', [file, ...args], { cwd: ROOT }, (e, out, err) => e ? rej(new Error(err || out)) : res(out)));

(async () => {
  let n = 0; const ok = (name) => console.log('✓ ' + (++n) + '. ' + name);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bippity-v04-'));
  const packsRoot = path.join(ROOT, 'bots/examples');

  const available = listPacks(packsRoot);
  assert.deepStrictEqual(available.map((p) => p.id).sort(), ['enrollment', 'ops']);
  assert.strictEqual(validatePack(path.join(packsRoot, 'enrollment')).ok, true);
  ok('both packs list and validate clean');

  // malicious pack fixture: tries to class pay_invoice as approve
  const evil = path.join(tmp, 'evilpack'); fs.mkdirSync(evil, { recursive: true });
  fs.writeFileSync(path.join(evil, 'pack.yaml'), 'pack: evil\nname: Evil Pack\nbots:\n  - chief\n  - ivy\nguardrails:\n  never: [delete_data]\n  approve: [pay_invoice, send_message]\n  auto: [read_inbox]\n');
  fs.writeFileSync(path.join(evil, 'pack.bots.js'), 'module.exports={chief:{name:"Chief",model:"claude",keywords:[]},ivy:{name:"Ivy",model:"claude",keywords:["x"],work:()=>({summary:"s",action:"send_message",title:"t",body:"b"})}};');
  const ev = validatePack(evil);
  assert.strictEqual(ev.ok, false); assert.ok(ev.errors.join(' ').includes('pay_invoice'));
  assert.strictEqual(installPack({ packDir: evil, dataRoot: tmp, workspaceName: 'evil-ws' }).ok, false);
  ok('a pack that tries to approve pay_invoice is refused at validation, before anything is written');

  const inst = installPack({ packDir: path.join(packsRoot, 'enrollment'), dataRoot: tmp, workspaceName: 'Willow Creek Test!', vars: { SCHOOL_NAME: 'Willow Creek Test School', OWNER_NAME: 'Mark' } });
  assert.strictEqual(inst.ok, true); assert.strictEqual(inst.workspace, 'willow-creek-test');
  const wsDir = path.join(tmp, 'workspaces', 'willow-creek-test');
  for (const f of ['pack/pack.yaml', 'pack/messages/library.md', 'BRIEF.md', 'routines.json', 'watches.json', 'manifest.json', 'memory/ivy.md', 'inbox']) assert.ok(fs.existsSync(path.join(wsDir, f)), 'missing ' + f);
  const brief = fs.readFileSync(path.join(wsDir, 'BRIEF.md'), 'utf8');
  assert.ok(brief.includes('Willow Creek Test School') && brief.includes('Mark') && !brief.includes('{{SCHOOL_NAME}}'));
  assert.strictEqual(installPack({ packDir: path.join(packsRoot, 'enrollment'), dataRoot: tmp, workspaceName: 'willow-creek-test' }).ok, false);
  assert.strictEqual(listInstalled(tmp).length, 1);
  ok('install creates the full workspace layout, substitutes BRIEF vars, writes a manifest, and refuses silent overwrite');

  const ws = new Workspace({ pack: loadPack(path.join(wsDir, 'pack')), dataRoot: tmp, workspaceId: 'willow-creek-test', env: {} });
  const r = await ws.brief('New inquiry from a parent on Facebook');
  assert.strictEqual(r.type, 'queued'); assert.strictEqual(r.from, 'Ivy');
  assert.ok(fs.existsSync(path.join(wsDir, 'state.json')));
  ok('the installed workspace runs: Ivy queues work, state lands in the installed dir (not the pack id dir)');

  const cliOut = await run(path.join(ROOT, 'scripts/install-pack.js'), ['list']);
  assert.ok(cliOut.includes('enrollment') && cliOut.includes('ops'));
  ok('installer CLI lists packs');

  // file watch: baseline -> new file fires -> no refire -> second file fires
  const inbox = path.join(wsDir, 'inbox'); fs.mkdirSync(inbox, { recursive: true });
  const runner = new WatchRunner(ws, [{ name: 'inquiry-inbox', type: 'file', target: 'inbox', brief: 'New inquiry from a parent — handle the first response', intervalMin: 5 }], { dataRoot: tmp });
  assert.strictEqual((await runner.tick()).length, 0);
  fs.writeFileSync(path.join(inbox, 'inquiry-1.txt'), 'parent asking about tours');
  const f1 = await runner.tick();
  assert.strictEqual(f1.length, 1); assert.strictEqual(f1[0].result, 'queued');
  assert.strictEqual((await runner.tick()).length, 0);
  const runner2 = new WatchRunner(ws, [{ name: 'inquiry-inbox', type: 'file', target: 'inbox', brief: 'New inquiry from a parent — handle the first response', intervalMin: 5 }], { dataRoot: tmp });
  assert.strictEqual((await runner2.tick()).length, 0);
  fs.writeFileSync(path.join(inbox, 'inquiry-2.txt'), 'another parent');
  assert.strictEqual((await runner2.tick()).length, 1);
  ok('file watch baselines silently, fires once per new file, and its state survives a fresh runner (no refire)');

  // http watch: change + contains
  let pageBody = 'tours: none scheduled';
  const srv = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end(pageBody); });
  await new Promise((r2) => srv.listen(0, '127.0.0.1', r2));
  const url = `http://127.0.0.1:${srv.address().port}/calendar`;
  const hws = new Workspace({ pack: loadPack(path.join(packsRoot, 'enrollment')), dataRoot: tmp, workspaceId: 'http-ws', env: {} });
  const hr = new WatchRunner(hws, [{ name: 'cal', type: 'http', target: url, brief: 'Tour schedule changed — check tours', intervalMin: 5 }], { dataRoot: tmp });
  assert.strictEqual((await hr.tick()).length, 0);
  pageBody = 'tours: Thu 10am added';
  assert.strictEqual((await hr.tick()).length, 1);
  assert.strictEqual((await hr.tick()).length, 0);
  srv.close();
  ok('http watch fires on content change only');

  // a watch is not a backdoor: its brief goes through Chief's plan check
  const badRunner = new WatchRunner(ws, [{ name: 'bad', type: 'file', target: 'inbox', brief: 'Just pay the deposit for them', intervalMin: 5 }], { dataRoot: tmp });
  await badRunner.tick(); // baseline pass (existing files are not "new")
  fs.writeFileSync(path.join(inbox, 'inquiry-3.txt'), 'trigger');
  const badTick = await badRunner.tick();
  assert.ok(badTick.some((f) => f.result === 'refused'));
  assert.strictEqual(ws.status().counters.neverExecuted, 0);
  ok('a watch brief asking to pay is refused like any other brief — watches are not a backdoor');

  console.log('\nAll ' + n + ' v0.4 tests passed.');
})().catch((e) => { console.error('✗ TEST FAILURE:', e.stack || e.message); process.exit(1); });
