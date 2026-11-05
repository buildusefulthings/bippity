/**
 * persona-loader — turns bot folders / pack files into runnable definitions.
 *
 * Two sources:
 *  1. A bot folder: bots/<name>/{persona.md, tools.yaml, guardrails.yaml}
 *  2. A pack file:  bots/examples/<pack>/pack.yaml (bots listed by id,
 *     with per-pack guardrail tiers and a fiction label for demos)
 *
 * Packs also get rich bot definitions from packs/<pack>.bots.js when it
 * exists (roles, models, keywords, canned specialist work for offline mode).
 */
const fs = require('fs');
const path = require('path');
const { parse } = require('./yaml-lite');

function readIf(p) { return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null; }

function loadBotFolder(dir) {
  const persona = readIf(path.join(dir, 'persona.md')) || '';
  const tools = parse(readIf(path.join(dir, 'tools.yaml')) || '');
  const guard = parse(readIf(path.join(dir, 'guardrails.yaml')) || '');
  const nameMatch = persona.match(/Bot name:\s*(.+)/);
  return {
    id: (tools.bot || path.basename(dir)).toLowerCase(),
    name: nameMatch ? nameMatch[1].trim() : (tools.bot || path.basename(dir)),
    persona,
    model: tools.model || 'claude',
    computer: tools.computer || 'sandbox',
    channels: tools.channels || ['web'],
    connectors: tools.connectors || [],
    tiers: guard.tiers || { auto: [], approve: [], never: [] },
    shadowMode: guard.shadow_mode !== false,
    source: dir,
  };
}

function loadPack(packDir) {
  const raw = readIf(path.join(packDir, 'pack.yaml'));
  if (!raw) throw new Error('No pack.yaml in ' + packDir);
  const pack = parse(raw);
  let rich = {};
  const richPath = path.join(packDir, 'pack.bots.js');
  if (fs.existsSync(richPath)) rich = require(path.resolve(richPath));
  const tiers = (pack.guardrails && typeof pack.guardrails === 'object') ? {
    auto: arr(pack.guardrails.auto), approve: arr(pack.guardrails.approve), never: arr(pack.guardrails.never),
  } : { auto: [], approve: [], never: [] };
  const ids = arr(pack.bots).map((b) => (typeof b === 'object' ? Object.keys(b)[0] : b));
  const bots = ids.map((id) => {
    const r = rich[id] || {};
    return {
      id, name: r.name || cap(id), emoji: r.emoji || '🤖', role: r.role || '',
      model: r.model || 'claude', keywords: r.keywords || [], work: r.work || null,
      tiers, persona: r.persona || '', source: packDir,
    };
  });
  return { id: pack.pack, name: pack.name, fiction: pack.school_fiction || pack.shop_fiction || '', pipeline: pack.pipeline || '', bots, tiers };
}
const arr = (v) => (Array.isArray(v) ? v : (v === undefined || v === '' ? [] : [v]));
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
module.exports = { loadBotFolder, loadPack };
