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
 *
 * B33 (DEC-B33-FREQ, 2026-10-05): the goldens regain the personal-loan weekly / bi-weekly / semi-monthly cases B27 had
 * dropped (148 groups, 4,455 cases). The B25 history checks (G1, G3) are re-scoped to the 94 pre-B33 group keys and, inside
 * extra:underpayment, to its monthly cases (the B27 view of the corpus, `B27_VIEW` below); the oracle files
 * (golden_engine_v1_b25_expected.json, b25_golden_pre_group_hashes.json, b25_pre_snapshot.json) stay read-only. G2 now
 * checks that the regenerated golden still CONTAINS the oracle (93 groups byte-identical, the 78 monthly cases of
 * extra:underpayment, the long cases), and the file and PC shas move to B33's values (B33-R8).
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
type CaseDef = { label: string; params: { first: Date; frequency: string; productType: string } };
const groupsDef: { key: string; extra: boolean; cases: CaseDef[] }[] = corpus.buildGroups();
/** B33: the B27 view of the corpus (personal loans at Monthly only), i.e. the corpus the B25 oracle was made from. */
const inB27View = (c: CaseDef): boolean => !(c.params.productType === 'personalLoan' && c.params.frequency !== 'monthly');
const B27_VIEW = groupsDef.map((g) => ({ ...g, cases: g.cases.filter(inB27View) })).filter((g) => g.cases.length > 0);
/** Indices (in the live corpus group) of the cases that are in the B27 view; only extra:underpayment differs (312 -> 78). */
const viewIndices = (key: string): number[] =>
  groupsDef.find((g) => g.key === key)!.cases.flatMap((c, i) => (inB27View(c) ? [i] : []));
const UNDERPAY = 'extra:underpayment';

const EXPECTED_SHA256 = '249651b25b33cb9c1b5480d2ee1a26404d64f3321ea980de2bd3e23193e6cf11';
/** B33-R8: the regenerated v1 golden (148 groups, 4,455 cases). */
const B33_SHA256 = '922fd69580e420957bfaa928a60b553fdbff07b4e92215de81422e901cc93aee';
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
    // B33: the live corpus has 148 groups; its B27 view is the 94-group corpus of the snapshot.
    expect(B27_VIEW.map((g) => g.key)).toEqual(Object.keys(PRE.groups));
    expect(groupsDef).toHaveLength(148);
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
    for (const g of B27_VIEW) {
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

// B33 (DEC-B33-FREQ): was "golden_engine_v1.json == the oracle file"; after B33-R8 the golden CONTAINS the oracle.
describe('B25-T9 G2: golden_engine_v1.json contains the oracle file (B33: 54 groups added, extra:underpayment widened)', () => {
  const keys = Object.keys(EXPECTED.groups);
  it('the oracle keys appear in the same relative order', () => {
    expect(Object.keys(COMMITTED.groups).filter((k) => k in EXPECTED.groups)).toEqual(keys);
  });
  for (const key of keys) {
    it(`${key}: group hash, n and every case tuple equal the oracle${key === UNDERPAY ? ' (B33: its 78 monthly cases)' : ''}`, () => {
      const got = COMMITTED.groups[key];
      const want = EXPECTED.groups[key]!;
      expect(got, `group ${key} missing`).toBeDefined();
      if (key === UNDERPAY) {
        const idx = viewIndices(key);
        expect(idx).toHaveLength(want.n);
        expect(got!.n).toBe(312);
        expect(idx.map((i) => got!.cases[i])).toEqual(want.cases);
        return;
      }
      expect(got!.hash).toBe(want.hash);
      expect(got!.n).toBe(want.n);
      expect(got!.cases).toEqual(want.cases);
    });
  }
  it('the 6 long cases equal the oracle', () => {
    expect(COMMITTED.long).toEqual(EXPECTED.long);
  });
  it('the oracle file keeps its sha256 (249651b2...cf11); the committed golden is B33-R8 (922fd695...3aee)', () => {
    expect(sha256(text('golden_engine_v1_b25_expected.json'))).toBe(EXPECTED_SHA256);
    expect(sha256(text('golden_engine_v1.json'))).toBe(B33_SHA256);
  });
});

describe('B25-T9 G3: the engine on the corpus == the oracle file (independent of the committed golden)', () => {
  let computed: { groups: Record<string, Group>; long: Record<string, unknown> };
  beforeAll(() => {
    computed = corpus.computeGolden((input: CobCanadaInput): CobCanadaResult => calculateCobCanada(input));
  });
  for (const key of Object.keys(EXPECTED.groups)) {
    it(`${key}`, () => {
      if (key === UNDERPAY) {
        // B33: the live corpus group has 312 cases; its 78 monthly ones are the oracle's.
        expect(viewIndices(key).map((i) => computed.groups[key]!.cases[i])).toEqual(EXPECTED.groups[key]!.cases);
        return;
      }
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
  // Re-pinned 2026-10-05 by QA (B33 red step, DEC-B33-FREQ): the PC golden is regenerated by B33-R8 (approved) and equals
  // the archived pre-B27 PC fixture; sha acfe374c...d23e -> 5ab1c6a6...a7df5. B25 itself still changes nothing here.
  it('golden_engine_pc_v1.json is byte-identical (sha256 5ab1c6a6...a7df5, re-pinned for B33)', () => {
    expect(sha256(text('golden_engine_pc_v1.json'))).toBe('5ab1c6a6c086ba737d790bb1e42f2eb36ccd61c3c256e2634a6d5cc312fa7df5');
  });
  // Re-pinned 2026-10-05 by QA (B31 verify): the capture was regenerated for B31 (DEC-B31-LAYOUT, user approved,
  // order and structure of the result figures only); sha 171f8a33... -> ac76408a.... B25 itself still changes nothing here.
  // Re-pinned 2026-10-05 by QA (B32 verify, DEC-B32-TERM): capture regenerated (user approved; term hint, term label
  // and term value strings only); sha ac76408a... -> 9877c0c6....
  // Re-pinned 2026-10-05 by QA (B33 verify, DEC-B33-FREQ): capture regenerated (user approved; scenario PL_WEEKLY
  // appended, scenarios[0..5], formDefaults and flowScreens unchanged); sha 9877c0c6... -> 4d5a64c1....
  it('a10_ui_capture_v1.json is byte-identical (sha256 4d5a64c1...a575, re-pinned for B33)', () => {
    expect(sha256(text('a10_ui_capture_v1.json'))).toBe('4d5a64c1978424b777ea99580f9cbf52659f983ef7c820da268c38e8d88ea575');
  });
});
