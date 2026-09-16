import { validateBankStatementRow } from './validate.js';
import type { ManualPaymentOverride } from './types.js';

export interface BankStatementRow {
  paymentNumber: number;
  paymentAmount?: number;
  interestPortion?: number;
  principalPortion?: number;
  remainingBalance?: number;
  reason?: string;
}

function parseBankStatementRows(rows: BankStatementRow[]): ManualPaymentOverride[] {
  const seen = new Set<number>();
  return rows.map((row, index) => {
    validateBankStatementRow(row, index);
    if (seen.has(row.paymentNumber)) {
      throw new RangeError(
        `duplicate paymentNumber ${row.paymentNumber} within the same import (row ${index})`,
      );
    }
    seen.add(row.paymentNumber);

    return {
      paymentNumber: row.paymentNumber,
      paymentAmount: row.paymentAmount,
      interestPortion: row.interestPortion,
      principalPortion: row.principalPortion,
      remainingBalance: row.remainingBalance,
      reason: row.reason,
    };
  });
}

export function importOverridesFromJson(json: string): ManualPaymentOverride[] {
  const parsed = JSON.parse(json) as unknown;
  if (!Array.isArray(parsed)) {
    throw new RangeError('importOverridesFromJson expects a JSON array of bank statement rows');
  }
  return parseBankStatementRows(parsed as BankStatementRow[]);
}

/**
 * Intentionally naive CSV parser: header row + comma-split, no quoted-field or
 * embedded-comma support. No dependency is added for a fuller CSV parser — this is a
 * documented v1 limitation (see docs/spec.md), not an oversight.
 */
export function importOverridesFromCsv(csv: string): ManualPaymentOverride[] {
  const lines = csv
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) {
    throw new RangeError('importOverridesFromCsv received an empty CSV');
  }

  const headers = lines[0]!.split(',').map((h) => h.trim());
  const numericFields = new Set([
    'paymentNumber',
    'paymentAmount',
    'interestPortion',
    'principalPortion',
    'remainingBalance',
  ]);

  const rows: BankStatementRow[] = lines.slice(1).map((line) => {
    const cells = line.split(',').map((c) => c.trim());
    const row: Record<string, number | string | undefined> = {};
    headers.forEach((header, i) => {
      const cell = cells[i];
      if (cell === undefined || cell === '') {
        row[header] = undefined;
      } else if (numericFields.has(header)) {
        row[header] = Number(cell);
      } else {
        row[header] = cell;
      }
    });
    return row as unknown as BankStatementRow;
  });

  return parseBankStatementRows(rows);
}
