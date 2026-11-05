/**
 * bot-config — per-bot configuration set from the bot's profile page (v0.18).
 * .data/workspaces/<ws>/bots.json, keyed by bot id:
 *   howIWork:     standing instructions the bot keeps in mind
 *   approvalsMode:'ask' (queue Approve-tier work) | 'just' (run it —
 *                 the owner's explicit choice; Never-tier actions are
 *                 still refused in code, in both modes, always)
 *   thinking:     'auto' | 'low' | 'medium' | 'high'
 *   model:        optional model override ('openai'|'claude'|'grok'|'ollama')
 *   worksOn:      'auto' | 'cloud' | 'local'  (computer preference)
 */
const fs = require('fs');
const path = require('path');

const DEFAULTS = { howIWork: '', approvalsMode: 'ask', thinking: 'auto', model: '', worksOn: 'auto' };
class BotConfigStore {
  constructor(dataRoot) { this.root = path.join(dataRoot, 'workspaces'); }
  file(ws) { return path.join(this.root, ws, 'bots.json'); }
  all(ws) { try { return JSON.parse(fs.readFileSync(this.file(ws), 'utf8')); } catch { return {}; } }
  get(ws, botId) { return { ...DEFAULTS, ...(this.all(ws)[botId] || {}) }; }
  update(ws, botId, patch = {}) {
    const all = this.all(ws);
    const cur = { ...DEFAULTS, ...(all[botId] || {}) };
    if (patch.howIWork !== undefined) cur.howIWork = String(patch.howIWork).slice(0, 2000);
    if (patch.approvalsMode !== undefined) { if (!['ask', 'just'].includes(patch.approvalsMode)) throw new Error('approvalsMode must be ask|just'); cur.approvalsMode = patch.approvalsMode; }
    if (patch.thinking !== undefined) { if (!['auto', 'low', 'medium', 'high'].includes(patch.thinking)) throw new Error('thinking must be auto|low|medium|high'); cur.thinking = patch.thinking; }
    if (patch.model !== undefined) { if (!['', 'openai', 'claude', 'grok', 'ollama'].includes(patch.model)) throw new Error('unknown model'); cur.model = patch.model; }
    if (patch.worksOn !== undefined) { if (!['auto', 'cloud', 'local'].includes(patch.worksOn)) throw new Error('worksOn must be auto|cloud|local'); cur.worksOn = patch.worksOn; }
    all[botId] = cur;
    fs.mkdirSync(path.dirname(this.file(ws)), { recursive: true });
    fs.writeFileSync(this.file(ws), JSON.stringify(all, null, 2));
    return cur;
  }
}
module.exports = { BotConfigStore, BOT_DEFAULTS: DEFAULTS };
