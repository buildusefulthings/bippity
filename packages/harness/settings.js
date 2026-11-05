/**
 * settings — per-workspace settings (v0.11), file-backed.
 * .data/workspaces/<ws>/settings.json. Whitelisted keys only:
 *   profile: { name, email }     — the owner's local profile (never sent anywhere)
 *   askPolicy: 'everyone' | 'up_and_down'  — who bots may ask (org chart)
 * Today every request already flows through Chief, so both policies are
 * compliant with the current runtime; the setting records the owner's
 * policy and gates bot-to-bot asks as they are added.
 */
const fs = require('fs');
const path = require('path');

const DEFAULTS = { profile: { name: '', email: '' }, askPolicy: 'everyone' };
class WorkspaceSettings {
  constructor(dataRoot) { this.root = path.join(dataRoot, 'workspaces'); }
  file(ws) { return path.join(this.root, ws, 'settings.json'); }
  get(ws) {
    try { const j = JSON.parse(fs.readFileSync(this.file(ws), 'utf8')); return { ...structuredClone(DEFAULTS), ...j, profile: { ...DEFAULTS.profile, ...(j.profile || {}) } }; }
    catch { return structuredClone(DEFAULTS); }
  }
  update(ws, patch = {}) {
    const cur = this.get(ws);
    if (patch.profile) { cur.profile.name = String(patch.profile.name || '').slice(0, 80); cur.profile.email = String(patch.profile.email || '').slice(0, 120); }
    if (patch.askPolicy) { if (!['everyone', 'up_and_down'].includes(patch.askPolicy)) throw new Error('askPolicy must be everyone|up_and_down'); cur.askPolicy = patch.askPolicy; }
    fs.mkdirSync(path.dirname(this.file(ws)), { recursive: true });
    fs.writeFileSync(this.file(ws), JSON.stringify(cur, null, 2));
    return cur;
  }
}
module.exports = { WorkspaceSettings, SETTINGS_DEFAULTS: DEFAULTS };
