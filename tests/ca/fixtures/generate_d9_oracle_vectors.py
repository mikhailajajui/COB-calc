"""Regenerate d9_oracle_vectors.json (spec 011 I-011-12, and the I-011-1 cross-check).

Runs the read-only macro oracle COB-py/tests/fixtures/macro_oracle.py (`calculate_all`)
with non_fin_fee=0, i.e. financed fees only, where 011 "D9 / D8" says app/engine must
match the macro row by row. NOT a live macro run.

Run from this directory: python3 generate_d9_oracle_vectors.py
"""
import json
import os
import sys
from datetime import date

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "../../../../COB-py/tests/fixtures"))
from macro_oracle import calculate_all, converter  # noqa: E402

ROW_FIELDS = ["n", "date", "open_loan", "open_fees", "new_int", "payment", "interest_paid",
              "fees_paid", "principal_paid", "close_fees", "close_loan"]

CASES = [
    {
        "id": "P1_financed_only",
        "note": "011 P1 with the non-financed Appraisal fee removed (personal loan: m = n = 12)",
        "request": {
            "flow": "newMortgageOrLoan", "productType": "personalLoan", "rateType": "fixed",
            "loanAmount": 10000, "contractRatePercent": 6, "paymentAmount": 500,
            "paymentFrequency": "monthly", "disbursalDate": "2026-01-01",
            "firstPaymentDate": "2026-02-01", "endDate": "2026-12-01", "termYears": 1, "termMonths": 0,
            "fees": {"fees": [{"name": "Admin", "amount": 300, "financed": True, "includedInCob": True}]},
        },
        "oracle": {"loan": 10000, "fin": 300, "rate": converter(6, 12, 12), "vfreq": "Monthly",
                   "disb": "2026-01-01", "first": "2026-02-01", "end": "2026-12-01", "pay": 500},
    },
    {
        "id": "S1_financed_only",
        "note": "ca_oracle_scenarios.json S1_fees with the non-financed fee set to 0 (fixed mortgage: m = 2, n = 52)",
        "request": {
            "flow": "newMortgageOrLoan", "productType": "mortgage", "rateType": "fixed",
            "loanAmount": 227829.65, "contractRatePercent": 3.74, "paymentAmount": 465.46,
            "paymentFrequency": "weekly", "firstPaymentDate": "2026-03-23", "endDate": "2029-03-17",
            "termYears": 1, "termMonths": 0,
            "fees": {"fees": [{"name": "Financed fees", "amount": 2000, "financed": True, "includedInCob": True}]},
            "disbursalDate": "2026-03-17", "semiAnnualCompoundingDate": "2026-03-17",
        },
        "oracle": {"loan": 227829.65, "fin": 2000, "rate": converter(3.74, 2, 52), "vfreq": "Accelerated Weekly",
                   "disb": "2026-03-17", "first": "2026-03-23", "end": "2029-03-17", "pay": 465.46},
    },
]

# I-011-1: P1 as recorded in 011, i.e. P1_financed_only plus a 200 non-financed fee.
# DQ-27: N enters only C and the COB rate, so the schedule is P1_financed_only's.
P1_NON_FINANCED = 200


def run(o):
    return calculate_all(o["loan"], o["fin"], 0, o["rate"], o["vfreq"], date.fromisoformat(o["disb"]),
                         1, date.fromisoformat(o["first"]), date.fromisoformat(o["end"]), o["pay"])


def main():
    out = {
        "source": "COB-py/tests/fixtures/macro_oracle.py calculate_all(..., non_fin_fee=0, ...), NOT a live macro run",
        "generated_by": "cd app/engine/tests/fixtures && python3 generate_d9_oracle_vectors.py",
        "tolerance_rel": 1e-9,
        "cases": [],
    }
    for c in CASES:
        res = run(c["oracle"])
        rows = [{k: r[k] for k in ROW_FIELDS} for r in res["rows"]]
        t = res["totals"]
        case = {
            "id": c["id"], "note": c["note"], "request": c["request"],
            "oracle_inputs": {**c["oracle"], "non_fin_fee": 0, "term_yr": 1},
            "totals": {"n": t["n"], "total_payment": t["total_payment"], "total_interest": t["total_interest"],
                       "term_days": t["term_days"], "ending_balance": rows[-1]["close_loan"]},
            "rows": rows,
        }
        if c["id"] == "P1_financed_only":
            fin = c["oracle"]["fin"]
            avg_open_loan = sum(r["open_loan"] for r in rows) / len(rows)
            cob = t["total_interest"] + fin + P1_NON_FINANCED
            case["p1_with_non_financed_200"] = {
                "how": "C = oracle total_interest + F + N; P = mean of oracle open_loan (011 keeps "
                       "equation 7's average opening balance, not the macro's principal average, 008 B3); "
                       "cob_rate_pct = C / ((term_days / 365) * P) * 100",
                "cob_amount": cob,
                "avg_opening_balance": avg_open_loan,
                "cob_rate_pct": cob / ((t["term_days"] / 365) * avg_open_loan) * 100,
            }
        out["cases"].append(case)
    with open(os.path.join(HERE, "d9_oracle_vectors.json"), "w") as f:
        json.dump(out, f, indent=1)
        f.write("\n")


if __name__ == "__main__":
    main()
