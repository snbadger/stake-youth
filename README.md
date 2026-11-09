# Stake Youth app

A phone-first web app for stake and ward youth leaders: a shared **calendar** of stake youth
events, **assignments** for adult and youth leaders, and **projects** (youth conference and other
stake activities) with a planning checklist. Built the same way as the Morning Star staff apps —
static HTML/CSS/JS, no build step, Supabase behind PIN-checked functions — but on its own church
Supabase project. Nothing here touches Jericho's project.

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
| Add/edit/delete anything, settings, PINs | yes | no |
| See youth protection training dates | yes | no |

Everyone taps their name once per device (or types it). Youth leaders are listed as first name
and last initial — the app never needs more than that.

## Demo mode

Open `index.html` with no Supabase keys. Adult PIN **1111**, youth PIN **2222**. Sample data is
labeled "(sample)"; reset it under More → Settings.

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

- Youth events with fewer than two adult leaders listed show a warning (General Handbook 10.8.1).
- Each adult's youth protection training date is tracked; expired or missing dates show on the
  home screen for adult leaders. Training is required within one month of being sustained and
  every three years (General Handbook 10.8.1).
- Verify current guidance at churchofjesuschrist.org — the Resources screen links to it.
