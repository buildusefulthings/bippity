/**
 * delivery — turns an APPROVED action into a real outbound send, or an
 * honest record of why not. This is the only module allowed to transmit.
 *
 * Order of decision:
 *   1. shadow mode ON           -> { status: 'shadow_logged' } (nothing sent)
 *   2. a `deliver` target on the approval + a configured transport
 *                               -> real send via webhook / email / sms
 *   3. email actions need a recipient: approval.deliver.to, else
 *      BIPPITY_TEST_RECIPIENT   -> else { status: 'skipped_no_recipient' }
 *   4. no transport configured  -> { status: 'skipped_no_transport' }
 *
 * Transports (all real HTTP/SMTP calls; fakes are injected in tests):
 *   webhook    BIPPITY_WEBHOOK_URL  — POST JSON, works for any action
 *   smtp       SMTP_*               — real email via packages/connectors/smtp
 *   agentmail  AGENTMAIL_API_KEY    — bot inbox send API
 *   composio   COMPOSIO_API_KEY     — GMAIL_SEND_EMAIL tool execution
 *   twilio     TWILIO_*             — SMS for sms actions
 */
const { sendMail, smtpFromEnv } = require('./smtp');

class DeliveryService {
  constructor(env = process.env, inject = {}) {
    this.env = env;
    this.fetch = inject.fetch || globalThis.fetch;
    this.smtpSend = inject.smtpSend || sendMail;
    this.webhookUrl = env.BIPPITY_WEBHOOK_URL || null;
    this.testRecipient = env.BIPPITY_TEST_RECIPIENT || null;
    this.smtpCfg = smtpFromEnv(env);
    this.agentmailKey = env.AGENTMAIL_API_KEY || null;
    this.composioKey = env.COMPOSIO_API_KEY || null;
    this.composioAccount = env.COMPOSIO_CONNECTED_ACCOUNT_ID || null;
    this.twilio = env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN ? { sid: env.TWILIO_ACCOUNT_SID, token: env.TWILIO_AUTH_TOKEN, from: env.TWILIO_FROM || null } : null;
  }
  status() {
    return {
      webhook: !!this.webhookUrl, smtp: !!this.smtpCfg, agentmail: !!this.agentmailKey,
      composio: !!this.composioKey, twilio: !!this.twilio, testRecipient: !!this.testRecipient,
    };
  }
  async deliver(approval, { shadow }) {
    if (shadow) return { status: 'shadow_logged', note: 'Shadow mode: recorded as sent, nothing transmitted.' };
    const payload = { bot: approval.bot, action: approval.action, title: approval.title, body: approval.body, to: (approval.deliver && approval.deliver.to) || this.testRecipient || null, channel: (approval.deliver && approval.deliver.channel) || 'email' };
    // Webhook first: generic, configured explicitly, no recipient semantics.
    if (this.webhookUrl) {
      try {
        const r = await this.fetch(this.webhookUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'bippity.delivery', ...payload, at: new Date().toISOString() }) });
        if (r.ok) return { status: 'delivered', via: 'webhook', httpStatus: r.status };
        return { status: 'failed', via: 'webhook', httpStatus: r.status };
      } catch (e) { return { status: 'failed', via: 'webhook', reason: e.message }; }
    }
    if (payload.channel === 'sms') {
      if (!this.twilio) return { status: 'skipped_no_transport', channel: 'sms' };
      if (!payload.to) return { status: 'skipped_no_recipient', channel: 'sms' };
      try {
        const auth = Buffer.from(this.twilio.sid + ':' + this.twilio.token).toString('base64');
        const form = new URLSearchParams({ From: this.twilio.from || '', To: payload.to, Body: payload.body });
        const r = await this.fetch(`https://api.twilio.com/2010-04-01/Accounts/${this.twilio.sid}/Messages.json`, { method: 'POST', headers: { authorization: 'Basic ' + auth, 'content-type': 'application/x-www-form-urlencoded' }, body: form.toString() });
        return r.ok ? { status: 'delivered', via: 'twilio', httpStatus: r.status } : { status: 'failed', via: 'twilio', httpStatus: r.status };
      } catch (e) { return { status: 'failed', via: 'twilio', reason: e.message }; }
    }
    // email channel
    if (!payload.to) return { status: 'skipped_no_recipient', channel: 'email', hint: 'Set BIPPITY_TEST_RECIPIENT or add deliver.to to the action.' };
    if (this.smtpCfg) {
      const r = await this.smtpSend({ ...this.smtpCfg, to: payload.to, subject: payload.title, text: payload.body });
      return r.ok ? { status: 'delivered', via: 'smtp', code: r.code } : { status: 'failed', via: 'smtp', reason: r.reason };
    }
    if (this.agentmailKey) {
      try {
        const inbox = (approval.deliver && approval.deliver.inbox) || this.env.AGENTMAIL_INBOX_ID;
        if (!inbox) return { status: 'skipped_no_transport', channel: 'email', hint: 'AGENTMAIL_INBOX_ID not set.' };
        const r = await this.fetch(`https://api.agentmail.to/v0/inboxes/${inbox}/messages/send`, { method: 'POST', headers: { authorization: 'Bearer ' + this.agentmailKey, 'content-type': 'application/json' }, body: JSON.stringify({ to: payload.to, subject: payload.title, text: payload.body }) });
        return r.ok ? { status: 'delivered', via: 'agentmail', httpStatus: r.status } : { status: 'failed', via: 'agentmail', httpStatus: r.status };
      } catch (e) { return { status: 'failed', via: 'agentmail', reason: e.message }; }
    }
    if (this.composioKey) {
      try {
        const r = await this.fetch('https://backend.composio.dev/api/v3/tools/execute/GMAIL_SEND_EMAIL', { method: 'POST', headers: { 'x-api-key': this.composioKey, 'content-type': 'application/json' }, body: JSON.stringify({ connected_account_id: this.composioAccount, arguments: { recipient_email: payload.to, subject: payload.title, body: payload.body } }) });
        return r.ok ? { status: 'delivered', via: 'composio:gmail', httpStatus: r.status } : { status: 'failed', via: 'composio:gmail', httpStatus: r.status };
      } catch (e) { return { status: 'failed', via: 'composio:gmail', reason: e.message }; }
    }
    return { status: 'skipped_no_transport', channel: 'email', hint: 'Configure SMTP_*, AGENTMAIL_API_KEY, COMPOSIO_API_KEY, or BIPPITY_WEBHOOK_URL.' };
  }
}
module.exports = { DeliveryService };
