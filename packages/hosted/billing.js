/**
 * billing — Stripe billing for the hosted tier (R3), zero dependencies.
 * Stripe's REST API is form-encoded; this is a thin client over fetch
 * (injectable for tests) + webhook signature verification + the event
 * handlers that keep tenant plans in sync:
 *   checkout.session.completed      -> link customer/subscription, plan on
 *   customer.subscription.updated   -> plan follows the price, status follows
 *   customer.subscription.deleted   -> back to free, status canceled
 *   invoice.payment_failed          -> status past_due (relay keeps serving
 *                                      until deletion; dunning is Stripe's)
 * Price ids come from env (STRIPE_PRICE_PRO / STRIPE_PRICE_MAX) so the
 * same code runs against test and live mode. No key = not_configured,
 * and every surface says so honestly.
 */
const crypto = require('crypto');

function verifyStripeSignature({ secret, header, rawBody, toleranceSec = 300, nowSec = Math.floor(Date.now() / 1000) }) {
  if (!secret || !header) return false;
  const parts = Object.fromEntries(String(header).split(',').map((kv) => kv.split('=').map((s) => s.trim())));
  const t = Number(parts.t); const v1 = parts.v1;
  if (!t || !v1 || Math.abs(nowSec - t) > toleranceSec) return false;
  const mine = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  try { return crypto.timingSafeEqual(Buffer.from(mine), Buffer.from(v1)); } catch { return false; }
}
const form = (obj) => new URLSearchParams(Object.entries(obj).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => [k, String(v)])).toString();

class BillingService {
  constructor(env = process.env, fetchFn = globalThis.fetch, registry = null) {
    this.key = env.STRIPE_SECRET_KEY || null;
    this.webhookSecret = env.STRIPE_WEBHOOK_SECRET || null;
    this.prices = { pro: env.STRIPE_PRICE_PRO || null, max: env.STRIPE_PRICE_MAX || null };
    this.fetch = fetchFn;
    this.registry = registry;
  }
  status() { return { configured: !!this.key, webhook: !!this.webhookSecret, prices: { pro: !!this.prices.pro, max: !!this.prices.max }, note: this.key ? 'Stripe key set.' : 'Set STRIPE_SECRET_KEY + STRIPE_PRICE_PRO/MAX (+ STRIPE_WEBHOOK_SECRET for webhooks) to enable billing.' }; }
  planForPrice(priceId) { return Object.entries(this.prices).find(([, v]) => v && v === priceId)?.[0] || null; }
  async api(pathName, params) {
    if (!this.key) throw new Error('stripe not configured');
    const r = await this.fetch('https://api.stripe.com/v1/' + pathName, { method: 'POST', headers: { authorization: 'Bearer ' + this.key, 'content-type': 'application/x-www-form-urlencoded' }, body: form(params) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error('stripe: ' + ((j.error && j.error.message) || r.status));
    return j;
  }
  async createCheckout({ tenant, plan, successUrl, cancelUrl }) {
    const price = this.prices[plan];
    if (!price) throw new Error(`no Stripe price configured for plan "${plan}"`);
    const s = await this.api('checkout/sessions', {
      mode: 'subscription', success_url: successUrl, cancel_url: cancelUrl,
      'line_items[0][price]': price, 'line_items[0][quantity]': 1,
      client_reference_id: tenant.id, 'metadata[tenant]': tenant.id,
      ...(tenant.billing && tenant.billing.customerId ? { customer: tenant.billing.customerId } : {}),
    });
    return { id: s.id, url: s.url };
  }
  async createPortal({ tenant, returnUrl }) {
    if (!tenant.billing || !tenant.billing.customerId) throw new Error('tenant has no Stripe customer yet');
    const s = await this.api('billing_portal/sessions', { customer: tenant.billing.customerId, return_url: returnUrl });
    return { id: s.id, url: s.url };
  }
  /** Apply a Stripe webhook event to the registry. Returns what changed. */
  handleEvent(event) {
    if (!this.registry) throw new Error('billing has no registry');
    const obj = event.data && event.data.object || {};
    if (event.type === 'checkout.session.completed') {
      const tenantId = obj.client_reference_id || (obj.metadata && obj.metadata.tenant);
      const t = tenantId && this.registry.byId(tenantId);
      if (!t) return { handled: false, reason: 'unknown tenant' };
      this.registry.setBilling(t.id, { customerId: obj.customer, subscriptionId: obj.subscription, status: 'active' });
      return { handled: true, tenant: t.id, change: 'linked' };
    }
    if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.created') {
      const t = this.registry.byStripeCustomer(obj.customer);
      if (!t) return { handled: false, reason: 'unknown customer' };
      const priceId = obj.items && obj.items.data && obj.items.data[0] && obj.items.data[0].price && obj.items.data[0].price.id;
      const plan = this.planForPrice(priceId);
      this.registry.setBilling(t.id, { subscriptionId: obj.id, ...(plan ? { plan } : {}), status: obj.status === 'active' || obj.status === 'trialing' ? 'active' : t.status });
      return { handled: true, tenant: t.id, change: 'subscription ' + obj.status, plan: plan || t.plan };
    }
    if (event.type === 'customer.subscription.deleted') {
      const t = this.registry.byStripeCustomer(obj.customer);
      if (!t) return { handled: false, reason: 'unknown customer' };
      this.registry.setBilling(t.id, { plan: 'free', status: 'canceled', subscriptionId: null });
      return { handled: true, tenant: t.id, change: 'canceled -> free' };
    }
    if (event.type === 'invoice.payment_failed') {
      const t = this.registry.byStripeCustomer(obj.customer);
      if (!t) return { handled: false, reason: 'unknown customer' };
      this.registry.setBilling(t.id, { status: 'past_due' });
      return { handled: true, tenant: t.id, change: 'past_due' };
    }
    return { handled: false, reason: 'unhandled type ' + event.type };
  }
}
module.exports = { BillingService, verifyStripeSignature };
