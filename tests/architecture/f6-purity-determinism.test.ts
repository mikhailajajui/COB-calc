/**
 * F6 (COB-architecture.md §6): purity and determinism.
 *  1. deepFreeze(input), call twice: no throw, identical JSON.stringify, and identical to a
 *     call on an unfrozen copy (so the engine neither mutates nor depends on mutating input).
 *  2. Timezone independence. §6 asks for a CI script `test:tz` running A0 under
 *     TZ=America/Toronto and TZ=Pacific/Kiritimati. package.json is outside QA's remit here,
 *     so this suite does it in-process instead: it switches process.env.TZ (honoured at
 *     runtime by Node in vitest's default `forks` pool), proves the switch took effect via
 *     getTimezoneOffset, and re-hashes a sample of A0 groups against golden_engine_v1.json.
 *     The full A0 run under both TZs was done by hand (see the A0/A1 hand-off).
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { calculateCobCanada } from '../../src/ca/cobCanada.js';
import type { CobCanadaInput } from '../../src/ca/types.js';
// @ts-ignore -- plain .mjs shared with the A0 generator (no .d.ts); tests are not typechecked yet (F8).
import * as corpus from '../ca/fixtures/generate_golden.mjs';

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o as object)) deepFreeze(v);
  }
  return o;
}

const groups: { key: string; cases: { params: unknown }[] }[] = corpus.buildGroups();
const inputs = (key: string): CobCanadaInput[] => groups.find((g) => g.key === key)!.cases.map((c) => corpus.makeInput(c.params));

describe('F6 purity', () => {
  const params = (key: string, i: number) => groups.find((g) => g.key === key)!.cases[i]!.params;
  const sample: unknown[] = [];
  for (const freq of ['weekly', 'biweekly', 'semiMonthly', 'monthly'])
    for (const flow of ['new', 'renewal850']) sample.push(params(`${freq}|mortgage/variable|fin2000cash400|${flow}`, 13));
  for (const key of ['extra:minimumPayment', 'extra:underpayment']) sample.push(params(key, 2));

  it('F6: frozen input, called twice, gives identical JSON (and equals an unfrozen call)', () => {
    for (const p of sample) {
      const unfrozen = JSON.stringify(calculateCobCanada(corpus.makeInput(p)));
      const frozen: CobCanadaInput = deepFreeze(corpus.makeInput(p));
      expect(Object.isFrozen(frozen) && Object.isFrozen(frozen.fees.fees[0] ?? frozen.fees)).toBe(true);
      const a = JSON.stringify(calculateCobCanada(frozen));
      const b = JSON.stringify(calculateCobCanada(frozen));
      expect(a).toBe(b);
      expect(a).toBe(unfrozen);
    }
  });
});

describe('F6 determinism across timezones (in-process stand-in for `test:tz`)', () => {
  const golden = JSON.parse(
    readFileSync(fileURLToPath(new URL('../ca/fixtures/golden_engine_v1.json', import.meta.url)), 'utf8'),
  ) as { groups: Record<string, { hash: string }> };
  const SAMPLE_GROUPS = [
    'weekly|mortgage/fixed|fin2000cash400|renewal850',
    'biweekly|mortgage/variable|fin2000|new', // B27: DEV-FB24 class D (was biweekly|personalLoan/variable|fin2000|new; the hash is read from the fixture by key)
    'semiMonthly|mortgage/variable|none|renewal0',
    'monthly|personalLoan/fixed|fin2000cash400|new',
    'extra:semiMonthlyMonthEnd',
    'extra:monthlyMonthEnd',
  ];
  // Offsets on 2027-01-01 (minutes, getTimezoneOffset sign convention).
  const ZONES: [string, number][] = [
    ['America/Toronto', 300],
    ['Pacific/Kiritimati', -840],
  ];

  for (const [tz, offset] of ZONES) {
    it(`F6: A0 sample groups hash identically under TZ=${tz}`, () => {
      const saved = process.env.TZ;
      try {
        process.env.TZ = tz;
        expect(new Date(Date.UTC(2027, 0, 1)).getTimezoneOffset()).toBe(offset);
        for (const key of SAMPLE_GROUPS) {
          const json = inputs(key).map((i) => JSON.stringify(calculateCobCanada(i)));
          const hash = createHash('sha256').update(json.join('\n')).digest('hex');
          expect(hash, `group ${key} under TZ=${tz}`).toBe(golden.groups[key]!.hash);
        }
      } finally {
        if (saved === undefined) delete process.env.TZ;
        else process.env.TZ = saved;
      }
    });
  }
});
