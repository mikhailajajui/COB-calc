# cob-calculator

Cost of Borrowing (COB) calculator for Canadian lending disclosures, in TypeScript.
It replaces Alterna Savings' Excel COB calculator (`Cost of Borrowing Rate Calc_Current.xlsm`)
and reproduces the workbook's outputs, except where a recorded decision says otherwise
(see `CHANGES.md`). It is a standalone calculator: manual input only, with no system
integration and no storage of member data.

- Engine: `src/ca/`. Its public API (`src/ca/index.ts`, re-exported by `src/index.ts`) is
  `calculateCobCanada`, `PAYMENTS_PER_YEAR` and the input/result types.
- UI: `ui/ca.html` (with `ui/ca.js`), which imports only the built engine `/dist/ca/index.js`.

## Requirements

- Node **26.13.0 or later** (LTS) with npm 11.20. In this folder, `nvm install && nvm use` reads `.nvmrc` (`26.13.0`).
- `.npmrc` sets `engine-strict=true`, so `npm ci` refuses a Node older than the `engines` floor (`>=26.13.0`).
- `allowScripts` in `package.json` denies the install script of `fsevents` (an optional, macOS-only dependency that ships prebuilt); npm 11.20 skips it anyway, and the entry records that skip.

## Commands

```bash
npm install
npx vitest run        # full suite
npm run typecheck     # tsc --noEmit
npm run build         # tsc -> dist/
npm run test:tz       # golden + purity tests under two time zones
npm run ui            # build + serve the UI (node ui/serve.mjs)
```

`npm run ui` builds the engine and serves the calculator on `http://localhost:5173` (or `$PORT`): only files under
`ui/` and `dist/` with an allowed extension, plus `/version.json` and `/healthz` (see `docs/DEPLOY-AZURE.md`); `/`
opens `ui/ca.html`.

## Usage

```ts
import { calculateCobCanada } from 'cob-calculator';
import type { CobCanadaInput } from 'cob-calculator';

declare const input: CobCanadaInput;
const result = calculateCobCanada(input);
```

The pre-B27 golden fixtures that used to sit in an archive folder here were removed before the security handover (SEC-10, 2026-10-28). Their content is still pinned by sha256 in `tests/ca/b27-personal-loan-monthly-only.test.ts` (B27-T9).

## Running the suite from this folder alone

The test suite needs nothing outside this folder:

```bash
npm ci
npm run build             # the a13-serve test needs dist/
npx vitest run
npm run typecheck
npm run typecheck:tests
npm run test:tz
npm audit                 # must report 0 vulnerabilities
```

- `DECISIONS.md` is the decision record in this folder: one row per `@decision` ID cited in `src/ca/policies.ts`. The architecture test F7 checks it.
- Nothing needs a browser. The project has no browser dependency, and the earlier Chrome scripts were removed before the handover.
- The parent-level registry check (`node tools/check-decisions-registry.mjs`, run from the repository root) compares `DECISIONS.md` with the business record kept outside this folder. It is not part of the handover.
- Three fixture generators read files outside this folder: `tests/ca/fixtures/generate_d9_oracle_vectors.py`, `tests/ca/fixtures/generate_b11_waterfall_vectors.py` and `tests/ca/fixtures/extract_ref01.py`. They are for regenerating fixtures only and are never run by the tests. Citations of the workbook reference files and the archive in code comments also point to project files that are not handed over.
