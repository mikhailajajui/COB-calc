/**
 * B21 (COB-architecture.md §5 B21, revision 21; stakeholder decision 9, FB-23; closes DQ-16 and QA
 * finding F-3): Renewal is mortgage-only, locked like VRPC. Payment Change stays open to personal
 * loans. The workbook has no use cases, so no Excel behaviour to match and no DEV ID.
 * Interim messages (Q-MSG): `flow '<flow>' is <allowed> only, got productType='<p>', rateType='<r>'`
 * with <allowed> = "mortgage" (renewal) or "mortgage + variable-rate" (VRPC).
 *
 * Tests (14): B21-1, B21-2 x2, B21-3, B21-4, B21-5 x2, B21-6, B21-7 x2, B21-8 x3.
 * (A6-2 table, A6-5, A6-6 edits are in flows-a6.test.ts; row 13 / 13b in a9-input-issues.test.ts.)
 * No date sequences asserted, so this file does not join `test:tz`.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { calculateCobCanada, collectInputIssues, FLOWS } from '../../src/ca/index.js';
import type { CobCanadaInput, CobFlow } from '../../src/ca/index.js';
import { validateCobCanadaInput } from '../../src/ca/validate.js';
import { ROOT } from '../architecture/support.js';
// @ts-ignore -- plain .mjs shared with the golden generators (no .d.ts)
import * as corpusV1 from './fixtures/generate_golden.mjs';
// @ts-ignore -- plain .mjs (no .d.ts)
import * as corpusPc from './fixtures/generate_golden_pc.mjs';
import { asInput, utcDate } from './support/builders.js';

const d = utcDate;
const LOCK = (p: string, r: string) => `flow 'renewal' is mortgage only, got productType='${p}', rateType='${r}'`;

function base(flow: CobFlow, over: Record<string, unknown> = {}): CobCanadaInput {
  const input: Record<string, unknown> = {
    flow,
    productType: 'mortgage',
    rateType: 'variable',
    loanAmount: 250000,
    fees: { fees: [] },
    contractRatePercent: 5.19,
    paymentAmount: 1300,
    paymentFrequency: 'monthly',
    firstPaymentDate: d('2027-02-01'),
    endDate: d('2028-02-01'),
    termYears: 1,
    termMonths: 0,
    ...(flow === 'newMortgageOrLoan' ? { disbursalDate: d('2027-01-01') } : { renewalDate: d('2027-01-15'), accruedInterest: 0 }),
    ...over,
  };
  for (const k of Object.keys(over)) if (over[k] === undefined) delete input[k];
  return asInput(input);
}
const thrown = (fn: () => unknown): Error => {
  try {
    fn();
  } catch (e) {
    return e as Error;
  }
  throw new Error('expected a throw');
};
const semi = (r: string) => (r === 'fixed' ? { semiAnnualCompoundingDate: d('2027-01-15') } : {});

describe('B21 Renewal is mortgage-only (decision 9)', () => {
  it("B21-1: the catalogue: renewal forces mortgage (no rate lock); paymentChange and new force nothing; VRPC unchanged", () => {
    expect(FLOWS.renewal.forcedProductType).toBe('mortgage');
    expect(FLOWS.renewal.forcedRateType).toBeNull();
    expect(FLOWS.paymentChange.forcedProductType).toBeNull();
    expect(FLOWS.paymentChange.forcedRateType).toBeNull();
    expect(FLOWS.newMortgageOrLoan.forcedProductType).toBeNull();
    expect(FLOWS.variableRatePaymentChange.forcedProductType).toBe('mortgage');
    expect(FLOWS.variableRatePaymentChange.forcedRateType).toBe('variable');
  });

  for (const rate of ['fixed', 'variable']) {
    it(`B21-2: renewal + personalLoan/${rate}: the exact RangeError from validate and calculate; one 'flow' issue from collectInputIssues`, () => {
      const x = base('renewal', { productType: 'personalLoan', rateType: rate });
      for (const run of [() => validateCobCanadaInput(x), () => calculateCobCanada(x)]) {
        const e = thrown(run);
        expect(e).toBeInstanceOf(RangeError);
        expect(e.message).toBe(LOCK('personalLoan', rate));
      }
      expect(collectInputIssues(x)).toEqual([{ field: 'flow', message: LOCK('personalLoan', rate) }]);
    });
  }

  it('B21-3: renewal + mortgage (fixed and variable) is accepted and calculates', () => {
    for (const r of ['fixed', 'variable'])
      expect(calculateCobCanada(base('renewal', { rateType: r, ...semi(r) })).amortizationSchedule.length).toBeGreaterThan(0);
  });

  it('B21-4: paymentChange and newMortgageOrLoan stay open to personal loans (both rate types)', () => {
    for (const flow of ['paymentChange', 'newMortgageOrLoan'] as CobFlow[])
      for (const r of ['fixed', 'variable'])
        expect(() => validateCobCanadaInput(base(flow, { productType: 'personalLoan', rateType: r })), `${flow} ${r}`).not.toThrow();
  });

  it('B21-5a: the lock comes before the start-date and accrued checks (renewal, personal loan, no renewalDate, no accrued)', () => {
    const x = base('renewal', { productType: 'personalLoan', renewalDate: undefined, accruedInterest: undefined });
    expect(thrown(() => validateCobCanadaInput(x)).message).toBe(LOCK('personalLoan', 'variable'));
    expect(collectInputIssues(x).map((i) => i.field)).toEqual(['flow', 'renewalDate', 'accruedInterest']);
  });

  it('B21-5b: the lock comes after the fee-limit check and before the date-order check', () => {
    const x = base('renewal', {
      productType: 'personalLoan',
      fees: { fees: [{ name: 'Admin', amount: 250000, financed: true }] },
      endDate: d('2027-01-01'),
    });
    expect(collectInputIssues(x).map((i) => i.field)).toEqual(['fees', 'flow', 'endDate']);
  });

  it('B21-6: the VRPC lock keeps its rule with the generalised message (personalLoan/fixed shows both values)', () => {
    const x = base('variableRatePaymentChange', { productType: 'personalLoan', rateType: 'fixed' });
    expect(thrown(() => validateCobCanadaInput(x)).message).toBe(
      "flow 'variableRatePaymentChange' is mortgage + variable-rate only, got productType='personalLoan', rateType='fixed'",
    );
  });

  it('B21-7a: golden v1 generator: a personal-loan renewal key is sent as paymentChange, mortgage keeps renewal; every corpus input validates', () => {
    let pl = 0;
    let mort = 0;
    for (const g of corpusV1.buildGroups())
      for (const c of g.cases) {
        const input = corpusV1.makeInput(c.params);
        if (c.params.flowKey.startsWith('renewal')) {
          if (c.params.productType === 'personalLoan') {
            expect(input.flow).toBe('paymentChange');
            pl++;
          } else {
            expect(input.flow).toBe('renewal');
            mort++;
          }
        }
        expect(() => validateCobCanadaInput(input), c.label).not.toThrow();
      }
    expect(pl).toBeGreaterThan(0);
    expect(mort).toBeGreaterThan(0);
  });

  it('B21-7b: the PC golden corpus has no renewal input at all', () => {
    let n = 0;
    for (const g of corpusPc.buildGroups())
      for (const c of g.cases) {
        expect(corpusPc.makeInput(c.params).flow).not.toBe('renewal');
        n++;
      }
    expect(n).toBeGreaterThan(0);
  });

  it('B21-8a: ui/ca.js reads the lock from FLOWS (forcedProductType), with no renewal-specific code', () => {
    const js = readFileSync(`${ROOT}/ui/ca.js`, 'utf8');
    expect(js).toMatch(/spec\.forcedProductType/);
    expect(js).toMatch(/productTypeEl\.disabled = true/);
  });

  for (const file of ['tests/ca/fixtures/capture_a10_ui.mjs', 'tests/ui/check_print_width.mjs']) {
    it(`B21-8b: ${file}: no scenario sets productType after choosing Renewal (the select is disabled; Playwright would time out)`, () => {
      const src = readFileSync(`${ROOT}/${file}`, 'utf8');
      const hits = [...src.matchAll(/selects:\s*\{[^}]*flow:\s*'renewal'[^}]*\}/g)];
      expect(hits.length).toBeGreaterThan(0);
      for (const h of hits) expect(h[0]).not.toMatch(/productType/);
    });
  }
});
