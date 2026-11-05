/**
 * model-router — per-bot model choice with a daily spend cap.
 * Providers: openai | anthropic (claude) | xai (grok) | ollama (local).
 * No key for a provider => `available: false` and the runtime falls back
 * to deterministic offline mode, so a fresh clone still runs end-to-end.
 */
const PROVIDERS = {
  openai:    { env: 'OPENAI_API_KEY',    url: 'https://api.openai.com/v1/chat/completions',        def: 'gpt-5-mini' },
  claude:    { env: 'ANTHROPIC_API_KEY', url: 'https://api.anthropic.com/v1/messages',             def: 'claude-sonnet-4-5' },
  anthropic: { env: 'ANTHROPIC_API_KEY', url: 'https://api.anthropic.com/v1/messages',             def: 'claude-sonnet-4-5' },
  grok:      { env: 'XAI_API_KEY',       url: 'https://api.x.ai/v1/chat/completions',                def: 'grok-4' },
  xai:       { env: 'XAI_API_KEY',       url: 'https://api.x.ai/v1/chat/completions',                def: 'grok-4' },
};

class ModelRouter {
  constructor(env = process.env) {
    this.env = env;
    this.capUsd = Number(env.BIPPITY_DAILY_SPEND_CAP_USD || 25);
    this.spentToday = 0; this.day = new Date().toISOString().slice(0, 10);
    this.calls = [];
  }
  parseSpec(spec = 'claude') {
    const [prov, ...rest] = String(spec).split(':');
    const model = rest.join(':') || null;
    if (prov === 'ollama') return { provider: 'ollama', model: model || 'llama3.1', local: true };
    const p = PROVIDERS[prov];
    if (!p) return { provider: prov, model: model || spec, unknown: true };
    return { provider: prov, model: model || p.def, keyEnv: p.env, url: p.url };
  }
  available(spec) {
    const s = this.parseSpec(spec);
    if (s.local) return { ok: true, mode: 'local', ...s };
    if (s.unknown) return { ok: false, mode: 'offline', reason: 'unknown provider ' + s.provider, ...s };
    return this.env[s.keyEnv] ? { ok: true, mode: 'live', ...s } : { ok: false, mode: 'offline', reason: s.keyEnv + ' not set', ...s };
  }
  withinCap(estUsd = 0.02) {
    if (new Date().toISOString().slice(0, 10) !== this.day) { this.day = new Date().toISOString().slice(0, 10); this.spentToday = 0; }
    return this.spentToday + estUsd <= this.capUsd;
  }
  /**
   * Complete a prompt. Live call when a key exists and the cap allows;
   * otherwise returns null and the caller uses its offline behavior.
   * Never throws for a missing key.
   */
  async complete(spec, system, user) {
    const a = this.available(spec);
    if (!a.ok) return null;
    if (!this.withinCap()) return null;
    try {
      let text = null;
      if (a.provider === 'claude' || a.provider === 'anthropic') {
        const r = await fetch(a.url, { method: 'POST', headers: { 'x-api-key': this.env[a.keyEnv], 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify({ model: a.model, max_tokens: 800, system, messages: [{ role: 'user', content: user }] }) });
        const j = await r.json(); text = j && j.content && j.content[0] && j.content[0].text;
      } else if (a.local) {
        const host = this.env.OLLAMA_HOST || 'http://127.0.0.1:11434';
        const r = await fetch(host + '/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: a.model, stream: false, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }) });
        const j = await r.json(); text = j && j.message && j.message.content;
      } else {
        const r = await fetch(a.url, { method: 'POST', headers: { authorization: 'Bearer ' + this.env[a.keyEnv], 'content-type': 'application/json' }, body: JSON.stringify({ model: a.model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }) });
        const j = await r.json(); text = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
      }
      if (text) { this.spentToday += 0.02; this.calls.push({ spec, at: new Date().toISOString() }); }
      return text || null;
    } catch { return null; }
  }
  status(specs = []) {
    const out = {};
    for (const s of specs) out[s] = this.available(s);
    return { providers: out, spentTodayUsd: +this.spentToday.toFixed(2), capUsd: this.capUsd, liveCalls: this.calls.length };
  }
}
module.exports = { ModelRouter };
