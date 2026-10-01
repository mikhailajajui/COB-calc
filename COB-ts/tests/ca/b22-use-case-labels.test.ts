/**
 * B22 (COB-architecture.md §5 B22, revision 22 as amended 2026-09-29; stakeholder decisions 5 and 2:
 * FB-3, FB-16; closes OQ-A and documentation finding F1). QA red step, 2026-09-29.
 *
 * The labels of the date fields and the fieldset legend follow the use case, one pure source
 * (`flowLabels` in ui/ca-view.js) feeds the form, the contract-terms tiles and the print record.
 * Payment Change and VRPC: start field "Date of change" (2026-10-01, user-approved; was "Last payment date"),
 * first-payment field "Next payment date" (decisions 2 and 5). The Accrued interest HINT for Payment Change / VRPC is the interim arrears
 * text (accepted by the user 2026-09-29; final wording Q-MSG). The field NAME "Accrued interest" is
 * NOT renamed anywhere (user 2026-09-29): form label, tiles and print row keep it for every flow.
 * Labels only: no engine change, no golden change, no switch (B22-R9).
 *
 * Invariants: B22-INV-labels (B22-1, B22-2), B22-INV-print (B22-3), B22-INV-nolit (B22-5a),
 * B22-INV-screen (B22-7, read from the Chrome capture fixture's `flowScreens`).
 * The on-screen writes of the label elements are also pinned by the capture compare
 * (node tests/ca/fixtures/capture_a10_ui.mjs), which is where brief mutants MUT-3 / MUT-5 die.
 *
 * No date sequence here: not time-zone sensitive, not in `test:tz`.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FLOWS } from '../../src/ca/index.js';
import type { CobFlow, FlowSpec } from '../../src/ca/index.js';
import type * as View from '../../ui/ca-view.js';
import { ROOT, stripComments } from '../architecture/support.js';
import { loadFixture } from './support/fixtures.js';
import { BOTH_CONTRACT_DATE } from './support/uiSwitches.js';

const loadView = () => import('../../ui/ca-view.js') as Promise<typeof View>;
const FLOW_IDS: CobFlow[] = ['newMortgageOrLoan', 'renewal', 'paymentChange', 'variableRatePaymentChange'];

// B22-R6: the Renewal hint is today's text; the change-flow hint is the accepted interim wording.
const RENEWAL_HINT = 'Interest accrued since the last payment date.';
const ARREARS_HINT =
  'Only interest due at earlier payments and not yet paid (arrears), usually $0.00. Interest since the last payment date is already charged.';

// B22-R2 table, verbatim.
const EXPECTED: Record<CobFlow, View.FlowLabels> = {
  newMortgageOrLoan: { legend: 'New mortgage or loan', startDate: 'Disbursal date', firstPaymentDate: 'First payment date', accruedHint: null },
  renewal: { legend: 'Renewal', startDate: 'Renewal date', firstPaymentDate: 'First payment date', accruedHint: RENEWAL_HINT },
  paymentChange: { legend: 'Payment change', startDate: 'Date of change', firstPaymentDate: 'Next payment date', accruedHint: ARREARS_HINT },
  variableRatePaymentChange: {
    legend: 'Variable rate payment change', startDate: 'Date of change', firstPaymentDate: 'Next payment date', accruedHint: ARREARS_HINT,
  },
};

/** A filled form with distinct dates, so each date row's value shows which input it came from. */
const RAW = (flow: CobFlow): View.RawForm => ({
  flow, productType: 'mortgage', rateType: flow === 'variableRatePaymentChange' ? 'variable' : 'fixed', contractDate: '2026-03-10', // optional since B24 (the field is hidden behind contractDateField)
  loanAmount: '150,000.00', contractRatePercent: '4.19', paymentAmount: '900.00', paymentFrequency: 'monthly',
  firstPaymentDate: '2026-05-01', endDate: '2028-10-01', disbursalDate: '2026-03-17', renewalDate: '2026-04-01',
  accruedInterest: '12.34', semiAnnualCompoundingDate: '2026-04-15', fees: [],
});

describe('B22-INV-labels: flowLabels is the one pure source of the per-flow texts (B22-R2)', () => {
  for (const flow of FLOW_IDS) {
    it(`B22-1: flowLabels('${flow}', FLOWS.${flow}) equals the R2 table (exactly four keys, no accruedRow)`, async () => {
      const v = await loadView();
      const t = v.flowLabels(flow, FLOWS[flow]);
      expect(Object.keys(t).sort()).toEqual(['accruedHint', 'firstPaymentDate', 'legend', 'startDate']);
      expect(t).toStrictEqual(EXPECTED[flow]);
    });
  }

  it('B22-2: both date labels come from the spec passed in, and the hint is null exactly when the spec hides Accrued interest', async () => {
    const v = await loadView();
    const spec: FlowSpec = { ...FLOWS.paymentChange, startDateLabel: 'S-label', firstPaymentDateLabel: 'F-label' };
    const t = v.flowLabels('paymentChange', spec);
    expect([t.startDate, t.firstPaymentDate]).toEqual(['S-label', 'F-label']);
    expect(t.legend).toBe('Payment change');
    expect(t.accruedHint).toBe(ARREARS_HINT);
    // R2: accruedHint is null when spec.accruedInterest === 'hidden' (read from the spec, not the flow id).
    expect(v.flowLabels('renewal', { ...FLOWS.renewal, accruedInterest: 'hidden' }).accruedHint).toBeNull();
  });
});

describe('B22-INV-print: printInputRows names, order and values per flow (B22-R3)', () => {
  // B24-R5: the Contract date row exists only while contractDateField is on (shipped off); both states run.
  const HEAD = ['Use case', 'Product type', 'Rate type', 'Mortgage or loan amount', 'Interest rate', 'Payment amount *', 'Payment frequency'];
  const NAMES: Record<CobFlow, string[]> = {
    newMortgageOrLoan: [...HEAD, 'First payment date', 'End date', 'Contract term', 'Disbursal date'],
    renewal: [...HEAD, 'First payment date', 'End date', 'Contract term', 'Renewal date', 'Accrued interest'],
    paymentChange: [...HEAD, 'Next payment date', 'End date', 'Contract term', 'Date of change', 'Accrued interest'],
    variableRatePaymentChange: [...HEAD, 'Next payment date', 'End date', 'Contract term', 'Date of change', 'Accrued interest'],
  };
  // Then the semi-annual row when the product is a fixed mortgage (any flow; never VRPC, which is variable).
  const SEMI = 'Semi-annual compounding reference date';
  const START_VALUE: Record<CobFlow, string> = {
    newMortgageOrLoan: 'Mar 17, 2026', // disbursalDate
    renewal: 'Apr 1, 2026', // renewalDate
    paymentChange: 'Apr 1, 2026', // renewalDate (the input keeps its name; only the label changes, R7)
    variableRatePaymentChange: 'Apr 1, 2026',
  };
  const TERM_TEXT = '1 year, 4 months, 2 days'; // any string: the row carries the text it is given (B24-R6)
  for (const flow of FLOW_IDS) {
    it.each(BOTH_CONTRACT_DATE)(`B22-3: ${flow}: row names in order; date rows and Accrued interest carry the unchanged values (%s)`, async (_l, sw) => {
      const v = await loadView();
      const raw = RAW(flow);
      const semiAnnual = raw.productType === 'mortgage' && raw.rateType === 'fixed';
      const rows = v.printInputRows(raw, { spec: FLOWS[flow], semiAnnual, switches: sw }, TERM_TEXT);
      expect(semiAnnual).toBe(flow !== 'variableRatePaymentChange');
      const names = sw.contractDateField ? ['Contract date', ...NAMES[flow]] : NAMES[flow];
      const at = sw.contractDateField ? 1 : 0; // index shift of every row after the optional Contract date
      expect(rows.map(([k]) => k)).toEqual(semiAnnual ? [...names, SEMI] : names);
      expect(rows[7 + at], 'first-payment row').toEqual([EXPECTED[flow].firstPaymentDate, 'May 1, 2026']);
      expect(rows[9 + at], 'term row').toEqual(['Contract term', TERM_TEXT]);
      expect(rows[10 + at], 'start-date row').toEqual([EXPECTED[flow].startDate, START_VALUE[flow]]);
      if (flow !== 'newMortgageOrLoan') expect(rows[11 + at], 'accrued row keeps its name').toEqual(['Accrued interest', '$12.34']);
      if (semiAnnual) expect(rows[rows.length - 1]).toEqual([SEMI, 'Apr 15, 2026']);
      if (sw.contractDateField) expect(rows[0]).toEqual(['Contract date', 'Mar 10, 2026']);
    });
  }
});

describe('B22-INV-nolit and the page source (B22-R4, B22-R5)', () => {
  const js = stripComments(readFileSync(`${ROOT}/ui/ca.js`, 'utf8'));
  const html = readFileSync(`${ROOT}/ui/ca.html`, 'utf8');
  const LABEL_IDS = ['firstPaymentDate-label', 'newFlowLegend', 'disbursalDate-label', 'existingFlowLegend', 'renewalDate-label', 'accruedInterest-hint'];

  it('B22-5a: ui/ca.js holds no date-label or legend literal in any quote style, and calls flowLabels(', () => {
    const LITERALS = ['Disbursal date', 'Renewal date', 'First payment date', 'Next payment date', 'Last payment date', 'Date of change', 'Payment change date',
      'New mortgage or loan', 'Renewal and payment change'];
    const hits = LITERALS.filter((s) => new RegExp(`['"\`]${s}['"\`]`).test(js));
    expect(hits).toEqual([]);
    expect(js).toMatch(/\bflowLabels\(/);
  });

  it('B22-5b: ui/ca.html carries the six ids; ui/ca.js looks each up and writes its textContent', () => {
    for (const id of LABEL_IDS) {
      expect(html, id).toMatch(new RegExp(`\\bid="${id}"`));
      const ref = js.match(new RegExp(`\\b(?:const|let)\\s+([\\w$]+)\\s*=\\s*document\\.getElementById\\(\\s*['"\`]${id}['"\`]\\s*\\)`));
      expect(ref, `ui/ca.js looks up #${id}`).not.toBeNull();
      const name = ref?.[1] ?? '';
      // The element's text is written (MUT-3 / MUT-5 remove such a write; the capture compare also kills them).
      expect(js, `ui/ca.js writes ${name}.textContent`).toMatch(new RegExp(`\\b${name.replace(/\$/g, '\\$')}\\.textContent\\s*=[^=]`));
    }
  });

  it('B22-5c: the served page shows the New flow texts; retired wording is gone; "Accrued interest ($)" and the Renewal hint are unchanged', () => {
    expect(html).toMatch(/<legend id="newFlowLegend">New mortgage or loan<\/legend>/);
    expect(html).toMatch(/<label for="disbursalDate" id="disbursalDate-label">Disbursal date<\/label>/);
    expect(html).toMatch(/<label for="firstPaymentDate" id="firstPaymentDate-label">First payment date<\/label>/);
    expect(html).toMatch(/<legend id="existingFlowLegend">Renewal<\/legend>/);
    expect(html).toMatch(/<label for="renewalDate" id="renewalDate-label">Renewal date<\/label>/);
    expect(html).not.toContain('Renewal and payment change');
    expect(html).not.toContain('Payment change date');
    // User 2026-09-29: the name "Accrued interest" is not renamed; the static hint is the Renewal text.
    expect(html).toContain('<label for="accruedInterest">Accrued interest ($)</label>');
    expect(html).toContain(`<span class="hint" id="accruedInterest-hint">${RENEWAL_HINT}</span>`);
    expect(html).not.toContain('earlier unpaid');
  });
});

describe('B22-INV-screen: what Chrome showed per flow (capture fixture flowScreens) equals flowLabels (B22-R8)', () => {
  const cap = loadFixture<{ flowScreens?: Record<string, Record<string, string>> }>('a10_ui_capture_v1.json');

  it('B22-7: flowScreens holds exactly the four flows, in FLOW_IDS order', () => {
    expect(Object.keys(cap.flowScreens ?? {})).toEqual(FLOW_IDS);
  });

  for (const flow of FLOW_IDS) {
    it(`B22-7: ${flow}: the captured legend, date labels and hint deep-equal flowLabels`, async () => {
      const v = await loadView();
      const t = v.flowLabels(flow, FLOWS[flow]);
      const want: Record<string, string> = { legend: t.legend, startDate: t.startDate, firstPaymentDate: t.firstPaymentDate };
      if (t.accruedHint !== null) want.accruedInterestHint = t.accruedHint;
      // B24-R6: the capture also records the hint under the read-only Contract term field (key order: after the accrued hint).
      want.termHint = `Calculated from the ${t.firstPaymentDate.toLowerCase()} to the last scheduled payment date.`;
      expect(cap.flowScreens?.[flow]).toStrictEqual(want);
    });
  }
});
