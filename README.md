# COB Calculator

A cost-of-borrowing / segmented mortgage calculator engine, implemented three
times, independently, and cross-validated row-for-row against each other:
renewals, lump sums, manual bank-statement overrides, PMI with auto-drop,
interest-only, balloon payments, points, refinance/loan-term comparison,
DTI/affordability, fees & APR, and payment-frequency schedules.

**Live site:** https://mikhailajajui.github.io/COB-calc/ — a portal linking to
all three variants below.

| Variant | Where it runs | Source |
|---|---|---|
| **Web Calculator** | GitHub Pages, client-side | [`COB-ts/`](COB-ts) |
| **Streamlit App** | Streamlit Community Cloud ([deploy status](#deploying-the-streamlit-app)) | [`COB-py/`](COB-py) |
| **Excel Workbook** | Download, or read the manual on GitHub Pages | [`COB-xlsx/`](COB-xlsx) |

## Repository layout

- **`COB-ts/`** — the original engine, in TypeScript, with a browser worksheet UI (`COB-ts/ui/`). `npm test` (vitest, 90 tests).
- **`COB-py/`** — a from-scratch Python port with a 14-page Streamlit UI (`COB-py/streamlit_app.py` + `COB-py/pages/`), plus features not yet ported back to TS (yearly report window, fees/APR, DTI/affordability) and a cross-check against an independent lending-domain reference model. `python3 -m pytest` (100 tests).
- **`COB-xlsx/`** — a formula-driven Excel workbook (no macros), built by `COB-xlsx/build_workbook.py`. See [`COB-xlsx/MANUAL.md`](COB-xlsx/MANUAL.md) for usage.
- **`docs/new-req/`** — platform-agnostic specs for features found via a banking-domain QA pass, plus write-ups of real bugs caught during development (and how they were caught) for each implementation.
- **`site/`** — source for the portal page published at the repo root of GitHub Pages.

## Deploying the Streamlit app

Not yet deployed. To deploy:

1. Push this repo to GitHub (if not already).
2. Go to [share.streamlit.io](https://share.streamlit.io), sign in, and connect this repository.
3. Set the app file to `COB-py/streamlit_app.py`.
4. Deploy, then copy the resulting URL into `STREAMLIT_URL` near the bottom of [`site/index.html`](site/index.html) and push — the portal's Streamlit card goes live automatically.

## Running things locally

```bash
# TypeScript engine + browser UI
cd COB-ts && npm ci && npm test && npm run ui

# Python engine + Streamlit UI
cd COB-py && pip install -r requirements.txt && python3 -m pytest && streamlit run streamlit_app.py

# Excel workbook (regenerate from source)
cd COB-xlsx && python3 build_workbook.py
```

All figures across all three variants are estimates for planning purposes only, not financial advice.
