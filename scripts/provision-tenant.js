#!/usr/bin/env node
/**
 * provision-tenant — CLI for R2 tenant provisioning.
 *   node scripts/provision-tenant.js --name "Willow Creek" --pack enrollment \
 *     --plan pro --workspace willow --target http://127.0.0.1:3211 \
 *     --relay-base https://hooks.example.com --set SCHOOL_NAME="Willow Creek"
 * Env: BIPPITY_VAULT_KEY enables secret storage via --secret KEY=VALUE (repeatable).
 */
const path = require('path');
const ROOT = path.join(__dirname, '..');
const { TenantRegistry } = require(path.join(ROOT, 'packages/hosted/tenants'));
const { KeyVault } = require(path.join(ROOT, 'packages/hosted/vault'));
const { UsageMeter } = require(path.join(ROOT, 'packages/hosted/metering'));
const { provisionTenant } = require(path.join(ROOT, 'packages/hosted/provision'));

const args = process.argv.slice(2);
const opt = {}; const sets = {}; const secrets = {};
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--set') { const [k, ...v] = args[++i].split('='); sets[k] = v.join('='); }
  else if (args[i] === '--secret') { const [k, ...v] = args[++i].split('='); secrets[k] = v.join('='); }
  else if (args[i].startsWith('--')) opt[args[i].slice(2)] = args[++i];
}
if (!opt.name || !opt.pack) { console.error('usage: provision-tenant --name <name> --pack <enrollment|ops> [--plan pro] [--workspace <id>] [--target <instance url>] [--relay-base <public relay url>] [--set K=V] [--secret K=V] [--computer proxmox]'); process.exit(2); }
const dataRoot = path.join(ROOT, '.data');
const registry = new TenantRegistry(dataRoot);
const vault = process.env.BIPPITY_VAULT_KEY ? new KeyVault(dataRoot) : null;
const r = provisionTenant({
  registry, vault, meter: new UsageMeter(dataRoot), dataRoot,
  packsRoot: path.join(ROOT, 'bots/examples'),
  relayBase: opt['relay-base'] || 'http://127.0.0.1:3220',
  name: opt.name, plan: opt.plan || 'pro', pack: opt.pack, vars: sets,
  workspaceName: opt.workspace, targetUrl: opt.target || 'http://127.0.0.1:3211',
  secrets: Object.keys(secrets).length ? secrets : null, computer: opt.computer || null,
});
console.log(JSON.stringify(r, null, 2));
if (!r.ok) process.exit(1);
const t = registry.byId(r.tenant.id);
console.log('\nWebhook URLs (contain the tenant relay token — treat like a password):');
console.log('  slack:   ', r.webhooks.slack);
console.log('  telegram:', r.webhooks.telegram);
console.log('Instance secret (set as RELAY_SECRET on the tenant instance):', t.instanceSecret);
