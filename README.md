# Stake Youth app

A phone-first web app for stake and ward youth leaders: a shared **calendar** of stake youth
events, **assignments** for adult and youth leaders, and **projects** (youth conference and other
stake activities) with a planning checklist. Built the same way as the Morning Star staff apps —
static HTML/CSS/JS, no build step, Supabase behind PIN-checked functions — but on its own church
Supabase project. Nothing here touches Jericho's project.

**Live:** https://snbadger.github.io/stake-youth/ (GitHub Pages from the separate repo
`snbadger/stake-youth`, which is a copy of this folder without `PINS-private.txt`). This folder is
the source of record; to deploy a change, copy the files into a clone of that repo and push.

## What it does

- **Calendar** — month view or a list by month (the same shape as the printed senior calendar).
  Filter to Seniors, SYC, leader meetings, or events that still need something. Print the list or
  add every event to a phone calendar at once.
- **Event pages** — tap any event to plan it: schedule, assignments (they show on each owner's
  home screen), a food / set-up / what-to-bring list, a budget, and an after-the-event recap
  (attendance, what to keep or change). "Copy a plan" reuses last time's plan with the dates
  shifted. Events that repeat (dance practice, choir) can share a location and adult leaders in
  one save. Mark an event "calendar note only" when there is nothing to plan.
- **Needs attention** — the home screen lists events in the next 45 days that lack a location or
  a time.
- **Projects (SYC)** — Overview, Committees (tasks grouped by committee, with filters for mine,
  unassigned, no due date, overdue, and a bulk due-date setter), Timeline (tasks and events by
  month), Agenda (the run of show by day, with views for seniors, chaperones, and a high-level
  version; printable), and Budget (approved, planned, spent, left).
- **Assignments** — everyone's tasks, with owners and due dates.

## Files

```
index.html             Shell; loads config.js and app.js
app.js                 The whole app (screens, forms, demo mode, Supabase calls)
styles.css             Look and feel (light + dark)
config.js              Supabase URL + anon key. Blank = demo mode (saves to this device only)
supabase/schema.sql    Tables + PIN-checked functions for the church Supabase project
manifest.webmanifest   Add to Home Screen support
icon.svg               App icon
```

## Who can do what

| | Adult PIN | Youth PIN |
|---|---|---|
| See calendar, assignments, projects, leader list | yes | yes |
| Check off tasks | any | only their own |
| See budgets | yes | no (the server never sends them) |
| Add/edit/delete anything, settings, PINs | yes | no |

Everyone taps their name once per device (or types it). Youth leaders are listed as first name
and last initial — the app never needs more than that.

## Demo mode

Add `?demo` to the address (for example `http://localhost:8120/?demo`), or open `index.html` with
no Supabase keys. Adult PIN **1111**, youth PIN **2222**. Sample data is labeled "(sample)"; reset
it under More → Settings. Demo mode saves to the device only and keeps its own sign-in, so trying
it never touches live data or signs the device out of the live app.

## Updating a live database

When `supabase/schema.sql` changes, paste the whole file into the Supabase SQL editor and run it
again **before** publishing the new app files. It only adds what is missing and replaces the
functions; no data is changed. The older app keeps working against the newer database.

## Going live (about 20 minutes)

1. Create a free Supabase project under a **personal** account (not Jericho). Name it something
   like `stake-youth`.
2. SQL Editor → paste `supabase/schema.sql` → Run.
3. At the bottom of that file, uncomment the three setup lines, put in your adult PIN, youth PIN,
   stake name and wards, and run them.
4. Project Settings → API: copy the Project URL and the anon/publishable key into `config.js`.
5. Put this folder in a GitHub repo and turn on GitHub Pages (same as the Morning Star hub), or
   host it anywhere static. Share the link; leaders add it to their Home Screen.
6. In the app, go to More → Leaders and add the adult leaders and youth leaders.

## Safety notes built in

- The Resources screen states the two-adult guidance (General Handbook 10.8.1). The app does not
  warn about it per event; adult leaders can still be listed on an event.
- Youth protection training is tracked in LCR, not here.
- Verify current guidance at churchofjesuschrist.org — the Resources screen links to it.
