/**
 * connectors — adapters behind a status() contract. An adapter with no
 * key reports `configured: false` and every call returns a clear
 * not_configured result instead of throwing or pretending.
 * Accounts are always owned by the workspace, never by bippity.
 */
class ComposioAdapter {
  constructor(env = process.env) { this.key = env.COMPOSIO_API_KEY || null; }
  status() { return { id: 'composio', configured: !!this.key, note: this.key ? 'Key present — app actions route via Composio.' : 'Set COMPOSIO_API_KEY to enable ~app connectors (Gmail, Calendar, Sheets...).' }; }
  async gmailSearch(query) { if (!this.key) return { ok: false, reason: 'not_configured', hint: 'Gmail via Composio needs COMPOSIO_API_KEY + a connected Gmail account in Composio.' }; return { ok: false, reason: 'live_call_not_wired_in_v0.2', query }; }
}
class AgentMailAdapter {
  constructor(env = process.env) { this.key = env.AGENTMAIL_API_KEY || null; }
  status() { return { id: 'agentmail', configured: !!this.key, note: this.key ? 'Key present — bots can own inboxes.' : 'Set AGENTMAIL_API_KEY to give bots their own email inboxes.' }; }
  async inbox(botId) { if (!this.key) return { ok: false, reason: 'not_configured' }; return { ok: false, reason: 'live_call_not_wired_in_v0.2', botId }; }
}
class AgentPhoneAdapter {
  constructor(env = process.env) { this.key = env.AGENTPHONE_API_KEY || null; }
  status() { return { id: 'agentphone', configured: !!this.key, note: this.key ? 'Key present — bots can own phone numbers.' : 'Set AGENTPHONE_API_KEY (or Twilio keys) for bot SMS/calls.' }; }
}
function connectorStatus(env = process.env) { return [new ComposioAdapter(env).status(), new AgentMailAdapter(env).status(), new AgentPhoneAdapter(env).status()]; }
module.exports = { ComposioAdapter, AgentMailAdapter, AgentPhoneAdapter, connectorStatus };
