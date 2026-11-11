'use strict';
/* Stake Youth — calendar, leader assignments, and project planning for stake youth activities.
   Static page, no build step. Live data goes through PIN-checked Supabase RPCs (supabase/schema.sql)
   when config.js has keys; otherwise a demo that saves to this device only. */

const CFG = window.SYA_CONFIG || {};
const DEMO = new URLSearchParams(location.search).has('demo');   // add ?demo to the address to try things without touching live data
const LIVE = !!(CFG.supabaseUrl && CFG.supabaseAnonKey) && !DEMO;
const KEY = { person: 'people', event: 'events', project: 'projects', task: 'tasks', plan: 'plan' };
// Demo mode keeps its own sign-in so trying it never signs this device out of the live app.
const PIN_KEY = DEMO ? 'sya_demo_pin' : 'sya_pin';
const ME_KEY = DEMO ? 'sya_demo_me' : 'sya_me';

/* ---------- helpers ---------- */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36));
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const today = () => iso(new Date());
const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / 864e5);
const fmtDate = (s, o = { month: 'short', day: 'numeric' }) => (s ? parse(s).toLocaleDateString(undefined, o) : '');
const fmtTime = t => {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
};
// "10:00–10:20 AM" when both ends share AM/PM, so schedule rows stay on one line.
const fmtRange = (a, b) => {
  if (!a) return '';
  if (!b) return fmtTime(a);
  const A = fmtTime(a), B = fmtTime(b);
  return (A.slice(-2) === B.slice(-2) ? A.slice(0, -3) : A) + '–' + B;
};
const firstName = n => String(n || '').split(/\s+/)[0];
const initials = n => String(n || '?').split(/\s+/).filter(w => /^[A-Za-z]/.test(w)).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '?';
const byName = (a, b) => a.name.localeCompare(b.name);
const byDue = (a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999') || a.title.localeCompare(b.title);
const byEventDate = (a, b) => a.start_date.localeCompare(b.start_date) || (a.start_time || '').localeCompare(b.start_time || '');
const byProjectDate = (a, b) => (a.event_date || '9999').localeCompare(b.event_date || '9999');
const byAgenda = (a, b) => (a.day || '').localeCompare(b.day || '') || (a.start_time || '').localeCompare(b.start_time || '') || (a.sort || 0) - (b.sort || 0) || a.title.localeCompare(b.title);
const num = v => (v === '' || v == null || isNaN(Number(v)) ? null : Number(v));
const money = n => (n == null || isNaN(n) ? '' : (n < 0 ? '-$' : '$') + Math.abs(Number(n)).toLocaleString(undefined, { maximumFractionDigits: 2 }));
const sum = (list, k) => list.reduce((t, x) => t + (Number(x[k]) || 0), 0);
const monthLabel = m => fmtDate(m + '-01', { month: 'long', year: 'numeric' });

const store = {
  get(k) { try { return localStorage.getItem(k) ?? sessionStorage.getItem(k); } catch { return null; } },
  set(k, v, remember = true) { try { (remember ? localStorage : sessionStorage).setItem(k, v); } catch { /* private mode */ } },
  del(k) { try { localStorage.removeItem(k); sessionStorage.removeItem(k); } catch { /* private mode */ } },
};

/* ---------- reference lists ---------- */
const CATEGORIES = ['Stake activity', 'Youth conference', 'FSY', 'Devotional', 'Service', 'Temple', 'Camp', 'Mission prep', 'Choir', 'Dance practice', 'Institute', 'Leadership meeting', 'Other'];
const AUDIENCES = ['All youth', 'Seniors', 'Young men', 'Young women', 'Youth leaders', 'Youth and leaders', 'Adult leaders'];
const PROJECT_KINDS = ['Youth conference', 'Stake activity', 'Devotional', 'Service project', 'Temple trip', 'Camp', 'Other'];
const STATUSES = { planning: 'Planning', active: 'In progress', done: 'Done', cancelled: 'Cancelled' };
const ROLES = [
  'Stake Presidency', 'High Councilor', 'Stake Young Men President', 'Stake Young Men Counselor', 'Stake Young Men Secretary',
  'Stake Young Women President', 'Stake Young Women Counselor', 'Stake Young Women Secretary', 'Bishopric', 'Ward Young Women President',
  'Young Men Adviser', 'Young Women Adviser', 'Specialist',
  'Priests quorum assistant', 'Teachers quorum president', 'Deacons quorum president', 'Young Women class president', 'Stake youth committee',
];

// Plan lines hang off an event or a project. kind: agenda (schedule), list (food, set-up, to bring), budget.
const LIST_SECTIONS = ['Program', 'Food', 'Set up', 'To bring', 'Communication', 'Safety'];
const WHO_GROUPS = ['YM presidency', 'YW presidency', 'Co-chairs', 'Seniors', 'Chaperones'];
const AGENDA_MODES = { full: 'Full', seniors: 'Seniors', chaperones: 'Chaperones', high: 'High level' };
const AGENDA_FOR = ['Seniors', 'Chaperones', 'Adult leaders'];   // blank = everyone
const CAL_FILTERS = { all: 'All', seniors: 'Seniors', syc: 'SYC', leaders: 'Leader meetings', needs: 'Needs attention' };
// Starter checklist for a senior activity. Every line can be edited or removed.
const EVENT_STARTER = [
  ['Program', 'Conducting'], ['Program', 'Opening prayer'], ['Program', 'Spiritual thought'],
  ['Food', 'Main dish'], ['Food', 'Sides and dessert'], ['Food', 'Drinks and ice'], ['Food', 'Paper products'],
  ['Set up', 'Tables and chairs'], ['Set up', 'Activity supplies'],
  ['Communication', 'Invite the seniors and collect RSVPs'], ['Communication', 'Ask seminary teachers to announce it'],
  ['Safety', 'Permission slips if it is off-site or overnight'],
];

// Planning checklist for a project. Days are relative to the project's event date; every task can be edited or removed.
const CHECKLIST = [
  ['Planning', 'Meet with youth leaders to set the purpose and theme', -120],
  ['Planning', 'Get stake presidency approval for the date, purpose, and budget', -110],
  ['Planning', 'Reserve the building or venue', -100],
  ['Planning', 'Add the event to the stake calendar and tell the bishops', -90],
  ['Program', 'Plan the devotional and spiritual program with the youth', -60],
  ['Program', 'Invite speakers', -60],
  ['Activities', 'Plan activities and any service project', -45],
  ['Communication', 'Send the announcement to wards and youth leaders', -45],
  ['Food', 'Plan the menu and food assignments; ask about allergies', -30],
  ['Transportation', 'Arrange transportation and drivers', -21],
  ['Safety', 'Collect parent permission and medical release forms', -14],
  ['Safety', 'Plan for at least two responsible adults at every activity (GH 10.8.1)', -14],
  ['Safety', 'Make an emergency plan: first aid, contacts, nearest hospital', -14],
  ['Communication', 'Send a reminder to wards and families', -7],
  ['Follow-up', 'Turn in receipts for reimbursement', 7],
  ['Follow-up', 'Send thank-you notes to helpers', 7],
  ['Follow-up', 'Debrief with youth leaders: what to keep, change, or try next time', 14],
];
const AREA_ORDER = [...new Set(CHECKLIST.map(c => c[0]))];
const checklistTasks = p => CHECKLIST.map(([area, title, off]) => ({
  title, area, project_id: p.id, owner_id: null, notes: '', done: false,
  due_date: p.event_date ? addDays(p.event_date, off) : null,
}));

const CH = 'https://www.churchofjesuschrist.org';
const RESOURCES = [
  ['Youth home page', '/study/youth?lang=eng', 'Starting point for all youth resources.'],
  ['Program Instruction for Youth', '/study/youth/program-instruction-for-youth?lang=eng', 'How the youth program works and how leaders support it.'],
  ['General Handbook, chapter 10', '/study/manual/general-handbook/10-aaronic-priesthood?lang=eng', 'Aaronic Priesthood: stake Young Men leaders (10.7), activities (10.2.1.3), and safeguarding youth (10.8.1).'],
  ['Youth Activity Ideas', '/study/youth/youth-activity-ideas?lang=eng', 'Ideas for activities and service.'],
  ['Youth Theme Experiences', '/study/youth/youth-theme-experiences?lang=eng', 'Material built around this year\'s youth theme.'],
  ['FSY Conferences', '/study/manual/for-the-strength-of-youth-conferences?lang=eng', 'For the Strength of Youth conference information.'],
  ['For the Strength of Youth guide', '/study/manual/for-the-strength-of-youth?lang=eng', 'The guide for making choices.'],
  ['For the Strength of Youth magazine', '/study/youth/for-the-strength-of-youth-magazine?lang=eng', 'Monthly magazine for youth.'],
  ['Preparing for the Future', '/study/youth/preparing-for-the-future?lang=eng', 'Help for youth planning missions, school, and work.'],
];

const ICON = {
  home: '<svg viewBox="0 0 24 24"><path d="M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z"/></svg>',
  calendar: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
  tasks: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="m8 12 3 3 5-6"/></svg>',
  projects: '<svg viewBox="0 0 24 24"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  more: '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>',
  shield: '<svg viewBox="0 0 24 24"><path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/></svg>',
  people: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.5 3.3-5.5 6.5-5.5s5.7 2 6.5 5.5M16 4.5a3.5 3.5 0 0 1 0 7M18 14.8c1.9.8 3.1 2.6 3.5 5.2"/></svg>',
  book: '<svg viewBox="0 0 24 24"><path d="M4 5a2 2 0 0 1 2-2h14v16H6a2 2 0 0 0-2 2z"/><path d="M4 21V5"/></svg>',
  gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/></svg>',
  user: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21c1-4 4-6 8-6s7 2 8 6"/></svg>',
  out: '<svg viewBox="0 0 24 24"><path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 8l-4 4 4 4M6 12h10"/></svg>',
  alert: '<svg viewBox="0 0 24 24"><path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17v.5"/></svg>',
};

/* ---------- data access ---------- */
async function rpc(fn, args) {
  const r = await fetch(`${CFG.supabaseUrl.replace(/\/$/, '')}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    // Legacy anon keys are JWTs and go in both headers; sb_publishable_ keys go in apikey only.
    headers: { 'Content-Type': 'application/json', apikey: CFG.supabaseAnonKey, ...(CFG.supabaseAnonKey.startsWith('ey') ? { Authorization: 'Bearer ' + CFG.supabaseAnonKey } : {}) },
    body: JSON.stringify(args),
  });
  let body = null;
  try { body = await r.json(); } catch { /* empty body */ }
  if (!r.ok) throw new Error((body && body.message) || `Server error ${r.status}`);
  if (body && body.error) throw new Error(body.error);
  return body;
}

const api = LIVE ? {
  load: pin => rpc('sya_load', { p_pin: pin }),
  save: (pin, actor, kind, row) => rpc('sya_save', { p_pin: pin, p_actor: actor, p_kind: kind, p_row: row }),
  remove: (pin, actor, kind, id) => rpc('sya_delete', { p_pin: pin, p_actor: actor, p_kind: kind, p_id: id }),
  taskDone: (pin, actor, id, done) => rpc('sya_task_done', { p_pin: pin, p_actor: actor, p_id: id, p_done: done }),
  setPin: (pin, which, next) => rpc('sya_set_pin', { p_pin: pin, p_which: which, p_new: next }),
} : demoApi();

function demoApi() {
  const K = 'sya_demo_v2';
  let db = null;
  try { db = JSON.parse(localStorage.getItem(K)); } catch { /* ignore */ }
  if (!db) db = demoSeed();
  if (!db.plan) db.plan = [];
  const persist = () => { try { localStorage.setItem(K, JSON.stringify(db)); } catch { /* ignore */ } };
  persist();
  const clone = x => JSON.parse(JSON.stringify(x));
  const need = (pin, adult) => {
    const r = pin === '1111' ? 'adult' : pin === '2222' ? 'youth' : null;
    if (!r) throw new Error('Wrong PIN.');
    if (adult && r !== 'adult') throw new Error('Only adult leaders can make changes.');
    return r;
  };
  return {
    async load(pin) {
      const role = need(pin);
      const d = clone(db);
      if (role !== 'adult') d.plan = d.plan.filter(x => x.kind !== 'budget');   // budget is for adult leaders
      return { role, ...d };
    },
    async save(pin, actor, kind, row) {
      need(pin, true);
      if (kind === 'setting') { db.settings[row.key] = row.value; persist(); return row; }
      const list = db[KEY[kind]];
      const now = new Date().toISOString();
      const r = { ...row, id: row.id || uid(), updated_by: actor, updated_at: now };
      let i = list.findIndex(x => x.id === r.id);
      if (i >= 0) list[i] = { ...list[i], ...r };
      else { list.push({ created_at: now, created_by: actor, done: false, ...r }); i = list.length - 1; }
      persist();
      return clone(list[i]);
    },
    async remove(pin, actor, kind, id) {
      need(pin, true);
      db[KEY[kind]] = db[KEY[kind]].filter(x => x.id !== id);
      if (kind === 'project') {
        db.tasks = db.tasks.filter(t => t.project_id !== id);
        db.events.forEach(e => { if (e.project_id === id) e.project_id = null; });
        db.plan = db.plan.filter(x => x.project_id !== id);
      }
      if (kind === 'event') {
        db.tasks = db.tasks.filter(t => t.event_id !== id);
        db.plan = db.plan.filter(x => x.event_id !== id);
      }
      if (kind === 'person') {
        db.tasks.forEach(t => { if (t.owner_id === id) t.owner_id = null; });
        db.events.forEach(e => { e.adults = (e.adults || []).filter(a => a !== id); });
        db.projects.forEach(p => { if (p.adult_lead === id) p.adult_lead = null; if (p.youth_lead === id) p.youth_lead = null; });
      }
      persist();
      return { ok: true };
    },
    async taskDone(pin, actor, id, done) {
      const role = need(pin);
      const t = db.tasks.find(x => x.id === id);
      if (!t) throw new Error('Not found.');
      const owner = db.people.find(p => p.id === t.owner_id);
      if (role !== 'adult' && (!owner || owner.name.toLowerCase() !== actor.toLowerCase())) throw new Error('You can only check off your own tasks.');
      Object.assign(t, { done, done_at: done ? new Date().toISOString() : null, done_by: done ? actor : null });
      persist();
      return clone(t);
    },
    async setPin() { throw new Error('Demo PINs are fixed: 1111 for adults, 2222 for youth.'); },
    reset() { db = demoSeed(); persist(); },
  };
}

function demoSeed() {
  const t = today();
  const P = (name, role, ward, kind) => ({ id: uid(), name, role, ward, kind, active: true });
  const pres = P('Stake YM President (sample)', 'Stake Young Men President', 'Stake', 'adult');
  const sec = P('Stake YM Secretary (sample)', 'Stake Young Men Secretary', 'Stake', 'adult');
  const yw = P('Stake YW President (sample)', 'Stake Young Women President', 'Stake', 'adult');
  const bish = P('Bishopric Counselor (sample)', 'Bishopric', 'Ward 1', 'adult');
  const y1 = P('Youth Leader A (sample)', 'Priests quorum assistant', 'Ward 1', 'youth');
  const y2 = P('Youth Leader B (sample)', 'Young Women class president', 'Ward 2', 'youth');
  const yc = {
    id: uid(), title: 'Stake Youth Conference (sample)', kind: 'Youth conference', event_date: addDays(t, 75), status: 'planning',
    purpose: 'Sample project. Replace it with your real one.', notes: '', adult_lead: pres.id, youth_lead: y1.id,
  };
  const owners = [sec.id, pres.id, yw.id, y1.id, y2.id];
  const tasks = checklistTasks(yc).map((x, i) => ({ ...x, id: uid(), owner_id: owners[i % owners.length], done: i < 2 }));
  tasks.push({ id: uid(), title: 'Send the stake youth calendar to bishops (sample)', owner_id: sec.id, due_date: addDays(t, -2), area: '', project_id: null, notes: '', done: false });
  tasks.push({ id: uid(), title: 'Confirm the devotional speaker (sample)', owner_id: pres.id, due_date: addDays(t, 4), area: '', project_id: null, notes: '', done: false });
  const ev = (title, category, start_date, extra) => ({
    id: uid(), title, category, start_date, end_date: null, start_time: '', end_time: '', location: '', audience: 'All youth',
    description: '', project_id: null, adults: [], info_only: false, recap: '', youth_count: null, adult_count: null, ...extra,
  });
  const events = [
    ev('Stake Youth Conference (sample)', 'Youth conference', yc.event_date, { end_date: addDays(yc.event_date, 2), location: '[FILL IN]', project_id: yc.id, adults: [pres.id, yw.id] }),
    ev('Stake youth leadership committee (sample)', 'Leadership meeting', addDays(t, 5), { start_time: '19:00', end_time: '20:00', location: 'Stake center', audience: 'Youth and leaders', adults: [pres.id, sec.id] }),
    ev('Stake youth devotional (sample)', 'Devotional', addDays(t, 20), { start_time: '19:00', end_time: '20:00', location: 'Stake center', adults: [pres.id] }),
  ];
  const act = ev('Senior activity (sample)', 'Stake activity', addDays(t, 12), { start_time: '10:00', end_time: '12:00', audience: 'Seniors', adults: [yw.id] });
  const last = ev('Senior cabin trip (sample)', 'Stake activity', addDays(t, -20), { end_date: addDays(t, -19), audience: 'Seniors', location: '[FILL IN]', adults: [pres.id, yw.id], youth_count: 30, adult_count: 6, recap: 'Sample recap. Write what to keep and what to change next time.' });
  events.push(act, last, ev('General conference (sample)', 'Other', addDays(t, 30), { end_date: addDays(t, 31), info_only: true }));
  const L = (kind, o) => ({ id: uid(), kind, project_id: null, event_id: null, title: '', section: '', day: null, start_time: '', end_time: '', location: '', who: '', qty: '',
    planned: null, actual: null, done: false, notes: '', detail: '', av: '', senior_notes: '', chaperone_notes: '', high_level: false, sort: 0, ...o });
  const d1 = yc.event_date, d2 = addDays(yc.event_date, 1);
  const plan = [
    L('agenda', { event_id: act.id, day: act.start_date, start_time: '10:00', end_time: '10:20', title: 'Welcome, prayer, spiritual thought', who: 'Co-chairs' }),
    L('agenda', { event_id: act.id, day: act.start_date, start_time: '10:20', end_time: '11:15', title: 'Activity' }),
    L('agenda', { event_id: act.id, day: act.start_date, start_time: '11:15', end_time: '12:00', title: 'Lunch and clean up' }),
    L('list', { event_id: act.id, section: 'Food', title: 'Main dish', who: 'YW presidency' }),
    L('list', { event_id: act.id, section: 'Food', title: 'Drinks and ice', who: 'YM presidency', done: true }),
    L('list', { event_id: act.id, section: 'Set up', title: 'Tables and chairs', qty: '6 tables', who: 'YM presidency' }),
    L('budget', { event_id: act.id, title: 'Food (sample)', planned: 150, actual: 40 }),
    L('agenda', { event_id: last.id, day: last.start_date, start_time: '18:30', end_time: '19:00', title: 'Dinner' }),
    L('list', { event_id: last.id, section: 'Food', title: 'Breakfast', who: 'YM presidency', done: true }),
    L('agenda', { project_id: yc.id, day: d1, title: 'Day theme goes here (sample)', high_level: true }),
    L('agenda', { project_id: yc.id, day: d1, start_time: '12:45', end_time: '13:00', title: 'Youth arrive and check in', location: 'Gym', high_level: true, senior_notes: 'Wear your group color.', chaperone_notes: 'Welcome the youth in your group.' }),
    L('agenda', { project_id: yc.id, day: d1, start_time: '12:15', end_time: '12:45', title: 'Senior meeting', location: 'Band room', section: 'Seniors', detail: 'Conducting:\nOpening prayer:\nPreview the day' }),
    L('agenda', { project_id: yc.id, day: d1, start_time: '13:00', end_time: '14:00', title: 'Opening meeting', location: 'Main hall', who: 'Co-chairs', av: 'Microphone, slides', notes: 'Set up 200 chairs', high_level: true,
      detail: 'Conducting:\nTheme song\nOpening prayer:\nWelcome and theme:\nClosing prayer:' }),
    L('agenda', { project_id: yc.id, day: d1, start_time: '14:00', end_time: '15:00', title: 'Group games', location: 'Field', senior_notes: 'Seniors lead the games.' }),
    L('agenda', { project_id: yc.id, day: d2, start_time: '08:30', end_time: '09:00', title: 'All-youth meeting', location: 'Main hall', high_level: true }),
    L('budget', { project_id: yc.id, section: 'approved', title: 'Approved budget', planned: 1000 }),
    L('budget', { project_id: yc.id, title: 'Food (sample)', planned: 600, actual: 120 }),
    L('budget', { project_id: yc.id, title: 'T-shirts (sample)', planned: 250 }),
  ];
  tasks.push({ id: uid(), title: 'Buy food for the senior activity (sample)', owner_id: yw.id, due_date: addDays(t, 10), area: '', project_id: null, event_id: act.id, notes: '', done: false });
  return {
    settings: { stake_name: 'Demo Stake', wards: 'Ward 1\nWard 2\nWard 3' },
    people: [pres, sec, yw, bish, y1, y2], projects: [yc], events, tasks, plan,
  };
}

/* ---------- state ---------- */
const S = {
  pin: null, role: null, me: null, data: null, view: 'home', sub: null, back: null, filter: 'mine', month: null, day: null, kind: 'adult', err: '', loadedAt: 0,
  calFilter: 'all', calMode: 'month', calPast: false,            // calendar
  ptab: 'overview', pfilter: 'all', open: new Set(), amode: 'full',   // project page
};
const isAdult = () => S.role === 'adult';
const byId = (list, id) => (id ? S.data[list].find(x => x.id === id) : null);
const personName = id => (byId('people', id) || {}).name || '';
const wards = () => String(S.data.settings.wards || '').split('\n').map(w => w.trim()).filter(Boolean);
const isMine = x => {
  if (S.me.id) return x.owner_id === S.me.id;
  return personName(x.owner_id).toLowerCase() === S.me.name.toLowerCase();
};
const canToggle = x => isAdult() || isMine(x);
const eventsOn = (d, list = S.data.events) => list.filter(e => e.start_date <= d && (e.end_date || e.start_date) >= d).sort(byEventDate);
const youthEvent = e => e.audience !== 'Adult leaders';
const upcoming = e => (e.end_date || e.start_date) >= today();
const isSyc = e => e.category === 'Youth conference' || (byId('projects', e.project_id) || {}).kind === 'Youth conference';
const planFor = (kind, scope) => S.data.plan.filter(x => x.kind === kind && (scope.project ? x.project_id === scope.project : x.event_id === scope.event));
const eventTasks = id => S.data.tasks.filter(x => x.event_id === id);
// What an event still needs before it is ready. Calendar notes (info_only) need nothing.
function needs(e) {
  if (e.info_only) return [];
  const n = [];
  if (!e.location) n.push('a location');
  if (!e.start_time && !e.end_date) n.push('a time');
  if (youthEvent(e) && e.adults.length < 2) n.push(e.adults.length ? '1 more adult leader' : '2 adult leaders');
  return n;
}
function calEvents() {
  const f = S.calFilter;
  return S.data.events.filter(e => f === 'seniors' ? e.audience === 'Seniors'
    : f === 'syc' ? isSyc(e)
    : f === 'leaders' ? e.audience === 'Adult leaders' || e.category === 'Leadership meeting'
    : f === 'needs' ? upcoming(e) && needs(e).length > 0
    : true);
}
const catKey = c => String(c || 'other').toLowerCase().replace(/[^a-z]+/g, '-');

function normalize(d) {
  const t5 = s => (s ? String(s).slice(0, 5) : '');
  return {
    settings: d.settings || {},
    people: d.people || [],
    projects: d.projects || [],
    tasks: d.tasks || [],
    events: (d.events || []).map(e => ({ ...e, adults: e.adults || [], start_time: t5(e.start_time), end_time: t5(e.end_time) })),
    plan: (d.plan || []).map(x => ({ ...x, start_time: t5(x.start_time), end_time: t5(x.end_time), planned: num(x.planned), actual: num(x.actual) })),
  };
}

/* ---------- small pieces ---------- */
const rich = t => esc(t).replace(/https?:\/\/[^\s<]+/g, u => {
  let host = 'link';
  try { host = new URL(u.replace(/&amp;/g, '&')).hostname.replace(/^www\./, ''); } catch { /* keep "link" */ }
  return `<a href="${u}" target="_blank" rel="noopener">${host} ↗</a>`;
});
const empty = msg => `<p class="empty">${esc(msg)}</p>`;
const pill = (text, cls = '') => `<span class="pill ${cls}">${esc(text)}</span>`;

function whenText(e, long) {
  const o = long ? { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' } : { weekday: 'short', month: 'short', day: 'numeric' };
  let s = fmtDate(e.start_date, o);
  if (e.end_date && e.end_date !== e.start_date) s += ' – ' + fmtDate(e.end_date, o);
  if (e.start_time) s += ' · ' + fmtTime(e.start_time) + (e.end_time ? '–' + fmtTime(e.end_time) : '');
  return esc(s);
}

function dueChip(x) {
  if (x.done) return pill('Done', 'ok');
  if (!x.due_date) return '';
  const n = daysBetween(today(), x.due_date);
  if (n < 0) return pill(`${-n}d overdue`, 'danger');
  if (n === 0) return pill('Due today', 'warn');
  if (n <= 7) return pill(`Due ${fmtDate(x.due_date, { weekday: 'short' })}`, 'warn');
  return pill(`Due ${fmtDate(x.due_date)}`);
}

function countdown(date) {
  if (!date) return '';
  const n = daysBetween(today(), date);
  if (n < 0) return `<div class="count past"><b>${-n}</b><span>days ago</span></div>`;
  if (n === 0) return '<div class="count"><b>Today</b></div>';
  return `<div class="count"><b>${n}</b><span>day${n === 1 ? '' : 's'} to go</span></div>`;
}

function taskRow(x, showProject = true) {
  const owner = personName(x.owner_id);
  const proj = showProject && x.project_id ? byId('projects', x.project_id) : null;
  const ev = showProject && x.event_id ? byId('events', x.event_id) : null;
  const meta = [owner ? esc(owner) : '<span class="muted">Unassigned</span>', proj ? esc(proj.title) : '', ev ? esc(`${ev.title} (${fmtDate(ev.start_date)})`) : ''].filter(Boolean).join(' · ');
  return `<div class="task ${x.done ? 'done' : ''}">
    <button class="check" data-act="toggle" data-id="${x.id}" ${canToggle(x) ? '' : 'disabled'} aria-label="${x.done ? 'Mark not done' : 'Mark done'}">${x.done ? '✓' : ''}</button>
    <button class="task-main" data-act="task" data-id="${x.id}">
      <span class="ttl">${esc(x.title)}</span>
      <span class="meta">${meta} ${dueChip(x)}</span>
    </button>
  </div>`;
}

function eventRow(e) {
  const d = parse(e.start_date);
  const soon = upcoming(e) && (e.start_date <= addDays(today(), 45) || (S.view === 'calendar' && S.calFilter === 'needs'));
  const n = isAdult() && soon ? needs(e) : [];
  const started = S.data.plan.some(x => x.event_id === e.id) || S.data.tasks.some(x => x.event_id === e.id);
  return `<button class="row-item" data-act="event" data-id="${e.id}">
    <span class="datebox cat-${catKey(e.category)}"><span>${d.toLocaleDateString(undefined, { month: 'short' })}</span><b>${d.getDate()}</b></span>
    <span class="grow"><span class="ttl">${esc(e.title)}</span><span class="meta">${whenText(e)}${e.location ? ' · ' + esc(e.location) : ''}${started ? ' · plan started' : ''}</span>
      ${n.length ? `<span class="needs">Needs ${esc(n.join(', '))}</span>` : ''}</span>
    ${e.category ? pill(e.category, 'cat cat-' + catKey(e.category)) : ''}
  </button>`;
}

function progress(p) {
  const list = S.data.tasks.filter(x => x.project_id === p.id);
  const done = list.filter(x => x.done).length;
  const overdue = list.filter(x => !x.done && x.due_date && x.due_date < today()).length;
  return { total: list.length, done, overdue, pct: list.length ? Math.round((done / list.length) * 100) : 0 };
}

function projectCard(p) {
  const g = progress(p);
  return `<button class="proj" data-act="project" data-id="${p.id}">
    <span class="proj-top">
      <span><span class="ttl">${esc(p.title)}</span>
      <span class="meta">${esc(p.kind || 'Project')}${p.event_date ? ' · ' + fmtDate(p.event_date, { month: 'short', day: 'numeric', year: 'numeric' }) : ''} · ${STATUSES[p.status] || ''}</span></span>
      ${p.status === 'done' || p.status === 'cancelled' ? '' : countdown(p.event_date)}
    </span>
    <span class="bar"><i style="width:${g.pct}%"></i></span>
    <span class="meta">${g.done} of ${g.total} tasks done${g.overdue ? ` · <span class="danger">${g.overdue} overdue</span>` : ''}</span>
  </button>`;
}

/* ---------- screens ---------- */
function vPin() {
  return `<div class="signin"><div class="card signin-card">
    <img class="logo" src="icon.svg" alt="">
    <h1>Stake Youth</h1>
    <p class="muted">Calendar, assignments, and activity planning for stake and ward youth leaders.</p>
    <form data-form="pin">
      <label>Stake PIN<input name="pin" type="password" inputmode="numeric" autocomplete="current-password" required autofocus></label>
      <label class="check-row"><input type="checkbox" name="remember" checked> Remember me on this device</label>
      <button class="btn primary block" type="submit">Sign in</button>
    </form>
    <p class="err">${esc(S.err)}</p>
    ${LIVE ? '' : '<p class="hint">Demo mode: saves to this device only. Adult PIN <b>1111</b>, youth PIN <b>2222</b>.</p>'}
    ${DEMO && CFG.supabaseUrl ? '<p class="hint"><a href="./">Leave demo mode</a></p>' : ''}
  </div></div>`;
}

function vWho() {
  const kind = isAdult() ? 'adult' : 'youth';
  const list = S.data.people.filter(p => p.active !== false && p.kind === kind).sort(byName);
  return `<div class="signin"><div class="card signin-card">
    <h1>Who are you?</h1>
    <p class="muted">Tap your name. You only do this once on this device.</p>
    ${list.length > 6 ? '<input class="search" type="search" placeholder="Search names" data-filter=".who">' : ''}
    <div class="who-list">${list.map(p => `<button class="who" data-act="pick-me" data-id="${p.id}">
      <b>${esc(p.name)}</b><span>${esc([p.role, p.ward].filter(Boolean).join(' · '))}</span></button>`).join('') || empty('No names on the list yet.')}</div>
    <form data-form="typed-name" class="inline-form">
      <input name="name" placeholder="My name isn't here. Type it." required autocomplete="name">
      <button class="btn" type="submit">Continue</button>
    </form>
    <button class="link" data-act="signout">Use a different PIN</button>
  </div></div>`;
}

function header() {
  return `<header class="top"><div class="wrap top-in">
    <button class="brand" data-act="go" data-view="home"><img src="icon.svg" alt=""><span><small>${esc(S.data.settings.stake_name || 'Stake')}</small>Stake Youth</span></button>
    ${LIVE ? '' : pill('Demo', 'warn')}
    <button class="avatar" data-act="go" data-view="more" title="${esc(S.me.name)}">${esc(initials(S.me.name))}</button>
  </div></header>`;
}

function nav() {
  const tab = { project: 'projects', event: 'calendar', people: 'more', resources: 'more', settings: 'more' }[S.view] || S.view;
  const items = [['home', 'Home'], ['calendar', 'Calendar'], ['tasks', 'Assignments'], ['projects', 'Projects'], ['more', 'More']];
  return `<nav class="tabs">${items.map(([v, label]) =>
    `<button class="${tab === v ? 'on' : ''}" data-act="go" data-view="${v}">${ICON[v]}<span>${label}</span></button>`).join('')}</nav>`;
}

function attention() {
  const t = today();
  const list = S.data.events.filter(e => e.start_date >= t && e.start_date <= addDays(t, 45) && needs(e).length).sort(byEventDate);
  if (!list.length) return '';
  return `<section class="card attn"><div class="card-h"><h3>Needs attention</h3>
      ${list.length > 4 ? `<button class="link" data-act="cal-filter" data-f="needs" data-mode="list">See all ${list.length}</button>` : ''}</div>
    <p class="meta">Events in the next 45 days that still need a location, a time, or two adult leaders (General Handbook 10.8.1).</p>
    ${list.slice(0, 4).map(eventRow).join('')}</section>`;
}

function vHome() {
  const t = today();
  const mine = S.data.tasks.filter(x => !x.done && isMine(x)).sort(byDue);
  const overdue = mine.filter(x => x.due_date && x.due_date < t);
  const soon = mine.filter(x => !x.due_date || x.due_date >= t).slice(0, 6);
  const upcoming = S.data.events.filter(e => (e.end_date || e.start_date) >= t).sort(byEventDate).slice(0, 5);
  const projects = S.data.projects.filter(p => p.status !== 'done' && p.status !== 'cancelled').sort(byProjectDate);
  return `<h2 class="hello">Hi, ${esc(firstName(S.me.name))}</h2>
    ${isAdult() ? attention() : ''}
    <div class="cols">
      <section class="card"><div class="card-h"><h3>My assignments</h3><button class="link" data-act="go" data-view="tasks">See all</button></div>
        ${overdue.length ? `<div class="group-label danger">Overdue</div>${overdue.map(x => taskRow(x)).join('')}` : ''}
        ${soon.length ? `<div class="group-label">Coming up</div>${soon.map(x => taskRow(x)).join('')}` : ''}
        ${!overdue.length && !soon.length ? empty('Nothing assigned to you right now.') : ''}
      </section>
      <section class="card"><div class="card-h"><h3>Upcoming events</h3><button class="link" data-act="go" data-view="calendar">Calendar</button></div>
        ${upcoming.length ? upcoming.map(eventRow).join('') : empty('No upcoming events.')}
      </section>
    </div>
    <section class="card"><div class="card-h"><h3>Projects</h3><button class="link" data-act="go" data-view="projects">All projects</button></div>
      <div class="proj-grid">${projects.length ? projects.map(projectCard).join('') : empty('No active projects.')}</div>
    </section>`;
}

function vCalendar() {
  const evs = calEvents();
  const chips = Object.entries(CAL_FILTERS).filter(([k]) => k !== 'needs' || isAdult())
    .map(([k, l]) => `<button class="chip ${S.calFilter === k ? 'on' : ''}" data-act="cal-filter" data-f="${k}">${l}</button>`).join('');
  return `<div class="page-h"><h2>Calendar</h2><span class="page-tools no-print">
      <span class="toggle">${[['month', 'Month'], ['list', 'List']].map(([k, l]) => `<button class="${S.calMode === k ? 'on' : ''}" data-act="cal-mode" data-m="${k}">${l}</button>`).join('')}</span>
      ${isAdult() ? '<button class="btn primary" data-act="new-event">+ Event</button>' : ''}</span></div>
    <div class="chips no-print">${chips}</div>
    ${S.calMode === 'list' ? calList(evs) : calMonth(evs)}`;
}

function calMonth(evs) {
  const m = S.month || today().slice(0, 7);
  const [y, mo] = m.split('-').map(Number);
  const first = new Date(y, mo - 1, 1);
  const days = new Date(y, mo, 0).getDate();
  const cells = [];
  for (let i = 0; i < first.getDay(); i++) cells.push('<span class="cal-cell blank"></span>');
  for (let d = 1; d <= days; d++) {
    const ds = `${m}-${pad(d)}`;
    const on = eventsOn(ds, evs);
    cells.push(`<button class="cal-cell ${ds === today() ? 'today' : ''} ${ds === S.day ? 'sel' : ''}" data-act="day" data-day="${ds}" aria-label="${fmtDate(ds, { month: 'long', day: 'numeric' })}, ${on.length} events">
      <span class="dn">${d}</span>
      ${on.slice(0, 2).map(e => `<span class="cal-ev cat-${catKey(e.category)}">${esc(e.title)}</span>`).join('')}
      ${on.length > 2 ? `<span class="cal-more">+${on.length - 2}</span>` : ''}
    </button>`);
  }
  const list = S.day ? eventsOn(S.day, evs)
    : evs.filter(e => e.start_date <= `${m}-31` && (e.end_date || e.start_date) >= `${m}-01`).sort(byEventDate);
  return `<section class="card cal">
      <div class="cal-h">
        <button class="icon-btn" data-act="month" data-d="-1" aria-label="Previous month">‹</button>
        <b>${first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</b>
        <button class="icon-btn" data-act="month" data-d="1" aria-label="Next month">›</button>
        <button class="link" data-act="month" data-d="0">Today</button>
      </div>
      <div class="cal-dow">${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(x => `<span>${x}</span>`).join('')}</div>
      <div class="cal-grid">${cells.join('')}</div>
    </section>
    <section class="card"><div class="card-h"><h3>${S.day ? fmtDate(S.day, { weekday: 'long', month: 'long', day: 'numeric' }) : 'This month'}</h3>
      ${S.day ? `<span>${isAdult() ? '<button class="link" data-act="new-event">+ Add</button> · ' : ''}<button class="link" data-act="day" data-day="">Whole month</button></span>` : ''}</div>
      ${list.length ? list.map(eventRow).join('') : empty('No events.')}
    </section>`;
}

// The whole calendar as a list by month: the same shape as the printed senior calendar.
function calList(evs) {
  const list = evs.filter(e => S.calPast || upcoming(e)).sort(byEventDate);
  const hidden = evs.length - list.length;
  const months = [...new Set(list.map(e => e.start_date.slice(0, 7)))];
  return `<h2 class="print-only">${esc(S.data.settings.stake_name || 'Stake')} youth calendar${S.calFilter === 'all' ? '' : ' · ' + CAL_FILTERS[S.calFilter]}</h2>
    <div class="btn-row tools no-print"><button class="btn" data-act="print">Print</button><button class="btn" data-act="ics-all">Add all to my calendar</button>
      ${hidden || S.calPast ? `<button class="btn ghost" data-act="cal-past">${S.calPast ? 'Hide past events' : `Show ${hidden} past`}</button>` : ''}</div>
    ${months.map(m => {
      const rows = list.filter(e => e.start_date.slice(0, 7) === m);
      return `<section class="card"><div class="card-h"><h3>${monthLabel(m)}</h3><span class="meta">${rows.length} event${rows.length > 1 ? 's' : ''}</span></div>${rows.map(eventRow).join('')}</section>`;
    }).join('') || `<section class="card">${empty(S.calFilter === 'needs' ? 'Every upcoming event has what it needs.' : 'No events.')}</section>`}`;
}

function vTasks() {
  const t = today();
  const f = S.filter;
  let list = S.data.tasks.slice();
  if (f === 'mine') list = list.filter(x => !x.done && isMine(x));
  else if (f === 'overdue') list = list.filter(x => !x.done && x.due_date && x.due_date < t);
  else if (f === 'done') list = list.filter(x => x.done);
  else list = list.filter(x => !x.done);
  if (f === 'done') list.sort((a, b) => String(b.done_at || '').localeCompare(String(a.done_at || ''))); else list.sort(byDue);
  const chips = [['mine', 'Mine'], ['all', 'Everyone'], ['overdue', 'Overdue'], ['done', 'Done']];
  let body;
  if (f === 'all') {
    const groups = new Map();
    list.forEach(x => { const n = personName(x.owner_id) || 'Unassigned'; if (!groups.has(n)) groups.set(n, []); groups.get(n).push(x); });
    body = [...groups.entries()].sort((a, b) => (a[0] === 'Unassigned') - (b[0] === 'Unassigned') || a[0].localeCompare(b[0]))
      .map(([n, xs]) => `<div class="group-label">${esc(n)} <span class="muted">${xs.length}</span></div>${xs.map(x => taskRow(x)).join('')}`).join('');
  } else {
    body = list.map(x => taskRow(x)).join('');
  }
  return `<div class="page-h"><h2>Assignments</h2>${isAdult() ? '<button class="btn primary" data-act="new-task">+ Assignment</button>' : ''}</div>
    <div class="chips">${chips.map(([k, l]) => `<button class="chip ${f === k ? 'on' : ''}" data-act="filter" data-f="${k}">${l}</button>`).join('')}</div>
    <section class="card">${body || empty(f === 'mine' ? 'Nothing assigned to you. Nice work.' : 'Nothing here.')}</section>`;
}

function vProjects() {
  const active = S.data.projects.filter(p => p.status !== 'done' && p.status !== 'cancelled').sort(byProjectDate);
  const past = S.data.projects.filter(p => p.status === 'done' || p.status === 'cancelled').sort((a, b) => byProjectDate(b, a));
  return `<div class="page-h"><h2>Projects</h2>${isAdult() ? '<button class="btn primary" data-act="new-project">+ Project</button>' : ''}</div>
    <p class="muted intro">Plan youth conference and other stake activities with the youth leaders. Each project holds its tasks, owners, and due dates.</p>
    <div class="proj-grid">${active.length ? active.map(projectCard).join('') : `<section class="card">${empty('No projects yet.')}</section>`}</div>
    ${past.length ? `<h3 class="section-label">Finished</h3><div class="proj-grid">${past.map(projectCard).join('')}</div>` : ''}`;
}

const TASK_FILTERS = {
  all: ['All', () => true],
  mine: ['Mine', x => !x.done && isMine(x)],
  unassigned: ['Unassigned', x => !x.done && !x.owner_id],
  undated: ['No due date', x => !x.done && !x.due_date],
  overdue: ['Overdue', x => !x.done && x.due_date && x.due_date < today()],
};
const areaOf = x => x.area || 'General';

function vProject() {
  const p = byId('projects', S.sub);
  if (!p) { S.view = 'projects'; return vProjects(); }
  const tasks = S.data.tasks.filter(x => x.project_id === p.id);
  const evs = S.data.events.filter(e => e.project_id === p.id).sort(byEventDate);
  const g = progress(p);
  const tabs = [['overview', 'Overview'], ['tasks', p.kind === 'Youth conference' ? 'Committees' : 'Tasks'], ['timeline', 'Timeline'], ['agenda', 'Agenda']];
  if (isAdult()) tabs.push(['budget', 'Budget']);
  const tab = tabs.some(([k]) => k === S.ptab) ? S.ptab : 'overview';
  const body = { overview: pOverview, tasks: pTasks, timeline: pTimeline, agenda: pAgenda, budget: pBudget }[tab](p, tasks, evs);
  return `<button class="back no-print" data-act="go" data-view="projects">‹ Projects</button>
    <section class="card no-print">
      <div class="proj-top"><div><div class="eyebrow">${esc(p.kind || 'Project')} · ${STATUSES[p.status] || ''}</div><h2>${esc(p.title)}</h2>
        <div class="meta">${p.event_date ? fmtDate(p.event_date, { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' }) : 'No date set'}</div></div>${countdown(p.event_date)}</div>
      <div class="bar big"><i style="width:${g.pct}%"></i></div>
      <div class="meta">${g.done} of ${g.total} tasks done (${g.pct}%)${g.overdue ? ` · <span class="danger">${g.overdue} overdue</span>` : ''}</div>
    </section>
    <div class="ptabs no-print">${tabs.map(([k, l]) => `<button class="${tab === k ? 'on' : ''}" data-act="ptab" data-t="${k}">${l}</button>`).join('')}</div>
    ${body}`;
}

function pOverview(p, tasks, evs) {
  const open = tasks.filter(x => !x.done);
  const next = open.filter(x => x.due_date).sort(byDue).slice(0, 5);
  const unassigned = open.filter(x => !x.owner_id).length;
  const undated = open.filter(x => !x.due_date).length;
  const ahead = evs.filter(upcoming);
  return `<section class="card">
      <dl class="facts flush">
        <dt>Adult lead</dt><dd>${esc(personName(p.adult_lead)) || '<span class="muted">Not set</span>'}</dd>
        <dt>Youth lead</dt><dd>${esc(personName(p.youth_lead)) || '<span class="muted">Not set</span>'}</dd>
        ${p.purpose ? `<dt>Purpose</dt><dd class="pre">${esc(p.purpose)}</dd>` : ''}
        ${p.notes ? `<dt>Notes</dt><dd class="pre">${esc(p.notes)}</dd>` : ''}
      </dl>
      ${isAdult() ? `<div class="btn-row">
        <button class="btn primary" data-act="new-task" data-project="${p.id}">+ Task</button>
        <button class="btn" data-act="new-event" data-project="${p.id}">+ Event</button>
        <button class="btn" data-act="checklist" data-id="${p.id}">Add planning checklist</button>
        <button class="btn ghost" data-act="edit-project" data-id="${p.id}">Edit project</button>
      </div>` : ''}
    </section>
    ${unassigned || undated ? `<section class="card"><div class="card-h"><h3>To sort out</h3></div><div class="chips flush">
      ${unassigned ? `<button class="chip" data-act="pfilter" data-f="unassigned">${unassigned} unassigned ›</button>` : ''}
      ${undated ? `<button class="chip" data-act="pfilter" data-f="undated">${undated} with no due date ›</button>` : ''}</div></section>` : ''}
    <section class="card"><div class="card-h"><h3>Next deadlines</h3><button class="link" data-act="ptab" data-t="timeline">Timeline</button></div>
      ${next.length ? next.map(x => taskRow(x, false)).join('') : empty(open.length ? 'No open task has a due date yet.' : 'No open tasks.')}</section>
    <section class="card"><div class="card-h"><h3>Events on the way</h3></div>
      ${ahead.length ? ahead.map(eventRow).join('') : empty('No upcoming events are linked to this project.')}</section>`;
}

function pTasks(p, tasks) {
  const f = TASK_FILTERS[S.pfilter] ? S.pfilter : 'all';
  const groups = new Map();
  tasks.forEach(x => { const a = areaOf(x); if (!groups.has(a)) groups.set(a, []); groups.get(a).push(x); });
  const rank = a => { const i = AREA_ORDER.indexOf(a); return i < 0 ? (a === 'General' ? -1 : 99) : i; };
  const areas = [...groups.entries()].sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]));
  const few = areas.length <= 3;
  const cards = areas.map(([a, xs]) => {
    const shown = xs.filter(TASK_FILTERS[f][1]);
    if (f !== 'all' && !shown.length) return '';
    const open = few || f !== 'all' || S.open.has(a);
    const done = xs.filter(x => x.done).length;
    const undated = xs.filter(x => !x.done && !x.due_date).length;
    return `<section class="card area">
      <button class="area-h" data-act="area" data-a="${esc(a)}" aria-expanded="${open}">
        <span class="grow"><span class="ttl">${esc(a)}</span><span class="bar"><i style="width:${Math.round((done / xs.length) * 100)}%"></i></span></span>
        <span class="meta">${done}/${xs.length}</span>${few || f !== 'all' ? '' : `<span class="chev">${open ? '▾' : '▸'}</span>`}
      </button>
      ${open ? shown.sort(byDue).map(x => taskRow(x, false)).join('') + (isAdult() ? `<div class="btn-row">
        <button class="btn" data-act="new-task" data-project="${p.id}" data-area="${esc(a)}">+ Task</button>
        ${undated ? `<button class="btn ghost" data-act="bulk-date" data-project="${p.id}" data-area="${esc(a)}">Set a due date for ${undated} undated</button>` : ''}</div>` : '') : ''}
    </section>`;
  }).join('');
  return `<div class="chips">${Object.entries(TASK_FILTERS).map(([k, [l, fn]]) =>
      `<button class="chip sm ${f === k ? 'on' : ''}" data-act="pfilter" data-f="${k}">${l} <span class="n">${tasks.filter(fn).length}</span></button>`).join('')}</div>
    ${cards || `<section class="card">${empty(tasks.length ? 'Nothing matches.' : isAdult() ? 'No tasks yet. Add your own, or start with the planning checklist on the Overview tab.' : 'No tasks yet.')}</section>`}
    ${isAdult() || (!few && f === 'all') ? `<div class="btn-row">
      ${isAdult() ? `<button class="btn primary" data-act="new-task" data-project="${p.id}">+ Task</button>` : ''}
      ${!few && f === 'all' ? `<button class="btn" data-act="area-all">${S.open.size ? 'Collapse all' : 'Expand all'}</button>` : ''}</div>` : ''}`;
}

function pTimeline(p, tasks, evs) {
  const items = [...tasks.filter(x => x.due_date).map(x => ({ d: x.due_date, html: taskRow(x, false) })), ...evs.map(e => ({ d: e.start_date, html: eventRow(e) }))]
    .sort((a, b) => a.d.localeCompare(b.d));
  const undated = tasks.filter(x => !x.done && !x.due_date).length;
  const months = [...new Set(items.map(i => i.d.slice(0, 7)))];
  const cur = today().slice(0, 7);
  return `${undated ? `<p class="muted intro">${undated} open task${undated > 1 ? 's have' : ' has'} no due date yet, so ${undated > 1 ? 'they are' : 'it is'} not on the timeline.
      <button class="link" data-act="pfilter" data-f="undated">Set dates</button></p>` : ''}
    ${months.map(m => `<section class="card"><div class="card-h"><h3>${monthLabel(m)}</h3>${m === cur ? pill('This month') : ''}</div>
      ${items.filter(i => i.d.slice(0, 7) === m).map(i => i.html).join('')}</section>`).join('') || `<section class="card">${empty('Nothing has a date yet.')}</section>`}`;
}

const AGENDA_HINT = {
  seniors: 'What the seniors need to know for each part.',
  chaperones: 'What the chaperones need to know for each part.',
  high: 'Only the parts marked for the high-level agenda: for the stake presidency, parents, and the website.',
};
function pAgenda(p) {
  const lines = planFor('agenda', { project: p.id }).sort(byAgenda);
  const mode = AGENDA_MODES[S.amode] ? S.amode : 'full';
  return `<div class="chips no-print">${Object.entries(AGENDA_MODES).map(([k, l]) => `<button class="chip sm ${mode === k ? 'on' : ''}" data-act="amode" data-m="${k}">${l}</button>`).join('')}</div>
    <h2 class="print-only">${esc(p.title)}</h2>
    <section class="card"><div class="card-h"><h3>${mode === 'full' ? 'Full agenda' : mode === 'high' ? 'High-level agenda' : `Agenda for ${AGENDA_MODES[mode].toLowerCase()}`}</h3>
      <span class="no-print nowrap"><button class="link" data-act="print">Print</button>${isAdult() ? ` · <button class="link" data-act="new-plan" data-kind="agenda" data-project="${p.id}">+ Add</button>` : ''}</span></div>
      ${AGENDA_HINT[mode] ? `<p class="meta no-print">${AGENDA_HINT[mode]}</p>` : ''}
      ${agendaBlock(lines, mode, true)}</section>`;
}

function pBudget(p) {
  return `<section class="card"><div class="card-h"><h3>Budget</h3><span class="meta">Adult leaders only</span></div>${budgetBlock({ project: p.id })}</section>`;
}

/* ---------- plan blocks shared by events and projects ---------- */
function agendaBlock(lines, mode, showDays) {
  const shown = mode === 'high' ? lines.filter(x => x.high_level)
    : mode === 'seniors' ? lines.filter(x => !x.section || x.section === 'Seniors')
    : mode === 'chaperones' ? lines.filter(x => !x.section || x.section === 'Chaperones')
    : lines;
  if (!shown.length) return empty(mode === 'high' && lines.length ? 'Nothing is marked for the high-level agenda yet.' : 'No schedule yet.');
  const days = [...new Set(shown.map(x => x.day || ''))];
  return days.map(d => `${showDays || days.length > 1 ? `<div class="group-label">${d ? fmtDate(d, { weekday: 'long', month: 'long', day: 'numeric' }) : 'Day not set'}</div>` : ''}
    ${shown.filter(x => (x.day || '') === d).map(x => agendaRow(x, mode)).join('')}`).join('');
}

function agendaRow(x, mode) {
  const time = fmtRange(x.start_time, x.end_time);
  const meta = [x.location, mode !== 'high' && x.who ? 'Lead: ' + x.who : ''].filter(Boolean).map(esc).join(' · ');
  const notes = mode === 'full' ? [['AV', x.av], ['Set-up', x.notes], ['Seniors', x.senior_notes], ['Chaperones', x.chaperone_notes]]
    : mode === 'seniors' ? [['', x.senior_notes]] : mode === 'chaperones' ? [['', x.chaperone_notes]] : [];
  const parts = mode === 'high' ? [] : String(x.detail || '').split('\n').map(l => l.trim()).filter(Boolean);
  // A div, not a button: the notes can hold links.
  return `<div class="ag-row ${x.start_time ? '' : 'ag-note'}" ${isAdult() ? `data-act="plan" data-id="${x.id}" role="button" tabindex="0"` : ''}>
    <span class="ag-time">${esc(time)}</span>
    <span class="grow"><span class="ttl">${esc(x.title)}${x.section && mode !== 'high' ? ` <span class="ag-for">${esc(x.section)}</span>` : ''}</span>${meta ? `<span class="meta">${meta}</span>` : ''}
      ${parts.length ? `<span class="ag-parts">${parts.map(l => `<span>${rich(l)}</span>`).join('')}</span>` : ''}
      ${notes.filter(([, t]) => t).map(([l, t]) => `<span class="ag-n">${l ? `<b>${l}:</b> ` : ''}${rich(t)}</span>`).join('')}</span>
  </div>`;
}

function listBlock(lines) {
  const groups = new Map();
  lines.forEach(x => { const s = x.section || 'Other'; if (!groups.has(s)) groups.set(s, []); groups.get(s).push(x); });
  const rank = s => { const i = LIST_SECTIONS.indexOf(s); return i < 0 ? 99 : i; };
  return [...groups.entries()].sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0])).map(([s, xs]) =>
    `<div class="group-label">${esc(s)} <span class="muted">${xs.filter(x => x.done).length}/${xs.length}</span></div>` +
    xs.map(x => `<div class="task ${x.done ? 'done' : ''}">
      <button class="check" data-act="plan-done" data-id="${x.id}" ${isAdult() ? '' : 'disabled'} aria-label="${x.done ? 'Mark not done' : 'Mark done'}">${x.done ? '✓' : ''}</button>
      <${isAdult() ? `button data-act="plan" data-id="${x.id}"` : 'div'} class="task-main">
        <span class="ttl">${esc(x.title)}${x.qty ? ` <span class="muted">(${esc(x.qty)})</span>` : ''}</span>
        <span class="meta">${x.who ? esc(x.who) : 'Nobody yet'}${x.notes ? ' · ' + esc(x.notes) : ''}</span>
      </${isAdult() ? 'button' : 'div'}></div>`).join('')).join('');
}

// Adult leaders only: the server never sends budget lines to the youth PIN.
function budgetBlock(scope) {
  const attr = scope.project ? `data-project="${scope.project}"` : `data-event="${scope.event}"`;
  const all = planFor('budget', scope);
  const approved = all.find(x => x.section === 'approved');
  const hasCap = !!approved && approved.planned != null;
  const lines = all.filter(x => x.section !== 'approved').sort((a, b) => (b.planned || 0) - (a.planned || 0) || a.title.localeCompare(b.title));
  const planned = sum(lines, 'planned');
  const spent = sum(lines, 'actual');
  const cap = hasCap ? approved.planned : planned;
  const stat = (label, val, bad) => `<div><span>${label}</span><b class="${bad ? 'danger' : ''}">${val}</b></div>`;
  return `<div class="stats">
      ${stat('Approved', hasCap ? money(approved.planned) : '—')}
      ${stat('Planned', money(planned), hasCap && planned > approved.planned)}
      ${stat('Spent', money(spent))}
      ${stat('Left', money(cap - spent), cap - spent < 0)}
    </div>
    ${cap ? `<div class="bar"><i class="${spent > cap ? 'over' : ''}" style="width:${Math.min(100, Math.round((spent / cap) * 100))}%"></i></div>` : ''}
    ${lines.map(x => `<button class="row-item" data-act="plan" data-id="${x.id}">
      <span class="grow"><span class="ttl">${esc(x.title)}</span>${x.notes ? `<span class="meta">${esc(x.notes)}</span>` : ''}</span>
      <span class="amt"><b>${money(x.planned) || '—'}</b>${x.actual != null ? `<span class="meta ${x.planned != null && x.actual > x.planned ? 'danger' : ''}">${money(x.actual)} spent</span>` : ''}</span>
    </button>`).join('') || empty('No budget lines yet.')}
    <div class="btn-row no-print"><button class="btn primary" data-act="new-plan" data-kind="budget" ${attr}>+ Budget line</button>
      <button class="btn" ${approved ? `data-act="plan" data-id="${approved.id}"` : `data-act="new-plan" data-kind="budget" data-section="approved" ${attr}`}>${approved ? 'Change' : 'Set'} approved budget</button></div>`;
}

/* ---------- event page: one place to plan an activity ---------- */
function vEvent() {
  const e = byId('events', S.sub);
  if (!e) { S.view = 'calendar'; return vCalendar(); }
  const proj = byId('projects', e.project_id);
  const adults = e.adults.map(id => byId('people', id)).filter(Boolean);
  const scope = { event: e.id };
  const attr = `data-event="${e.id}"`;
  const agenda = planFor('agenda', scope).sort(byAgenda);
  const list = planFor('list', scope);
  const tasks = eventTasks(e.id).sort(byDue);
  const n = needs(e);
  const past = !upcoming(e);
  const b = S.back || { view: 'calendar' };
  const backLabel = b.view === 'project' ? (byId('projects', b.sub) || {}).title || 'Project' : { home: 'Home', tasks: 'Assignments' }[b.view] || 'Calendar';
  const add = kind => (isAdult() ? `<button class="link no-print" data-act="new-plan" data-kind="${kind}" ${attr}>+ Add</button>` : '');
  const hasRecap = !!e.recap || e.youth_count != null || e.adult_count != null;
  const attendance = [e.youth_count != null ? `${e.youth_count} youth` : '', e.adult_count != null ? `${e.adult_count} adults` : ''].filter(Boolean).join(', ');
  return `<button class="back no-print" data-act="back">‹ ${esc(backLabel)}</button>
    <section class="card">
      <div class="proj-top"><div><div class="eyebrow">${esc([e.category, e.audience].filter(Boolean).join(' · '))}</div><h2>${esc(e.title)}</h2>
        <div class="meta">${whenText(e, true)}</div></div>${past ? '' : countdown(e.start_date)}</div>
      <dl class="facts">
        <dt>Where</dt><dd>${esc(e.location) || '<span class="muted">Not set</span>'}</dd>
        ${e.info_only ? '' : `<dt>Adult leaders</dt><dd>${adults.length ? adults.map(a => esc(a.name)).join(', ') : '<span class="muted">None listed</span>'}</dd>`}
        ${proj ? `<dt>Project</dt><dd><button class="link" data-act="project" data-id="${proj.id}">${esc(proj.title)}</button></dd>` : ''}
        ${e.description ? `<dt>Details</dt><dd class="pre">${esc(e.description)}</dd>` : ''}
      </dl>
      ${e.info_only ? '<p class="meta note-line">Calendar note only. Nothing to plan.</p>' : ''}
      ${isAdult() && !past && n.length ? `<div class="needs-box">${ICON.alert}<span>Still needs ${esc(n.join(', '))}.${youthEvent(e) && e.adults.length < 2 ? ' Plan for at least two responsible adults (General Handbook 10.8.1).' : ''}</span></div>` : ''}
      <div class="btn-row no-print"><button class="btn" data-act="ics" data-id="${e.id}">Add to my calendar</button>
        ${isAdult() ? `<button class="btn primary" data-act="edit-event" data-id="${e.id}">Edit</button>${e.info_only ? '' : `<button class="btn" data-act="copy-plan" data-id="${e.id}">Copy a plan…</button>`}` : ''}
        ${e.info_only ? '' : '<button class="btn ghost" data-act="print">Print</button>'}</div>
    </section>
    ${e.info_only ? '' : `<section class="card"><div class="card-h"><h3>Schedule</h3>${add('agenda')}</div>${agendaBlock(agenda, 'full', false)}</section>
    <section class="card"><div class="card-h"><h3>Assignments</h3>${isAdult() ? `<button class="link no-print" data-act="new-task" ${attr}>+ Add</button>` : ''}</div>
      ${tasks.length ? tasks.map(x => taskRow(x, false)).join('') : empty('No assignments yet. Each one shows up on its owner\'s home screen.')}</section>
    <section class="card"><div class="card-h"><h3>Food, set-up, and what to bring</h3>${add('list')}</div>
      ${list.length ? listBlock(list) : empty('Nothing on the list yet.') + (isAdult() ? `<div class="btn-row center no-print"><button class="btn" data-act="starter" data-id="${e.id}">Start with the senior activity checklist</button></div>` : '')}</section>
    ${isAdult() ? `<section class="card no-print"><div class="card-h"><h3>Budget</h3><span class="meta">Adult leaders only</span></div>${budgetBlock(scope)}</section>` : ''}
    ${past || hasRecap ? `<section class="card"><div class="card-h"><h3>After the event</h3>${isAdult() ? `<button class="link no-print" data-act="recap" data-id="${e.id}">${hasRecap ? 'Edit' : '+ Add'}</button>` : ''}</div>
      ${hasRecap ? `<dl class="facts flush">${attendance ? `<dt>Attendance</dt><dd>${attendance}</dd>` : ''}${e.recap ? `<dt>Notes</dt><dd class="pre">${esc(e.recap)}</dd>` : ''}</dl>`
        : empty('Write down who came and what to keep or change, so next year starts ahead.')}</section>` : ''}`}`;
}

function vMore() {
  const me = byId('people', S.me.id);
  return `<section class="card me-card"><span class="avatar big">${esc(initials(S.me.name))}</span>
      <div><b>${esc(S.me.name)}</b><div class="meta">${esc(me ? [me.role, me.ward].filter(Boolean).join(' · ') : '')}${me ? ' · ' : ''}${isAdult() ? 'Adult leader' : 'Youth leader'}</div></div></section>
    <section class="card menu">
      <button data-act="go" data-view="people">${ICON.people}<span>Leaders &amp; youth leaders</span><i>›</i></button>
      <button data-act="go" data-view="resources">${ICON.book}<span>Church resources</span><i>›</i></button>
      ${isAdult() ? `<button data-act="go" data-view="settings">${ICON.gear}<span>Settings</span><i>›</i></button>` : ''}
      <button data-act="switch-me">${ICON.user}<span>Change who I am</span><i>›</i></button>
      <button data-act="signout">${ICON.out}<span>Sign out</span><i>›</i></button>
    </section>
    <p class="muted small center">${LIVE ? 'Connected to the stake database.' : 'Demo mode: changes save to this device only.'}</p>`;
}

function vPeople() {
  const kind = S.kind;
  const list = S.data.people.filter(p => p.kind === kind).sort(byName);
  const groups = new Map();
  list.forEach(p => { const w = p.ward || 'No ward'; if (!groups.has(w)) groups.set(w, []); groups.get(w).push(p); });
  const order = ['Stake', ...wards()];
  const rank = w => { const i = order.indexOf(w); return i < 0 ? 99 : i; };
  return `<button class="back" data-act="go" data-view="more">‹ More</button>
    <div class="page-h"><h2>Leaders</h2>${isAdult() ? '<button class="btn primary" data-act="new-person">+ Person</button>' : ''}</div>
    <div class="chips"><button class="chip ${kind === 'adult' ? 'on' : ''}" data-act="kind" data-k="adult">Adult leaders</button><button class="chip ${kind === 'youth' ? 'on' : ''}" data-act="kind" data-k="youth">Youth leaders</button></div>
    ${kind === 'youth' ? '<p class="muted intro">First name and last initial is enough for youth leaders.</p>' : ''}
    ${[...groups.entries()].sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0])).map(([w, ps]) => `<section class="card"><div class="card-h"><h3>${esc(w)}</h3></div>
      ${ps.map(p => {
        const open = S.data.tasks.filter(x => !x.done && x.owner_id === p.id).length;
        return `<button class="row-item" data-act="person" data-id="${p.id}"><span class="avatar">${esc(initials(p.name))}</span>
          <span class="grow"><span class="ttl">${esc(p.name)}${p.active === false ? ' <span class="muted">(inactive)</span>' : ''}</span><span class="meta">${esc(p.role || '')}${open ? ` · ${open} open task${open > 1 ? 's' : ''}` : ''}</span></span></button>`;
      }).join('')}</section>`).join('') || `<section class="card">${empty('Nobody here yet.')}</section>`}`;
}

function vResources() {
  return `<button class="back" data-act="go" data-view="more">‹ More</button>
    <div class="page-h"><h2>Church resources</h2></div>
    <section class="card note">${ICON.shield}<div><b>Safeguarding youth</b>
      <p>At least two responsible adults should be present when adults work with youth. Adults who serve with youth complete youth protection training within one month of being sustained and repeat it every three years (General Handbook 10.8.1).</p></div></section>
    <section class="card">${RESOURCES.map(([t, u, d]) => `<a class="row-item" href="${CH}${u}" target="_blank" rel="noopener">
      <span class="grow"><span class="ttl">${esc(t)}</span><span class="meta">${esc(d)}</span></span><span class="ext">↗</span></a>`).join('')}</section>`;
}

function vSettings() {
  if (!isAdult()) { S.view = 'more'; return vMore(); }
  return `<button class="back" data-act="go" data-view="more">‹ More</button>
    <div class="page-h"><h2>Settings</h2></div>
    <section class="card"><form data-form="settings" class="stack">
      <label>Stake name<input name="stake_name" value="${esc(S.data.settings.stake_name || '')}" placeholder="[FILL IN]"></label>
      <label>Wards <small class="muted">one per line</small><textarea name="wards" rows="6">${esc(S.data.settings.wards || '')}</textarea></label>
      <button class="btn primary" type="submit">Save</button>
    </form></section>
    <section class="card"><div class="card-h"><h3>PINs</h3></div>
      <p class="muted">The adult PIN can change everything. The youth PIN can see the app and check off the youth leader's own tasks. Use 6 digits or more.</p>
      <form data-form="pin-change" class="stack">
        <label>Which PIN<select name="which"><option value="adult">Adult leader PIN</option><option value="youth">Youth leader PIN</option></select></label>
        <label>New PIN<input name="next" type="password" inputmode="numeric" minlength="4" required autocomplete="new-password"></label>
        <button class="btn" type="submit">Change PIN</button>
      </form></section>
    ${LIVE ? '' : '<section class="card"><p class="muted">Demo data lives on this device only.</p><button class="btn danger" data-act="reset-demo">Reset demo data</button></section>'}`;
}

/* ---------- sheets (forms and details) ---------- */
function openSheet(html) {
  $('#sheet-root').innerHTML = `<div class="sheet-bg" data-act="close-sheet"></div><div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
  document.body.classList.add('no-scroll');
  const f = $('#sheet-root input:not([type=hidden]), #sheet-root textarea');
  if (f && !('ontouchstart' in window)) f.focus();
}
function closeSheet() { $('#sheet-root').innerHTML = ''; document.body.classList.remove('no-scroll'); }
const sheetHead = (title, eyebrow = '') => `<div class="sheet-h"><div>${eyebrow ? `<div class="eyebrow">${esc(eyebrow)}</div>` : ''}<h2>${esc(title)}</h2></div><button class="icon-btn" data-act="close-sheet" aria-label="Close">✕</button></div>`;
const opt = (v, label, sel) => `<option value="${esc(v)}" ${sel ? 'selected' : ''}>${esc(label)}</option>`;

function personOptions(selected, kinds = ['adult', 'youth']) {
  const people = S.data.people.filter(p => kinds.includes(p.kind) && (p.active !== false || p.id === selected)).sort(byName);
  return kinds.map(k => {
    const ps = people.filter(p => p.kind === k);
    if (!ps.length) return '';
    const inner = ps.map(p => opt(p.id, p.name + (p.ward ? ` (${p.ward})` : ''), p.id === selected)).join('');
    return kinds.length > 1 ? `<optgroup label="${k === 'adult' ? 'Adult leaders' : 'Youth leaders'}">${inner}</optgroup>` : inner;
  }).join('');
}

function taskSheet(x) {
  const ev = byId('events', x.event_id);
  if (!isAdult()) {
    const proj = byId('projects', x.project_id);
    return sheetHead(x.title, x.area || 'Assignment') + `<dl class="facts">
      <dt>Owner</dt><dd>${esc(personName(x.owner_id)) || 'Unassigned'}</dd>
      <dt>Due</dt><dd>${x.due_date ? fmtDate(x.due_date, { weekday: 'short', month: 'long', day: 'numeric' }) : 'No date'}</dd>
      ${proj ? `<dt>Project</dt><dd>${esc(proj.title)}</dd>` : ''}
      ${ev ? `<dt>Event</dt><dd>${esc(ev.title)} · ${fmtDate(ev.start_date)}</dd>` : ''}
      ${x.notes ? `<dt>Notes</dt><dd class="pre">${esc(x.notes)}</dd>` : ''}</dl>
      ${canToggle(x) ? `<div class="btn-row"><button class="btn primary" data-act="toggle" data-id="${x.id}" data-close="1">${x.done ? 'Mark not done' : 'Mark done'}</button></div>` : ''}`;
  }
  const areas = [...new Set([...AREA_ORDER, ...S.data.tasks.map(t => t.area).filter(Boolean)])];
  return sheetHead(x.id ? 'Edit assignment' : 'New assignment') + `<form data-form="task" class="stack">
    <input type="hidden" name="id" value="${esc(x.id || '')}">
    <input type="hidden" name="event_id" value="${esc(x.event_id || '')}">
    ${ev ? `<p class="meta">For ${esc(ev.title)} · ${fmtDate(ev.start_date, { weekday: 'short', month: 'short', day: 'numeric' })}</p>` : ''}
    <label>What needs to happen<input name="title" value="${esc(x.title || '')}" required></label>
    <div class="two">
      <label>Owner<select name="owner_id"><option value="">Unassigned</option>${personOptions(x.owner_id)}</select></label>
      <label>Due date<input type="date" name="due_date" value="${esc(x.due_date || '')}"></label>
    </div>
    <div class="two">
      <label>Project<select name="project_id"><option value="">None</option>${S.data.projects.slice().sort(byProjectDate).map(p => opt(p.id, p.title, p.id === x.project_id)).join('')}</select></label>
      <label>Area <small class="muted">optional</small><input name="area" list="areas" value="${esc(x.area || '')}" placeholder="Food, Program…"></label>
    </div>
    <datalist id="areas">${areas.map(a => `<option value="${esc(a)}">`).join('')}</datalist>
    <label>Notes<textarea name="notes" rows="3">${esc(x.notes || '')}</textarea></label>
    ${x.done_by ? `<p class="meta">Checked off by ${esc(x.done_by)}</p>` : ''}
    <div class="btn-row"><button class="btn primary" type="submit">Save</button>
      ${x.id ? `<button class="btn danger ghost" type="button" data-act="delete" data-kind="task" data-id="${x.id}">Delete</button>` : ''}</div>
  </form>`;
}

function eventSheet(e) {
  const adults = S.data.people.filter(p => p.kind === 'adult' && (p.active !== false || e.adults.includes(p.id))).sort(byName);
  const sibs = e.id ? S.data.events.filter(x => x.id !== e.id && x.title === e.title && x.start_date >= today()).length : 0;
  return sheetHead(e.id ? 'Edit event' : 'New event') + `<form data-form="event" class="stack">
    <input type="hidden" name="id" value="${esc(e.id || '')}">
    <label>Title<input name="title" value="${esc(e.title || '')}" required></label>
    <div class="two">
      <label>Type<select name="category">${CATEGORIES.map(c => opt(c, c, c === e.category)).join('')}</select></label>
      <label>For<select name="audience">${AUDIENCES.map(a => opt(a, a, a === e.audience)).join('')}</select></label>
    </div>
    <div class="two">
      <label>Start date<input type="date" name="start_date" value="${esc(e.start_date || '')}" required></label>
      <label>End date <small class="muted">if more than one day</small><input type="date" name="end_date" value="${esc(e.end_date || '')}"></label>
    </div>
    <div class="two">
      <label>Start time<input type="time" name="start_time" value="${esc(e.start_time || '')}"></label>
      <label>End time<input type="time" name="end_time" value="${esc(e.end_time || '')}"></label>
    </div>
    <label>Location<input name="location" value="${esc(e.location || '')}"></label>
    <label>Project<select name="project_id"><option value="">None</option>${S.data.projects.slice().sort(byProjectDate).map(p => opt(p.id, p.title, p.id === e.project_id)).join('')}</select></label>
    <fieldset><legend>Adult leaders attending <small class="muted">at least 2 for youth events</small></legend>
      <div class="checks">${adults.map(p => `<label class="check-row"><input type="checkbox" name="adults" value="${p.id}" ${e.adults.includes(p.id) ? 'checked' : ''}> ${esc(p.name)}</label>`).join('') || '<p class="muted">Add adult leaders under More → Leaders first.</p>'}</div>
    </fieldset>
    ${sibs ? `<label class="check-row"><input type="checkbox" name="series"> Also use this location and these adult leaders for the ${sibs} other upcoming “${esc(e.title)}” event${sibs > 1 ? 's' : ''}</label>` : ''}
    <label>Details<textarea name="description" rows="3">${esc(e.description || '')}</textarea></label>
    <label class="check-row"><input type="checkbox" name="info_only" ${e.info_only ? 'checked' : ''}> Calendar note only (nothing to plan, no adult leaders needed)</label>
    <div class="btn-row"><button class="btn primary" type="submit">Save</button>
      ${e.id ? `<button class="btn danger ghost" type="button" data-act="delete" data-kind="event" data-id="${e.id}">Delete</button>` : ''}</div>
  </form>`;
}

function projectSheet(p) {
  return sheetHead(p.id ? 'Edit project' : 'New project') + `<form data-form="project" class="stack">
    <input type="hidden" name="id" value="${esc(p.id || '')}">
    <label>Name<input name="title" value="${esc(p.title || '')}" required placeholder="Stake Youth Conference 2027"></label>
    <div class="two">
      <label>Type<select name="kind">${PROJECT_KINDS.map(k => opt(k, k, k === p.kind)).join('')}</select></label>
      <label>Event date<input type="date" name="event_date" value="${esc(p.event_date || '')}"></label>
    </div>
    <div class="two">
      <label>Adult lead<select name="adult_lead"><option value="">Not set</option>${personOptions(p.adult_lead, ['adult'])}</select></label>
      <label>Youth lead<select name="youth_lead"><option value="">Not set</option>${personOptions(p.youth_lead, ['youth'])}</select></label>
    </div>
    <label>Status<select name="status">${Object.entries(STATUSES).map(([k, l]) => opt(k, l, k === (p.status || 'planning'))).join('')}</select></label>
    <label>Purpose <small class="muted">what the youth want this to accomplish</small><textarea name="purpose" rows="3">${esc(p.purpose || '')}</textarea></label>
    <label>Notes<textarea name="notes" rows="3">${esc(p.notes || '')}</textarea></label>
    ${p.id ? '' : `<label class="check-row"><input type="checkbox" name="checklist" checked> Start with the planning checklist (${CHECKLIST.length} tasks you can edit)</label>`}
    <div class="btn-row"><button class="btn primary" type="submit">Save</button>
      ${p.id ? `<button class="btn danger ghost" type="button" data-act="delete" data-kind="project" data-id="${p.id}">Delete</button>` : ''}</div>
  </form>`;
}

function personSheet(p) {
  if (!isAdult()) {
    return sheetHead(p.name, p.kind === 'adult' ? 'Adult leader' : 'Youth leader') + `<dl class="facts">
      <dt>Calling</dt><dd>${esc(p.role || '')}</dd><dt>Ward</dt><dd>${esc(p.ward || '')}</dd></dl>`;
  }
  const kind = p.kind || S.kind;
  return sheetHead(p.id ? 'Edit person' : 'Add person') + `<form data-form="person" class="stack">
    <input type="hidden" name="id" value="${esc(p.id || '')}">
    <div class="seg"><label><input type="radio" name="kind" value="adult" ${kind === 'adult' ? 'checked' : ''}> Adult leader</label><label><input type="radio" name="kind" value="youth" ${kind === 'youth' ? 'checked' : ''}> Youth leader</label></div>
    <label>Name<input name="name" value="${esc(p.name || '')}" required></label>
    <p class="hint small">For youth, first name and last initial is enough.</p>
    <div class="two">
      <label>Calling<input name="role" list="roles" value="${esc(p.role || '')}"></label>
      <label>Ward<select name="ward">${['Stake', ...wards()].map(w => opt(w, w, w === p.ward)).join('')}${p.ward && !['Stake', ...wards()].includes(p.ward) ? opt(p.ward, p.ward, true) : ''}</select></label>
    </div>
    <datalist id="roles">${ROLES.map(r => `<option value="${esc(r)}">`).join('')}</datalist>
    <label class="check-row"><input type="checkbox" name="active" ${p.active === false ? '' : 'checked'}> Active (shows in lists)</label>
    <div class="btn-row"><button class="btn primary" type="submit">Save</button>
      ${p.id ? `<button class="btn danger ghost" type="button" data-act="delete" data-kind="person" data-id="${p.id}">Delete</button>` : ''}</div>
  </form>`;
}

/* ---------- plan line sheets ---------- */
const planHidden = x => ['id', 'kind', 'project_id', 'event_id'].map(k => `<input type="hidden" name="${k}" value="${esc(x[k] || '')}">`).join('');
const planButtons = x => `<div class="btn-row"><button class="btn primary" type="submit">Save</button>
  ${x.id ? `<button class="btn danger ghost" type="button" data-act="delete" data-kind="plan" data-id="${x.id}">Delete</button>` : ''}</div>`;
function whoList() {
  // Groups, adult leaders, and youth leaders with a role (not the whole senior roster).
  const names = S.data.people.filter(p => p.active !== false && (p.kind === 'adult' || !/^senior/i.test(p.role || ''))).sort(byName).map(p => p.name);
  return `<datalist id="who">${[...WHO_GROUPS, ...names].map(n => `<option value="${esc(n)}">`).join('')}</datalist>`;
}
const planSheet = x => (x.kind === 'agenda' ? agendaSheet(x) : x.kind === 'budget' ? budgetSheet(x) : listSheet(x));

function agendaSheet(x) {
  const ev = byId('events', x.event_id);
  const multi = !ev || (ev.end_date && ev.end_date !== ev.start_date);
  const extra = !ev || x.av || x.notes || x.senior_notes || x.chaperone_notes || x.high_level;
  return sheetHead(x.id ? 'Edit schedule item' : 'Add to the schedule', ev ? ev.title : (byId('projects', x.project_id) || {}).title) + `<form data-form="plan" class="stack">
    ${planHidden(x)}
    <label>What happens<input name="title" value="${esc(x.title || '')}" required placeholder="Opening meeting, dinner, travel…"></label>
    ${multi ? `<label>Day<input type="date" name="day" value="${esc(x.day || '')}" ${ev ? `min="${ev.start_date}" max="${ev.end_date}"` : ''} required></label>`
      : `<input type="hidden" name="day" value="${esc(x.day || ev.start_date)}">`}
    <div class="two">
      <label>Start <small class="muted">blank = a note for the day</small><input type="time" name="start_time" value="${esc(x.start_time || '')}"></label>
      <label>End<input type="time" name="end_time" value="${esc(x.end_time || '')}"></label>
    </div>
    <div class="two">
      <label>Where<input name="location" value="${esc(x.location || '')}"></label>
      <label>Who leads<input name="who" list="who" value="${esc(x.who || '')}"></label>
    </div>
    <label>Parts <small class="muted">one per line: conducting, prayers, stations, games…</small><textarea name="detail" rows="${Math.min(10, Math.max(2, String(x.detail || '').split('\n').length))}">${esc(x.detail || '')}</textarea></label>
    <label>Who it is for<select name="section"><option value="">Everyone</option>${AGENDA_FOR.map(a => opt(a, a + ' only', a === x.section)).join('')}</select></label>
    <details ${extra ? 'open' : ''}><summary>Set-up and notes for seniors and chaperones</summary><div class="stack">
      <label>AV needs<input name="av" value="${esc(x.av || '')}" placeholder="Microphone, slides, music…"></label>
      <label>Set-up<textarea name="notes" rows="2">${esc(x.notes || '')}</textarea></label>
      <label>Notes for seniors<textarea name="senior_notes" rows="2">${esc(x.senior_notes || '')}</textarea></label>
      <label>Notes for chaperones<textarea name="chaperone_notes" rows="2">${esc(x.chaperone_notes || '')}</textarea></label>
      <label class="check-row"><input type="checkbox" name="high_level" ${x.high_level ? 'checked' : ''}> Show on the high-level agenda</label>
    </div></details>
    ${planButtons(x)}
  </form>${whoList()}`;
}

function listSheet(x) {
  const sections = [...new Set([...LIST_SECTIONS, ...S.data.plan.filter(l => l.kind === 'list').map(l => l.section).filter(Boolean)])];
  return sheetHead(x.id ? 'Edit list item' : 'Add to the list', (byId('events', x.event_id) || {}).title) + `<form data-form="plan" class="stack">
    ${planHidden(x)}
    <label>What is needed<input name="title" value="${esc(x.title || '')}" required placeholder="Dinner, tables and chairs, permission slips…"></label>
    <div class="two">
      <label>Group<input name="section" list="sections" value="${esc(x.section || '')}" placeholder="Food, Set up, To bring…"></label>
      <label>How many <small class="muted">optional</small><input name="qty" value="${esc(x.qty || '')}"></label>
    </div>
    <label>Who has it<input name="who" list="who" value="${esc(x.who || '')}" placeholder="YM presidency, YW presidency, a name…"></label>
    <label>Notes<input name="notes" value="${esc(x.notes || '')}"></label>
    <label class="check-row"><input type="checkbox" name="done" ${x.done ? 'checked' : ''}> Taken care of</label>
    ${planButtons(x)}
  </form><datalist id="sections">${sections.map(n => `<option value="${esc(n)}">`).join('')}</datalist>${whoList()}`;
}

function budgetSheet(x) {
  const amount = (name, v, req) => `<input name="${name}" type="number" inputmode="decimal" min="0" step="0.01" value="${v ?? ''}" ${req ? 'required' : ''}>`;
  if (x.section === 'approved') {
    return sheetHead('Approved budget') + `<form data-form="plan" class="stack">
      ${planHidden(x)}<input type="hidden" name="section" value="approved"><input type="hidden" name="title" value="Approved budget">
      <label>Amount the stake presidency approved${amount('planned', x.planned, true)}</label>
      <label>Notes<input name="notes" value="${esc(x.notes || '')}"></label>
      ${planButtons(x)}
    </form>`;
  }
  return sheetHead(x.id ? 'Edit budget line' : 'New budget line') + `<form data-form="plan" class="stack">
    ${planHidden(x)}
    <label>What it is for<input name="title" value="${esc(x.title || '')}" required placeholder="Food, T-shirts, facility…"></label>
    <div class="two">
      <label>Planned${amount('planned', x.planned)}</label>
      <label>Spent so far${amount('actual', x.actual)}</label>
    </div>
    <label>Notes<input name="notes" value="${esc(x.notes || '')}"></label>
    ${planButtons(x)}
  </form>`;
}

function recapSheet(e) {
  return sheetHead('After the event', e.title) + `<form data-form="recap" class="stack">
    <input type="hidden" name="id" value="${e.id}">
    <div class="two">
      <label>Youth who came<input name="youth_count" type="number" inputmode="numeric" min="0" value="${e.youth_count ?? ''}"></label>
      <label>Adults who came<input name="adult_count" type="number" inputmode="numeric" min="0" value="${e.adult_count ?? ''}"></label>
    </div>
    <label>What to keep, change, or try next time <small class="muted">food amounts, what worked, what did not</small><textarea name="recap" rows="6">${esc(e.recap || '')}</textarea></label>
    <div class="btn-row"><button class="btn primary" type="submit">Save</button></div>
  </form>`;
}

function copySheet(e) {
  const src = S.data.events.filter(x => x.id !== e.id && (S.data.plan.some(l => l.event_id === x.id) || S.data.tasks.some(t => t.event_id === x.id)))
    .sort((a, b) => byEventDate(b, a));
  if (!src.length) return sheetHead('Copy a plan', e.title) + empty('No other event has a plan to copy yet.');
  return sheetHead('Copy a plan', e.title) + `<form data-form="copy-plan" class="stack">
    <input type="hidden" name="to" value="${e.id}">
    <label>Copy from<select name="from">${src.map(x => opt(x.id, `${x.title} · ${fmtDate(x.start_date, { month: 'short', day: 'numeric', year: 'numeric' })}`)).join('')}</select></label>
    <p class="meta">Copies the schedule, the list, the assignments, and the planned budget amounts into this event. Dates shift to match. Nothing is marked done, and nothing already here is removed.</p>
    <div class="btn-row"><button class="btn primary" type="submit">Copy</button></div>
  </form>`;
}

function bulkDateSheet(p, area) {
  const n = S.data.tasks.filter(x => x.project_id === p.id && areaOf(x) === area && !x.done && !x.due_date).length;
  return sheetHead('Set a due date', area) + `<form data-form="bulk-date" class="stack">
    <input type="hidden" name="project" value="${p.id}"><input type="hidden" name="area" value="${esc(area)}">
    <label>Due date for the ${n} open task${n > 1 ? 's' : ''} without one<input type="date" name="due_date" required></label>
    <p class="meta">Tasks that already have a date are left alone. You can still change each one after.</p>
    <div class="btn-row"><button class="btn primary" type="submit">Set date</button></div>
  </form>`;
}

/* ---------- saving ---------- */
function upsertLocal(kind, row) {
  const list = S.data[KEY[kind]];
  if (kind === 'event') row = normalize({ events: [row] }).events[0];
  if (kind === 'plan') row = normalize({ plan: [row] }).plan[0];
  const i = list.findIndex(x => x.id === row.id);
  if (i >= 0) list[i] = row; else list.push(row);
  return row;
}
async function save(kind, row) { return upsertLocal(kind, await api.save(S.pin, S.me.name, kind, row)); }

async function busy(form, fn) {
  const btn = form && form.querySelector('[type=submit]');
  if (btn) btn.disabled = true;
  try { await fn(); } catch (err) { toast(err.message || 'Something went wrong.'); } finally { if (btn) btn.disabled = false; }
}

const vals = f => {
  const o = {};
  new FormData(f).forEach((v, k) => { o[k] = typeof v === 'string' ? v.trim() : v; });
  return o;
};

const FORMS = {
  async pin(f) {
    const v = vals(f);
    await busy(f, async () => {
      try { await signIn(v.pin, !!v.remember); S.err = ''; } catch (e) { S.err = e.message; }
      render();
    });
  },
  'typed-name'(f) { setMe({ id: null, name: vals(f).name }); },
  async task(f) {
    const v = vals(f);
    await busy(f, async () => {
      await save('task', { id: v.id || undefined, title: v.title, owner_id: v.owner_id || null, due_date: v.due_date || null, project_id: v.project_id || null, event_id: v.event_id || null, area: v.area, notes: v.notes });
      closeSheet(); render(); toast('Saved');
    });
  },
  async event(f) {
    const v = vals(f);
    if (v.end_date && v.end_date < v.start_date) return toast('End date is before the start date.');
    await busy(f, async () => {
      const old = v.id ? byId('events', v.id) : null;
      const e = await save('event', {
        ...(old || {}), id: v.id || undefined, title: v.title, category: v.category, audience: v.audience, start_date: v.start_date,
        end_date: v.end_date && v.end_date !== v.start_date ? v.end_date : null, start_time: v.start_time || null, end_time: v.end_time || null,
        location: v.location, project_id: v.project_id || null, description: v.description, info_only: !!v.info_only,
        adults: [...f.querySelectorAll('input[name=adults]:checked')].map(i => i.value),
      });
      let n = 0;
      if (v.series && old) {
        for (const x of S.data.events.filter(x => x.id !== e.id && x.title === old.title && x.start_date >= today())) {
          await save('event', { ...x, location: e.location, adults: e.adults }); n++;
        }
      }
      closeSheet(); render(); toast(n ? `Saved. Also updated ${n} other event${n > 1 ? 's' : ''}.` : 'Saved');
    });
  },
  async plan(f) {
    const v = vals(f);
    await busy(f, async () => {
      const row = { ...(v.id ? byId('plan', v.id) : {}), id: v.id || undefined, kind: v.kind, project_id: v.project_id || null, event_id: v.event_id || null, title: v.title, notes: v.notes || '' };
      if (v.kind === 'agenda') Object.assign(row, { day: v.day || null, start_time: v.start_time || null, end_time: v.end_time || null, location: v.location, who: v.who,
        av: v.av, senior_notes: v.senior_notes, chaperone_notes: v.chaperone_notes, high_level: !!v.high_level, section: v.section || '', detail: v.detail || '' });
      else if (v.kind === 'list') Object.assign(row, { section: v.section, qty: v.qty, who: v.who, done: !!v.done });
      else Object.assign(row, { section: v.section || '', planned: num(v.planned), actual: num(v.actual) });
      await save('plan', row);
      closeSheet(); render(); toast('Saved');
    });
  },
  async recap(f) {
    const v = vals(f);
    await busy(f, async () => {
      await save('event', { ...byId('events', v.id), youth_count: num(v.youth_count), adult_count: num(v.adult_count), recap: v.recap });
      closeSheet(); render(); toast('Saved');
    });
  },
  async 'copy-plan'(f) {
    const v = vals(f);
    await busy(f, async () => {
      const n = await copyPlan(byId('events', v.from), byId('events', v.to));
      closeSheet(); render(); toast(`Copied ${n} item${n === 1 ? '' : 's'}`);
    });
  },
  async 'bulk-date'(f) {
    const v = vals(f);
    await busy(f, async () => {
      const list = S.data.tasks.filter(x => x.project_id === v.project && areaOf(x) === v.area && !x.done && !x.due_date);
      for (const x of list) await save('task', { ...x, due_date: v.due_date });
      closeSheet(); render(); toast(`Set a due date on ${list.length} task${list.length === 1 ? '' : 's'}`);
    });
  },
  async project(f) {
    const v = vals(f);
    await busy(f, async () => {
      const p = await save('project', {
        id: v.id || undefined, title: v.title, kind: v.kind, event_date: v.event_date || null, status: v.status,
        adult_lead: v.adult_lead || null, youth_lead: v.youth_lead || null, purpose: v.purpose, notes: v.notes,
      });
      if (v.checklist) await addChecklist(p);
      closeSheet(); S.view = 'project'; S.sub = p.id; render(); toast('Saved');
    });
  },
  async person(f) {
    const v = vals(f);
    await busy(f, async () => {
      await save('person', { id: v.id || undefined, name: v.name, kind: v.kind, role: v.role, ward: v.ward, active: !!v.active });
      S.kind = v.kind; closeSheet(); render(); toast('Saved');
    });
  },
  async settings(f) {
    const v = vals(f);
    await busy(f, async () => {
      for (const key of ['stake_name', 'wards']) {
        const r = await api.save(S.pin, S.me.name, 'setting', { key, value: v[key] });
        S.data.settings[r.key] = r.value;
      }
      render(); toast('Settings saved');
    });
  },
  async 'pin-change'(f) {
    const v = vals(f);
    await busy(f, async () => {
      await api.setPin(S.pin, v.which, v.next);
      if (v.which === 'adult') { S.pin = v.next; store.set(PIN_KEY, v.next, !!localStorage.getItem(PIN_KEY)); }
      f.reset(); toast(`${v.which === 'adult' ? 'Adult' : 'Youth'} PIN changed. Tell the other leaders.`);
    });
  },
};

// Copy one event's plan into another. Dates shift by the gap between the two events; nothing is marked done.
async function copyPlan(from, to) {
  const delta = daysBetween(from.start_date, to.start_date);
  const shift = d => (d ? addDays(d, delta) : null);
  const lines = S.data.plan.filter(x => x.event_id === from.id);
  const tasks = eventTasks(from.id);
  for (const x of lines) {
    const { id, created_at, created_by, updated_at, updated_by, ...rest } = x;
    await save('plan', { ...rest, event_id: to.id, day: shift(x.day), done: false, actual: null });
  }
  for (const t of tasks) {
    await save('task', { title: t.title, area: t.area, notes: t.notes, owner_id: t.owner_id, project_id: t.project_id, event_id: to.id, due_date: shift(t.due_date) });
  }
  return lines.length + tasks.length;
}

async function addChecklist(p) {
  const rows = checklistTasks(p);
  const saved = await Promise.all(rows.map(r => api.save(S.pin, S.me.name, 'task', r)));
  saved.forEach(r => upsertLocal('task', r));
}

/* ---------- actions ---------- */
async function toggleTask(id, undoable = true) {
  const x = byId('tasks', id);
  if (!x || !canToggle(x)) return;
  const was = { ...x };
  Object.assign(x, { done: !x.done });
  render();
  try {
    upsertLocal('task', await api.taskDone(S.pin, S.me.name, id, !was.done));
    render();
    if (undoable) toast(was.done ? 'Marked not done' : 'Done ✓', () => toggleTask(id, false));
  } catch (err) {
    upsertLocal('task', was); render(); toast(err.message);
  }
}

function downloadIcs(list, name) {
  const escI = s => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  const d = s => s.replace(/-/g, '');
  const dt = (date, time) => d(date) + 'T' + time.replace(':', '') + '00';
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Stake Youth//EN'];
  list.forEach(e => {
    lines.push('BEGIN:VEVENT', `UID:${e.id}@stake-youth`, `DTSTAMP:${stamp}`);
    if (e.start_time) {
      let endDate = e.end_date || e.start_date;
      let endTime = e.end_time;
      if (!endTime) { const h = Number(e.start_time.slice(0, 2)) + 1; endTime = `${pad(h % 24)}${e.start_time.slice(2)}`; if (h >= 24) endDate = addDays(endDate, 1); }
      lines.push(`DTSTART:${dt(e.start_date, e.start_time)}`, `DTEND:${dt(endDate, endTime)}`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${d(e.start_date)}`, `DTEND;VALUE=DATE:${d(addDays(e.end_date || e.start_date, 1))}`);
    }
    lines.push(`SUMMARY:${escI(e.title)}`);
    if (e.location) lines.push(`LOCATION:${escI(e.location)}`);
    if (e.description) lines.push(`DESCRIPTION:${escI(e.description)}`);
    lines.push('END:VEVENT');
  });
  lines.push('END:VCALENDAR');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/calendar' }));
  a.download = ((name || list[0].title).replace(/[^\w]+/g, '-').replace(/^-|-$/g, '') || 'event') + '.ics';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function go(view, sub = null, back = null) {
  S.view = view; S.sub = sub; S.back = back;
  closeSheet(); render(); window.scrollTo(0, 0);
}

const ACTIONS = {
  go: el => go(el.dataset.view),
  'close-sheet': closeSheet,
  'pick-me': el => { const p = byId('people', el.dataset.id); if (p) setMe({ id: p.id, name: p.name }); },
  'switch-me': () => { S.me = null; store.del(ME_KEY); render(); },
  signout: () => {
    store.del(PIN_KEY); store.del(ME_KEY);
    Object.assign(S, { pin: null, role: null, me: null, data: null, view: 'home', sub: null, err: '' });
    closeSheet(); render();
  },
  toggle: el => { if (el.dataset.close) closeSheet(); toggleTask(el.dataset.id); },
  task: el => openSheet(taskSheet(byId('tasks', el.dataset.id))),
  'new-task': el => openSheet(taskSheet({ project_id: el.dataset.project || null, event_id: el.dataset.event || null, area: el.dataset.area === 'General' ? '' : el.dataset.area || '', owner_id: null })),
  event: el => go('event', el.dataset.id, S.view === 'event' ? S.back : { view: S.view, sub: S.sub }),
  back: () => { const b = S.back || { view: 'calendar' }; go(b.view, b.sub || null); },
  plan: el => { const x = byId('plan', el.dataset.id); if (x && isAdult()) openSheet(planSheet(x)); },
  'new-plan': el => {
    const d = el.dataset;
    const ev = byId('events', d.event);
    const proj = byId('projects', d.project);
    const last = d.kind === 'agenda' ? planFor('agenda', d.project ? { project: d.project } : { event: d.event }).sort(byAgenda).pop() : null;
    openSheet(planSheet({ kind: d.kind, section: d.section || '', project_id: d.project || null, event_id: d.event || null,
      day: d.kind === 'agenda' ? (last && last.day) || (ev ? ev.start_date : proj && proj.event_date) || null : null, start_time: last ? last.end_time : '' }));
  },
  async 'plan-done'(el) {
    const x = byId('plan', el.dataset.id);
    if (!x || !isAdult()) return;
    await busy(null, async () => { await save('plan', { ...x, done: !x.done }); render(); });
  },
  async starter(el) {
    await busy(null, async () => {
      for (const [section, title] of EVENT_STARTER) await save('plan', { kind: 'list', event_id: el.dataset.id, section, title });
      render(); toast('Checklist added. Say who has each one.');
    });
  },
  recap: el => openSheet(recapSheet(byId('events', el.dataset.id))),
  'copy-plan': el => openSheet(copySheet(byId('events', el.dataset.id))),
  'bulk-date': el => openSheet(bulkDateSheet(byId('projects', el.dataset.project), el.dataset.area)),
  ptab: el => { S.ptab = el.dataset.t; render(); },
  pfilter: el => { S.ptab = 'tasks'; S.pfilter = el.dataset.f; render(); },
  area: el => { const a = el.dataset.a; if (S.open.has(a)) S.open.delete(a); else S.open.add(a); render(); },
  'area-all': () => {
    if (S.open.size) S.open.clear();
    else S.data.tasks.filter(x => x.project_id === S.sub).forEach(x => S.open.add(areaOf(x)));
    render();
  },
  amode: el => { S.amode = el.dataset.m; render(); },
  'cal-filter': el => {
    S.calFilter = el.dataset.f; S.day = null;
    if (el.dataset.mode) S.calMode = el.dataset.mode;
    if (S.view !== 'calendar') return go('calendar');
    render();
  },
  'cal-mode': el => { S.calMode = el.dataset.m; render(); },
  'cal-past': () => { S.calPast = !S.calPast; render(); },
  print: () => window.print(),
  'ics-all': () => {
    const list = calEvents().filter(e => S.calPast || upcoming(e)).sort(byEventDate);
    if (list.length) downloadIcs(list, 'youth-calendar'); else toast('No events to add.');
  },
  'edit-event': el => openSheet(eventSheet(byId('events', el.dataset.id))),
  'new-event': el => {
    const p = byId('projects', el.dataset.project);
    openSheet(eventSheet({ adults: [], info_only: false, category: p ? (CATEGORIES.includes(p.kind) ? p.kind : 'Stake activity') : 'Stake activity', audience: 'All youth',
      start_date: S.view === 'calendar' && S.day ? S.day : (p && p.event_date) || '', project_id: p ? p.id : null, title: p ? p.title : '' }));
  },
  project: el => {
    if (S.view !== 'project' || S.sub !== el.dataset.id) Object.assign(S, { ptab: 'overview', pfilter: 'all', open: new Set() });
    go('project', el.dataset.id);
  },
  'new-project': () => openSheet(projectSheet({ status: 'planning', kind: 'Youth conference' })),
  'edit-project': el => openSheet(projectSheet(byId('projects', el.dataset.id))),
  person: el => openSheet(personSheet(byId('people', el.dataset.id))),
  'new-person': () => openSheet(personSheet({ kind: S.kind, ward: 'Stake' })),
  kind: el => { S.kind = el.dataset.k; render(); },
  filter: el => { S.filter = el.dataset.f; render(); },
  day: el => { const d = el.dataset.day; S.day = d && d !== S.day ? d : null; render(); },
  month: el => {
    const n = Number(el.dataset.d);
    if (!n) { S.month = today().slice(0, 7); S.day = today(); return render(); }
    const [y, m] = (S.month || today().slice(0, 7)).split('-').map(Number);
    const d = new Date(y, m - 1 + n, 1);
    S.month = `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; S.day = null; render();
  },
  ics: el => downloadIcs([byId('events', el.dataset.id)]),
  async checklist(el) {
    const p = byId('projects', el.dataset.id);
    const has = S.data.tasks.some(x => x.project_id === p.id);
    const msg = (has ? `This project already has tasks. Add the ${CHECKLIST.length} checklist tasks anyway?` : `Add the ${CHECKLIST.length}-task planning checklist?`)
      + (p.event_date ? '' : '\n\nThe project has no event date yet, so the tasks will have no due dates.');
    if (!confirm(msg)) return;
    await busy(null, async () => { await addChecklist(p); render(); toast('Checklist added. Assign owners next.'); });
  },
  async delete(el) {
    const { kind, id } = el.dataset;
    const what = { task: 'this assignment', event: 'this event and its plan (schedule, list, assignments, budget)', project: 'this project and all of its tasks, agenda, and budget',
      person: 'this person (their tasks become unassigned)', plan: 'this line' }[kind];
    if (!confirm(`Delete ${what}? This can't be undone.`)) return;
    await busy(null, async () => {
      await api.remove(S.pin, S.me.name, kind, id);
      S.data[KEY[kind]] = S.data[KEY[kind]].filter(x => x.id !== id);
      if (kind === 'project') {
        S.data.tasks = S.data.tasks.filter(t => t.project_id !== id);
        S.data.events.forEach(e => { if (e.project_id === id) e.project_id = null; });
        S.data.plan = S.data.plan.filter(x => x.project_id !== id);
        if (S.view === 'project') S.view = 'projects';
      }
      if (kind === 'event') {
        S.data.tasks = S.data.tasks.filter(t => t.event_id !== id);
        S.data.plan = S.data.plan.filter(x => x.event_id !== id);
        if (S.view === 'event') { const b = S.back || { view: 'calendar' }; Object.assign(S, { view: b.view, sub: b.sub || null, back: null }); }
      }
      if (kind === 'person') {
        S.data.tasks.forEach(t => { if (t.owner_id === id) t.owner_id = null; });
        S.data.events.forEach(e => { e.adults = e.adults.filter(a => a !== id); });
        S.data.projects.forEach(p => { if (p.adult_lead === id) p.adult_lead = null; if (p.youth_lead === id) p.youth_lead = null; });
      }
      closeSheet(); render(); toast('Deleted');
    });
  },
  'reset-demo': () => {
    if (!confirm('Put the demo data back to the original samples?')) return;
    api.reset(); ACTIONS.signout();
  },
};

/* ---------- sign-in ---------- */
async function signIn(pin, remember) {
  const d = await api.load(pin);
  S.pin = pin; S.role = d.role; S.data = normalize(d); S.loadedAt = Date.now();
  store.del(PIN_KEY);
  store.set(PIN_KEY, pin, remember);
}
function setMe(me) {
  S.me = me;
  store.set(ME_KEY, JSON.stringify(me), !!localStorage.getItem(PIN_KEY));
  S.view = 'home'; render();
}

/* ---------- render, toast, wiring ---------- */
function render() {
  const app = $('#app');
  if (!S.data) { app.innerHTML = vPin(); return; }
  if (!S.me) { app.innerHTML = vWho(); return; }
  const views = { home: vHome, calendar: vCalendar, event: vEvent, tasks: vTasks, projects: vProjects, project: vProject, more: vMore, people: vPeople, resources: vResources, settings: vSettings };
  app.innerHTML = header() + `<main class="wrap">${(views[S.view] || vHome)()}</main>` + nav();
  const on = $('.ptabs .on');   // keep the open project tab in view on a narrow screen
  if (on) on.parentElement.scrollLeft = on.offsetLeft - 60;
}

let toastTimer;
function toast(msg, undo) {
  const t = $('#toast');
  t.innerHTML = `<span>${esc(msg)}</span>${undo ? '<button class="link">Undo</button>' : ''}`;
  t.classList.add('show');
  if (undo) t.querySelector('button').onclick = () => { t.classList.remove('show'); undo(); };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), undo ? 6000 : 2800);
}

document.addEventListener('click', e => {
  if (e.target.closest('a[href]')) return;
  const el = e.target.closest('[data-act]');
  if (!el || el.disabled) return;
  const fn = ACTIONS[el.dataset.act];
  if (fn) { e.preventDefault(); fn(el, e); }
});
document.addEventListener('submit', e => {
  const f = e.target.closest('form[data-form]');
  if (!f) return;
  e.preventDefault();
  FORMS[f.dataset.form] && FORMS[f.dataset.form](f);
});
document.addEventListener('input', e => {
  const sel = e.target.dataset && e.target.dataset.filter;
  if (!sel) return;
  const q = e.target.value.toLowerCase();
  document.querySelectorAll(sel).forEach(b => { b.hidden = !b.textContent.toLowerCase().includes(q); });
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && $('#sheet-root').innerHTML) closeSheet();
  if (e.key === 'Enter' && e.target.matches('div[role=button][data-act]')) e.target.click();
});
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible' || !S.pin || Date.now() - S.loadedAt < 60000 || $('#sheet-root').innerHTML) return;
  try { const d = await api.load(S.pin); S.role = d.role; S.data = normalize(d); S.loadedAt = Date.now(); render(); } catch { /* keep what we have */ }
});

(async function boot() {
  const pin = store.get(PIN_KEY);
  if (pin) {
    try {
      await signIn(pin, !!localStorage.getItem(PIN_KEY));
      const me = JSON.parse(store.get(ME_KEY) || 'null');
      if (me && me.name) S.me = { id: me.id && byId('people', me.id) ? me.id : null, name: me.name };
    } catch { store.del(PIN_KEY); }
  }
  render();
})();
