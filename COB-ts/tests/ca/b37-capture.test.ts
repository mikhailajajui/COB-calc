/**
 * B37 (COB-architecture.md §5 B37, revision 56/57; DEC-B37-LEAP-N; deviation DEV-B37-LEAPN): the fixtures after their
 * approved regeneration (user, 2026-10-09). QA-owned; the developer must not edit this file.
 *
 * 1. Goldens: compared group by group with QA's pre-B37 pin (b37_pre_golden_group_hashes.json, recorded before any B37
 *    change). Only the 18 v1 groups `{weekly,biweekly}|mortgage/fixed|{none,fin2000,fin2000cash400}|{new,renewal0,renewal850}`,
 *    the 4 weekly / bi-weekly long cases, and the 12 PC groups `pc|{weekly,biweekly}|mortgage/fixed|{none,fin2000,fin2000cash400}|{acc0,acc850}`
 *    may move; every other group and long case is byte-identical; no group changes its case count. Expected file shas
 *    (QA's own prototype of B37-R1..R5 / L1..L3, 2026-10-09; the architect measured the same): v1 b90ea69c...d220,
 *    PC 9da9599f...5db8.
 * 2. Capture (a10_ui_capture_v1.json): only REF-01 and S1_fees (both fixed weekly) change, both modes, to the brief's
 *    strings; every other scenario, formDefaults and flowScreens are byte-identical; the inputs, the print fee list, the
 *    payment counts and the CSV file name of REF-01 / S1_fees are unchanged. "Calculated rate" stays 3.70678% on the page.
 *    The capture records select values, not option texts, so the Payment frequency labels add no change (addendum C6).
 *
 * Red until sr-dev regenerates the goldens (1) and QA regenerates the capture at verify (2). Not in test:tz.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FIXTURES_DIR, loadFixture } from './support/fixtures.js';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
/** The fixture text, byte for byte (loadFixture parses). */
const readText = (name: string): string => readFileSync(FIXTURES_DIR + name, 'utf8');

interface PinSide { fileSha256: string; groups: Record<string, { hash: string; n: number }>; long: Record<string, string> }
interface Pin {
  v1: PinSide;
  pc: PinSide;
  capture: { fileSha256: string; scenarioIds: string[]; scenarioSha256: Record<string, string>; formDefaultsSha256: string; flowScreensSha256: string };
  captureStable: { scenarios: Record<string, { head: string; modes: Record<string, string> }> };
}
const PIN = loadFixture<Pin>('b37_pre_golden_group_hashes.json');

interface Golden { groups: Record<string, { hash: string; n: number }>; long: Record<string, unknown> }
const FEES = ['none', 'fin2000', 'fin2000cash400'];
const MOVED_V1 = ['weekly', 'biweekly'].flatMap((f) => FEES.flatMap((fee) => ['new', 'renewal0', 'renewal850'].map((fl) => `${f}|mortgage/fixed|${fee}|${fl}`)));
const MOVED_V1_LONG = ['long:weekly:noPayoff', 'long:weekly:payoff', 'long:biweekly:noPayoff', 'long:biweekly:payoff'];
const MOVED_PC = ['weekly', 'biweekly'].flatMap((f) => FEES.flatMap((fee) => ['acc0', 'acc850'].map((a) => `pc|${f}|mortgage/fixed|${fee}|${a}`)));

describe('B37 goldens: only the fixed-mortgage weekly / bi-weekly groups move (approved; red until sr-dev regenerates)', () => {
  it('the moved-group lists are the brief\'s: 18 + 4 long (v1), 12 (PC)', () => {
    expect(MOVED_V1).toHaveLength(18);
    expect(MOVED_PC).toHaveLength(12);
    for (const k of MOVED_V1) expect(PIN.v1.groups[k], k).toBeDefined();
    for (const k of MOVED_PC) expect(PIN.pc.groups[k], k).toBeDefined();
  });

  it.each([
    ['v1', 'golden_engine_v1.json', MOVED_V1, MOVED_V1_LONG, 'b90ea69ce09cea5ceaea400cb4a192fcef0d8aca1117905e38c7b01ed876d220'],
    ['pc', 'golden_engine_pc_v1.json', MOVED_PC, [] as string[], '9da9599f75bec61090a9f07d2ee16f4bd8a3c51e3601675d2170ce2afc905db8'],
  ] as const)('%s (%s): the listed groups and long cases differ from the pin; all others are byte-identical; same keys and case counts; file sha as expected', (side, file, moved, movedLong, expectedSha) => {
    const pin = PIN[side];
    const raw = loadFixture<Golden>(file);
    expect(Object.keys(raw.groups)).toEqual(Object.keys(pin.groups));
    for (const [k, g] of Object.entries(raw.groups)) {
      expect(g.n, `${k} n`).toBe(pin.groups[k]!.n);
      if ((moved as readonly string[]).includes(k)) expect(g.hash, `${k} must move`).not.toBe(pin.groups[k]!.hash);
      else expect(g.hash, `${k} must not move`).toBe(pin.groups[k]!.hash);
    }
    expect(Object.keys(raw.long)).toEqual(Object.keys(pin.long));
    for (const [k, v] of Object.entries(raw.long)) {
      if ((movedLong as readonly string[]).includes(k)) expect(sha256(JSON.stringify(v)), `${k} must move`).not.toBe(pin.long[k]);
      else expect(sha256(JSON.stringify(v)), `${k} must not move`).toBe(pin.long[k]);
    }
    expect(sha256(readText(file))).toBe(expectedSha);
  });
});

describe('B37 capture: only REF-01 and S1_fees change, to the brief\'s strings (approved; red until QA regenerates the capture at verify)', () => {
  type Mode = { figures: string[][]; html: Record<string, string>; csvFileName: string };
  type Scenario = { id: string; raw: unknown; contractTermField?: string; contractTermChoice?: unknown; error?: unknown; modes: Record<string, Mode> };
  const cap = () => loadFixture<{ formDefaults: unknown; flowScreens: unknown; scenarios: Scenario[] }>('a10_ui_capture_v1.json');
  const CHANGED = ['REF-01', 'S1_fees'];

  it('every other scenario, formDefaults and flowScreens are byte-identical to the pre-B37 capture; REF-01 and S1_fees differ', () => {
    const c = cap();
    expect(c.scenarios.map((s) => s.id)).toEqual(PIN.capture.scenarioIds);
    for (const s of c.scenarios) {
      if (CHANGED.includes(s.id)) expect(sha256(JSON.stringify(s)), s.id).not.toBe(PIN.capture.scenarioSha256[s.id]);
      else expect(sha256(JSON.stringify(s)), s.id).toBe(PIN.capture.scenarioSha256[s.id]);
    }
    expect(sha256(JSON.stringify(c.formDefaults))).toBe(PIN.capture.formDefaultsSha256);
    expect(sha256(JSON.stringify(c.flowScreens))).toBe(PIN.capture.flowScreensSha256);
  });

  it.each(CHANGED)('%s: inputs, contract term, print fee list, payment counts and CSV file name are unchanged', (id) => {
    const s = cap().scenarios.find((x) => x.id === id)!;
    const pin = PIN.captureStable.scenarios[id]!;
    expect(sha256(JSON.stringify({ raw: s.raw, contractTermField: s.contractTermField, contractTermChoice: s.contractTermChoice, error: s.error }))).toBe(pin.head);
    expect(Object.keys(s.modes)).toEqual(Object.keys(pin.modes));
    for (const [m, v] of Object.entries(s.modes)) {
      const stable = { html: { printInputs: v.html.printInputs, printFees: v.html.printFees, printScheduleCount: v.html.printScheduleCount, scheduleCount: v.html.scheduleCount }, csvFileName: v.csvFileName };
      expect(sha256(JSON.stringify(stable)), `${id} ${m}`).toBe(pin.modes[m]);
    }
  });

  const HINT_RATE = 'Fixed-rate mortgages: contract rate converted to the payment frequency. Otherwise the contract rate.';
  const HINT_COB = 'Interest plus all fees over the term.';
  const HINT_TI = 'Interest charged over the term, including any not yet paid.';
  // known_divergence DEV-B37-LEAPN: REF-01 is the saved workbook's example; the shipped page no longer shows its figures
  // ($22,514.11 total interest, $177,732.00 balance); the workbook figures stay pinned with the switch off (ref01-workbook.test.ts).
  it.each(['all', 'compact'])('known_divergence DEV-B37-LEAPN REF-01 / %s: Balance $177,732.00 -> $177,731.96, COB amount and Total interest $22,514.11 -> $22,514.07, Total principal $50,097.65 -> $50,097.69; nothing else', (mode) => {
    const s = cap().scenarios.find((x) => x.id === 'REF-01')!;
    expect(s.modes[mode]!.figures).toEqual([
      ['Cost of borrowing rate (APR)', '3.70678%'],
      ['Calculated rate', '3.70678%', HINT_RATE],
      ['Number of payments', '156'],
      ['Term in days', '1,091 days'],
      ['Balance at end date', '$177,731.96'],
      ['Total of all payments', '$72,611.76'],
      ['Cost of borrowing amount', '$22,514.07', HINT_COB],
      ['Total principal paid', '$50,097.69'],
      ['Total interest', '$22,514.07', HINT_TI],
    ]);
  });

  it.each(['all', 'compact'])('S1_fees / %s: APR 4.11441% -> 4.11440%, Balance $177,731.96, COB amount $25,014.11 -> $25,014.07, Total principal $50,097.69, Total interest $22,514.07; nothing else', (mode) => {
    const s = cap().scenarios.find((x) => x.id === 'S1_fees')!;
    expect(s.modes[mode]!.figures).toEqual([
      ['Cost of borrowing rate (APR)', '4.11440%'],
      ['Calculated rate', '3.70678%', HINT_RATE],
      ['Number of payments', '156'],
      ['Term in days', '1,091 days'],
      ['Balance at end date', '$177,731.96'],
      ['Total of all payments', '$72,611.76'],
      ['Cost of borrowing amount', '$25,014.07', HINT_COB],
      ['Total principal paid', '$50,097.69'],
      ['Total interest', '$22,514.07', HINT_TI],
    ]);
  });
});
