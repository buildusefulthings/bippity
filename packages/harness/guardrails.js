/**
 * bippity harness — guardrail engine.
 * Enforced in code, not in prompts. A model proposing an action does not
 * authorize it; this module decides what may run, what must wait for a
 * human, and what never runs.
 *
 * Tiers:
 *   auto    — run immediately (reads, lookups, internal drafts)
 *   approve — queue for a human tap in the Approvals inbox
 *   never   — refused, always. NEVER_CLASSES cannot be promoted by any
 *             bot config, workspace config, or runtime flag.
 */

// Classes no configuration may ever move out of `never`.
const NEVER_CLASSES = Object.freeze([
  'pay', 'pay_invoice', 'sign_contract', 'commit_price_or_terms',
  'commit_ship_date', 'promise_seat', 'change_tuition', 'delete_data',
  'share_credentials',
]);

class GuardrailEngine {
  /** @param {Object<string, {auto?:string[], approve?:string[], never?:string[]}>} botTiers */
  constructor(botTiers = {}) {
    this.botTiers = botTiers;
    this.log = [];
  }

  tierFor(bot, action) {
    if (NEVER_CLASSES.includes(action)) return 'never';
    const t = this.botTiers[bot] || {};
    if ((t.never || []).includes(action)) return 'never';
    if ((t.approve || []).includes(action)) return 'approve';
    if ((t.auto || []).includes(action)) return 'auto';
    return 'approve'; // unknown actions default to asking a human
  }

  /**
   * Decide an action. Returns one of:
   *   { decision: 'run',     tier: 'auto' }
   *   { decision: 'queue',   tier: 'approve' }   -> Approvals inbox
   *   { decision: 'refuse',  tier: 'never' }     -> counted, logged, dropped
   */
  decide(bot, action, payload = {}) {
    const tier = this.tierFor(bot, action);
    const entry = { bot, action, tier, at: new Date().toISOString(), payload };
    this.log.push(entry);
    if (tier === 'auto') return { decision: 'run', tier };
    if (tier === 'approve') return { decision: 'queue', tier };
    return { decision: 'refuse', tier };
  }

  /** Attempted Never-Auto actions (the prototype's counter reads this). */
  get neverAttempts() {
    return this.log.filter((e) => e.tier === 'never').length;
  }
}

module.exports = { GuardrailEngine, NEVER_CLASSES };
