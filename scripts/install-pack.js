#!/usr/bin/env node
/**
 * bippity pack installer CLI
 *   node scripts/install-pack.js list
 *   node scripts/install-pack.js validate <pack>
 *   node scripts/install-pack.js install <pack> [workspace-name] [--force] [--set KEY=VALUE ...]
 * Packs resolve by name under bots/examples/ or by path.
 */
const path = require('path');
const fs = require('fs');
const ROOT = path.join(__dirname, '..');
const { listPacks, validatePack, installPack, listInstalled } = require(path.join(ROOT, 'packages/harness/pack-installer'));
const DATA = path.join(ROOT, '.data');
const PACKS = path.join(ROOT, 'bots/examples');
const resolvePack = (p) => (p && fs.existsSync(path.join(p, 'pack.yaml'))) ? p : path.join(PACKS, p || '');

const [cmd, a, b, ...rest] = process.argv.slice(2);
if (cmd === 'list' || !cmd) {
  console.log('Available packs:');
  for (const p of listPacks(PACKS)) console.log(`  ${p.id.padEnd(14)} ${p.name} — ${p.bots} bots (${p.license})`);
  const inst = listInstalled(DATA);
  console.log(inst.length ? 'Installed workspaces:' : 'Installed workspaces: none');
  for (const m of inst) console.log(`  ${m.workspace.padEnd(14)} pack=${m.pack} installed=${m.installedAt.slice(0, 10)} hash=${m.hash}`);
} else if (cmd === 'validate') {
  const v = validatePack(resolvePack(a));
  console.log(v.ok ? '✓ pack is valid' : '✗ pack is INVALID');
  v.errors.forEach((e) => console.log('  error: ' + e));
  v.warnings.forEach((w) => console.log('  warning: ' + w));
  process.exit(v.ok ? 0 : 1);
} else if (cmd === 'install') {
  const vars = {}; let force = rest.includes('--force');
  for (let i = 0; i < rest.length; i++) if (rest[i] === '--set' && rest[i + 1]) { const [k, ...v] = rest[i + 1].split('='); vars[k] = v.join('='); }
  const nameArg = b && !b.startsWith('--') ? b : undefined;
  const r = installPack({ packDir: resolvePack(a), dataRoot: DATA, workspaceName: nameArg, vars, force });
  if (!r.ok) { console.error('✗ install failed at ' + r.stage + ': ' + r.errors.join('; ')); process.exit(1); }
  console.log(`✓ installed pack "${r.manifest.pack}" as workspace "${r.workspace}"`);
  console.log('  dir: ' + r.dir);
  console.log('  bots: ' + r.manifest.bots.join(', '));
  r.warnings.forEach((w) => console.log('  warning: ' + w));
  console.log('  restart the server (or it loads on next boot) and pick the workspace in the UI.');
} else { console.error('usage: list | validate <pack> | install <pack> [name] [--force] [--set K=V]'); process.exit(1); }
