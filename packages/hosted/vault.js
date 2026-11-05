/**
 * vault — per-tenant secrets, encrypted at rest (R2 key vault).
 * AES-256-GCM with a master key from BIPPITY_VAULT_KEY (64 hex chars or
 * base64 of 32 bytes). Stores each tenant's platform + model secrets
 * (Slack/Telegram tokens, model API keys) in vault.json as ciphertext —
 * the relay never sees them; only the tenant's instance decrypts its
 * own entry at boot. A wrong master key fails loudly (GCM auth tag),
 * never silently returns garbage.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function masterKey(env = process.env) {
  const raw = env.BIPPITY_VAULT_KEY || '';
  if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex');
  const b = Buffer.from(raw, 'base64');
  if (b.length === 32) return b;
  return null;
}
class KeyVault {
  constructor(dataRoot, env = process.env) {
    this.key = masterKey(env);
    this.file = path.join(dataRoot, 'hosted', 'vault.json');
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    this.store = {};
    if (fs.existsSync(this.file)) { try { this.store = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { this.store = {}; } }
  }
  status() { return { configured: !!this.key, tenants: Object.keys(this.store).length, note: this.key ? 'Master key set.' : 'Set BIPPITY_VAULT_KEY (32 bytes, hex or base64) to enable the vault.' }; }
  _save() { fs.writeFileSync(this.file, JSON.stringify(this.store, null, 2)); }
  put(tenantId, secrets) {
    if (!this.key) throw new Error('vault not configured (BIPPITY_VAULT_KEY)');
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const enc = Buffer.concat([cipher.update(JSON.stringify(secrets || {}), 'utf8'), cipher.final()]);
    this.store[tenantId] = { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: enc.toString('base64'), updatedAt: new Date().toISOString() };
    this._save();
    return { tenant: tenantId, keys: Object.keys(secrets || {}) };
  }
  get(tenantId) {
    const e = this.store[tenantId];
    if (!e) return null;
    if (!this.key) throw new Error('vault not configured (BIPPITY_VAULT_KEY)');
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, Buffer.from(e.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(e.tag, 'base64'));
    const dec = Buffer.concat([decipher.update(Buffer.from(e.data, 'base64')), decipher.final()]);
    return JSON.parse(dec.toString('utf8'));
  }
  remove(tenantId) { delete this.store[tenantId]; this._save(); }
}
module.exports = { KeyVault, masterKey };
