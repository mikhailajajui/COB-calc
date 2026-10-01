/**
 * B16 (COB-architecture.md §5 B16, revision 16): money format for the four amount inputs and the
 * printed inputs. User decision Q-MONEY-FMT (COB-user-stories.md §7.5, points 1–6). UI display only;
 * no Excel output is involved, so no DEV-ID. QA red tests, 2026-09-29, written before the developer
 * step.
 *
 * Rules: B16-R1 `parseAmount` (one strict grammar: blank -> undefined, malformed -> NaN), B16-R2
 * `formatAmount` (string-only, never rounds; malformed returned unchanged), B16-R3 (`toInput`: only
 * the parse changes; every blank rule stays: A10-R6 / OQ-B, A10-T2 / Q-A10-1, B14, A10-R7), B16-R4
 * (printout: `typedMoney` / `parseMoney` share the grammar; a blank fee amount still prints `$`),
 * B16-R5 (markup), B16-R6 (format on focusout only). Q-MONEY-FMT (6): the brief error flash while
 * typing `1,` is accepted by the user, so nothing here tests for its absence.
 *
 * Tests B16-1…B16-12. Each ca-view import is a per-test dynamic import.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { calculateCobCanada, FLOWS, requiresSemiAnnualDate } from '../../src/ca/index.js';
import type { CobFlow, ProductType, RateType } from '../../src/ca/index.js';
import type * as View from '../../ui/ca-view.js';
import { ROOT, stripComments } from '../architecture/support.js';
import { loadFixture } from './support/fixtures.js';
import { ON } from './support/uiSwitches.js';

const loadView = () => import('../../ui/ca-view.js') as Promise<typeof View>;
const CAPTURE = loadFixture<{ scenarios: { id: string; raw: View.RawForm; error: string | null }[] }>('a10_ui_capture_v1.json');
const rawOf = (id: string): View.RawForm => {
  const s = CAPTURE.scenarios.find((x) => x.id === id);
  if (!s) throw new Error(`scenario ${id} missing from a10_ui_capture_v1.json`);
  return structuredClone(s.raw);
};
const ctxOf = (raw: View.RawForm): View.ViewContext => ({
  spec: FLOWS[raw.flow as CobFlow],
  semiAnnual: requiresSemiAnnualDate(raw.productType as ProductType, raw.rateType as RateType),
  switches: ON, // B23: characterises the pre-B23 (financed-on) page
});
const messageOf = (fn: () => unknown): string | null => {
  try {
    fn();
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
};

// --- B16-R1 tables ---
const ACCEPTED: [string, number][] = [
  ['227199', 227199],
  ['227,199.28', 227199.28],
  ['$227,199.28', 227199.28],
  [' 465.46 ', 465.46],
  ['1234.5678', 1234.5678],
  ['12,345,678.9', 12345678.9],
  ['-$1,234.5', -1234.5],
  ['-0', -0],
  ['0.001', 0.001],
  ['1,000.00', 1000],
  ['007', 7],
  ['5.', 5],
  ['.5', 0.5],
  ['0', 0],
];
const BLANK = ['', '   ', '\t', ' ', ' '];
const MALFORMED = [
  '2,27199', '1,2345', '1,000,00', '0,123', '1,', '1,5', '1 000', '$ 5', '1e3', '+5', '$-5', '12.34.5',
  '١٢٣', '$', '-', '.', 'abc', '12a', 'x',
];

// --- B16-R2 table ---
const FORMATTED: [string, string][] = [
  ['227199', '227,199.00'],
  ['227199.28', '227,199.28'],
  ['$227,199.28', '227,199.28'],
  ['1234.5678', '1,234.5678'],
  ['0', '0.00'],
  ['.5', '0.50'],
  ['5.', '5.00'],
  ['007', '7.00'],
  ['1000000', '1,000,000.00'],
  ['-5', '-5.00'],
  ['-0', '-0.00'],
  ['1.500', '1.500'],
  ['2,27199', '2,27199'],
  ['abc', 'abc'],
  ['  ', ''],
];

// --- B16-7 corpus: 200,000 strings from the brief's LCG (seed 42), in exact integer arithmetic ---
// (BigInt: seed * 1103515245 exceeds 2^53, so plain JS numbers would not be the stated LCG.)
function corpus(): string[] {
  let seed = 42n;
  const next = (): number => {
    seed = (seed * 1103515245n + 12345n) % 2n ** 31n;
    return Number(seed);
  };
  const pick = (n: number) => next() % n;
  const ALPHA = '0123456789,.$- ';
  const digits = (n: number) => Array.from({ length: n }, () => String(pick(10))).join('');
  const out: string[] = [];
  for (let i = 0; i < 100_000; i++) {
    const len = 1 + pick(12);
    out.push(Array.from({ length: len }, () => ALPHA[pick(ALPHA.length)]).join(''));
  }
  for (let i = 0; i < 100_000; i++) {
    // A random decimal as a user might type it: sign, $, integer (plain or comma-grouped), fraction.
    const sign = pick(10) === 0 ? '-' : '';
    const dollar = pick(4) === 0 ? '$' : '';
    let int = digits(pick(10));
    if (int && pick(2) === 0) int = String(BigInt(int)).replace(/\B(?=(\d{3})+$)/g, ',');
    const frac = pick(2) === 0 ? '' : `.${digits(pick(5))}`;
    const pad = pick(8) === 0 ? ' ' : '';
    out.push(`${pad}${sign}${dollar}${int}${frac}${pad}`);
  }
  return out;
}

describe('B16-R1 parseAmount (one grammar)', () => {
  it('B16-1: accepted strings parse to the typed number (Object.is, so -0 stays -0)', async () => {
    const { parseAmount } = await loadView();
    for (const [s, v] of ACCEPTED) expect(Object.is(parseAmount(s), v), JSON.stringify(s)).toBe(true);
  });
  it('B16-2: blank (empty, spaces, tab, NBSP) is undefined', async () => {
    const { parseAmount } = await loadView();
    for (const s of BLANK) expect(parseAmount(s), JSON.stringify(s)).toBeUndefined();
  });
  it('B16-3: malformed strings (misplaced or decimal comma, inner space, exponent, +, $-5, …) are NaN', async () => {
    const { parseAmount } = await loadView();
    for (const s of MALFORMED) expect(parseAmount(s), JSON.stringify(s)).toBeNaN();
  });
});

describe('B16-R2 formatAmount (display, string-only)', () => {
  it('B16-4: 2 decimals at least, never rounded, $ dropped, malformed returned byte for byte, blank -> empty', async () => {
    const { formatAmount } = await loadView();
    for (const [s, f] of FORMATTED) expect(formatAmount(s), JSON.stringify(s)).toBe(f);
    for (const s of MALFORMED) expect(formatAmount(s), JSON.stringify(s)).toBe(s);
    for (const s of BLANK) expect(formatAmount(s), JSON.stringify(s)).toBe('');
  });
});

describe('B16-R4 printout', () => {
  it('B16-5: typedMoney prints the formatted amount with $, blank stays "$", and matches formatCurrency', async () => {
    const { typedMoney, parseAmount, formatCurrency } = await loadView();
    expect(typedMoney('227829.65')).toBe('$227,829.65');
    expect(typedMoney('150000')).toBe('$150,000.00');
    expect(typedMoney('1234.5678')).toBe('$1,234.5678');
    expect(typedMoney('-5')).toBe('-$5.00');
    // Unchanged by B16 (B16-R4): a blank fee amount (Q-A10-1) still prints "$".
    expect(typedMoney('')).toBe('$');
    let checked = 0;
    const bad: string[] = [];
    for (const s of corpus()) {
      const v = parseAmount(s);
      const frac = /\.(\d*)$/.exec(s.trim());
      if (typeof v !== 'number' || Number.isNaN(v) || s.trim().startsWith('-') || (frac && frac[1]!.length > 2)) continue;
      checked++;
      if (typedMoney(s) !== formatCurrency(v) && bad.length < 10) bad.push(`${JSON.stringify(s)}: ${typedMoney(s)} vs ${formatCurrency(v)}`);
    }
    expect(bad).toEqual([]);
    expect(checked).toBeGreaterThan(20_000);
  });
  it('B16-6: parseMoney uses the same grammar (undefined and NaN -> null)', async () => {
    const { parseMoney } = await loadView();
    expect(parseMoney('1,234.50')).toBe(1234.5);
    expect(parseMoney('$5')).toBe(5);
    expect(parseMoney('250')).toBe(250);
    for (const s of ['', '2,27199', '1 000', '1,5']) expect(parseMoney(s), JSON.stringify(s)).toBeNull();
  });
});

describe('B16-7 invariants over a seeded corpus (200,000 strings)', () => {
  it('B16-7: INV-value, INV-idem, INV-print, INV-plain hold for every string', async () => {
    const { parseAmount, formatAmount, typedMoney } = await loadView();
    const PLAIN = /^-?(\d+(\.\d+)?|\.\d+)$/;
    const bad: string[] = [];
    let valid = 0;
    let plain = 0;
    const note = (msg: string) => { if (bad.length < 10) bad.push(msg); };
    for (const s of corpus()) {
      const v = parseAmount(s);
      const f = formatAmount(s);
      if (typeof v === 'number' && !Number.isNaN(v)) valid++;
      if (!Object.is(parseAmount(f), v)) note(`INV-value ${JSON.stringify(s)} -> ${JSON.stringify(f)}`);
      if (formatAmount(f) !== f) note(`INV-idem ${JSON.stringify(s)} -> ${JSON.stringify(f)}`);
      if (typedMoney(f) !== typedMoney(s)) note(`INV-print ${JSON.stringify(s)}: ${typedMoney(f)} vs ${typedMoney(s)}`);
      if (PLAIN.test(s)) {
        plain++;
        if (!Object.is(v, Number(s))) note(`INV-plain ${JSON.stringify(s)}: ${v} vs ${Number(s)}`);
      }
    }
    expect(bad).toEqual([]);
    // Not vacuous: plenty of valid and plain-decimal strings are exercised.
    expect(valid).toBeGreaterThan(50_000);
    expect(plain).toBeGreaterThan(20_000);
  });
});

describe('B16-R3 toInput: only the parse changes; every blank rule stays', () => {
  it('B16-8: loan, payment, fee (REF-01) and accrued (RENEWAL): formatted -> number, blank -> blank rule, malformed -> NaN', async () => {
    const { toInput } = await loadView();
    const ref = rawOf('REF-01');
    const at = (patch: Partial<View.RawForm>) => toInput({ ...ref, ...patch }, ctxOf(ref));

    expect(ref.loanAmount).toBe('227,829.65'); // B16-FIX raw
    expect(at({}).loanAmount).toBe(227829.65);
    expect(at({ loanAmount: '' }).loanAmount).toBe(0); // Q-A10-1, unchanged
    expect(at({ loanAmount: '2,27199' }).loanAmount).toBeNaN();

    expect(at({ paymentAmount: '1,234.50' }).paymentAmount).toBe(1234.5);
    expect(at({ paymentAmount: '' }).paymentAmount).toBeNaN(); // B14, unchanged
    expect(at({ paymentAmount: '1,5' }).paymentAmount).toBeNaN();

    const fee = (name: string, amount: string) => at({ fees: [{ name, amount, financed: true }] }).fees.fees[0];
    expect(fee('CMHC', '9,500.00')).toEqual({ name: 'CMHC', amount: 9500, financed: true });
    expect(fee('', '')).toEqual({ name: 'Fee', amount: 0, financed: true }); // Q-A10-1, unchanged
    expect(fee('Appraisal fee', '12a')!.amount).toBeNaN();

    const ren = rawOf('RENEWAL');
    const acc = (a: string) => toInput({ ...ren, accruedInterest: a }, ctxOf(ren));
    expect(acc('1,125.50').accruedInterest).toBe(1125.5);
    expect(acc('125.50').accruedInterest).toBe(125.5);
    expect('accruedInterest' in acc('')).toBe(false); // A10-R6 unchanged; the engine rejects the blank since B20
    const bad = acc('x');
    expect('accruedInterest' in bad).toBe(true);
    expect(bad.accruedInterest).toBeNaN();

    expect('accruedInterest' in at({ accruedInterest: 'x' })).toBe(false); // hidden for a new loan
  });

  it('B16-9: a malformed amount is rejected with the engine\'s message (Q-MONEY-FMT 5; wording Q-MSG)', async () => {
    const { toInput } = await loadView();
    const ref = rawOf('REF-01');
    const ren = rawOf('RENEWAL');
    const run = (raw: View.RawForm) => messageOf(() => calculateCobCanada(toInput(raw, ctxOf(raw))));
    expect(run({ ...ref, loanAmount: '2,27199' })).toBe('loanAmount must be a finite number, got NaN');
    expect(run({ ...ref, paymentAmount: '1,5' })).toBe('paymentAmount must be a finite number, got NaN');
    expect(run({ ...ref, fees: [{ name: 'Appraisal fee', amount: '12a', financed: false }] })).toBe(
      'Appraisal fee amount must be a finite number, got NaN',
    );
    expect(run({ ...ren, accruedInterest: 'x' })).toBe('accruedInterest must be a finite number, got NaN');
  });

  it('B16-10: formatted = plain: the 4 calculating captured scenarios give the same result with the commas removed', async () => {
    const { toInput } = await loadView();
    const plain = (s: string) => s.replace(/,/g, '');
    for (const id of ['REF-01', 'S1_fees', 'RENEWAL', 'VRPC_zero_accrued']) { // B20: was VRPC_blank_accrued (now an error case)
      const raw = rawOf(id);
      const stripped: View.RawForm = {
        ...raw,
        loanAmount: plain(raw.loanAmount),
        paymentAmount: plain(raw.paymentAmount),
        accruedInterest: plain(raw.accruedInterest),
        fees: raw.fees.map((f) => ({ ...f, amount: plain(f.amount) })),
      };
      const a = JSON.stringify(calculateCobCanada(toInput(raw, ctxOf(raw))));
      const b = JSON.stringify(calculateCobCanada(toInput(stripped, ctxOf(stripped))));
      expect(a === b, id).toBe(true);
    }
  });
});

// --- markup (B16-R5, B16-R6) ---
const attrsOf = (tag: string): Map<string, string | true> => {
  const m = new Map<string, string | true>();
  for (const a of tag.replace(/^<input\b|\/?>$/g, '').matchAll(/([\w-]+)(?:="([^"]*)")?/g)) m.set(a[1]!, a[2] ?? true);
  return m;
};

describe('B16-R5 / R6 markup', () => {
  it('B16-11: ui/ca.html has exactly 3 data-money inputs (text, decimal keypad, formatted defaults); rate and term stay number', async () => {
    const { formatAmount } = await loadView();
    const htmlSrc = readFileSync(`${ROOT}/ui/ca.html`, 'utf8').replace(/<!--[\s\S]*?-->/g, '');
    const inputs = [...htmlSrc.matchAll(/<input\b[^>]*>/g)].map((m) => attrsOf(m[0]));
    const money = inputs.filter((a) => a.has('data-money'));
    expect(money.map((a) => a.get('id'))).toEqual(['loanAmount', 'paymentAmount', 'accruedInterest']);
    const EXPECT: Record<string, [value: string, label: string]> = {
      loanAmount: ['227,829.65', 'Loan amount ($)'],
      paymentAmount: ['465.46', 'Payment amount ($)'],
      accruedInterest: ['', 'Accrued interest ($)'], // B20-R4: blank default (decision 4)
    };
    for (const a of money) {
      const id = a.get('id') as string;
      expect(a.get('type'), id).toBe('text');
      expect(a.get('inputmode'), id).toBe('decimal');
      expect(a.get('autocomplete'), id).toBe('off');
      expect(a.has('step'), id).toBe(false);
      expect(a.get('value') ?? '', id).toBe(EXPECT[id]![0]);
      expect(formatAmount((a.get('value') ?? '') as string), id).toBe(a.get('value') ?? '');
      expect(a.get('aria-describedby'), id).toBe(`${id}-hint`);
      expect(htmlSrc, id).toContain(`<label for="${id}">${EXPECT[id]![1]}</label>`);
    }
    for (const id of ['contractRatePercent']) { // B24: #termYears / #termMonths are removed from the page
      const a = inputs.find((x) => x.get('id') === id);
      expect(a?.get('type'), id).toBe('number');
      expect(a?.has('step'), id).toBe(true);
    }
  });

  it('B16-12: ui/ca.js fee amount is a formatted text input, formatting happens on focusout, no local parser/formatter', () => {
    const code = stripComments(readFileSync(`${ROOT}/ui/ca.js`, 'utf8'));
    const tags = [...code.matchAll(/<input\b[^>]*data-field="amount"[^>]*>/g)].map((m) => m[0]);
    expect(tags).toHaveLength(1);
    const tag = tags[0]!;
    for (const part of ['type="text"', 'inputmode="decimal"', 'autocomplete="off"', 'data-money', 'data-field="amount"', 'formatAmount(String(values.amount ?? 0))']) {
      expect(tag, part).toContain(part);
    }
    const listener = /addEventListener\(\s*['"]focusout['"]([\s\S]{0,300})/.exec(code);
    expect(listener, 'focusout listener').not.toBeNull();
    expect(listener![1]).toContain('input[data-money]');
    expect(listener![1]).toContain('formatAmount');
    expect(code).not.toContain('type="number"');
    const declared = ['parseAmount', 'formatAmount'].filter((n) => new RegExp(`\\b(const|let|var|function)\\s+${n}\\b`).test(code));
    expect(declared).toEqual([]);
  });
});
