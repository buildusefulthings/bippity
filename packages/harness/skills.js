/**
 * skills — how this workspace's bots do a kind of job (v0.13).
 * One markdown file per skill in .data/workspaces/<ws>/skills/<slug>.md:
 *   ---
 *   name: Invoice match check
 *   category: Finance
 *   status: draft | published
 *   bots: penny, otto
 *   triggers: invoice, reconcile
 *   description: Three-way match... Use when asked to "match an invoice".
 *   ---
 *   ## Steps
 *   1. ...
 * Draft skills are inert: bots never follow them (the UI says so too).
 * Published skills whose triggers appear in a brief are followed by the
 * assigned bot and recorded in the result + knowledge. Skills are
 * instructions, not permissions — they can never widen guardrails.
 */
const fs = require('fs');
const path = require('path');

function slugify(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'skill'; }
function parseSkill(raw, slug) {
  const m = String(raw).match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  const meta = {}; let body = String(raw).trim();
  if (m) {
    body = m[2].trim();
    for (const line of m[1].split('\n')) { const kv = line.match(/^([a-z_]+):\s*(.*)$/); if (kv) meta[kv[1]] = kv[2].trim(); }
  }
  const list = (v) => String(v || '').split(',').map((x) => x.trim()).filter(Boolean);
  return { slug, name: meta.name || slug, category: meta.category || 'General', status: meta.status === 'published' ? 'published' : 'draft', bots: list(meta.bots), triggers: list(meta.triggers), description: meta.description || '', body };
}
function serializeSkill(s) {
  return ['---', `name: ${s.name}`, `category: ${s.category}`, `status: ${s.status}`, `bots: ${s.bots.join(', ')}`, `triggers: ${s.triggers.join(', ')}`, `description: ${String(s.description || '').replace(/\n/g, ' ')}`, '---', '', s.body || ''].join('\n');
}
class SkillStore {
  constructor(dataRoot) { this.root = path.join(dataRoot, 'workspaces'); }
  dir(ws) { return path.join(this.root, ws, 'skills'); }
  file(ws, slug) { return path.join(this.dir(ws), slug + '.md'); }
  seed(ws, files) { // files: [{slug, raw}] copied in only when the ws has none yet
    const d = this.dir(ws);
    if (fs.existsSync(d) && fs.readdirSync(d).some((f) => f.endsWith('.md'))) return 0;
    fs.mkdirSync(d, { recursive: true });
    let n = 0;
    for (const f of files || []) { fs.writeFileSync(this.file(ws, f.slug), f.raw); n++; }
    return n;
  }
  list(ws) {
    const d = this.dir(ws);
    if (!fs.existsSync(d)) return [];
    return fs.readdirSync(d).filter((f) => f.endsWith('.md')).map((f) => parseSkill(fs.readFileSync(path.join(d, f), 'utf8'), f.replace(/\.md$/, ''))).sort((a, b) => a.name.localeCompare(b.name));
  }
  get(ws, slug) { const p = this.file(ws, slug); return fs.existsSync(p) ? parseSkill(fs.readFileSync(p, 'utf8'), slug) : null; }
  create(ws, data) {
    const name = String(data.name || '').trim(); if (!name) throw new Error('a skill needs a name');
    const slug = slugify(data.slug || name);
    if (this.get(ws, slug)) throw new Error('a skill with that name already exists here');
    const s = { slug, name, category: String(data.category || 'General').slice(0, 40), status: data.status === 'published' ? 'published' : 'draft', bots: Array.isArray(data.bots) ? data.bots.map(String) : [], triggers: Array.isArray(data.triggers) ? data.triggers.map(String) : [], description: String(data.description || '').slice(0, 400), body: String(data.body || '').slice(0, 20000) };
    fs.mkdirSync(this.dir(ws), { recursive: true });
    fs.writeFileSync(this.file(ws, slug), serializeSkill(s));
    return s;
  }
  update(ws, slug, data) {
    const cur = this.get(ws, slug); if (!cur) throw new Error('no such skill');
    const next = { ...cur, ...Object.fromEntries(Object.entries(data || {}).filter(([k]) => ['name', 'category', 'description', 'body'].includes(k))) };
    if (Array.isArray(data.bots)) next.bots = data.bots.map(String);
    if (Array.isArray(data.triggers)) next.triggers = data.triggers.map(String);
    fs.writeFileSync(this.file(ws, slug), serializeSkill(next));
    return next;
  }
  setStatus(ws, slug, status) {
    const cur = this.get(ws, slug); if (!cur) throw new Error('no such skill');
    if (!['draft', 'published'].includes(status)) throw new Error('status must be draft|published');
    cur.status = status;
    fs.writeFileSync(this.file(ws, slug), serializeSkill(cur));
    return cur;
  }
  remove(ws, slug) { const p = this.file(ws, slug); if (!fs.existsSync(p)) return false; fs.unlinkSync(p); return true; }
  matchFor(ws, botId, text) {
    const t = String(text || '').toLowerCase();
    return this.list(ws).filter((s) => s.status === 'published' && (s.bots.length === 0 || s.bots.includes(botId)) && s.triggers.some((tr) => t.includes(tr.toLowerCase())));
  }
}
module.exports = { SkillStore, parseSkill, serializeSkill, slugify };
