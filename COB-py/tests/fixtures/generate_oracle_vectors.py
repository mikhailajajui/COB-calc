"""Regenerate ca_oracle_scenarios.json from macro_oracle.py.

Run from this directory: python3 generate_oracle_vectors.py
"""
import json
from datetime import date

from macro_oracle import calculate_all, converter

N_BY_FREQ = {"weekly": 52, "biweekly": 26, "semiMonthly": 24, "monthly": 12}

SCENARIOS = [
    {"id": "S0_007", "loan": 227829.65, "fin": 0, "nonfin": 0, "rate": 3.74, "freq": "weekly", "vfreq": "Accelerated Weekly", "disb": "2026-03-17", "first": "2026-03-23", "end": "2029-03-17", "pay": 465.46},
    {"id": "S1_fees", "loan": 227829.65, "fin": 2000, "nonfin": 500, "rate": 3.74, "freq": "weekly", "vfreq": "Accelerated Weekly", "disb": "2026-03-17", "first": "2026-03-23", "end": "2029-03-17", "pay": 465.46},
    {"id": "S2_monthly_jan31", "loan": 100000, "fin": 0, "nonfin": 0, "rate": 5.0, "freq": "monthly", "vfreq": "Monthly", "disb": "2027-01-15", "first": "2027-01-31", "end": "2028-01-31", "pay": 1000},
    {"id": "S3_leap_weekly", "loan": 200000, "fin": 0, "nonfin": 0, "rate": 4.5, "freq": "weekly", "vfreq": "Weekly", "disb": "2027-12-20", "first": "2027-12-27", "end": "2029-01-15", "pay": 900},
    {"id": "S4_semimonthly", "loan": 150000, "fin": 0, "nonfin": 0, "rate": 4.0, "freq": "semiMonthly", "vfreq": "Semi Monthly", "disb": "2026-03-01", "first": "2026-03-15", "end": "2027-03-15", "pay": 600},
    {"id": "S5_payoff", "loan": 5000, "fin": 0, "nonfin": 0, "rate": 6.0, "freq": "monthly", "vfreq": "Monthly", "disb": "2026-01-01", "first": "2026-02-01", "end": "2027-02-01", "pay": 1000},
    {"id": "S6_underpay", "loan": 227829.65, "fin": 0, "nonfin": 0, "rate": 3.74, "freq": "weekly", "vfreq": "Weekly", "disb": "2026-03-17", "first": "2026-03-23", "end": "2026-06-30", "pay": 100},
    {"id": "S7_biweekly", "loan": 227829.65, "fin": 0, "nonfin": 0, "rate": 3.74, "freq": "biweekly", "vfreq": "Biweekly", "disb": "2026-03-17", "first": "2026-03-23", "end": "2029-03-17", "pay": 930.92},
    {"id": "S8_10y_weekly", "loan": 300000, "fin": 0, "nonfin": 0, "rate": 4.0, "freq": "weekly", "vfreq": "Weekly", "disb": "2026-01-01", "first": "2026-01-08", "end": "2036-01-01", "pay": 500},
    {"id": "S9_fees_payoff", "loan": 5000, "fin": 300, "nonfin": 200, "rate": 6.0, "freq": "monthly", "vfreq": "Monthly", "disb": "2026-01-01", "first": "2026-02-01", "end": "2027-02-01", "pay": 1000},
]


def main():
    out = {
        "source": "macro_oracle.py (VBA transliteration), NOT a live macro run. Rates: contract rate at m=2 converted to the frequency's n.",
        "scenarios": [],
    }
    for s in SCENARIOS:
        d = date.fromisoformat
        rate = converter(s["rate"], 2, N_BY_FREQ[s["freq"]])
        result = calculate_all(s["loan"], s["fin"], s["nonfin"], rate, s["vfreq"], d(s["disb"]), 1,
                               d(s["first"]), d(s["end"]), s["pay"])
        out["scenarios"].append({"inputs": s, "converted_rate_pct": rate, **result})
    with open("ca_oracle_scenarios.json", "w") as f:
        json.dump(out, f, indent=1)


if __name__ == "__main__":
    main()
