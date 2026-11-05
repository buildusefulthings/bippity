/**
 * connections — services connected from the UI instead of .env files (v0.17).
 * Values live in .data/connections.json on this machine only. The API
 * never returns a stored secret in full — status shows a masked tail.
 * At boot the server overlays these onto process.env (after .env.local),
 * and on save it re-applies them to live workspaces (models + delivery
 * take effect immediately; chat bots apply on restart, and say so).
 */
const fs = require('fs');
const path = require('path');

const SERVICES = [
  { id: 'openai', name: 'OpenAI', icon: '🧠', applies: 'live', blurb: 'Powers bots whose model is OpenAI.', fields: [{ key: 'OPENAI_API_KEY', label: 'API key', secret: true, placeholder: 'sk-…' }] },
  { id: 'anthropic', name: 'Claude (Anthropic)', icon: '🧡', applies: 'live', blurb: 'Powers bots whose model is Claude — the default for most packs.', fields: [{ key: 'ANTHROPIC_API_KEY', label: 'API key', secret: true, placeholder: 'sk-ant-…' }] },
  { id: 'xai', name: 'Grok (xAI)', icon: '✖️', applies: 'live', blurb: 'Powers bots whose model is Grok.', fields: [{ key: 'XAI_API_KEY', label: 'API key', secret: true, placeholder: 'xai-…' }] },
  { id: 'ollama', name: 'Ollama (local models)', icon: '🦙', applies: 'live', blurb: 'Free local models on this machine or your server. No key needed.', fields: [{ key: 'OLLAMA_HOST', label: 'Host URL', placeholder: 'http://localhost:11434' }] },
  { id: 'slack', name: 'Slack', icon: '💬', applies: 'restart', blurb: 'Brief your team and tap Approve from Slack. Needs a Slack app with a bot token.', fields: [{ key: 'SLACK_BOT_TOKEN', label: 'Bot token', secret: true, placeholder: 'xoxb-…' }, { key: 'SLACK_SIGNING_SECRET', label: 'Signing secret', secret: true }] },
  { id: 'telegram', name: 'Telegram', icon: '✈️', applies: 'restart', blurb: 'Brief and approve from Telegram. Create a bot with @BotFather.', fields: [{ key: 'TELEGRAM_BOT_TOKEN', label: 'Bot token', secret: true }, { key: 'TELEGRAM_WEBHOOK_SECRET', label: 'Webhook secret (optional)', secret: true }] },
  { id: 'smtp', name: 'Email sending (SMTP)', icon: '✉️', applies: 'live', blurb: 'How approved emails actually send. For Gmail: host smtp.gmail.com, port 465, secure on, and an App Password as the password.', fields: [{ key: 'SMTP_HOST', label: 'Host', placeholder: 'smtp.gmail.com' }, { key: 'SMTP_PORT', label: 'Port', placeholder: '465' }, { key: 'SMTP_USER', label: 'Username / email' }, { key: 'SMTP_PASS', label: 'Password / App Password', secret: true }, { key: 'SMTP_FROM', label: 'From address' }] },
  { id: 'agentmail', name: 'AgentMail', icon: '📬', applies: 'live', blurb: 'Gives bots their own inbox for receiving and sending mail.', fields: [{ key: 'AGENTMAIL_API_KEY', label: 'API key', secret: true }, { key: 'AGENTMAIL_INBOX_ID', label: 'Inbox ID' }] },
  { id: 'composio', name: 'Composio', icon: '🧩', applies: 'live', blurb: 'One key, many app actions (Gmail, Sheets, CRMs) for your bots.', fields: [{ key: 'COMPOSIO_API_KEY', label: 'API key', secret: true }] },
  { id: 'twilio', name: 'Text messages (Twilio)', icon: '📱', applies: 'live', blurb: 'Approved texts send via Twilio, from your own number.', fields: [{ key: 'TWILIO_ACCOUNT_SID', label: 'Account SID' }, { key: 'TWILIO_AUTH_TOKEN', label: 'Auth token', secret: true }, { key: 'TWILIO_FROM', label: 'From number', placeholder: '+1…' }] },
  { id: 'delivery', name: 'Delivery extras', icon: '🚀', applies: 'live', blurb: 'A webhook that receives every approved send, and a test inbox for Practice-mode trials.', fields: [{ key: 'BIPPITY_WEBHOOK_URL', label: 'Webhook URL', placeholder: 'https://…' }, { key: 'BIPPITY_TEST_RECIPIENT', label: 'Test recipient email' }] },
];
const BY_ID = Object.fromEntries(SERVICES.map((s) => [s.id, s]));
const ALL_KEYS = new Set(SERVICES.flatMap((s) => s.fields.map((f) => f.key)));

class ConnectionsStore {
  constructor(dataRoot) { this.file = path.join(dataRoot, 'connections.json'); }
  read() { try { return JSON.parse(fs.readFileSync(this.file, 'utf8')).values || {}; } catch { return {}; } }
  write(values) { fs.mkdirSync(path.dirname(this.file), { recursive: true }); fs.writeFileSync(this.file, JSON.stringify({ values }, null, 2)); }
  overlay(env) { const v = this.read(); for (const [k, val] of Object.entries(v)) if (val) env[k] = val; return env; }
  set(serviceId, fields) {
    const svc = BY_ID[serviceId]; if (!svc) throw new Error('unknown service: ' + serviceId);
    const values = this.read();
    for (const f of svc.fields) {
      if (fields && fields[f.key] !== undefined && String(fields[f.key]).trim() !== '') values[f.key] = String(fields[f.key]).trim().slice(0, 500);
    }
    this.write(values);
    return values;
  }
  disconnect(serviceId) {
    const svc = BY_ID[serviceId]; if (!svc) throw new Error('unknown service: ' + serviceId);
    const values = this.read();
    for (const f of svc.fields) delete values[f.key];
    this.write(values);
    return values;
  }
  status(env) {
    const stored = this.read();
    return SERVICES.map((svc) => {
      let configured = false; let source = null; const masked = {};
      for (const f of svc.fields) {
        const fromUi = stored[f.key]; const fromEnv = env[f.key];
        const val = fromUi || fromEnv;
        if (val) { configured = true; source = fromUi ? 'ui' : 'env'; masked[f.key] = f.secret ? '••••' + String(val).slice(-4) : String(val); }
      }
      // A service counts as configured when its primary (first) field is set
      const primary = svc.fields[0].key;
      configured = !!(stored[primary] || env[primary]);
      return { id: svc.id, name: svc.name, icon: svc.icon, blurb: svc.blurb, applies: svc.applies, fields: svc.fields, configured, source: configured ? (stored[primary] ? 'ui' : 'env') : null, masked };
    });
  }
}
module.exports = { ConnectionsStore, SERVICES, ALL_KEYS };
