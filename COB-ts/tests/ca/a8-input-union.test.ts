/**
 * A8 (COB-architecture.md §5 A8 and §3.3, revision 12; ADR-09, ADR-13(e)): `CobCanadaInput`
 * becomes the union `NewLoanInput | ExistingLoanInput`; `validateCobCanadaInput` returns
 * `{ startDate }` (the flow's start date, read from `FLOWS[flow].startDateField`); the `!` in
 * `cobCanada.ts` (`input[flowSpec.startDateField]!`) goes away. Runtime behaviour unchanged.
 * QA step written 2026-09-29, before the developer step. The developer must not edit these
 * assertions. The type-level cases (A8-T1 ... A8-T8) are in tests/types/a8-input-union.typecheck.ts.
 *
 * Tests:
 *   A8-1  (4, one per flow; red today: the validator returns undefined) with BOTH start dates
 *         set, `validateCobCanadaInput(x).startDate` is the very Date object of the flow's start
 *         field (disbursalDate for newMortgageOrLoan, renewalDate for the other three), so a JS
 *         caller's extra date is still ignored.
 *   A8-2  (red today) cobCanada.ts (comments stripped) no longer re-reads the start date from the
 *         input: no `startDateField]!` and no `input[flowSpec.startDateField]`.
 *   A8-3  (green before and after) a new loan with `accruedInterest` (forbidden by the type, sent
 *         by a JS caller) gives exactly the same result as without it.
 *
 * Pending decisions, NOT settled here: OQ-A (one field name `renewalDate` for the three
 * existing-loan flows; labels in flows.ts) stays as today. OQ-B / BR-05 are settled by B20 (`accruedInterest`
 * is required for those flows; `bothDates` carries `accruedInterest: 0`). No date sequences asserted, so this file does not join `test:tz`.
 */
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { calculateCobCanada } from '../../src/ca/index.js';
import { validateCobCanadaInput } from '../../src/ca/validate.js';
import type { CobCanadaInput, CobFlow } from '../../src/ca/index.js';
import { SRC_CA, read, stripComments } from '../architecture/support.js';
import { asInput, utcDate } from './support/builders.js';

const utc = utcDate;

/** Loan 250,000, variable mortgage, 5.19%, monthly 1,300, first payment 2027-02-01, end
 *  2028-02-01, term 1y 0m, no fees; both start dates set as distinct Date objects. */
function bothDates(flow: CobFlow) {
  return {
    flow,
    productType: 'mortgage',
    rateType: 'variable',
    loanAmount: 250000,
    fees: { fees: [] },
    contractRatePercent: 5.19,
    paymentAmount: 1300,
    paymentFrequency: 'monthly',
    firstPaymentDate: utc('2027-02-01'),
    endDate: utc('2028-02-01'),
    termYears: 1,
    termMonths: 0,
    disbursalDate: utc('2027-01-01'),
    renewalDate: utc('2027-01-15'),
    accruedInterest: 0, // required for the three existing-loan flows since B20 (ignored by the new flow)
  } as const;
}

/** The returned start date. Read through `unknown` so this file compiles before A8 (when the
 *  validator returns void) as well as after; the type of the return is A8-T8's job. */
const returnedStart = (x: CobCanadaInput): unknown =>
  (validateCobCanadaInput(x) as unknown as { startDate?: unknown } | undefined)?.startDate;

describe('A8-1 validateCobCanadaInput returns the flow start date (same object)', () => {
  it('newMortgageOrLoan -> disbursalDate', () => {
    const x = bothDates('newMortgageOrLoan');
    expect(x.disbursalDate).not.toBe(x.renewalDate);
    expect(returnedStart(asInput(x))).toBe(x.disbursalDate);
  });
  for (const flow of ['renewal', 'paymentChange', 'variableRatePaymentChange'] as const) {
    it(`${flow} -> renewalDate`, () => {
      const x = bothDates(flow);
      expect(x.disbursalDate).not.toBe(x.renewalDate);
      expect(returnedStart(asInput(x))).toBe(x.renewalDate);
    });
  }
});

describe('A8-2 cobCanada.ts does not re-read the start date', () => {
  it('no `startDateField]!` and no `input[flowSpec.startDateField]` (comments stripped)', () => {
    const code = stripComments(read(join(SRC_CA, 'cobCanada.ts')));
    expect(code).not.toMatch(/startDateField\s*\]\s*!/);
    expect(code).not.toMatch(/input\s*\[\s*flowSpec\.startDateField\s*\]/);
  });
});

describe('A8-3 a JS caller\'s accruedInterest on a new loan is still ignored', () => {
  it('newMortgageOrLoan with accruedInterest 123.45 equals the same input without it', () => {
    const { renewalDate: _r, ...x } = bothDates('newMortgageOrLoan');
    const withAccrued = asInput({ ...x, accruedInterest: 123.45 });
    expect(JSON.stringify(calculateCobCanada(withAccrued))).toBe(
      JSON.stringify(calculateCobCanada(asInput(x))),
    );
  });
});
