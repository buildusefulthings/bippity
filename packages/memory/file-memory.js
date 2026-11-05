/**
 * file-memory — the default memory store. Plain files, human-readable,
 * one per bot per workspace: .data/workspaces/<ws>/memory/<bot>.md
 * A bot loads its own file + the workspace brief at run start; it never
 * reads another workspace. Appends are timestamped, append-only.
 */
const fs = require('fs');
const path = require('path');

class FileMemory {
  constructor(root) { this.root = root; }
  dir(ws) { const d = path.join(this.root, 'workspaces', ws, 'memory'); fs.mkdirSync(d, { recursive: true }); return d; }
  botFile(ws, bot) { return path.join(this.dir(ws), bot + '.md'); }
  load(ws, bot) { const f = this.botFile(ws, bot); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : ''; }
  brief(ws) { const f = path.join(this.root, 'workspaces', ws, 'BRIEF.md'); return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : ''; }
  setBrief(ws, text) { const d = path.join(this.root, 'workspaces', ws); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 'BRIEF.md'), text); }
  remember(ws, bot, note) {
    const line = `\n- ${new Date().toISOString()} — ${note}`;
    fs.appendFileSync(this.botFile(ws, bot), line);
    return line.trim();
  }
}
module.exports = { FileMemory };
