/**
 * B10 (COB-architecture.md §5 B10, revision 11): stop requiring `includedInCob`. QA step written
 * 2026-09-29, before the developer step. The developer must not edit these assertions.
 *
 * Sources (all settled, no business choice here):
 *   - User decision 2026-09-29 (COB-user-stories.md §7.5 "B10 acknowledged"): a fee without the
 *     flag is accepted and counted in full in C (OQ-E); the flag is never read; nothing changes on
 *     screen; a flag that is present but not a boolean (e.g. "yes") is still rejected.
 *   - OQ-E: C = total interest + financed fees + non-financed fees, all fees in full.
 *   - Macro reference/workbook-macro-source.txt:562 `COB = intAccrued + finFee + nonFinFee`; the
 *     macro has no inclusion flag at all, so B10 is not a deviation from Excel.
 *   - Rule B10-R1 (validateFee): undefined (absent / own undefined) and booleans are accepted;
 *     any other value, including null, is a RangeError with exactly
 *     `${label}.includedInCob must be a boolean if present, got ${String(v)}`, label = fee name
 *     or `fees.fees[<index>]`; still the last check in validateFee (interim wording, Q-MSG).
 *   - Rule B10-R2: totalFeesIncludedInCob is deleted. Rule B10-R4: ui/ca.js no longer sends it.
 *
 * Tests:
 *   B10-1  whole golden corpus (every fee-bearing case of buildGroups + buildLongCases, 3,213 of
 *          4,461): flag true / false / key deleted / own undefined on every fee gives the same
 *          JSON.stringify output as the unmodified case.            (red: deleted, undefined)
 *   B10-2  concrete accepts; a flagless fee equals its `true` twin and adds its amount to C. (red)
 *   B10-3  present non-boolean values rejected with the exact B10-R1 message.             (red)
 *   B10-4  message order: amount and financed checks still come first.                   (green)
 *   B10-5  never read: totalFeesIncludedInCob gone; `includedInCob` only in the types.ts
 *          declaration and fees.ts validateFee (comments stripped); nowhere in ui/.        (red)
 * No date sequences asserted, so this file does not join `test:tz`. Golden is not regenerated.
 */
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { calculateCobCanada } from '../../src/ca/index.js';
import { validateFee, validateFeeSchedule } from '../../src/ca/fees.js';
import type { CobCanadaInput, Fee } from '../../src/ca/index.js';
import { listFiles, read, rel, ROOT, SRC_CA, stripComments } from '../architecture/support.js';
// @ts-ignore -- plain .mjs shared with the golden generator (no .d.ts); tests are not typechecked (F8).
import * as legacyCorpus from './fixtures/legacy/generate_golden_pre_b27.mjs';
import { rehome } from './support/rehome.js';

// B27: DEV-FB24 class G -- the corpus is the FROZEN pre-B27 generator (4,461 cases, 3,213 with a fee, as before),
// and every input goes through the twin (a personal loan at a non-monthly frequency becomes the same-frequency
// variable mortgage), so the counts and the assertions below are unchanged.
const corpus = {
  buildGroups: legacyCorpus.buildGroups,
  buildLongCases: legacyCorpus.buildLongCases,
  makeInput: (p: unknown) => rehome(legacyCorpus.makeInput(p)),
};

type Params = { feeSet: string };
type Case = { key: string; params: Params };

const ABSENT = Symbol('absent');

function outcome(input: CobCanadaInput): string {
  try {
    return 'OK ' + JSON.stringify(calculateCobCanada(input));
  } catch (e) {
    return `THROW ${(e as Error).constructor.name}: ${(e as Error).message}`;
  }
}

/** A copy of `input` whose every fee has its flag replaced by `v` (or deleted for ABSENT). */
function withFlag(input: CobCanadaInput, v: unknown): CobCanadaInput {
  const fees = input.fees.fees.map((f) => {
    const g: Record<string, unknown> = { ...f };
    if (v === ABSENT) delete g.includedInCob;
    else g.includedInCob = v;
    return g as unknown as Fee;
  });
  return { ...input, fees: { fees } };
}

/** The exception thrown by `fn` (fails the test if nothing is thrown). */
function thrown(fn: () => unknown): Error {
  try {
    fn();
  } catch (e) {
    return e as Error;
  }
  return expect.fail('expected a throw, got none');
}

const allCases: Case[] = [
  ...(corpus.buildGroups() as { cases: { label: string; params: Params }[] }[]).flatMap((g) =>
    g.cases.map((c) => ({ key: c.label, params: c.params })),
  ),
  ...(corpus.buildLongCases() as { key: string; params: Params }[]).map((c) => ({ key: c.key, params: c.params })),
];
const feeCases = allCases.filter((c) => (corpus.makeInput(c.params) as CobCanadaInput).fees.fees.length > 0);

// ---------------------------------------------------------------------------------------------
describe('B10-1 flag accepted and ignored across the golden corpus (OQ-E; user 2026-09-29)', () => {
  it('the corpus has 4,461 cases, 3,213 of them with at least one fee, all flagged true', () => {
    expect(allCases).toHaveLength(4461);
    expect(feeCases).toHaveLength(3213);
    const flags = new Set(
      feeCases.flatMap((c) => (corpus.makeInput(c.params) as CobCanadaInput).fees.fees.map((f) => f.includedInCob)),
    );
    expect([...flags]).toEqual([true]);
  });

  const VARIANTS: [string, unknown][] = [
    ['true', true],
    ['false', false],
    ['key deleted', ABSENT],
    ['own undefined', undefined],
  ];
  it.each(VARIANTS)('flag %s on every fee: output identical to the unmodified case', (_name, v) => {
    const bad: string[] = [];
    let threw = 0;
    for (const c of feeCases) {
      const base = outcome(corpus.makeInput(c.params) as CobCanadaInput);
      const got = outcome(withFlag(corpus.makeInput(c.params) as CobCanadaInput, v));
      if (got.startsWith('THROW')) threw++;
      if (got !== base) bad.push(`${c.key}: ${got.slice(0, 200)}`);
    }
    expect(bad.slice(0, 5), `${bad.length} of ${feeCases.length} cases differ`).toEqual([]);
    // Guard against a vacuous pass: the corpus is all-valid, so no variant may throw.
    expect(threw).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------
describe('B10-2 a fee without the flag is accepted and counted in full in C', () => {
  it('validateFee accepts a flagless fee and an own-undefined flag', () => {
    expect(() => validateFee({ name: 'Ambiguous fee', amount: 100, financed: false }, 0)).not.toThrow();
    expect(() => validateFee({ name: 'Ambiguous fee', amount: 100, financed: false, includedInCob: undefined }, 0)).not.toThrow();
  });

  it('validateFee still accepts true and false', () => {
    expect(() => validateFee({ name: 'T', amount: 1, financed: true, includedInCob: true }, 0)).not.toThrow();
    expect(() => validateFee({ name: 'F', amount: 1, financed: true, includedInCob: false }, 0)).not.toThrow();
  });

  // spec011 P0 (spec011.test.ts p0), inlined.
  const p0 = (fees: Fee[]): CobCanadaInput => ({
    flow: 'newMortgageOrLoan',
    productType: 'personalLoan',
    rateType: 'fixed',
    loanAmount: 10000,
    contractRatePercent: 6,
    paymentAmount: 500,
    paymentFrequency: 'monthly',
    disbursalDate: new Date('2026-01-01'),
    firstPaymentDate: new Date('2026-02-01'),
    endDate: new Date('2026-12-01'),
    termYears: 1,
    termMonths: 0,
    fees: { fees },
  });

  it('spec011 P0 with a flagless cash fee equals the same input with includedInCob: true', () => {
    const flagless = p0([{ name: 'X', amount: 1, financed: false }]);
    expect(() => calculateCobCanada(flagless)).not.toThrow();
    expect(calculateCobCanada(flagless)).toEqual(calculateCobCanada(p0([{ name: 'X', amount: 1, financed: false, includedInCob: true }])));
  });

  it('spec011 P0 with a flagless financed fee equals the same input with includedInCob: true', () => {
    const flagless = p0([{ name: 'Admin', amount: 300, financed: true }]);
    expect(calculateCobCanada(flagless)).toEqual(
      calculateCobCanada(p0([{ name: 'Admin', amount: 300, financed: true, includedInCob: true }])),
    );
  });

  it('a flagless cash fee adds its full amount to C (OQ-E: C = interest + financed + cash fees)', () => {
    // A cash fee never enters principal, so interest is unchanged and C rises by exactly the fee.
    const none = calculateCobCanada(p0([]));
    const withFee = calculateCobCanada(p0([{ name: 'X', amount: 250, financed: false }]));
    expect(withFee.totalInterest).toBe(none.totalInterest);
    expect(withFee.cobAmount - none.cobAmount).toBeCloseTo(250, 9);
  });
});

// ---------------------------------------------------------------------------------------------
describe('B10-3 a present non-boolean flag is rejected (user 2026-09-29; B10-R1 message)', () => {
  // A golden case whose first fee is `Financed fee` (fee set fin2000cash400).
  const golden = feeCases.find((c) => c.params.feeSet === 'fin2000cash400')!;
  const base = () => corpus.makeInput(golden.params) as CobCanadaInput;

  it('the chosen golden case is valid as generated and its first fee is "Financed fee"', () => {
    expect(base().fees.fees[0]!.name).toBe('Financed fee');
    expect(outcome(base()).startsWith('OK')).toBe(true);
  });

  const CASES: [string, unknown, string][] = [
    ["'yes'", 'yes', 'yes'],
    ["'true'", 'true', 'true'],
    ['null', null, 'null'],
    ['0', 0, '0'],
    ['1', 1, '1'],
    ['NaN', NaN, 'NaN'],
    ['{}', {}, '[object Object]'],
    ['[]', [], ''],
    ["Symbol('s')", Symbol('s'), 'Symbol(s)'],
  ];
  it.each(CASES)('includedInCob %s is rejected with the exact B10-R1 message', (_n, v, s) => {
    const e = thrown(() => calculateCobCanada(withFlag(base(), v)));
    expect(e).toBeInstanceOf(RangeError);
    expect(e.message).toBe(`Financed fee.includedInCob must be a boolean if present, got ${s}`);
  });

  it('nameless fee: labelled fees.fees[1]; the flagless first fee passes', () => {
    const fees = [
      { name: 'A', amount: 100, financed: true },
      { name: '', amount: 5, financed: false, includedInCob: 'yes' },
    ] as unknown as Fee[];
    const msg = 'fees.fees[1].includedInCob must be a boolean if present, got yes';
    const e1 = thrown(() => validateFeeSchedule({ fees }));
    expect(e1).toBeInstanceOf(RangeError);
    expect(e1.message).toBe(msg);
    const e2 = thrown(() => calculateCobCanada({ ...base(), fees: { fees } }));
    expect(e2).toBeInstanceOf(RangeError);
    expect(e2.message).toBe(msg);
  });
});

// ---------------------------------------------------------------------------------------------
describe('B10-4 the flag check stays last in validateFee (message order unchanged)', () => {
  it('a non-boolean financed is reported before a non-boolean includedInCob', () => {
    const e = thrown(() => validateFee({ name: 'X', amount: 1, financed: 'x', includedInCob: 'yes' } as unknown as Fee, 0));
    expect(e).toBeInstanceOf(RangeError);
    expect(e.message).toBe('X.financed must be a boolean, got x');
  });

  it('a negative amount is reported before a non-boolean includedInCob', () => {
    const e = thrown(() => validateFee({ name: 'X', amount: -1, financed: false, includedInCob: 'yes' } as unknown as Fee, 0));
    expect(e).toBeInstanceOf(RangeError);
    expect(e.message).toBe('X amount must be >= 0, got -1');
  });
});

// ---------------------------------------------------------------------------------------------
describe('B10-5 the flag is never read (B10-R2, B10-R4)', () => {
  it('fees.ts no longer exports totalFeesIncludedInCob', async () => {
    const mod = await import('../../src/ca/fees.js');
    expect('totalFeesIncludedInCob' in mod).toBe(false);
  });

  it('in src/ca code (comments stripped) includedInCob appears only in the types.ts declaration and fees.ts validateFee', () => {
    const hits: string[] = [];
    for (const f of listFiles(SRC_CA, /\.ts$/)) {
      const code = stripComments(read(f));
      const lines = code.split('\n');
      let vfStart = -1;
      let vfEnd = -1;
      if (rel(f) === 'src/ca/fees.ts') {
        vfStart = lines.findIndex((l) => /^export function validateFee\(/.test(l));
        vfEnd = lines.findIndex((l, i) => i > vfStart && /^}/.test(l));
      }
      lines.forEach((l, i) => {
        if (!/includedInCob/.test(l)) return;
        if (rel(f) === 'src/ca/types.ts' && /^\s*includedInCob\?: boolean;\s*$/.test(l)) return;
        if (rel(f) === 'src/ca/fees.ts' && vfStart >= 0 && i > vfStart && i < vfEnd) return;
        hits.push(`${rel(f)}:${i + 1} ${l.trim()}`);
      });
    }
    expect(hits).toEqual([]);
    // The declaration is still there (the public type is unchanged: optional boolean).
    const types = stripComments(read(join(SRC_CA, 'types.ts')));
    expect(types.match(/includedInCob\?: boolean;/g)).toHaveLength(1);
  });

  it('no file in ui/ (.js, .mjs, .html) mentions includedInCob', () => {
    const hits = listFiles(join(ROOT, 'ui'), /\.(js|mjs|html)$/).flatMap((f) =>
      read(f)
        .split('\n')
        .flatMap((l, i) => (/includedInCob/.test(l) ? [`${rel(f)}:${i + 1} ${l.trim()}`] : [])),
    );
    expect(hits).toEqual([]);
  });
});
