'use strict';
/* Stake Youth — calendar, leader assignments, and project planning for stake youth activities.
   Static page, no build step. Live data goes through PIN-checked Supabase RPCs (supabase/schema.sql)
   when config.js has keys; otherwise a demo that saves to this device only. */

const CFG = window.SYA_CONFIG || {};
const LIVE = !!(CFG.supabaseUrl && CFG.supabaseAnonKey);
const KEY = { person: 'people', event: 'events', project: 'projects', task: 'tasks' };

/* ---------- helpers ---------- */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36));
const pad = n => String(n).padStart(2, '0');
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const today = () => iso(new Date());
const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
const addYears = (s, n) => { const d = parse(s); d.setFullYear(d.getFullYear() + n); return iso(d); };
const daysBetween = (a, b) => Math.round((parse(b) - parse(a)) / 864e5);
const fmtDate = (s, o = { month: 'short', day: 'numeric' }) => (s ? parse(s).toLocaleDateString(undefined, o) : '');
const fmtTime = t => {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
};
const firstName = n => String(n || '').split(/\s+/)[0];
const initials = n => String(n || '?').split(/\s+/).filter(w => /^[A-Za-z]/.test(w)).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '?';
const byName = (a, b) => a.name.localeCompare(b.name);
const byDue = (a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999') || a.title.localeCompare(b.title);
const byEventDate = (a, b) => a.start_date.localeCompare(b.start_date) || (a.start_time || '').localeCompare(b.start_time || '');
const byProjectDate = (a, b) => (a.event_date || '9999').localeCompare(b.event_date || '9999');

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
  ['Safety', 'Confirm adult leaders have current youth protection training (GH 10.8.1)', -30],
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
  const K = 'sya_demo_v1';
  let db = null;
  try { db = JSON.parse(localStorage.getItem(K)); } catch { /* ignore */ }
  if (!db) db = demoSeed();
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
      if (role !== 'adult') d.people.forEach(p => delete p.ypt_date);
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
  const P = (name, role, ward, kind, ypt) => ({ id: uid(), name, role, ward, kind, ypt_date: ypt || null, active: true });
  const pres = P('Stake YM President (sample)', 'Stake Young Men President', 'Stake', 'adult', addDays(t, -200));
  const sec = P('Stake YM Secretary (sample)', 'Stake Young Men Secretary', 'Stake', 'adult', addDays(t, -400));
  const yw = P('Stake YW President (sample)', 'Stake Young Women President', 'Stake', 'adult', null);
  const bish = P('Bishopric Counselor (sample)', 'Bishopric', 'Ward 1', 'adult', addDays(t, -1200));
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
    description: '', project_id: null, adults: [], ...extra,
  });
  const events = [
    ev('Stake Youth Conference (sample)', 'Youth conference', yc.event_date, { end_date: addDays(yc.event_date, 2), location: '[FILL IN]', project_id: yc.id, adults: [pres.id, yw.id] }),
    ev('Stake youth leadership committee (sample)', 'Leadership meeting', addDays(t, 5), { start_time: '19:00', end_time: '20:00', location: 'Stake center', audience: 'Youth and leaders', adults: [pres.id, sec.id] }),
    ev('Stake youth devotional (sample)', 'Devotional', addDays(t, 20), { start_time: '19:00', end_time: '20:00', location: 'Stake center', adults: [pres.id] }),
  ];
  return {
    settings: { stake_name: 'Demo Stake', wards: 'Ward 1\nWard 2\nWard 3' },
    people: [pres, sec, yw, bish, y1, y2], projects: [yc], events, tasks,
  };
}

/* ---------- state ---------- */
const S = { pin: null, role: null, me: null, data: null, view: 'home', sub: null, filter: 'mine', month: null, day: null, kind: 'adult', err: '', loadedAt: 0 };
const isAdult = () => S.role === 'adult';
const byId = (list, id) => (id ? S.data[list].find(x => x.id === id) : null);
const personName = id => (byId('people', id) || {}).name || '';
const wards = () => String(S.data.settings.wards || '').split('\n').map(w => w.trim()).filter(Boolean);
const isMine = x => {
  if (S.me.id) return x.owner_id === S.me.id;
  return personName(x.owner_id).toLowerCase() === S.me.name.toLowerCase();
};
const canToggle = x => isAdult() || isMine(x);
const eventsOn = d => S.data.events.filter(e => e.start_date <= d && (e.end_date || e.start_date) >= d).sort(byEventDate);
const youthEvent = e => e.audience !== 'Adult leaders';
const catKey = c => String(c || 'other').toLowerCase().replace(/[^a-z]+/g, '-');

function normalize(d) {
  const t5 = s => (s ? String(s).slice(0, 5) : '');
  return {
    settings: d.settings || {},
    people: d.people || [],
    projects: d.projects || [],
    tasks: d.tasks || [],
    events: (d.events || []).map(e => ({ ...e, adults: e.adults || [], start_time: t5(e.start_time), end_time: t5(e.end_time) })),
  };
}

function yptStatus(p) {
  if (!p.ypt_date) return 'missing';
  const exp = addYears(p.ypt_date, 3);
  if (exp < today()) return 'expired';
  if (exp <= addDays(today(), 60)) return 'soon';
  return 'ok';
}
const YPT_LABEL = { missing: 'No training date', expired: 'Training expired', soon: 'Training due soon', ok: 'Training current' };

/* ---------- small pieces ---------- */
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
  const meta = [owner ? esc(owner) : '<span class="muted">Unassigned</span>', proj ? esc(proj.title) : ''].filter(Boolean).join(' · ');
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
  return `<button class="row-item" data-act="event" data-id="${e.id}">
    <span class="datebox cat-${catKey(e.category)}"><span>${d.toLocaleDateString(undefined, { month: 'short' })}</span><b>${d.getDate()}</b></span>
    <span class="grow"><span class="ttl">${esc(e.title)}</span><span class="meta">${whenText(e)}${e.location ? ' · ' + esc(e.location) : ''}</span></span>
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
  const tab = { project: 'projects', people: 'more', resources: 'more', settings: 'more' }[S.view] || S.view;
  const items = [['home', 'Home'], ['calendar', 'Calendar'], ['tasks', 'Assignments'], ['projects', 'Projects'], ['more', 'More']];
  return `<nav class="tabs">${items.map(([v, label]) =>
    `<button class="${tab === v ? 'on' : ''}" data-act="go" data-view="${v}">${ICON[v]}<span>${label}</span></button>`).join('')}</nav>`;
}

function alerts() {
  const t = today();
  const out = [];
  const ypt = S.data.people.filter(p => p.kind === 'adult' && p.active !== false && yptStatus(p) !== 'ok');
  if (ypt.length) {
    out.push(`<button class="alert" data-act="go" data-view="people">${ICON.shield}<span><b>${ypt.length} adult leader${ypt.length > 1 ? 's' : ''}</b> missing or due for youth protection training</span></button>`);
  }
  S.data.events
    .filter(e => e.start_date >= t && e.start_date <= addDays(t, 60) && youthEvent(e) && e.adults.length < 2)
    .sort(byEventDate)
    .forEach(e => out.push(`<button class="alert" data-act="event" data-id="${e.id}">${ICON.alert}<span><b>${esc(e.title)}</b> has ${e.adults.length ? 'only 1 adult leader' : 'no adult leaders'} listed (need at least 2)</span></button>`));
  return out.length ? `<div class="alerts">${out.join('')}</div>` : '';
}

function vHome() {
  const t = today();
  const mine = S.data.tasks.filter(x => !x.done && isMine(x)).sort(byDue);
  const overdue = mine.filter(x => x.due_date && x.due_date < t);
  const soon = mine.filter(x => !x.due_date || x.due_date >= t).slice(0, 6);
  const upcoming = S.data.events.filter(e => (e.end_date || e.start_date) >= t).sort(byEventDate).slice(0, 5);
  const projects = S.data.projects.filter(p => p.status !== 'done' && p.status !== 'cancelled').sort(byProjectDate);
  return `<h2 class="hello">Hi, ${esc(firstName(S.me.name))}</h2>
    ${isAdult() ? alerts() : ''}
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
  const m = S.month || today().slice(0, 7);
  const [y, mo] = m.split('-').map(Number);
  const first = new Date(y, mo - 1, 1);
  const days = new Date(y, mo, 0).getDate();
  const cells = [];
  for (let i = 0; i < first.getDay(); i++) cells.push('<span class="cal-cell blank"></span>');
  for (let d = 1; d <= days; d++) {
    const ds = `${m}-${pad(d)}`;
    const evs = eventsOn(ds);
    cells.push(`<button class="cal-cell ${ds === today() ? 'today' : ''} ${ds === S.day ? 'sel' : ''}" data-act="day" data-day="${ds}" aria-label="${fmtDate(ds, { month: 'long', day: 'numeric' })}, ${evs.length} events">
      <span class="dn">${d}</span>
      ${evs.slice(0, 2).map(e => `<span class="cal-ev cat-${catKey(e.category)}">${esc(e.title)}</span>`).join('')}
      ${evs.length > 2 ? `<span class="cal-more">+${evs.length - 2}</span>` : ''}
    </button>`);
  }
  const list = S.day ? eventsOn(S.day)
    : S.data.events.filter(e => e.start_date <= `${m}-31` && (e.end_date || e.start_date) >= `${m}-01`).sort(byEventDate);
  return `<div class="page-h"><h2>Calendar</h2>${isAdult() ? '<button class="btn primary" data-act="new-event">+ Event</button>' : ''}</div>
    <section class="card cal">
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

function vProject() {
  const p = byId('projects', S.sub);
  if (!p) { S.view = 'projects'; return vProjects(); }
  const tasks = S.data.tasks.filter(x => x.project_id === p.id);
  const g = progress(p);
  const groups = new Map();
  tasks.forEach(x => { const a = x.area || 'General'; if (!groups.has(a)) groups.set(a, []); groups.get(a).push(x); });
  const rank = a => { const i = AREA_ORDER.indexOf(a); return i < 0 ? (a === 'General' ? -1 : 99) : i; };
  const areas = [...groups.entries()].sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]));
  const evs = S.data.events.filter(e => e.project_id === p.id).sort(byEventDate);
  return `<button class="back" data-act="go" data-view="projects">‹ Projects</button>
    <section class="card">
      <div class="proj-top"><div><div class="eyebrow">${esc(p.kind || 'Project')} · ${STATUSES[p.status] || ''}</div><h2>${esc(p.title)}</h2></div>${countdown(p.event_date)}</div>
      <dl class="facts">
        <dt>Event date</dt><dd>${p.event_date ? fmtDate(p.event_date, { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' }) : '<span class="muted">Not set</span>'}</dd>
        <dt>Adult lead</dt><dd>${esc(personName(p.adult_lead)) || '<span class="muted">Not set</span>'}</dd>
        <dt>Youth lead</dt><dd>${esc(personName(p.youth_lead)) || '<span class="muted">Not set</span>'}</dd>
        ${p.purpose ? `<dt>Purpose</dt><dd class="pre">${esc(p.purpose)}</dd>` : ''}
        ${p.notes ? `<dt>Notes</dt><dd class="pre">${esc(p.notes)}</dd>` : ''}
      </dl>
      <div class="bar big"><i style="width:${g.pct}%"></i></div>
      <div class="meta">${g.done} of ${g.total} tasks done (${g.pct}%)${g.overdue ? ` · <span class="danger">${g.overdue} overdue</span>` : ''}</div>
      ${isAdult() ? `<div class="btn-row">
        <button class="btn primary" data-act="new-task" data-project="${p.id}">+ Task</button>
        <button class="btn" data-act="new-event" data-project="${p.id}">+ Event</button>
        <button class="btn" data-act="checklist" data-id="${p.id}">Add planning checklist</button>
        <button class="btn ghost" data-act="edit-project" data-id="${p.id}">Edit project</button>
      </div>` : ''}
    </section>
    ${evs.length ? `<section class="card"><div class="card-h"><h3>Events</h3></div>${evs.map(eventRow).join('')}</section>` : ''}
    ${areas.map(([a, xs]) => `<section class="card"><div class="card-h"><h3>${esc(a)}</h3><span class="meta">${xs.filter(x => x.done).length}/${xs.length}</span></div>
      ${xs.sort(byDue).map(x => taskRow(x, false)).join('')}</section>`).join('')}
    ${tasks.length ? '' : `<section class="card">${empty(isAdult() ? 'No tasks yet. Add your own, or start with the planning checklist.' : 'No tasks yet.')}</section>`}`;
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
    ${kind === 'adult' && isAdult() ? '<p class="muted intro">Adults who work with youth complete youth protection training within one month of being sustained and every three years (General Handbook 10.8.1). Add each person\'s training date to track it here.</p>' : ''}
    ${kind === 'youth' ? '<p class="muted intro">First name and last initial is enough for youth leaders.</p>' : ''}
    ${[...groups.entries()].sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0])).map(([w, ps]) => `<section class="card"><div class="card-h"><h3>${esc(w)}</h3></div>
      ${ps.map(p => {
        const st = kind === 'adult' && isAdult() ? yptStatus(p) : null;
        const open = S.data.tasks.filter(x => !x.done && x.owner_id === p.id).length;
        return `<button class="row-item" data-act="person" data-id="${p.id}"><span class="avatar">${esc(initials(p.name))}</span>
          <span class="grow"><span class="ttl">${esc(p.name)}${p.active === false ? ' <span class="muted">(inactive)</span>' : ''}</span><span class="meta">${esc(p.role || '')}${open ? ` · ${open} open task${open > 1 ? 's' : ''}` : ''}</span></span>
          ${st ? pill(YPT_LABEL[st], st === 'ok' ? 'ok' : st === 'soon' ? 'warn' : 'danger') : ''}</button>`;
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
  if (!isAdult()) {
    const proj = byId('projects', x.project_id);
    return sheetHead(x.title, x.area || 'Assignment') + `<dl class="facts">
      <dt>Owner</dt><dd>${esc(personName(x.owner_id)) || 'Unassigned'}</dd>
      <dt>Due</dt><dd>${x.due_date ? fmtDate(x.due_date, { weekday: 'short', month: 'long', day: 'numeric' }) : 'No date'}</dd>
      ${proj ? `<dt>Project</dt><dd>${esc(proj.title)}</dd>` : ''}
      ${x.notes ? `<dt>Notes</dt><dd class="pre">${esc(x.notes)}</dd>` : ''}</dl>
      ${canToggle(x) ? `<div class="btn-row"><button class="btn primary" data-act="toggle" data-id="${x.id}" data-close="1">${x.done ? 'Mark not done' : 'Mark done'}</button></div>` : ''}`;
  }
  const areas = [...new Set([...AREA_ORDER, ...S.data.tasks.map(t => t.area).filter(Boolean)])];
  return sheetHead(x.id ? 'Edit assignment' : 'New assignment') + `<form data-form="task" class="stack">
    <input type="hidden" name="id" value="${esc(x.id || '')}">
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

function eventDetail(e) {
  const proj = byId('projects', e.project_id);
  const adults = e.adults.map(id => byId('people', id)).filter(Boolean);
  const warn = youthEvent(e) && adults.length < 2;
  return sheetHead(e.title, e.category || 'Event') + `<dl class="facts">
      <dt>When</dt><dd>${whenText(e, true)}</dd>
      ${e.location ? `<dt>Where</dt><dd>${esc(e.location)}</dd>` : ''}
      ${e.audience ? `<dt>Who</dt><dd>${esc(e.audience)}</dd>` : ''}
      <dt>Adult leaders</dt><dd>${adults.length ? adults.map(a => esc(a.name)).join(', ') : '<span class="muted">None listed</span>'}
        ${warn ? '<div class="danger small">Plan for at least two responsible adults (GH 10.8.1).</div>' : ''}</dd>
      ${proj ? `<dt>Project</dt><dd><button class="link" data-act="project" data-id="${proj.id}">${esc(proj.title)}</button></dd>` : ''}
      ${e.description ? `<dt>Details</dt><dd class="pre">${esc(e.description)}</dd>` : ''}
    </dl>
    <div class="btn-row"><button class="btn" data-act="ics" data-id="${e.id}">Add to my calendar</button>
      ${isAdult() ? `<button class="btn primary" data-act="edit-event" data-id="${e.id}">Edit</button>` : ''}</div>`;
}

function eventSheet(e) {
  const adults = S.data.people.filter(p => p.kind === 'adult' && (p.active !== false || e.adults.includes(p.id))).sort(byName);
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
    <label>Details<textarea name="description" rows="3">${esc(e.description || '')}</textarea></label>
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
    ${p.id ? '' : '<label class="check-row"><input type="checkbox" name="checklist" checked> Start with the planning checklist (18 tasks you can edit)</label>'}
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
    <label class="adult-only">Youth protection training completed <small class="muted">adults only</small><input type="date" name="ypt_date" value="${esc(p.ypt_date || '')}"></label>
    <label class="check-row"><input type="checkbox" name="active" ${p.active === false ? '' : 'checked'}> Active (shows in lists)</label>
    <div class="btn-row"><button class="btn primary" type="submit">Save</button>
      ${p.id ? `<button class="btn danger ghost" type="button" data-act="delete" data-kind="person" data-id="${p.id}">Delete</button>` : ''}</div>
  </form>`;
}

/* ---------- saving ---------- */
function upsertLocal(kind, row) {
  const list = S.data[KEY[kind]];
  if (kind === 'event') row = normalize({ events: [row] }).events[0];
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
      await save('task', { id: v.id || undefined, title: v.title, owner_id: v.owner_id || null, due_date: v.due_date || null, project_id: v.project_id || null, area: v.area, notes: v.notes });
      closeSheet(); render(); toast('Saved');
    });
  },
  async event(f) {
    const v = vals(f);
    if (v.end_date && v.end_date < v.start_date) return toast('End date is before the start date.');
    await busy(f, async () => {
      await save('event', {
        id: v.id || undefined, title: v.title, category: v.category, audience: v.audience, start_date: v.start_date,
        end_date: v.end_date && v.end_date !== v.start_date ? v.end_date : null, start_time: v.start_time || null, end_time: v.end_time || null,
        location: v.location, project_id: v.project_id || null, description: v.description,
        adults: [...f.querySelectorAll('input[name=adults]:checked')].map(i => i.value),
      });
      closeSheet(); render(); toast('Saved');
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
      await save('person', { id: v.id || undefined, name: v.name, kind: v.kind, role: v.role, ward: v.ward, ypt_date: v.kind === 'adult' ? v.ypt_date || null : null, active: !!v.active });
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
      if (v.which === 'adult') { S.pin = v.next; store.set('sya_pin', v.next, !!localStorage.getItem('sya_pin')); }
      f.reset(); toast(`${v.which === 'adult' ? 'Adult' : 'Youth'} PIN changed. Tell the other leaders.`);
    });
  },
};

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

function downloadIcs(e) {
  const escI = s => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  const d = s => s.replace(/-/g, '');
  const dt = (date, time) => d(date) + 'T' + time.replace(':', '') + '00';
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Stake Youth//EN', 'BEGIN:VEVENT', `UID:${e.id}@stake-youth`, `DTSTAMP:${stamp}`];
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
  lines.push('END:VEVENT', 'END:VCALENDAR');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/calendar' }));
  a.download = (e.title.replace(/[^\w]+/g, '-').replace(/^-|-$/g, '') || 'event') + '.ics';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function go(view, sub = null) {
  S.view = view; S.sub = sub;
  closeSheet(); render(); window.scrollTo(0, 0);
}

const ACTIONS = {
  go: el => go(el.dataset.view),
  'close-sheet': closeSheet,
  'pick-me': el => { const p = byId('people', el.dataset.id); if (p) setMe({ id: p.id, name: p.name }); },
  'switch-me': () => { S.me = null; store.del('sya_me'); render(); },
  signout: () => {
    store.del('sya_pin'); store.del('sya_me');
    Object.assign(S, { pin: null, role: null, me: null, data: null, view: 'home', sub: null, err: '' });
    closeSheet(); render();
  },
  toggle: el => { if (el.dataset.close) closeSheet(); toggleTask(el.dataset.id); },
  task: el => openSheet(taskSheet(byId('tasks', el.dataset.id))),
  'new-task': el => openSheet(taskSheet({ project_id: el.dataset.project || null, owner_id: null })),
  event: el => { const e = byId('events', el.dataset.id); if (e) openSheet(eventDetail(e)); },
  'edit-event': el => openSheet(eventSheet(byId('events', el.dataset.id))),
  'new-event': el => {
    const p = byId('projects', el.dataset.project);
    openSheet(eventSheet({ adults: [], category: p ? (CATEGORIES.includes(p.kind) ? p.kind : 'Stake activity') : 'Stake activity', audience: 'All youth',
      start_date: S.view === 'calendar' && S.day ? S.day : (p && p.event_date) || '', project_id: p ? p.id : null, title: p ? p.title : '' }));
  },
  project: el => go('project', el.dataset.id),
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
  ics: el => downloadIcs(byId('events', el.dataset.id)),
  async checklist(el) {
    const p = byId('projects', el.dataset.id);
    const has = S.data.tasks.some(x => x.project_id === p.id);
    const msg = (has ? 'This project already has tasks. Add the 18 checklist tasks anyway?' : 'Add the 18-task planning checklist?')
      + (p.event_date ? '' : '\n\nThe project has no event date yet, so the tasks will have no due dates.');
    if (!confirm(msg)) return;
    await busy(null, async () => { await addChecklist(p); render(); toast('Checklist added. Assign owners next.'); });
  },
  async delete(el) {
    const { kind, id } = el.dataset;
    const what = { task: 'this assignment', event: 'this event', project: 'this project and all of its tasks', person: 'this person (their tasks become unassigned)' }[kind];
    if (!confirm(`Delete ${what}? This can't be undone.`)) return;
    await busy(null, async () => {
      await api.remove(S.pin, S.me.name, kind, id);
      S.data[KEY[kind]] = S.data[KEY[kind]].filter(x => x.id !== id);
      if (kind === 'project') {
        S.data.tasks = S.data.tasks.filter(t => t.project_id !== id);
        S.data.events.forEach(e => { if (e.project_id === id) e.project_id = null; });
        if (S.view === 'project') S.view = 'projects';
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
  store.del('sya_pin');
  store.set('sya_pin', pin, remember);
}
function setMe(me) {
  S.me = me;
  store.set('sya_me', JSON.stringify(me), !!localStorage.getItem('sya_pin'));
  S.view = 'home'; render();
}

/* ---------- render, toast, wiring ---------- */
function render() {
  const app = $('#app');
  if (!S.data) { app.innerHTML = vPin(); return; }
  if (!S.me) { app.innerHTML = vWho(); return; }
  const views = { home: vHome, calendar: vCalendar, tasks: vTasks, projects: vProjects, project: vProject, more: vMore, people: vPeople, resources: vResources, settings: vSettings };
  app.innerHTML = header() + `<main class="wrap">${(views[S.view] || vHome)()}</main>` + nav();
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
document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('#sheet-root').innerHTML) closeSheet(); });
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible' || !S.pin || Date.now() - S.loadedAt < 60000 || $('#sheet-root').innerHTML) return;
  try { const d = await api.load(S.pin); S.role = d.role; S.data = normalize(d); S.loadedAt = Date.now(); render(); } catch { /* keep what we have */ }
});

(async function boot() {
  const pin = store.get('sya_pin');
  if (pin) {
    try {
      await signIn(pin, !!localStorage.getItem('sya_pin'));
      const me = JSON.parse(store.get('sya_me') || 'null');
      if (me && me.name) S.me = { id: me.id && byId('people', me.id) ? me.id : null, name: me.name };
    } catch { store.del('sya_pin'); }
  }
  render();
})();
