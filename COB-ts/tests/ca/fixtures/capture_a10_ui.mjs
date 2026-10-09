// A10 characterisation capture (procedure A10-CAP, COB-architecture.md §5 A10, revision 15).
// Provenance for tests/ca/fixtures/a10_ui_capture_v1.json (like the generate_*.py scripts; not a vitest file).
//
// It drives the installed Google Chrome (headless) through the `playwright-core` that ships inside the
// globally installed `@playwright/mcp` package, so the project gains no dependency.
//
// usage (from COB-ts/, after `npm run build`):
//   node tests/ca/fixtures/capture_a10_ui.mjs <out.json> [baseUrl]
// Without baseUrl it starts `node ui/serve.mjs` on a free port and stops it afterwards.
// A10-CAP2: rerun after each green step and compare the output, minus `provenance`, with the fixture.
// B28: the shipped page has four Payment frequency options (weekly, biweekly, semiMonthly, monthly); the script throws otherwise.
// B27 (DEV-FB24) locked Payment frequency to Monthly for a personal loan; B33 (DEC-B33-FREQ, 2026-10-05) removed that lock.
// Every scenario still sets flow first, then paymentFrequency, then the rest, and skips a disabled select that already holds
// the wanted value (the flow still forces product / rate for VRPC). For a personal-loan scenario the script ASSERTS (not
// recorded) the unlocked state: Payment frequency enabled, no aria-describedby, holding the scenario's frequency; and the
// same after switching Product to Mortgage and back to Personal loan (value kept, never disabled). B33 appends scenario
// PL_WEEKLY (a weekly personal loan, the only page-level pin of a personal loan at a non-monthly frequency) LAST, so the
// indices of the six earlier scenarios are unchanged.
// B24 (DEV-OQP): the Term years / Term months inputs are gone, the Contract date and the Semi-annual compounding date
// are not filled (hidden behind switches), and ONE read-only field #contractTerm shows the derived Contract term. The
// script no longer fills #termYears, #termMonths, #contractDate or #semiAnnualCompoundingDate and no longer reads them
// into `raw`. It records the field's value as `contractTermField` per scenario ('' when the calculation fails) and the hint
// under it as `flowScreens.<flow>.termHint`; and it ASSERTS (not recorded) that the two number inputs and #contractDate do
// not exist, that #semiAnnualCompoundingDate is not visible, that #contractTerm is a readonly text input placed after
// #endDate, and that its value equals the independent expected text of each successful scenario (EXPECT_TERM, the
// architect's R1 values), so a wrong page cannot be baked into the fixture.
// A11 (scope B, Q-A11-FIX = no): the print table is built when printing, not on every keystroke, so before reading the
// elements the script dispatches `beforeprint` on window, as a print does. a10_ui_capture_v1.json stays byte-identical.
// B32 (DEC-B32-TERM, 2026-10-05): the Contract term runs from the flow's start date (Disbursal date / Renewal date / Date of
// change); EXPECT_TERM holds the B32 vectors-table values. The field's label is per flow ("Remaining contract term" for
// Renewal and Payment change, "Contract term" otherwise; TERM_LABEL), asserted on every scenario page and recorded as
// `flowScreens.<flow>.termLabel` right after `termHint` (which now names the start date).
// B26: after the recorded scenarios one extra step (assertions only, nothing is written to <out.json>) fills a shortfall
// mortgage (200,000 at 5%, monthly, payment 700, End Date 2028-04-15) and asserts the 'Unpaid interest at end date'
// figure ($3,015.17, hint 'Unpaid after the last payment; interest since then is not included') on screen and in the printout, with
// 'Balance at end date' $200,000.00 before it; then REF-01 again and asserts the figure is absent.
// B31 (DEC-B31-LAYOUT, revision 49): ELEMENTS records #printFiguresLeft and #printFiguresRight instead of the old single
// #printFigures list; `figures` is still read from '#printFigures .figure' (the wrapper keeps the id), i.e. left then right.
// The B26 step still reads #moreFigures and #printFigures: Balance at end date stays directly before the unpaid line in both.
// B34 (DEC-B34-TERM, revision 53): the Contract term is shown in whole years and months (rounded up), and when the two rules
// give different values a radio group #contractTermChoice ("Term based on") offers "Start date to end date: {term}" (first,
// checked on a fresh page) and "Start date to final payment: {term}". EXPECT_TERM holds the R8b values (the End date rule,
// since the script NEVER clicks the radios, so the End date radio stays checked across scenarios, B34-R6). Each successful
// scenario records a new key `contractTermChoice` right after `contractTermField`: null when the group is hidden, else
// [{ value, label, checked }] read from the DOM in document order; it is asserted against EXPECT_CHOICE before recording.
// termHint is asserted against the B34 hint "From the {start date}; part months count as a full month.".
import { createRequire } from 'node:module';
import { execSync, spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';

const req = createRequire(execSync('npm root -g').toString().trim() + '/@playwright/mcp/');
const { chromium } = req('playwright-core');
const PLAYWRIGHT_CORE_VERSION = req('playwright-core/package.json').version;

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const [out, baseArg] = process.argv.slice(2);
if (!out) throw new Error('usage: node tests/ca/fixtures/capture_a10_ui.mjs <out.json> [baseUrl]');

// B24: nothing is filled on every scenario any more (the Contract date field is hidden behind a switch).
const COMMON = {};
// B24: the Contract term each successful scenario must show. B32 (DEC-B32-TERM): from the flow's start date to the last
// scheduled payment date (B32 vectors table; was 2,11,17 / 2,11,17 / 2,5,0 / 4,11,11 from the first payment date).
// B34 (DEC-B34-TERM): whole years and months, rounded up, under the End date rule (R8b; was 2y 11m 23d / 2y 11m 23d /
// 2y 6m 0d / 4y 11m 22d / 2y 10m 13d).
const EXPECT_TERM = {
  'REF-01': '3 years',
  S1_fees: '3 years',
  RENEWAL: '2 years, 6 months',
  VRPC_blank_accrued: '',
  VRPC_zero_accrued: '5 years',
  ERR_blank_rate: '',
  PL_WEEKLY: '3 years', // B33 (DEC-B33-FREQ): 2026-03-17 -> End 2029-03-17; B34: the End date rule (final payment 2029-01-30 = 2 years, 11 months)
};
// B34-R8b: the radio group per successful scenario (null = hidden); only PL_WEEKLY offers the choice.
const EXPECT_CHOICE = {
  'REF-01': null,
  S1_fees: null,
  RENEWAL: null,
  VRPC_zero_accrued: null,
  PL_WEEKLY: [
    { value: 'endDate', label: 'Start date to end date: 3 years', checked: true },
    { value: 'lastPayment', label: 'Start date to final payment: 2 years, 11 months', checked: false },
  ],
};
// B32 (DEC-B32-TERM): the label of #contractTerm per flow, typed from the decision.
const TERM_LABEL = {
  newMortgageOrLoan: 'Contract term',
  renewal: 'Remaining contract term',
  paymentChange: 'Remaining contract term',
  variableRatePaymentChange: 'Contract term',
};
const SCENARIOS = [
  {
    id: 'REF-01',
    selects: { flow: 'newMortgageOrLoan', productType: 'mortgage', rateType: 'fixed', paymentFrequency: 'weekly' },
    fields: { loanAmount: '227829.65', contractRatePercent: '3.74', paymentAmount: '465.46',
      disbursalDate: '2026-03-17', firstPaymentDate: '2026-03-23', endDate: '2029-03-17' },
    fees: [],
  },
  {
    id: 'S1_fees',
    selects: { flow: 'newMortgageOrLoan', productType: 'mortgage', rateType: 'fixed', paymentFrequency: 'weekly' },
    fields: { loanAmount: '227829.65', contractRatePercent: '3.74', paymentAmount: '465.46',
      disbursalDate: '2026-03-17', firstPaymentDate: '2026-03-23', endDate: '2029-03-17' },
    fees: [{ name: 'Financed fees', amount: '2000', financed: true }, { name: 'Non-financed fees', amount: '500', financed: false }],
  },
  {
    id: 'RENEWAL',
    selects: { flow: 'renewal', rateType: 'fixed', paymentFrequency: 'monthly' },
    fields: { loanAmount: '150000', contractRatePercent: '4.19', paymentAmount: '900',
      renewalDate: '2026-04-01', firstPaymentDate: '2026-05-01', endDate: '2028-10-01', accruedInterest: '125.50' },
    fees: [{ name: 'Renewal & admin <fee>', amount: '250', financed: false }],
  },
  {
    id: 'VRPC_blank_accrued',
    // B20 (decision 4): a blank Accrued interest is rejected by the engine, so this is an error case
    // (like ERR_blank_rate); the printed VRPC page is VRPC_zero_accrued below.
    // product and rate are forced by the flow (mortgage / variable); read back into `raw`.
    selects: { flow: 'variableRatePaymentChange', paymentFrequency: 'biweekly' },
    fields: { loanAmount: '300000', contractRatePercent: '5.2', paymentAmount: '850',
      renewalDate: '2026-06-15', firstPaymentDate: '2026-06-26', endDate: '2031-06-15', accruedInterest: '' },
    fees: [],
  },
  {
    id: 'VRPC_zero_accrued', // B20: the old VRPC scenario with a typed $0 (zero is a value)
    selects: { flow: 'variableRatePaymentChange', paymentFrequency: 'biweekly' },
    fields: { loanAmount: '300000', contractRatePercent: '5.2', paymentAmount: '850',
      renewalDate: '2026-06-15', firstPaymentDate: '2026-06-26', endDate: '2031-06-15', accruedInterest: '0.00' },
    fees: [],
  },
  {
    id: 'ERR_blank_rate',
    selects: { flow: 'newMortgageOrLoan', productType: 'personalLoan', rateType: 'variable', paymentFrequency: 'monthly' },
    fields: { loanAmount: '10000', contractRatePercent: '', paymentAmount: '300',
      disbursalDate: '2026-03-17', firstPaymentDate: '2026-04-17', endDate: '2029-03-17' },
    fees: [],
  },
  {
    id: 'PL_WEEKLY', // B33 (DEC-B33-FREQ): a personal loan paid weekly; contract rate used as entered (not converted)
    selects: { flow: 'newMortgageOrLoan', productType: 'personalLoan', rateType: 'fixed', paymentFrequency: 'weekly' },
    fields: { loanAmount: '10000', contractRatePercent: '8', paymentAmount: '75', disbursalDate: '2026-03-17', firstPaymentDate: '2026-03-24', endDate: '2029-03-17' },
    fees: [],
  },
];
// B31-R9a (DEC-B31-LAYOUT): the print figures are two lists in the #printFigures wrapper; record each (the wrapper's
// `.figure` read below still gives left then right, in DOM order).
const ELEMENTS = ['printInputs', 'printFees', 'printFiguresLeft', 'printFiguresRight', 'printScheduleTable', 'printScheduleCount', 'scheduleTable',
  'scheduleCount', 'mainFigures', 'moreFigures', 'contractTermsList', 'headlineFigures'];
// B24: no contractDate, termYears, termMonths or semiAnnualCompoundingDate (not on the page / not filled).
const RAW_IDS = ['flow', 'productType', 'rateType', 'loanAmount', 'contractRatePercent', 'paymentAmount',
  'paymentFrequency', 'firstPaymentDate', 'endDate', 'disbursalDate', 'renewalDate', 'accruedInterest'];

async function freePort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

async function startServer() {
  const port = await freePort();
  const child = spawn(process.execPath, ['ui/serve.mjs'], { cwd: ROOT, env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((resolve, reject) => {
    child.once('exit', (code) => reject(new Error(`ui/serve.mjs exited with ${code}`)));
    child.stdout.on('data', (d) => { if (String(d).includes(`:${port}`)) resolve(); });
  });
  return { base: `http://localhost:${port}`, stop: () => child.kill() };
}

// B24: the structure of the form around the Contract term, asserted on every scenario page (nothing is recorded).
async function assertTermField(page, where, flow) {
  const st = await page.evaluate(() => {
    const term = document.getElementById('contractTerm');
    const end = document.getElementById('endDate');
    const semi = document.getElementById('semiAnnualCompoundingDate');
    const visible = (n) => n !== null && n.getClientRects().length > 0 && getComputedStyle(n).display !== 'none' && getComputedStyle(n).visibility !== 'hidden';
    return {
      termYearsNode: document.getElementById('termYears') === null ? 0 : 1,
      termMonthsNode: document.getElementById('termMonths') === null ? 0 : 1,
      contractDateNode: document.getElementById('contractDate') === null ? 0 : 1,
      semiVisible: visible(semi),
      hasTerm: term !== null,
      readonly: term !== null && term.hasAttribute('readonly'),
      type: term?.getAttribute('type') ?? null,
      hintId: term?.getAttribute('aria-describedby') ?? null,
      hintExists: document.getElementById('contractTerm-hint') !== null,
      afterEnd: term !== null && end !== null && Boolean(end.compareDocumentPosition(term) & Node.DOCUMENT_POSITION_FOLLOWING),
      labelText: term ? (document.querySelector('label[for="contractTerm"]')?.textContent ?? null) : null,
    };
  });
  const want = { termYearsNode: 0, termMonthsNode: 0, contractDateNode: 0, semiVisible: false, hasTerm: true, readonly: true, type: 'text',
    hintId: 'contractTerm-hint', hintExists: true, afterEnd: true, labelText: TERM_LABEL[flow] }; // B32 (DEC-B32-TERM): per flow
  for (const k of Object.keys(want)) if (st[k] !== want[k]) throw new Error(`B24 ${where}: ${k} is ${JSON.stringify(st[k])}, expected ${JSON.stringify(want[k])}`);
}

// VRPC-hide (2026-10-01): the shipped page removes the VRPC <option> (UI_SWITCHES.variableRatePaymentChangeFlow = false).
// The engine flow still exists, so the script puts the option back in the live page before selecting it. Harmless when present.
const ensureVrpcOption = (page) => page.evaluate(() => {
  const f = document.getElementById('flow');
  if (f && ![...f.options].some((o) => o.value === 'variableRatePaymentChange')) {
    const o = document.createElement('option');
    o.value = 'variableRatePaymentChange';
    o.textContent = 'Variable rate payment change';
    f.appendChild(o);
  }
});

// COB_PAGE_URL (optional): a full page URL; when set the page is opened there and no server is started.
const PAGE_URL = process.env.COB_PAGE_URL || '';
const server = PAGE_URL ? { base: '', stop: () => {} } : baseArg ? { base: baseArg.replace(/\/$/, ''), stop: () => {} } : await startServer();
const PAGE = PAGE_URL || server.base + '/ui/ca.html';
// B37 addendum (Q-B37-LABEL; DEC-B37-LEAP-N label format: whole numbers, user 2026-10-09): the Payment frequency option
// texts are frequencyOptionText(value, paymentsPerYearFor(input, value)), the engine's n rounded to a whole number. The
// leap-aware n lies in 52.14..52.29 / 26.07..26.14, so every scenario shows the static texts. An assertion, not a recorded
// key (B28-R7 precedent): fixture keys and provenance.tree are unchanged.
const B37_TEXTS = ['Weekly (52/yr)', 'Bi-weekly (26/yr)', 'Semi-monthly (24/yr)', 'Monthly (12/yr)'];
async function assertFrequencyTexts(page, where) {
  const texts = await page.evaluate(() => [...document.querySelectorAll('#paymentFrequency option')].map((o) => o.textContent));
  if (JSON.stringify(texts) !== JSON.stringify(B37_TEXTS)) throw new Error(`B37 ${where}: #paymentFrequency option texts ${JSON.stringify(texts)}, expected ${JSON.stringify(B37_TEXTS)}`);
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true, locale: 'en-CA', timezoneId: 'America/Toronto' });
  const scenarios = [];
  for (const sc of SCENARIOS) {
    const page = await context.newPage();
    await page.goto(PAGE);
    // B23: there are no default fee rows, so there is no count to wait on; the module runs before `load`.
    await page.waitForLoadState('load');
    await ensureVrpcOption(page);
    // B27: flow first, then paymentFrequency, then the rest in object order (productType comes after the frequency).
    const selectOrder = (id) => (id === 'flow' ? 0 : id === 'paymentFrequency' ? 1 : 2);
    const selectEntries = Object.entries(sc.selects).sort(([a], [b]) => selectOrder(a) - selectOrder(b));
    for (const [id, v] of selectEntries) {
      if (await page.locator('#' + id).isDisabled()) {
        const now = await page.locator('#' + id).inputValue();
        if (now !== v) throw new Error(`B27: #${id} is disabled and holds "${now}", the scenario ${sc.id} wants "${v}"`);
        continue;
      }
      await page.selectOption('#' + id, v);
    }
    if (sc.selects.productType === 'personalLoan') {
      // B33 (DEC-B33-FREQ): no lock. The select is enabled, has no hint reference and keeps the scenario's frequency,
      // also after Product -> Mortgage -> Personal loan. Assertions only; nothing is recorded.
      const frequencyState = () => page.evaluate(() => {
        const sel = document.getElementById('paymentFrequency');
        return { disabled: sel.disabled, value: sel.value, describedBy: sel.getAttribute('aria-describedby'), hintNode: document.getElementById('paymentFrequencyHint') === null ? 0 : 1 };
      });
      const want = { disabled: false, value: sc.selects.paymentFrequency, describedBy: null, hintNode: 0 };
      const expectState = (st, where) => {
        for (const k of Object.keys(want)) if (st[k] !== want[k]) throw new Error(`B33 ${sc.id} ${where}: ${k} is ${JSON.stringify(st[k])}, expected ${JSON.stringify(want[k])}`);
      };
      expectState(await frequencyState(), 'personal loan');
      await page.selectOption('#productType', 'mortgage');
      expectState(await frequencyState(), 'switched to mortgage');
      await page.selectOption('#productType', 'personalLoan');
      expectState(await frequencyState(), 'back to personal loan');
    }
    for (const [id, v] of Object.entries({ ...COMMON, ...sc.fields })) await page.fill('#' + id, v);
    // Fees: the form opens with none (B23-R1); add the scenario's rows.
    for (const [i, f] of sc.fees.entries()) {
      await page.click('#addFee');
      const row = page.locator('#feesBody tr').nth(i);
      await row.locator('[data-field="name"]').fill(f.name);
      await row.locator('[data-field="amount"]').fill(f.amount);
      // While the Financed option is switched off (B23) the page has no checkbox; the fee stays non-financed.
      if (f.financed && await row.locator('[data-field="financed"]').count()) await row.locator('[data-field="financed"]').check();
    }
    // RawForm, read back from the page (so forced product/rate and untouched defaults are what the page holds).
    const raw = await page.evaluate((ids) => {
      const o = Object.fromEntries(ids.map((id) => [id, document.getElementById(id).value]));
      o.fees = [...document.querySelectorAll('#feesBody tr')].map((tr) => ({
        name: tr.querySelector('[data-field="name"]').value,
        amount: tr.querySelector('[data-field="amount"]').value,
        financed: tr.querySelector('[data-field="financed"]')?.checked ?? false,
      }));
      return o;
    }, RAW_IDS);
    const error = await page.evaluate(() => {
      const e = document.getElementById('error');
      return e.style.display === 'block' ? e.textContent : null;
    });
    await assertTermField(page, sc.id, raw.flow);
    const contractTermField = await page.locator('#contractTerm').inputValue();
    if (contractTermField !== EXPECT_TERM[sc.id]) {
      throw new Error(`B24 ${sc.id}: #contractTerm is ${JSON.stringify(contractTermField)}, expected ${JSON.stringify(EXPECT_TERM[sc.id])}`);
    }
    // B34 (DEC-B34-TERM): the radio group, read from the DOM in document order (never clicked); asserted, then recorded.
    const contractTermChoice = await page.evaluate(() => {
      const g = document.getElementById('contractTermChoice');
      if (!g || g.hidden) return null;
      return [...g.querySelectorAll('input[type="radio"]')].map((r) => ({
        value: r.value,
        label: document.getElementById(`${r.id}-text`).textContent,
        checked: r.checked,
      }));
    });
    const entry = error === null
      ? { id: sc.id, raw, contractTermField, contractTermChoice, error, modes: {} }
      : { id: sc.id, raw, contractTermField, error, modes: {} };
    if (error === null && JSON.stringify(contractTermChoice) !== JSON.stringify(EXPECT_CHOICE[sc.id])) {
      throw new Error(`B34 ${sc.id}: #contractTermChoice is ${JSON.stringify(contractTermChoice)}, expected ${JSON.stringify(EXPECT_CHOICE[sc.id])}`);
    }
    for (const mode of error === null ? ['all', 'compact'] : []) {
      await page.check(`#scheduleColumns-${mode}`);
      // A11 (scope B): the print table is built on demand, so ask for it the way a print does (the beforeprint event).
      // The fixture is unchanged: the captured strings are what the page held before A11 built it on every keystroke.
      await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
      const html = await page.evaluate((ids) => Object.fromEntries(ids.map((id) => [id, document.getElementById(id).innerHTML])), ELEMENTS);
      const figures = await page.evaluate(() => [...document.querySelectorAll('#printFigures .figure')].map((f) => {
        const dt = f.querySelector('dt');
        const hint = dt.querySelector('.figure-hint');
        const label = dt.firstChild.textContent;
        const value = f.querySelector('dd').textContent;
        return hint ? [label, value, hint.textContent] : [label, value];
      }));
      const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#downloadCsv')]);
      const csvBase64 = readFileSync(await dl.path()).toString('base64');
      entry.modes[mode] = { html, figures, csvFileName: dl.suggestedFilename(), csvBase64 };
    }
    await assertFrequencyTexts(page, `scenario ${sc.id}`);
    scenarios.push(entry);
    await page.close();
  }
  // B26 (Q-B19-ENDACC): the shortfall page, assertion-only (the fixture records no such scenario, Q-B26-FIX).
  // Expected values were measured on the built tree 2026-09-30: last row 2028-04-01, closing accrued 3015.1683939843015.
  {
    const UNPAID = 'Unpaid interest at end date';
    const UNPAID_HINT = 'Unpaid after the last payment; interest since then is not included';
    const SHORTFALL = {
      id: 'B26_shortfall',
      selects: { flow: 'newMortgageOrLoan', productType: 'mortgage', rateType: 'fixed', paymentFrequency: 'monthly' },
      fields: { loanAmount: '200000', contractRatePercent: '5', paymentAmount: '700',
        disbursalDate: '2026-04-01', firstPaymentDate: '2026-05-01', endDate: '2028-04-15' },
    };
    const figuresOf = (page, id) => page.evaluate((elId) => [...document.querySelectorAll(`#${elId} .figure`)].map((f) => {
      const dt = f.querySelector('dt');
      const hint = dt.querySelector('.figure-hint');
      return { label: dt.firstChild.textContent, hint: hint ? hint.textContent : null, value: f.querySelector('dd').textContent };
    }), id);
    const fill = async (page, sc) => {
      await page.goto(PAGE);
      await page.waitForLoadState('load');
      const order = (id) => (id === 'flow' ? 0 : id === 'paymentFrequency' ? 1 : 2);
      for (const [id, v] of Object.entries(sc.selects).sort(([a], [b]) => order(a) - order(b))) {
        if (await page.locator('#' + id).isDisabled()) continue;
        await page.selectOption('#' + id, v);
      }
      for (const [id, v] of Object.entries({ ...COMMON, ...sc.fields })) await page.fill('#' + id, v);
    };
    const page = await context.newPage();
    await fill(page, SHORTFALL);
    for (const listId of ['moreFigures', 'printFigures']) {
      const list = await figuresOf(page, listId);
      const at = list.findIndex((f) => f.label === UNPAID);
      const fail = (why) => { throw new Error(`B26 shortfall #${listId}: ${why} (figures: ${JSON.stringify(list)})`); };
      if (at < 0) fail(`no '${UNPAID}' figure`);
      if (list.filter((f) => f.label === UNPAID).length !== 1) fail('more than one unpaid-interest figure');
      if (list[at].value !== '$3,015.17') fail(`value ${list[at].value}, expected $3,015.17`);
      if (list[at].hint !== UNPAID_HINT) fail(`hint ${JSON.stringify(list[at].hint)}`);
      if (at === 0 || list[at - 1].label !== 'Balance at end date' || list[at - 1].value !== '$200,000.00') fail('Balance at end date $200,000.00 is not directly before it');
    }
    await page.close();
    const ref = await context.newPage();
    await fill(ref, SCENARIOS[0]);
    for (const listId of ['moreFigures', 'printFigures']) {
      const list = await figuresOf(ref, listId);
      if (list.some((f) => f.label === UNPAID)) throw new Error(`B26 REF-01 #${listId}: '${UNPAID}' must not be shown when nothing is unpaid`);
      if (!list.some((f) => f.label === 'Balance at end date')) throw new Error(`B26 REF-01 #${listId}: the figures did not render`);
    }
    await ref.close();
  }
  // B22-R8 (decisions 2 and 5): what each flow shows on screen. A fresh page per flow, nothing typed:
  // the legend and start-date label of the visible fieldset, the first-payment-date label, and, for the
  // flows that show the fieldset, the Accrued interest hint. Order = FLOW_IDS.
  const flowScreens = {};
  for (const flow of ['newMortgageOrLoan', 'renewal', 'paymentChange', 'variableRatePaymentChange']) {
    const page = await context.newPage();
    await page.goto(PAGE);
    await ensureVrpcOption(page);
    await page.selectOption('#flow', flow);
    flowScreens[flow] = await page.evaluate(() => {
      const isNew = document.getElementById('newFlowFields').style.display !== 'none';
      const t = (id) => document.getElementById(id).textContent;
      const s = {
        legend: t(isNew ? 'newFlowLegend' : 'existingFlowLegend'),
        startDate: t(isNew ? 'disbursalDate-label' : 'renewalDate-label'),
        firstPaymentDate: t('firstPaymentDate-label'),
      };
      if (!isNew) s.accruedInterestHint = t('accruedInterest-hint');
      s.termHint = t('contractTerm-hint'); // B24-R6
      s.termLabel = document.querySelector('label[for="contractTerm"]').textContent; // B32 (DEC-B32-TERM)
      return s;
    });
    // B32 (DEC-B32-TERM): assert before recording, so a wrong page cannot be baked into the fixture.
    // B34 (DEC-B34-TERM, revision 53): the hint names the start date only (interim, Q-MSG).
    const wantHint = `From the ${flowScreens[flow].startDate.toLowerCase()}; part months count as a full month.`;
    if (flowScreens[flow].termLabel !== TERM_LABEL[flow] || flowScreens[flow].termHint !== wantHint) {
      throw new Error(`B32 ${flow}: label ${JSON.stringify(flowScreens[flow].termLabel)} / hint ${JSON.stringify(flowScreens[flow].termHint)}, expected ${JSON.stringify(TERM_LABEL[flow])} / ${JSON.stringify(wantHint)}`);
    }
    await page.close();
  }
  // B23-FIX: what a fresh page holds, nothing typed (the fees section; decisions 6 and 7).
  const formDefaults = await (async () => {
    const page = await context.newPage();
    await page.goto(PAGE);
    await page.waitForLoadState('load');
    const d = await page.evaluate(() => ({
      feeRows: document.querySelectorAll('#feesBody tr').length,
      financedControls: document.querySelectorAll('[data-field="financed"]').length,
      feeTableHeaders: [...document.querySelectorAll('#feesWrap th')]
        .filter((th) => th.getClientRects().length > 0 && getComputedStyle(th).display !== 'none')
        .map((th) => th.textContent.trim()),
      printFeeExplanation: document.querySelector('.fees-explain') !== null,
    }));
    // B28-R7: the shipped page has four payment frequency options (the accelerated two are switched off).
    // An assertion, not a recorded key: the fixture is unchanged.
    const freqOptions = await page.evaluate(() => [...document.querySelectorAll('#paymentFrequency option')].map((o) => o.value));
    const FOUR = ['weekly', 'biweekly', 'semiMonthly', 'monthly'];
    if (JSON.stringify(freqOptions) !== JSON.stringify(FOUR)) {
      throw new Error(`B28: #paymentFrequency options are [${freqOptions.join(', ')}], expected [${FOUR.join(', ')}]`);
    }
    await assertFrequencyTexts(page, 'formDefaults (fresh page)');
    await page.close();
    return d;
  })();
  const provenance = {
    script: 'tests/ca/fixtures/capture_a10_ui.mjs',
    chrome: browser.version(),
    playwrightCore: PLAYWRIGHT_CORE_VERSION,
    date: new Date().toISOString(),
    tree: 'post-B24 (Contract term derived; Contract date and Semi-annual date hidden)', // pinned by b23-fees-switch B23-T8; B32 keeps it
  };
  writeFileSync(out, JSON.stringify({ provenance, formDefaults, flowScreens, scenarios }, null, 1) + '\n');
  console.log('ok', provenance.chrome, scenarios.map((s) => `${s.id}:${s.error ?? 'ok'}:${s.modes.all?.figures.length ?? 0}fig`).join(' '));
} finally {
  await browser.close();
  server.stop();
}
