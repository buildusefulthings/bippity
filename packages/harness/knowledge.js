/**
 * knowledge — the workspace's long-term memory of the world (v0.10).
 * Ten types, mirroring how a good chief of staff files things:
 *   issues, skills, people, tasks, events, promises,
 *   companies, projects, decisions, preferences
 * Entries are deposited by bots as they work (a bot's work() may return
 * `learns: [{type, title, detail}]`) or added by hand from the UI/API.
 * File-backed per workspace: .data/workspaces/<ws>/knowledge.json.
 * Knowledge is reference, never authority: an entry can inform a brief
 * but can never widen a bot's guardrails.
 */
const fs = require('fs');
const path = require('path');

const TYPES = ['issues', 'skills', 'people', 'tasks', 'events', 'promises', 'companies', 'projects', 'decisions', 'preferences'];
const ICONS = { issues: '⚠️', skills: '🧰', people: '👤', tasks: '✅', events: '📅', promises: '🤝', companies: '🏢', projects: '📁', decisions: '🧭', preferences: '💜' };

class KnowledgeStore {
  constructor(dataRoot) { this.root = path.join(dataRoot, 'workspaces'); }
  file(ws) { return path.join(this.root, ws, 'knowledge.json'); }
  load(ws) { try { const j = JSON.parse(fs.readFileSync(this.file(ws), 'utf8')); return Array.isArray(j) ? j : []; } catch { return []; } }
  save(ws, entries) { fs.mkdirSync(path.dirname(this.file(ws)), { recursive: true }); fs.writeFileSync(this.file(ws), JSON.stringify(entries, null, 2)); }
  add(ws, { type, title, detail = '', source = 'manual' }) {
    if (!TYPES.includes(type)) throw new Error(`unknown knowledge type "${type}" (${TYPES.join('|')})`);
    if (!title || !String(title).trim()) throw new Error('knowledge entry needs a title');
    const entries = this.load(ws);
    const e = { id: 'k' + Date.now().toString(36) + Math.floor(Math.random() * 999), type, title: String(title).slice(0, 160), detail: String(detail).slice(0, 600), source, at: new Date().toISOString() };
    entries.unshift(e); this.save(ws, entries.slice(0, 500));
    return e;
  }
  list(ws, type = null) { const all = this.load(ws); return type ? all.filter((e) => e.type === type) : all; }
  counts(ws) { const c = Object.fromEntries(TYPES.map((t) => [t, 0])); for (const e of this.load(ws)) c[e.type]++; return c; }
  remove(ws, id) { const all = this.load(ws); const next = all.filter((e) => e.id !== id); if (next.length === all.length) return false; this.save(ws, next); return true; }
}
module.exports = { KnowledgeStore, TYPES, ICONS };
