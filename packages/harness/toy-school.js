/**
 * toy-school — a pre-populated fictional school for instant testing.
 * One click loads Willow Creek Microschool (the pack's fiction) into the
 * enrollment workspace: school profile, founder, Knowledge, bot setup,
 * a routine, and real queued approvals from real briefs — so every
 * screen has something true to show without typing a school each time.
 * Clearly fictional; reset wipes and reloads it.
 */
const fs = require('fs');
const path = require('path');

const PROFILE = {
  schoolName: 'Willow Creek Microschool', city: 'Eugene, Oregon', ages: ['5–7', '8–11'],
  seats: '22', seatsOpen: '2', tuition: '$8,000/yr', tourDays: ['Tuesday', 'Thursday'], tourTimes: '9:30 AM and 1:00 PM',
  approach: ['Play-based', 'Outdoor / nature', 'Small classes'], channels: ['Website form', 'Email', 'Instagram'],
  about: 'A former orchard barn turned into a sunlit classroom. Kids spend mornings on core skills in mixed-age groups, afternoons outside — garden, creek, and a much-loved mud kitchen. Two teachers, never more than 22 kids.',
  faqs: 'Do you offer part-time? (No — full-time only, it keeps the group steady.) Is lunch provided? (Families pack lunch; Friday is pizza day.) What ages? (5–11, mixed-age classrooms.)',
  neverPromise: ['a seat or start date', 'a tuition discount'], neverNotes: 'Aid questions go straight to Robin, kindly and quickly.',
  founderName: 'Robin Ellis', founderEmail: 'robin@willowcreek.example',
};

function schoolMd(p) {
  return ['# ' + p.schoolName, '', `Location: ${p.city} · Ages: ${p.ages.join(', ')} · Seats: ${p.seats} (${p.seatsOpen} open) · Tuition: ${p.tuition}`, `Tours: ${p.tourDays.join(', ')} — ${p.tourTimes}`, `Approach: ${p.approach.join(', ')}`, '', '## What makes this school special', p.about, '', '## Questions families always ask', p.faqs, '', '## Never promise', p.neverPromise.join(', ') + ' — ' + p.neverNotes, '', `Inquiries arrive via: ${p.channels.join(', ')}`].join('\n');
}

const KNOWLEDGE = [
  { type: 'people', title: 'Patel family — toured, deciding', detail: 'Daughter Amara, 7. Loved the garden. Comparing one other school; Robin said take the weekend.', source: 'Toy school' },
  { type: 'people', title: 'Nguyen family — waitlist #1', detail: 'Son Leo, 6. First call if a seat opens (promised by Robin).', source: 'Toy school' },
  { type: 'people', title: 'Alvarez family — application complete', detail: 'Daughter Sofia, 8. Application in; deposit step is next.', source: 'Toy school' },
  { type: 'promises', title: 'Nguyen family gets the first call', detail: 'If any seat opens, the Nguyens hear before the opening is posted anywhere.', source: 'Toy school' },
  { type: 'events', title: 'Thursday tours — 9:30 AM', detail: 'Two families booked. Tess has the greeter list and the waiver forms.', source: 'Toy school' },
  { type: 'tasks', title: 'Friday: spring tuition reminders', detail: 'Robin sends the spring tuition reminder herself on Friday — bots draft, she sends.', source: 'Toy school' },
  { type: 'preferences', title: 'Voice: warm, plain-spoken, short', detail: 'Family messages stay under ~120 words. No exclamation marks in deposit emails.', source: 'Toy school' },
];

const BRIEFS = [
  'New inquiry from the Hartley family (website form): two kids, 6 and 8 — is there room, and can they tour next week?',
  'The Brooks family toured on Tuesday but did not show up. Follow up kindly and offer Thursday 9:30 or 1:00.',
  "The Alvarez family's application is complete — please start the deposit step for Sofia's seat.",
];

const ROUTINE = { name: 'Inquiry roundup', text: 'Every weekday at 8:30, summarize new inquiries', cadenceText: 'Every weekday at 8:30', kind: 'schedule', schedule: { freq: 'weekday', hour: 8, minute: 30 }, cents: 0, nextRunAt: null };

function isSeeded(ws) { return ws.knowledge.list(ws.id).length > 0; }

async function seedToySchool(ws) {
  if (isSeeded(ws)) return { seeded: false, reason: 'This workspace already has data — Reset the toy school to reload it.' };
  fs.writeFileSync(path.join(ws.dir, 'SCHOOL.md'), schoolMd(PROFILE));
  ws.settings.update(ws.id, { profile: { name: PROFILE.founderName, email: PROFILE.founderEmail } });
  ws.knowledge.add(ws.id, { type: 'companies', title: PROFILE.schoolName, detail: `${PROFILE.city} · ${PROFILE.seats} seats, ${PROFILE.seatsOpen} open · tuition ${PROFILE.tuition}`, source: 'Toy school' });
  for (const np of PROFILE.neverPromise) ws.knowledge.add(ws.id, { type: 'decisions', title: 'Never promise: ' + np, detail: 'Set by the founder. Bots must not commit to this; escalate to Robin.', source: 'Toy school' });
  for (const k of KNOWLEDGE) ws.knowledge.add(ws.id, k);
  ws.botConfig.update(ws.id, 'chief', { howIWork: 'Keep replies short. Always show me the seat math. Never contact a family before 8 AM. Drafts in our voice: warm, plain-spoken, no exclamation marks in money emails.' });
  let approvals = 0;
  for (const b of BRIEFS) { const r = await ws.brief(b, 'toy-school'); if (r.type === 'queued') approvals++; }
  return { seeded: true, school: PROFILE.schoolName, knowledge: ws.knowledge.list(ws.id).length, approvals, routine: ROUTINE };
}

function resetToySchool(ws) {
  ws.state = { approvals: [], log: [], counters: { done: 0, approved: 0, refused: 0 }, seq: 0 };
  ws._save();
  for (const f of ['knowledge.json', 'bots.json', 'settings.json', 'routines.json', 'SCHOOL.md']) { try { fs.unlinkSync(path.join(ws.dir, f)); } catch { /* absent is fine */ } }
  try { fs.unlinkSync(path.join(ws.dataRoot, 'workspaces', ws.id, 'skills-state.json')); } catch { /* noop */ }
  return { reset: true };
}
module.exports = { seedToySchool, resetToySchool, isSeeded, TOY_PROFILE: PROFILE, TOY_ROUTINE: ROUTINE };
