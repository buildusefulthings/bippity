/**
 * reporter — usage reporting between instance and operator (R3 metering).
 * Instances accumulate count-only events locally; the reporter batches
 * them to the operator's POST /api/hosted/usage/report, authenticated
 * with the tenant's instanceSecret (header x-bippity-relay-secret).
 * The operator side (verifyReport) checks the secret against the
 * registry before appending anything to its meter — a tenant can only
 * ever report its OWN usage. Events carry no content, only counts.
 */
const KINDS = ['brief', 'approval', 'delivery', 'model_tokens'];
function sanitizeEvents(events) {
  if (!Array.isArray(events)) return [];
  return events.filter((e) => e && KINDS.includes(e.kind) && Number.isFinite(e.n) && e.n > 0 && e.n <= 100000)
    .map((e) => ({ kind: e.kind, n: Math.floor(e.n), at: typeof e.at === 'string' ? e.at : new Date().toISOString() }));
}
function verifyReport(registry, tenantId, secret) {
  const t = registry.byId(tenantId);
  if (!t) return { ok: false, error: 'unknown tenant' };
  if (!secret || secret !== t.instanceSecret) return { ok: false, error: 'bad instance secret' };
  return { ok: true, tenant: t };
}
async function reportUsage({ baseUrl, tenantId, instanceSecret, events, fetchFn = globalThis.fetch }) {
  const clean = sanitizeEvents(events);
  if (!clean.length) return { ok: true, sent: 0 };
  const r = await fetchFn(String(baseUrl).replace(/\/$/, '') + '/api/hosted/usage/report', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-bippity-relay-secret': instanceSecret },
    body: JSON.stringify({ tenant: tenantId, events: clean }),
  });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok && j.ok !== false, sent: clean.length, response: j };
}
module.exports = { KINDS, sanitizeEvents, verifyReport, reportUsage };
