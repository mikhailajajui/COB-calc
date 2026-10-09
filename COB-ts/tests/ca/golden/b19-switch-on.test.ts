/**
 * B19 (COB-architecture.md §5 B19, revision 19): the workbook branch is byte-identical to the
 * pre-B19 engine, and the F-1 guard on the PC generator (QA finding F-1 of B18). QA-owned.
 *
 * B19-ON-v1 / B19-ON-pc: `UNPAID_INTEREST_CAPITALISED = true` (WORKBOOK) run over both golden
 * corpora and serialised by the generators' own `serialise` reproduces the PRE-B19 fixtures'
 * sha256 (7,991 cases + 8 long cases), so nothing of today's engine was lost. The committed
 * fixtures themselves are the regenerated (shipped-branch) ones, checked by engineGolden*.test.ts.
 *
 * B19-G (static): `generate_golden_pc.mjs` must import v1's generator only dynamically with
 * `--write` hidden from argv, so `generate_golden_pc.mjs --write` can never rewrite
 * golden_engine_v1.json (F-1). Red-step note: B19-G is green from the start.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { asInput } from '../support/builders.js';
import { LEAP_OFF, WORKBOOK, calculateWith } from '../support/switches.js';
import { rehomeCase } from '../support/rehome.js';
// B27: DEV-FB24 class E -- the corpora are the FROZEN pre-B27 generators (they still hold the personal-loan
// non-monthly cases); every input goes through the twin and the result's triggerRatePercent is restored, so
// the two pins below are the original ones, unchanged.
// @ts-ignore -- plain .mjs (no .d.ts).
import * as v1 from '../fixtures/legacy/generate_golden_pre_b27.mjs';
// @ts-ignore -- plain .mjs (no .d.ts).
import * as pc from '../fixtures/legacy/generate_golden_pc_pre_b27.mjs';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const calc = (x: object) => {
  const { twin, restore } = rehomeCase(x); // B27: DEV-FB24 class E
  // B37 (DEC-B37-LEAP-N): workbook converter (n = 52/26), switch off (B37-D2: the workbook-branch replays run leap off).
  return restore(calculateWith(asInput(twin), WORKBOOK, LEAP_OFF));
};

describe('B19 switch on = pre-B19 engine, byte for byte', () => {
  // B25 (DEV-OQZ): the pin is re-taken. The workbook branch is still pre-B19 byte for byte EXCEPT that a typed semi-monthly first
  // date that is not a 15th / month-end is now moved forward first. Pre-B25 value: 27a28c35...6519. New value f2096f62...806e =
  // the pre-B25 engine on the same corpus with those first dates replaced by the oracle's moved dates (B25-INV-equiv).
  it('B19-ON-v1: workbook branch reproduces golden v1 as of B18 plus the B25 move (sha f2096f62...806e; pre-B25 27a28c35...6519)', () => {
    expect(sha256(v1.serialise(v1.computeGolden(calc)))).toBe(
      'f2096f62209426f1c773948526ecb289c76be788679d4b9e1711ea2a0459806e',
    );
  }, 60_000);

  it('B19-ON-pc: workbook branch reproduces golden PC as of B18 (sha 337a9346...1a12)', () => {
    expect(sha256(pc.serialise(pc.computeGolden(calc)))).toBe(
      '337a93467acf48742667087702b4504c6451cbb0b57f841f89adaddaffa81a12',
    );
  }, 60_000);
});

describe('B19-G', () => {
  const src = readFileSync(fileURLToPath(new URL('../fixtures/generate_golden_pc.mjs', import.meta.url)), 'utf8');
  // Comments are not code: blank them line by line (the file header mentions the import).
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .split('\n')
    .map((l) => l.replace(/^\s*\/\/.*$/, ''))
    .join('\n');

  it('B19-G: generate_golden_pc.mjs cannot rewrite the v1 fixture (F-1): dynamic import behind the argv filter, own default target', () => {
    expect(code).not.toMatch(/^\s*import\b[^;]*from\s*['"]\.\/generate_golden\.mjs['"]/m);
    expect(code.match(/await import\(\s*['"]\.\/generate_golden\.mjs['"]\s*\)/g)?.length).toBe(1);
    const flat = code.replace(/\s+/g, ' ');
    expect(flat).toMatch(
      /process\.argv = argv\.filter\(\(a\) => a !== '--write'\); const v1 = await import\('\.\/generate_golden\.mjs'\); process\.argv = argv;/,
    );
    expect(code).toMatch(/const argv = process\.argv;/);
    // Its default write target is golden_engine_pc_v1.json (never golden_engine_v1.json).
    expect(code).toMatch(/new URL\(\s*'\.\/golden_engine_pc_v1\.json'\s*,\s*import\.meta\.url\s*\)/);
    expect(code).not.toMatch(/golden_engine_v1\.json/);
  });
});
