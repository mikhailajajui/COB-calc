/**
 * B24-R1 (COB-architecture.md section 5 B24, revision 31): a test-only oracle for the Contract term split. QA-owned.
 *
 * Written from the RULE, not from the implementation: it searches the largest whole number of months M with
 * `step(from, M) <= to` by counting up (the implementation computes M from the month difference and corrects it),
 * with its own month stepper (OQ-X month-end rule, then VBA DateAdd clamp) and its own day difference in exact
 * milliseconds. It imports nothing from src/. Both dates are read as UTC calendar dates.
 *
 * It reproduces the architect's R1 table (tests/ca/fixtures/b24_term_vectors.json) exactly; b24-term-rule.test.ts
 * confirms that before any differential use (T1 oracle check).
 */
export interface Term { years: number; months: number; days: number }

const DAY = 86_400_000;

function parts(d: Date): { y: number; m: number; day: number } {
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), day: d.getUTCDate() };
}
function lastDay(y: number, m: number): number {
  return new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
}
/** UTC-midnight timestamp of `from` moved `months` months: month-end stays month-end (OQ-X), else the day number clamps. */
function step(from: Date, months: number): number {
  const { y, m, day } = parts(from);
  const isEnd = day === lastDay(y, m);
  const ty = y;
  const tm = m + months; // Date.UTC normalises the month overflow
  const tl = lastDay(ty, tm);
  return Date.UTC(ty, tm, isEnd ? tl : Math.min(day, tl));
}

export function refTerm(from: Date, to: Date): Term {
  const t = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  let months = 0;
  while (step(from, months + 1) <= t) months += 1;
  const days = (t - step(from, months)) / DAY;
  return { years: (months - (months % 12)) / 12, months: months % 12, days };
}
