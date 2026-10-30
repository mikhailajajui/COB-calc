"""Regenerate b11_waterfall_vectors.json (COB-architecture.md §5 B11, revision 6).

Test-only oracle. Two parts, both transliterated from the VBA macro with no improvements:

1. `macro_waterfall` -- CalculateAll's per-row allocation, reference/workbook-macro-source.txt
   lines 471-511 (pay interest, then fees, then principal; the payoff branch at 500-506 runs
   only when isMoneyLeft = moneyLeft > 0, lines 496-499). Interface mapping to the engine's
   applyPaymentWaterfall(periodInterestAmount, carriedAccruedInterestOpening, feesOpening,
   paymentAmount, principalOutstanding): the macro's `intAccrued - totalInterestPaid` is the
   engine's periodInterestAmount + carriedAccruedInterestOpening; currFees = feesOpening;
   pymtAmnt = paymentAmount; currPrinciple = principalOutstanding.

   The macro's currPrinciple is never negative: line 387 starts it at loanAmt - fees (>= 0
   under the fee limit), 500-506 pay at most currPrinciple, and 511 subtracts a value <= it
   (IEEE subtraction of y <= x is >= 0). So the macro-reachable value that the engine's
   float-noise cap stands for is 0 (the macro's own value in E1 is +2.27e-13, see part 2).
   W1-W3 and W5 are evaluated at currPrinciple = 0; W4 at the literal caps 0 and 5.

2. E1 through the archived full-loop oracle COB-py/tests/fixtures/macro_oracle.py
   (`calculate_all`, read-only, ~/Projects/cob_calculator). NOT a live macro run.
   Self-check before trusting it: it must reproduce d9_oracle_vectors.json P1 exactly, and
   `macro_waterfall` must reproduce every P1 row's payment/interest/fees/principal.

Run from this directory: python3 generate_b11_waterfall_vectors.py
"""
import json
import os
import sys
from datetime import date

HERE = os.path.dirname(os.path.abspath(__file__))
ARCHIVE = os.path.expanduser("~/Projects/cob_calculator/COB-py/tests/fixtures")
sys.path.insert(0, ARCHIVE)
from macro_oracle import calculate_all  # noqa: E402


def macro_waterfall(int_due, curr_fees, pymt_amnt, curr_principle):
    """Lines 471-511, verbatim control flow. int_due = intAccrued - totalInterestPaid."""
    money_left = pymt_amnt
    is_money_left = money_left > 0
    if is_money_left:
        if money_left >= int_due:
            int_paid = int_due
            money_left = money_left - int_paid
        else:
            int_paid = money_left
            money_left = 0
    else:
        int_paid = 0
    is_money_left = money_left > 0
    if is_money_left:
        if curr_fees >= money_left:
            fees_paid = money_left
            money_left = 0
        else:
            fees_paid = curr_fees
            money_left = money_left - fees_paid
    else:
        fees_paid = 0
    is_money_left = money_left > 0
    if is_money_left:
        if curr_principle >= money_left:
            principle_paid = money_left
            money_left = 0
        else:
            pymt_amnt = curr_principle
            principle_paid = curr_principle
            money_left = 0
    else:
        principle_paid = 0
    return dict(interestPaid=int_paid, feesPaid=fees_paid, principalPortion=principle_paid, amountPaid=pymt_amnt)


def self_check():
    d9 = json.load(open(os.path.join(HERE, "d9_oracle_vectors.json")))
    p1 = next(c for c in d9["cases"] if c["id"] == "P1_financed_only")
    o = p1["oracle_inputs"]
    r = calculate_all(o["loan"], o["fin"], o["non_fin_fee"], o["rate"], o["vfreq"], date.fromisoformat(o["disb"]),
                      o["term_yr"], date.fromisoformat(o["first"]), date.fromisoformat(o["end"]), o["pay"])
    shared = [k for k in p1["totals"] if k in r["totals"]]
    assert {"n", "total_payment", "total_interest", "term_days"} <= set(shared), shared
    for k in shared:
        v = p1["totals"][k]
        assert r["totals"][k] == v, ("calculate_all totals", k, r["totals"][k], v)
    for got, want in zip(r["rows"], p1["rows"]):
        for k, v in want.items():
            if k not in got:
                continue
            assert got[k] == v, ("calculate_all row", got["n"], k, got[k], v)
    assert len(r["rows"]) == len(p1["rows"])
    # macro_waterfall vs the full loop, row by row
    total_interest_paid = 0
    for row in r["rows"]:
        w = macro_waterfall(row["total_int"] - total_interest_paid, row["open_fees"], o["pay"], row["open_principal"])
        for k, src in (("interestPaid", "interest_paid"), ("feesPaid", "fees_paid"),
                       ("principalPortion", "principal_paid"), ("amountPaid", "payment")):
            assert w[k] == row[src], ("macro_waterfall", row["n"], k, w[k], row[src])
        total_interest_paid = total_interest_paid + row["interest_paid"]
    return len(r["rows"])


W = [
    # id, engine args (principalOutstanding as passed by the caller), macro currPrinciple
    ("W1", [10542.892225726024, 231328.09997504807, 859377.58, 0, -8.731149137020111e-11], 0.0),
    ("W2", [0.5, 0, 0, 0.26, -1e-12], 0.0),
    ("W3", [0.1, 0, 0, 0.26, -1e-12], 0.0),
    ("W4a", [0.1, 0, 0, 0.26, 0], 0.0),
    ("W4b", [0.1, 0, 0, 0.26, 5], 5.0),
    ("W5", [0.1, 0, 0, 0.26, -0.0], 0.0),
]


def main():
    p1_rows = self_check()
    out = {"source": "COB-architecture.md §5 B11 (rev 6); macro lines 387, 471-511, 541",
           "generated_by": "generate_b11_waterfall_vectors.py (transliterated macro oracle; E1 via archived "
                           "COB-py macro_oracle.calculate_all). Self-check: reproduces d9 P1 (%d rows) exactly." % p1_rows,
           "waterfall": [], "e1": None}
    for wid, args, cap in W:
        # engine's totalInterestDue = periodInterestAmount + carriedAccruedInterestOpening
        w = macro_waterfall(args[0] + args[1], args[2], args[3], cap)
        out["waterfall"].append({"id": wid, "args": args, "macro_curr_principle": cap,
                                 "expected": {k: w[k] for k in ("interestPaid", "feesPaid", "principalPortion", "amountPaid")}})
    r = calculate_all(2000.0000000000002, 2000, 0, 5.19, "Biweekly", date(2026, 12, 22), 1,
                      date(2027, 1, 1), date(2028, 1, 1), 0.25)
    out["e1"] = {
        "request": {"flow": "newMortgageOrLoan", "productType": "mortgage", "rateType": "variable",
                    "contractRatePercent": 5.19, "paymentFrequency": "biweekly", "paymentAmount": 0.25,
                    "loanAmount": 2000.0000000000002,
                    "fees": {"fees": [{"name": "F", "amount": 2000, "financed": True, "includedInCob": True}]},
                    "disbursalDate": "2026-12-22", "firstPaymentDate": "2027-01-01", "endDate": "2028-01-01",
                    "termYears": 1, "termMonths": 0},
        "oracle_inputs_note": "calculatedRatePercent 5.19 (variable mortgage, engine output) fed as the macro's aRate",
        "n": r["totals"]["n"],
        "total_payment": r["totals"]["total_payment"],
        "min_open_principal": min(x["open_principal"] for x in r["rows"]),
        "rows": [{k: x[k] for k in ("n", "date", "payment", "interest_paid", "fees_paid", "principal_paid")}
                 for x in r["rows"]],
    }
    with open(os.path.join(HERE, "b11_waterfall_vectors.json"), "w") as f:
        json.dump(out, f, indent=1)
        f.write("\n")
    print("ok", p1_rows, out["e1"]["n"], out["e1"]["total_payment"], out["e1"]["min_open_principal"])
    for w in out["waterfall"]:
        print(w["id"], w["expected"])


if __name__ == "__main__":
    main()
