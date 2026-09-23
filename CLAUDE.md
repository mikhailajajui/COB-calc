# cob-calculator — shared context for every session and agent

## Agent bindings

The agents in `.claude/agents/` are project-agnostic. This table binds their
generic terms to this project. To reuse the agents elsewhere, copy them and
write this table for the new project.

| Term | This project |
|---|---|
| Primary source (requirements) | `~/Downloads/COB Requirements v2.3.docx` — IDs IN-xx / OUT-xx / BR-xx / §n / B.n |
| Reference system | `~/Downloads/Cost of Borrowing Rate Calc_Current.xlsm` (VBA macro) — wins over the docx on arithmetic. Its rate input `Calculator!D10` is the **already-converted** rate, not the contract rate |
| Source extraction | docx: `textutil -convert txt -stdout "<path>"` · macro: `python3 -m oletools.olevba --decode -c "<path>"` · cells: `openpyxl.load_workbook(p, data_only=True, keep_vba=True)` |
| Spec directory | `docs/new-req/` (main spec: `006-*.md`; next number 010) |
| Architecture doc | `docs/architecture.md` |
| Open-items log | `docs/new-req/008-brd-validation-open-items.md` — one writer at a time, like the specs |
| Stakeholder | The BRD author named in the docx. Agents never contact them; questions go to the user as a list |
| Live macro runs | Only the user, in Excel, on a copy of the xlsm. Agents can't run VBA; openpyxl/LibreOffice can't reproduce macro output |
| Status board | `docs/new-req/README.md` |
| Implementations | `COB-ts/src/ca/` · `COB-py/cob_calculator/cob_canada.py` (+ `validate.py`, `fees.py`) · `COB-xlsx/build_workbook_ca.py` (generated `.xlsx`) |
| UIs | `COB-ts/ui/ca.html`+`ca.js` · `COB-py/pages/14_Cost_of_Borrowing_CA.py` |
| Visual design references | https://www.alterna.ca/ (the client) · https://www.tandia.com |
| Design docs | `docs/visual_design/` |
| Legacy / out of scope | US engine: rest of `COB-ts/src/`, rest of `COB-py/cob_calculator/`, `COB-xlsx/build_workbook.py` |
| Check commands | see **Commands** below |
| Reference vectors | see **Parity vectors** below |
| Fixtures | `COB-py/tests/fixtures/` (JSON, shared by all engines): `ca_appendix_a.json`, `ca_007_worked_vector.json`, `ca_oracle_scenarios.json` |
| Oracle | `COB-py/tests/fixtures/macro_oracle.py` — test-only VBA transliteration, reproduces the 007 vector bit for bit. Regenerate its vectors with `generate_oracle_vectors.py` |
| Float tolerance | 1e-9 relative (rates in Appendix A: 1e-12 absolute) |

## What this project is now

A replacement for Alterna Savings' Excel/VBA **Canadian Cost of Borrowing (COB)
calculator**, built three times from one spec: `COB-ts` (TypeScript),
`COB-py` (Python/Streamlit), `COB-xlsx` (generated formula workbook). The goal is
**functional parity**: same inputs ⇒ same outputs as the legacy workbook.

The repo also contains an older US-style mortgage engine (everything in
`COB-ts/src/` outside `ca/`, most of `COB-py/cob_calculator/`,
`COB-xlsx/build_workbook.py`). Its docs were removed; treat it as legacy — don't
change it unless explicitly asked, and don't borrow its conventions for the
Canadian engine.

## Sources of truth (highest wins on conflict)

1. **`~/Downloads/COB Requirements v2.3.docx`** — the BRD. Read with
   `textutil -convert txt -stdout "<path>"`. Cite requirements by ID (IN-xx,
   OUT-xx, BR-xx, §n, Appendix B.n).
2. **`~/Downloads/Cost of Borrowing Rate Calc_Current.xlsm`** — the live legacy
   workbook the BRD must match. Macro source:
   `python3 -m oletools.olevba --decode -c "<path>"` (key routines:
   `CalculateAll`, `ValidateInput`, `getRate`, `getNext*`). Cell values:
   `openpyxl.load_workbook(path, data_only=True, keep_vba=True)`. **Where the
   docx prose and the macro disagree on arithmetic, the macro wins for parity
   — record the disagreement, don't silently pick.**
3. Regulatory/web research — background only; never overrides 1 or 2.

Never modify either source file. Copy to the scratchpad if you need to
experiment.

## Docs

- `docs/architecture.md` — architecture, domain model, workflow, use cases, traceability.
- `docs/new-req/006-*.md` — the engine spec (equations, data shapes, invariants).
- `docs/new-req/007-*.md` — reconciliation of 006 against the BRD + macro, with the worked parity vector.
- `docs/new-req/008-*.md` — **open items**. Anything listed there is unresolved; don't implement a guess for it.
- `docs/new-req/README.md` — status board. Keep it true.

New specs: `docs/new-req/NNN-kebab-name.md`, next free number, 006's structure
(Status / Problem / Scope / Data shapes / Equations / Invariants / Open questions).

## Canadian-engine conventions

- Rates in public inputs/outputs are **percent numbers** (`3.74` = 3.74%); convert to decimal once, internally.
- **No intermediate rounding** — the macro never rounds. Round only for display (2 dp currency, 5 dp rates).
- Dates are calendar dates; day counts are whole days (TS: UTC-only date math).
- Validation first, via `validateCobCanadaInput` / Python equivalent; plain `RangeError` / `ValueError`.
- Payment amount is always an input; nothing solves for it (BRD §1.2).
- Engines are pure functions: no I/O, no persistence (BRD §7 no-PII).

## Commands

| Engine | Check |
|---|---|
| COB-ts | `cd COB-ts && npm run typecheck && npm test && npm run build` (CA tests: `tests/ca/`) |
| COB-py | `cd COB-py && python3 -m pytest -q` (CA tests: `tests/test_cob_canada.py`) |
| COB-xlsx | `cd COB-xlsx && python3 build_workbook_ca.py`, then recalc a **copy**: `cp COB_Calculator_CA.xlsx "$TMPDIR/v.xlsx" && python3 ~/.claude/skills/synced/*/xlsx/scripts/recalc.py "$TMPDIR/v.xlsx" 240` → expect `"total_errors": 0`. Never recalc the shipped file. The build step **rewrites the tracked `COB_Calculator_CA.xlsx`**, so this check is not read-only. The `synced/*` glob must match exactly one skill install. |
| UI (TS) | `cd COB-ts && npm run ui` |
| UI (py) | `cd COB-py && streamlit run streamlit_app.py` |

## Parity vectors

- BRD Appendix A: 3.74% at m=2 → n=1…52 table (must match to 1e-12).
- 007 "Worked validation vector": fixed mortgage, Accelerated Weekly, $0 fees, 156 rows.
- Oracle scenarios `S0`–`S9` in `ca_oracle_scenarios.json`: fees, month-end, leap-crossing, semi-monthly, payoff, underpayment, biweekly, 10-year weekly. These come from the oracle, not the live macro.
- Still missing (see 008): a **live-macro** fee-bearing / accrued-interest vector to confirm the oracle beyond the fee-free case.

"Tests pass" ≠ "matches the workbook". Report which one you actually showed.
