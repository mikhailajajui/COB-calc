/**
 * A12b (COB-architecture.md §5 A12b, revision 14): characterisation tests S1-S8 for the shared
 * test-support modules. QA-owned; written green on creation. The developer must not edit this file.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT } from '../../architecture/support.js';
import { expectRangeErrorMatching, expectRelFloor1, relDiffFloor1, withinRel } from './compare.js';
import { asInput, isoDay, utcDate, wireToInput } from './builders.js';
import { FIXTURES_DIR, loadFixture } from './fixtures.js';
import { calculateCobCanada } from '../../../src/ca/index.js';
import { BOTH, SHIPPED, WORKBOOK, calculateWith } from './switches.js';

describe('A12b test support', () => {
  it('S1 withinRel: symmetric relative error with the exact / near-zero rules', () => {
    const t: [number, number, number][] = [
      [1, 1, 0],
      [0, 1e-12, 1e-15],
      [NaN, NaN, 1e-9],
      [-0, 0, 0],
      [1, 1 + 0.5e-9, 1e-9],
    ];
    const f: [number, number, number][] = [
      [1, 1 + 2e-9, 1e-9],
      [NaN, 1, 1],
      [Infinity, 1, 1],
    ];
    for (const [a, e, tol] of t) expect(withinRel(a, e, tol), `withinRel(${a}, ${e}, ${tol})`).toBe(true);
    for (const [a, e, tol] of f) expect(withinRel(a, e, tol), `withinRel(${a}, ${e}, ${tol})`).toBe(false);
  });

  it('S2 relDiffFloor1: |a-e| / max(|e|, 1)', () => {
    expect(relDiffFloor1(0.5, 0)).toBe(0.5);
    expect(relDiffFloor1(-3, -2)).toBe(0.5);
    expect(relDiffFloor1(110, 100)).toBeCloseTo(0.1, 12);
  });

  it('S3 expectRelFloor1: passes within tol, fails with the given message outside it', () => {
    expect(() => expectRelFloor1(100 + 1e-8, 100, 1e-9)).not.toThrow();
    expect(() => expectRelFloor1(101, 100, 1e-3, 'ctx')).toThrow(/ctx/);
  });

  it('S4 expectRangeErrorMatching: only a RangeError whose message matches passes', () => {
    expect(() =>
      expectRangeErrorMatching(() => {
        throw new RangeError('x foo');
      }, /foo/),
    ).not.toThrow();
    expect(() =>
      expectRangeErrorMatching(() => {
        throw new TypeError('x foo');
      }, /foo/),
    ).toThrow();
    expect(() => expectRangeErrorMatching(() => undefined, /foo/)).toThrow();
    expect(() =>
      expectRangeErrorMatching(() => {
        throw new RangeError('bar');
      }, /foo/),
    ).toThrow();
  });

  it('S5 utcDate / isoDay: UTC midnight in, UTC calendar date out', () => {
    expect(utcDate('2028-02-29').toISOString()).toBe('2028-02-29T00:00:00.000Z');
    expect(isoDay(new Date('2027-03-01T23:59:59.999Z'))).toBe('2027-03-01');
  });

  it('S6 wireToInput: shallow copy, string dates to UTC midnights, no mutation, no added keys', () => {
    const fees = { fees: [{ name: 'Appraisal', amount: 300, financed: false, includedInCob: true }] };
    const keep = new Date('2031-01-01T00:00:00Z');
    const request = {
      flow: 'renewal',
      loanAmount: 250000,
      firstPaymentDate: '2026-04-01',
      endDate: '2031-03-01',
      renewalDate: '2026-03-01',
      semiAnnualCompoundingDate: '2026-09-01',
      fees,
    };
    const before = JSON.stringify(request);
    const out = wireToInput(request) as unknown as Record<string, unknown>;
    expect(out).not.toBe(request);
    expect(JSON.stringify(request)).toBe(before);
    for (const [k, v] of [
      ['firstPaymentDate', '2026-04-01'],
      ['endDate', '2031-03-01'],
      ['renewalDate', '2026-03-01'],
      ['semiAnnualCompoundingDate', '2026-09-01'],
    ] as const) {
      expect(out[k], k).toBeInstanceOf(Date);
      expect((out[k] as Date).toISOString(), k).toBe(`${v}T00:00:00.000Z`);
    }
    expect(out.fees).toBe(fees);
    expect(Object.keys(out)).toEqual(Object.keys(request));
    const withDate = wireToInput({ endDate: keep }) as unknown as Record<string, unknown>;
    expect(withDate.endDate).toBe(keep);
    expect(Object.keys(wireToInput({ endDate: '2027-01-01' }))).toEqual(['endDate']);
  });

  it('S7 asInput returns its argument', () => {
    const o = { anything: 1 };
    expect(asInput(o)).toBe(o);
  });

  it('S8 FIXTURES_DIR / loadFixture: tests/ca/fixtures/, parsed as JSON', () => {
    expect(FIXTURES_DIR).toBe(join(ROOT, 'tests', 'ca', 'fixtures') + '/');
    const direct: unknown = JSON.parse(readFileSync(join(ROOT, 'tests', 'ca', 'fixtures', 'ca_appendix_a.json'), 'utf8'));
    expect(loadFixture('ca_appendix_a.json')).toEqual(direct);
  });

  it('S9 switches (B19): SHIPPED equals calculateCobCanada; WORKBOOK / SHIPPED exact and frozen; BOTH order', () => {
    const x = wireToInput({
      flow: 'newMortgageOrLoan',
      productType: 'personalLoan',
      rateType: 'fixed',
      loanAmount: 100000,
      fees: { fees: [] },
      contractRatePercent: 6,
      paymentAmount: 400,
      paymentFrequency: 'monthly',
      disbursalDate: '2026-12-01',
      firstPaymentDate: '2027-01-01',
      endDate: '2029-01-01',
      termYears: 2,
      termMonths: 0,
    });
    expect(JSON.stringify(calculateWith(x, SHIPPED))).toBe(JSON.stringify(calculateCobCanada(x)));
    expect(WORKBOOK).toEqual({ unpaidInterestCapitalised: true });
    expect(SHIPPED).toEqual({ unpaidInterestCapitalised: false });
    expect(Object.isFrozen(WORKBOOK) && Object.isFrozen(SHIPPED)).toBe(true);
    expect(BOTH.map(([, s]) => s)).toEqual([WORKBOOK, SHIPPED]);
    expect(BOTH[0]![1]).toBe(WORKBOOK);
    expect(BOTH[1]![1]).toBe(SHIPPED);
  });
});
