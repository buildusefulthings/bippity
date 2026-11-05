/**
 * slack — native Slack bot adapter.
 * - Request signature verification (v0 HMAC-SHA256, 5-minute window)
 * - Events API: url_verification + app_mention/message parsing
 * - Slash command + Block Kit interaction (approve/hold buttons) parsing
 * - Replies via chat.postMessage (fetch injectable for tests)
 * Signature verification happens on the RAW body — the server must not
 * JSON-roundtrip the payload before calling verifySignature.
 */
const crypto = require('crypto');

function verifySignature({ signingSecret, timestamp, rawBody, signature, nowSec = Math.floor(Date.now() / 1000) }) {
  if (!signingSecret || !timestamp || !signature) return false;
  if (Math.abs(nowSec - Number(timestamp)) > 300) return false; // replay window
  const base = `v0:${timestamp}:${rawBody}`;
  const mine = 'v0=' + crypto.createHmac('sha256', signingSecret).update(base).digest('hex');
  try { return crypto.timingSafeEqual(Buffer.from(mine), Buffer.from(signature)); } catch { return false; }
}
function parseEvent(payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (payload.type === 'url_verification') return { kind: 'challenge', challenge: payload.challenge };
  if (payload.type === 'event_callback' && payload.event) {
    const e = payload.event;
    if (e.bot_id || e.subtype === 'bot_message') return { kind: 'ignore' };
    if (e.type === 'app_mention' || e.type === 'message') {
      const text = String(e.text || '').replace(/<@[A-Z0-9]+>/g, '').trim();
      return { kind: 'brief', user: e.user, channel: e.channel, text, threadTs: e.thread_ts || e.ts };
    }
  }
  return { kind: 'ignore' };
}
function approvalBlocks(result, wsId) {
  const a = result.approval;
  return [
    { type: 'section', text: { type: 'mrkdwn', text: `*${a.bot}* — ${a.title}\n${a.body}` } },
    { type: 'actions', elements: [
      { type: 'button', style: 'primary', text: { type: 'plain_text', text: '✓ Approve & send' }, action_id: 'bippity_approve', value: JSON.stringify({ ws: wsId, id: a.id }) },
      { type: 'button', style: 'danger', text: { type: 'plain_text', text: '✕ Hold' }, action_id: 'bippity_hold', value: JSON.stringify({ ws: wsId, id: a.id }) },
    ] },
  ];
}
function parseInteraction(formPayloadJson) {
  const p = typeof formPayloadJson === 'string' ? JSON.parse(formPayloadJson) : formPayloadJson;
  if (!p || p.type !== 'block_actions' || !p.actions || !p.actions[0]) return null;
  const act = p.actions[0];
  let v = {}; try { v = JSON.parse(act.value || '{}'); } catch { /* keep empty */ }
  return { action: act.action_id === 'bippity_approve' ? 'approve' : act.action_id === 'bippity_hold' ? 'hold' : null, ws: v.ws, id: v.id, user: p.user && p.user.id, channel: p.channel && p.channel.id, responseUrl: p.response_url };
}
class SlackBot {
  constructor(env = process.env, fetchFn = globalThis.fetch) {
    this.token = env.SLACK_BOT_TOKEN || null;
    this.signingSecret = env.SLACK_SIGNING_SECRET || null;
    this.owner = env.SLACK_OWNER_ID || env.BIPPITY_OWNER || null;
    this.fetch = fetchFn;
  }
  status() { return { channel: 'slack', configured: !!this.token, signing: !!this.signingSecret, ownerGated: !!this.owner, note: this.token ? 'Bot token set.' : 'Set SLACK_BOT_TOKEN + SLACK_SIGNING_SECRET; subscribe to app_mention/message events, point the Event Subscription URL at /api/slack/events (directly or via the relay).' }; }
  async sendMessage({ channel, text, blocks, threadTs }) {
    if (!this.token) return { ok: false, reason: 'not_configured' };
    const r = await this.fetch('https://slack.com/api/chat.postMessage', { method: 'POST', headers: { authorization: 'Bearer ' + this.token, 'content-type': 'application/json' }, body: JSON.stringify({ channel, text, blocks, thread_ts: threadTs }) });
    const j = await r.json().catch(() => ({}));
    return { ok: !!j.ok, error: j.error || null };
  }
}
module.exports = { verifySignature, parseEvent, parseInteraction, approvalBlocks, SlackBot };
