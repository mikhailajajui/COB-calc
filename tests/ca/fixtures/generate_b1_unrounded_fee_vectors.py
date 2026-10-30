"""QA test-only vectors for B1 (012 D-10, OQ-H / ADR-02): fee totals are the plain, unrounded
left-to-right sum of the fee amounts. No rounding anywhere in the calculation path.

Oracle: generate_t5_engine_rules.calculate_all, the line-for-line CalculateAll transliteration
(reference/workbook-macro-source.txt). The macro has no Round(): `finFee`/`nonFinFee` are read
from D6/D8 and used as-is (`currFees = finFee + nonFinFee`, `COB = intAccrued + finFee +
nonFinFee`, `If finFee + nonFinFee = 0` short-circuit). The fee totals below are Python
float sums with start 0, left to right -- the same IEEE-754 double arithmetic as JS
`reduce((s, f) => s + f.amount, 0)` -- computed here, NOT by the engine.

Trust check before anything is written: generate_t5_engine_rules.trust_check() (== on S0_007,
S3_leap_weekly, S6_underpay, S7_biweekly, D02, D03 and REF-01, the real Excel output).

Conventions the engine follows (not the workbook), same as generate_oqy_zero_payment_vectors.py:
  - OQ-S (decided): non-financed (cash) fees are never in the schedule; the oracle runs with
    non_fin_fee = 0 and the cash total is added to C (and the fees==0 test) only.
  - OQ-Q (open): the engine's P is the mean opening *balance* (open_loan); the workbook's is the
    mean opening *principal*. Both recorded; tests use `cob_rate_pct_engine_p`.

Base input: personal loan, fixed 6% (T2: used unconverted), monthly 500, disbursal 2026-01-01,
first payment 2026-02-01, end 2026-12-01 (11 rows, no payoff), loan 10000.

Writes b1_unrounded_fee_vectors.json. Run: python3 generate_b1_unrounded_fee_vectors.py
"""
import json
import os

import generate_t5_engine_rules as g

HERE = os.path.dirname(os.path.abspath(__file__))
RATE_PCT = 6.0
BASE = {'loan': 10000, 'pay': 500, 'freq': 'monthly', 'disb': '2026-01-01', 'first': '2026-02-01',
        'end': '2026-12-01'}


def fsum(xs):  # plain left-to-right float sum, start 0 (== JS reduce)
    s = 0
    for x in xs:
        s = s + x
    return s


def round2_js(x):  # what today's fees.ts does (Math.round(x*100)/100; x >= 0 here), recorded only
    import math
    return math.floor(x * 100 + 0.5) / 100


CASES = [
    ('B1-V1_financed_1234.565', 'one financed fee 1234.565 (round2 -> 1234.57); larger than one '
     'payment, so the sub-cent fee balance is recovered over rows 1-3', [1234.565], []),
    ('B1-V2_cash_0.005', 'one cash fee 0.005 (round2 -> 0.01): C and APR only (OQ-S)', [], [0.005]),
    ('B1-V3_cash_0.004', 'one cash fee 0.004: round2 -> 0 takes the fees==0 APR short-circuit; '
     'unrounded 0.004 != 0 takes the general branch (macro: If finFee + nonFinFee = 0)', [], [0.004]),
    ('B1-V4_financed_3x0.001', 'three financed fees 0.001 each: sum 0.003 (round2 -> 0). Unrounded, '
     'the 0.003 is recovered on row 1, disbursal is loan - 0.003, APR takes the general branch',
     [0.001, 0.001, 0.001], []),
    ('B1-V5_mixed_three_plus_three', 'financed 100.004 + 200.003 + 300.002 = 600.009 (round2 -> '
     '600.01); cash 0.004 + 0.003 + 0.002 = 0.009000000000000001 (round2 -> 0.01)',
     [100.004, 200.003, 300.002], [0.004, 0.003, 0.002]),
]


def fee(amount, financed, i):
    return {'name': ('Fin' if financed else 'Cash') + str(i), 'amount': amount, 'financed': financed,
            'includedInCob': True}


def vector(vid, what, fin_list, cash_list):
    fin = fsum(fin_list)
    cash = fsum(cash_list)
    rows, t = g.run(dict(BASE, fin=fin, nonfin=0), RATE_PCT)
    cob = t['total_interest'] + fin + cash  # engine order: totalInterest + financed + cash
    years = t['term_days'] / 365
    p_engine = fsum(r['open_loan'] for r in rows) / len(rows)
    p_workbook = fsum(r['open_principal'] for r in rows) / len(rows)
    if fin + cash == 0:
        apr_engine = apr_workbook = RATE_PCT
    else:
        apr_engine = cob / (years * p_engine) * 100
        apr_workbook = cob / (p_workbook * years) * 100
        if cash == 0:
            assert apr_workbook == t['cob_rate'], (vid, apr_workbook, t['cob_rate'])
    fees = [fee(a, True, i) for i, a in enumerate(fin_list)] + [fee(a, False, i) for i, a in enumerate(cash_list)]
    return {
        'id': vid, 'what': what,
        'request': {'flow': 'newMortgageOrLoan', 'productType': 'personalLoan', 'rateType': 'fixed',
                    'loanAmount': BASE['loan'], 'contractRatePercent': RATE_PCT, 'paymentAmount': BASE['pay'],
                    'paymentFrequency': BASE['freq'], 'disbursalDate': BASE['disb'],
                    'firstPaymentDate': BASE['first'], 'endDate': BASE['end'], 'termYears': 1,
                    'termMonths': 0, 'fees': {'fees': fees}},
        'fee_totals': {'financed': fin, 'cash': cash, 'all': fsum(fin_list + cash_list),
                       'rounded_today_financed': round2_js(fin), 'rounded_today_cash': round2_js(cash)},
        'totals': {
            'n': t['n'], 'term_days': t['term_days'], 'total_payment': t['total_payment'],
            'total_interest': t['total_interest'],
            'principal_payment': fsum(r['principal_paid'] for r in rows),
            'fees_recovered': fsum(r['fees_paid'] for r in rows),
            'disbursal_amount': BASE['loan'] - fin, 'ending_balance': rows[-1]['close_loan'],
            'cob_amount': cob, 'avg_opening_balance_engine_p': p_engine,
            'cob_rate_pct_engine_p': apr_engine, 'cob_rate_pct_workbook_p': apr_workbook,
        },
        'rows': [{k: r[k] for k in ('n', 'date', 'open_loan', 'open_fees', 'new_int', 'payment',
                                     'interest_paid', 'fees_paid', 'principal_paid', 'close_fees',
                                     'close_loan')} for r in rows],
    }


def main():
    checked = g.trust_check()
    out = {
        'source': 'generate_t5_engine_rules.calculate_all (VBA CalculateAll transliteration), '
                  'non_fin_fee = 0 (OQ-S); NOT a live macro run, NOT the engine',
        'trust_check': checked,
        'generated_by': 'cd COB-ts/tests/ca/fixtures && python3 generate_b1_unrounded_fee_vectors.py',
        'tolerance_rel': 1e-12,
        'fee_limit': {
            'rule': 'BRD sec 6 / OQ-M / validate.ts (B2-R1): unrounded financed total + unrounded non-financed '
                    'total must be < loanAmount; these cases have financed fees only',
            'cases': [
                {'id': 'L1_equal_subcent', 'loanAmount': 1000.004, 'financed': [1000.004],
                 'sum': fsum([1000.004]), 'accept': False,
                 'note': 'round2 -> 1000 < 1000.004 is accepted today; unrounded sum == loan -> reject'},
                {'id': 'L2_just_below_subcent', 'loanAmount': 1000.004, 'financed': [1000.003],
                 'sum': fsum([1000.003]), 'accept': True, 'note': 'unrounded 1000.003 < 1000.004'},
                {'id': 'L3_three_fees_to_loan', 'loanAmount': 1000, 'financed': [999.998, 0.001, 0.001],
                 'sum': fsum([999.998, 0.001, 0.001]), 'accept': fsum([999.998, 0.001, 0.001]) < 1000,
                 'note': 'three sub-cent fees whose float sum is the loan boundary'},
                {'id': 'L4_three_fees_below', 'loanAmount': 1000, 'financed': [999.997, 0.001, 0.001],
                 'sum': fsum([999.997, 0.001, 0.001]), 'accept': fsum([999.997, 0.001, 0.001]) < 1000,
                 'note': 'round2 -> 1000 rejects today; unrounded 999.999 < 1000 -> accept'},
            ],
        },
        'vectors': [vector(*c) for c in CASES],
    }
    with open(os.path.join(HERE, 'b1_unrounded_fee_vectors.json'), 'w') as f:
        json.dump(out, f, indent=1)
        f.write('\n')
    print('trust check:', checked)
    for v in out['vectors']:
        print(v['id'], v['fee_totals'], v['totals']['cob_amount'], v['totals']['cob_rate_pct_engine_p'])
    for c in out['fee_limit']['cases']:
        print(c['id'], repr(c['sum']), c['accept'])


if __name__ == '__main__':
    main()
