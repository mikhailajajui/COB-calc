"""QA test-only oracle for T5 / checklist Phase 2c (leap split vs getRate, OQ-L unpaid interest).

Line-for-line transliteration of the macro's CalculateAll (End-Date exit), getRate,
crossesLeapYear, isInLeapYear, daysInYear, getNextWeekly, getNextBiweekly, getNextMonthly
(reference/workbook-macro-source.txt ~lines 380-560, 590-650, 829-900). No improvements,
quirks kept:
  - crossesLeapYear XORs the START year's leap status against every year start..end, so
    a period is split only when some year in the span differs from the start year.
  - getRate's split: start-year part days-to-Jan-1 / daysInYear(start), any MIDDLE year
    contributes the whole ANNUALRATE, end-year part days-since-Jan-1 / daysInYear(end).
    Not flagged -> a single term days / daysInYear(START) for the whole span.
  - Unpaid interest: intPaid = min(pay, intAccrued - totalInterestPaid);
    newBalance = newFees + newPrinciple + intAccrued - totalInterestPaid; the next
    newInt = openingBalance x rate (so unpaid interest is itself charged interest).
  - Payment 0: isMoneyLeft False -> every paid amount is 0 (recorded, not tested).

Trust check (must pass before anything is written, == not approx):
  - every row field and total of S0_007, S3_leap_weekly, S6_underpay, S7_biweekly
    (ca_oracle_scenarios.json) and D02_scenarioA_underpay,
    D03_monthly_rowcount_2028-02-29 (ca_defect_012_vectors.json);
  - REF-01, the REAL Excel output saved in the workbook (ca_ref01_workbook_saved.json),
    every stored row cell and summary.

Writes ca_t5_engine_rules_vectors.json. Run: python3 generate_t5_engine_rules.py
"""
import calendar
import json
import os
from datetime import date, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))


def last_day(y, m):
    return calendar.monthrange(y, m)[1]


def date_add_m(d, k):  # VBA DateAdd("m", k, d): day clamped to the target month's end
    m = d.month - 1 + k
    y, mo = d.year + m // 12, m % 12 + 1
    return date(y, mo, min(d.day, last_day(y, mo)))


def get_next_weekly(current):
    return current + timedelta(days=7)


def get_next_biweekly(first, current):
    get_date = first
    while not (get_date > current):
        get_date = get_date + timedelta(days=14)
    return get_date


def get_next_monthly(first, current):
    get_date = first
    mths = 0
    while not (get_date > current):
        get_date = date_add_m(first, mths)
        mths += 1
    return get_date


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


BRANCHES = {'no_split': 0, 'split': 0, 'middle_year': 0}


def get_rate(a, s, e):
    if crosses_leap_year(s, e):
        BRANCHES['split'] += 1
        mixed = 0
        for y in range(s.year, e.year + 1):
            if y == s.year:
                part = a * (date(s.year + 1, 1, 1) - s).days / days_in_year(s)
            elif y == e.year:
                part = a * (e - date(e.year, 1, 1)).days / days_in_year(e)
            else:
                BRANCHES['middle_year'] += 1
                part = a
            mixed = mixed + part
        return mixed
    BRANCHES['no_split'] += 1
    return a * (e - s).days / days_in_year(s)


def plain_actual_fraction(s, e):
    """Plain actual/actual: each day weighted 1/365 or 1/366 by its own calendar year."""
    f = 0.0
    cur = s
    while cur < e:
        nxt = min(date(cur.year + 1, 1, 1), e)
        f += (nxt - cur).days / days_in_year(cur)
        cur = nxt
    return f


def calculate_all(loan_amt, fin_fee, non_fin_fee, a_rate_pct, disb, first, e_date, pymt_amnt, freq):
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
            if freq == 'weekly':
                next_date = get_next_weekly(start)
            elif freq == 'biweekly':
                next_date = get_next_biweekly(first, start)
            elif freq == 'monthly':
                next_date = get_next_monthly(first, start)
            else:
                raise ValueError(freq)
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
            'unpaid_int_close': int_accrued - total_interest_paid,
            'applied_rate': applied, 'days': (closing - start).days,
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
              'total_interest': int_accrued, 'term_days': term_day, 'avg_opening_principle': avg,
              'total_interest_paid': total_interest_paid}
    return rows, totals


def run(inp, rate_pct):
    d = date.fromisoformat
    return calculate_all(inp['loan'], inp['fin'], inp['nonfin'], rate_pct, d(inp['disb']), d(inp['first']),
                         d(inp['end']), inp['pay'], inp['freq'])


ROW_KEYS = ('n', 'date', 'open_loan', 'open_principal', 'open_fees', 'new_int', 'total_int', 'payment',
            'interest_paid', 'fees_paid', 'principal_paid', 'close_fees', 'close_principal', 'close_loan')


def assert_exact(rows, totals, exp_rows, exp_totals, vid, total_keys):
    assert len(rows) == len(exp_rows), (vid, len(rows), len(exp_rows))
    for a, e in zip(rows, exp_rows):
        for k in ROW_KEYS:
            if k in e:
                assert a[k] == e[k], (vid, a['n'], k, a[k], e[k])
    for k in total_keys:
        assert totals[k] == exp_totals[k], (vid, k, totals[k], exp_totals[k])


def trust_check():
    checked = []
    tk = ('cob_amount', 'cob_rate', 'total_payment', 'n', 'total_interest', 'term_days')
    oracle = json.load(open(os.path.join(HERE, 'ca_oracle_scenarios.json')))['scenarios']
    for sid in ('S0_007', 'S3_leap_weekly', 'S6_underpay', 'S7_biweekly'):
        s = next(x for x in oracle if x['inputs']['id'] == sid)
        inp = dict(s['inputs'], freq=s['inputs']['freq'])
        rows, totals = run(inp, s['converted_rate_pct'])
        assert_exact(rows, totals, s['rows'], s['totals'], sid, tk)
        checked.append(sid)
    dv = json.load(open(os.path.join(HERE, 'ca_defect_012_vectors.json')))['vectors']
    for vid in ('D02_scenarioA_underpay', 'D03_monthly_rowcount_2028-02-29'):
        v = next(x for x in dv if x['id'] == vid)
        rows, totals = run(v['inputs'], v['converted_rate_pct'])
        assert_exact(rows, totals, v['rows'], v['totals'], vid, tk)
        checked.append(vid)
    ref = json.load(open(os.path.join(HERE, 'ca_ref01_workbook_saved.json')))
    ri = ref['inputs']
    inp = {'loan': ri['loan_amount'], 'fin': ri['financed_fees'], 'nonfin': ri['non_financed_fees'],
           'freq': 'weekly', 'disb': ri['disbursal_date'], 'first': ri['first_payment_date'],
           'end': ri['end_date'], 'pay': ri['payment_amount']}
    rows, totals = run(inp, ri['calculated_rate_pct'])
    sm = ref['summary']
    assert_exact(rows, totals, ref['rows'], {'cob_amount': sm['cob_amount'], 'total_payment': sm['total_payment'],
                                             'n': sm['n_payments'], 'total_interest': sm['total_interest'],
                                             'term_days': sm['term_days'], 'cob_rate': sm['cob_rate_pct']},
                 'REF-01', tk)
    checked.append('REF-01 (real Excel)')
    return checked


def request(inp):
    return {'flow': 'newMortgageOrLoan', 'productType': 'personalLoan', 'rateType': 'fixed',
            'loanAmount': inp['loan'], 'contractRatePercent': inp['rate'], 'paymentAmount': inp['pay'],
            'paymentFrequency': inp['freq'], 'firstPaymentDate': inp['first'], 'endDate': inp['end'],
            'termYears': 1, 'termMonths': 0, 'fees': {'fees': []}, 'disbursalDate': inp['disb']}


def leap_quirk_scan():
    """Every (start, end) with start in 2026-01-01..2033-12-31 and span 1..800 days:
    VBA getRate fraction vs the plain actual/actual split."""
    worst = {'rel': 0.0}
    n = 0
    split_disagree = 0  # flagged/not-flagged differs from 'spans a year of different length'
    s = date(2026, 1, 1)
    while s <= date(2033, 12, 31):
        for span in range(1, 801):
            e = s + timedelta(days=span)
            v = get_rate(1.0, s, e)
            p = plain_actual_fraction(s, e)
            rel = abs(v - p) / p
            n += 1
            if rel > worst['rel']:
                worst = {'rel': rel, 'start': s.isoformat(), 'end': e.isoformat(), 'vba': v, 'plain': p}
        s += timedelta(days=1)
    return {'pairs': n, 'max_rel_diff_vs_plain_split': worst,
            'conclusion': 'VBA getRate equals the plain 365/366 actual-day split up to floating-point '
                          'summation order' if worst['rel'] < 1e-12 else 'VBA getRate DIFFERS from the plain split'}


CASES = [
    # id, what, inputs (personal loan: rate unconverted, calculated rate = contract rate)
    ('L1_into_leap_monthly', 'monthly; first period 2027-12-15 -> 2028-01-15 crosses INTO leap 2028 (17/365 + 14/366)',
     dict(loan=100000, fin=0, nonfin=0, rate=5.0, freq='monthly', disb='2027-12-15', first='2028-01-15',
          end='2028-04-15', pay=2000)),
    ('L2_out_of_leap_monthly', 'monthly; period 2028-12-10 -> 2029-01-10 crosses OUT of leap 2028 (22/366 + 9/365)',
     dict(loan=100000, fin=0, nonfin=0, rate=5.0, freq='monthly', disb='2028-11-10', first='2028-12-10',
          end='2029-03-10', pay=2000)),
    ('L3_dec31_start_nonleap', 'weekly; first period starts Dec 31 2027 (1/365 + 6/366)',
     dict(loan=100000, fin=0, nonfin=0, rate=5.0, freq='weekly', disb='2027-12-31', first='2028-01-07',
          end='2028-02-04', pay=500)),
    ('L4_dec31_start_leap', 'weekly; first period starts Dec 31 2028, a leap-year Dec 31 (1/366 + 6/365)',
     dict(loan=100000, fin=0, nonfin=0, rate=5.0, freq='weekly', disb='2028-12-31', first='2029-01-07',
          end='2029-02-04', pay=500)),
    ('L5_multiyear_middle_leap', 'monthly; first period 2027-06-15 -> 2029-03-15 spans 2027, ALL of 2028, 2029: '
     'VBA middle-year branch ratePart = ANNUALRATE',
     dict(loan=100000, fin=0, nonfin=0, rate=5.0, freq='monthly', disb='2027-06-15', first='2029-03-15',
          end='2029-06-15', pay=10000)),
    ('L6_multiyear_from_leap', 'monthly; first period 2028-02-01 -> 2030-01-15 starts in leap 2028, ALL of 2029 '
     '(middle year), then 2030',
     dict(loan=100000, fin=0, nonfin=0, rate=5.0, freq='monthly', disb='2028-02-01', first='2030-01-15',
          end='2030-04-15', pay=12000)),
    ('L7_multiyear_no_leap', 'biweekly; first period 2029-03-01 -> 2031-02-06 spans only non-leap years: '
     'crossesLeapYear False, single term days/365',
     dict(loan=100000, fin=0, nonfin=0, rate=5.0, freq='biweekly', disb='2029-03-01', first='2031-02-06',
          end='2031-05-01', pay=11000)),
    ('N1_negam_monthly', 'OQ-L: $100k at 12%, monthly, $500 (< ~$1,000 interest): unpaid interest capitalised, '
     '8 rows',
     dict(loan=100000, fin=0, nonfin=0, rate=12.0, freq='monthly', disb='2026-01-01', first='2026-02-01',
          end='2026-09-01', pay=500)),
    ('N2_negam_weekly_leap', 'OQ-L across a leap boundary: $200k at 9%, weekly, $300 (< ~$345 interest), '
     '2027-12-03 .. 2028-02-25',
     dict(loan=200000, fin=0, nonfin=0, rate=9.0, freq='weekly', disb='2027-11-26', first='2027-12-03',
          end='2028-02-25', pay=300)),
    ('N3_negam_then_covered', 'OQ-L: first period is 5 months long so row 1 underpays; later monthly rows pay '
     'the carried interest off, then principal',
     dict(loan=50000, fin=0, nonfin=0, rate=8.0, freq='monthly', disb='2026-01-01', first='2026-06-01',
          end='2026-12-01', pay=900)),
]


if __name__ == '__main__':
    checked = trust_check()
    BRANCHES.update({'no_split': 0, 'split': 0, 'middle_year': 0})
    vectors = []
    for cid, what, inp in CASES:
        inp = dict(inp, id=cid)
        rows, totals = run(inp, inp['rate'])
        first = rows[0]
        s, e = date.fromisoformat(inp['disb']), date.fromisoformat(inp['first'])
        vectors.append({'id': cid, 'what': what, 'inputs': inp, 'converted_rate_pct': inp['rate'],
                        'request': request(inp), 'totals': totals, 'rows': rows,
                        'first_period': {'crossesLeapYear': crosses_leap_year(s, e),
                                         'vba_fraction': get_rate(1.0, s, e),
                                         'plain_fraction': plain_actual_fraction(s, e)}})
    branches = dict(BRANCHES)
    z_inp = dict(loan=100000, fin=0, nonfin=0, rate=12.0, freq='monthly', disb='2026-01-01', first='2026-02-01',
                 end='2026-05-01', pay=0, id='Z0_zero_payment')
    z_rows, z_totals = run(z_inp, 12.0)
    scan = leap_quirk_scan()
    out = {
        'source': 'QA oracle generate_t5_engine_rules.py: transliterated CalculateAll / getRate / '
                  'crossesLeapYear / getNextWeekly / getNextBiweekly / getNextMonthly; trust-checked exactly '
                  'against ' + ', '.join(checked),
        'tolerance_rel': 1e-9,
        'branches_hit': branches,
        'leap_quirk_scan': scan,
        'vectors': vectors,
        'zero_payment_workbook_behaviour': {
            'note': 'NOT a test vector: the engine rejects paymentAmount <= 0 (validate.ts). Recorded for the '
                    'business question only.',
            'inputs': z_inp, 'totals': z_totals, 'rows': z_rows},
    }
    with open(os.path.join(HERE, 'ca_t5_engine_rules_vectors.json'), 'w') as f:
        json.dump(out, f, indent=1)
        f.write('\n')
    print('trust check OK on', checked)
    print('branches', branches)
    print('scan', json.dumps(scan))
    for v in vectors:
        print(v['id'], v['totals']['n'], v['first_period'], [r['date'] for r in v['rows']][:4])
    print('zero payment', z_totals, z_rows[-1]['close_loan'])
