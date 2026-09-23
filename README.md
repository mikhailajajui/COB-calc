# COB Calculator (Canada)

A replacement for Alterna Savings' Excel/VBA **Canadian Cost of Borrowing (COB)
calculator**: COB amount, COB rate, payment schedule and trigger rate for
mortgages and personal loans (New, Renewal, Payment Change, Variable Rate
Payment Change). It is built three times from one spec and checked against the
legacy workbook.

**Live site:** https://mikhailajajui.github.io/COB-calc/ — a portal linking to
all three variants below.

| Variant | Where it runs | Source |
|---|---|---|
| **Web Calculator** | GitHub Pages (`/ts/`), client-side | [`COB-ts/src/ca/`](COB-ts/src/ca), UI [`COB-ts/ui/ca.html`](COB-ts/ui/ca.html) |
| **Streamlit App** | [cob-calc.streamlit.app](https://cob-calc.streamlit.app/), opens on the Canadian calculator | [`COB-py/cob_calculator/cob_canada.py`](COB-py/cob_calculator/cob_canada.py) |
| **Excel Workbook** | Download `COB_Calculator_CA.xlsx` | [`COB-xlsx/build_workbook_ca.py`](COB-xlsx/build_workbook_ca.py) |

## Repository layout

- **`docs/`** — [`architecture.md`](docs/architecture.md), the engine spec
  ([`006`](docs/new-req/006-cost-of-borrowing-disclosure.md)), its
  reconciliation against the BRD and the macro (`007`), and open items (`008`).
  Status: [`docs/new-req/README.md`](docs/new-req/README.md).
- **`COB-ts/`**, **`COB-py/`**, **`COB-xlsx/`** — the three implementations.
- **`COB-py/tests/fixtures/`** — shared reference vectors and a test-only
  transliteration of the legacy macro.
- **`site/`** — the portal page published at the root of GitHub Pages.
- **Legacy:** an older US-style mortgage engine lives in the rest of `COB-ts/src/`,
  `COB-py/cob_calculator/` and `COB-xlsx/build_workbook.py`. It is no longer
  developed or linked from the UIs; its pages still answer at their old URLs (web
  `/ts/us/`, Streamlit `/Loan_Calculator` etc.) and `COB_Calculator.xlsx` is still built.

## Running things locally

```bash
# TypeScript engine + browser UI (opens on the Canadian calculator)
cd COB-ts && npm ci && npm test && npm run ui

# Python engine + Streamlit UI (opens on the Canadian calculator)
cd COB-py && pip install -r requirements.txt && python3 -m pytest && streamlit run streamlit_app.py

# Excel workbook (regenerate from source)
cd COB-xlsx && python3 build_workbook_ca.py
```

All figures across all three variants are estimates for planning purposes only,
not financial advice, and not a certified regulatory disclosure.
