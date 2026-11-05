/**
 * routine-parse — turn a plain sentence into a routine or a watch (v0.12).
 *   "Every weekday at 8:30, summarize my inbox"     -> schedule
 *   "Every Friday at 5 PM, send me the week in review" -> schedule
 *   "Every day at 7, morning brief"                 -> schedule
 *   "Watch https://example.com/prices and tell me when the price drops" -> http watch (change)
 * Deliberately small and strict: if the sentence doesn't parse, we say
 * so (null) instead of guessing a schedule the owner didn't mean.
 */
const DAYS = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
function parseTime(s) {
  const m = String(s).trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!m) return null;
  let h = Number(m[1]); const min = Number(m[2] || 0);
  if (m[3]) { const pm = m[3].toLowerCase() === 'pm'; if (h === 12) h = pm ? 12 : 0; else if (pm) h += 12; }
  if (h > 23 || min > 59) return null;
  return String(h).padStart(2, '0') + ':' + String(min).padStart(2, '0');
}
function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'routine'; }
function parseRoutineText(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const watch = raw.match(/^watch\s+(https?:\/\/\S+)\s*(.*)$/i);
  if (watch) {
    const url = watch[1];
    return { kind: 'watch', watch: { name: 'watch-' + slug(new URL(url).hostname.replace(/^www\./, '')), type: 'http', target: url, intervalMin: 15, brief: `The page at ${url} changed — take a look and tell me what changed, and whether it affects us.` } };
  }
  const m = raw.match(/^every\s+(weekdays?|weekends?|day|daily|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\s+at\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*[,—-]\s*(.+)$/i);
  if (!m) return null;
  const at = parseTime(m[2]); if (!at) return null;
  const word = m[1].toLowerCase();
  let days;
  if (word.startsWith('weekday')) days = [1, 2, 3, 4, 5];
  else if (word.startsWith('weekend')) days = [0, 6];
  else if (word === 'day' || word === 'daily') days = [0, 1, 2, 3, 4, 5, 6];
  else days = [DAYS[word]];
  const brief = m[3].trim();
  if (!brief) return null;
  return { kind: 'schedule', routine: { name: slug(brief.split(/\s+/).slice(0, 3).join(' ')) + '-' + at.replace(':', ''), at, days, brief } };
}
const DAYNAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function describeSchedule(r) {
  const days = !r.days || r.days.length === 7 ? 'every day' : r.days.length === 5 && r.days.join() === '1,2,3,4,5' ? 'weekdays' : r.days.map((d) => DAYNAMES[d]).join(', ');
  return `${days} at ${r.at}`;
}
module.exports = { parseRoutineText, describeSchedule, parseTime };
