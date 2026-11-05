/**
 * pack-installer — a pack is a folder (pack.yaml + pack.bots.js +
 * optional BRIEF.md, routines.json, watches.json, messages/). Installing
 * a pack creates a ready workspace under .data/workspaces/<name>/:
 *
 *   pack/          snapshot of the pack as installed
 *   BRIEF.md       workspace brief ({{VARS}} substituted from install vars)
 *   routines.json  seeded schedules (copied from the pack)
 *   watches.json   seeded watches (copied from the pack)
 *   inbox/         drop folder the file watches read
 *   memory/<bot>.md  one memory file per bot, created empty-with-header
 *   manifest.json  what was installed, from where, when, pack hash
 *
 * Validation runs BEFORE anything is written, and it is a security gate,
 * not a formality: a pack that tries to class a Never-Auto action
 * (pay, sign, commit...) as auto/approve is REFUSED. The runtime would
 * refuse those actions anyway — the installer refuses the pack so the
 * misconfiguration is caught where a human can see it.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { parse } = require('./yaml-lite');
const { NEVER_CLASSES } = require('./guardrails');
const { loadPack } = require('./persona-loader');

const sanitize = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
function hashDir(dir) {
  const h = crypto.createHash('sha256');
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else { h.update(e.name); h.update(fs.readFileSync(p)); } } };
  walk(dir); return h.digest('hex').slice(0, 16);
}
function copyDir(src, dst) { fs.mkdirSync(dst, { recursive: true }); for (const e of fs.readdirSync(src, { withFileTypes: true })) { const s = path.join(src, e.name), d = path.join(dst, e.name); if (e.isDirectory()) copyDir(s, d); else fs.copyFileSync(s, d); } }

function listPacks(packsRoot) {
  if (!fs.existsSync(packsRoot)) return [];
  return fs.readdirSync(packsRoot, { withFileTypes: true }).filter((e) => e.isDirectory() && fs.existsSync(path.join(packsRoot, e.name, 'pack.yaml')))
    .map((e) => { const raw = parse(fs.readFileSync(path.join(packsRoot, e.name, 'pack.yaml'), 'utf8')); return { id: raw.pack || e.name, dir: e.name, name: raw.name || e.name, bots: Array.isArray(raw.bots) ? raw.bots.length : 0, license: raw.license || 'see pack' }; });
}

function validatePack(packDir) {
  const errors = [], warnings = [];
  const yamlPath = path.join(packDir, 'pack.yaml');
  if (!fs.existsSync(yamlPath)) return { ok: false, errors: ['missing pack.yaml'], warnings };
  let pack;
  try { pack = loadPack(packDir); } catch (e) { return { ok: false, errors: ['pack does not load: ' + e.message], warnings }; }
  if (!pack.bots || pack.bots.length < 2) errors.push('pack needs at least 2 bots (a chief + a specialist)');
  if (!pack.bots.some((b) => b.id === 'chief')) errors.push('pack has no chief bot');
  for (const tierName of ['auto', 'approve']) {
    for (const action of (pack.tiers[tierName] || [])) {
      if (NEVER_CLASSES.includes(action)) errors.push(`guardrail abuse: "${action}" is a Never-Auto class but the pack lists it under ${tierName}`);
    }
  }
  for (const b of pack.bots) if (b.id !== 'chief' && !b.work) warnings.push(`bot "${b.id}" has no offline work definition (needs pack.bots.js entry)`);
  for (const f of ['routines.json', 'watches.json']) {
    const p = path.join(packDir, f);
    if (fs.existsSync(p)) { try { const j = JSON.parse(fs.readFileSync(p, 'utf8')); if (!Array.isArray(j)) errors.push(f + ' must be a JSON array'); } catch { errors.push(f + ' is not valid JSON'); } }
  }
  return { ok: errors.length === 0, errors, warnings, pack };
}

function installPack({ packDir, dataRoot, workspaceName, vars = {}, force = false }) {
  const v = validatePack(packDir);
  if (!v.ok) return { ok: false, stage: 'validate', errors: v.errors, warnings: v.warnings };
  const name = sanitize(workspaceName) || sanitize(v.pack.id);
  if (!name) return { ok: false, stage: 'name', errors: ['workspace name is empty after sanitizing'] };
  const wsDir = path.join(dataRoot, 'workspaces', name);
  if (fs.existsSync(path.join(wsDir, 'manifest.json')) && !force) return { ok: false, stage: 'exists', errors: [`workspace "${name}" is already installed (use force to reinstall)`] };
  fs.mkdirSync(path.join(wsDir, 'inbox'), { recursive: true });
  fs.mkdirSync(path.join(wsDir, 'memory'), { recursive: true });
  copyDir(packDir, path.join(wsDir, 'pack'));
  // BRIEF with {{VAR}} substitution
  const briefSrc = path.join(packDir, 'BRIEF.md');
  let brief = fs.existsSync(briefSrc) ? fs.readFileSync(briefSrc, 'utf8') : `# Workspace brief — ${name}\n\nInstalled from pack ${v.pack.id}.\n`;
  const allVars = { WORKSPACE_NAME: name, OWNER_NAME: vars.OWNER_NAME || '', SCHOOL_NAME: vars.SCHOOL_NAME || '', SHOP_NAME: vars.SHOP_NAME || '', ...vars };
  for (const [k, val] of Object.entries(allVars)) brief = brief.split('{{' + k + '}}').join(val || ('{{' + k + '}}'));
  fs.writeFileSync(path.join(wsDir, 'BRIEF.md'), brief);
  for (const f of ['routines.json', 'watches.json']) { const p = path.join(packDir, f); if (fs.existsSync(p)) fs.copyFileSync(p, path.join(wsDir, f)); }
  for (const b of v.pack.bots) { const mf = path.join(wsDir, 'memory', b.id + '.md'); if (!fs.existsSync(mf)) fs.writeFileSync(mf, `# ${b.name} — memory\nInstalled ${new Date().toISOString()} with workspace ${name}.\n`); }
  const manifest = { workspace: name, pack: v.pack.id, packName: v.pack.name, source: packDir, hash: hashDir(packDir), installedAt: new Date().toISOString(), bots: v.pack.bots.map((b) => b.id), vars: allVars, force };
  fs.writeFileSync(path.join(wsDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  return { ok: true, workspace: name, dir: wsDir, manifest, warnings: v.warnings };
}

function listInstalled(dataRoot) {
  const root = path.join(dataRoot, 'workspaces');
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root).filter((n) => fs.existsSync(path.join(root, n, 'manifest.json')))
    .map((n) => { try { return JSON.parse(fs.readFileSync(path.join(root, n, 'manifest.json'), 'utf8')); } catch { return null; } }).filter(Boolean);
}
module.exports = { listPacks, validatePack, installPack, listInstalled, sanitize };
