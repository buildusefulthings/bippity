/**
 * telegram — native Telegram bot adapter (Bot API).
 * - Webhook update parsing: message (brief) + callback_query (buttons)
 * - sendMessage with inline keyboard for approvals; answerCallbackQuery
 * - Optional webhook secret header check (set via setWebhook secret_token)
 * Telegram has no request signature — the secret token header + owner
 * user-id gating are the access controls. Never expose the webhook
 * without TELEGRAM_WEBHOOK_SECRET set (or the relay secret in front).
 */
function parseUpdate(update) {
  if (!update || typeof update !== 'object') return null;
  if (update.message && update.message.text) {
    return { kind: 'brief', user: String(update.message.from && update.message.from.id), chatId: update.message.chat.id, text: String(update.message.text).trim() };
  }
  if (update.callback_query) {
    const q = update.callback_query;
    const parts = String(q.data || '').split(':'); // approve:<ws>:<approvalId>
    return { kind: 'callback', user: String(q.from && q.from.id), chatId: q.message && q.message.chat && q.message.chat.id, callbackId: q.id, action: parts[0], ws: parts[1], id: parts[2] };
  }
  return { kind: 'ignore' };
}
function approvalKeyboard(result, wsId) {
  const a = result.approval;
  return { inline_keyboard: [[
    { text: '✓ Approve & send', callback_data: `approve:${wsId}:${a.id}` },
    { text: '✕ Hold', callback_data: `hold:${wsId}:${a.id}` },
  ]] };
}
class TelegramBot {
  constructor(env = process.env, fetchFn = globalThis.fetch) {
    this.token = env.TELEGRAM_BOT_TOKEN || null;
    this.owner = env.TELEGRAM_OWNER_ID || env.BIPPITY_OWNER || null;
    this.webhookSecret = env.TELEGRAM_WEBHOOK_SECRET || null;
    this.fetch = fetchFn;
  }
  status() { return { channel: 'telegram', configured: !!this.token, ownerGated: !!this.owner, webhookSecret: !!this.webhookSecret, note: this.token ? 'Bot token set.' : 'Create a bot with @BotFather, set TELEGRAM_BOT_TOKEN, and point its webhook at /api/telegram/webhook (directly or via the relay).' }; }
  api(method) { return `https://api.telegram.org/bot${this.token}/${method}`; }
  async sendMessage({ chatId, text, replyMarkup }) {
    if (!this.token) return { ok: false, reason: 'not_configured' };
    const r = await this.fetch(this.api('sendMessage'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ chat_id: chatId, text, reply_markup: replyMarkup }) });
    const j = await r.json().catch(() => ({}));
    return { ok: !!j.ok, error: j.description || null };
  }
  async answerCallback(callbackId, text) {
    if (!this.token) return { ok: false, reason: 'not_configured' };
    const r = await this.fetch(this.api('answerCallbackQuery'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ callback_query_id: callbackId, text }) });
    const j = await r.json().catch(() => ({}));
    return { ok: !!j.ok };
  }
  /** Polling fallback for no-public-URL setups. Returns a stop function. */
  startPolling(onUpdate, intervalMs = 2500) {
    let offset = 0, stopped = false;
    const loop = async () => {
      while (!stopped) {
        try {
          const r = await this.fetch(this.api('getUpdates') + `?timeout=20&offset=${offset}`);
          const j = await r.json();
          for (const u of (j.result || [])) { offset = u.update_id + 1; await onUpdate(u); }
        } catch { await new Promise((res) => setTimeout(res, intervalMs)); }
      }
    };
    loop();
    return () => { stopped = true; };
  }
}
module.exports = { parseUpdate, approvalKeyboard, TelegramBot };
