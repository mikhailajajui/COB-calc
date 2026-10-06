// Types of ui/ca-view.js (A10). The contract QA's tests compile against; see COB-architecture.md §5 A10.
import type { CobCanadaInput, CobCanadaResult, CobScheduleRow, FlowSpec } from '../src/ca/index.js';

export interface RawFee { name: string; amount: string; financed: boolean }
/** B24-R6: no termYears / termMonths (the Term inputs are removed); contractDate and semiAnnualCompoundingDate are optional (their fields are hidden behind switches). */
export interface RawForm {
  flow: string; productType: string; rateType: string; contractDate?: string;
  loanAmount: string; contractRatePercent: string; paymentAmount: string; paymentFrequency: string;
  firstPaymentDate: string; endDate: string;
  disbursalDate: string; renewalDate: string; accruedInterest: string; semiAnnualCompoundingDate?: string;
  fees: RawFee[];
}
/** B23-R3 / B28-R1 / B24-R5: the UI switches (ADR-14). financedOption, acceleratedFrequencies and contractDateField are shipped false. */
export interface UiSwitches { readonly financedOption: boolean; readonly acceleratedFrequencies: boolean; readonly contractDateField: boolean;
  /** VRPC-hide (user 2026-10-01): the Variable rate payment change option of the Flow dropdown. Shipped false. Optional so older literals compile; absent counts as off. */
  readonly variableRatePaymentChangeFlow?: boolean }
export interface ViewContext { spec: FlowSpec; semiAnnual: boolean; switches: UiSwitches }
export type Figure = [label: string, value: string] | [label: string, value: string, hint: string];
/** B31 (DEC-B31-LAYOUT): the printout's two figure columns, each read top to bottom. */
export interface FigureColumns { left: Figure[]; right: Figure[] }
export interface ViewNode { tag: string; attrs: [string, string][]; children: (ViewNode | string)[] }
export type ColumnsMode = 'all' | 'compact';
export type TableTarget = 'screen' | 'print';
export type LabelKind = 'flow' | 'productType' | 'rateType' | 'paymentFrequency';

export const LABELS: Readonly<Record<LabelKind, Readonly<Record<string, string>>>>;
export function label(kind: LabelKind, value: string): string;
export function formatCurrency(value: number): string;
export function formatInputDate(date: Date | undefined): string;
export function formatRate(value: number): string;
export function isoDay(date: Date): string;
export function formatIsoDate(iso: string): string;
export function typedMoney(typed: string): string;
export function parseMoney(raw: string): number | null;
export function parseAmount(raw: string): number | undefined;
export function formatAmount(raw: string): string;
export function paymentsText(n: number): string;
export function parseDateInput(value: string): Date | undefined;
export function numOrUndefined(value: string | null | undefined): number | undefined;
export function toInput(raw: RawForm, ctx: ViewContext): CobCanadaInput;
/**
 * B22-R2: the per-flow texts of the form, the contract-terms tiles and the print record. accruedHint is null when spec.accruedInterest is 'hidden'.
 * B32 (DEC-B32-TERM): contractTerm is 'Remaining contract term' for renewal and paymentChange, else 'Contract term'
 * (the label of the read-only field, the Contract terms tile and the print row). Key order: legend, startDate, firstPaymentDate, contractTerm, accruedHint.
 */
export interface FlowLabels { legend: string; startDate: string; firstPaymentDate: string; contractTerm: string; accruedHint: string | null }
export function flowLabels(flow: string, spec: FlowSpec): FlowLabels;
/** B24-R6: `termText` (required) is the Contract term text, the same string that is in the read-only field (`contractTermText(term)`).
 *  B32 (DEC-B32-TERM): the term row's label is flowLabels(raw.flow, ctx.spec).contractTerm. */
export function printInputRows(raw: RawForm, ctx: ViewContext, termText: string, moveNote?: string): [string, string][];
export function printInputNodes(rows: [string, string][]): ViewNode[];
export function printFeesNodes(rawFees: RawFee[], ctx: ViewContext): ViewNode[];
export function headlineFigures(result: CobCanadaResult): Figure[];
/** B31: the amounts group (printout right column); on screen Cost of borrowing amount is a 2-tuple (no hint; Q-B31-DUP-HINT). */
export function mainFigures(result: CobCanadaResult): Figure[];
/** B31: the rates-and-term group (printout left column under the APR; screen "More figures"). */
export function moreFigures(result: CobCanadaResult, ctx: ViewContext): Figure[];
/** B31-R3: left = [APR, ...moreFigures], right = the amounts group with the Cost of borrowing amount hint. */
export function printFigures(result: CobCanadaResult, ctx: ViewContext): FigureColumns;
export function figureNodes(list: Figure[]): ViewNode[];
export const COLUMNS: readonly (readonly [key: keyof CobScheduleRow, header: string, format: 'count' | 'date' | 'currency', group: string | null, printHeader: string])[];
export const CSV_COLUMNS: readonly (readonly [key: keyof CobScheduleRow, header: string])[];
/** B23-R3 / B28-R1 / B24-R5: shipped { financedOption: false, acceleratedFrequencies: false, contractDateField: false }, frozen. */
export const UI_SWITCHES: Readonly<UiSwitches>;
/** B23-R4: the three fee schedule columns hidden while financedOption is off. */
export const FEE_KEYS: readonly ['feesOpening', 'feesPaid', 'feesClosing'];
/** B28-R3: true when ctx.switches[name] is not true (an unknown name counts as off). */
export function switchedOut(ctx: ViewContext, name: string): boolean;
export const COMPACT_KEYS: readonly (keyof CobScheduleRow)[];
export function scheduleTableNodes(result: CobCanadaResult, target: TableTarget, columns: ColumnsMode, ctx: ViewContext): ViewNode[];
export function scheduleCsv(rows: readonly CobScheduleRow[], columns: ColumnsMode, ctx: ViewContext): string;
export function csvFileName(firstPaymentIso: string): string;
export function h(tag: string, attrs: [string, string][], children: (ViewNode | string)[]): ViewNode;
export function html(nodes: readonly (ViewNode | string)[]): string;

/** B24-R1 (calendar.ts): the derived Contract term; all three are non-negative integers. */
export interface ContractTermLike { years: number; months: number; days: number }
/**
 * B24-R6: the three texts, the unit singular only for 1, zero parts always shown:
 * { 2, 11, 17 } -> ['2 years', '11 months', '17 days']; { 1, 1, 1 } -> ['1 year', '1 month', '1 day']; { 0, 0, 20 } -> ['0 years', '0 months', '20 days'].
 */
export function contractTermParts(term: ContractTermLike): [years: string, months: string, days: string];
/** B24-R6: the parts joined with ', ' ('2 years, 11 months, 17 days'); the one text of the field, the tile and the print record. */
export function contractTermText(term: ContractTermLike): string;
/**
 * B24-R6: the hint under the field (interim wording, Q-MSG): `Calculated from the ${label} to the last scheduled payment date.`,
 * label = flowLabels(flow, spec).startDate lower-cased (B32, DEC-B32-TERM; was the first payment date label).
 */
export function contractTermHint(startDateLabel: string): string;

/**
 * B25-R6 (UI step, user decisions 2026-10-01): the note shown when a semi-monthly first payment date was moved.
 * `label` = the flow's firstPaymentDateLabel ('First payment date' or 'Next payment date'); `typedIso` = the typed
 * date (YYYY-MM-DD); `firstRowDate` = result.amortizationSchedule[0].date (UTC midnight), or undefined.
 * Returns '' when firstRowDate is undefined or isoDay(firstRowDate) === typedIso; otherwise
 * `<label without its trailing " date"> moved to <formatInputDate(firstRowDate)> (semi-monthly payments fall on the 15th and month-end)`,
 * e.g. 'First payment moved to Jan 15, 2027 (semi-monthly payments fall on the 15th and month-end)'.
 * No frequency argument (only a semi-monthly schedule can differ). Never throws.
 */
export function firstDateMoveNote(label: string, typedIso: string, firstRowDate: Date | undefined): string;
