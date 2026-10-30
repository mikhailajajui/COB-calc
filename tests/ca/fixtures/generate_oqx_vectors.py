"""QA test-only oracle for T3b / OQ-X (monthly month-end rule, business decision 2026-09-27).

Line-for-line transliteration of the macro's CalculateAll / getRate / crossesLeapYear /
daysInYear / getNextMonthly (reference/workbook-macro-source.txt), monthly frequency and
End-Date exit only, no improvements. The ONLY swap is the monthly date function:
  - 'workbook': DateAdd("m", k, firstPymtDate) (clamped)          -> the workbook truth
  - 'oqx'     : if firstPymtDate is the last day of its month, the last day of month k;
                otherwise DateAdd("m", k, firstPymtDate)          -> the intentional difference
Trust check: 'workbook' mode must reproduce ca_defect_012_vectors.json
D03_monthly_rowcount_2028-02-29 exactly (every row field and total) before the 'oqx'
output is written. Run: python3 generate_oqx_vectors.py  (writes ca_oqx_vectors.json)
"""
import calendar
import json
import os
from datetime import date, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))


def last_day(y, m):
    return calendar.monthrange(y, m)[1]


def date_add_m(d, k):  # VBA DateAdd("m", k, d)
    m = d.month - 1 + k
    y, mo = d.year + m // 12, m % 12 + 1
    return date(y, mo, min(d.day, last_day(y, mo)))


def monthly_k(first, k, mode):
    if mode == 'oqx' and first.day == last_day(first.year, first.month):
        m = first.month - 1 + k
        y, mo = first.year + m // 12, m % 12 + 1
        return date(y, mo, last_day(y, mo))
    return date_add_m(first, k)


def get_next_monthly(first, current, mode):  # getNextMonthly
    get_date = first
    mths = 0
    while not (get_date > current):
        get_date = monthly_k(first, mths, mode)
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


def calculate_all(loan_amt, fin_fee, non_fin_fee, a_rate_pct, disb, first, e_date, pymt_amnt, mode):
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
            next_date = get_next_monthly(first, start, mode)
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


def run(inp, mode):
    d = date.fromisoformat
    return calculate_all(inp['loan'], inp['fin'], inp['nonfin'], inp['converted_rate_pct'], d(inp['disb']),
                         d(inp['first']), d(inp['end']), inp['pay'], mode)


def trust_check():
    vecs = json.load(open(os.path.join(HERE, 'ca_defect_012_vectors.json')))['vectors']
    v = next(x for x in vecs if x['id'] == 'D03_monthly_rowcount_2028-02-29')
    inp = dict(v['inputs'], converted_rate_pct=v['converted_rate_pct'])
    rows, totals = run(inp, 'workbook')
    assert len(rows) == len(v['rows']), (len(rows), len(v['rows']))
    for a, e in zip(rows, v['rows']):
        for k, ev in e.items():
            assert a[k] == ev, (a['n'], k, a[k], ev)  # exact, not approximate
    for k in ('cob_amount', 'cob_rate', 'total_payment', 'n', 'total_interest', 'term_days'):
        assert totals[k] == v['totals'][k], (k, totals[k], v['totals'][k])
    return v


if __name__ == '__main__':
    base = trust_check()
    b = base['inputs']
    common = {k: b[k] for k in ('loan', 'fin', 'nonfin', 'rate', 'pay', 'productType', 'rateType')}
    common['freq'] = 'monthly'
    common['converted_rate_pct'] = base['converted_rate_pct']
    cases = [
        ('OQX_feb29_2028_to_feb28_2029', '2028-02-01', '2028-02-29', '2029-02-28',
         'same inputs as D03_monthly_rowcount_2028-02-29; month-end first -> every row on month-end'),
        ('OQX_apr30_2027_to_jul31_2027', '2027-04-01', '2027-04-30', '2027-07-31',
         'Apr 30 -> May 31 -> Jun 30 -> Jul 31'),
        ('OQX_nov30_2027_to_mar31_2028', '2027-11-01', '2027-11-30', '2028-03-31',
         'Nov 30 -> Dec 31 -> Jan 31 2028 -> Feb 29 2028 -> Mar 31 (crosses into a leap year)'),
    ]
    vectors = []
    for cid, disb, first, end, what in cases:
        inp = dict(common, id=cid, disb=disb, first=first, end=end)
        rows, totals = run(inp, 'oqx')
        wb_rows, _ = run(inp, 'workbook')
        req = {'flow': 'newMortgageOrLoan', 'productType': 'mortgage', 'rateType': 'fixed',
               'loanAmount': inp['loan'], 'contractRatePercent': inp['rate'], 'paymentAmount': inp['pay'],
               'paymentFrequency': 'monthly', 'firstPaymentDate': first, 'endDate': end, 'termYears': 1,
               'termMonths': 0, 'fees': {'fees': []}, 'disbursalDate': disb, 'semiAnnualCompoundingDate': disb}
        vectors.append({'id': cid, 'rule': 'OQ-X', 'what': what, 'inputs': inp,
                        'converted_rate_pct': inp['converted_rate_pct'], 'request': req, 'totals': totals,
                        'rows': rows, 'workbook_dates': [r['date'] for r in wb_rows]})
    out = {
        'source': 'QA oracle generate_oqx_vectors.py: transliterated CalculateAll with the OQ-X monthly date '
                  'rule swapped in; workbook mode reproduces D03_monthly_rowcount_2028-02-29 exactly',
        'rule': 'OQ-X (business decision 2026-09-27): first payment on the last day of its month -> every '
                'monthly payment on the last day of its month; otherwise DateAdd("m", k, first). Intentional '
                'difference from the workbook.',
        'tolerance_rel': 1e-9,
        'vectors': vectors,
    }
    with open(os.path.join(HERE, 'ca_oqx_vectors.json'), 'w') as f:
        json.dump(out, f, indent=1)
    print('trust check OK; wrote', len(vectors), 'vectors')
    for v in vectors:
        print(v['id'], v['totals']['n'], [r['date'] for r in v['rows']])
        print('   workbook', v['workbook_dates'])
