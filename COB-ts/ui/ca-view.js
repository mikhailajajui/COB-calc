// DOM-free view logic for ui/ca.js (COB-architecture.md §3.1, §5 A10): form strings -> engine
// input, figures, print rows, schedule table nodes, CSV. No imports and no DOM: the engine facts
// it needs (the flow spec, whether the semi-annual date applies) are passed in by ui/ca.js.

// --- labels (display text) ---

export const LABELS = Object.freeze({
  flow: Object.freeze({
    newMortgageOrLoan: 'New mortgage or loan',
    renewal: 'Renewal',
    paymentChange: 'Payment change',
    variableRatePaymentChange: 'Variable rate payment change',
  }),
  productType: Object.freeze({ mortgage: 'Mortgage', personalLoan: 'Personal loan' }),
  rateType: Object.freeze({ fixed: 'Fixed', variable: 'Variable' }),
  paymentFrequency: Object.freeze({
    weekly: 'Weekly',
    biweekly: 'Bi-weekly',
    semiMonthly: 'Semi-monthly',
    monthly: 'Monthly',
    acceleratedWeekly: 'Accelerated Weekly',
    acceleratedBiweekly: 'Accelerated Bi-weekly',
  }),
});

export function label(kind, value) {
  return LABELS[kind][value] ?? value;
}

// --- formats ---

const currency = new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' });
const printCurrency = new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', signDisplay: 'negative' });
const printRate = new Intl.NumberFormat('en-CA', { minimumFractionDigits: 5, maximumFractionDigits: 5, signDisplay: 'negative' });
const printCount = new Intl.NumberFormat('en-CA');
// timeZone 'UTC' is required: every date is a UTC midnight (the engine's convention).
const inputDate = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: 'short', day: '2-digit', timeZone: 'UTC' });
const printShortDate = new Intl.DateTimeFormat('en-CA', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

export function formatCurrency(value) {
  return currency.format(value);
}

export function formatInputDate(date) {
  return date ? inputDate.format(date) : 'Not entered';
}

export function formatRate(value) {
  return `${printRate.format(value)}%`;
}

export function isoDay(date) {
  return date.toISOString().slice(0, 10);
}

// `YYYY-MM-DD` -> `Mar 23, 2026` from the string's own parts; anything else unchanged.
export function formatIsoDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const t = new Date(0);
  t.setUTCFullYear(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return printShortDate.format(t);
}

// --- money amounts (B16, Q-MONEY-FMT) ---

// Sign, optional `$`, integer part (plain digits, or comma groups of three with no leading zero), optional
// fraction. The whole string is trimmed first; nothing else is accepted (no inner spaces, no exponent, no `+`).
const AMOUNT = /^(-?)\$?(\d+|[1-9]\d{0,2}(?:,\d{3})+)?(?:\.(\d*))?$/;

function amountParts(raw) {
  const m = AMOUNT.exec(raw.trim());
  if (!m || (m[2] === undefined && !m[3])) return null;
  return { sign: m[1], int: m[2] === undefined ? '' : m[2].replace(/,/g, ''), frac: m[3] };
}

// A money field as typed: undefined if blank, NaN if malformed, else the number of its digits.
export function parseAmount(raw) {
  if (raw.trim() === '') return undefined;
  const p = amountParts(raw);
  if (!p) return NaN;
  return Number(`${p.sign}${p.int}${p.frac === undefined ? '' : `.${p.frac}`}`);
}

// A money field's display form: `227,199.00`. Blank -> ''; malformed -> unchanged; never rounds.
export function formatAmount(raw) {
  if (raw.trim() === '') return '';
  const p = amountParts(raw);
  if (!p) return raw;
  const int = p.int.replace(/^0+(?=\d)/, '') || '0';
  const grouped = int.replace(/\B(?=(\d{3})+$)/g, ',');
  return `${p.sign}${grouped}.${(p.frac ?? '').padEnd(2, '0')}`;
}

// An amount for the printout: `$227,829.65` (`-$5.00` if negative); blank or malformed as typed with a `$`.
export function typedMoney(typed) {
  if (Number.isNaN(parseAmount(typed) ?? NaN)) {
    const t = typed.trim();
    return t.startsWith('$') || t.startsWith('-$') ? t : `$${t}`;
  }
  const f = formatAmount(typed);
  return f.startsWith('-') ? `-$${f.slice(1)}` : `$${f}`;
}

// A typed dollar amount, or null if blank or malformed (same grammar as parseAmount).
export function parseMoney(raw) {
  const v = parseAmount(raw);
  return v === undefined || Number.isNaN(v) ? null : v;
}

export function paymentsText(n) {
  return `${printCount.format(n)} ${n === 1 ? 'payment' : 'payments'}`;
}

// --- UI switches (ADR-14) ---

/**
 * Switch (ADR-14): shipped false; the other branch true is built and tested.
 * financedOption: show the Financed control, the fee columns and the fee figures.
 * Decision: stakeholder decision 7 (2026-09-29), Q-FEE-CSV. Not a deviation from Excel (F44): off, every fee
 * is sent as non-financed, which the workbook also accepts.
 *
 * Switch (ADR-14): shipped false; the other branch true is built and tested.
 * acceleratedFrequencies: offer the Accelerated Weekly and Accelerated Bi-weekly payment frequencies.
 * Decision: B28. Accelerated frequencies hidden; the engine still supports them.
 *
 * Switch (ADR-14): shipped false; the other branch true is built and tested.
 * contractDateField: show the Contract date field, its print row and the "as of" date in the terms heading.
 * Decision: B24 (user decision 2026-09-30). Contract date hidden; it never changed the calculation.
 */
export const UI_SWITCHES = Object.freeze({ financedOption: false, acceleratedFrequencies: false, contractDateField: false });

export function switchedOut(ctx, name) {
  return ctx.switches[name] !== true;
}

export const FREQUENCY_LOCK_HINT = 'Personal loans are paid monthly.';

/**
 * B27-R7 (DEV-FB24): the Payment frequency lock. `allowed` is the engine catalogue's list for the product;
 * a product with one allowed frequency locks the select to it, any other leaves the value as it is.
 */
export function frequencyLock(productType, allowed, current) {
  if (allowed.length === 1) return { value: allowed[0], locked: true, hint: FREQUENCY_LOCK_HINT };
  return { value: current, locked: false, hint: '' };
}

export const FEE_KEYS = Object.freeze(['feesOpening', 'feesPaid', 'feesClosing']);

// --- input parsing ---

// `YYYY-MM-DD` -> UTC midnight; blank -> undefined.
export function parseDateInput(value) {
  if (!value) return undefined;
  const [y, m, d] = value.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function numOrUndefined(value) {
  if (value === '' || value === null || value === undefined) return undefined;
  const n = Number(value);
  return Number.isNaN(n) ? undefined : n;
}

export function toInput(raw, ctx) {
  const input = {
    flow: raw.flow,
    productType: raw.productType,
    rateType: raw.rateType,
    loanAmount: parseAmount(raw.loanAmount) ?? 0,
    fees: {
      fees: raw.fees.map((fee) => ({ name: fee.name || 'Fee', amount: parseAmount(fee.amount) ?? 0, financed: ctx.switches.financedOption ? fee.financed : false })),
    },
    contractRatePercent: numOrUndefined(raw.contractRatePercent) ?? NaN,
    paymentAmount: parseAmount(raw.paymentAmount) ?? NaN,
    paymentFrequency: raw.paymentFrequency,
    firstPaymentDate: parseDateInput(raw.firstPaymentDate) ?? new Date(NaN),
    endDate: parseDateInput(raw.endDate) ?? new Date(NaN),
  };
  const field = ctx.spec.startDateField;
  const startDate = parseDateInput(raw[field]);
  if (startDate) input[field] = startDate;
  if (ctx.spec.accruedInterest !== 'hidden') {
    const accruedInterest = parseAmount(raw.accruedInterest);
    if (accruedInterest !== undefined) input.accruedInterest = accruedInterest;
  }
  if (ctx.semiAnnual) {
    const semiAnnualCompoundingDate = parseDateInput(raw.semiAnnualCompoundingDate);
    if (semiAnnualCompoundingDate) input.semiAnnualCompoundingDate = semiAnnualCompoundingDate;
  }
  return input;
}

// --- per-flow page texts (B22, decisions 2 and 5) ---

// Accrued interest hint per flow (interim wording, Q-MSG). The field name "Accrued interest" is the same for every flow.
const ACCRUED_TEXT = Object.freeze({
  renewal: 'Interest accrued since the last payment date.',
  paymentChange:
    'Only interest due at earlier payments and not yet paid (arrears), usually $0.00. Interest since the last payment date is already charged.',
  variableRatePaymentChange:
    'Only interest due at earlier payments and not yet paid (arrears), usually $0.00. Interest since the last payment date is already charged.',
});

// The fieldset legend, both date labels and the Accrued interest hint (null when the flow hides the field).
export function flowLabels(flow, spec) {
  return {
    legend: label('flow', flow),
    startDate: spec.startDateLabel,
    firstPaymentDate: spec.firstPaymentDateLabel,
    accruedHint: spec.accruedInterest === 'hidden' ? null : ACCRUED_TEXT[flow] ?? null,
  };
}

// --- contract term (B24) ---

function plural(n, unit) {
  return `${n} ${unit}${n === 1 ? '' : 's'}`;
}

// ["2 years", "11 months", "17 days"]: the unit is singular only for 1; zero parts are always shown.
export function contractTermParts(term) {
  return [plural(term.years, 'year'), plural(term.months, 'month'), plural(term.days, 'day')];
}

export function contractTermText(term) {
  return contractTermParts(term).join(', ');
}

// Hint under the read-only Contract term field (interim wording, Q-MSG); the label is the flow's first payment date label, lower-cased.
export function contractTermHint(firstPaymentLabel) {
  return `Calculated from the ${firstPaymentLabel} to the last scheduled payment date.`;
}

// --- print record ---

export function printInputRows(raw, ctx, termText) {
  const { spec } = ctx;
  const texts = flowLabels(raw.flow, spec);
  const rows = [
    ...(switchedOut(ctx, 'contractDateField') ? [] : [['Contract date', raw.contractDate ? formatIsoDate(raw.contractDate) : 'Not entered']]),
    ['Use case', label('flow', raw.flow)],
    ['Product type', label('productType', raw.productType)],
    ['Rate type', label('rateType', raw.rateType)],
    ['Mortgage or loan amount', typedMoney(raw.loanAmount)],
    ['Interest rate', `${raw.contractRatePercent.trim()}%`],
    ['Payment amount *', typedMoney(raw.paymentAmount)],
    ['Payment frequency', label('paymentFrequency', raw.paymentFrequency)],
    [texts.firstPaymentDate, formatIsoDate(raw.firstPaymentDate)],
    ['End date', formatIsoDate(raw.endDate)],
    ['Contract term', termText],
    [texts.startDate, formatIsoDate(raw[spec.startDateField])],
  ];
  if (spec.accruedInterest !== 'hidden') {
    rows.push(['Accrued interest', typedMoney(raw.accruedInterest)]);
  }
  if (ctx.semiAnnual) {
    rows.push(['Semi-annual compounding reference date', formatIsoDate(raw.semiAnnualCompoundingDate)]);
  }
  return rows;
}

export function printInputNodes(rows) {
  return rows.map(([name, value]) => h('div', [['class', 'print-input']], [h('dt', [], [name]), h('dd', [], [value])]));
}

export function printFeesNodes(rawFees, ctx) {
  if (rawFees.length === 0) return [h('p', [], ['No fees.'])];
  const withFinanced = ctx.switches.financedOption;
  const th = (text, cls) => h('th', cls ? [['class', cls], ['scope', 'col']] : [['scope', 'col']], [text]);
  const table = h('table', [['class', 'print-fees']], [
    h('thead', [], [h('tr', [], [th('Fee'), th('Amount', 'num'), ...(withFinanced ? [th('Financed')] : [])])]),
    h('tbody', [], rawFees.map((fee) =>
      h('tr', [], [
        h('td', [], [fee.name || 'Fee']),
        h('td', [['class', 'num']], [typedMoney(fee.amount)]),
        ...(withFinanced ? [h('td', [], [fee.financed ? 'Yes' : 'No'])] : []),
      ]),
    )),
  ]);
  const nodes = [table];
  const parsed = rawFees.map((fee) => parseMoney(fee.amount));
  if (withFinanced && !parsed.some((a) => a === null)) {
    let financed = 0;
    let notFinanced = 0;
    rawFees.forEach((fee, i) => {
      if (fee.financed) financed += parsed[i];
      else notFinanced += parsed[i];
    });
    nodes.push(h('p', [['class', 'fee-subtotals']], [
      `Financed ${printCurrency.format(financed)} · Not financed ${printCurrency.format(notFinanced)}`,
    ]));
  }
  return nodes;
}

// --- figures: [label, value] or [label, value, hint], in the app's order ---

export function headlineFigures(result) {
  return [
    ['Cost of borrowing rate (APR)', formatRate(result.cobRatePercent)],
    ['Cost of borrowing amount', printCurrency.format(result.cobAmount), 'Interest plus all fees over the term.'],
  ];
}

export function mainFigures(result) {
  const list = [
    ['Calculated rate', formatRate(result.calculatedRatePercent), 'Fixed-rate mortgages: contract rate converted to the payment frequency. Otherwise the contract rate.'],
  ];
  if (result.triggerRatePercent !== null) {
    list.push(['Trigger rate', formatRate(result.triggerRatePercent), 'If the contract rate rises above this, the payment no longer covers the interest.']);
  }
  list.push(
    ['Number of payments', printCount.format(result.numberOfPayments)],
    ['Total of all payments', printCurrency.format(result.totalPayment)],
    ['Total interest', printCurrency.format(result.totalInterest), 'Interest charged over the term, including any not yet paid.'],
    ['Total principal paid', printCurrency.format(result.principalPayment)],
  );
  return list;
}

export function moreFigures(result, ctx) {
  const withFinanced = ctx.switches.financedOption;
  const list = [];
  if (withFinanced) list.push(['Fees recovered through payments', printCurrency.format(result.feesRecovered)]);
  list.push(['Balance at end date', printCurrency.format(result.endingBalance)]);
  const unpaidInterest = result.amortizationSchedule[result.amortizationSchedule.length - 1].carriedAccruedInterestClosing;
  if (unpaidInterest > 0) {
    list.push(['Unpaid interest at end date', printCurrency.format(unpaidInterest), 'Unpaid after the last payment; interest since then is not included']);
  }
  if (withFinanced && ctx.spec.startDateField === 'disbursalDate') {
    list.push(['Disbursal amount', printCurrency.format(result.disbursalAmount), 'Loan amount less financed fees.']);
  }
  list.push(['Term in days', `${printCount.format(result.termDays)} days`]);
  return list;
}

export function printFigures(result, ctx) {
  return [...headlineFigures(result), ...mainFigures(result), ...moreFigures(result, ctx)];
}

export function figureNodes(list) {
  return list.map(([name, value, hint]) =>
    h('div', [['class', 'figure']], [
      h('dt', [['class', 'figure-label']], hint ? [name, h('span', [['class', 'figure-hint']], [hint])] : [name]),
      h('dd', [['class', 'figure-value']], [value]),
    ]),
  );
}

// --- schedule columns: one list for screen and print; the CSV keeps its own order (OQ-J) ---

export const COLUMNS = Object.freeze([
  ['period', '#', 'count', null, '#'],
  ['date', 'Date', 'date', null, 'Date'],
  ['daysInPeriod', 'Days', 'count', null, 'Days'],
  ['openingBalance', 'Opening balance', 'currency', 'Opening', 'Balance'],
  ['feesOpening', 'Fees (opening)', 'currency', 'Opening', 'Fees'],
  ['periodInterest', 'Period interest', 'currency', 'Interest', 'Period'],
  ['carriedAccruedInterestOpening', 'Accrued interest (opening)', 'currency', 'Interest', 'Accrued'],
  ['paymentAmount', 'Payment', 'currency', 'Payment breakdown', 'Payment'],
  ['interestPaid', 'Interest paid', 'currency', 'Payment breakdown', 'Interest'],
  ['feesPaid', 'Fees paid', 'currency', 'Payment breakdown', 'Fees'],
  ['principalPortion', 'Principal paid', 'currency', 'Payment breakdown', 'Principal'],
  ['carriedAccruedInterestClosing', 'Accrued interest (closing)', 'currency', 'Closing', 'Accrued'],
  ['feesClosing', 'Fees (closing)', 'currency', 'Closing', 'Fees'],
  ['closingBalance', 'Balance', 'currency', 'Closing', 'Balance'],
].map((c) => Object.freeze(c)));

export const CSV_COLUMNS = Object.freeze([
  ['period', '#'],
  ['date', 'Date'],
  ['daysInPeriod', 'Days'],
  ['openingBalance', 'Opening balance'],
  ['periodInterest', 'Period interest'],
  ['carriedAccruedInterestOpening', 'Accrued interest (open)'],
  ['feesOpening', 'Fees (open)'],
  ['paymentAmount', 'Payment'],
  ['interestPaid', 'Interest paid'],
  ['feesPaid', 'Fees paid'],
  ['principalPortion', 'Principal'],
  ['carriedAccruedInterestClosing', 'Accrued interest (close)'],
  ['feesClosing', 'Fees (close)'],
  ['closingBalance', 'Balance'],
].map((c) => Object.freeze(c)));

export const COMPACT_KEYS = Object.freeze(['period', 'date', 'paymentAmount', 'interestPaid', 'feesPaid', 'principalPortion', 'closingBalance']);

function feeHidden(key, ctx) {
  return !ctx.switches.financedOption && FEE_KEYS.includes(key);
}

function shown(key, columns) {
  return columns !== 'compact' || COMPACT_KEYS.includes(key);
}

function cellText(key, format, row) {
  if (format === 'date') return formatIsoDate(isoDay(row[key]));
  if (format === 'count') return printCount.format(row[key]);
  return printCurrency.format(row[key]);
}

function totalText(key, result) {
  switch (key) {
    case 'daysInPeriod': return printCount.format(result.termDays);
    case 'paymentAmount': return printCurrency.format(result.totalPayment);
    case 'interestPaid': return printCurrency.format(result.amortizationSchedule.reduce((sum, row) => sum + row.interestPaid, 0));
    case 'feesPaid': return printCurrency.format(result.feesRecovered);
    case 'principalPortion': return printCurrency.format(result.principalPayment);
    case 'closingBalance': return printCurrency.format(result.endingBalance);
    default: return '';
  }
}

function colClass(target, key, format) {
  const num = format === 'currency' || key === 'daysInPeriod';
  if (target === 'print') return num ? `col-${key} num` : `col-${key}`;
  return [`col-${key}`, COMPACT_KEYS.includes(key) ? '' : 'col-extra', num ? 'num' : ''].filter(Boolean).join(' ');
}

// The one schedule table builder. Screen: every column (the CSS hides col-extra in compact),
// with a caption; print: only the shown columns, under the short print headings (Q-PRINT-HEAD).
export function scheduleTableNodes(result, target, columns, ctx) {
  const screen = target === 'screen';
  const cols = COLUMNS.filter(([key]) => !feeHidden(key, ctx) && (screen || shown(key, columns)));
  const compact = columns === 'compact';
  const rows = result.amortizationSchedule;
  const n = rows.length;
  const nodes = [];
  if (screen) {
    const span = n > 0 ? ` from ${formatIsoDate(isoDay(rows[0].date))} to ${formatIsoDate(isoDay(rows[n - 1].date))}` : '';
    nodes.push(h('caption', [['class', 'visually-hidden']], [
      `Amortization schedule, ${paymentsText(n)}${span}. Amounts rounded to the cent; download the CSV for exact values.`,
    ]));
  }

  const groupCells = [];
  const leafCells = [];
  const spans = [];
  for (const [key, screenHeader, format, group, printHeader] of cols) {
    const header = screen ? screenHeader : printHeader;
    if (group === null) {
      groupCells.push(h('th', [['class', colClass(target, key, format)], ['scope', 'col'], ['rowspan', '2']], [header]));
      continue;
    }
    const last = spans[spans.length - 1];
    if (last && last.group === group) last.keys.push(key);
    else {
      const th = h('th', [['scope', 'colgroup']], [group]);
      groupCells.push(th);
      spans.push({ group, keys: [key], th });
    }
    leafCells.push(h('th', [['class', colClass(target, key, format)], ['scope', 'col']], [header]));
  }
  for (const { keys, th } of spans) {
    if (!screen) {
      if (keys.length > 1) th.attrs.push(['colspan', String(keys.length)]);
      continue;
    }
    const compactCount = keys.filter((k) => COMPACT_KEYS.includes(k)).length;
    const hidden = compact && compactCount === 0;
    th.attrs.push(['colspan', String(compact && !hidden ? compactCount : keys.length)]);
    if (hidden) th.attrs.push(['class', 'col-extra']);
  }
  nodes.push(h('thead', [], [h('tr', [['class', 'schedule-groups']], groupCells), h('tr', [], leafCells)]));

  let body = null;
  let year = '';
  for (const row of rows) {
    const rowYear = isoDay(row.date).slice(0, 4);
    if (rowYear !== year) {
      year = rowYear;
      body = h('tbody', [['class', 'schedule-year']], [
        h('tr', [['class', 'year-row']], [h('th', [['scope', 'rowgroup'], ['colspan', String(cols.length)]], [year])]),
      ]);
      nodes.push(body);
    }
    body.children.push(h('tr', [], cols.map(([key, , format]) =>
      key === 'period'
        ? h('th', [['class', colClass(target, key, format)], ['scope', 'row']], [cellText(key, format, row)])
        : h('td', [['class', colClass(target, key, format)]], [cellText(key, format, row)]),
    )));
  }

  nodes.push(h('tfoot', [], [h('tr', [], cols.map(([key, , format]) =>
    key === 'period'
      ? h('th', [['class', colClass(target, key, format)], ['scope', 'row']], ['Totals'])
      : h('td', [['class', colClass(target, key, format)]], [totalText(key, result)]),
  ))]));
  return nodes;
}

// --- CSV ---

// RFC 4180: quote a field holding a quote, comma or line break; double inner quotes.
function csvCell(value) {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvValue(key, row) {
  return key === 'date' ? isoDay(row.date) : row[key];
}

// Header row, then one row per payment; amounts unrounded, dates ISO, every line ends in CRLF.
export function scheduleCsv(rows, columns, ctx) {
  const cols = CSV_COLUMNS.filter(([key]) => !feeHidden(key, ctx) && shown(key, columns));
  const lines = [cols.map(([, header]) => csvCell(header)).join(',')];
  for (const row of rows) lines.push(cols.map(([key]) => csvCell(csvValue(key, row))).join(','));
  return lines.map((line) => `${line}\r\n`).join('');
}

export function csvFileName(firstPaymentIso) {
  return `cost-of-borrowing-schedule-${firstPaymentIso}.csv`;
}

// --- nodes and their HTML (the browser's innerHTML serialisation of the same tree) ---

export function h(tag, attrs, children) {
  return { tag, attrs, children };
}

function escapeText(s) {
  return s.replace(/&/g, '&amp;').replace(/ /g, '&nbsp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(s) {
  return s.replace(/&/g, '&amp;').replace(/ /g, '&nbsp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function html(nodes) {
  let out = '';
  for (const node of nodes) {
    if (typeof node === 'string') {
      out += escapeText(node);
      continue;
    }
    out += `<${node.tag}`;
    for (const [name, value] of node.attrs) out += ` ${name}="${escapeAttr(value)}"`;
    out += `>${html(node.children)}</${node.tag}>`;
  }
  return out;
}
