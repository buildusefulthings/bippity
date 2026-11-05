/**
 * metering — hosted usage events + plan-limit checks (R2 metering, R3-ready).
 * Append-only JSONL of COUNT-ONLY events: {tenant, kind, n, at}. Kinds:
 * brief, approval, delivery, model_tokens. No message bodies, ever —
 * usage is billing data, not surveillance. Aggregates are computed
 * per tenant per month for plan enforcement (PLANS in tenants.js).
 */
const fs = require('fs');
const path = require('path');
const { PLANS } = require('./tenants');

class UsageMeter {
  constructor(dataRoot) {
    this.file = path.join(dataRoot, 'hosted', 'usage.jsonl');
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
  }
  record(tenantId, kind, n = 1) {
    fs.appendFileSync(this.file, JSON.stringify({ tenant: tenantId, kind, n, at: new Date().toISOString() }) + '\n');
  }
  events(tenantId = null) {
    if (!fs.existsSync(this.file)) return [];
    return fs.readFileSync(this.file, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean).filter((e) => !tenantId || e.tenant === tenantId);
  }
  summary(tenantId, month = new Date().toISOString().slice(0, 7)) {
    const s = { tenant: tenantId, month, briefs: 0, approvals: 0, deliveries: 0, modelTokens: 0 };
    for (const e of this.events(tenantId)) {
      if (!e.at.startsWith(month)) continue;
      if (e.kind === 'brief') s.briefs += e.n;
      else if (e.kind === 'approval') s.approvals += e.n;
      else if (e.kind === 'delivery') s.deliveries += e.n;
      else if (e.kind === 'model_tokens') s.modelTokens += e.n;
    }
    return s;
  }
  /** True when one more brief fits the tenant's plan this month. */
  briefAllowed(tenant) {
    const lim = (PLANS[tenant.plan] || PLANS.free).briefsPerMonth;
    return { allowed: this.summary(tenant.id).briefs < lim, limit: lim, used: this.summary(tenant.id).briefs };
  }
}
module.exports = { UsageMeter };
