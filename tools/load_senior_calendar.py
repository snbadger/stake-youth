#!/usr/bin/env python3
"""Load the 2026–2027 Senior Calendar (Senior_Calendar_2026-27/*.png, Nov 2026 – May 2027) as events.

Also sets the SYC project's event date (Mar 22–24, 2027) and replaces the two Dec. 13–14 events
that came from the minutes with the calendar's own entries (the minutes' detail is kept in the
description). Skips any event whose title + start date is already there.
Usage: python3 tools/load_senior_calendar.py [--dry-run]
"""
import json, re, sys, urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
DRY = '--dry-run' in sys.argv
SYC = 'Stake Youth Conference 2027'
SUNDAY = 'Mission Prep · Choir · Senior Meeting'
SUN_DESC = 'Mission prep 45 min · choir 50 min · senior meeting 15 min. '
SPLITS_DESC = 'Companions visit an assigned family for a family home evening lesson and testimony. Visits are arranged with the family ahead of time; youth do not drive themselves to church activities.'

def E(start, title, category, start_time=None, end_time=None, end=None, desc='', audience='Seniors', syc=False):
    return dict(title=title, category=category, audience=audience, start_date=start, end_date=end,
                start_time=start_time, end_time=end_time, description=desc, syc=syc)

EVENTS = [
    E('2026-11-08', SUNDAY, 'Mission prep', '18:30', '20:30', desc=SUN_DESC + 'P&N · YW'),
    E('2026-11-14', 'Senior Activity', 'Stake activity', '09:00', '10:30'),
    E('2026-12-05', 'Senior Activity', 'Stake activity', desc='Morning (time TBD)'),
    E('2026-12-13', SUNDAY, 'Mission prep', '18:30', '20:30', desc=SUN_DESC + 'P&N · YM. First missionary-splits lesson: Preach My Gospel lesson, "mission call," and a companion from another ward (seniors only; youth who do not want to take part are not assigned).'),
    E('2026-12-14', 'Missionary Splits', 'Service', desc='Christmas lesson. ' + SPLITS_DESC),
    E('2027-01-10', SUNDAY, 'Mission prep', '18:30', '20:30', desc=SUN_DESC + 'P&N · YW'),
    E('2027-01-11', 'Senior Institute Night', 'Institute', desc='Stake center [VERIFY]. Pilot: Christ-centered message, snacks, activity. Bring a friend.'),
    E('2027-01-13', 'Dance Practice', 'Dance practice', '20:30', '21:30'),
    E('2027-01-18', 'Senior Institute Night', 'Institute', desc='Stake center [VERIFY]. Second pilot night.'),
    E('2027-01-20', 'Dance Practice', 'Dance practice', '20:30', '21:30'),
    E('2027-01-24', SUNDAY, 'Mission prep', '18:30', '20:30', desc=SUN_DESC + 'P&N · YM'),
    E('2027-01-25', 'Missionary Splits', 'Service', desc=SPLITS_DESC),
    E('2027-01-27', 'Dance Practice', 'Dance practice', '20:30', '21:30'),
    E('2027-01-29', 'Cabin Trip', 'Stake activity', end='2027-01-30', desc='Senior cabin trip.', syc=True),
    E('2027-01-31', 'Choir', 'Choir', '18:30', '19:30', desc='1 hr · P&N'),
    E('2027-02-03', 'Dance Practice', 'Dance practice', '20:30', '21:30'),
    E('2027-02-07', SUNDAY, 'Mission prep', '18:30', '20:30', desc=SUN_DESC + 'P&N · YW'),
    E('2027-02-10', 'Dance Practice', 'Dance practice', '20:30', '21:30'),
    E('2027-02-14', 'Choir', 'Choir', '19:30', '20:30', desc='1 hr · P&N'),
    E('2027-02-17', 'Dance Practice', 'Dance practice', '20:30', '21:30'),
    E('2027-02-24', 'Dance Practice', 'Dance practice', '20:30', '21:30'),
    E('2027-02-28', SUNDAY, 'Mission prep', '18:30', '20:30', desc=SUN_DESC + 'P&N · YM'),
    E('2027-03-01', 'Missionary Splits', 'Service', desc=SPLITS_DESC),
    E('2027-03-03', 'Dance Practice', 'Dance practice', '20:30', '21:30'),
    E('2027-03-06', 'Senior Work Day', 'Stake activity', '09:00', '12:00', desc='P&N. Senior counselor training happens here.', syc=True),
    E('2027-03-07', 'Choir', 'Choir', '16:30', '17:30', desc='1 hr'),
    E('2027-03-07', 'Dinner for Senior Girls & Their Moms', 'Stake activity', '18:00', '20:30', desc='General Relief Society broadcast.', audience='Young women'),
    E('2027-03-10', 'Dance Practice', 'Dance practice', '20:30', '21:30'),
    E('2027-03-14', SUNDAY, 'Mission prep', '18:30', '20:30', desc=SUN_DESC + 'P&N · YW'),
    E('2027-03-17', 'Dance Practice', 'Dance practice', '20:30', '21:30'),
    E('2027-03-19', 'Temple Trip', 'Temple', '17:00', '22:30', desc='Stake presidency devotional.'),
    E('2027-03-19', 'Senior Overnighter', 'Stake activity', end='2027-03-20'),
    E('2027-03-21', 'Senior Choir Dress Rehearsal', 'Choir', '17:30', '19:30', desc='Parent performance. P&N', syc=True),
    E('2027-03-22', 'Stake Youth Conference (SYC)', 'Youth conference', end='2027-03-24', desc='Fowler property.', syc=True),
    E('2027-04-09', 'SYC Wrap-Up Dinner / Party', 'Youth conference', '18:30', syc=True),
    E('2027-04-11', 'Mission Prep', 'Mission prep', '18:30', '19:30'),
    E('2027-04-25', 'Mission Prep', 'Mission prep', '18:30', '19:30'),
    E('2027-05-01', 'Temple Prep at the ward level', 'Temple', end='2027-05-31', desc='All month, in wards.'),
]
# Earlier minutes-based events that the calendar entries above replace.
REPLACE = [('Missionary splits: lesson and companions', '2026-12-13'), ('Missionary splits: family visits (Christmas lesson)', '2026-12-14')]

cfg = (HERE / 'config.js').read_text()
url = re.search(r"supabaseUrl:\s*'([^']+)'", cfg).group(1)
key = re.search(r"supabaseAnonKey:\s*'([^']+)'", cfg).group(1)
pin = re.search(r'Adult PIN:\s*(\S+)', (HERE / 'PINS-private.txt').read_text()).group(1)

def rpc(fn, args):
    req = urllib.request.Request(f"{url}/rest/v1/rpc/{fn}", data=json.dumps(args).encode(),
                                 headers={'apikey': key, 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read() or b'null')

data = rpc('sya_load', {'p_pin': pin})
proj = next((p for p in data['projects'] if p['title'] == SYC), None)
if proj and not proj.get('event_date'):
    print('set SYC project event date → 2027-03-22')
    if not DRY:
        rpc('sya_save', {'p_pin': pin, 'p_actor': 'senior calendar import', 'p_kind': 'project',
                         'p_row': {k: proj[k] for k in ('id', 'title', 'kind', 'status', 'purpose', 'notes', 'adult_lead', 'youth_lead')} | {'event_date': '2027-03-22'}})
for e in data['events']:
    if (e['title'], e['start_date']) in REPLACE:
        print('remove', e['start_date'], e['title'])
        if not DRY:
            rpc('sya_delete', {'p_pin': pin, 'p_actor': 'senior calendar import', 'p_kind': 'event', 'p_id': e['id']})

have = {(e['title'], e['start_date']) for e in data['events']}
added = 0
for e in EVENTS:
    if (e['title'], e['start_date']) in have:
        continue
    row = {k: v for k, v in e.items() if k != 'syc'} | {'location': '', 'adults': [], 'project_id': proj['id'] if (e['syc'] and proj) else None}
    if not DRY:
        rpc('sya_save', {'p_pin': pin, 'p_actor': 'senior calendar import', 'p_kind': 'event', 'p_row': row})
    added += 1
print(f"{added} events {'to add' if DRY else 'added'}, {len(EVENTS) - added} already there")
