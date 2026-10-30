import { describe, expect, it } from 'vitest';
import { calculateCobCanada } from '../../src/ca/index.js';
import { validateCobCanadaInput } from '../../src/ca/validate.js';
import type { CobCanadaInput } from '../../src/ca/index.js';
import { asInput, utcDate } from './support/builders.js';
import { expectRangeErrorMatching } from './support/compare.js';
import { loadFixture } from './support/fixtures.js';
import { BOTH_SEMI, loadValidate } from './support/semiSwitch.js';

/**
 * B3b (COB-architecture.md §5; 012 D-12): every date input is checked as a valid Date BY NAME,
 * and the ordering checks compare UTC calendar dates, not timestamps. QA red set, written
 * before the developer step (2026-09-27). Plain `it`, as in B2: the cases marked RED below
 * fail today and must go green in B3b; the rest are characterisation guards that must stay
 * green.
 *
 * Sources (not this engine):
 * - 012 D-12 "Expected": each date checked as a valid Date, by name; ordering on UTC
 *   calendar dates; messages accurate; endDate == firstPaymentDate stays rejected.
 * - Macro ValidateInput (reference/workbook-macro-source.txt): IsDate per field (216, 268,
 *   301); `firstPymtDate < disbDate` rejected, so equal is allowed (271); `eDate <=
 *   firstPymtDate` rejected (304). BRD §6 says the same.
 *
 * NOT decided here: a Date with a non-midnight UTC time is NOT rejected (012 asks only for
 * calendar-date comparison; the existing D-12 test accepts a 12:00Z disbursalDate). Whether
 * irrelevant-flow date fields (e.g. renewalDate on a new loan) are checked is not asserted.
 * semiAnnualCompoundingDate is only asserted where validate.ts already requires it
 * (fixed mortgage); its future is open question Q-SACD.
 *
 * TZ: the calendar-date cases are chosen so a local-time implementation fails under any
 * non-UTC TZ. Run this file under TZ=America/Toronto and TZ=Pacific/Kiritimati too.
 */

const d = utcDate;
const t = (iso: string) => new Date(iso);

/** Valid new-mortgage input (the 007 worked vector's request). */
function base(overrides: Record<string, unknown> = {}): CobCanadaInput {
  return asInput({
    flow: 'newMortgageOrLoan',
    productType: 'mortgage',
    rateType: 'fixed',
    loanAmount: 227829.65,
    contractRatePercent: 3.74,
    paymentAmount: 465.46,
    paymentFrequency: 'weekly',
    firstPaymentDate: d('2026-03-23'),
    endDate: d('2029-03-17'),
    termYears: 3,
    termMonths: 0,
    fees: { fees: [] },
    disbursalDate: d('2026-03-17'),
    semiAnnualCompoundingDate: d('2026-03-17'),
    ...overrides,
  });
}
const existing = (flow: string, overrides: Record<string, unknown> = {}) =>
  base({
    flow,
    disbursalDate: undefined,
    renewalDate: d('2026-03-17'),
    accruedInterest: 0,
    ...(flow === 'variableRatePaymentChange' ? { rateType: 'variable', semiAnnualCompoundingDate: undefined } : {}),
    ...overrides,
  });

/** Throws a RangeError whose message names `field` (so a downstream RangeError can't pass for it). */
const expectRangeErrorNaming = (fn: () => unknown, field: string): void => expectRangeErrorMatching(fn, new RegExp(`\\b${field}\\b`));

const BAD_VALUES: [string, () => unknown][] = [
  ['Invalid Date', () => new Date(NaN)],
  ['ISO string', () => '2026-03-17'],
  ['epoch-ms number', () => Date.UTC(2026, 2, 17)],
  ['null', () => null],
  ['plain object with getTime', () => ({ getTime: () => Date.UTC(2026, 2, 17) })],
];

describe('B3b each date field is rejected by name when it is not a valid Date', () => {
  const contexts: [string, string, (o: Record<string, unknown>) => CobCanadaInput][] = [
    ['firstPaymentDate', 'newMortgageOrLoan', base],
    ['endDate', 'newMortgageOrLoan', base],
    ['disbursalDate', 'newMortgageOrLoan', base], // RED except where noted: passes validation or TypeErrors
    ['renewalDate', 'renewal', (o) => existing('renewal', o)], // RED
    ['renewalDate', 'paymentChange', (o) => existing('paymentChange', o)], // RED
    ['renewalDate', 'variableRatePaymentChange', (o) => existing('variableRatePaymentChange', o)], // RED
    // Required for a fixed mortgage today (validate.ts). RED: only `=== undefined` is checked.
    // If Q-SACD drops the field, drop these cases.
    ['semiAnnualCompoundingDate', 'newMortgageOrLoan (fixed mortgage)', base],
  ];
  for (const [field, flow, make] of contexts) {
    for (const [label, value] of BAD_VALUES) {
      it(`${field} (${flow}) as ${label} -> RangeError naming ${field}`, () => {
        const input = make({ [field]: value() });
        expectRangeErrorNaming(() => validateCobCanadaInput(input), field);
        expectRangeErrorNaming(() => calculateCobCanada(input), field);
      });
    }
  }
  for (const field of ['firstPaymentDate', 'endDate', 'disbursalDate']) {
    it(`${field} missing (required) -> RangeError naming ${field}`, () => {
      const input = base() as unknown as Record<string, unknown>;
      delete input[field];
      expectRangeErrorNaming(() => validateCobCanadaInput(asInput(input)), field);
    });
  }
  // B24-R5 (Q-SACD): the Semi-annual date is required only while SEMI_ANNUAL_DATE_REQUIRED is on.
  it.each(BOTH_SEMI)('semiAnnualCompoundingDate missing -> RangeError naming it when on, accepted when off (%s)', async (_l, required) => {
    const api = await loadValidate(required);
    const input = base() as unknown as Record<string, unknown>;
    delete input['semiAnnualCompoundingDate'];
    if (required) expectRangeErrorNaming(() => api.validateCobCanadaInput(asInput(input)), 'semiAnnualCompoundingDate');
    else expect(() => api.validateCobCanadaInput(asInput(input))).not.toThrow();
  });
  it('renewalDate missing on renewal -> RangeError naming renewalDate', () => {
    const input = existing('renewal') as unknown as Record<string, unknown>;
    delete input.renewalDate;
    expectRangeErrorNaming(() => validateCobCanadaInput(asInput(input)), 'renewalDate');
  });
});

describe('B3b ordering compares UTC calendar dates, not timestamps', () => {
  const accept = (input: CobCanadaInput) => expect(() => calculateCobCanada(input)).not.toThrow();

  // Start date (disbursal / renewal) vs firstPaymentDate: start <= first payment (macro 271).
  for (const [field, make] of [
    ['disbursalDate', (o: Record<string, unknown>) => base(o)],
    ['renewalDate', (o: Record<string, unknown>) => existing('renewal', o)],
  ] as const) {
    it(`RED ${field} 23:59:59.999Z on the same UTC day as a midnight firstPaymentDate is accepted`, () => {
      accept(make({ [field]: t('2026-03-23T23:59:59.999Z'), firstPaymentDate: d('2026-03-23') }));
    });
    it(`RED ${field} 00:00:00.001Z vs firstPaymentDate 00:00:00.000Z same UTC day is accepted`, () => {
      accept(make({ [field]: t('2026-03-23T00:00:00.001Z'), firstPaymentDate: d('2026-03-23') }));
    });
    it(`${field} the next UTC day, 1 ms after firstPaymentDate, is rejected naming ${field}`, () => {
      expectRangeErrorNaming(
        () =>
          calculateCobCanada(make({ [field]: t('2026-03-24T00:00:00.000Z'), firstPaymentDate: t('2026-03-23T23:59:59.999Z') })),
        field,
      );
    });
    it(`${field} == firstPaymentDate (both midnight UTC) is accepted (BRD §6: cannot be BEFORE)`, () => {
      accept(make({ [field]: d('2026-03-23'), firstPaymentDate: d('2026-03-23') }));
    });
    it(`${field} one UTC day after firstPaymentDate is rejected naming ${field}`, () => {
      expectRangeErrorNaming(() => calculateCobCanada(make({ [field]: d('2026-03-24'), firstPaymentDate: d('2026-03-23') })), field);
    });
    it(`RED ${field} built from a -04:00 offset string lands on the same UTC day as firstPaymentDate -> accepted`, () => {
      // 2026-03-23T21:00-04:00 == 2026-03-24T01:00Z: same UTC calendar day as a 2026-03-24 first payment.
      accept(make({ [field]: t('2026-03-23T21:00:00-04:00'), firstPaymentDate: d('2026-03-24') }));
    });
  }

  // endDate vs firstPaymentDate: endDate must be strictly after (macro 304).
  it('RED endDate 23:59:59.999Z on firstPaymentDate\'s UTC day is rejected naming endDate', () => {
    expectRangeErrorNaming(
      () => calculateCobCanada(base({ endDate: t('2026-03-23T23:59:59.999Z'), firstPaymentDate: d('2026-03-23') })),
      'endDate',
    );
  });
  it('RED endDate +14:00 offset, same UTC day as firstPaymentDate, is rejected naming endDate', () => {
    // 2026-03-24T13:00+14:00 == 2026-03-23T23:00Z.
    expectRangeErrorNaming(
      () => calculateCobCanada(base({ endDate: t('2026-03-24T13:00:00+14:00'), firstPaymentDate: d('2026-03-23') })),
      'endDate',
    );
  });
  it('endDate the next UTC day, 1 ms after firstPaymentDate, is accepted', () => {
    accept(base({ endDate: t('2026-03-24T00:00:00.000Z'), firstPaymentDate: t('2026-03-23T23:59:59.999Z') }));
  });
  it('endDate the next UTC day at an EARLIER clock time than firstPaymentDate is accepted', () => {
    accept(base({ endDate: t('2026-03-24T01:00:00Z'), firstPaymentDate: t('2026-03-23T23:00:00Z'), disbursalDate: d('2026-03-17') }));
  });
  it('endDate == firstPaymentDate (midnight) stays rejected, naming endDate (macro 304, BRD §6)', () => {
    expectRangeErrorNaming(() => calculateCobCanada(base({ endDate: d('2026-03-23') })), 'endDate');
  });
  it('endDate one UTC day after firstPaymentDate is accepted', () => {
    accept(base({ endDate: d('2026-03-24') }));
  });
});

describe('B3b valid UI-built inputs stay accepted', () => {
  /** Transliteration of ui/ca.js parseDateInput: `YYYY-MM-DD` -> UTC midnight. */
  const parseDateInput = (value: string) => {
    const [y, m, dd] = value.split('-').map(Number) as [number, number, number];
    return new Date(Date.UTC(y, m - 1, dd));
  };
  const wire = loadFixture('ca_app_wire_vectors.json') as {
    vectors: { id: string; request: Record<string, unknown> }[];
  };
  const DATE_FIELDS = ['firstPaymentDate', 'endDate', 'disbursalDate', 'renewalDate', 'semiAnnualCompoundingDate'];

  for (const v of wire.vectors) {
    it(`wire vector ${v.id}, dates built as the UI builds them, is accepted`, () => {
      const out: Record<string, unknown> = { ...v.request };
      for (const f of DATE_FIELDS) if (typeof v.request[f] === 'string') out[f] = parseDateInput(v.request[f] as string);
      expect(() => validateCobCanadaInput(asInput(out))).not.toThrow();
    });
  }

  it('sweep: UI-built midnight dates are accepted iff start <= firstPayment < end (ISO-string oracle)', () => {
    // Deterministic LCG; days chosen near each boundary, across leap days, DST changes and year ends.
    let seed = 20260927;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
    const anchors = ['2024-02-28', '2024-02-29', '2024-03-10', '2025-11-02', '2025-12-31', '2026-03-08', '2026-03-23', '2028-02-29'];
    let accepted = 0;
    let rejected = 0;
    for (let i = 0; i < 3000; i += 1) {
      const fpMs = parseDateInput(anchors[rnd(anchors.length)]!).getTime() + (rnd(5) - 2) * 86_400_000;
      const startIso = iso(fpMs + (rnd(5) - 3) * 86_400_000);
      const fpIso = iso(fpMs);
      const endIso = iso(fpMs + (rnd(5) - 2) * 86_400_000 + (rnd(2) ? 400 * 86_400_000 : 0));
      const expectOk = startIso <= fpIso && endIso > fpIso;
      const flow = rnd(2) ? 'newMortgageOrLoan' : 'renewal';
      const start = parseDateInput(startIso);
      const input =
        flow === 'newMortgageOrLoan'
          ? base({ disbursalDate: start, firstPaymentDate: parseDateInput(fpIso), endDate: parseDateInput(endIso) })
          : existing('renewal', { renewalDate: start, firstPaymentDate: parseDateInput(fpIso), endDate: parseDateInput(endIso) });
      let ok = true;
      try {
        validateCobCanadaInput(input);
      } catch (e) {
        expect(e, `${flow} ${startIso} ${fpIso} ${endIso}`).toBeInstanceOf(RangeError);
        ok = false;
      }
      expect(ok, `${flow} start=${startIso} fp=${fpIso} end=${endIso}`).toBe(expectOk);
      if (ok) accepted += 1;
      else rejected += 1;
    }
    expect(accepted).toBeGreaterThan(300);
    expect(rejected).toBeGreaterThan(300);
  });

  it('output is unchanged by a disbursalDate time-of-day on an earlier UTC day (engine uses calendar days)', () => {
    const midnight = calculateCobCanada(base());
    const noon = calculateCobCanada(base({ disbursalDate: t('2026-03-17T12:34:56.789Z') }));
    expect(noon).toEqual(midnight);
  });
});
