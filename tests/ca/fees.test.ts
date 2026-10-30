import { describe, expect, it } from 'vitest';
import {
  totalCashFees,
  totalFinancedFees,
  validateFee,
  validateFeeSchedule,
} from '../../src/ca/fees.js';
import type { Fee, FeeSchedule } from '../../src/ca/index.js';
import { join } from 'node:path';
import { listFiles, read, rel, ROOT } from '../architecture/support.js';

// A schedule deliberately mirroring spec 006's own example (mortgage default
// insurance: financed but NOT COB-included; an appraisal fee: COB-included but NOT
// financed) so the two flags visibly don't coincide.
const schedule: FeeSchedule = {
  fees: [
    { name: 'CMHC premium', amount: 19000, financed: true, includedInCob: false },
    { name: 'Appraisal fee', amount: 400, financed: false, includedInCob: true },
    { name: 'Discharge fee (prior lender)', amount: 250, financed: false, includedInCob: false },
  ],
};

describe('FeeSchedule aggregates', () => {
  it('happy path: sums each aggregate independently by its own flag', () => {
    expect(totalFinancedFees(schedule)).toBe(19000);
    expect(totalCashFees(schedule)).toBe(650);
    // B10 (user 2026-09-29): totalFeesIncludedInCob is retired; the flag is never read.
    // A17: the all-fees total is now only the B2-R1 grouping (financed + cash); the two groups
    // partition the schedule, so together they still account for every fee.
    expect(totalFinancedFees(schedule) + totalCashFees(schedule)).toBe(19650);
  });

  it('edge case: an empty fee list totals to zero everywhere', () => {
    const empty: FeeSchedule = { fees: [] };
    expect(totalFinancedFees(empty)).toBe(0);
    expect(totalCashFees(empty)).toBe(0);
  });

  it('a fee with includedInCob left undefined is summed by financed alone (B10: the flag is never read)', () => {
    const withUnset: FeeSchedule = {
      fees: [{ name: 'Legacy US-style fee', amount: 500, financed: false }],
    };
    expect(totalCashFees(withUnset)).toBe(500);
  });
});

describe('A17 guard: totalFees() is retired (COB-architecture.md §5 A17)', () => {
  // Red until the developer deletes fees.ts totalFees. One list-order sum over all fees would
  // bypass the B2-R1 grouping (fee limit, C, zero-fee branch); one home per rule.
  it('fees.ts no longer exports totalFees and nothing in src/ or ui/ references it', async () => {
    const mod = await import('../../src/ca/fees.js');
    expect('totalFees' in mod).toBe(false);
    const files = [...listFiles(join(ROOT, 'src'), /\.ts$/), ...listFiles(join(ROOT, 'ui'), /\.(js|mjs|html)$/)];
    const hits = files.flatMap((f) =>
      read(f)
        .split('\n')
        .flatMap((l, i) => (/\btotalFees\b/.test(l) ? [`${rel(f)}:${i + 1} ${l.trim()}`] : [])),
    );
    expect(hits).toEqual([]);
  });
});

describe('validateFee', () => {
  it('happy path: a fully-specified fee passes', () => {
    expect(() => validateFee({ name: 'Appraisal', amount: 400, financed: false, includedInCob: true }, 0)).not.toThrow();
  });

  it('edge case: a zero-amount fee is valid (boundary, not negative)', () => {
    expect(() => validateFee({ name: 'Waived fee', amount: 0, financed: false, includedInCob: false }, 0)).not.toThrow();
  });

  it('throws RangeError on a negative amount', () => {
    expect(() => validateFee({ name: 'Bad fee', amount: -1, financed: false, includedInCob: false }, 0)).toThrow(
      RangeError,
    );
  });

  it('accepts a fee with includedInCob left unset (B10, OQ-E, user 2026-09-29: counted in full in C)', () => {
    const fee = { name: 'Ambiguous fee', amount: 100, financed: false } as Fee;
    expect(() => validateFee(fee, 0)).not.toThrow();
  });

  it('validateFeeSchedule validates every fee in the list', () => {
    const bad: FeeSchedule = {
      fees: [
        { name: 'Ok fee', amount: 100, financed: false, includedInCob: true },
        { name: 'Bad fee', amount: -5, financed: false, includedInCob: true },
      ],
    };
    expect(() => validateFeeSchedule(bad)).toThrow(RangeError);
  });
});
