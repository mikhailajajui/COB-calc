/**
 * F5 (COB-architecture.md §6): layering inside src/ca.
 *   types      <- everyone; imports nothing in src/ca
 *   calendar, fees, policies -> types only
 *   flows      -> types, policies (B24-R5: requiresSemiAnnualDate's defaulted parameter reads SEMI_ANNUAL_DATE_REQUIRED)
 *   products   -> types only (B27, DEV-FB24: the product catalogue)
 *   equations  -> types, calendar
 *   validate   -> types, calendar, fees, flows, products  (B27: products edge; calendar edge added by A4, revision 6:
 *                 utcDateOnly for date ordering; QA A4 step 4, 2026-09-28)
 *   cobCanada  -> anything in src/ca
 *   index      -> anything in src/ca (the barrel; §6 does not list it, simplest reading)
 *   nothing imports cobCanada except index.
 * A src/ca module not in this table is a violation (the table must be extended with it).
 * Type-only imports count (§6 does not distinguish them). Edges leaving src/ca are F1's job.
 *
 * History: the known debt `types -> fees` (src/ca/types.ts imported FeeSchedule from fees.ts)
 * was paid off by A16 (COB-architecture.md §5): Fee/FeeSchedule now live in types.ts and
 * fees.ts re-exports them. QA removed the `.fails` in A16 verification, 2026-09-27.
 * No known debt remains: every violation fails.
 */
import { describe, expect, it } from 'vitest';
import { SRC_CA, fmt, importsOf, listFiles, moduleName, type ImportEdge } from './support.js';

const ANY = '*';
const ALLOWED: Record<string, string[] | typeof ANY> = {
  types: [],
  calendar: ['types'],
  fees: ['types'],
  policies: ['types'],
  flows: ['types', 'policies'], // B24-R5: the defaulted parameter of requiresSemiAnnualDate
  products: ['types'], // B27 (DEV-FB24): the product catalogue allowedPaymentFrequencies
  equations: ['types', 'calendar'],
  validate: ['types', 'calendar', 'fees', 'flows', 'products'], // B27: + products
  cobCanada: ANY,
  index: ANY,
};

const files = listFiles(SRC_CA, /\.ts$/);
const internal = files.flatMap(importsOf).filter((e) => e.resolved?.startsWith('src/ca/'));

function violations(): string[] {
  const out: string[] = [];
  for (const f of files) {
    const m = moduleName(f);
    if (!(m in ALLOWED)) out.push(`src/ca/${m}.ts is not in the F5 layering table`);
  }
  for (const e of internal) {
    const from = moduleName(e.file);
    const to = moduleName(e.resolved!);
    const allowed = ALLOWED[from];
    if (to === 'cobCanada' && from !== 'index') out.push(`${e.file}:${e.line} ${from} -> cobCanada (only index may)`);
    else if (allowed !== undefined && allowed !== ANY && !allowed.includes(to))
      out.push(`${e.file}:${e.line} ${from} -> ${to}`);
  }
  return out;
}

describe('F5 layering inside src/ca', () => {
  it('F5: scans the real import graph', () => {
    const edges = fmt(internal as ImportEdge[]);
    expect(edges.length).toBeGreaterThanOrEqual(8);
    expect(edges.some((e) => /^src\/ca\/validate\.ts:\d+ \.\/fees\.js$/.test(e))).toBe(true);
  });

  it('F5: no layering violation', () => {
    expect(violations()).toEqual([]);
  });

  // A16 (paid off): Fee/FeeSchedule live in types.ts, so types.ts imports nothing in src/ca.
  it('F5 [A16]: types.ts imports nothing in src/ca', () => {
    const fromTypes = internal.filter((e) => moduleName(e.file) === 'types');
    expect(fmt(fromTypes as ImportEdge[])).toEqual([]);
  });

  // B27 (DEV-FB24; red until sr-dev adds src/ca/products.ts): the product rule has one home, read by validate.ts.
  it('F5 [B27]: products.ts exists, imports only types, and validate.ts imports it', () => {
    expect(files.some((f) => moduleName(f) === 'products')).toBe(true);
    const fromProducts = internal.filter((e) => moduleName(e.file) === 'products');
    expect(fmt(fromProducts as ImportEdge[]).every((e) => /\.\/types\.js$/.test(e))).toBe(true);
    expect(internal.some((e) => moduleName(e.file) === 'validate' && moduleName(e.resolved!) === 'products')).toBe(true);
  });
});
