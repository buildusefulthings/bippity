/**
 * bippity relay — the public front door for webhooks (design: docs/HOSTED_RELAY.md).
 * Slack/Telegram servers can't reach a home machine, so this tiny
 * zero-dependency forwarder runs anywhere public (a $5 VPS, Fly, Render)
 * and relays webhook traffic to a self-hosted instance.
 *
 * The webhook URL you paste into Slack/Telegram carries the token:
 *   POST https://<relay>/hook/<slack|telegram>/<workspace>/<token>
 * Platforms won't send custom auth headers, so the token lives in the
 * path (the standard pattern — same idea as the Telegram secret_token).
 * The relay checks it, then forwards to <TARGET>/api/relay/<channel>
 * with the platform's own verification headers untouched, so Slack
 * signatures / Telegram secrets are verified END-TO-END by the local
 * instance. Bodies capped at 1 MB; everything else returns 404.
 * Env: RELAY_PORT (3220), RELAY_SECRET (the token), BIPPITY_TARGET_URL.
 */
const http = require('http');
const crypto = require('crypto');

const SECRET = process.env.RELAY_SECRET || '';
const TARGET = (process.env.BIPPITY_TARGET_URL || 'http://127.0.0.1:3211').replace(/\/$/, '');
const PORT = Number(process.env.RELAY_PORT || 3220);

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'GET' && url.pathname === '/health') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ ok: true, target: TARGET, secretSet: !!SECRET })); }
  const m = url.pathname.match(/^\/hook\/(slack|telegram)\/([a-z0-9_-]+)\/([A-Za-z0-9_-]+)$/i);
  if (req.method !== 'POST' || !m) { res.writeHead(404); return res.end('not found'); }
  if (!SECRET) { res.writeHead(503); return res.end('relay secret not configured'); }
  try { if (!crypto.timingSafeEqual(Buffer.from(m[3]), Buffer.from(SECRET))) throw 0; }
  catch { res.writeHead(401); return res.end('bad relay token'); }
  let size = 0; const chunks = [];
  req.on('data', (c) => { size += c.length; if (size > 1024 * 1024) { res.writeHead(413); res.end('too large'); req.destroy(); } else chunks.push(c); });
  req.on('end', async () => {
    const raw = Buffer.concat(chunks);
    try {
      const headers = { 'content-type': req.headers['content-type'] || 'application/json', 'x-bippity-relay-secret': SECRET, 'x-bippity-workspace': m[2] };
      for (const h of ['x-slack-request-timestamp', 'x-slack-signature', 'x-telegram-bot-api-secret-token']) if (req.headers[h]) headers[h] = req.headers[h];
      const r = await fetch(`${TARGET}/api/relay/${m[1]}`, { method: 'POST', headers, body: raw });
      const text = await r.text();
      res.writeHead(r.status, { 'content-type': r.headers.get('content-type') || 'application/json' });
      res.end(text);
    } catch (e) { res.writeHead(502); res.end(JSON.stringify({ ok: false, error: 'target unreachable: ' + e.message })); }
  });
});
server.listen(PORT, () => console.log(`bippity relay on :${PORT} → ${TARGET} (secret ${SECRET ? 'set' : 'MISSING'})`));
