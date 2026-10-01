"""B2 (012 D-08, OQ-M) fee-limit vectors: financed + non-financed fees must be < Loan Amount.

Oracle: a line-for-line transliteration of the workbook macro ValidateInput, lines 151-185 of
reference/workbook-macro-source.txt (LOANAMOUNT / FINANCEDREQUIREDFEES / NONFINANCEDREQUIREDFEES
IsNumeric checks, then "check if the fees are greater than the loan"). NOT a live macro run and
NOT the engine. VBA Variants holding cell Doubles add and compare as IEEE-754 doubles, as Python
floats do.

Mapping from the engine's fee list to the workbook's two cells (the only mapping the workbook
allows): finFee = left-to-right sum of the financed fees, nonFinFee = left-to-right sum of the
non-financed fees (B1 / OQ-H: unrounded plain sums). The limit then evaluates (finFee + nonFinFee),
in that order, as the macro does.

Run: cd COB-ts/tests/ca/fixtures && python3 generate_b2_fee_limit_vectors.py
"""
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))


def is_numeric(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def macro_validate_fees(loan_amt, fin_fee, non_fin_fee):
    """Transliteration of macro lines 151-185. Returns (fees_valid, fee_error_message_or_None)."""
    # 'validate LOANAMOUNT
    is_loanamount_valid = is_numeric(loan_amt)
    # 'validate FINANCEDREQUIREDFEES
    is_fin_valid = is_numeric(fin_fee)
    # 'validate NONFINANCEDREQUIREDFEES
    is_nonfin_valid = is_numeric(non_fin_fee)
    msg = None
    # 'check if the fees are greater than the loan
    if is_nonfin_valid and is_fin_valid:
        if (fin_fee + non_fin_fee) >= loan_amt:
            msg = 'Total Fees must be less than the Loan Amount'
            is_fin_valid = False
            is_nonfin_valid = False
    return (is_loanamount_valid and is_fin_valid and is_nonfin_valid), msg


def lsum(xs):
    t = 0.0
    for x in xs:
        t += x
    return t


def fee(amount, financed, i):
    return {'name': ('Fin' if financed else 'Cash') + str(i), 'amount': amount, 'financed': financed,
            'includedInCob': True}


def case(cid, loan, fees, today_accepts, note):
    fin = lsum([a for a, f in fees if f])
    cash = lsum([a for a, f in fees if not f])
    ok, msg = macro_validate_fees(loan, fin, cash)
    assert today_accepts == (fin < loan), cid  # today's rule: financed only, strict <
    return {'id': cid, 'loanAmount': loan, 'fees': [fee(a, f, i) for i, (a, f) in enumerate(fees)],
            'macro_fin_fee': fin, 'macro_non_fin_fee': cash, 'macro_sum': fin + cash,
            'list_order_sum': lsum([a for a, _ in fees]), 'accept': ok, 'macro_message': msg,
            'accepted_before_b2': today_accepts, 'red_before_b2': ok != today_accepts, 'note': note}


F, C = True, False
CASES = [
    # cash-only over / at / under the limit
    case('C1_cash_over', 1000, [(1500, C)], True, 'cash only, above the loan'),
    case('C2_cash_equal', 1000, [(1000, C)], True, 'cash only, equal to the loan (>= rejects)'),
    case('C3_cash_just_below', 1000, [(999.99, C)], True, 'cash only, 1 cent below'),
    case('C4_two_cash_cross', 1000, [(600, C), (400.01, C)], True, 'two cash fees summing above the loan'),
    # financed + cash crossing the boundary
    case('M1_mixed_over', 1000, [(600, F), (400.01, C)], True, 'financed + cash, 1 cent over'),
    case('M2_mixed_equal', 1000, [(600, F), (400, C)], True, 'financed + cash == loan'),
    case('M3_mixed_below', 1000, [(600, F), (399.99, C)], True, 'financed + cash, 1 cent under'),
    case('M4_big_cash_small_fin', 1000, [(999.99, F), (5000, C)], True, 'validate.test.ts:186 input'),
    # B1 (OQ-H) unrounded sums, sub-cent
    case('U1_subcent_equal', 1000, [(999.996, F), (0.004, C)], True,
         '999.996 + 0.004 == 1000.0 exactly -> reject'),
    case('U2_subcent_below', 1000, [(999.995, F), (0.004, C)], True,
         'unrounded 999.999 < 1000 -> accept (a round2 sum would give 1000.00 and reject)'),
    case('U3_cash_subcent_equal', 1000.004, [(1000.004, C)], True, 'cash only == sub-cent loan'),
    case('U4_cash_subcent_below', 1000.004, [(1000.003, C)], True, 'cash only 0.001 below a sub-cent loan'),
    case('U5_float_sum_over', 1000.3, [(1000.1, F), (0.2, C)], True,
         '1000.1 + 0.2 == 1000.3000000000001 > 1000.3 -> reject (float sum, as Excel)'),
    # grouping: macro is (sum financed) + (sum cash), not the list-order sum of all fees
    case('G1_grouping_reject', 1007.74, [(998.14, F), (8.613, C), (0.987, F)], True,
         '(998.14+0.987)+8.613 == 1007.74 -> reject; list order gives 1007.7399999999999 (< loan)'),
    case('G2_grouping_accept', 1007.62, [(998.27, F), (8.488, C), (0.862, F)], True,
         '(998.27+0.862)+8.488 == 1007.6199999999999 -> accept; list order gives 1007.62 (== loan)'),
    # valid combinations stay accepted (golden fee sets on $250k, plus financed-only boundary)
    case('V1_none', 250000, [], True, 'golden fee set none'),
    case('V2_fin2000', 250000, [(2000, F)], True, 'golden fee set fin2000'),
    case('V3_fin2000_cash400', 250000, [(2000, F), (400, C)], True, 'golden fee set fin2000cash400'),
    case('V4_fin_just_below', 1000, [(999.99, F)], True, 'financed only, 1 cent under'),
    case('V5_financed_equal', 1000, [(1000, F)], False, 'financed only == loan: rejected before and after'),
]


def trust_check():
    """The oracle must reproduce the known expectations before it is trusted."""
    # 012 D-08 "Expected" (defects012.test.ts): 600 fin + 600 cash, and 500 + 500 == loan, reject.
    assert macro_validate_fees(1000, 600.0, 600.0)[0] is False
    assert macro_validate_fees(1000, 500.0, 500.0)[0] is False
    # b1_unrounded_fee_vectors.json fee_limit cases (financed only, so nonFinFee = 0)
    with open(os.path.join(HERE, 'b1_unrounded_fee_vectors.json')) as f:
        b1 = json.load(f)
    for c in b1['fee_limit']['cases']:
        assert macro_validate_fees(c['loanAmount'], lsum(c['financed']), 0.0)[0] == c['accept'], c['id']
    return ['012 D-08 x2', 'b1 fee_limit x%d' % len(b1['fee_limit']['cases'])]


def main():
    checked = trust_check()
    out = {
        'source': 'macro ValidateInput lines 151-185 transliteration (this file); NOT a live macro run, '
                  'NOT the engine',
        'rule': 'OQ-M: reject when (sum financed + sum non-financed) >= loanAmount; accept when strictly less',
        'trust_check': checked,
        'generated_by': 'cd COB-ts/tests/ca/fixtures && python3 generate_b2_fee_limit_vectors.py',
        'base_request': {
            'flow': 'newMortgageOrLoan', 'productType': 'personalLoan', 'rateType': 'fixed',
            'contractRatePercent': 6.0, 'paymentAmount': 500, 'paymentFrequency': 'monthly',
            'disbursalDate': '2026-01-01', 'firstPaymentDate': '2026-02-01', 'endDate': '2026-12-01',
            'termYears': 1, 'termMonths': 0,
        },
        'cases': CASES,
    }
    with open(os.path.join(HERE, 'b2_fee_limit_vectors.json'), 'w') as f:
        json.dump(out, f, indent=1)
        f.write('\n')
    print('trust check:', checked)
    for c in CASES:
        print(c['id'], 'accept' if c['accept'] else 'reject', 'RED' if c['red_before_b2'] else 'green',
              repr(c['macro_sum']))


if __name__ == '__main__':
    main()
