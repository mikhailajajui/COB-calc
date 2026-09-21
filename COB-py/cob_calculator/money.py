"""
Rounding policy: rates and intermediate ratios are kept at full floating-point
precision. Only currency amounts that are actually paid/owed (a computed payment,
or a schedule row's interest/principal/balance) are rounded to cents via round2().
This mirrors how a real amortization table behaves -- balances are tracked in cents,
not fractional dollars -- while avoiding compounding rounding error into the rate
math itself.
"""

import math


def js_round(value: float) -> int:
    # Python's builtin round() is banker's rounding (round-half-to-even); JS's
    # Math.round() rounds half-up (floor(x + 0.5)). Used everywhere the TS engine
    # calls Math.round() on a non-currency value (e.g. months, day offsets).
    return math.floor(value + 0.5)


def round2(value: float) -> float:
    return js_round(value * 100) / 100
