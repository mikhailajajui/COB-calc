import { allowedPaymentFrequencies, calculateCobCanada, contractTerm, FLOWS, requiresSemiAnnualDate } from '/dist/ca/index.js';
import {
  contractTermHint, contractTermParts, contractTermText, csvFileName, firstDateMoveNote, isoDay, figureNodes, flowLabels, formatAmount, frequencyLock, formatCurrency, formatInputDate, headlineFigures, html, label, mainFigures,
  moreFigures, parseDateInput, paymentsText, printFeesNodes, printFigures, printInputNodes, printInputRows, scheduleCsv,
  scheduleTableNodes, toInput, switchedOut, UI_SWITCHES,
} from './ca-view.js';

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
const contractTermsNoteEl = document.getElementById('contractTermsNote');
const firstDateNoteEl = document.getElementById('firstDateNote');
const scheduleSectionEl = document.getElementById('scheduleSection');
const scheduleCountEl = document.getElementById('scheduleCount');
const scheduleTableEl = document.getElementById('scheduleTable');
const columnRadios = [...document.querySelectorAll('input[name="scheduleColumns"]')];

const flowEl = document.getElementById('flow');
const productTypeEl = document.getElementById('productType');
const rateTypeEl = document.getElementById('rateType');
const paymentFrequencyEl = document.getElementById('paymentFrequency');
const paymentFrequencyHintEl = document.getElementById('paymentFrequencyHint');

const contractDateEl = document.getElementById('contractDate');
const loanAmountEl = document.getElementById('loanAmount');
const contractRatePercentEl = document.getElementById('contractRatePercent');
const paymentAmountEl = document.getElementById('paymentAmount');
const firstPaymentDateEl = document.getElementById('firstPaymentDate');
const endDateEl = document.getElementById('endDate');
const contractTermEl = document.getElementById('contractTerm');
const contractTermHintEl = document.getElementById('contractTerm-hint');

const firstPaymentLabelEl = document.getElementById('firstPaymentDate-label');

const newFlowFieldsEl = document.getElementById('newFlowFields');
const newFlowLegendEl = document.getElementById('newFlowLegend');
const disbursalDateEl = document.getElementById('disbursalDate');
const disbursalLabelEl = document.getElementById('disbursalDate-label');

const existingFlowFieldsEl = document.getElementById('existingFlowFields');
const existingFlowLegendEl = document.getElementById('existingFlowLegend');
const renewalDateEl = document.getElementById('renewalDate');
const renewalLabelEl = document.getElementById('renewalDate-label');
const accruedInterestEl = document.getElementById('accruedInterest');
const accruedHintEl = document.getElementById('accruedInterest-hint');

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

// --- flow <-> product/rate-type locking, per the flow catalogue (src/ca/flows.ts,
// FLOWS[flow].forcedProductType / forcedRateType), which validateCobCanadaInput also
// enforces: flow no longer implies productType -- newMortgageOrLoan/renewal/
// paymentChange apply identically to mortgages and personal loans (doc 007 finding
// #9). Renewal is scoped to mortgage (decision 9) and variableRatePaymentChange to
// mortgage + variable (that Flow option is hidden by UI_SWITCHES.variableRatePaymentChangeFlow). Locking the dependent dropdown for those
// cases (rather than just letting the calculation throw) keeps the common path
// error-free while still surfacing a RangeError for any combination the engine
// itself still rejects. ---

function updateConditionalVisibility() {
  const spec = FLOWS[flowEl.value];
  const forcedProduct = spec.forcedProductType;
  if (forcedProduct !== null) {
    productTypeEl.value = forcedProduct;
    productTypeEl.disabled = true;
  } else {
    productTypeEl.disabled = false;
  }

  const forcedRate = spec.forcedRateType;
  if (forcedRate !== null) {
    rateTypeEl.value = forcedRate;
    rateTypeEl.disabled = true;
  } else {
    rateTypeEl.disabled = false;
  }

  const frequency = frequencyLock(productTypeEl.value, allowedPaymentFrequencies(productTypeEl.value), paymentFrequencyEl.value);
  paymentFrequencyEl.value = frequency.value;
  paymentFrequencyEl.disabled = frequency.locked;
  paymentFrequencyHintEl.textContent = frequency.hint;
  paymentFrequencyHintEl.hidden = !frequency.locked;

  const isNew = spec.startDateField === 'disbursalDate';
  newFlowFieldsEl.style.display = isNew ? '' : 'none';
  existingFlowFieldsEl.style.display = isNew ? 'none' : '';

  const texts = flowLabels(flowEl.value, spec);
  firstPaymentLabelEl.textContent = texts.firstPaymentDate;
  newFlowLegendEl.textContent = texts.legend;
  disbursalLabelEl.textContent = texts.startDate;
  existingFlowLegendEl.textContent = texts.legend;
  renewalLabelEl.textContent = texts.startDate;
  if (texts.accruedHint !== null) accruedHintEl.textContent = texts.accruedHint;
  contractTermHintEl.textContent = contractTermHint(texts.firstPaymentDate.toLowerCase());

  semiAnnualFieldEl.style.display = requiresSemiAnnualDate(productTypeEl.value, rateTypeEl.value) ? '' : 'none';
}

// --- fee table ---

let feeRowId = 0;

function addFeeRow(values = {}) {
  const id = feeRowId++;
  const tr = document.createElement('tr');
  tr.dataset.id = String(id);
  tr.innerHTML = `
    <td><input type="text" data-field="name" value="${values.name ?? ''}" placeholder="Fee name" aria-label="Fee name" /></td>
    <td><input type="text" inputmode="decimal" autocomplete="off" data-money data-field="amount" value="${formatAmount(String(values.amount ?? 0))}" /></td>
    ${viewCtx().switches.financedOption ? `<td><input type="checkbox" data-field="financed" ${values.financed ? 'checked' : ''} /></td>` : ''}
    <td><button type="button" class="remove-fee" data-remove>Remove</button></td>
  `;
  const nameEl = tr.querySelector('[data-field="name"]');
  const amountEl = tr.querySelector('[data-field="amount"]');
  const financedEl = tr.querySelector('[data-field="financed"]');
  const removeBtn = tr.querySelector('[data-remove]');
  const labelRow = () => {
    const name = nameEl.value || 'Fee';
    amountEl.setAttribute('aria-label', `Amount: ${name}`);
    financedEl?.setAttribute('aria-label', `Financed: ${name}`);
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
    name: tr.querySelector('[data-field="name"]').value,
    amount: tr.querySelector('[data-field="amount"]').value,
    financed: tr.querySelector('[data-field="financed"]')?.checked ?? false,
  }));
}

addFeeBtn.addEventListener('click', () => {
  addFeeRow();
  recompute();
});

function selectedText(selectEl) {
  return selectEl.selectedOptions[0]?.textContent ?? selectEl.value;
}

// The terms of the calculation that produced the shown results, as entered, one tile
// each. Amounts, rates, dates and single words stay on one line (fitTermValues); the
// flow, product type and contract term may wrap between words.
function renderContractTerms(input, contractDate, ctx, result) {
  if (contractTermsDateEl) contractTermsDateEl.textContent = contractDate ? formatInputDate(contractDate) : 'no date entered';

  const spec = FLOWS[input.flow];
  const texts = flowLabels(input.flow, spec);
  const noBreak = (text) => text.replace(' ', '\u00a0');
  const items = [
    ['Flow', selectedText(flowEl), false],
    ['Product type', selectedText(productTypeEl), false],
    ['Rate type', selectedText(rateTypeEl)],
    ['Loan amount', formatCurrency(input.loanAmount)],
    ['Contract rate', `${contractRatePercentEl.value.trim()}%`],
    ['Payment amount', formatCurrency(input.paymentAmount)],
  ];
  if (spec.accruedInterest !== 'hidden') {
    items.push(['Accrued interest', formatCurrency(input.accruedInterest)]);
  }
  items.push(
    ['Payment frequency', label('paymentFrequency', input.paymentFrequency)],
    ['Contract term', contractTermParts(contractTerm(result)).map(noBreak).join(', '), false],
    [texts.startDate, formatInputDate(input[spec.startDateField])],
    [texts.firstPaymentDate, formatInputDate(input.firstPaymentDate)],
    ['End date', formatInputDate(input.endDate)],
  );
  if (requiresSemiAnnualDate(input.productType, input.rateType)) {
    items.push(['Semi-annual compounding reference date', formatInputDate(input.semiAnnualCompoundingDate)]);
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
        el('span', formatCurrency(fee.amount), 'fee-amount'),
        ...(ctx.switches.financedOption ? [' ', el('span', fee.financed ? 'Financed' : 'Not financed', 'fee-tag')] : []),
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

// Built in the browser and handed over as a download; nothing is stored.
downloadCsvBtn.addEventListener('click', () => {
  if (downloadCsvBtn.getAttribute('aria-disabled') === 'true' || lastSchedule.length === 0) return;
  const blob = new Blob([scheduleCsv(lastSchedule, scheduleColumns, scheduleCtx)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = csvFileName(lastFirstPaymentIso);
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

function renderPrintSchedule(result) {
  printScheduleCountEl.textContent = paymentsText(result.amortizationSchedule.length);
  printScheduleTableEl.innerHTML = html(scheduleTableNodes(result, 'print', scheduleColumns, scheduleCtx));
}

// The print table is built only when a print is about to happen, and only if the result or the
// column set changed since the last build.
let printBuiltFor = null;
let printBuiltColumns = null;
function ensurePrintSchedule() {
  if (!scheduleResult) return;
  if (printBuiltFor === scheduleResult && printBuiltColumns === scheduleColumns) return;
  renderPrintSchedule(scheduleResult);
  printBuiltFor = scheduleResult;
  printBuiltColumns = scheduleColumns;
}
window.addEventListener('beforeprint', ensurePrintSchedule);
window.matchMedia('print').addEventListener('change', (event) => {
  if (event.matches) ensurePrintSchedule();
});

function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function renderPrintRecord(raw, ctx, result, termText, moveNote) {
  printInputsEl.innerHTML = html(printInputNodes(printInputRows(raw, ctx, termText, moveNote)));
  printFeesEl.innerHTML = html(printFeesNodes(raw.fees, ctx));
  printFiguresEl.innerHTML = html(figureNodes(printFigures(result, ctx)));
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

function renderResults(input, result, calculatedAt, ctx) {
  resultContextEl.textContent = [
    label('flow', input.flow),
    label('productType', input.productType),
    label('rateType', input.rateType),
    label('paymentFrequency', input.paymentFrequency),
    `Calculated ${clockTimeFmt.format(calculatedAt)}`,
  ].join(' · ');
  const headline = headlineFigures(result);
  headlineFiguresEl.replaceChildren(...headline.map(kpiCard));
  headlineFiguresEl.style.setProperty('--kpi-em', String(Math.max(...headline.map(([, value]) => kpiValueEm(value)))));
  mainFiguresEl.innerHTML = html(figureNodes(mainFigures(result)));
  moreFiguresEl.innerHTML = html(figureNodes(moreFigures(result, ctx)));
}

// Wide screens start with all columns, narrow ones with the compact set, as the app does.
let scheduleColumns = window.matchMedia('(min-width: 768px)').matches ? 'all' : 'compact';
let scheduleResult = null;
let scheduleCtx = null;

function renderScheduleTable() {
  const result = scheduleResult;
  if (!result) return;
  scheduleCountEl.textContent = paymentsText(result.amortizationSchedule.length);
  for (const radio of columnRadios) radio.checked = radio.value === scheduleColumns;
  scheduleTableEl.className = scheduleColumns === 'compact' ? 'schedule schedule--compact' : 'schedule';
  scheduleTableEl.innerHTML = html(scheduleTableNodes(result, 'screen', scheduleColumns, scheduleCtx));
}

for (const radio of columnRadios) {
  radio.addEventListener('change', () => {
    if (!radio.checked) return;
    scheduleColumns = radio.value;
    renderScheduleTable();
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

function readForm() {
  const v = (el) => el.value;
  return {
    flow: v(flowEl),
    productType: v(productTypeEl),
    rateType: v(rateTypeEl),
    contractDate: contractDateEl ? v(contractDateEl) : '',
    loanAmount: v(loanAmountEl),
    contractRatePercent: v(contractRatePercentEl),
    paymentAmount: v(paymentAmountEl),
    paymentFrequency: v(paymentFrequencyEl),
    firstPaymentDate: v(firstPaymentDateEl),
    endDate: v(endDateEl),
    disbursalDate: v(disbursalDateEl),
    renewalDate: v(renewalDateEl),
    accruedInterest: v(accruedInterestEl),
    semiAnnualCompoundingDate: v(semiAnnualCompoundingDateEl),
    fees: readFees(),
  };
}

function viewContext(raw) {
  return { spec: FLOWS[raw.flow], semiAnnual: requiresSemiAnnualDate(raw.productType, raw.rateType), switches: UI_SWITCHES };
}

function viewCtx() {
  return viewContext({ flow: flowEl.value, productType: productTypeEl.value, rateType: rateTypeEl.value });
}

function recompute() {
  updateConditionalVisibility();
  try {
    const raw = readForm();
    const ctx = viewContext(raw);
    const input = toInput(raw, ctx);
    const result = calculateCobCanada(input);
    const calculatedAt = new Date();
    const termText = contractTermText(contractTerm(result));
    const texts = flowLabels(raw.flow, ctx.spec);
    const moveNote = firstDateMoveNote(texts.firstPaymentDate, raw.firstPaymentDate, result.amortizationSchedule[0]?.date);
    renderContractTerms(input, parseDateInput(raw.contractDate), ctx, result);
    renderResults(input, result, calculatedAt, ctx);
    scheduleResult = result;
    scheduleCtx = ctx;
    renderScheduleTable();
    renderPrintRecord(raw, ctx, result, termText, moveNote);
    firstDateNoteEl.textContent = moveNote;
    firstDateNoteEl.hidden = !moveNote;
    contractTermsNoteEl.textContent = moveNote;
    contractTermsNoteEl.hidden = !moveNote;
    contractTermEl.value = termText;
    setCurrentResult(result.amortizationSchedule, isoDay(result.amortizationSchedule[0].date), calculatedAt);
    showResult(true);
    errorEl.style.display = 'none';
  } catch (err) {
    contractTermEl.value = '';
    firstDateNoteEl.textContent = '';
    firstDateNoteEl.hidden = true;
    contractTermsNoteEl.textContent = '';
    contractTermsNoteEl.hidden = true;
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
// A money field shows money format once the user leaves it (Q-MONEY-FMT); the value is unchanged.
form.addEventListener('focusout', (event) => {
  if (event.target.matches('input[data-money]')) event.target.value = formatAmount(event.target.value);
});

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
if (contractDateEl && !switchedOut(viewCtx(), 'contractDateField')) contractDateEl.value = todayLocalIso();

for (const node of document.querySelectorAll('[data-switch]')) {
  if (switchedOut(viewCtx(), node.dataset.switch)) node.remove();
}

updateConditionalVisibility();
recompute();
