/**
 * bippity relay — public webhook front door (docs/HOSTED_RELAY.md).
 *
 * Two modes:
 * - Single-tenant (v0.5): RELAY_SECRET + BIPPITY_TARGET_URL.
 *     POST /hook/<slack|telegram>/<workspace>/<RELAY_SECRET>
 * - Hosted (v0.6, R2): TENANTS_FILE=<path to tenants.json> (+ optional
 *   USAGE_FILE for plan checks). The path token is the TENANT's relay
 *   token; the relay resolves the tenant, enforces a per-tenant rate
 *   limit and the plan's monthly brief cap, then forwards to the
 *   tenant's targetUrl with that tenant's instanceSecret.
 *
 * Either way the relay is a dumb pipe for payload content: platform
 * verification headers pass through untouched and signatures are
 * verified END-TO-END by the instance. Bodies capped at 1 MB.
 * GET /health and GET /metrics expose counts only — never bodies.
 * Env: RELAY_PORT (3220), RELAY_SECRET, BIPPITY_TARGET_URL,
 *      TENANTS_FILE, USAGE_FILE, RELAY_RATE_PER_MIN (default 60).
 */
const http = require('http');
const fs = require('fs');
const crypto = require('crypto');

const PORT = Number(process.env.RELAY_PORT || 3220);
const SECRET = process.env.RELAY_SECRET || '';
const TARGET = (process.env.BIPPITY_TARGET_URL || 'http://127.0.0.1:3211').replace(/\/$/, '');
const RATE = Number(process.env.RELAY_RATE_PER_MIN || 60);
const PLAN_BRIEFS = { free: 200, pro: 5000, max: 50000 };

const metrics = { startedAt: new Date().toISOString(), forwarded: 0, rejected: 0, rateLimited: 0, overPlan: 0, byTenant: {} };
const buckets = new Map(); // key -> {windowStart, count}
function rateOk(key) {
  const now = Date.now();
  const b = buckets.get(key) || { windowStart: now, count: 0 };
  if (now - b.windowStart > 60000) { b.windowStart = now; b.count = 0; }
  b.count++; buckets.set(key, b);
  return b.count <= RATE;
}
function loadTenants() {
  if (!process.env.TENANTS_FILE) return null;
  try { return JSON.parse(fs.readFileSync(process.env.TENANTS_FILE, 'utf8')); } catch { return []; }
}
function appendUsage(tenantId) {
  if (!process.env.USAGE_FILE) return;
  try { fs.mkdirSync(require('path').dirname(process.env.USAGE_FILE), { recursive: true }); fs.appendFileSync(process.env.USAGE_FILE, JSON.stringify({ tenant: tenantId, kind: 'brief', n: 1, at: new Date().toISOString() }) + '\n'); } catch { /* metering never blocks traffic */ }
}
function monthBriefs(tenantId) {
  if (!process.env.USAGE_FILE || !fs.existsSync(process.env.USAGE_FILE)) return 0;
  const month = new Date().toISOString().slice(0, 7);
  let n = 0;
  for (const line of fs.readFileSync(process.env.USAGE_FILE, 'utf8').split('\n')) {
    if (!line) continue;
    try { const e = JSON.parse(line); if (e.tenant === tenantId && e.kind === 'brief' && e.at.startsWith(month)) n += e.n; } catch { /* skip */ }
  }
  return n;
}
const eq = (a, b) => { try { return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b)); } catch { return false; } };

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const json = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
  if (req.method === 'GET' && url.pathname === '/health') return json(200, { ok: true, mode: process.env.TENANTS_FILE ? 'hosted' : 'single', tenants: process.env.TENANTS_FILE ? (loadTenants() || []).length : undefined, target: process.env.TENANTS_FILE ? undefined : TARGET, secretSet: !!SECRET });
  if (req.method === 'GET' && url.pathname === '/metrics') return json(200, metrics);
  const m = url.pathname.match(/^\/hook\/(slack|telegram)\/([a-z0-9_-]+)\/([A-Za-z0-9_-]+)$/i);
  if (req.method !== 'POST' || !m) { res.writeHead(404); return res.end('not found'); }
  const [, channel, workspace, pathToken] = m;

  let targetUrl, instanceSecret, tenantId = 'single';
  const tenants = loadTenants();
  if (tenants) {
    const t = tenants.find((x) => x.status === 'active' && eq(x.relayToken, pathToken));
    if (!t) { metrics.rejected++; res.writeHead(404); return res.end('unknown tenant token'); }
    if (!t.workspaces.includes(workspace)) { metrics.rejected++; res.writeHead(404); return res.end('workspace not on this tenant'); }
    const cap = PLAN_BRIEFS[t.plan] || PLAN_BRIEFS.free;
    if (monthBriefs(t.id) >= cap) { metrics.overPlan++; return json(402, { ok: false, error: `This workspace is over its ${t.plan} plan brief limit (${cap}/month). Upgrade the plan or wait for the monthly reset.` }); }
    targetUrl = t.targetUrl; instanceSecret = t.instanceSecret; tenantId = t.id;
  } else {
    if (!SECRET) { res.writeHead(503); return res.end('relay secret not configured'); }
    if (!eq(pathToken, SECRET)) { metrics.rejected++; res.writeHead(401); return res.end('bad relay token'); }
    targetUrl = TARGET; instanceSecret = SECRET;
  }
  if (!rateOk(tenantId)) { metrics.rateLimited++; return json(429, { ok: false, error: 'rate limited — slow down' }); }

  let size = 0; const chunks = [];
  req.on('data', (c) => { size += c.length; if (size > 1024 * 1024) { res.writeHead(413); res.end('too large'); req.destroy(); } else chunks.push(c); });
  req.on('end', async () => {
    try {
      const headers = { 'content-type': req.headers['content-type'] || 'application/json', 'x-bippity-relay-secret': instanceSecret, 'x-bippity-workspace': workspace, 'x-bippity-tenant': tenantId };
      for (const h of ['x-slack-request-timestamp', 'x-slack-signature', 'x-telegram-bot-api-secret-token']) if (req.headers[h]) headers[h] = req.headers[h];
      const r = await fetch(`${String(targetUrl).replace(/\/$/, '')}/api/relay/${channel}`, { method: 'POST', headers, body: Buffer.concat(chunks) });
      const text = await r.text();
      metrics.forwarded++; metrics.byTenant[tenantId] = (metrics.byTenant[tenantId] || 0) + 1;
      if (tenants) appendUsage(tenantId); // hosted mode: the relay meters what it forwards, so plan caps hold even before instances report
      res.writeHead(r.status, { 'content-type': r.headers.get('content-type') || 'application/json' });
      res.end(text);
    } catch (e) { res.writeHead(502); res.end(JSON.stringify({ ok: false, error: 'target unreachable: ' + e.message })); }
  });
});
server.listen(PORT, () => console.log(`bippity relay on :${PORT} (${process.env.TENANTS_FILE ? 'hosted, tenants=' + (loadTenants() || []).length : 'single → ' + TARGET})`));
