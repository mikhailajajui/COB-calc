# cob-calculator

Cost of Borrowing (COB) calculator for Canadian lending disclosures, in TypeScript.
It replaces Alterna Savings' Excel COB calculator (`Cost of Borrowing Rate Calc_Current.xlsm`)
and reproduces the workbook's outputs, except where a recorded decision says otherwise
(see `CHANGES.md`). It is a standalone calculator: manual input only, with no system
integration and no storage of member data.

- Engine: `src/ca/`. Its public API (`src/ca/index.ts`, re-exported by `src/index.ts`) is
  `calculateCobCanada`, `PAYMENTS_PER_YEAR` and the input/result types.
- UI: `ui/ca.html` (with `ui/ca.js`), which imports only the built engine `/dist/ca/index.js`.

## Commands

```bash
npm install
npx vitest run        # full suite
npm run typecheck     # tsc --noEmit
npm run build         # tsc -> dist/
npm run test:tz       # golden + purity tests under two time zones
npm run ui            # build + serve the UI (node ui/serve.mjs)
```

`npm run ui` serves the project root on `http://localhost:5173` (or `$PORT`); `/` opens
`ui/ca.html`.

## Usage

```ts
import { calculateCobCanada } from 'cob-calculator';
import type { CobCanadaInput } from 'cob-calculator';

declare const input: CobCanadaInput;
const result = calculateCobCanada(input);
```

`archive/` holds read-only copies of the pre-B27 golden fixtures (`archive/pre-b27/`, with a `MANIFEST.txt`); no test reads them.
