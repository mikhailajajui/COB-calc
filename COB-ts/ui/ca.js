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
const paymentFrequencyEl = document.getElementById('paymentFrequency');
const termYearsEl = document.getElementById('termYears');
const termMonthsEl = document.getElementById('termMonths');
const remainingAmortizationYearsEl = document.getElementById('remainingAmortizationYears');
const remainingAmortizationMonthsEl = document.getElementById('remainingAmortizationMonths');
const firstPaymentDateEl = document.getElementById('firstPaymentDate');
const endDateEl = document.getElementById('endDate');

const newFlowFieldsEl = document.getElementById('newFlowFields');
const disbursalDateEl = document.getElementById('disbursalDate');
const preApprovalDateEl = document.getElementById('preApprovalDate');

const existingFlowFieldsEl = document.getElementById('existingFlowFields');
const renewalDateEl = document.getElementById('renewalDate');
const accruedInterestEl = document.getElementById('accruedInterest');

const semiAnnualFieldEl = document.getElementById('semiAnnualField');
const semiAnnualCompoundingDateEl = document.getElementById('semiAnnualCompoundingDate');

const feesBodyEl = document.getElementById('feesBody');
const addFeeBtn = document.getElementById('addFee');

// --- flow <-> product/rate-type locking, per validateCobCanadaInput's flow<->product
// consistency rules (src/ca/validate.ts): newMortgage/existingMortgage require
// productType 'mortgage'; newLoan/existingLoan require 'personalLoan';
// variableRatePaymentChange requires mortgage + variable. Locking the dependent
// dropdowns (rather than just letting the calculation throw) keeps the common path
// error-free while still surfacing a RangeError for any combination the engine itself
// still rejects. ---

const FORCED_PRODUCT_TYPE = {
  newMortgage: 'mortgage',
  newLoan: 'personalLoan',
  existingMortgage: 'mortgage',
  existingLoan: 'personalLoan',
  paymentChange: null,
  variableRatePaymentChange: 'mortgage',
};

const FORCED_RATE_TYPE = {
  variableRatePaymentChange: 'variable',
};

function isNewFlow(flow) {
  return flow === 'newMortgage' || flow === 'newLoan';
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
    <td><input type="text" data-field="name" value="${values.name ?? ''}" placeholder="Fee name" /></td>
    <td><input type="number" step="0.01" data-field="amount" value="${values.amount ?? 0}" /></td>
    <td><input type="checkbox" data-field="financed" ${values.financed ? 'checked' : ''} /></td>
    <td><input type="checkbox" data-field="includedInCob" ${values.includedInCob ? 'checked' : ''} /></td>
    <td><button type="button" class="remove-fee" data-remove>Remove</button></td>
  `;
  tr.querySelector('[data-remove]').addEventListener('click', () => {
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
    // Explicit boolean either way (checkbox.checked is never undefined) -- satisfies
    // validateFee's requirement that includedInCob be explicitly set for a Canadian flow.
    includedInCob: tr.querySelector('[data-field="includedInCob"]').checked,
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
    paymentFrequency: paymentFrequencyEl.value,
    termYears: Number(termYearsEl.value),
    termMonths: Number(termMonthsEl.value),
    remainingAmortizationYears: Number(remainingAmortizationYearsEl.value),
    remainingAmortizationMonths: Number(remainingAmortizationMonthsEl.value),
    firstPaymentDate: parseDateInput(firstPaymentDateEl.value) ?? new Date(NaN),
    endDate: parseDateInput(endDateEl.value) ?? new Date(NaN),
  };

  if (isNewFlow(flow)) {
    const disbursalDate = parseDateInput(disbursalDateEl.value);
    if (disbursalDate) input.disbursalDate = disbursalDate;
    const preApprovalDate = parseDateInput(preApprovalDateEl.value);
    if (preApprovalDate) input.preApprovalDate = preApprovalDate;
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
const dateFmt = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: 'short', day: '2-digit' });

function percentFmt(n) {
  return `${n.toFixed(4)}%`;
}

function renderTotals(result) {
  const triggerIsNa = result.triggerRatePercent === null;
  const items = [
    ['Payment amount', currency.format(result.paymentAmount), false],
    ['COB amount', currency.format(result.cobAmount), false],
    ['COB rate', percentFmt(result.cobRatePercent), false],
    ['Total payment', currency.format(result.totalPayment), false],
    ['Number of payments', String(result.numberOfPayments), false],
    ['Total interest', currency.format(result.totalInterest), false],
    ['Principal payment', currency.format(result.principalPayment), false],
    ['Trigger rate', triggerIsNa ? 'N/A' : percentFmt(result.triggerRatePercent), triggerIsNa],
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
        <td>${row.periodNumber}</td>
        <td>${dateFmt.format(row.periodDate)}</td>
        <td>${currency.format(row.paymentAmount)}</td>
        <td>${currency.format(row.interestPortion)}</td>
        <td>${currency.format(row.principalPortion)}</td>
        <td>${currency.format(row.remainingBalance)}</td>
      </tr>`,
    )
    .join('');
}

// --- recompute ---

function recompute() {
  updateConditionalVisibility();
  try {
    const input = buildInput();
    const result = calculateCobCanada(input);
    renderTotals(result);
    renderSchedule(result.amortizationSchedule);
    resultsEl.style.display = '';
    errorEl.style.display = 'none';
  } catch (err) {
    resultsEl.style.display = 'none';
    errorEl.textContent = err instanceof Error ? err.message : String(err);
    errorEl.style.display = 'block';
  }
}

form.addEventListener('input', recompute);
form.addEventListener('change', recompute);
form.addEventListener('submit', (event) => event.preventDefault());

// --- initial state ---

addFeeRow({ name: 'CMHC mortgage default insurance', amount: 9500, financed: true, includedInCob: false });
addFeeRow({ name: 'Appraisal fee', amount: 400, financed: false, includedInCob: true });

updateConditionalVisibility();
recompute();
