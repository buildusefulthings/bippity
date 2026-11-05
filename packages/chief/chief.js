/**
 * chief — the coordinator.
 * - Receives a human brief.
 * - Detects a Never-Auto request in the brief itself and refuses it as a
 *   plan (the runtime still independently refuses at action time).
 * - Routes the brief to the best-matching specialist by pack keywords.
 * - Otherwise answers from the workspace brief / team roster.
 */
const NEVER_WORDS = [
  { re: /\b(pay|paying|paid)\b.*\b(invoice|bill|deposit|supplier)?/i, action: 'pay_invoice', test: (t) => /\bpay/.test(t) },
  { re: /collect (a |the )?(payment|deposit)/i, action: 'collect_payment' },
  { re: /sign (the |a )?contract/i, action: 'sign_contract' },
  { re: /promise.*seat|guarantee.*seat/i, action: 'promise_seat' },
  { re: /change.*tuition|raise.*price|commit.*price/i, action: 'commit_price_or_terms' },
];
function detectNever(brief) {
  for (const n of NEVER_WORDS) { if (n.re.test(brief)) return n.action; }
  return null;
}

class Chief {
  constructor(workspace) { this.ws = workspace; }
  plan(brief) {
    const never = detectNever(brief);
    if (never) return { kind: 'refuse', action: never, reason: `That brief asks for "${never}", a Never-Auto class. I won't plan it — it needs to happen outside the bot team, by a human, or not at all.` };
    const text = brief.toLowerCase();
    let best = null, bestScore = 0;
    for (const bot of this.ws.bots) {
      if (bot.id === 'chief') continue;
      const score = (bot.keywords || []).reduce((s, k) => s + (text.includes(k) ? 1 : 0), 0);
      if (score > bestScore) { bestScore = score; best = bot; }
    }
    if (best) return { kind: 'delegate', bot: best, brief };
    if (/brief|morning|status|report|summary/i.test(brief)) return { kind: 'brief' };
    return { kind: 'answer' };
  }
  morningBrief() {
    const lines = this.ws.bots.filter((b) => b.id !== 'chief').map((b) => `• ${b.name} — ${b.role}`);
    return `${this.ws.pack.name} — ${this.ws.pack.fiction}\nTeam on watch:\n${lines.join('\n')}\nNothing has been sent. Give me a brief and I'll delegate it; anything outbound waits for your tap.`;
  }
}
module.exports = { Chief, detectNever };
