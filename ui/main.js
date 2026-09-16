import { summarizeMortgage } from '/dist/index.js';

const segmentsEl = document.getElementById('segments');
const addSegmentBtn = document.getElementById('addSegment');
const form = document.getElementById('form');
const errorEl = document.getElementById('error');
const resultsEl = document.getElementById('results');
const totalsEl = document.getElementById('totals');
const scheduleBodyEl = document.getElementById('scheduleBody');
const overridesJsonEl = document.getElementById('overridesJson');

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function segmentFieldset(index, values = {}) {
  const fs = document.createElement('fieldset');
  fs.className = 'segment';
  fs.dataset.index = String(index);
  fs.innerHTML = `
    <legend class="segment-legend"><span class="title">Segment ${index + 1}</span><span class="kind"></span></legend>
    <div class="grid">
      <div class="field">
        <label>Start date (first payment)</label>
        <input type="date" name="startDate" value="${values.startDate ?? todayIso()}" required />
      </div>
      <div class="field">
        <label>Annual interest rate (%)</label>
        <input type="number" step="0.001" name="annualInterestRatePercent" value="${values.annualInterestRatePercent ?? ''}" required />
      </div>
      ${
        index === 0
          ? `<div class="field">
              <label>Starting balance ($)</label>
              <input type="number" step="0.01" name="startingBalance" value="${values.startingBalance ?? ''}" required />
            </div>`
          : ''
      }
      <div class="field">
        <label>Payment amount ($, optional)</label>
        <input type="number" step="0.01" name="paymentAmount" value="${values.paymentAmount ?? ''}" />
      </div>
      <div class="field">
        <label>Amortization months remaining</label>
        <input type="number" step="1" name="amortizationMonthsRemaining" value="${values.amortizationMonthsRemaining ?? ''}" />
      </div>
      <div class="field">
        <label>Term months (blank = runs to payoff)</label>
        <input type="number" step="1" name="termMonths" value="${values.termMonths ?? ''}" />
      </div>
    </div>
    <div class="row-actions">
      <button type="button" class="remove-segment" data-remove>Remove segment</button>
    </div>
  `;
  fs.querySelector('[data-remove]').addEventListener('click', () => {
    fs.remove();
    refreshSegmentChrome();
    invalidateResults();
  });
  return fs;
}

/**
 * Renumbers segments, labels each one's kind (Origination / Renewal / Payment change /
 * Continuation) from its actual field values compared to the previous segment, and
 * inserts a plain-language connector between consecutive segment boxes describing the
 * real transition — this only works because segments are a genuine chronological
 * sequence, not decoration.
 */
function refreshSegmentChrome() {
  segmentsEl.querySelectorAll('.connector').forEach((el) => el.remove());
  const fieldsets = [...segmentsEl.querySelectorAll('fieldset.segment')];

  fieldsets.forEach((fs, i) => {
    fs.dataset.index = String(i);
    fs.querySelector('.title').textContent = `Segment ${i + 1}`;
    const kindEl = fs.querySelector('.kind');
    const rate = fs.querySelector('[name="annualInterestRatePercent"]').value;
    const paymentAmount = fs.querySelector('[name="paymentAmount"]').value;
    const amortization = fs.querySelector('[name="amortizationMonthsRemaining"]').value;

    if (i === 0) {
      kindEl.textContent = '— Origination';
      return;
    }

    const prevRate = fieldsets[i - 1].querySelector('[name="annualInterestRatePercent"]').value;
    const connector = document.createElement('div');
    connector.className = 'connector';

    if (rate !== '' && rate !== prevRate) {
      kindEl.textContent = '— Renewal';
      connector.textContent = amortization
        ? `Renewed into ${rate}% for the remaining ${amortization} months.`
        : `Renewed into ${rate}%.`;
    } else if (paymentAmount !== '') {
      kindEl.textContent = '— Payment change';
      connector.textContent = `Payment changed to $${paymentAmount} per month.`;
    } else {
      kindEl.textContent = '— Continuation';
      connector.textContent = rate !== '' ? `Continues at ${rate}%.` : 'Continues.';
    }

    segmentsEl.insertBefore(connector, fs);
  });
}

function clearSegmentPayments() {
  segmentsEl.querySelectorAll('.segment-payment').forEach((el) => el.remove());
}

function invalidateResults() {
  resultsEl.style.display = 'none';
  errorEl.style.display = 'none';
  clearSegmentPayments();
}

function addSegment(values) {
  const index = segmentsEl.querySelectorAll('fieldset.segment').length;
  segmentsEl.appendChild(segmentFieldset(index, values));
  refreshSegmentChrome();
}

function clearSegments() {
  segmentsEl.innerHTML = '';
}

function loadPreset(name) {
  clearSegments();
  if (name === 'simple') {
    addSegment({
      startDate: '2024-01-01',
      annualInterestRatePercent: 6,
      startingBalance: 200000,
      amortizationMonthsRemaining: 360,
    });
  } else if (name === 'renewal') {
    addSegment({
      startDate: '2020-01-01',
      annualInterestRatePercent: 5,
      startingBalance: 200000,
      amortizationMonthsRemaining: 300,
      termMonths: 60,
    });
    addSegment({
      startDate: '2025-01-01',
      annualInterestRatePercent: 4,
      amortizationMonthsRemaining: 240,
    });
  } else if (name === 'ratechange') {
    addSegment({
      startDate: '2023-01-01',
      annualInterestRatePercent: 3,
      startingBalance: 200000,
      amortizationMonthsRemaining: 300,
      termMonths: 13,
    });
    addSegment({
      startDate: '2024-02-01',
      annualInterestRatePercent: 5,
      amortizationMonthsRemaining: 287,
    });
  }
  overridesJsonEl.value = '';
  invalidateResults();
}

document.querySelectorAll('[data-preset]').forEach((btn) => {
  btn.addEventListener('click', () => loadPreset(btn.dataset.preset));
});

addSegmentBtn.addEventListener('click', () => {
  addSegment();
  invalidateResults();
});

// Keep each segment's kind label and the connector text live as rate/payment fields change.
segmentsEl.addEventListener('input', (event) => {
  if (event.target.matches('[name="annualInterestRatePercent"], [name="paymentAmount"], [name="amortizationMonthsRemaining"]')) {
    refreshSegmentChrome();
  }
});

function parseDateInput(value) {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function numOrUndefined(value) {
  if (value === '' || value === null || value === undefined) return undefined;
  const n = Number(value);
  return Number.isNaN(n) ? undefined : n;
}

function readSegmentsFromForm() {
  return [...segmentsEl.querySelectorAll('fieldset.segment')].map((fs) => {
    const get = (name) => fs.querySelector(`[name="${name}"]`)?.value ?? '';
    const segment = {
      startDate: parseDateInput(get('startDate')),
      annualInterestRatePercent: Number(get('annualInterestRatePercent')),
    };
    const startingBalance = numOrUndefined(get('startingBalance'));
    if (startingBalance !== undefined) segment.startingBalance = startingBalance;
    const paymentAmount = numOrUndefined(get('paymentAmount'));
    if (paymentAmount !== undefined) segment.paymentAmount = paymentAmount;
    const amortizationMonthsRemaining = numOrUndefined(get('amortizationMonthsRemaining'));
    if (amortizationMonthsRemaining !== undefined)
      segment.amortizationMonthsRemaining = amortizationMonthsRemaining;
    const termMonths = numOrUndefined(get('termMonths'));
    if (termMonths !== undefined) segment.termMonths = termMonths;
    return segment;
  });
}

const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const dateFmt = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short', day: '2-digit' });

function renderTotals(summary) {
  const items = [
    ['Total paid', currency.format(summary.totalOfPayments)],
    ['Total interest', currency.format(summary.totalInterestPaid)],
    ['Payments', String(summary.numberOfPayments)],
    ['Payoff date', dateFmt.format(summary.payoffDate)],
  ];
  totalsEl.innerHTML = items
    .map(([label, value]) => `<div class="total"><span class="label">${label}</span><span class="value">${value}</span></div>`)
    .join('');
}

function renderSegmentPayments(segmentSummaries) {
  segmentSummaries.forEach((s, i) => {
    const fs = segmentsEl.querySelector(`fieldset.segment[data-index="${s.segmentIndex}"]`);
    if (!fs) return;
    const isLast = i === segmentSummaries.length - 1;
    const payEl = document.createElement('p');
    payEl.className = 'segment-payment';
    payEl.textContent = isLast
      ? `Payment: ${currency.format(s.monthlyPayment)} per month. Pays off in full.`
      : `Payment: ${currency.format(s.monthlyPayment)} per month. Ends the term at ${currency.format(s.endingBalance)}, carried into the next segment.`;
    fs.insertBefore(payEl, fs.querySelector('.row-actions'));
  });
}

function renderSchedule(rows) {
  let html = '';
  let lastYear = null;
  for (const row of rows) {
    const year = row.paymentDate.getFullYear();
    if (year !== lastYear) {
      html += `<tr class="year-marker"><td colspan="7">${year}</td></tr>`;
      lastYear = year;
    }
    html += `
      <tr class="${row.isManualOverride ? 'override' : ''}">
        <td>${row.paymentNumber}</td>
        <td>${row.segmentIndex + 1}</td>
        <td>${dateFmt.format(row.paymentDate)}</td>
        <td>${currency.format(row.paymentAmount)}</td>
        <td>${currency.format(row.interestPortion)}</td>
        <td>${currency.format(row.principalPortion)}</td>
        <td>${currency.format(row.remainingBalance)}</td>
      </tr>`;
  }
  scheduleBodyEl.innerHTML = html;
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  errorEl.style.display = 'none';
  resultsEl.style.display = 'none';
  clearSegmentPayments();

  try {
    const segments = readSegmentsFromForm();
    let manualOverrides;
    const raw = overridesJsonEl.value.trim();
    if (raw) {
      manualOverrides = JSON.parse(raw);
    }

    const summary = summarizeMortgage({ segments, manualOverrides });
    renderTotals(summary);
    renderSegmentPayments(summary.segmentSummaries);
    renderSchedule(summary.schedule);
    resultsEl.style.display = '';
  } catch (err) {
    errorEl.textContent = err instanceof Error ? err.message : String(err);
    errorEl.style.display = 'block';
  }
});

loadPreset('simple');
