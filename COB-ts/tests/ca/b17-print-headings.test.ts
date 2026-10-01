/**
 * B17 (COB-architecture.md §5 B17, revision 17): short column headings in the printed schedule.
 * User decision Q-PRINT-HEAD (COB-user-stories.md §7.5, 2026-09-29): the printed schedule must show
 * every column; print-only headings #, Date, Days, Balance, Fees, Period, Accrued, Payment, Interest,
 * Fees, Principal, Accrued, Fees, Balance under the existing group headings. The screen keeps its
 * headings and the CSV keeps its own (OQ-J). UI print only; no Excel output involved, no DEV-ID.
 * QA red tests, 2026-09-29, written before the developer step.
 *
 * Rules: B17-R1 (a 5th element `printHeader` in each COLUMNS row), B17-R2 (the one builder uses it
 * for target 'print' only), B17-R3 (screen, CSV and the rest unchanged). The real fit check is F12,
 * the Chrome script tests/ui/check_print_width.mjs; B17-6 is only a cheap static proxy.
 *
 * Tests B17-1…B17-6. Each ca-view import is a per-test dynamic import.
 */
import { describe, expect, it } from 'vitest';
import { calculateCobCanada, FLOWS, requiresSemiAnnualDate } from '../../src/ca/index.js';
import type { CobCanadaResult, CobFlow, ProductType, RateType } from '../../src/ca/index.js';
import type * as View from '../../ui/ca-view.js';
import { loadFixture } from './support/fixtures.js';
import { ON } from './support/uiSwitches.js';

const loadView = () => import('../../ui/ca-view.js') as Promise<typeof View>;

const SCREEN_HEADERS = [
  '#', 'Date', 'Days', 'Opening balance', 'Fees (opening)', 'Period interest', 'Accrued interest (opening)', 'Payment',
  'Interest paid', 'Fees paid', 'Principal paid', 'Accrued interest (closing)', 'Fees (closing)', 'Balance',
];
const PRINT_HEADERS = [
  '#', 'Date', 'Days', 'Balance', 'Fees', 'Period', 'Accrued', 'Payment', 'Interest', 'Fees', 'Principal', 'Accrued', 'Fees', 'Balance',
];
const GROUPS_ALL = ['#', 'Date', 'Days', 'Opening', 'Interest', 'Payment breakdown', 'Closing'];

/** REF-01 (the A10 capture's raw) through toInput and the engine. */
let refCtx: View.ViewContext;
async function ref01(v: typeof View): Promise<CobCanadaResult> {
  const cap = loadFixture<{ scenarios: { id: string; raw: View.RawForm }[] }>('a10_ui_capture_v1.json');
  const raw = cap.scenarios.find((s) => s.id === 'REF-01')!.raw;
  const ctx: View.ViewContext = {
    spec: FLOWS[raw.flow as CobFlow],
    semiAnnual: requiresSemiAnnualDate(raw.productType as ProductType, raw.rateType as RateType),
    switches: ON, // B23: these tests characterise the pre-B23 (financed-on) columns
  };
  refCtx = ctx;
  return calculateCobCanada(v.toInput(raw, ctx));
}

const textOf = (n: View.ViewNode | string): string => (typeof n === 'string' ? n : n.children.map(textOf).join(''));
const nodeChildren = (n: View.ViewNode): View.ViewNode[] => n.children.filter((c): c is View.ViewNode => typeof c !== 'string');

/** The texts of the thead's two rows (group row, leaf row) built by scheduleTableNodes. */
function headingRows(nodes: View.ViewNode[]): { groups: string[]; leaves: string[] } {
  const thead = nodes.find((n) => n.tag === 'thead');
  if (!thead) throw new Error('no thead node');
  const [groupRow, leafRow] = nodeChildren(thead);
  return { groups: nodeChildren(groupRow!).map(textOf), leaves: nodeChildren(leafRow!).map(textOf) };
}

describe('B17-R1 one column list, two headings', () => {
  it('B17-1: COLUMNS keeps the 14 screen headings and gains the 14 Q-PRINT-HEAD print headings (5th element), in order', async () => {
    const { COLUMNS } = await loadView();
    expect(COLUMNS.map((c) => c[1])).toEqual(SCREEN_HEADERS);
    expect(COLUMNS.map((c) => c[4])).toEqual(PRINT_HEADERS);
  });
});

describe('B17-R2 the one builder: print headings for target print only', () => {
  it('B17-2: print, All columns: groups unchanged, leaf headings short', async () => {
    const v = await loadView();
    expect(headingRows(v.scheduleTableNodes(await ref01(v), 'print', 'all', refCtx))).toEqual({
      groups: GROUPS_ALL,
      leaves: ['Balance', 'Fees', 'Period', 'Accrued', 'Payment', 'Interest', 'Fees', 'Principal', 'Accrued', 'Fees', 'Balance'],
    });
  });

  it('B17-3: print, Compact: groups unchanged, leaf headings short', async () => {
    const v = await loadView();
    expect(headingRows(v.scheduleTableNodes(await ref01(v), 'print', 'compact', refCtx))).toEqual({
      groups: ['#', 'Date', 'Payment breakdown', 'Closing'],
      leaves: ['Payment', 'Interest', 'Fees', 'Principal', 'Balance'],
    });
  });

  it('B17-4 (B17-R3): the screen table keeps its long headings in both modes', async () => {
    const v = await loadView();
    const r = await ref01(v);
    for (const mode of ['all', 'compact'] as const) {
      // The screen builds every column in both modes (CSS hides col-extra).
      expect(headingRows(v.scheduleTableNodes(r, 'screen', mode, refCtx)), mode).toEqual({
        groups: GROUPS_ALL,
        leaves: SCREEN_HEADERS.slice(3),
      });
    }
  });
});

describe('B17-R3 CSV unchanged (OQ-J)', () => {
  it('B17-5: the CSV header lines are unchanged in both modes', async () => {
    const v = await loadView();
    const rows = (await ref01(v)).amortizationSchedule;
    expect(v.scheduleCsv(rows, 'all', refCtx).split('\r\n')[0]).toBe(
      '#,Date,Days,Opening balance,Period interest,Accrued interest (open),Fees (open),Payment,Interest paid,Fees paid,Principal,Accrued interest (close),Fees (close),Balance',
    );
    expect(v.scheduleCsv(rows, 'compact', refCtx).split('\r\n')[0]).toBe('#,Date,Payment,Interest paid,Fees paid,Principal,Balance');
  });
});

describe('B17 static width proxy (F12 is the real check)', () => {
  it('B17-6: every print heading is a string no longer than min(9, its screen heading)', async () => {
    const { COLUMNS } = await loadView();
    const tooLong = COLUMNS.filter((c) => typeof c[4] !== 'string' || c[4].length > Math.min(9, c[1].length)).map((c) => `${c[0]}: ${String(c[4])}`);
    expect(tooLong).toEqual([]);
  });
});
