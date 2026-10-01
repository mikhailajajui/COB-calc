/**
 * F3 (COB-architecture.md §6, ADR-03): no local-time or clock APIs in src/ca.
 * After stripping comments: no non-UTC Date getter/setter, toLocale*, getTimezoneOffset,
 * Date.now, argument-less `new Date()`, Date.parse or Math.random. Passes on 2026-09-27.
 */
import { describe, expect, it } from 'vitest';
import { SRC_CA, fmt, grepCode, listFiles } from './support.js';

const files = listFiles(SRC_CA, /\.ts$/);
const PATTERNS: [string, RegExp][] = [
  ['local-time Date getter/setter', /\.(get|set)(FullYear|Month|Date|Day|Hours|Minutes|Seconds|Milliseconds)\(/],
  ['toLocale*', /toLocale/],
  ['getTimezoneOffset', /getTimezoneOffset/],
  ['Date.now', /Date\.now\b/],
  ['new Date() with no arguments', /new\s+Date\s*\(\s*\)/],
  ['Date.parse', /Date\.parse\b/],
  ['Math.random', /Math\.random\b/],
];

describe('F3 no local-time or clock APIs in src/ca', () => {
  it('src/ca has files to scan', () => expect(files.length).toBeGreaterThanOrEqual(5));
  for (const [name, re] of PATTERNS) {
    it(`F3: no ${name}`, () => expect(fmt(grepCode(files, re))).toEqual([]));
  }
});
