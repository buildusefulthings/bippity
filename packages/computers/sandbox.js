/**
 * computers — sandbox drivers behind one interface:
 *   start(botId) / exec(botId, cmd) / writeFile / readFile / stop(botId)
 *
 * Drivers:
 *  - docker: one container per bot when Docker is present (checked, not assumed)
 *  - local:  a per-bot directory under .data/sandboxes/<bot>/ with shell
 *            commands confined to it (cwd pinned, timeout, output capped).
 *            This is a workspace sandbox, NOT an OS security boundary —
 *            use docker/proxmox when running untrusted work.
 */
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

function hasDocker() {
  return new Promise((res) => execFile('docker', ['info', '--format', '{{.ServerVersion}}'], { timeout: 4000 }, (e, out) => res(!e && !!String(out).trim())));
}
class LocalSandbox {
  constructor(root) { this.root = root; fs.mkdirSync(root, { recursive: true }); }
  dir(bot) { const d = path.join(this.root, bot); fs.mkdirSync(d, { recursive: true }); return d; }
  async start(bot) { return { driver: 'local', bot, dir: this.dir(bot) }; }
  exec(bot, cmd, timeoutMs = 10000) {
    return new Promise((resolve) => {
      execFile('bash', ['-c', cmd], { cwd: this.dir(bot), timeout: timeoutMs, maxBuffer: 256 * 1024 },
        (err, stdout, stderr) => resolve({ ok: !err, code: err ? (err.code ?? 1) : 0, stdout: String(stdout).slice(0, 8000), stderr: String(stderr).slice(0, 2000) }));
    });
  }
  writeFile(bot, name, content) { const p = path.join(this.dir(bot), path.basename(name)); fs.writeFileSync(p, content); return p; }
  readFile(bot, name) { const p = path.join(this.dir(bot), path.basename(name)); return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null; }
  async stop() { return { stopped: true }; }
}
class DockerSandbox {
  constructor(image = 'node:22-alpine') { this.image = image; }
  name(bot) { return 'bippity-' + bot.replace(/[^a-z0-9-]/gi, '-'); }
  async start(bot) {
    await this._run(['run', '-d', '--name', this.name(bot), '-w', '/work', this.image, 'sleep', 'infinity']).catch(() => {});
    return { driver: 'docker', bot, container: this.name(bot) };
  }
  _run(args) { return new Promise((res, rej) => execFile('docker', args, { timeout: 30000, maxBuffer: 512 * 1024 }, (e, out, err) => e ? rej(new Error(String(err || e.message))) : res(String(out)))); }
  async exec(bot, cmd) { try { const out = await this._run(['exec', this.name(bot), 'sh', '-c', cmd]); return { ok: true, code: 0, stdout: out.slice(0, 8000), stderr: '' }; } catch (e) { return { ok: false, code: 1, stdout: '', stderr: e.message.slice(0, 2000) }; } }
  async stop(bot) { await this._run(['rm', '-f', this.name(bot)]).catch(() => {}); return { stopped: true }; }
}
async function createSandbox({ dataRoot, preferred = 'docker', env = process.env }) {
  if (preferred === 'proxmox') {
    const { proxmoxFromEnv } = require('./proxmox');
    const px = proxmoxFromEnv(env);
    if (px) return px;
    const local = new LocalSandbox(path.join(dataRoot, 'sandboxes'));
    local.fallbackReason = 'proxmox preferred but not configured — set PROXMOX_HOST, PROXMOX_API_TOKEN, PROXMOX_TEMPLATE_VMID';
    return local;
  }
  if (preferred === 'docker' && await hasDocker()) return new DockerSandbox();
  return new LocalSandbox(path.join(dataRoot, 'sandboxes'));
}
module.exports = { LocalSandbox, DockerSandbox, createSandbox, hasDocker };
