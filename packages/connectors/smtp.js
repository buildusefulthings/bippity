/**
 * smtp — a minimal, dependency-free SMTP client (RFC 5321 subset).
 * Supports: plain connections (local relays / test servers), AUTH LOGIN,
 * and implicit TLS (port 465 style, via `secure: true`). STARTTLS is not
 * implemented — use implicit TLS or a local relay for production paths,
 * or the AgentMail/Composio transports.
 *
 * send({ from, to, subject, text }) -> { ok, code, response }
 * Throws only on socket errors; SMTP rejections return ok:false.
 */
const net = require('net');
const tls = require('tls');

function session(socket) {
  let buf = '';
  const waiters = [];
  socket.on('data', (d) => {
    buf += d.toString('utf8');
    // a reply ends when a line arrives as "NNN " (not "NNN-")
    const lines = buf.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (/^\d{3} /.test(lines[i])) {
        const reply = { code: Number(lines[i].slice(0, 3)), text: lines.slice(0, i + 1).join('\n') };
        buf = lines.slice(i + 1).join('\n');
        const w = waiters.shift(); if (w) w(reply);
        break;
      }
    }
  });
  return {
    reply: () => new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('SMTP reply timeout')), 15000); waiters.push((r) => { clearTimeout(t); res(r); }); }),
    write: (s) => socket.write(s),
  };
}

async function sendMail({ host, port = 25, secure = false, user = null, pass = null, from, to, subject, text, timeoutMs = 20000 }) {
  if (!host || !from || !to) return { ok: false, reason: 'missing host/from/to' };
  const socket = secure
    ? tls.connect({ host, port, servername: host, timeout: timeoutMs })
    : net.connect({ host, port, timeout: timeoutMs });
  await new Promise((res, rej) => { socket.once(secure ? 'secureConnect' : 'connect', res); socket.once('error', rej); });
  const s = session(socket);
  const expect = async (codes, what) => { const r = await s.reply(); if (!codes.includes(r.code)) throw new Error(`SMTP ${what} rejected: ${r.code} ${r.text}`); return r; };
  const cmd = async (line, codes, what) => { s.write(line + '\r\n'); return expect(codes, what); };
  try {
    await expect([220], 'greeting');
    await cmd(`EHLO bippity.local`, [250], 'EHLO');
    if (user && pass) {
      await cmd('AUTH LOGIN', [334], 'AUTH');
      await cmd(Buffer.from(user).toString('base64'), [334], 'AUTH user');
      await cmd(Buffer.from(pass).toString('base64'), [235], 'AUTH pass');
    }
    await cmd(`MAIL FROM:<${from}>`, [250], 'MAIL FROM');
    await cmd(`RCPT TO:<${to}>`, [250, 251], 'RCPT TO');
    await cmd('DATA', [354], 'DATA');
    const msg = `From: ${from}\r\nTo: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${String(text).replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..')}\r\n.`;
    const done = await cmd(msg, [250], 'message body');
    await cmd('QUIT', [221], 'QUIT').catch(() => {});
    socket.end();
    return { ok: true, code: done.code, response: done.text };
  } catch (e) {
    try { socket.destroy(); } catch { /* noop */ }
    return { ok: false, reason: e.message };
  }
}

function smtpFromEnv(env = process.env) {
  if (!env.SMTP_HOST) return null;
  return { host: env.SMTP_HOST, port: Number(env.SMTP_PORT || 25), secure: env.SMTP_SECURE === '1', user: env.SMTP_USER || null, pass: env.SMTP_PASS || null, from: env.SMTP_FROM || env.SMTP_USER || 'bippity@localhost' };
}
module.exports = { sendMail, smtpFromEnv };
