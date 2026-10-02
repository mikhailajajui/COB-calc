/**
 * B25-T9 (COB-architecture.md section 5 B25, revision 39; DEV-OQZ): golden and fixture invariance, and the check on the
 * regeneration of golden_engine_v1.json. QA-owned.
 *
 * The regeneration of golden_engine_v1.json (sr-dev, approved behaviour change; the generator is
 * `npx vite-node tests/ca/fixtures/generate_golden.mjs --write`) must give exactly QA's oracle file
 * fixtures/golden_engine_v1_b25_expected.json. That file was made from the PRE-B25 engine fed the MOVED first dates of the
 * Python oracle (generate_b25_semimonthly_move_vectors.py -> generate_b25_expected_golden.mjs), so it does not depend on the
 * engine change it checks. Measured on the pre-B25 golden (fixtures/b25_golden_pre_group_hashes.json): 20 of 94 groups and
 * 504 of 2,817 cases change; the other 74 groups and the 6 long cases are byte-identical.
 *
 *   G1  the oracle file against the pre-B25 snapshot: exactly the 20 listed groups change, 504 cases, per-case rule.
 *   G2  golden_engine_v1.json == the oracle file (every group, every case tuple, the long cases, the file sha256).
 *       RED until sr-dev regenerates; then green and permanent.
 *   G3  the engine on the corpus == the oracle file (independent of the committed golden; RED until the engine is fixed).
 *   G4  the Payment Change golden and the A10 UI capture fixture are byte-identical to before (sha256 pins).
 * Red-step note: G1 and G4 are green from the start (they pin the oracle and the untouched fixtures).
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { calculateCobCanada } from '../../../src/ca/cobCanada.js';
import type { CobCanadaInput, CobCanadaResult } from '../../../src/ca/types.js';
// @ts-ignore -- plain .mjs shared with the generator (no .d.ts).
import * as corpus from '../fixtures/generate_golden.mjs';

interface Group { hash: string; n: number; cases: (string | number | null)[][] }
interface GoldenFile { groups: Record<string, Group>; long: Record<string, unknown> }
interface PreGroups { fileSha256: string; groups: Record<string, { hash: string; n: number; cases: string[] }> }

const fx = (name: string) => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));
const text = (name: string) => readFileSync(fx(name), 'utf8');
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const COMMITTED = JSON.parse(text('golden_engine_v1.json')) as GoldenFile;
const EXPECTED = JSON.parse(text('golden_engine_v1_b25_expected.json')) as GoldenFile;
const PRE = JSON.parse(text('b25_golden_pre_group_hashes.json')) as PreGroups;
const groupsDef: { key: string; extra: boolean; cases: { label: string; params: { first: Date; frequency: string } }[] }[] =
  corpus.buildGroups();

const EXPECTED_SHA256 = '249651b25b33cb9c1b5480d2ee1a26404d64f3321ea980de2bd3e23193e6cf11';
const PRE_SHA256 = 'b7c36e65a859c956e2341c316f64b165265945bad3b148654ef64b0279c98235';

/** The 20 groups B25 changes: 18 regular semi-monthly mortgage groups + extra:minimumPayment + extra:semiMonthlyMonthEnd. */
const CHANGED_KEYS = [
  ...['fixed', 'variable'].flatMap((rate) =>
    ['none', 'fin2000', 'fin2000cash400'].flatMap((fees) =>
      ['new', 'renewal0', 'renewal850'].map((flow) => `semiMonthly|mortgage/${rate}|${fees}|${flow}`),
    ),
  ),
  'extra:minimumPayment',
  'extra:semiMonthlyMonthEnd',
];

const isMovedDate = (first: Date): boolean => {
  const day = first.getUTCDate();
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return day !== 15 && day !== last;
};

describe('B25-T9 G1: the oracle file against the pre-B25 snapshot (what the move changes, and only that)', () => {
  it('the snapshot is the pre-B25 golden (sha256 b7c36e65...) and has 94 groups', () => {
    expect(PRE.fileSha256).toBe(PRE_SHA256);
    expect(Object.keys(PRE.groups)).toHaveLength(94);
    expect(Object.keys(EXPECTED.groups)).toEqual(Object.keys(PRE.groups));
    expect(groupsDef.map((g) => g.key)).toEqual(Object.keys(PRE.groups));
  });

  it('exactly the 20 listed groups change their group hash; the other 74 are identical', () => {
    const changed = Object.keys(PRE.groups).filter((k) => PRE.groups[k]!.hash !== EXPECTED.groups[k]!.hash);
    expect(changed.sort()).toEqual([...CHANGED_KEYS].sort());
    expect(CHANGED_KEYS).toHaveLength(20);
  });

  it('504 of 2,817 cases change; a case changes exactly when its semi-monthly first date is moved (unmoved dates keep hash16)', () => {
    let changedCases = 0;
    let total = 0;
    const wrong: string[] = [];
    for (const g of groupsDef) {
      g.cases.forEach((c, i) => {
        total += 1;
        const was = PRE.groups[g.key]!.cases[i]!;
        const now = EXPECTED.groups[g.key]!.cases[i]![0];
        const shouldMove = c.params.frequency === 'semiMonthly' && isMovedDate(c.params.first);
        if (was !== now) changedCases += 1;
        if ((was !== now) !== shouldMove) wrong.push(`${g.key} #${i} ${c.label}`);
      });
    }
    expect(total).toBe(2817);
    expect(wrong.slice(0, 5)).toEqual([]);
    expect(changedCases).toBe(504);
  });

  it('the 6 long cases are identical to the snapshot of the committed pre-B25 golden (none is semi-monthly)', () => {
    expect(Object.keys(EXPECTED.long)).toHaveLength(6);
    // the snapshot holds no long cases; G3 compares them with the engine, G2 with the committed file.
    for (const [k, v] of Object.entries(EXPECTED.long)) expect(k.startsWith('long:semiMonthly'), k).toBe(false);
    expect(v1LongKeys()).toEqual(Object.keys(EXPECTED.long));
  });

  it('the oracle file has the expected sha256 (QA records it; the regenerated golden must have the same bytes)', () => {
    expect(sha256(text('golden_engine_v1_b25_expected.json'))).toBe(EXPECTED_SHA256);
  });
});
function v1LongKeys(): string[] {
  return (corpus.buildLongCases() as { key: string }[]).map((c) => c.key);
}

describe('B25-T9 G2: golden_engine_v1.json == the oracle file (red until the approved regeneration)', () => {
  const keys = Object.keys(EXPECTED.groups);
  it('same group keys in the same order', () => {
    expect(Object.keys(COMMITTED.groups)).toEqual(keys);
  });
  for (const key of keys) {
    it(`${key}: group hash, n and every case tuple equal the oracle`, () => {
      const got = COMMITTED.groups[key];
      const want = EXPECTED.groups[key]!;
      expect(got, `group ${key} missing`).toBeDefined();
      expect(got!.hash).toBe(want.hash);
      expect(got!.n).toBe(want.n);
      expect(got!.cases).toEqual(want.cases);
    });
  }
  it('the 6 long cases equal the oracle', () => {
    expect(COMMITTED.long).toEqual(EXPECTED.long);
  });
  it('the file is byte-identical to the oracle file (sha256 249651b2...cf11): same serialiser, no hand edit', () => {
    expect(sha256(text('golden_engine_v1.json'))).toBe(EXPECTED_SHA256);
  });
});

describe('B25-T9 G3: the engine on the corpus == the oracle file (independent of the committed golden)', () => {
  let computed: { groups: Record<string, Group>; long: Record<string, unknown> };
  beforeAll(() => {
    computed = corpus.computeGolden((input: CobCanadaInput): CobCanadaResult => calculateCobCanada(input));
  });
  for (const key of Object.keys(EXPECTED.groups)) {
    it(`${key}`, () => {
      expect(computed.groups[key]!.hash).toBe(EXPECTED.groups[key]!.hash);
      expect(computed.groups[key]!.cases).toEqual(EXPECTED.groups[key]!.cases);
    });
  }
  it('the 6 long cases', () => {
    const shaped = Object.fromEntries(
      Object.entries(computed.long).map(([k, v]) => {
        const { amortizationSchedule, ...scalars } = v as Record<string, unknown>;
        return [k, { scalars, amortizationSchedule }];
      }),
    );
    expect(shaped).toEqual(EXPECTED.long);
  });
});

describe('B25-T9 G4: the Payment Change golden and the A10 UI capture fixture do not change', () => {
  it('golden_engine_pc_v1.json is byte-identical (sha256 acfe374c...d23e)', () => {
    expect(sha256(text('golden_engine_pc_v1.json'))).toBe('acfe374c6def2cea5bb723c8c639a72e0088aed7f8c952b561d724bd8d26d23e');
  });
  it('a10_ui_capture_v1.json is byte-identical (sha256 5a314af0...1ae7)', () => {
    expect(sha256(text('a10_ui_capture_v1.json'))).toBe('5c6c69b556cb9471d38031b8b4e99f5bae3615db63ef8d5b9a2c2591b22c2190');
  });
});
