/**
 * F1 (COB-architecture.md §6): src/ca imports nothing outside src/ca.
 * Every import specifier in src/ca/**.ts is resolved; relative targets must start with
 * src/ca/. Bare specifiers (packages, node:*) also count as outside (stricter than the
 * §6 regex, which only looks at relative paths; same intent).
 *
 * Known debt: none. KNOWN_DEBT is kept (empty) so a future edge must be added explicitly.
 * History: the '../types.js' (PaymentFrequency) edges were removed by A2 (2026-09-27);
 * the '../money.js' (round2) edge from src/ca/fees.ts was removed by B1 (012 D-10, 2026-09-27).
 */
import { describe, expect, it } from 'vitest';
import { SRC_CA, fmt, importsOf, listFiles } from './support.js';

const files = listFiles(SRC_CA, /\.ts$/);
const outside = files.flatMap(importsOf).filter((e) => e.resolved === null || !e.resolved.startsWith('src/ca/'));
const KNOWN_DEBT = new Set<string>();

describe('F1 src/ca is self-contained', () => {
  it('F1: no import leaves src/ca (KNOWN_DEBT is empty)', () => {
    expect(files.length).toBeGreaterThanOrEqual(5);
    expect(KNOWN_DEBT.size).toBe(0);
    expect(fmt(outside.filter((e) => !KNOWN_DEBT.has(`${e.file} ${e.spec}`)))).toEqual([]);
  });

  // F1 [A2] regression guard: PaymentFrequency is declared in ca/types.ts (A2 done 2026-09-27).
  it('F1 [A2]: no src/ca module imports the US ../types (PaymentFrequency)', () => {
    expect(fmt(outside.filter((e) => e.resolved === 'src/types.js'))).toEqual([]);
  });

  // F1 [B1] regression guard: round2 import dropped from fees.ts (B1 done 2026-09-27, 012 D-10).
  it('F1 [B1]: no src/ca module imports the US ../money (round2)', () => {
    expect(fmt(outside.filter((e) => e.resolved === 'src/money.js'))).toEqual([]);
  });
});
