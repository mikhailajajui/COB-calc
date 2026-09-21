"""
Date helpers matching JavaScript's Date.setMonth/setDate overflow semantics, so a
port of the payment-date math produces the same calendar dates as the TS engine.

JS's Date field overflow rule: constructing/mutating a date with an out-of-range
day-of-month rolls forward by the excess (e.g. Jan 31 + 1 month -> Feb has 28/29
days -> the extra days spill into March). That's equivalent to: take the 1st of
the target month, then add (original_day - 1) days.
"""

from datetime import date, timedelta


def add_months(d: date, months: int) -> date:
    total_months = d.year * 12 + (d.month - 1) + months
    year, month0 = divmod(total_months, 12)
    first_of_target_month = date(year, month0 + 1, 1)
    return first_of_target_month + timedelta(days=d.day - 1)


def add_days(d: date, days: int) -> date:
    return d + timedelta(days=days)
