"""QA test-only vectors for T7 / OQ-Y (decided 2026-09-27): a $0 payment is allowed, as in Excel.

Oracle: generate_t5_engine_rules.calculate_all, the line-for-line CalculateAll transliteration
(reference/workbook-macro-source.txt). With pymtAmnt = 0 the macro's `isMoneyLeft` is False at
every step, so interest paid, fees paid and principal paid are all 0; unpaid interest carries
forward inside the Loan balance and is charged interest (OQ-L); the End-Date exit is the only
exit (the balance never reaches 0), and the last-payment rule (`pymtAmnt = currPrinciple`) sits
inside the principal branch, so it never fires.

Trust check before anything is written: generate_t5_engine_rules.trust_check() (== on S0_007,
S3_leap_weekly, S6_underpay, S7_biweekly, D02, D03 and REF-01, the real Excel output), and the
fixed-mortgage weekly 3.74% calculated rate is taken from S6_underpay's converted_rate_pct.

Conventions the engine follows (not the workbook) are recorded next to the workbook value:
  - OQ-S (decided): non-financed fees are never in the schedule; the oracle is run with
    non_fin_fee = 0 and they are added to C only.
  - OQ-Q (open): the engine's P is the mean opening *balance*; the workbook's is the mean opening
    *principal* (column E). With fees > 0 the APRs differ; both are recorded, the engine's is
    `cob_rate_pct_engine_p` and the workbook's `cob_rate_pct_workbook_p`.

OQ-W interim vector (no workbook equivalent, the workbook has no IN-11 input): today's rule,
section 7.5 of COB-user-stories.md. While IN-11 accrued interest is outstanding, every shortfall
is carried with it OUTSIDE the balance: the balance stays at loanAmount, each period's interest
is loanAmount x getRate (no compounding), IN-11 is never paid, and total interest counts
interest only as far as it is paid (0 here). Modelled directly below, NOT a VBA transliteration.

Writes ca_oqy_zero_payment_vectors.json. Run: python3 generate_oqy_zero_payment_vectors.py
"""
import json
import os
from datetime import date

import generate_t5_engine_rules as g

HERE = os.path.dirname(os.path.abspath(__file__))


def oracle_scenario(sid):
    sc = json.load(open(os.path.join(HERE, 'ca_oracle_scenarios.json')))['scenarios']
    return next(s for s in sc if s['inputs']['id'] == sid)


def request(inp, product='personalLoan', rate_type='fixed', fees=None):
    return {'flow': 'newMortgageOrLoan', 'productType': product, 'rateType': rate_type,
            'loanAmount': inp['loan'], 'contractRatePercent': inp['rate'], 'paymentAmount': inp['pay'],
            'paymentFrequency': inp['freq'], 'firstPaymentDate': inp['first'], 'endDate': inp['end'],
            'termYears': 1, 'termMonths': 0, 'fees': {'fees': fees or []}, 'disbursalDate': inp['disb']}


def financed(x):
    return {'name': 'Admin', 'amount': x, 'financed': True, 'includedInCob': True}


def non_financed(x):
    return {'name': 'Appraisal', 'amount': x, 'financed': False, 'includedInCob': True}


def new_loan_vector(vid, what, inp, rate_pct, product='personalLoan', non_fin=0.0):
    rows, t = g.run(dict(inp, nonfin=0), rate_pct)
    fees = ([financed(inp['fin'])] if inp['fin'] else []) + ([non_financed(non_fin)] if non_fin else [])
    all_fees = inp['fin'] + non_fin
    cob = t['total_interest'] + all_fees
    years = t['term_days'] / 365
    p_engine = sum(r['open_loan'] for r in rows) / len(rows)
    p_workbook = sum(r['open_principal'] for r in rows) / len(rows)
    if all_fees == 0:
        apr_engine = apr_workbook = rate_pct
    else:
        apr_engine = cob / (p_engine * years) * 100
        apr_workbook = cob / (p_workbook * years) * 100
        if non_fin == 0:
            assert apr_workbook == t['cob_rate'], (vid, apr_workbook, t['cob_rate'])
    last = rows[-1]
    return {
        'id': vid, 'what': what, 'inputs': dict(inp, non_fin=non_fin), 'converted_rate_pct': rate_pct,
        'request': request(inp, product=product, fees=fees),
        'totals': {'n': t['n'], 'term_days': t['term_days'], 'total_payment': t['total_payment'],
                   'total_interest': t['total_interest'], 'total_interest_paid': t['total_interest_paid'],
                   'cob_amount': cob, 'avg_opening_balance_engine_p': p_engine,
                   'avg_opening_principal_workbook_p': p_workbook,
                   'cob_rate_pct_engine_p': apr_engine, 'cob_rate_pct_workbook_p': apr_workbook,
                   'ending_balance': last['close_loan'], 'unpaid_interest_at_end': last['unpaid_int_close'],
                   'fees_recovered': 0, 'principal_payment': 0},
        'rows': rows,
    }


def oqw_interim_vector():
    inp = {'loan': 50000, 'rate': 8.0, 'freq': 'monthly', 'renewal': '2026-01-01', 'first': '2026-02-01',
           'end': '2026-06-01', 'pay': 0, 'accrued_interest': 250.0}
    rows = []
    start = date.fromisoformat(inp['renewal'])
    first = date.fromisoformat(inp['first'])
    end = date.fromisoformat(inp['end'])
    carried = inp['accrued_interest']
    k = 0
    while True:
        d = g.date_add_m(first, k)
        if d > end:
            break
        new_int = inp['loan'] * g.get_rate(inp['rate'] / 100, start, d)
        rows.append({'n': k + 1, 'date': d.isoformat(), 'days': (d - start).days, 'open_loan': inp['loan'],
                     'carried_open': carried, 'new_int': new_int, 'payment': 0, 'interest_paid': 0,
                     'fees_paid': 0, 'principal_paid': 0, 'carried_close': carried + new_int,
                     'close_loan': inp['loan']})
        carried = carried + new_int
        start = d
        k += 1
    req = {'flow': 'renewal', 'productType': 'personalLoan', 'rateType': 'fixed', 'loanAmount': inp['loan'],
           'contractRatePercent': inp['rate'], 'paymentAmount': 0, 'paymentFrequency': 'monthly',
           'renewalDate': inp['renewal'], 'firstPaymentDate': inp['first'], 'endDate': inp['end'],
           'termYears': 1, 'termMonths': 0, 'fees': {'fees': []}, 'accruedInterest': inp['accrued_interest']}
    return {'id': 'W0_oqw_interim_renewal_in11', 'model': 'OQ-W interim (section 7.5), not a VBA transliteration',
            'inputs': inp, 'request': req,
            'totals': {'n': len(rows), 'term_days': (date.fromisoformat(rows[-1]['date']) - date(2026, 1, 1)).days,
                       'total_payment': 0, 'total_interest': 0, 'cob_amount': 0, 'cob_rate_pct': inp['rate'],
                       'ending_balance': inp['loan'], 'carried_at_end': carried},
            'rows': rows}


if __name__ == '__main__':
    checked = g.trust_check()
    s6 = oracle_scenario('S6_underpay')
    assert s6['inputs']['freq'] == 'weekly' and s6['inputs']['rate'] == 3.74  # fixed mortgage, m = 2
    mort_weekly_374 = s6['converted_rate_pct']
    base = dict(loan=100000, fin=0, rate=12.0, freq='monthly', disb='2026-01-01', first='2026-02-01',
                end='2026-05-01', pay=0)
    vectors = [
        new_loan_vector('Z0_no_fees_monthly', '$100k personal loan, 12%, monthly, $0 payment, 4 rows, no fees '
                        '(APR short-circuit = calculated rate)', base, 12.0),
        new_loan_vector('Z1_financed_fee_monthly', 'Z0 with a $1,000 financed fee inside the $100k', dict(base, fin=1000),
                        12.0),
        new_loan_vector('Z1b_financed_and_non_financed', 'Z1 plus a $500 non-financed fee (OQ-S: C only)',
                        dict(base, fin=1000), 12.0, non_fin=500.0),
        new_loan_vector('Z2_mortgage_weekly_into_leap', 'fixed mortgage 3.74% (weekly calculated rate from S6), '
                        '$0 payment, weekly across Jan 1 2028 (leap), no fees',
                        dict(loan=227829.65, fin=0, rate=3.74, freq='weekly', disb='2027-11-26', first='2027-12-03',
                             end='2028-03-03', pay=0), mort_weekly_374, product='mortgage'),
    ]
    z0 = vectors[0]
    assert round(z0['totals']['ending_balance'], 2) == 104003.92, z0['totals']['ending_balance']
    vectors[3]['request']['semiAnnualCompoundingDate'] = vectors[3]['request']['disbursalDate']
    out = {'source': 'QA oracle generate_oqy_zero_payment_vectors.py via generate_t5_engine_rules.calculate_all '
                     '(CalculateAll transliteration), trust-checked exactly against ' + ', '.join(checked),
           'tolerance_rel': 1e-9, 'vectors': vectors, 'oqw_interim': oqw_interim_vector()}
    with open(os.path.join(HERE, 'ca_oqy_zero_payment_vectors.json'), 'w') as f:
        json.dump(out, f, indent=1)
        f.write('\n')
    for v in vectors:
        print(v['id'], {k: v['totals'][k] for k in ('n', 'ending_balance', 'cob_amount', 'cob_rate_pct_engine_p',
                                                     'cob_rate_pct_workbook_p')})
    print('W0', out['oqw_interim']['totals'])
