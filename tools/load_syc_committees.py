#!/usr/bin/env python3
"""Load the "SYC 2027 COMMITTEES" chart (photographed 2026-11-08) into the Stake Youth app.

Creates the adult leaders it names, the "Stake Youth Conference 2027" project, and one task per
bullet, grouped by committee (task area). Youth-column bullets are left unassigned with a note
naming the co-chairs, who divide them. Safe to rerun: skips people, the project, and tasks that
already exist by name/title.
Usage: python3 tools/load_syc_committees.py [--dry-run]
"""
import json, re, sys, urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
DRY = '--dry-run' in sys.argv
PROJECT = 'Stake Youth Conference 2027'
COCHAIRS = 'Youth leaders (co-chairs): Skylar S., Carson S., Teagan H., Hannah M. — co-chairs divide this among themselves.'

# Adult leaders: the six recipients of the 2026-11-03 minutes email plus Stephen, with the
# specialists the chart names. Callings not stated anywhere are [FILL IN]; last names that come
# only from an email handle are marked [VERIFY].
ADULTS = [
    ('Stephen Badger', 'Stake Young Men Secretary', 'Stake'),
    ('David Castle', '[FILL IN calling]', 'Stake'),
    ('Anona Davis', '[FILL IN calling]', 'Stake'),
    ('Ashley Nicolls Burton [VERIFY]', '[FILL IN calling]', 'Stake'),
    ('Kati Cunningham [VERIFY]', '[FILL IN calling]', 'Stake'),
    ('Kiley Brook [VERIFY]', '[FILL IN calling]', 'Stake'),
    ('Jake Tracy', '[FILL IN calling]', 'Stake'),
    ('Trevor Davis', 'Specialist — mission prep', 'Shepherd'),
    ('Sarah Griffin', 'Specialist — senior choir', 'Wawona Ranch'),
    ('Jared Griffin', 'Specialist — senior choir', 'Wawona Ranch'),
]
FIRST = {a[0].split()[0]: a[0] for a in ADULTS}   # "Dave" handled below
FIRST['Dave'] = 'David Castle'

# (committee, owner spec, [bullets]). Owner: 'Y' = youth/co-chairs; 'A/B' = A owns, B noted;
# 'G:text' = a group, unassigned with the note.
ROWS = [
    ('SYC Agenda', 'Anona', ['Create SYC agenda and senior notes', 'Get stake presidency approval for the SYC agenda', 'Prepare conducting sheets']),
    ('SYC Agenda', 'Dave', ['Get guest speakers approved by the stake presidency']),
    ('SYC Agenda', 'Y', ['Overall vision for SYC', 'Assign conducting and prayers', 'Choose scripture and theme for each day', 'Help plan the SYC agenda', 'Suggest guest speakers and topics', 'Work with guest speakers']),
    ('Senior Presentations', 'Y', ['Propose topics and senior presenters (24–30 names and topics; stake YM/YW choose 18–24)', 'Propose 4–5 senior music presenters', 'Senior presenter grouping']),
    ('Senior Presentations', 'Dave/Anona', ['Submit senior presentation topics and proposed presenters to the stake presidency for approval', 'Train senior presenters', 'Preview all senior presentations', 'Organize the area for senior presentations']),
    ('Chaperones', 'Y', ['Propose 12–15 chaperones']),
    ('Chaperones', 'Ashley', ['Train chaperones', 'Lead the nightly chaperone meeting at SYC', 'Add chaperone notes to the SYC agenda']),
    ('Senior Meetings', 'Y', ['Take turns conducting', 'Minister and invite other seniors to attend', 'Lead committee meetings']),
    ('Senior Meetings', 'Dave', ['Leadership training']),
    ('Senior Meetings', 'G:YW and YM presidencies', ['Treats for senior meetings']),
    ('Senior Activities', 'Y', ['Plan activities for Sept, Oct, Nov and Dec', 'Plan the cabin trip in January', 'Personally invite at least one senior to each activity', 'Minister']),
    ('Senior Activities', 'Dave/Anona', ['Help co-chairs plan activities', 'Reserve cabins for the cabin trip', 'Reserve the temple and stake center / pavilion next to the temple']),
    ('Missionary, Promotion, Registration, Communication', 'Y', ['Rotation activity', 'Missionary efforts', 'Promotion: visit wards and seminary classes and encourage youth to register', 'Free-time activities', 'SYC flyer / poster']),
    ('Missionary, Promotion, Registration, Communication', 'Kati/Stephen', ['Send out reminders to ward leaders', 'Get registration info posted in ward bulletins', 'Print SYC flyers / poster', 'Gather free-time activity supplies and equipment', 'Communicate reminders and other pertinent info to seniors and senior parents on WhatsApp', 'Communicate pertinent info to ward leaders']),
    ('Missionary, Promotion, Registration, Communication', 'Stephen', ['Create registration form and QR code', 'Collect registration forms', 'Create youth spreadsheet']),
    ('Holy Week', 'Y', ['Paper fashion show (or equivalent): pick categories, propose MCs', 'Rotation activity', 'Holy Week rotation or all-group activity, and how to incorporate it']),
    ('Holy Week', 'Ashley/Stake YM 2nd counselor [FILL IN]', ['Paper fashion show: buy needed supplies, coach MCs']),
    ('Welcome, T-shirts', 'Y', ['Welcome activity (rally replacement)', 'Rotation activity', 'T-shirt committee: design several t-shirt designs, have seniors vote', 'Quiet room activities']),
    ('Welcome, T-shirts', 'Dave/Anona', ['Get t-shirt designs approved by the stake presidency', 'Order t-shirts', 'Buy supplies needed']),
    ('Variety Show, Dance, Rules Video, Senior Dance, Hmong Dance', 'Y', ['Variety show: advertise and encourage participation, submit names for MCs', 'Rotation activity', 'Rules video: decide how to film', 'Variety of classes', 'Dance: develop dance theme, plan dance and snacks/treats, submit playlist', 'Senior dance / Hmong dance: encourage youth to participate, support those teaching dances']),
    ('Variety Show, Dance, Rules Video, Senior Dance, Hmong Dance', 'Kiley/Jake', ['Variety show: preview numbers, arrange outline for talent show, send music to Eric West, preview MC acts', 'Dance: approve playlist, purchase snacks and decorations']),
    ('Variety Show, Dance, Rules Video, Senior Dance, Hmong Dance', 'Jake', ['Film rules video']),
    ('Variety Show, Dance, Rules Video, Senior Dance, Hmong Dance', 'Kiley', ['Senior dance coordination: support seniors, purchase costumes, get music to Eric West, coordinate snacks for practice, coordinate building unlocked and locked, coordinate stake YW/YM attendance at practices', 'Hmong dance coordination: communicate with and support Pioneer Park ward, get music to Eric West']),
    ('Senior Choir', 'Sarah/Jared', ['Help choose songs for senior choir', 'Gather experiences from seniors to share during the fireside', 'Plan senior choir', 'Organize spiritual thought and prayer for the beginning of each choir practice and send reminders to those doing it']),
    ('Historian', 'Kiley', ['Collect pictures during SYC', 'Create slideshow']),
    ('Testimony Meeting', 'Dave/Anona', ['Arrange locations for testimony meeting', 'Decide how to split up for testimony meeting']),
    ('Color Groups', 'Y', ['Make suggestions about color group formations']),
    ('Color Groups', 'Dave/Anona', ['Color group formation, including seniors']),
    ('Special Musical Numbers', 'Kati', ['Contact those who signed up for a musical number to get a commitment', 'Contact Kristi Hammons (possibly) to form groups and group leaders for musical numbers', 'Communicate with musical group leaders']),
    ('Senior Counselor Training', 'Ashley', ['Senior counselor training at Senior Work Day (with the four co-chairs)']),
    ('Set Up / Clean Up', 'G:Stake YM (2nd counselor?)', ['Plan and coordinate set up and clean up']),
    ('Food', 'G:Stake YW presidency', ['Plan and purchase food for lunches, 1 dinner, and snacks', 'Purchase paper products and drinks', 'Arrange for drivers to pick up', 'Arrange for helpers to prep, serve if needed, and clean up meals']),
    ('Food', 'G:Stake YM presidency', ['Plan and purchase food for 2 dinners']),
    ('Check-in', 'Ashley', ['Order wrist bands as needed', 'Create check-in bags (lanyard, wrist band, t-shirt) labeled with youth names', 'Organize check-in station']),
    ('Check-in', 'Anona', ['Create lanyards with the SYC schedule']),
    ('Mission Prep', 'Trevor', ['Welcome youth to mission prep', 'Help decide relevant topics from Preach My Gospel']),
    ('Mission Prep', 'Jake', ['Contact bishops for members to visit for missionary splits', 'Remind youth about missionary splits (or youth do this?)']),
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
def save(kind, row):
    return None if DRY else rpc('sya_save', {'p_pin': pin, 'p_actor': 'committee chart import', 'p_kind': kind, 'p_row': row})

data = rpc('sya_load', {'p_pin': pin})
people = {p['name']: p for p in data['people']}
for name, role, ward in ADULTS:
    if name not in people:
        r = save('person', {'name': name, 'kind': 'adult', 'role': role, 'ward': ward, 'active': True})
        people[name] = r or {'id': None, 'name': name}
        print('added adult:', name)

proj = next((p for p in data['projects'] if p['title'] == PROJECT), None)
if not proj:
    proj = save('project', {'title': PROJECT, 'kind': 'Youth conference', 'event_date': None, 'status': 'active',
                            'adult_lead': people['David Castle']['id'], 'youth_lead': None,
                            'purpose': '[FILL IN — the co-chairs set the vision]',
                            'notes': 'Venue: Fowler property (about 25 min away). SYC date [FILL IN]. Tasks loaded from the SYC 2027 Committees chart; add due dates as the schedule firms up.'}) or {'id': None}
    print('added project:', PROJECT)

have = {(t['area'], t['title']) for t in data['tasks'] if t.get('project_id') == proj['id']}
added = 0
for area, who, bullets in ROWS:
    if who == 'Y':
        owner, notes = None, COCHAIRS
    elif who.startswith('G:'):
        owner, notes = None, 'Group assignment: ' + who[2:]
    else:
        names = who.split('/')
        owner = people[FIRST[names[0]]]['id']
        notes = ('With ' + ', '.join(FIRST.get(n, n) for n in names[1:])) if len(names) > 1 else ''
    for title in bullets:
        if (area, title) in have:
            continue
        save('task', {'title': title, 'area': area, 'notes': notes, 'owner_id': owner, 'project_id': proj['id'], 'due_date': None})
        added += 1
print(f"{'would add' if DRY else 'added'} {added} tasks across {len({r[0] for r in ROWS})} committees")
