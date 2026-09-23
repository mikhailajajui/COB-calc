"""Test-only oracle: line-for-line transliteration of the legacy VBA macro
(Calculator sheet module: CalculateAll, getRate, crossesLeapYear, daysInYear,
getNextWeekly/Biweekly/SemiMonthly/Monthly/EOM). No improvements.
`annual_rate_pct` is the macro's D10 input (the ALREADY-CONVERTED calculated rate).
"""
from datetime import date, timedelta
import calendar


def date_add_m(d, k):  # VBA DateAdd("m", k, d): clamps day to month end
    t = d.year * 12 + (d.month - 1) + k
    y, m0 = divmod(t, 12)
    last = calendar.monthrange(y, m0 + 1)[1]
    return date(y, m0 + 1, min(d.day, last))


def date_serial(y, m, d):  # VBA DateSerial rolls over
    t = y * 12 + (m - 1)
    yy, m0 = divmod(t, 12)
    return date(yy, m0 + 1, 1) + timedelta(days=d - 1)


def ddiff(a, b):
    return (b - a).days


def days_in_year(d):
    return ddiff(date_serial(d.year, 1, 1), date_serial(d.year + 1, 1, 1))


def is_in_leap_year(d):
    return days_in_year(d) == 366


def crosses_leap_year(s, e):
    s_leap = is_in_leap_year(s)
    for y in range(s.year, e.year + 1):
        if s_leap ^ is_in_leap_year(date_serial(y, 1, 1)):
            return True
    return False


def get_rate(annual, s, e):
    if crosses_leap_year(s, e):
        sy, ey = s.year, e.year
        mixed = 0
        for y in range(sy, ey + 1):
            if y == sy:
                part = annual * ddiff(s, date_serial(sy + 1, 1, 1)) / days_in_year(s)
            elif y == ey:
                part = annual * ddiff(date_serial(ey, 1, 1), e) / days_in_year(e)
            else:
                part = annual
            mixed = mixed + part
        return mixed
    return annual * ddiff(s, e) / days_in_year(s)


def next_weekly(cur):
    return cur + timedelta(days=7)


def next_biweekly(first, cur):
    g = first
    while not (g > cur):
        g = g + timedelta(days=14)
    return g


def next_eom(cur):
    g = cur
    while not (g > cur):
        g = g + timedelta(days=1)
        g = date_add_m(g, 1)
        g = date_serial(g.year, g.month, 1)
        g = g - timedelta(days=1)
    return g


def next_semimonthly(first, cur):
    day1 = first.day
    first_eom = next_eom(first - timedelta(days=1))
    is_eom = (first_eom == first) or (day1 == 15)
    if day1 >= 15:
        day1 = day1 - 15
    curr_day = cur.day
    curr_eom = next_eom(cur - timedelta(days=1))
    if cur == curr_eom and is_eom:
        g = date_add_m(cur, 1)
        g = date_serial(g.year, g.month, 15)
    elif curr_day == 15 and is_eom:
        g = curr_eom
    elif curr_day > 15:
        g = date_add_m(cur, 1)
        g = date_serial(g.year, g.month, day1)
    else:
        nd = cur + timedelta(days=15)
        if nd > curr_eom:
            nd = curr_eom
        g = nd
    return g


def next_monthly(first, cur):
    g = first
    mths = 0
    while not (g > cur):
        g = date_add_m(first, mths)
        mths += 1
    return g


def calculate_all(loan_amt, fin_fee, non_fin_fee, annual_rate_pct, pay_freq, disb_date,
                  term_yr, first_pymt_date, e_date, pymt_amnt):
    a_rate = annual_rate_pct / 100
    start = disb_date
    closing = first_pymt_date
    opening_balance = loan_amt
    curr_principle = loan_amt - fin_fee - non_fin_fee
    curr_fees = fin_fee + non_fin_fee
    int_accrued = 0
    total_interest_paid = 0
    total_opening_principle = 0
    total_payment = 0
    is_first = True
    count = 0
    rows = []
    while True:
        nxt = closing
        if not is_first:
            if pay_freq in ("Weekly", "Accelerated Weekly"):
                nxt = next_weekly(start)
            elif pay_freq in ("Biweekly", "Accelerated Biweekly"):
                nxt = next_biweekly(first_pymt_date, start)
            elif pay_freq == "Semi Monthly":
                nxt = next_semimonthly(first_pymt_date, start)
            elif pay_freq == "Monthly":
                nxt = next_monthly(first_pymt_date, start)
            else:
                nxt = date_add_m(start, 1)
            if e_date is None:
                check = ddiff(first_pymt_date, nxt) / 365 > (term_yr - (7 / 365))
            else:
                check = ddiff(e_date, nxt) > 0
            if check:
                break
        closing = nxt
        applied = get_rate(a_rate, start, closing)
        new_int = opening_balance * applied
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
        count += 1
        total_payment = total_payment + pymt_amnt
        rows.append(dict(n=count, date=closing.isoformat(), open_loan=opening_balance,
                         open_principal=curr_principle, open_fees=curr_fees, new_int=new_int,
                         total_int=int_accrued, payment=pymt_amnt, interest_paid=int_paid,
                         fees_paid=fees_paid, principal_paid=principle_paid, close_fees=new_fees,
                         close_principal=new_principle, close_loan=new_balance))
        start = closing
        total_opening_principle = total_opening_principle + curr_principle
        opening_balance = new_balance
        curr_principle = new_principle
        curr_fees = new_fees
        is_first = False
        if opening_balance <= 0:
            break
    term_day = ddiff(disb_date, closing)
    avg = total_opening_principle / count
    cob = int_accrued + fin_fee + non_fin_fee
    if fin_fee + non_fin_fee == 0:
        cob_rate = a_rate * 100
    else:
        cob_rate = (cob / (avg * (term_day / 365))) * 100
    return dict(rows=rows, totals=dict(cob_amount=cob, cob_rate=cob_rate, total_payment=total_payment,
                                       n=count, total_interest=int_accrued, term_days=term_day,
                                       avg_opening_principle=avg))


def converter(im_pct, m, n):  # Semi-Annual Rate Converter sheet / BRD 4.2
    return n * ((1 + im_pct / 100 / m) ** (m / n) - 1) * 100
