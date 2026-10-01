"""QA test-only oracle for B25 (DEV-OQZ): the semi-monthly First Payment Date move.

Two independent parts, nothing imported from the engine:
  1. The MOVE (decision 10 / B25-R1) is written from the stated rule with python's calendar module:
     day == 15 or last day -> unchanged; day < 15 -> the 15th; otherwise -> the month's last day.
  2. The schedule dates after the move are the macro's getNextSemiMonthly / getNextEOM, a line-for-line
     transliteration (VBA DateAdd / DateSerial primitives modelled as in generate_semimonthly_vectors.py),
     run from the MOVED date, chained from the previous payment (payment 1 = the first date itself).
The macro itself never moves the date (DEV-OQZ); only the rule of part 1 is new.

Trust check before writing: the macro port reproduces, for every typed date that is already the 15th or
a month-end, the date list stored in ca_semimonthly_vectors.json 'sweep' (workbook truth, made by the
older oracle generate_semimonthly_vectors.py).

Writes b25_semimonthly_move_vectors.json:
  'moves'  : [{typed, moved}] for every date 2027-01-01 .. 2028-12-31 (731)
  'sweep'  : [{typed, moved, end, dates}]  end = moved + 730 days; dates = macro port from the moved date up to end
  'sweep'  entries also carry 'datesTypedEnd': the macro port run from the moved date up to typed + 730 days,
             the End Date the (older) T4 sweep test uses, so that test can compare against the moved list.
  'corpus' : typed -> moved for every first payment date used by the golden corpus (generate_golden.mjs)
  'vectors': full-row vectors for the T4 and D-01 vectors whose typed first date is NOT a 15th / month-end:
             the request keeps the TYPED date; rows / totals come from the macro port (CalculateAll,
             generate_semimonthly_vectors.py) run with first = the MOVED date and the same disbursal / End.
Run: python3 generate_b25_semimonthly_move_vectors.py
"""
import calendar
import json
import os
import sys
from datetime import date, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import generate_semimonthly_vectors as oldgen  # the older QA oracle (full CalculateAll port)


def last_day(y, m):
    return calendar.monthrange(y, m)[1]


def date_add_d(n, d):
    return d + timedelta(days=n)


def date_add_m(n, d):
    m = d.month - 1 + n
    y, mo = d.year + m // 12, m % 12 + 1
    return date(y, mo, min(d.day, last_day(y, mo)))


def date_serial(y, m, d):
    m0 = m - 1
    y, m = y + m0 // 12, m0 % 12 + 1
    return date(y, m, 1) + timedelta(days=d - 1)


def get_next_eom(current_date):
    get_date = current_date
    while not (get_date > current_date):
        get_date = date_add_d(1, get_date)
        get_date = date_add_m(1, get_date)
        get_date = date_serial(get_date.year, get_date.month, 1)
        get_date = date_add_d(-1, get_date)
    return get_date


def get_next_semi_monthly(first_pymt_date, current_date):
    is_eom = False
    day1 = first_pymt_date.day
    first_eom = get_next_eom(date_add_d(-1, first_pymt_date))
    if (first_eom == first_pymt_date) or (day1 == 15):
        is_eom = True
    if day1 >= 15:
        day1 = day1 - 15
    curr_day = current_date.day
    curr_eom = get_next_eom(date_add_d(-1, current_date))
    if current_date == curr_eom and is_eom:
        get_date = date_add_m(1, current_date)
        get_date = date_serial(get_date.year, get_date.month, 15)
    elif curr_day == 15 and is_eom:
        get_date = curr_eom
    elif curr_day > 15:
        get_date = date_add_m(1, current_date)
        get_date = date_serial(get_date.year, get_date.month, day1)
    elif curr_day <= 15:
        next_date = date_add_d(15, current_date)
        if next_date > curr_eom:
            next_date = curr_eom
        get_date = next_date
    return get_date


def move(d):
    """B25-R1, written independently of the engine."""
    last = last_day(d.year, d.month)
    if d.day == 15 or d.day == last:
        return d
    if d.day < 15:
        return date(d.year, d.month, 15)
    return date(d.year, d.month, last)


def schedule_dates(first, end):
    out = [first]
    cur = first
    while True:
        nxt = get_next_semi_monthly(first, cur)
        if nxt > end:
            break
        out.append(nxt)
        cur = nxt
    return out


def iso(d):
    return d.isoformat()


def main():
    old = json.load(open(os.path.join(HERE, 'ca_semimonthly_vectors.json')))
    old_by_first = {s['first']: s['dates'] for s in old['sweep']}

    moves, sweep = [], []
    d = date(2027, 1, 1)
    while d <= date(2028, 12, 31):
        m = move(d)
        end = m + timedelta(days=730)
        dates = schedule_dates(m, end)
        # trust check (workbook truth) for dates that are not moved
        if m == d:
            ref = old_by_first[iso(d)]
            # the old sweep used end = typed + 730 days; compare on the common prefix up to the shorter end
            old_end = d + timedelta(days=730)
            mine = [iso(x) for x in schedule_dates(d, old_end)]
            assert mine == ref, ('trust check failed', iso(d))
        # property: the moved date feeds the macro and alternates 15th / month-end
        for a, b in zip(dates, dates[1:]):
            assert (a.day == 15 and b.day == last_day(b.year, b.month)) or (
                a.day == last_day(a.year, a.month) and b.day == 15), (iso(d), iso(a), iso(b))
        moves.append({'typed': iso(d), 'moved': iso(m)})
        dates_typed_end = schedule_dates(m, d + timedelta(days=730))
        sweep.append({'typed': iso(d), 'moved': iso(m), 'end': iso(end), 'dates': [iso(x) for x in dates],
                      'datesTypedEnd': [iso(x) for x in dates_typed_end]})
        d += timedelta(days=1)

    # golden corpus first dates (generate_golden.mjs): 26 dates every 29th day from 2027-01-01,
    # plus the extra:semiMonthlyMonthEnd list
    corpus = {}
    for k in range(26):
        t = date(2027, 1, 1) + timedelta(days=29 * k)
        corpus[iso(t)] = iso(move(t))
    for (y, mo, dd) in [(2027, 1, 14), (2027, 1, 15), (2027, 1, 16), (2027, 1, 30), (2027, 1, 31), (2027, 2, 14),
                        (2027, 2, 15), (2027, 2, 28), (2027, 3, 30), (2027, 4, 30), (2027, 12, 31), (2028, 1, 31),
                        (2028, 2, 14), (2028, 2, 28), (2028, 2, 29)]:
        t = date(y, mo, dd)
        corpus[iso(t)] = iso(move(t))

    # full-row vectors (macro CalculateAll from the moved date)
    oldgen.trust_check()
    d01 = [v for v in json.load(open(os.path.join(HERE, 'ca_defect_012_vectors.json')))['vectors']
           if v['defect'] == 'D-01']
    t4 = json.load(open(os.path.join(HERE, 'ca_semimonthly_vectors.json')))['vectors']
    vectors = []
    for src, group in [(d01, 'D-01'), (t4, 'T4')]:
        for v in src:
            inp = dict(v['inputs'], converted_rate_pct=v['converted_rate_pct'])
            typed = date.fromisoformat(inp['first'])
            m = move(typed)
            if m == typed:
                continue
            inp['first'] = iso(m)
            rows, totals = oldgen.run(inp)
            vectors.append({'id': v['id'], 'group': group, 'typed': iso(typed), 'moved': iso(m),
                            'request': v['request'], 'converted_rate_pct': v['converted_rate_pct'],
                            'rows': rows, 'totals': totals})

    out = {
        'source': 'QA oracle generate_b25_semimonthly_move_vectors.py (B25 / DEV-OQZ): rule R1 from the decision, '
                  'dates after the move from a line-for-line port of the macro getNextSemiMonthly.',
        'moves': moves,
        'sweep': sweep,
        'corpus': corpus,
        'vectors': vectors,
    }
    with open(os.path.join(HERE, 'b25_semimonthly_move_vectors.json'), 'w') as f:
        json.dump(out, f, separators=(',', ':'))
    moved_n = sum(1 for m in moves if m['typed'] != m['moved'])
    print('vectors', [v['id'] for v in vectors]); print('wrote', len(moves), 'moves,', moved_n, 'moved,', len(moves) - moved_n, 'unmoved; corpus dates', len(corpus))


main()
