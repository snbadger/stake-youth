#!/usr/bin/env python3
"""Load the 2027 Senior Roster into the Stake Youth app as youth leaders.

Only ward + first name + last initial go in (never phones, parents, birthdays).
Usage: python3 -I tools/load_seniors.py <roster_b64_or_csv_path> [--dry-run]
Reads the adult PIN from PINS-private.txt next to config.js.
"""
import base64, csv, io, json, re, sys, urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
SRC = Path(sys.argv[1])
DRY = '--dry-run' in sys.argv

# SYC co-chairs from the 2026-11-01 presidency minutes (spellings differ from the roster).
COCHAIRS = {('carson', 'stokes'), ('teagan', 'haderlie'), ('skylar', 'smith'), ('hannah', 'moua')}

raw = SRC.read_bytes()
text = base64.b64decode(raw).decode('utf-8') if not raw.lstrip().startswith(b'Ward') else raw.decode('utf-8')
rows = list(csv.reader(io.StringIO(text)))
header, rows = rows[0], rows[1:]

people, ward, skipped = [], '', []
for r in rows:
    if not r or not r[1].strip():
        continue
    ward = r[0].strip() or ward
    full = r[1].strip()
    if '(' in full and '?' in full and ' ' not in full.split('(')[0].strip():
        skipped.append(full); continue            # "Elijah? (Karla's boyfriend…)" — no surname, not confirmed
    base = re.sub(r'\(.*?\)', '', full).replace('?', '').strip()
    parts = base.split()
    if len(parts) < 2:
        skipped.append(full); continue
    first, last = parts[0], parts[-1]          # "Jade van Beever" → "Jade B."
    people.append({'first': first, 'last': last, 'ward': ward, 'uncertain': '?' in full,
                   'cochair': (first.lower(), last.lower()) in COCHAIRS})

# First name + last initial; add letters of the surname until unique within the stake.
def short(p, n):
    return f"{p['first']} {p['last'][:n]}."
for p in people:
    n = 1
    while sum(1 for q in people if short(q, n) == short(p, n)) > 1:
        n += 1
    p['name'] = short(p, n)

wards = []
for p in people:
    if p['ward'] not in wards:
        wards.append(p['ward'])

print(f"{len(people)} seniors across {len(wards)} wards: {', '.join(wards)}")
print("Co-chairs:", ', '.join(p['name'] for p in people if p['cochair']))
print("Skipped:", skipped)
if DRY:
    for p in people: print(f"  {p['ward']:14} {p['name']:16} {'co-chair' if p['cochair'] else ''}{' (?)' if p['uncertain'] else ''}")
    sys.exit()

cfg = (HERE / 'config.js').read_text()
url = re.search(r"supabaseUrl:\s*'([^']+)'", cfg).group(1)
key = re.search(r"supabaseAnonKey:\s*'([^']+)'", cfg).group(1)
pin = re.search(r'Adult PIN:\s*(\S+)', (HERE / 'PINS-private.txt').read_text()).group(1)

def rpc(fn, args):
    req = urllib.request.Request(f"{url}/rest/v1/rpc/{fn}", data=json.dumps(args).encode(),
                                 headers={'apikey': key, 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read() or b'null')

existing = {p['name'].lower() for p in rpc('sya_load', {'p_pin': pin})['people']}
added = 0
for p in people:
    if p['name'].lower() in existing:
        continue
    rpc('sya_save', {'p_pin': pin, 'p_actor': 'roster import', 'p_kind': 'person', 'p_row': {
        'name': p['name'], 'kind': 'youth', 'ward': p['ward'], 'active': True,
        'role': 'SYC Co-chair' if p['cochair'] else 'Senior' + (' [VERIFY]' if p['uncertain'] else '')}})
    added += 1
rpc('sya_save', {'p_pin': pin, 'p_actor': 'roster import', 'p_kind': 'setting', 'p_row': {'key': 'wards', 'value': '\n'.join(wards)}})
print(f"Added {added} youth; {len(people) - added} already there. Wards setting updated.")
