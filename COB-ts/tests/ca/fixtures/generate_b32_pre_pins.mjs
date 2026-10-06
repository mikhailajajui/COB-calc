// B32 (DEC-B32-TERM; COB-architecture.md section 5 B32, revision 50). QA-owned pre-change pins, captured on the
// pre-B32 tree (product code unchanged) on 2026-10-05, BEFORE sr-dev's step:
//   - flowLabels(flow, FLOWS[flow]) per flow (the four pre-B32 keys; B32-INV-LABEL "the other four values deep-equal today's");
//   - printInputRows(raw, ctx, 'X') and printInputRows(raw, ctx, 'X', 'M') for every capture scenario raw (plus a Contract
//     date) x both contractDateField states (B32-INV-PRINT "every other row deep-equals today's output");
//   - the export names of both engine barrels and of ui/ca-view.js (B32-T6 "export lists unchanged"; view count 41).
// usage (from COB-ts/, after `npm run build`): node tests/ca/fixtures/generate_b32_pre_pins.mjs [--write]
// Without --write it prints a diff summary against the pinned file and exits 1 on any difference. It must NOT be re-run
// with --write after B32 lands (the pins are of the pre-B32 behaviour).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const OUT = fileURLToPath(new URL('./b32_pre_label_pins.json', import.meta.url));
const ca = await import(ROOT + 'dist/ca/index.js');
const root = await import(ROOT + 'dist/index.js');
const view = await import(ROOT + 'ui/ca-view.js');
const cap = JSON.parse(readFileSync(fileURLToPath(new URL('./a10_ui_capture_v1.json', import.meta.url)), 'utf8'));
const FLOW_IDS = ['newMortgageOrLoan', 'renewal', 'paymentChange', 'variableRatePaymentChange'];
const STATES = [['contractDateField on', true], ['contractDateField off', false]];
const flowLabels = Object.fromEntries(FLOW_IDS.map((f) => [f, view.flowLabels(f, ca.FLOWS[f])]));
const printRows = [];
for (const sc of cap.scenarios) {
  const raw = { ...sc.raw, contractDate: '2026-03-10' };
  for (const [state, on] of STATES) {
    const ctx = { spec: ca.FLOWS[raw.flow], semiAnnual: ca.requiresSemiAnnualDate(raw.productType, raw.rateType),
      switches: { financedOption: false, acceleratedFrequencies: false, contractDateField: on } };
    printRows.push({ id: sc.id, state, moveNote: '', rows: view.printInputRows(raw, ctx, 'X') });
    printRows.push({ id: sc.id, state, moveNote: 'M', rows: view.printInputRows(raw, ctx, 'X', 'M') });
  }
}
const pins = {
  provenance: { task: 'B32 QA red step, pre-change pins', date: '2026-10-05', tree: 'pre-B32 (contractTerm(result); flowLabels four keys)',
    contractDateOnRaw: 'capture raw + contractDate 2026-03-10', switchesOtherwise: 'financedOption false, acceleratedFrequencies false' },
  flowLabels,
  printRows,
  exports: { caBarrel: Object.keys(ca).sort(), rootBarrel: Object.keys(root).sort(), view: Object.keys(view).sort() },
};
const text = JSON.stringify(pins, null, 1) + '\n';
if (process.argv.includes('--write')) {
  if (existsSync(OUT)) throw new Error('b32_pre_label_pins.json exists; refusing to overwrite pre-B32 pins');
  writeFileSync(OUT, text);
  console.log('wrote', OUT, printRows.length, 'print records');
} else {
  const same = existsSync(OUT) && readFileSync(OUT, 'utf8') === text;
  console.log(same ? 'pins equal' : 'pins DIFFER');
  process.exit(same ? 0 : 1);
}
