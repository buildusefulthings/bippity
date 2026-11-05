/**
 * provision — R2 tenant provisioning.
 * One call takes a tenant from signup to runnable:
 *   1. registry entry (plan, tokens, target URL)
 *   2. pack installed as the tenant's workspace (pack-installer —
 *      validation gate included; a guardrail-abusing pack is refused
 *      BEFORE the tenant is created)
 *   3. secrets into the vault (never into the registry)
 *   4. optional computer plan: a Proxmox clone descriptor per bot
 *      (dry-run by default — the actual clone happens when a driver
 *      with a real host runs it; ties to the v0.3 ProxmoxDriver)
 * Returns the tenant + the webhook URLs to paste into Slack/Telegram.
 */
const fs = require('fs');
const path = require('path');
const { installPack } = require('../harness/pack-installer');

function provisionTenant({ registry, vault = null, meter = null, dataRoot, packsRoot, relayBase, name, plan = 'pro', pack, vars = {}, workspaceName, targetUrl, secrets = null, computer = null, status = 'active', email = null }) {
  const wsName = workspaceName || String(name || 'tenant').toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
  const installed = installPack({ packDir: path.join(packsRoot, pack), dataRoot, workspaceName: wsName, vars });
  if (!installed.ok) return { ok: false, stage: 'install', ...installed };
  const tenant = registry.create({ name, plan, targetUrl, workspaces: [wsName], status, email });
  let vaultKeys = [];
  if (vault && secrets) { vaultKeys = vault.put(tenant.id, secrets).keys; }
  let computerPlan = null;
  if (computer === 'proxmox') {
    const bots = (installed.manifest && installed.manifest.bots) || [];
    computerPlan = { driver: 'proxmox', dryRun: true, clones: bots.map((b) => ({ bot: b, fromTemplate: 'PROXMOX_TEMPLATE_VMID', note: 'clone on first sandbox request via ProxmoxDriver' })) };
  }
  if (meter) meter.record(tenant.id, 'brief', 0); // touch the meter file for the tenant
  return {
    ok: true, tenant: { id: tenant.id, name: tenant.name, plan: tenant.plan, workspace: wsName },
    webhooks: { slack: registry.webhookUrl(relayBase, 'slack', tenant, wsName), telegram: registry.webhookUrl(relayBase, 'telegram', tenant, wsName) },
    vaultKeys, computerPlan,
    note: 'Relay token + instance secret are in the registry record (shown once via the admin API response). Rotate with registry.rotate() if leaked.',
  };
}
module.exports = { provisionTenant };
