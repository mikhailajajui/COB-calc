"""QA test-only oracle for T4 (semi-monthly payment dates, workbook getNextSemiMonthly).

Line-for-line transliteration of the macro's getNextSemiMonthly, getNextEOM, CalculateAll
(semi-monthly branch, End-Date exit), getRate / crossesLeapYear / daysInYear
(reference/workbook-macro-source.txt ~lines 380-460, 844-905), no improvements, quirks
kept. VBA date primitives are modelled exactly:
  - DateAdd("d", n, d)  : plain day arithmetic
  - DateAdd("m", n, d)  : month step, day clamped to the target month's last day
  - DateSerial(y, m, d) : month overflow normalised; day 0 -> last day of previous month,
                          any day d -> first of (y, m) + (d - 1) days
  - DatePart("d", d)    : day of month
Chaining: payment #1 is the First Payment Date itself (closingDate = firstPymtDate on
the first iteration); every later payment is getNextSemiMonthly(firstPymtDate, startDate)
where startDate is the previous payment date. Exit when DateDiff("d", eDate, next) > 0
(a payment ON the End Date is kept) or once the balance reaches 0.

Trust check (must pass before anything is written): reproduces every D-01 vector in
ca_defect_012_vectors.json and S4_semimonthly in ca_oracle_scenarios.json exactly
(every row field and total, == not approx). Those came from a separate transliteration
(macro_oracle.py), so this is an independent cross-check.

Writes ca_semimonthly_vectors.json:
  - 'vectors': full-row vectors (engine request + oracle rows/totals) for T4 edge cases
  - 'sweep'  : for EVERY first-payment date 2027-01-01 .. 2028-12-31 (includes leap
               2028), end = first + 730 days, the oracle date list (dates only)
Run: python3 generate_semimonthly_vectors.py
"""
import calendar
import json
import os
from datetime import date, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
TRACE = {'branches': {}, 'dateserial_day0': 0, 'dateserial_day0_cases': []}


# ---- VBA primitives ----
def last_day(y, m):
    return calendar.monthrange(y, m)[1]


def date_add_d(n, d):  # DateAdd("d", n, d)
    return d + timedelta(days=n)


def date_add_m(n, d):  # DateAdd("m", n, d)
    m = d.month - 1 + n
    y, mo = d.year + m // 12, m % 12 + 1
    return date(y, mo, min(d.day, last_day(y, mo)))


def date_serial(y, m, d):  # DateSerial(y, m, d)
    m0 = m - 1
    y, m = y + m0 // 12, m0 % 12 + 1
    if d <= 0:
        TRACE['dateserial_day0'] += 1
    return date(y, m, 1) + timedelta(days=d - 1)


# ---- getNextEOM ----
def get_next_eom(current_date):
    get_date = current_date
    while not (get_date > current_date):
        get_date = date_add_d(1, get_date)
        get_date = date_add_m(1, get_date)
        get_date = date_serial(get_date.year, get_date.month, 1)
        get_date = date_add_d(-1, get_date)
    return get_date


# ---- getNextSemiMonthly ----
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
        branch = 'A_eom_to_15th'
        get_date = date_add_m(1, current_date)
        get_date = date_serial(get_date.year, get_date.month, 15)
    elif curr_day == 15 and is_eom:
        branch = 'B_15th_to_eom'
        get_date = curr_eom
    elif curr_day > 15:
        branch = 'C_next_month_day1'
        get_date = date_add_m(1, current_date)
        if day1 <= 0:
            TRACE['dateserial_day0_cases'].append((first_pymt_date.isoformat(), current_date.isoformat()))
        get_date = date_serial(get_date.year, get_date.month, day1)
    elif curr_day <= 15:
        next_date = date_add_d(15, current_date)
        branch = 'D_plus15'
        if next_date > curr_eom:
            next_date = curr_eom
            branch = 'D_plus15_capped'
        get_date = next_date
    TRACE['branches'][branch] = TRACE['branches'].get(branch, 0) + 1
    return get_date


# ---- getRate / leap-year helpers (as in generate_oqx_vectors.py) ----
def days_in_year(d):
    return (date(d.year + 1, 1, 1) - date(d.year, 1, 1)).days


def is_in_leap_year(d):
    return days_in_year(d) == 366


def crosses_leap_year(s, e):
    s_leap = is_in_leap_year(s)
    for y in range(s.year, e.year + 1):
        if s_leap ^ is_in_leap_year(date(y, 1, 1)):
            return True
    return False


def get_rate(a, s, e):
    if crosses_leap_year(s, e):
        mixed = 0
        for y in range(s.year, e.year + 1):
            if y == s.year:
                part = a * (date(s.year + 1, 1, 1) - s).days / days_in_year(s)
            elif y == e.year:
                part = a * (e - date(e.year, 1, 1)).days / days_in_year(e)
            else:
                part = a
            mixed = mixed + part
        return mixed
    return a * (e - s).days / days_in_year(s)


def semi_dates(first, e_date):
    """Date part of CalculateAll only (no balance -> no payoff exit)."""
    out = [first]
    start = first
    while True:
        nxt = get_next_semi_monthly(first, start)
        if (nxt - e_date).days > 0:
            break
        out.append(nxt)
        start = nxt
    return out


def calculate_all(loan_amt, fin_fee, non_fin_fee, a_rate_pct, disb, first, e_date, pymt_amnt):
    a_rate = a_rate_pct / 100
    pymt_count = 0
    start = disb
    closing = first
    opening = loan_amt
    curr_principle = loan_amt - fin_fee - non_fin_fee
    curr_fees = fin_fee + non_fin_fee
    int_accrued = 0
    total_interest_paid = 0
    total_opening_principle = 0
    total_payment = 0
    is_first = True
    rows = []
    while True:
        next_date = closing
        if not is_first:
            next_date = get_next_semi_monthly(first, start)
            if (next_date - e_date).days > 0:
                break
        closing = next_date
        applied = get_rate(a_rate, start, closing)
        new_int = opening * applied
        int_accrued = int_accrued + new_int
        money_left = pymt_amnt
        if money_left > 0:
            if money_left >= (int_accrued - total_interest_paid):
                int_paid = int_accrued - total_interest_paid
                money_left = money_left - int_paid
            else:
                int_paid = money_left
                money_left = 0
        else:
            int_paid = 0
        total_interest_paid = total_interest_paid + int_paid
        if money_left > 0:
            if curr_fees >= money_left:
                fees_paid = money_left
                money_left = 0
            else:
                fees_paid = curr_fees
                money_left = money_left - fees_paid
        else:
            fees_paid = 0
        new_fees = curr_fees - fees_paid
        if money_left > 0:
            if curr_principle >= money_left:
                principle_paid = money_left
                money_left = 0
            else:
                pymt_amnt = curr_principle
                principle_paid = curr_principle
                money_left = 0
        else:
            principle_paid = 0
        new_principle = curr_principle - principle_paid
        new_balance = new_fees + new_principle + int_accrued - total_interest_paid
        pymt_count = pymt_count + 1
        total_payment = total_payment + pymt_amnt
        rows.append({
            'n': pymt_count, 'date': closing.isoformat(), 'open_loan': opening,
            'open_principal': curr_principle, 'open_fees': curr_fees, 'new_int': new_int,
            'total_int': int_accrued, 'payment': pymt_amnt, 'interest_paid': int_paid,
            'fees_paid': fees_paid, 'principal_paid': principle_paid, 'close_fees': new_fees,
            'close_principal': new_principle, 'close_loan': new_balance,
        })
        start = closing
        total_opening_principle = total_opening_principle + curr_principle
        opening = new_balance
        curr_principle = new_principle
        curr_fees = new_fees
        is_first = False
        if opening <= 0:
            break
    term_day = (closing - disb).days
    avg = total_opening_principle / pymt_count
    cob = int_accrued + fin_fee + non_fin_fee
    cob_rate = a_rate * 100 if fin_fee + non_fin_fee == 0 else (cob / (avg * (term_day / 365))) * 100
    totals = {'cob_amount': cob, 'cob_rate': cob_rate, 'total_payment': total_payment, 'n': pymt_count,
              'total_interest': int_accrued, 'term_days': term_day, 'avg_opening_principle': avg}
    return rows, totals


def run(inp):
    d = date.fromisoformat
    return calculate_all(inp['loan'], inp['fin'], inp['nonfin'], inp['converted_rate_pct'], d(inp['disb']),
                         d(inp['first']), d(inp['end']), inp['pay'])


def assert_exact(rows, totals, exp_rows, exp_totals, vid):
    assert len(rows) == len(exp_rows), (vid, len(rows), len(exp_rows))
    for a, e in zip(rows, exp_rows):
        for k, ev in e.items():
            assert a[k] == ev, (vid, a['n'], k, a[k], ev)  # exact, not approximate
    for k in ('cob_amount', 'cob_rate', 'total_payment', 'n', 'total_interest', 'term_days'):
        assert totals[k] == exp_totals[k], (vid, k, totals[k], exp_totals[k])


def trust_check():
    vecs = json.load(open(os.path.join(HERE, 'ca_defect_012_vectors.json')))['vectors']
    d01 = [v for v in vecs if v['defect'] == 'D-01']
    assert len(d01) >= 9, len(d01)
    for v in d01:
        inp = dict(v['inputs'], converted_rate_pct=v['converted_rate_pct'])
        rows, totals = run(inp)
        assert_exact(rows, totals, v['rows'], v['totals'], v['id'])
    sc = json.load(open(os.path.join(HERE, 'ca_oracle_scenarios.json')))['scenarios']
    s4 = next(s for s in sc if s['inputs']['id'] == 'S4_semimonthly')
    rows, totals = run(dict(s4['inputs'], converted_rate_pct=s4['converted_rate_pct']))
    assert_exact(rows, totals, s4['rows'], s4['totals'], 'S4_semimonthly')
    return d01[0], [v['id'] for v in d01] + ['S4_semimonthly']


if __name__ == '__main__':
    base, checked = trust_check()
    b = base['inputs']
    common = {k: b[k] for k in ('loan', 'fin', 'nonfin', 'rate', 'pay', 'productType', 'rateType')}
    common['freq'] = 'semiMonthly'
    common['converted_rate_pct'] = base['converted_rate_pct']  # 5% at m=2 -> n=24
    cases = [
        ('T4_jan30_2027', '2027-01-20', '2027-01-30', '2027-07-30',
         '30th of a 31-day month (not month-end): 15th / 30th, Feb capped to 28'),
        ('T4_feb29_2028', '2028-02-19', '2028-02-29', '2028-08-31',
         'Feb 29 leap month-end: isEOM -> 15th / month-end'),
        ('T4_feb28_2028_not_eom', '2028-02-18', '2028-02-28', '2028-08-28',
         'Feb 28 in a leap year is NOT month-end: 13th / 28th'),
        ('T4_jan16_2027', '2027-01-06', '2027-01-16', '2027-07-16', '16th: day1 = 1 -> 1st / 16th'),
        ('T4_dec20_2027_yearcross', '2027-12-10', '2027-12-20', '2028-06-20',
         '20th crossing into leap 2028: 5th / 20th'),
        ('T4_jan14_2028_febcap', '2028-01-04', '2028-01-14', '2028-07-14',
         '14th: 14 + 15 = 29 -> Feb 29 2028 (leap, not capped)'),
        ('T4_jun30_2027_eom', '2027-06-20', '2027-06-30', '2027-12-31',
         '30th of a 30-day month (month-end): 15th / month-end, Jul 31'),
    ]
    vectors = []
    for cid, disb, first, end, what in cases:
        inp = dict(common, id=cid, disb=disb, first=first, end=end)
        rows, totals = run(inp)
        req = {'flow': 'newMortgageOrLoan', 'productType': 'mortgage', 'rateType': 'fixed',
               'loanAmount': inp['loan'], 'contractRatePercent': inp['rate'], 'paymentAmount': inp['pay'],
               'paymentFrequency': 'semiMonthly', 'firstPaymentDate': first, 'endDate': end, 'termYears': 1,
               'termMonths': 0, 'fees': {'fees': []}, 'disbursalDate': disb, 'semiAnnualCompoundingDate': disb}
        vectors.append({'id': cid, 'rule': 'T4 getNextSemiMonthly', 'what': what, 'inputs': inp,
                        'converted_rate_pct': inp['converted_rate_pct'], 'request': req, 'totals': totals,
                        'rows': rows})

    TRACE['branches'] = {}
    sweep = []
    f = date(2027, 1, 1)
    while f <= date(2028, 12, 31):
        e = f + timedelta(days=730)
        ds = semi_dates(f, e)
        # property checks on the workbook rule (reported, not "fixed")
        for a, c in zip(ds, ds[1:]):
            assert c > a, ('not increasing', f, a, c)
            assert 13 <= (c - a).days <= 17, ('gap', f, a, c, (c - a).days)
        months = {}
        for x in ds:
            months[(x.year, x.month)] = months.get((x.year, x.month), 0) + 1
        inner = list(months.values())[1:-1]
        assert all(n == 2 for n in inner), ('not 2 per month', f, months)
        sweep.append({'first': f.isoformat(), 'end': e.isoformat(), 'dates': [x.isoformat() for x in ds]})
        f += timedelta(days=1)

    out = {
        'source': 'QA oracle generate_semimonthly_vectors.py: line-for-line transliteration of the macro '
                  'getNextSemiMonthly / getNextEOM / CalculateAll (semi-monthly, End-Date exit). Trust check: '
                  'reproduces exactly ' + ', '.join(checked),
        'rule': 'workbook getNextSemiMonthly, chained from the previous payment date; payment #1 = First '
                'Payment Date; exit when a candidate is AFTER the End Date (a payment ON it is kept). The '
                'monthly month-end rule OQ-X does NOT apply to semi-monthly.',
        'tolerance_rel': 1e-9,
        'vectors': vectors,
        'sweep_request': {'flow': 'newMortgageOrLoan', 'productType': 'personalLoan', 'rateType': 'fixed',
                          'loanAmount': 10000000, 'contractRatePercent': 1, 'paymentAmount': 1,
                          'paymentFrequency': 'semiMonthly', 'termYears': 1, 'termMonths': 0,
                          'fees': {'fees': []}, 'note': 'disbursalDate = firstPaymentDate; payment < interest, '
                                                        'so no payoff exit'},
        'sweep': sweep,
    }
    with open(os.path.join(HERE, 'ca_semimonthly_vectors.json'), 'w') as fh:
        json.dump(out, fh, indent=None, separators=(',', ':'))
    print('trust check OK on', len(checked), 'vectors; wrote', len(vectors), 'vectors,', len(sweep), 'sweep dates,',
          sum(len(s['dates']) for s in sweep), 'sweep rows')
    print('sweep branches', TRACE['branches'], 'DateSerial day<=0 calls', TRACE['dateserial_day0'],
          'cases', TRACE['dateserial_day0_cases'][:5])
    for v in vectors:
        print(v['id'], v['totals']['n'], [r['date'] for r in v['rows']])
