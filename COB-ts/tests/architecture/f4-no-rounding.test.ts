/**
 * F4 (COB-architecture.md §6, ADR-02): no rounding in the calculation path.
 * No Math.round/floor/ceil/trunc, toFixed, toPrecision or round2 in src/ca (code only,
 * comments stripped), except lines marked `// fitness:day-count` (the integer day counts in
 * daysBetween / dayCountFraction).
 *
 * Known debt: none (A4 verified 2026-09-28). The two integer day counts (daysBetween,
 *   dayCountFraction) now live in src/ca/calendar.ts with `// fitness:day-count` on the same
 *   line (A4 Goal 6); QA removed the `.fails`, DAY_COUNT_LINES and isDayCountDebt (spec step 3).
 * History: round2 in src/ca/fees.ts (import + 4 fee totals) removed by B1 (012 D-10 / OQ-H, 2026-09-27).
 */
import { describe, expect, it } from 'vitest';
import { SRC_CA, fmt, grepCode, listFiles } from './support.js';

const files = listFiles(SRC_CA, /\.ts$/);
const ROUNDING = /Math\.(round|floor|ceil|trunc)\b|\.toFixed\(|\.toPrecision\(|\bround2\b/;
const MARK = '// fitness:day-count';
const unmarked = grepCode(files, ROUNDING).filter((h) => !h.text.includes(MARK));
const marked = grepCode(files, ROUNDING).filter((h) => h.text.includes(MARK));
/** A4 Goal 6: the two lines, exactly as the spec gives them (original text, trimmed). */
const MARKED_DAY_COUNT_LINES = [
  'return Math.round((utcDateOnly(end) - utcDateOnly(start)) / MS_PER_DAY); // fitness:day-count',
  'const daysInSegment = Math.round((segmentEnd - cursor) / MS_PER_DAY); // fitness:day-count',
];

describe('F4 no rounding in src/ca', () => {
  it('F4: no unmarked rounding', () => {
    expect(files.length).toBeGreaterThanOrEqual(5);
    expect(fmt(unmarked)).toEqual([]);
  });

  // F4 [B1] regression guard: unrounded fee totals (B1 done 2026-09-27, 012 D-10 / OQ-H).
  it('F4 [B1]: no round2 in src/ca', () => {
    expect(fmt(unmarked.filter((h) => /\bround2\b/.test(h.text)))).toEqual([]);
  });

  // A4 QA 2026-09-28 (green now and after A4): the marker is only used on the two sanctioned
  // integer day counts, and only in calendar.ts (vacuous until A4 adds the markers).
  it('F4 [A4 marker]: `// fitness:day-count` marks only the two day counts, in calendar.ts', () => {
    const bad = marked.filter((h) => h.file !== 'src/ca/calendar.ts' || !MARKED_DAY_COUNT_LINES.includes(h.text));
    expect(fmt(bad)).toEqual([]);
  });

  // F4 -> A4 (done 2026-09-28): the integer day counts carry the `// fitness:day-count`
  // marker, on the same line, in calendar.ts. Regression guard (was `.fails` until A4 landed).
  it('F4 [A4]: every Math.* rounding in src/ca is a marked day count', () => {
    expect(fmt(unmarked.filter((h) => /Math\./.test(h.text)))).toEqual([]);
    expect(marked.map((h) => `${h.file} ${h.text}`).sort()).toEqual(
      MARKED_DAY_COUNT_LINES.map((t) => `src/ca/calendar.ts ${t}`).sort(),
    );
  });
});
