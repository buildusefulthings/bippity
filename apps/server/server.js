/**
 * bippity server — zero-dependency Node http server.
 *   node apps/server/server.js        (or: npm start)
 * Serves the live UI at / , the v0.1 simulation at /sim, and the API:
 *   GET  /api/status?ws=enrollment|ops
 *   POST /api/brief    { ws, text }          -> Chief plans + delegates
 *   POST /api/approve  { ws, id }            -> human releases an approval
 *   POST /api/hold     { ws, id }
 *   GET  /api/memory?ws=&bot=
 *   GET  /api/connectors
 *   POST /api/channel/:name { user, text }   -> channel ingress (owner-only work)
 * State persists under .data/. Shadow mode default: approved actions are
 * logged as sent, not transmitted through a real channel.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');

// --- tiny .env.local loader (no deps) ---
const envFile = path.join(ROOT, '.env.local');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

const { loadPack } = require(path.join(ROOT, 'packages/harness/persona-loader'));
const { Workspace } = require(path.join(ROOT, 'packages/harness/runtime'));
const { connectorStatus } = require(path.join(ROOT, 'packages/connectors/adapters'));
const { DeliveryService } = require(path.join(ROOT, 'packages/connectors/delivery'));
const { createSandbox } = require(path.join(ROOT, 'packages/computers/sandbox'));
const { ProxmoxDriver } = require(path.join(ROOT, 'packages/computers/proxmox'));
const { RoutineRunner } = require(path.join(ROOT, 'packages/channels/routines'));
const { WatchRunner } = require(path.join(ROOT, 'packages/channels/watches'));
const { listPacks, installPack, listInstalled } = require(path.join(ROOT, 'packages/harness/pack-installer'));
const delivery = new DeliveryService(process.env);
const proxmox = new ProxmoxDriver(process.env, { pollMs: 800 });

const DATA = path.join(ROOT, '.data');
const PACKS_ROOT = path.join(ROOT, 'bots/examples');
const workspaces = {};
const watchRunners = {};
function readJsonArray(file) { try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); return Array.isArray(j) ? j : []; } catch { return []; } }
function registerWorkspace(id, ws, seedDir) {
  workspaces[id] = ws;
  const wsDir = path.join(DATA, 'workspaces', id);
  const routines = readJsonArray(path.join(wsDir, 'routines.json')).length ? readJsonArray(path.join(wsDir, 'routines.json')) : (seedDir ? readJsonArray(path.join(seedDir, 'routines.json')) : []);
  if (routines.length) new RoutineRunner(ws, routines).start();
  const watches = readJsonArray(path.join(wsDir, 'watches.json')).length ? readJsonArray(path.join(wsDir, 'watches.json')) : (seedDir ? readJsonArray(path.join(seedDir, 'watches.json')) : []);
  if (watches.length) { watchRunners[id] = new WatchRunner(ws, watches, { dataRoot: DATA }).start(); }
  return ws;
}
for (const p of ['enrollment', 'ops']) {
  registerWorkspace(p, new Workspace({ pack: loadPack(path.join(PACKS_ROOT, p)), dataRoot: DATA }), path.join(PACKS_ROOT, p));
}
for (const m of listInstalled(DATA)) {
  if (workspaces[m.workspace]) continue;
  const packDir = path.join(DATA, 'workspaces', m.workspace, 'pack');
  if (fs.existsSync(path.join(packDir, 'pack.yaml'))) registerWorkspace(m.workspace, new Workspace({ pack: loadPack(packDir), dataRoot: DATA, workspaceId: m.workspace }), packDir);
}

function send(res, code, body, type = 'application/json') {
  const data = type === 'application/json' ? JSON.stringify(body) : body;
  res.writeHead(code, { 'content-type': type + '; charset=utf-8' }); res.end(data);
}
function body(req) { return new Promise((res) => { let b = ''; req.on('data', (c) => b += c); req.on('end', () => { try { res(JSON.parse(b || '{}')); } catch { res({}); } }); }); }
const wsOf = (q) => workspaces[q.ws] || workspaces.enrollment;

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const q = Object.fromEntries(u.searchParams);
  try {
    if (u.pathname === '/' || u.pathname === '/live') return send(res, 200, fs.readFileSync(path.join(ROOT, 'apps/web/live.html'), 'utf8'), 'text/html');
    if (u.pathname === '/sim') return send(res, 200, fs.readFileSync(path.join(ROOT, 'apps/web/index.html'), 'utf8'), 'text/html');
    if (u.pathname === '/api/status') return send(res, 200, wsOf(q).status());
    if (u.pathname === '/api/workspaces') return send(res, 200, { workspaces: Object.values(workspaces).map((w) => ({ id: w.id, pack: w.pack.id, name: w.pack.name, installed: !!listInstalled(DATA).find((m) => m.workspace === w.id) })) });
    if (u.pathname === '/api/packs') return send(res, 200, { available: listPacks(PACKS_ROOT), installed: listInstalled(DATA) });
    if (u.pathname === '/api/packs/install' && req.method === 'POST') { const b = await body(req); const packDir = path.join(PACKS_ROOT, String(b.pack || '')); const r = installPack({ packDir, dataRoot: DATA, workspaceName: b.name, vars: b.vars || {}, force: !!b.force }); if (!r.ok) return send(res, 400, r); registerWorkspace(r.workspace, new Workspace({ pack: loadPack(path.join(DATA, 'workspaces', r.workspace, 'pack')), dataRoot: DATA, workspaceId: r.workspace }), path.join(DATA, 'workspaces', r.workspace, 'pack')); return send(res, 200, { installed: r, status: workspaces[r.workspace].status() }); }
    if (u.pathname === '/api/watches') return send(res, 200, { watches: watchRunners[q.ws] ? watchRunners[q.ws].status() : [] });
    if (u.pathname === '/api/watches/tick' && req.method === 'POST') { const b = await body(req); const runner = watchRunners[b.ws]; if (!runner) return send(res, 200, { fired: [], note: 'no watches for this workspace' }); return send(res, 200, { fired: await runner.tick(), status: wsOf(b).status() }); }
    if (u.pathname === '/api/connectors') { const sb = await createSandbox({ dataRoot: DATA, preferred: process.env.BIPPITY_COMPUTER_DRIVER || 'docker' }); return send(res, 200, { connectors: connectorStatus(), delivery: delivery.status(), shadow: process.env.BIPPITY_SHADOW_MODE !== '0', sandbox: sb.constructor.name, sandboxFallback: sb.fallbackReason || null }); }
    if (u.pathname === '/api/proxmox') return send(res, 200, await proxmox.overview());
    if (u.pathname === '/api/sandbox/exec' && req.method === 'POST') { const b = await body(req); const sb = await createSandbox({ dataRoot: DATA, preferred: process.env.BIPPITY_COMPUTER_DRIVER || 'docker' }); if (sb.constructor.name === 'ProxmoxDriver') await sb.start(b.bot || 'chief'); return send(res, 200, await sb.exec(b.bot || 'chief', String(b.cmd || 'echo ok'))); }
    if (u.pathname === '/api/memory') { const w = wsOf(q); return send(res, 200, { bot: q.bot, memory: w.memory.load(w.id, q.bot || 'chief') }); }
    if (u.pathname === '/api/brief' && req.method === 'POST') { const b = await body(req); if (!b.text) return send(res, 400, { error: 'text required' }); return send(res, 200, await wsOf(b).brief(String(b.text), 'web')); }
    if (u.pathname === '/api/approve' && req.method === 'POST') { const b = await body(req); const a = await wsOf(b).approve(b.id); return a ? send(res, 200, { approved: a, delivery: a.delivery, status: wsOf(b).status() }) : send(res, 404, { error: 'no waiting approval with that id' }); }
    if (u.pathname === '/api/hold' && req.method === 'POST') { const b = await body(req); const a = wsOf(b).hold(b.id); return a ? send(res, 200, { held: a, status: wsOf(b).status() }) : send(res, 404, { error: 'no waiting approval with that id' }); }
    const ch = u.pathname.match(/^\/api\/channel\/(\w+)$/);
    if (ch && req.method === 'POST') {
      const b = await body(req);
      const owner = process.env.BIPPITY_OWNER || '';
      if (owner && b.user !== owner) return send(res, 200, { type: 'message-taken', message: `Thanks — I've taken a message for the workspace owner. Only they can assign work here.` });
      return send(res, 200, await wsOf(b).brief(String(b.text || ''), ch[1]));
    }
    return send(res, 404, { error: 'not found' });
  } catch (e) { return send(res, 500, { error: e.message }); }
});

const PORT = Number(process.env.BIPPITY_PORT || 3211);
if (require.main === module) server.listen(PORT, '127.0.0.1', () => console.log(`bippity live on http://127.0.0.1:${PORT}  (shadow=${process.env.BIPPITY_SHADOW_MODE !== '0'})`));
module.exports = { server, workspaces };
