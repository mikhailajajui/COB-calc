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
 *
 * B38 (spec 013, DEC-B38-YEARFRAC-ROUND, DEV-B38-ROUND; user approved 2026-10-10): both goldens and the capture are
 * regenerated again. The B38 goldens move exactly the same groups against the pre-B37 pin, so block 1 still holds; the B37
 * file shas (b90ea69c...d220 / 9da9599f...5db8) are history, replayed with YEARFRAC_ROUNDED_INTEREST off by
 * b37-leap-aware-n.test.ts B38-T6. Block 2 first maps the B38 capture back to the B37 capture with
 * fixtures/b38_capture_undo.json. The "B38" describe pins the new files.
 *
 * B39 (spec 014, DEC-B39-VAR-PL-M12, DEV-B39-M12): both goldens and the capture are regenerated again (variable-rate
 * mortgage and personal-loan groups at 7/14 days; capture scenarios VRPC_zero_accrued and PL_WEEKLY). Block 1 therefore
 * reads the B38 files as the engine replays them with MONTHLY_RATE_CONVERSION off (b38StateGoldenText, INV-B39-OFF; byte
 * for byte the pre-B39 files, pinned in b39_pre_golden_group_hashes.json), and the capture blocks first map the B39
 * capture back to the B38 capture with fixtures/b39_capture_undo.json. The B39 files are pinned in
 * b39-monthly-conversion.test.ts (B39-T7).
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { applyCaptureUndo, loadFixture } from './support/fixtures.js';
import type { CaptureUndo } from './support/fixtures.js';
import { b38StateGoldenText } from './support/preB37Golden.js';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

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
    ['v1', 'golden_engine_v1.json', MOVED_V1, MOVED_V1_LONG],
    ['pc', 'golden_engine_pc_v1.json', MOVED_PC, [] as string[]],
  ] as const)('%s (%s, as the B38 state replays it, MONTHLY_RATE_CONVERSION off since B39): the listed groups and long cases differ from the pin; all others are byte-identical; same keys and case counts (the B37 file sha is history since B38)', (side, _file, moved, movedLong) => {
    const pin = PIN[side];
    const raw = JSON.parse(b38StateGoldenText(side)) as Golden;
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
  });
});

describe('B37 capture: only REF-01 and S1_fees change, to the brief\'s strings (approved; red until QA regenerates the capture at verify)', () => {
  type Mode = { figures: string[][]; html: Record<string, string>; csvFileName: string };
  type Scenario = { id: string; raw: unknown; contractTermField?: string; contractTermChoice?: unknown; error?: unknown; modes: Record<string, Mode> };
  /** The capture as B37 left it: the B38 capture with fixtures/b38_capture_undo.json applied (B38); B39: the B39 capture
   *  is first mapped back to the B38 capture with fixtures/b39_capture_undo.json. */
  const B38_UNDO = loadFixture<CaptureUndo>('b38_capture_undo.json');
  const B39_UNDO = loadFixture<CaptureUndo>('b39_capture_undo.json');
  const cap = () => {
    const c = loadFixture<{ formDefaults: unknown; flowScreens: unknown; scenarios: Scenario[] }>('a10_ui_capture_v1.json');
    return { ...c, scenarios: c.scenarios.map((sc) => applyCaptureUndo(applyCaptureUndo(sc, B39_UNDO), B38_UNDO)) };
  };
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

// ================================================================================================ B38
describe('B38 goldens / capture (spec 013; DEC-B38-YEARFRAC-ROUND, DEV-B38-ROUND; regeneration approved by the user 2026-10-10)', () => {
  type Mode = { figures: string[][] };
  type Scenario = { id: string; modes: Record<string, Mode> };
  const raw = () => loadFixture<{ scenarios: Scenario[] }>('a10_ui_capture_v1.json');
  const B38_UNDO = loadFixture<CaptureUndo>('b38_capture_undo.json');

  // B39 (spec 014): the B38 files are history; the B38 goldens are the engine's replay with MONTHLY_RATE_CONVERSION off, and
  // the B38 capture scenarios are the B39 capture mapped back with b39_capture_undo.json (B39-T7 pins the B39 files).
  it.each([
    ['v1', 'golden_engine_v1.json', 'd6b9b532ccac4141347b71bb04cd2f4ae020200d887d71039c843ff2f35bea07'],
    ['pc', 'golden_engine_pc_v1.json', '72a644a2ec65acc8e2ef101d4e4df647b3889ec93fe8a46e10c58f545f5addb4'],
  ] as const)('%s: %s as the B38 state replays it (MONTHLY_RATE_CONVERSION off) has the B38 sha %s', (side, _file, sha) => {
    expect(sha256(b38StateGoldenText(side))).toBe(sha);
  }, 120_000);

  it('a10_ui_capture_v1.json: the B38 sha 89329245...a8 is history since B39; mapped back with b39_capture_undo.json every scenario has its B38 sha', () => {
    const B39_UNDO = loadFixture<CaptureUndo>('b39_capture_undo.json');
    const pre = loadFixture<{ capture: { fileSha256: string; scenarioIds: string[]; scenarioSha256: Record<string, string> } }>('b39_pre_golden_group_hashes.json').capture;
    expect(pre.fileSha256).toBe('893292458ac22ac990356b56a3ae8728f0b33a455a7868445fed879b0cf0e6a8');
    const scenarios = raw().scenarios;
    expect(scenarios.map((sc) => sc.id)).toEqual(pre.scenarioIds);
    for (const sc of scenarios) expect(sha256(JSON.stringify(applyCaptureUndo(sc, B39_UNDO))), sc.id).toBe(pre.scenarioSha256[sc.id]);
  });

  it('the B38 undo patch covers REF-01 and S1_fees only, and maps them back to the B37 capture scenarios byte for byte (sha256 of JSON.stringify)', () => {
    expect(Object.keys(B38_UNDO.scenarios)).toEqual(['REF-01', 'S1_fees']);
    const B37_SCENARIO_SHA: Record<string, string> = {
      'REF-01': '5834f42e14f41ae3adf5ae7ba68e982d526c07801c05fb3219fa5f43797c50ac',
      S1_fees: 'a0169ff6a7f0b85e8204005ed7c281d3a1f1933f2563b5c2356a8c916caab33c',
    };
    for (const sc of raw().scenarios) {
      const back = applyCaptureUndo(sc, B38_UNDO);
      if (sc.id in B37_SCENARIO_SHA) {
        expect(sha256(JSON.stringify(sc)), sc.id).not.toBe(B37_SCENARIO_SHA[sc.id]);
        expect(sha256(JSON.stringify(back)), sc.id).toBe(B37_SCENARIO_SHA[sc.id]);
      } else {
        expect(back).toBe(sc);
      }
    }
  });

  const HINT_RATE = 'Fixed-rate mortgages: contract rate converted to the payment frequency. Otherwise the contract rate.';
  const HINT_COB = 'Interest plus all fees over the term.';
  const HINT_TI = 'Interest charged over the term, including any not yet paid.';
  it.each(['all', 'compact'])('known_divergence DEV-B37-LEAPN + DEV-B38-ROUND REF-01 / %s: Balance $177,731.95, COB amount and Total interest $22,514.06, Total principal $50,097.70; Calculated rate 3.70678% unchanged', (mode) => {
    const s = raw().scenarios.find((x) => x.id === 'REF-01')!;
    expect(s.modes[mode]!.figures).toEqual([
      ['Cost of borrowing rate (APR)', '3.70678%'],
      ['Calculated rate', '3.70678%', HINT_RATE],
      ['Number of payments', '156'],
      ['Term in days', '1,091 days'],
      ['Balance at end date', '$177,731.95'],
      ['Total of all payments', '$72,611.76'],
      ['Cost of borrowing amount', '$22,514.06', HINT_COB],
      ['Total principal paid', '$50,097.70'],
      ['Total interest', '$22,514.06', HINT_TI],
    ]);
  });

  it.each(['all', 'compact'])('S1_fees / %s: APR 4.11440% unchanged, COB amount $25,014.06, Total principal $50,097.70, Total interest $22,514.06', (mode) => {
    const s = raw().scenarios.find((x) => x.id === 'S1_fees')!;
    expect(s.modes[mode]!.figures).toEqual([
      ['Cost of borrowing rate (APR)', '4.11440%'],
      ['Calculated rate', '3.70678%', HINT_RATE],
      ['Number of payments', '156'],
      ['Term in days', '1,091 days'],
      ['Balance at end date', '$177,731.95'],
      ['Total of all payments', '$72,611.76'],
      ['Cost of borrowing amount', '$25,014.06', HINT_COB],
      ['Total principal paid', '$50,097.70'],
      ['Total interest', '$22,514.06', HINT_TI],
    ]);
  });
});
