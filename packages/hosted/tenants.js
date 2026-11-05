/**
 * tenants — hosted tenant registry (R2).
 * File-backed (tenants.json under the hosted data root). A tenant is a
 * customer of the hosted tier: one or more workspaces, a plan, a public
 * relay token (in webhook URLs), and a private instance secret (relay ->
 * instance leg). Tokens are random; rotation kills old webhook URLs.
 * The registry stores NO platform signing secrets and NO model keys —
 * those live in the vault (vault.js), encrypted.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PLANS = {
  free: { workspaces: 1, briefsPerMonth: 200, priceCents: 0, label: 'Free (self-host support)' },
  pro: { workspaces: 5, briefsPerMonth: 5000, priceCents: 2000, label: 'Pro $20/mo' },
  max: { workspaces: 25, briefsPerMonth: 50000, priceCents: 20000, label: 'Max $200/mo' },
};
const token = () => crypto.randomBytes(18).toString('base64url');

class TenantRegistry {
  constructor(dataRoot) {
    this.dir = path.join(dataRoot, 'hosted');
    this.file = path.join(this.dir, 'tenants.json');
    fs.mkdirSync(this.dir, { recursive: true });
    this.tenants = [];
    if (fs.existsSync(this.file)) { try { this.tenants = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { this.tenants = []; } }
  }
  _save() { fs.writeFileSync(this.file, JSON.stringify(this.tenants, null, 2)); }
  create({ name, plan = 'pro', targetUrl, workspaces = [], status = 'active', email = null }) {
    if (!PLANS[plan]) throw new Error(`unknown plan "${plan}" (free|pro|max)`);
    const t = { id: 't_' + crypto.randomBytes(4).toString('hex'), name: String(name || 'tenant'), email, plan, targetUrl: String(targetUrl || ''), workspaces: [...workspaces], relayToken: token(), instanceSecret: token(), createdAt: new Date().toISOString(), status };
    this.tenants.push(t); this._save(); return t;
  }
  byToken(relayToken) { return this.tenants.find((t) => t.relayToken === relayToken && (t.status === 'active' || t.status === 'past_due')) || null; }
  byId(id) { return this.tenants.find((t) => t.id === id) || null; }
  rotate(id) { const t = this.byId(id); if (!t) return null; t.relayToken = token(); t.instanceSecret = token(); this._save(); return t; }
  setStatus(id, status) { const t = this.byId(id); if (!t) return null; t.status = status; this._save(); return t; }
  addWorkspace(id, ws) { const t = this.byId(id); if (!t) return null; const lim = PLANS[t.plan].workspaces; if (!t.workspaces.includes(ws)) { if (t.workspaces.length >= lim) throw new Error(`plan "${t.plan}" allows ${lim} workspace(s)`); t.workspaces.push(ws); this._save(); } return t; }
  setBilling(id, fields) { const t = this.byId(id); if (!t) return null; t.billing = { ...(t.billing || {}), ...fields }; if (fields.plan) t.plan = fields.plan; if (fields.status) t.status = fields.status; this._save(); return t; }
  byStripeCustomer(customerId) { return this.tenants.find((t) => t.billing && t.billing.customerId === customerId) || null; }
  byWorkspace(ws) { return this.tenants.find((t) => t.workspaces.includes(ws)) || null; }
  list() { return this.tenants.map((t) => ({ ...t, relayToken: t.relayToken.slice(0, 6) + '…', instanceSecret: '…' })); }
  webhookUrl(base, channel, tenant, workspace) { return `${String(base).replace(/\/$/, '')}/hook/${channel}/${workspace}/${tenant.relayToken}`; }
}
module.exports = { TenantRegistry, PLANS };
