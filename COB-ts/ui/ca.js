import { calculateCobCanada } from '/dist/index.js';

// --- element refs ---

const form = document.getElementById('form');
const errorEl = document.getElementById('error');
const resultsEl = document.getElementById('results');
const totalsEl = document.getElementById('totals');
const scheduleBodyEl = document.getElementById('scheduleBody');

const flowEl = document.getElementById('flow');
const productTypeEl = document.getElementById('productType');
const rateTypeEl = document.getElementById('rateType');

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

function parseDateInput(value) {
  if (!value) return undefined;
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d);
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

function percentFmt(n) {
  return `${n.toFixed(4)}%`;
}

function renderTotals(result, paymentAmount) {
  const triggerIsNa = result.triggerRatePercent === null;
  // One related group per row of four: cost of borrowing, payments, principal/fees, balance.
  const items = [
    ['COB amount', currency.format(result.cobAmount), false],
    ['COB rate', percentFmt(result.cobRatePercent), false],
    ['Calculated rate', `${result.calculatedRatePercent.toFixed(10)}%`, false],
    ['Trigger rate', triggerIsNa ? 'N/A' : percentFmt(result.triggerRatePercent), triggerIsNa],
    ['Payment amount', currency.format(paymentAmount), false],
    ['Number of payments', String(result.numberOfPayments), false],
    ['Total payment', currency.format(result.totalPayment), false],
    ['Total interest', currency.format(result.totalInterest), false],
    ['Principal payment', currency.format(result.principalPayment), false],
    ['Fees recovered', currency.format(result.feesRecovered), false],
    ['Disbursal amount', currency.format(result.disbursalAmount), false],
    ['Amortized principal', currency.format(result.amortizedPrincipal), false],
    ['Ending balance', currency.format(result.endingBalance), false],
  ];
  totalsEl.innerHTML = items
    .map(
      ([label, value, na]) =>
        `<div class="total${na ? ' na' : ''}"><span class="label">${label}</span><span class="value">${value}</span></div>`,
    )
    .join('');
}

function renderSchedule(rows) {
  scheduleBodyEl.innerHTML = rows
    .map(
      (row) => `
      <tr>
        <td>${row.period}</td>
        <td>${dateFmt.format(row.date)}</td>
        <td>${row.daysInPeriod}</td>
        <td>${currency.format(row.openingBalance)}</td>
        <td>${currency.format(row.periodInterest)}</td>
        <td>${currency.format(row.carriedAccruedInterestOpening)}</td>
        <td>${currency.format(row.feesOpening)}</td>
        <td>${currency.format(row.paymentAmount)}</td>
        <td>${currency.format(row.interestPaid)}</td>
        <td>${currency.format(row.feesPaid)}</td>
        <td>${currency.format(row.principalPortion)}</td>
        <td>${currency.format(row.carriedAccruedInterestClosing)}</td>
        <td>${currency.format(row.feesClosing)}</td>
        <td>${currency.format(row.closingBalance)}</td>
      </tr>`,
    )
    .join('');
}

// --- export: CSV download and print ---

let lastSchedule = [];

const CSV_COLUMNS = [
  ['#', (row) => row.period],
  ['Date', (row) => row.date.toISOString().slice(0, 10)],
  ['Days', (row) => row.daysInPeriod],
  ['Opening balance', (row) => row.openingBalance],
  ['Period interest', (row) => row.periodInterest],
  ['Accrued interest (open)', (row) => row.carriedAccruedInterestOpening],
  ['Fees (open)', (row) => row.feesOpening],
  ['Payment', (row) => row.paymentAmount],
  ['Interest paid', (row) => row.interestPaid],
  ['Fees paid', (row) => row.feesPaid],
  ['Principal', (row) => row.principalPortion],
  ['Accrued interest (close)', (row) => row.carriedAccruedInterestClosing],
  ['Fees (close)', (row) => row.feesClosing],
  ['Balance', (row) => row.closingBalance],
];

function csvCell(value) {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

// Amounts are written unrounded, as the engine returns them; rounding is display-only.
function scheduleCsv(rows) {
  const lines = [CSV_COLUMNS.map(([header]) => csvCell(header)).join(',')];
  for (const row of rows) lines.push(CSV_COLUMNS.map(([, get]) => csvCell(get(row))).join(','));
  return lines.join('\r\n') + '\r\n';
}

downloadCsvBtn.addEventListener('click', () => {
  if (lastSchedule.length === 0) return;
  const blob = new Blob([scheduleCsv(lastSchedule)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `cost-of-borrowing-schedule-${firstPaymentDateEl.value || 'export'}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
});

printScheduleBtn.addEventListener('click', () => window.print());

// --- recompute ---

function recompute() {
  updateConditionalVisibility();
  try {
    const input = buildInput();
    const result = calculateCobCanada(input);
    renderTotals(result, input.paymentAmount);
    renderSchedule(result.amortizationSchedule);
    lastSchedule = result.amortizationSchedule;
    resultsEl.style.display = '';
    errorEl.style.display = 'none';
  } catch (err) {
    lastSchedule = [];
    resultsEl.style.display = 'none';
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

addFeeRow({ name: 'CMHC mortgage default insurance', amount: 9500, financed: true });
addFeeRow({ name: 'Appraisal fee', amount: 400, financed: false });

updateConditionalVisibility();
recompute();
