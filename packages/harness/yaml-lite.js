/**
 * yaml-lite — a tiny parser for the subset of YAML bippity config files use:
 * top-level scalars, inline [a, b] lists, one level of nested maps, and
 * block lists ("- item" / "- key" under a key). No external deps, so the
 * runtime runs on a bare Node install. Not a general YAML parser.
 */
function parseScalar(v) {
  v = String(v).trim();
  if (v.startsWith('[') && v.endsWith(']')) {
    const inner = v.slice(1, -1).trim();
    return inner ? inner.split(',').map((s) => parseScalar(s)) : [];
  }
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) return v.slice(1, -1);
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return v;
}

function parse(text) {
  const root = {};
  const lines = String(text).split(/\r?\n/);
  let currentKey = null;      // key whose block list/map we are filling
  let currentItem = null;     // current list-of-maps item
  let currentSubKey = null;   // nested map key inside currentKey
  for (const raw of lines) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    const indent = raw.length - raw.trimStart().length;
    const line = raw.trim();
    if (indent === 0) {
      const m = line.match(/^([\w-]+):\s*(.*)$/);
      if (!m) continue;
      currentKey = m[1]; currentItem = null; currentSubKey = null;
      root[currentKey] = m[2] === '' ? undefined : parseScalar(m[2]);
    } else if (line.startsWith('- ')) {
      const item = line.slice(2).trim();
      if (root[currentKey] === undefined) root[currentKey] = [];
      if (!Array.isArray(root[currentKey])) root[currentKey] = [root[currentKey]];
      const kv = item.match(/^([\w-]+):\s*(.*)$/);
      if (kv && indent >= 2) { currentItem = {}; currentItem[kv[1]] = kv[2] ? parseScalar(kv[2]) : ''; root[currentKey].push(currentItem); }
      else { root[currentKey].push(parseScalar(item)); currentItem = null; }
    } else {
      const m = line.match(/^([\w-]+):\s*(.*)$/);
      if (!m) continue;
      if (currentItem && indent >= 4) { currentItem[m[1]] = m[2] ? parseScalar(m[2]) : ''; }
      else {
        if (root[currentKey] === undefined || typeof root[currentKey] !== 'object' || Array.isArray(root[currentKey])) root[currentKey] = {};
        currentSubKey = m[1];
        root[currentKey][currentSubKey] = m[2] === '' ? [] : parseScalar(m[2]);
        // "key:" with block list following on deeper indent
        if (m[2] === '') root[currentKey][currentSubKey] = undefined;
      }
    }
    // block list under a nested subkey, e.g. tiers: -> auto: -> - item
    if (line.startsWith('- ') && currentSubKey && root[currentKey] && typeof root[currentKey] === 'object' && !Array.isArray(root[currentKey])) {
      if (indent >= 4) {
        if (!Array.isArray(root[currentKey][currentSubKey])) root[currentKey][currentSubKey] = [];
        root[currentKey][currentSubKey].push(parseScalar(line.slice(2).trim()));
        if (Array.isArray(root[currentKey])) root[currentKey] = root[currentKey]; // no-op guard
      }
    }
  }
  for (const k of Object.keys(root)) if (root[k] === undefined) root[k] = {};
  return root;
}
module.exports = { parse };
