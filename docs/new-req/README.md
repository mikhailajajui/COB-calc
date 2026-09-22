# New Requirements (cross-platform specs)

Platform-agnostic specs for features identified in a banking-domain QA pass over
the COB engine (both `COB-ts` and `COB-py`). Each spec is written so any
implementation (TypeScript, Python, or otherwise) can build the same behavior
from it, independent of language.

Reference implementation status is tracked per spec. As of this writing, the
reference implementation lives in `COB-py` (`cob_calculator/`); `COB-ts` parity
is not yet ported.

| # | Spec | Status |
|---|------|--------|
| 001 | [Yearly summary & N-year report window](001-yearly-summary-report-window.md) | Implemented in COB-py |
| 002 | [Fees & APR](002-fees-and-apr.md) | Implemented in COB-py |
| 003 | [DTI & affordability](003-dti-and-affordability.md) | Implemented in COB-py |
| 004 | [Rounding-drift accuracy disclosure](004-rounding-drift-accuracy-disclosure.md) | Documented; in-app warnings added |
| 005 | [Excel workbook (full segmented engine)](005-excel-workbook.md) | Implemented in COB-xlsx |
| 006 | [Cost of Borrowing (COB) disclosure: mortgage & loan workflows](006-cost-of-borrowing-disclosure.md) | Implemented in COB-xlsx (`COB_Calculator_CA.xlsx`, sibling workbook), COB-py (`cob_calculator/cob_canada.py`), and COB-ts (`src/ca/`) — full parity across all three engines |

## Background: gaps identified

A banking-domain QA pass (see conversation history / commit messages around
these specs) found these gaps against the existing engine, roughly in priority
order:

1. **Fees are invisible — no APR, no cash-to-close.** `compareLoanTerms` ranks
   offers by note rate only, which can pick the wrong "cheapest" loan when fees
   differ. → spec 002.
2. **No DTI or affordability calculator.** `dscr.ts` covers investment-property
   income coverage only; personal-mortgage underwriting runs on DTI (front-end
   ≤28%, back-end ≤36–43%), which didn't exist anywhere. → spec 003.
3. **No yearly summary / bounded-window reporting.** Getting "just the first 5
   years" required hand-building a bounded segment and reading
   `segment_summaries`; there was no annual rollup table (the natural container
   for year-by-year interest/principal/balance) anywhere. → spec 001.
4. FHA MIP vs. conventional PMI aren't distinguished (MIP doesn't auto-drop).
5. Recast vs. re-term after a lump sum isn't an explicit, labeled option.
6. Lump sums only land on segment boundaries, not mid-segment.
7. No "financed fee added to principal" primitive (VA funding fee, upfront MIP).
8. HELOC draws (balance increasing mid-schedule) aren't modeled.
9. No day-count / odd-days interest at origination (short first period).
10. No arbitrary-date payoff quote (per-diem interest to a requested date).

Items 4–10 are not yet speced or implemented; they're lower priority than 1–3
and are documented here so they aren't lost.
