#!/usr/bin/env python3
"""Add the dated items from the Nov. 1, 2026 presidency minutes ("Coming up" + Key Dates) as events.
Skips an event if one with the same title and start date already exists. Items the minutes left
as [FILL IN] / undated (mid-November YW training, January pre-institute nights, leadership dinner,
SYC itself) are not added — there is no date to put them on.
Usage: python3 tools/load_minutes_events.py [--dry-run]
"""
import json, re, sys, urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
DRY = '--dry-run' in sys.argv
SYC = 'Stake Youth Conference 2027'

EVENTS = [
    dict(title='Co-chair meeting + mission prep introduction', category='Leadership meeting', audience='Youth and leaders',
         start_date='2026-11-08', start_time='17:30', location='Stake center [VERIFY]',
         description='YM/YW presidents meet with the four SYC co-chairs. Mission prep introduced to the seniors (nothing announced before this).', syc=True),
    dict(title='Presidencies meet during choir: divide adult SYC responsibilities', category='Leadership meeting', audience='Adult leaders',
         start_date='2026-11-08', start_time='18:30', end_time='20:30', location='Stake center [VERIFY]',
         description='All eight presidency members. A rough draft of adult assignments is ready beforehand.', syc=True),
    dict(title='Stake musical [VERIFY]', category='Stake activity', audience='All youth',
         start_date='2026-11-27', description='Date from the Nov. 1 minutes, marked [VERIFY] there.'),
    dict(title='Stake YM/YW presidency meeting', category='Leadership meeting', audience='Adult leaders',
         start_date='2026-12-06', start_time='15:00', end_time='16:00', location='Davis home',
         description='Monthly, first Sunday at 3:00 PM.'),
    dict(title='Missionary splits: lesson and companions', category='Other', audience='All youth',
         start_date='2026-12-13', description='First splits night. Preach My Gospel lesson, "mission call," and a companion from another ward. Seniors only; youth who do not want to take part are not assigned.'),
    dict(title='Missionary splits: family visits (Christmas lesson)', category='Service', audience='All youth',
         start_date='2026-12-14', description='Companions visit an assigned family for a family home evening lesson and testimony. Visits arranged with the family ahead of time; youth do not drive themselves to church activities.'),
    dict(title='SYC budget due to the stake presidency', category='Other', audience='Adult leaders',
         start_date='2026-12-31', description='Full budget: venue, food, restrooms, tents, risers, shirts, packets.', syc=True),
    dict(title="Girls' camp [VERIFY dates]", category='Camp', audience='Young women',
         start_date='2027-06-14', end_date='2027-06-17', description='Dates from the Nov. 1 minutes, marked [VERIFY] there; conflicting dates had been seen.'),
]

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
proj = next((p['id'] for p in data['projects'] if p['title'] == SYC), None)
have = {(e['title'], e['start_date']) for e in data['events']}
added = 0
for e in EVENTS:
    if (e['title'], e['start_date']) in have:
        continue
    row = {k: v for k, v in e.items() if k != 'syc'}
    row.setdefault('end_date', None); row.setdefault('start_time', None); row.setdefault('end_time', None)
    row.setdefault('location', ''); row['project_id'] = proj if e.get('syc') else None; row['adults'] = []
    print(('would add' if DRY else 'add'), row['start_date'], row['title'])
    if not DRY:
        rpc('sya_save', {'p_pin': pin, 'p_actor': 'minutes import', 'p_kind': 'event', 'p_row': row})
    added += 1
print(f"{added} events {'to add' if DRY else 'added'}, {len(EVENTS) - added} already there")
