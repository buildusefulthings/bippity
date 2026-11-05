/**
 * proxmox — Proxmox VE driver, same interface as the other sandboxes:
 *   start(bot) / exec(bot, cmd) / writeFile / readFile / stop(bot)
 *
 * Model: one template VM (with qemu-guest-agent installed) is cloned per
 * bot; the clone's VMID = PROXMOX_VMID_BASE + a stable hash of the bot id,
 * and the mapping is remembered in-memory (and returned by start()).
 * Commands run through the QEMU guest agent (agent/exec + exec-status),
 * files through agent/file-write + file-read. No guest agent = exec
 * fails with a clear reason rather than pretending.
 *
 * Config (env):
 *   PROXMOX_HOST          https://t480.local:8006   (base URL, no trailing /)
 *   PROXMOX_API_TOKEN     user@pam!bippity=xxxxxxxx-xxxx-...  (full token)
 *   PROXMOX_NODE          pve (default)
 *   PROXMOX_TEMPLATE_VMID 100
 *   PROXMOX_VMID_BASE     9000 (default)
 *   PROXMOX_TLS_REJECT    0 to allow self-signed (home lab default: allow)
 *
 * fetch and TLS behavior are injectable for tests (mock PVE API).
 */
const crypto = require('crypto');

class ProxmoxDriver {
  constructor(env = process.env, inject = {}) {
    this.host = (env.PROXMOX_HOST || '').replace(/\/$/, '');
    this.token = env.PROXMOX_API_TOKEN || null;
    this.node = env.PROXMOX_NODE || 'pve';
    this.template = Number(env.PROXMOX_TEMPLATE_VMID || 0);
    this.vmidBase = Number(env.PROXMOX_VMID_BASE || 9000);
    this.fetch = inject.fetch || globalThis.fetch;
    this.vmids = new Map();
    this.pollMs = inject.pollMs ?? 1500;
    this.maxPolls = inject.maxPolls ?? 40;
  }
  get configured() { return !!(this.host && this.token && this.template); }
  status() {
    return { driver: 'proxmox', configured: this.configured, host: this.host || null, node: this.node, templateVmid: this.template || null,
      note: this.configured ? 'Token + template set. Bot VMs clone from the template; guest agent required inside it.' : 'Set PROXMOX_HOST, PROXMOX_API_TOKEN, and PROXMOX_TEMPLATE_VMID.' };
  }
  vmidFor(bot) {
    if (!this.vmids.has(bot)) {
      const h = crypto.createHash('sha256').update(bot).digest();
      this.vmids.set(bot, this.vmidBase + (h.readUInt16BE(0) % 500));
    }
    return this.vmids.get(bot);
  }
  async api(method, path, body) {
    const r = await this.fetch(this.host + '/api2/json' + path, {
      method,
      headers: { authorization: 'PVEAPIToken=' + this.token, 'content-type': 'application/x-www-form-urlencoded' },
      body: body ? new URLSearchParams(body).toString() : undefined,
    });
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch { /* keep null */ }
    if (!r.ok) throw new Error(`PVE ${method} ${path} -> ${r.status}: ${text.slice(0, 200)}`);
    return json && json.data;
  }
  async waitTask(upid) {
    for (let i = 0; i < this.maxPolls; i++) {
      const s = await this.api('GET', `/nodes/${this.node}/tasks/${encodeURIComponent(upid)}/status`);
      if (s && s.status === 'stopped') { if (s.exitstatus !== 'OK') throw new Error('PVE task failed: ' + s.exitstatus); return s; }
      await new Promise((res) => setTimeout(res, this.pollMs));
    }
    throw new Error('PVE task timed out: ' + upid);
  }
  async vmStatus(vmid) {
    try { const s = await this.api('GET', `/nodes/${this.node}/qemu/${vmid}/status/current`); return s && s.status; }
    catch { return null; }
  }
  /** Clone the template for this bot (once), then start the VM. */
  async start(bot) {
    if (!this.configured) throw new Error('Proxmox not configured (PROXMOX_HOST / PROXMOX_API_TOKEN / PROXMOX_TEMPLATE_VMID)');
    const vmid = this.vmidFor(bot);
    const existing = await this.vmStatus(vmid);
    if (!existing) {
      const upid = await this.api('POST', `/nodes/${this.node}/qemu/${this.template}/clone`, { newid: String(vmid), name: 'bippity-' + bot, full: '1' });
      if (upid) await this.waitTask(upid);
    }
    if ((await this.vmStatus(vmid)) !== 'running') {
      const upid = await this.api('POST', `/nodes/${this.node}/qemu/${vmid}/status/start`, {});
      if (upid) await this.waitTask(upid);
    }
    return { driver: 'proxmox', bot, vmid, node: this.node, consoleUrl: this.consoleUrl(bot) };
  }
  /** Run a command via the QEMU guest agent. Returns { ok, stdout, stderr, code }. */
  async exec(bot, cmd) {
    const vmid = this.vmidFor(bot);
    try {
      const started = await this.api('POST', `/nodes/${this.node}/qemu/${vmid}/agent/exec`, { command: JSON.stringify(['/bin/sh', '-c', cmd]) });
      const pid = started && started.pid;
      if (pid === undefined) return { ok: false, code: 1, stdout: '', stderr: 'guest agent returned no pid — is qemu-guest-agent running in the template?' };
      for (let i = 0; i < this.maxPolls; i++) {
        const st = await this.api('GET', `/nodes/${this.node}/qemu/${vmid}/agent/exec-status?pid=${pid}`);
        if (st && st.exited) return { ok: st.exitcode === 0, code: st.exitcode, stdout: (st['out-data'] || '').slice(0, 8000), stderr: (st['err-data'] || '').slice(0, 2000) };
        await new Promise((res) => setTimeout(res, this.pollMs));
      }
      return { ok: false, code: 1, stdout: '', stderr: 'exec timed out waiting on guest agent' };
    } catch (e) { return { ok: false, code: 1, stdout: '', stderr: e.message }; }
  }
  async writeFile(bot, name, content) {
    const vmid = this.vmidFor(bot);
    await this.api('POST', `/nodes/${this.node}/qemu/${vmid}/agent/file-write`, { file: '/root/' + name.replace(/[^\w.-]/g, '_'), content });
    return '/root/' + name;
  }
  async readFile(bot, name) {
    const vmid = this.vmidFor(bot);
    try { const r = await this.api('GET', `/nodes/${this.node}/qemu/${vmid}/agent/file-read?file=${encodeURIComponent('/root/' + name.replace(/[^\w.-]/g, '_'))}`); return r && r.content !== undefined ? r.content : null; }
    catch { return null; }
  }
  async stop(bot) {
    const vmid = this.vmidFor(bot);
    const upid = await this.api('POST', `/nodes/${this.node}/qemu/${vmid}/status/stop`, {}).catch(() => null);
    if (upid) await this.waitTask(upid).catch(() => {});
    return { stopped: true, vmid };
  }
  /** Browser console (noVNC) URL for the bot's VM — view over Tailscale/LAN. */
  consoleUrl(bot) { return `${this.host}/?console=kvm&vmid=${this.vmidFor(bot)}&node=${this.node}`; }
  /** Live view data for the API: node + VM list summary. */
  async overview() {
    if (!this.configured) return this.status();
    const nodeStatus = await this.api('GET', `/nodes/${this.node}/status`).catch((e) => ({ error: e.message }));
    return { ...this.status(), nodeStatus: nodeStatus && { uptime: nodeStatus.uptime, cpu: nodeStatus.cpu, memoryUsed: nodeStatus.memory && nodeStatus.memory.used, memoryTotal: nodeStatus.memory && nodeStatus.memory.total, error: nodeStatus.error || undefined } };
  }
}
function proxmoxFromEnv(env = process.env, inject = {}) { const d = new ProxmoxDriver(env, inject); return d.configured ? d : null; }
module.exports = { ProxmoxDriver, proxmoxFromEnv };
