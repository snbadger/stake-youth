#!/usr/bin/env python3
"""Turn an SYC agenda spreadsheet (.xlsx downloaded from Google Sheets) into agenda lines for the app.

The sheet layout it reads (the stake's "SYC Agenda" format):
  column A  day header like "Mon (3/30)", or a time like "1:25-1:55" / "6:00-7:30pm"
  column B  what happens; rows with no time are the parts of the block above them
  columns after B, named by the header row: "AV Needs", "Set up", "Senior Notes", "Chaperone Notes"
  (an unnamed or repeated "Set up" column next to Set up is treated as senior notes)

Each timed row becomes one agenda line; the untimed rows under it become its "parts".
Times with no am/pm are worked out from the order of the day.

Dry run by default: prints a summary and writes the lines to --out as JSON. Nothing is sent anywhere.
  python3 tools/import_agenda_xlsx.py AGENDA.xlsx --year 2026 --first-day 2027-03-21 --out /tmp/agenda.json
Load into the live app (needs the sya_plan table, so run supabase/schema.sql first):
  python3 tools/import_agenda_xlsx.py AGENDA.xlsx --year 2026 --first-day 2027-03-21 --load "Stake Youth Conference 2027"
"""
import argparse, datetime, json, re, sys, urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
DAY = re.compile(r'^\s*(sun|mon|tue|wed|thu|fri|sat)\w*\.?\s*\(?(\d{1,2})/(\d{1,2})\)?', re.I)
TIME = re.compile(r'^\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:[-–]\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?\s*$', re.I)
ROOM = re.compile(r'mpr|gym|quad|roo+m|court|chapel|bldg|building|hall|pavil', re.I)
ROLE = re.compile(r'^(conducting|opening prayer|closing prayer|opening song|chorister|pianist|speakers|senior opening|senior closing|hosts|co-?chair speaker|musical number)\s*:(.*)$', re.I)
FOR = [
    (re.compile(r'^(senior meeting|senior lunch|senior overnighter|senior fireside dress|seniors? (eat|get ready)|stake ym/yw activities with seniors|meet with next year)', re.I), 'Seniors'),
    (re.compile(r'^chaperone|chaperones &', re.I), 'Chaperones'),
    (re.compile(r'stk ym/yw|yw presidency|ym presidency', re.I), 'Adult leaders'),
]


def clean(v):
    if v is None:
        return ''
    if isinstance(v, datetime.time):
        return f'{v.hour % 12 or 12}:{v.minute:02d}'      # a bare clock time; am/pm is worked out below
    if isinstance(v, datetime.datetime):
        return f'{v.hour % 12 or 12}:{v.minute:02d}'
    return ' '.join(str(v).split())


def pick(h, m, ap, after, lo_ok=90):
    """Minutes since midnight for an h:m with optional am/pm, at or after `after` (with some slack)."""
    if ap:
        return ((h % 12) + (12 if ap.lower() == 'pm' else 0)) * 60 + m
    cands = [h * 60 + m] if h == 12 else [h * 60 + m, (h + 12) * 60 + m]
    if after is None:
        return cands[0] if 7 <= h <= 12 else cands[-1]
    ok = [c for c in cands if c >= after - lo_ok]
    return min(ok) if ok else cands[-1]


def hhmm(n):
    return None if n is None else f'{n // 60 % 24:02d}:{n % 60:02d}'


def split_location(title):
    """"Dinner - MPR (winner eats first)" -> ("Dinner (winner eats first)", "MPR"). Tries each " - " until a room follows it."""
    for m in re.finditer(r'\s+-\s*', title):
        head, tail = title[:m.start()].strip(), title[m.end():].strip()
        loc, paren, rest = tail.partition('(')
        loc = loc.strip()
        if not head or not loc or len(loc) > 32 or ' - ' in loc or not ROOM.search(loc):
            continue
        if loc.isupper() and loc != 'MPR':
            loc = loc.title()
        return (head + (' (' + rest if paren else '')).strip(), loc
    return title, ''


def parse(path, year, sheet=None):
    import openpyxl
    wb = openpyxl.load_workbook(path, data_only=True)
    ws = wb[sheet] if sheet else wb.worksheets[0]
    rows = [[clean(c) for c in r] for r in ws.iter_rows(values_only=True)]
    # Map the note columns from the first row that names them.
    cols, seen_setup = {}, False
    for r in rows[:5]:
        for j, v in enumerate(r):
            k = v.lower()
            if 'av' in k.split() or k.startswith('av '):
                cols[j] = 'av'
            elif 'chaperone' in k:
                cols[j] = 'chaperone_notes'
            elif 'senior' in k:
                cols[j] = 'senior_notes'
            elif k.startswith('set up') or k.startswith('set-up') or k.startswith('setup'):
                cols[j] = 'senior_notes' if seen_setup else 'notes'
                seen_setup = True
        if cols:
            break
    # The agenda sheets keep time in the first used column and the activity in the next.
    used = [j for j in range(len(rows[0]) if rows else 0) if any(r[j] for r in rows if j < len(r))]
    tcol = next(j for j in used if any(DAY.match(r[j]) for r in rows))
    acol = next(j for j in used if j > tcol and j not in cols)

    lines, day, cur, clock, warn, skipped = [], None, None, None, [], []
    for i, r in enumerate(rows, 1):
        a, b = r[tcol], r[acol]
        extra = {k: r[j] for j, k in cols.items() if j < len(r) and r[j]}
        d = DAY.match(a)
        if d:
            day = datetime.date(year, int(d.group(2)), int(d.group(3)))
            cur, clock = None, None
            theme = b
            if theme:      # e.g. the day's scripture
                lines.append(dict(day=day, start=None, end=None, title=theme, location='', section='', detail=[], av='', notes='', senior_notes='', chaperone_notes='', row=i))
            if extra:
                skipped.append((i, 'day header notes: ' + '; '.join(extra.values())[:90]))
            continue
        if not a and not b:
            continue
        if day is None:
            continue
        t = TIME.match(a) if a else None
        if a and not t:
            warn.append((i, f'could not read the time "{a}"; kept it in the title'))
            b = f'{a} {b}'.strip()
        if t:
            h1, m1, ap1, h2, m2, ap2 = t.groups()
            if h2 and ap2 and not ap1:      # "6:00-7:30pm": the end is fixed, the start is the latest fit before it
                end = pick(int(h2), int(m2 or 0), ap2, None)
                base = int(h1) % 12 * 60 + int(m1 or 0)
                fits = [c for c in (base, base + 720) if c <= end]
                start = max(fits) if fits else base
            else:
                start = pick(int(h1), int(m1 or 0), ap1, clock)
                end = None
                if h2:
                    end = pick(int(h2), int(m2 or 0), ap2, start, lo_ok=0)
            if clock is not None and start < clock - 5:
                warn.append((i, f'starts at {hhmm(start)}, before the row above it ({hhmm(clock)}): "{b[:50]}"'))
            if end is not None and end - start > 240:
                warn.append((i, f'runs {round((end - start) / 60, 1)} hours: "{b[:50]}"'))
            clock = max(clock or 0, start)
            title, loc = split_location(b)
            section = next((s for rx, s in FOR if rx.search(b)), '')
            cur = dict(day=day, start=start, end=end, title=title or '(no title)', location=loc, section=section, detail=[],
                       av=extra.get('av', ''), notes=extra.get('notes', ''), senior_notes=extra.get('senior_notes', ''), chaperone_notes=extra.get('chaperone_notes', ''), row=i)
            lines.append(cur)
        elif cur is None:
            lines.append(dict(day=day, start=None, end=None, title=b, location='', section='', detail=[], av=extra.get('av', ''), notes=extra.get('notes', ''),
                              senior_notes=extra.get('senior_notes', ''), chaperone_notes=extra.get('chaperone_notes', ''), row=i))
        else:      # a part of the block above
            part = b
            if extra.get('av'):
                part += f"  [AV: {extra['av']}]"
            if part:
                cur['detail'].append(part)
            for k in ('notes', 'senior_notes', 'chaperone_notes'):
                if extra.get(k):
                    cur[k] = (cur[k] + '\n' if cur[k] else '') + (f'{b}: ' if b and k == 'notes' else '') + extra[k]
    return lines, warn, skipped, ws.title


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('xlsx')
    ap.add_argument('--sheet', help='tab name (default: the first tab)')
    ap.add_argument('--year', type=int, required=True, help='year of the dates in the sheet, e.g. 2026')
    ap.add_argument('--first-day', help='move the agenda so its first day lands on this date (YYYY-MM-DD)')
    ap.add_argument('--out', help='write the lines as JSON here')
    ap.add_argument('--keep-names', action='store_true', help="keep last year's names in role slots (Conducting:, Speakers:, ...); cleared by default")
    ap.add_argument('--load', metavar='PROJECT TITLE', help='save the lines into this project in the live app')
    a = ap.parse_args()

    lines, warn, skipped, tab = parse(a.xlsx, a.year, a.sheet)
    days = sorted({l['day'] for l in lines})
    shift = (datetime.date.fromisoformat(a.first_day) - days[0]).days if a.first_day else 0
    cleared = 0
    if not a.keep_names:      # a new year's draft: the role slots stay, last year's people do not
        for l in lines:
            for k, part in enumerate(l['detail']):
                m = ROLE.match(part)
                if m and m.group(2).strip() and not re.match(r'^(\(|tbd\b|\[)', m.group(2).strip(), re.I):
                    l['detail'][k] = m.group(1) + ':'
                    cleared += 1
    out = []
    for n, l in enumerate(lines):
        out.append(dict(kind='agenda', title=l['title'], day=(l['day'] + datetime.timedelta(days=shift)).isoformat(), start_time=hhmm(l['start']), end_time=hhmm(l['end']),
                        location=l['location'], section=l['section'], detail='\n'.join(l['detail']), av=l['av'], notes=l['notes'], senior_notes=l['senior_notes'],
                        chaperone_notes=l['chaperone_notes'], high_level=False, sort=n))

    print(f'Tab "{tab}": {len(out)} agenda lines, {sum(len(l["detail"]) for l in lines)} parts, {len(days)} days' + (f', moved {shift} days' if shift else ''))
    for d in days:
        ls = [l for l in lines if l['day'] == d and l['start'] is not None]
        new = d + datetime.timedelta(days=shift)
        print(f'  {d:%a %b %-d, %Y}' + (f' -> {new:%a %b %-d, %Y}' if shift else '') + f': {len(ls)} blocks, {hhmm(min(l["start"] for l in ls))}–{hhmm(max(l["end"] or l["start"] for l in ls))}')
    print('  for:', {s or 'Everyone': sum(1 for l in lines if l['section'] == s) for s in sorted({l['section'] for l in lines})})
    print('  with a location:', sum(1 for l in lines if l['location']), '| AV:', sum(1 for l in lines if l['av']), '| set-up:', sum(1 for l in lines if l['notes']),
          '| senior notes:', sum(1 for l in lines if l['senior_notes']), '| chaperone notes:', sum(1 for l in lines if l['chaperone_notes']))
    if cleared:
        print(f'  cleared {cleared} name(s) from role slots (use --keep-names to keep them)')
    for i, w in warn:
        print(f'  CHECK row {i}: {w}')
    for i, w in skipped:
        print(f'  SKIPPED row {i}: {w}')
    if a.out:
        Path(a.out).write_text(json.dumps(out, indent=1))
        print('wrote', a.out)
    if not a.load:
        print('Dry run: nothing was sent to the app.')
        return

    cfg = (HERE / 'config.js').read_text()
    url = re.search(r"supabaseUrl:\s*'([^']+)'", cfg).group(1)
    key = re.search(r"supabaseAnonKey:\s*'([^']+)'", cfg).group(1)
    pin = re.search(r'Adult PIN:\s*(\S+)', (HERE / 'PINS-private.txt').read_text()).group(1)

    def rpc(fn, args):
        req = urllib.request.Request(f'{url}/rest/v1/rpc/{fn}', data=json.dumps(args).encode(), headers={'apikey': key, 'Content-Type': 'application/json'})
        with urllib.request.urlopen(req) as r:
            return json.loads(r.read() or b'null')

    data = rpc('sya_load', {'p_pin': pin})
    if 'plan' not in data:
        sys.exit('The live database has no plan table yet. Run supabase/schema.sql in the Supabase SQL editor first.')
    proj = next((p for p in data['projects'] if p['title'] == a.load), None)
    if not proj:
        sys.exit(f'No project titled "{a.load}".')
    have = {(x['day'], (x['start_time'] or '')[:5], x['title']) for x in data['plan'] if x['kind'] == 'agenda' and x['project_id'] == proj['id']}
    added = 0
    for row in out:
        if (row['day'], row['start_time'] or '', row['title']) in have:
            continue
        rpc('sya_save', {'p_pin': pin, 'p_actor': 'agenda import', 'p_kind': 'plan', 'p_row': row | {'project_id': proj['id']}})
        added += 1
    print(f'{added} lines added to "{a.load}", {len(out) - added} already there')


if __name__ == '__main__':
    main()
