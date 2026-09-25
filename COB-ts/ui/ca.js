import { calculateCobCanada } from '/dist/index.js';

// --- element refs ---

const form = document.getElementById('form');
const errorEl = document.getElementById('error');
const resultStatusEl = document.getElementById('resultStatus');
const resultBodyEl = document.getElementById('resultBody');
const resultContextEl = document.getElementById('resultContext');
const headlineFiguresEl = document.getElementById('headlineFigures');
const mainFiguresEl = document.getElementById('mainFigures');
const moreFiguresEl = document.getElementById('moreFigures');
const contractTermsEl = document.getElementById('contractTerms');
const contractTermsDateEl = document.getElementById('contractTermsDate');
const contractTermsListEl = document.getElementById('contractTermsList');
const scheduleSectionEl = document.getElementById('scheduleSection');
const scheduleCountEl = document.getElementById('scheduleCount');
const scheduleTableEl = document.getElementById('scheduleTable');
const columnRadios = [...document.querySelectorAll('input[name="scheduleColumns"]')];

const flowEl = document.getElementById('flow');
const productTypeEl = document.getElementById('productType');
const rateTypeEl = document.getElementById('rateType');

const contractDateEl = document.getElementById('contractDate');
const loanAmountEl = document.getElementById('loanAmount');
const contractRatePercentEl = document.getElementById('contractRatePercent');
const paymentAmountEl = document.getElementById('paymentAmount');
const paymentFrequencyEl = document.getElementById('paymentFrequency');
const termYearsEl = document.getElementById('termYears');
const termMonthsEl = document.getElementById('termMonths');
const firstPaymentDateEl = document.getElementById('firstPaymentDate');
const endDateEl = document.getElementById('endDate');

const newFlowFieldsEl = document.getElementById('newFlowFields');
const disbursalDateEl = document.getElementById('disbursalDate');

const existingFlowFieldsEl = document.getElementById('existingFlowFields');
const renewalDateEl = document.getElementById('renewalDate');
const accruedInterestEl = document.getElementById('accruedInterest');

const semiAnnualFieldEl = document.getElementById('semiAnnualField');
const semiAnnualCompoundingDateEl = document.getElementById('semiAnnualCompoundingDate');

const feesBodyEl = document.getElementById('feesBody');
const addFeeBtn = document.getElementById('addFee');

const downloadCsvBtn = document.getElementById('downloadCsv');
const printScheduleBtn = document.getElementById('printSchedule');
const actionsHintEl = document.getElementById('result-actions-hint');

const printedLineEl = document.getElementById('printedLine');
const printedAtEl = document.getElementById('printedAt');
const calculatedLineEl = document.getElementById('calculatedLine');
const calculatedAtEl = document.getElementById('calculatedAt');
const printGuardEl = document.getElementById('printGuard');
const printEngineEl = document.getElementById('printEngine');
const printBodyEl = document.getElementById('printBody');
const printInputsEl = document.getElementById('printInputs');
const printFeesEl = document.getElementById('printFees');
const printFiguresEl = document.getElementById('printFigures');
const printScheduleSectionEl = document.getElementById('printScheduleSection');
const printScheduleCountEl = document.getElementById('printScheduleCount');
const printScheduleTableEl = document.getElementById('printScheduleTable');

// --- flow <-> product/rate-type locking, per validateCobCanadaInput's flow<->product
// consistency rules (src/ca/validate.ts): flow no longer implies productType --
// newMortgageOrLoan/renewal/paymentChange apply identically to mortgages and personal
// loans (doc 007 finding #9). Only variableRatePaymentChange is still scoped, by
// construction, to mortgage + variable (it exists specifically to recompute the
// trigger rate). Locking the dependent dropdown for that one case (rather than just
// letting the calculation throw) keeps the common path error-free while still
// surfacing a RangeError for any combination the engine itself still rejects. ---

const FORCED_PRODUCT_TYPE = {
  variableRatePaymentChange: 'mortgage',
};

const FORCED_RATE_TYPE = {
  variableRatePaymentChange: 'variable',
};

function isNewFlow(flow) {
  return flow === 'newMortgageOrLoan';
}

function updateConditionalVisibility() {
  const flow = flowEl.value;
  const forcedProduct = FORCED_PRODUCT_TYPE[flow];
  if (forcedProduct) {
    productTypeEl.value = forcedProduct;
    productTypeEl.disabled = true;
  } else {
    productTypeEl.disabled = false;
  }

  const forcedRate = FORCED_RATE_TYPE[flow];
  if (forcedRate) {
    rateTypeEl.value = forcedRate;
    rateTypeEl.disabled = true;
  } else {
    rateTypeEl.disabled = false;
  }

  const isNew = isNewFlow(flow);
  newFlowFieldsEl.style.display = isNew ? '' : 'none';
  existingFlowFieldsEl.style.display = isNew ? 'none' : '';

  const usesSemiAnnual = productTypeEl.value === 'mortgage' && rateTypeEl.value === 'fixed';
  semiAnnualFieldEl.style.display = usesSemiAnnual ? '' : 'none';
}

// --- fee table ---

let feeRowId = 0;

function addFeeRow(values = {}) {
  const id = feeRowId++;
  const tr = document.createElement('tr');
  tr.dataset.id = String(id);
  tr.innerHTML = `
    <td><input type="text" data-field="name" value="${values.name ?? ''}" placeholder="Fee name" aria-label="Fee name" /></td>
    <td><input type="number" step="0.01" data-field="amount" value="${values.amount ?? 0}" /></td>
    <td><input type="checkbox" data-field="financed" ${values.financed ? 'checked' : ''} /></td>
    <td><button type="button" class="remove-fee" data-remove>Remove</button></td>
  `;
  const nameEl = tr.querySelector('[data-field="name"]');
  const amountEl = tr.querySelector('[data-field="amount"]');
  const financedEl = tr.querySelector('[data-field="financed"]');
  const removeBtn = tr.querySelector('[data-remove]');
  const labelRow = () => {
    const name = nameEl.value || 'Fee';
    amountEl.setAttribute('aria-label', `Amount: ${name}`);
    financedEl.setAttribute('aria-label', `Financed: ${name}`);
    removeBtn.setAttribute('aria-label', `Remove fee: ${name}`);
  };
  labelRow();
  nameEl.addEventListener('input', labelRow);
  removeBtn.addEventListener('click', () => {
    tr.remove();
    recompute();
  });
  feesBodyEl.appendChild(tr);
}

function readFees() {
  return [...feesBodyEl.querySelectorAll('tr')].map((tr) => ({
    name: tr.querySelector('[data-field="name"]').value || 'Fee',
    amount: Number(tr.querySelector('[data-field="amount"]').value || 0),
    financed: tr.querySelector('[data-field="financed"]').checked,
    // validateFee requires includedInCob to be set for a Canadian flow, but cob_amount
    // includes every fee regardless (006 equation 8), so the page no longer asks for it.
    includedInCob: true,
  }));
}

addFeeBtn.addEventListener('click', () => {
  addFeeRow();
  recompute();
});

// --- input parsing ---

// `YYYY-MM-DD` -> UTC midnight, the engine's date convention (UTC-only date math).
function parseDateInput(value) {
  if (!value) return undefined;
  const [y, m, d] = value.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function numOrUndefined(value) {
  if (value === '' || value === null || value === undefined) return undefined;
  const n = Number(value);
  return Number.isNaN(n) ? undefined : n;
}

function buildInput() {
  const flow = flowEl.value;
  const productType = productTypeEl.value;
  const rateType = rateTypeEl.value;

  const input = {
    flow,
    productType,
    rateType,
    loanAmount: Number(loanAmountEl.value),
    fees: { fees: readFees() },
    contractRatePercent: Number(contractRatePercentEl.value),
    paymentAmount: Number(paymentAmountEl.value),
    paymentFrequency: paymentFrequencyEl.value,
    termYears: Number(termYearsEl.value),
    termMonths: Number(termMonthsEl.value),
    firstPaymentDate: parseDateInput(firstPaymentDateEl.value) ?? new Date(NaN),
    endDate: parseDateInput(endDateEl.value) ?? new Date(NaN),
  };

  if (isNewFlow(flow)) {
    const disbursalDate = parseDateInput(disbursalDateEl.value);
    if (disbursalDate) input.disbursalDate = disbursalDate;
  } else {
    const renewalDate = parseDateInput(renewalDateEl.value);
    if (renewalDate) input.renewalDate = renewalDate;
    const accruedInterest = numOrUndefined(accruedInterestEl.value);
    if (accruedInterest !== undefined) input.accruedInterest = accruedInterest;
  }

  if (productType === 'mortgage' && rateType === 'fixed') {
    const semiAnnualCompoundingDate = parseDateInput(semiAnnualCompoundingDateEl.value);
    if (semiAnnualCompoundingDate) input.semiAnnualCompoundingDate = semiAnnualCompoundingDate;
  }

  return input;
}

// --- rendering ---

const currency = new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' });
// timeZone: 'UTC' is required here, not cosmetic -- the engine anchors every schedule
// date to UTC midnight internally (see cobCanada.ts's UTC-safe day/month stepping,
// which avoids DST-related date-arithmetic drift). Without this option, Intl's
// default (the viewer's local timezone) would roll a UTC-midnight date back to the
// previous calendar day for any negative-UTC-offset viewer (all of North/South
// America) -- e.g. a firstPaymentDate of 2026-03-13 would display as "Mar 12, 2026".
const dateFmt = new Intl.DateTimeFormat('en-CA', {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  timeZone: 'UTC',
});

// Input dates are UTC-midnight Dates (parseDateInput), so dateFmt (timeZone: 'UTC')
// shows the calendar day that was entered.
function inputDateFmt(date) {
  if (!date) return 'Not entered';
  return dateFmt.format(date);
}

function plural(n, unit) {
  return `${n} ${unit}${n === 1 ? '' : 's'}`;
}

function selectedText(selectEl) {
  return selectEl.selectedOptions[0]?.textContent ?? selectEl.value;
}

// The terms of the calculation that produced the shown results, as entered, one tile
// each. Amounts, rates, dates and single words stay on one line (fitTermValues); the
// flow, product type and contract term may wrap between words.
function renderContractTerms(input, contractDate) {
  contractTermsDateEl.textContent = contractDate ? inputDateFmt(contractDate) : 'no date entered';

  const isNew = isNewFlow(input.flow);
  const noBreak = (text) => text.replace(' ', '\u00a0');
  const items = [
    ['Flow', selectedText(flowEl), false],
    ['Product type', selectedText(productTypeEl), false],
    ['Rate type', selectedText(rateTypeEl)],
    ['Loan amount', currency.format(input.loanAmount)],
    ['Contract rate', `${contractRatePercentEl.value.trim()}%`],
    ['Payment amount', currency.format(input.paymentAmount)],
  ];
  if (!isNew) {
    items.push([
      'Accrued interest',
      input.accruedInterest === undefined ? 'Not entered' : currency.format(input.accruedInterest),
    ]);
  }
  items.push(
    ['Payment frequency', PRINT_FREQUENCIES[input.paymentFrequency] ?? input.paymentFrequency],
    ['Contract term', `${noBreak(plural(input.termYears, 'year'))}, ${noBreak(plural(input.termMonths, 'month'))}`, false],
    isNew
      ? ['Disbursal date', inputDateFmt(input.disbursalDate)]
      : ['Renewal date', inputDateFmt(input.renewalDate)],
    ['First payment date', inputDateFmt(input.firstPaymentDate)],
    ['End date', inputDateFmt(input.endDate)],
  );
  if (input.productType === 'mortgage' && input.rateType === 'fixed') {
    items.push(['Semi-annual compounding reference date', inputDateFmt(input.semiAnnualCompoundingDate)]);
  }

  // Built with textContent: fee names are free text.
  const tile = (label, dd, className = 'term') => {
    const div = el('div', undefined, className);
    div.append(el('dt', label, 'term-label'), dd);
    return div;
  };
  const valueTile = ([label, value, oneLine = true]) => {
    const dd = el('dd', undefined, 'term-data');
    const span = el('span', value, oneLine ? 'term-value term-value--fit' : 'term-value');
    dd.appendChild(span);
    return tile(label, dd);
  };

  const fees = input.fees.fees;
  const feesDd = el('dd', undefined, 'term-data');
  if (fees.length === 0) {
    feesDd.appendChild(el('span', 'No fees', 'term-value term-value--fees'));
  } else {
    const ul = el('ul', undefined, 'term-fees');
    for (const fee of fees) {
      const li = el('li', undefined, 'term-value term-value--fees');
      li.append(
        el('span', fee.name, 'fee-name'),
        ' — ',
        el('span', currency.format(fee.amount), 'fee-amount'),
        ' ',
        el('span', fee.financed ? 'Financed' : 'Not financed', 'fee-tag'),
      );
      ul.appendChild(li);
    }
    feesDd.appendChild(ul);
  }

  contractTermsListEl.replaceChildren(...items.map(valueTile), tile('Fees', feesDd, 'term term--fees'));
  fitTermValues();
}

// Sets each one-line value's width in ems (--term-em, at the .term-value style, with a 2%
// margin) on its tile; the CSS sizes the value so that it fits the tile. Measured in the
// page's font, and again once the web font has loaded.
function fitTermValues() {
  const probe = el('span', undefined, 'term-value');
  probe.style.cssText = 'position:absolute;left:-9999px;top:0;visibility:hidden;white-space:nowrap;font-size:100px';
  document.body.appendChild(probe);
  for (const value of contractTermsListEl.querySelectorAll('.term-value--fit')) {
    probe.textContent = value.textContent;
    value.closest('.term').style.setProperty('--term-em', String((probe.getBoundingClientRect().width / 100) * 1.02));
  }
  probe.remove();
}
document.fonts?.ready.then(fitTermValues);

// --- export: CSV download and print ---

// The schedule of the result currently shown, and the first payment date of the input
// that produced it; empty whenever the results are hidden.
let lastSchedule = [];
let lastFirstPaymentIso = '';

const CSV_COLUMNS = [
  ['#', (row) => row.period, 'period'],
  ['Date', (row) => row.date.toISOString().slice(0, 10), 'date'],
  ['Days', (row) => row.daysInPeriod, 'daysInPeriod'],
  ['Opening balance', (row) => row.openingBalance, 'openingBalance'],
  ['Period interest', (row) => row.periodInterest, 'periodInterest'],
  ['Accrued interest (open)', (row) => row.carriedAccruedInterestOpening, 'carriedAccruedInterestOpening'],
  ['Fees (open)', (row) => row.feesOpening, 'feesOpening'],
  ['Payment', (row) => row.paymentAmount, 'paymentAmount'],
  ['Interest paid', (row) => row.interestPaid, 'interestPaid'],
  ['Fees paid', (row) => row.feesPaid, 'feesPaid'],
  ['Principal', (row) => row.principalPortion, 'principalPortion'],
  ['Accrued interest (close)', (row) => row.carriedAccruedInterestClosing, 'carriedAccruedInterestClosing'],
  ['Fees (close)', (row) => row.feesClosing, 'feesClosing'],
  ['Balance', (row) => row.closingBalance, 'closingBalance'],
];

// RFC 4180: quote a field holding a quote, comma or line break; double inner quotes.
function csvCell(value) {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

// Schedule only: header row, then one row per payment. Amounts are written unrounded,
// as the engine returns them; dates are ISO (YYYY-MM-DD); every line ends in CRLF.
// With the Compact view on, only the compact columns are written, as on screen.
function scheduleCsv(rows) {
  const columns = CSV_COLUMNS.filter(([, , key]) => showColumn(key));
  const lines = [columns.map(([header]) => csvCell(header)).join(',')];
  for (const row of rows) lines.push(columns.map(([, get]) => csvCell(get(row))).join(','));
  return lines.map((line) => `${line}\r\n`).join('');
}

// Built in the browser and handed over as a download; nothing is stored.
downloadCsvBtn.addEventListener('click', () => {
  if (downloadCsvBtn.getAttribute('aria-disabled') === 'true' || lastSchedule.length === 0) return;
  const blob = new Blob([scheduleCsv(lastSchedule)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `cost-of-borrowing-schedule-${lastFirstPaymentIso}.csv`;
  link.hidden = true;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
});

printScheduleBtn.addEventListener('click', () => {
  if (printScheduleBtn.getAttribute('aria-disabled') === 'true') return;
  window.print();
});

const printedAtFmt = new Intl.DateTimeFormat('en-CA', { dateStyle: 'long', timeStyle: 'short' });
const clockTimeFmt = new Intl.DateTimeFormat('en-CA', { timeStyle: 'short' });

function refreshPrintedAt() {
  printedAtEl.textContent = printedAtFmt.format(new Date());
}
window.addEventListener('beforeprint', refreshPrintedAt);

// The engine version is this package's; it prints only if the server hands it out.
fetch('/package.json')
  .then((res) => (res.ok ? res.json() : null))
  .then((pkg) => {
    if (typeof pkg?.version === 'string') printEngineEl.textContent = ` · Engine ${pkg.version}`;
  })
  .catch(() => {});

// --- printout: the app's print record (labels, order and formats), built from the
// input and result of the current calculation. Hidden on screen. ---

const printCurrency = new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', signDisplay: 'negative' });
const printRate = new Intl.NumberFormat('en-CA', {
  minimumFractionDigits: 5,
  maximumFractionDigits: 5,
  signDisplay: 'negative',
});
const printCount = new Intl.NumberFormat('en-CA');
const printShortDate = new Intl.DateTimeFormat('en-CA', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});

function formatRate(value) {
  return `${printRate.format(value)}%`;
}

// `YYYY-MM-DD` -> `Mar 23, 2026` from the string's own parts; anything else unchanged.
function formatIsoDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const t = new Date(0);
  t.setUTCFullYear(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return printShortDate.format(t);
}

// An amount as typed, with a leading `$`.
function typedMoney(typed) {
  const t = typed.trim();
  return t.startsWith('$') || t.startsWith('-$') ? t : `$${t}`;
}

// A typed dollar amount, or null if blank or malformed.
function parseMoney(raw) {
  const s = raw.replace(/[\s,]/g, '').replace(/^(-?)\$/, '$1');
  return /^-?(\d+(\.\d*)?|\.\d+)$/.test(s) ? Number(s) : null;
}

const PRINT_USE_CASES = {
  newMortgageOrLoan: 'New mortgage or loan',
  renewal: 'Renewal',
  paymentChange: 'Payment change',
  variableRatePaymentChange: 'Variable rate payment change',
};
const PRINT_PRODUCT_TYPES = { mortgage: 'Mortgage', personalLoan: 'Personal loan' };
const PRINT_RATE_TYPES = { fixed: 'Fixed', variable: 'Variable' };
const PRINT_FREQUENCIES = { weekly: 'Weekly', biweekly: 'Bi-weekly', semiMonthly: 'Semi-monthly', monthly: 'Monthly' };

function isChangeFlow(flow) {
  return flow === 'paymentChange' || flow === 'variableRatePaymentChange';
}

function startDateLabel(flow) {
  if (isNewFlow(flow)) return 'Disbursal date';
  return flow === 'renewal' ? 'Renewal date' : 'Payment change date';
}

function printInputRows(input) {
  const rows = [
    ['Contract date', contractDateEl.value ? formatIsoDate(contractDateEl.value) : 'Not entered'],
    ['Use case', PRINT_USE_CASES[input.flow] ?? input.flow],
    ['Product type', PRINT_PRODUCT_TYPES[input.productType] ?? input.productType],
    ['Rate type', PRINT_RATE_TYPES[input.rateType] ?? input.rateType],
    ['Mortgage or loan amount', typedMoney(loanAmountEl.value)],
    ['Interest rate', `${contractRatePercentEl.value.trim()}%`],
    ['Payment amount *', typedMoney(paymentAmountEl.value)],
    ['Payment frequency', PRINT_FREQUENCIES[input.paymentFrequency] ?? input.paymentFrequency],
    [isChangeFlow(input.flow) ? 'Next payment date' : 'First payment date', formatIsoDate(firstPaymentDateEl.value)],
    ['End date', formatIsoDate(endDateEl.value)],
    ['Contract term', `${termYearsEl.value.trim()} years, ${termMonthsEl.value.trim()} months`],
  ];
  if (isNewFlow(input.flow)) {
    rows.push([startDateLabel(input.flow), formatIsoDate(disbursalDateEl.value)]);
  } else {
    rows.push([startDateLabel(input.flow), formatIsoDate(renewalDateEl.value)]);
    if (accruedInterestEl.value.trim() !== '') rows.push(['Accrued interest', typedMoney(accruedInterestEl.value)]);
  }
  if (input.productType === 'mortgage' && input.rateType === 'fixed') {
    rows.push(['Semi-annual compounding reference date', formatIsoDate(semiAnnualCompoundingDateEl.value)]);
  }
  return rows;
}

// The app's result figures: label, value and optional description, in its order.
function headlineFigures(result) {
  return [
    ['Cost of borrowing rate (APR)', formatRate(result.cobRatePercent)],
    ['Cost of borrowing amount', printCurrency.format(result.cobAmount), 'Interest plus all fees over the term.'],
  ];
}

function mainFigures(result) {
  const list = [
    ['Calculated rate', formatRate(result.calculatedRatePercent), 'Contract rate converted to the payment frequency.'],
  ];
  if (result.triggerRatePercent !== null) {
    list.push([
      'Trigger rate',
      formatRate(result.triggerRatePercent),
      'If the contract rate rises above this, the payment no longer covers the interest.',
    ]);
  }
  list.push(
    ['Number of payments', printCount.format(result.numberOfPayments)],
    ['Total of all payments', printCurrency.format(result.totalPayment)],
    ['Total interest paid', printCurrency.format(result.totalInterest)],
    ['Total principal paid', printCurrency.format(result.principalPayment)],
  );
  return list;
}

function moreFigures(result, input) {
  const list = [
    ['Fees recovered through payments', printCurrency.format(result.feesRecovered)],
    ['Balance at end date', printCurrency.format(result.endingBalance)],
  ];
  if (isNewFlow(input.flow)) {
    list.push(['Disbursal amount', printCurrency.format(result.disbursalAmount), 'Loan amount less financed fees.']);
  }
  list.push(['Term in days', `${printCount.format(result.termDays)} days`]);
  return list;
}

function printFigures(result, input) {
  return [...headlineFigures(result), ...mainFigures(result), ...moreFigures(result, input)];
}

// key, header, format, group; the app's schedule columns in its order.
const PRINT_COLUMNS = [
  ['period', '#', 'count', null],
  ['date', 'Date', 'date', null],
  ['daysInPeriod', 'Days', 'count', null],
  ['openingBalance', 'Opening balance', 'currency', 'Opening'],
  ['feesOpening', 'Fees (opening)', 'currency', 'Opening'],
  ['periodInterest', 'Period interest', 'currency', 'Interest'],
  ['carriedAccruedInterestOpening', 'Accrued interest (opening)', 'currency', 'Interest'],
  ['paymentAmount', 'Payment', 'currency', 'Payment breakdown'],
  ['interestPaid', 'Interest paid', 'currency', 'Payment breakdown'],
  ['feesPaid', 'Fees paid', 'currency', 'Payment breakdown'],
  ['principalPortion', 'Principal paid', 'currency', 'Payment breakdown'],
  ['carriedAccruedInterestClosing', 'Accrued interest (closing)', 'currency', 'Closing'],
  ['feesClosing', 'Fees (closing)', 'currency', 'Closing'],
  ['closingBalance', 'Balance', 'currency', 'Closing'],
];

function isoDay(date) {
  return date.toISOString().slice(0, 10);
}

function printCell(key, format, row) {
  if (format === 'date') return formatIsoDate(isoDay(row[key]));
  if (format === 'count') return printCount.format(row[key]);
  return printCurrency.format(row[key]);
}

function printTotal(key, result) {
  switch (key) {
    case 'daysInPeriod': return printCount.format(result.termDays);
    case 'paymentAmount': return printCurrency.format(result.totalPayment);
    case 'interestPaid': return printCurrency.format(result.totalInterest);
    case 'feesPaid': return printCurrency.format(result.feesRecovered);
    case 'principalPortion': return printCurrency.format(result.principalPayment);
    case 'closingBalance': return printCurrency.format(result.endingBalance);
    default: return '';
  }
}

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function printColClass(key, format) {
  return format === 'currency' || key === 'daysInPeriod' ? `col-${key} num` : `col-${key}`;
}

// Prints the columns shown on screen: all of them, or the compact set.
function renderPrintSchedule(result) {
  const columns = PRINT_COLUMNS.filter(([key]) => showColumn(key));
  const rows = result.amortizationSchedule;
  const n = rows.length;
  printScheduleCountEl.textContent = `${printCount.format(n)} ${n === 1 ? 'payment' : 'payments'}`;

  const head = el('thead');
  const groups = el('tr', undefined, 'schedule-groups');
  const leaves = el('tr');
  let lastGroup = null;
  let groupTh = null;
  for (const [key, header, format, group] of columns) {
    if (group === null) {
      const th = el('th', header, printColClass(key, format));
      th.scope = 'col';
      th.rowSpan = 2;
      groups.appendChild(th);
      continue;
    }
    if (group !== lastGroup) {
      groupTh = el('th', group);
      groupTh.scope = 'colgroup';
      groups.appendChild(groupTh);
      lastGroup = group;
    } else {
      groupTh.colSpan += 1;
    }
    const th = el('th', header, printColClass(key, format));
    th.scope = 'col';
    leaves.appendChild(th);
  }
  head.append(groups, leaves);

  const bodies = [];
  let yearBody = null;
  let year = '';
  for (const row of rows) {
    const rowYear = isoDay(row.date).slice(0, 4);
    if (rowYear !== year) {
      year = rowYear;
      yearBody = el('tbody', undefined, 'schedule-year');
      const yearTr = el('tr', undefined, 'year-row');
      const yearTh = el('th', year);
      yearTh.scope = 'rowgroup';
      yearTh.colSpan = columns.length;
      yearTr.appendChild(yearTh);
      yearBody.appendChild(yearTr);
      bodies.push(yearBody);
    }
    const tr = el('tr');
    for (const [key, , format] of columns) {
      const cell = el(key === 'period' ? 'th' : 'td', printCell(key, format, row), printColClass(key, format));
      if (key === 'period') cell.scope = 'row';
      tr.appendChild(cell);
    }
    yearBody.appendChild(tr);
  }

  const foot = el('tfoot');
  const footTr = el('tr');
  for (const [key, , format] of columns) {
    const cell = key === 'period' ? el('th', 'Totals', printColClass(key, format)) : el('td', printTotal(key, result), printColClass(key, format));
    if (key === 'period') cell.scope = 'row';
    footTr.appendChild(cell);
  }
  foot.appendChild(footTr);

  printScheduleTableEl.replaceChildren(head, ...bodies, foot);
}

function renderPrintRecord(input, result) {
  printInputsEl.replaceChildren(
    ...printInputRows(input).map(([label, value]) => {
      const div = el('div', undefined, 'print-input');
      div.append(el('dt', label), el('dd', value));
      return div;
    }),
  );

  const sent = input.fees.fees;
  if (sent.length === 0) {
    printFeesEl.replaceChildren(el('p', 'No fees.'));
  } else {
    const typedAmounts = [...feesBodyEl.querySelectorAll('[data-field="amount"]')].map((a) => a.value);
    const table = el('table', undefined, 'print-fees');
    const head = el('thead');
    const headTr = el('tr');
    for (const [text, cls] of [['Fee'], ['Amount', 'num'], ['Financed']]) {
      const th = el('th', text, cls);
      th.scope = 'col';
      headTr.appendChild(th);
    }
    head.appendChild(headTr);
    const body = el('tbody');
    sent.forEach((fee, i) => {
      const tr = el('tr');
      tr.append(
        el('td', fee.name),
        el('td', typedMoney(typedAmounts[i] ?? String(fee.amount)), 'num'),
        el('td', fee.financed ? 'Yes' : 'No'),
      );
      body.appendChild(tr);
    });
    table.append(head, body);
    const nodes = [table];
    const parsed = typedAmounts.map(parseMoney);
    if (!parsed.some((a) => a === null)) {
      let financed = 0;
      let notFinanced = 0;
      sent.forEach((fee, i) => {
        if (fee.financed) financed += parsed[i];
        else notFinanced += parsed[i];
      });
      nodes.push(
        el(
          'p',
          `Financed ${printCurrency.format(financed)} · Not financed ${printCurrency.format(notFinanced)}`,
          'fee-subtotals',
        ),
      );
    }
    printFeesEl.replaceChildren(...nodes);
  }

  printFiguresEl.replaceChildren(...figureRows(printFigures(result, input)));

  renderPrintSchedule(result);
}

function figureRows(list) {
  return list.map(([label, value, hint]) => {
    const div = el('div', undefined, 'figure');
    const dt = el('dt', label, 'figure-label');
    if (hint) dt.appendChild(el('span', hint, 'figure-hint'));
    div.append(dt, el('dd', value, 'figure-value'));
    return div;
  });
}

// --- on-screen results and schedule: the app's results panel and schedule table ---

function kpiCard([label, value, hint]) {
  const div = el('div', undefined, 'kpi kpi--headline');
  const data = el('dd', undefined, 'kpi-data');
  data.appendChild(el('span', value, 'kpi-value'));
  if (hint) data.appendChild(el('span', hint, 'kpi-hint'));
  div.append(el('dt', label, 'kpi-label'), data);
  return div;
}

// Width of a headline value in ems at the .kpi-value style (Inter 700 tabular, -0.03em
// tracking), with a 1% margin. Glyph widths are measured in Chrome; the fallback fonts
// (system-ui, Arial) are no wider. The CSS sizes the values so the widest one fits its card.
const KPI_GLYPH_EM = { '.': 0.269, ',': 0.269, '%': 1.016, $: 0.655 };
function kpiValueEm(text) {
  let em = 0;
  for (const ch of text) em += (KPI_GLYPH_EM[ch] ?? (ch >= '0' && ch <= '9' ? 0.647 : 0.655)) - 0.03;
  return em * 1.01;
}

function renderResults(input, result, calculatedAt) {
  resultContextEl.textContent = [
    PRINT_USE_CASES[input.flow] ?? input.flow,
    PRINT_PRODUCT_TYPES[input.productType] ?? input.productType,
    PRINT_RATE_TYPES[input.rateType] ?? input.rateType,
    PRINT_FREQUENCIES[input.paymentFrequency] ?? input.paymentFrequency,
    `Calculated ${clockTimeFmt.format(calculatedAt)}`,
  ].join(' · ');
  const headline = headlineFigures(result);
  headlineFiguresEl.replaceChildren(...headline.map(kpiCard));
  headlineFiguresEl.style.setProperty('--kpi-em', String(Math.max(...headline.map(([, value]) => kpiValueEm(value)))));
  mainFiguresEl.replaceChildren(...figureRows(mainFigures(result)));
  moreFiguresEl.replaceChildren(...figureRows(moreFigures(result, input)));
}

// The columns the app's Compact set keeps.
const COMPACT_KEYS = new Set(['period', 'date', 'paymentAmount', 'interestPaid', 'feesPaid', 'principalPortion', 'closingBalance']);

function showColumn(key) {
  return scheduleColumns !== 'compact' || COMPACT_KEYS.has(key);
}

function screenColClass(key, format) {
  return [`col-${key}`, COMPACT_KEYS.has(key) ? '' : 'col-extra', format === 'currency' || key === 'daysInPeriod' ? 'num' : '']
    .filter(Boolean)
    .join(' ');
}

// Wide screens start with all columns, narrow ones with the compact set, as the app does.
let scheduleColumns = window.matchMedia('(min-width: 768px)').matches ? 'all' : 'compact';
let scheduleResult = null;

function renderScheduleTable() {
  const result = scheduleResult;
  if (!result) return;
  const compact = scheduleColumns === 'compact';
  const rows = result.amortizationSchedule;
  const n = rows.length;
  const payments = `${printCount.format(n)} ${n === 1 ? 'payment' : 'payments'}`;
  scheduleCountEl.textContent = payments;
  for (const radio of columnRadios) radio.checked = radio.value === scheduleColumns;

  const span = n > 0 ? ` from ${formatIsoDate(isoDay(rows[0].date))} to ${formatIsoDate(isoDay(rows[n - 1].date))}` : '';
  const caption = el(
    'caption',
    `Amortization schedule, ${payments}${span}. Amounts rounded to the cent; download the CSV for exact values.`,
    'visually-hidden',
  );

  const head = el('thead');
  const groups = el('tr', undefined, 'schedule-groups');
  const leaves = el('tr');
  const spans = [];
  for (const [key, header, format, group] of PRINT_COLUMNS) {
    if (group === null) {
      const th = el('th', header, screenColClass(key, format));
      th.scope = 'col';
      th.rowSpan = 2;
      groups.appendChild(th);
      continue;
    }
    const last = spans[spans.length - 1];
    if (last && last.group === group) last.keys.push(key);
    else {
      const th = el('th', group);
      th.scope = 'colgroup';
      groups.appendChild(th);
      spans.push({ group, keys: [key], th });
    }
    const th = el('th', header, screenColClass(key, format));
    th.scope = 'col';
    leaves.appendChild(th);
  }
  for (const { keys, th } of spans) {
    const compactCount = keys.filter((k) => COMPACT_KEYS.has(k)).length;
    const hidden = compact && compactCount === 0;
    th.colSpan = compact && !hidden ? compactCount : keys.length;
    if (hidden) th.className = 'col-extra';
  }
  head.append(groups, leaves);

  const bodies = [];
  let yearBody = null;
  let year = '';
  for (const row of rows) {
    const rowYear = isoDay(row.date).slice(0, 4);
    if (rowYear !== year) {
      year = rowYear;
      yearBody = el('tbody', undefined, 'schedule-year');
      const yearTr = el('tr', undefined, 'year-row');
      const yearTh = el('th', year);
      yearTh.scope = 'rowgroup';
      yearTh.colSpan = PRINT_COLUMNS.length;
      yearTr.appendChild(yearTh);
      yearBody.appendChild(yearTr);
      bodies.push(yearBody);
    }
    const tr = el('tr');
    for (const [key, , format] of PRINT_COLUMNS) {
      const cell = el(key === 'period' ? 'th' : 'td', printCell(key, format, row), screenColClass(key, format));
      if (key === 'period') cell.scope = 'row';
      tr.appendChild(cell);
    }
    yearBody.appendChild(tr);
  }

  const foot = el('tfoot');
  const footTr = el('tr');
  for (const [key, , format] of PRINT_COLUMNS) {
    const cell =
      key === 'period'
        ? el('th', 'Totals', screenColClass(key, format))
        : el('td', printTotal(key, result), screenColClass(key, format));
    if (key === 'period') cell.scope = 'row';
    footTr.appendChild(cell);
  }
  foot.appendChild(footTr);

  scheduleTableEl.className = compact ? 'schedule schedule--compact' : 'schedule';
  scheduleTableEl.replaceChildren(caption, head, ...bodies, foot);
}

for (const radio of columnRadios) {
  radio.addEventListener('change', () => {
    if (!radio.checked) return;
    scheduleColumns = radio.value;
    renderScheduleTable();
    if (scheduleResult) renderPrintSchedule(scheduleResult);
  });
}

// Print and download need a current result: one is current exactly while the results
// are shown (the page recomputes on every input change and hides them on invalid input).
// Without one, the buttons are unavailable and the printout is the guard only.
function setCurrentResult(schedule, firstPaymentIso, calculatedAt) {
  const current = schedule !== null;
  lastSchedule = current ? schedule : [];
  lastFirstPaymentIso = current ? firstPaymentIso : '';
  // Unavailable but still focusable, as the app's buttons: clicks are ignored.
  for (const btn of [downloadCsvBtn, printScheduleBtn]) {
    btn.classList.toggle('btn--unavailable', !current);
    if (current) {
      btn.removeAttribute('aria-disabled');
      btn.removeAttribute('aria-describedby');
    } else {
      btn.setAttribute('aria-disabled', 'true');
      btn.setAttribute('aria-describedby', actionsHintEl.id);
    }
  }
  actionsHintEl.hidden = current;
  printedLineEl.hidden = !current;
  calculatedLineEl.hidden = !current;
  printGuardEl.hidden = current;
  printBodyEl.hidden = !current;
  printScheduleSectionEl.hidden = !current;
  if (current) {
    calculatedAtEl.textContent = clockTimeFmt.format(calculatedAt);
    refreshPrintedAt();
  }
}

// --- recompute ---

// With no current result the panel shows the app's empty state; the contract terms and
// the schedule are hidden.
function showResult(shown) {
  resultStatusEl.hidden = shown;
  resultBodyEl.hidden = !shown;
  contractTermsEl.hidden = !shown;
  scheduleSectionEl.hidden = !shown;
}

function recompute() {
  updateConditionalVisibility();
  try {
    const input = buildInput();
    const result = calculateCobCanada(input);
    const calculatedAt = new Date();
    renderContractTerms(input, parseDateInput(contractDateEl.value));
    renderResults(input, result, calculatedAt);
    scheduleResult = result;
    renderScheduleTable();
    renderPrintRecord(input, result);
    setCurrentResult(result.amortizationSchedule, firstPaymentDateEl.value, calculatedAt);
    showResult(true);
    errorEl.style.display = 'none';
  } catch (err) {
    setCurrentResult(null);
    scheduleResult = null;
    showResult(false);
    errorEl.textContent = err instanceof Error ? err.message : String(err);
    errorEl.style.display = 'block';
  }
}

form.addEventListener('input', recompute);
form.addEventListener('change', recompute);
form.addEventListener('submit', (event) => event.preventDefault());

// --- brand logo: hotlinked from alterna.ca; fall back to the name as text if it can't load ---

const brandLogoEl = document.getElementById('brandLogo');
function showBrandFallback() {
  brandLogoEl.hidden = true;
  brandLogoEl.nextElementSibling.hidden = false;
}
if (brandLogoEl.complete && brandLogoEl.naturalWidth === 0) showBrandFallback();
else brandLogoEl.addEventListener('error', showBrandFallback);

// --- initial state ---

// Today's local calendar date (toISOString() is UTC and can be a day off).
function todayLocalIso() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
contractDateEl.value = todayLocalIso();

addFeeRow({ name: 'CMHC mortgage default insurance', amount: 9500, financed: true });
addFeeRow({ name: 'Appraisal fee', amount: 400, financed: false });

updateConditionalVisibility();
recompute();
