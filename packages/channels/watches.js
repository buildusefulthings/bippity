/**
 * watches — monitors that turn changes into briefs.
 *
 * A watch: { name, type: 'file' | 'http', target, brief, intervalMin,
 *            contains? }
 * - file: target is a file or a folder, relative to the workspace dir.
 *   A folder fires when a NEW file appears; a file fires when its
 *   content hash changes.
 * - http: target is a URL. Fires when the body hash changes, or — when
 *   `contains` is set — when the body newly contains that string.
 *
 * A fired watch calls workspace.brief(brief, 'watch:<name>') — the same
 * Chief -> guardrail -> approvals path as everything else. A watch can
 * never send anything by itself, and a watch whose brief asks for a
 * Never-Auto act gets the same refusal a human typing it would.
 *
 * State (seen files / hashes / last fire) persists in
 * .data/workspaces/<ws>/watches-state.json so restarts don't refire.
 * The first tick after install establishes the baseline silently —
 * existing files/content are NOT treated as new.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const hash = (s) => crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 16);

class WatchRunner {
  constructor(workspace, watches = [], { dataRoot, fetchFn } = {}) {
    this.ws = workspace; this.watches = watches;
    this.fetch = fetchFn || globalThis.fetch;
    this.stateFile = path.join(dataRoot, 'workspaces', workspace.id, 'watches-state.json');
    this.state = fs.existsSync(this.stateFile) ? JSON.parse(fs.readFileSync(this.stateFile, 'utf8')) : {};
    this.timer = null;
  }
  _save() { fs.mkdirSync(path.dirname(this.stateFile), { recursive: true }); fs.writeFileSync(this.stateFile, JSON.stringify(this.state, null, 2)); }
  _wsDir() { return path.join(path.dirname(this.stateFile)); }

  async _checkFile(w) {
    const target = path.join(this._wsDir(), w.target);
    if (!fs.existsSync(target)) return null;
    const st = fs.statSync(target);
    const key = 'file:' + w.name;
    if (st.isDirectory()) {
      const files = fs.readdirSync(target).sort();
      const prev = this.state[key];
      if (!prev) { this.state[key] = { files }; return null; } // baseline
      const fresh = files.filter((f) => !prev.files.includes(f));
      if (!fresh.length) return null;
      this.state[key] = { files };
      return { detail: 'new file(s): ' + fresh.join(', '), fresh };
    }
    const contentHash = hash(fs.readFileSync(target));
    const prev = this.state[key];
    if (!prev) { this.state[key] = { contentHash }; return null; } // baseline
    if (prev.contentHash === contentHash) return null;
    this.state[key] = { contentHash };
    return { detail: 'content changed: ' + w.target };
  }
  async _checkHttp(w) {
    const r = await this.fetch(w.target);
    const text = await r.text();
    const key = 'http:' + w.name;
    const prev = this.state[key];
    if (w.contains) {
      const has = text.includes(w.contains);
      if (!prev) { this.state[key] = { has }; return null; }
      if (has && !prev.has) { this.state[key] = { has }; return { detail: `page now contains "${w.contains}"` }; }
      this.state[key] = { has }; return null;
    }
    const h = hash(text);
    if (!prev) { this.state[key] = { h }; return null; }
    if (prev.h === h) return null;
    this.state[key] = { h };
    return { detail: 'page content changed: ' + w.target };
  }
  /** One pass over all watches. Returns the briefs fired (results included). */
  async tick() {
    const fired = [];
    for (const w of this.watches) {
      try {
        const hit = w.type === 'http' ? await this._checkHttp(w) : await this._checkFile(w);
        if (hit) {
          const result = await this.ws.brief(w.brief, 'watch:' + w.name);
          fired.push({ watch: w.name, detail: hit.detail, result: result.type, from: result.from || 'Chief' });
          this.state['last:' + w.name] = { at: new Date().toISOString(), detail: hit.detail, result: result.type };
        }
      } catch (e) { this.state['error:' + w.name] = { at: new Date().toISOString(), message: e.message }; }
    }
    this._save();
    return fired;
  }
  status() { return this.watches.map((w) => ({ name: w.name, type: w.type, target: w.target, intervalMin: w.intervalMin || 5, last: this.state['last:' + w.name] || null, error: this.state['error:' + w.name] || null })); }
  start() { this.timer = setInterval(() => this.tick().catch(() => {}), 60000); return this; }
  stop() { if (this.timer) clearInterval(this.timer); }
}
module.exports = { WatchRunner };
