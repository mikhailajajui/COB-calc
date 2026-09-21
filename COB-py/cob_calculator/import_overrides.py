from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Optional

from .types import ManualPaymentOverride
from .validate import validate_bank_statement_row


@dataclass
class BankStatementRow:
    payment_number: int
    payment_amount: Optional[float] = None
    interest_portion: Optional[float] = None
    principal_portion: Optional[float] = None
    remaining_balance: Optional[float] = None
    reason: Optional[str] = None


def _parse_bank_statement_rows(rows: list[BankStatementRow]) -> list[ManualPaymentOverride]:
    seen: set[int] = set()
    overrides = []
    for index, row in enumerate(rows):
        validate_bank_statement_row(row, index)
        if row.payment_number in seen:
            raise ValueError(
                f"duplicate paymentNumber {row.payment_number} within the same import (row {index})"
            )
        seen.add(row.payment_number)

        overrides.append(
            ManualPaymentOverride(
                payment_number=row.payment_number,
                payment_amount=row.payment_amount,
                interest_portion=row.interest_portion,
                principal_portion=row.principal_portion,
                remaining_balance=row.remaining_balance,
                reason=row.reason,
            )
        )
    return overrides


def import_overrides_from_json(json_text: str) -> list[ManualPaymentOverride]:
    parsed = json.loads(json_text)
    if not isinstance(parsed, list):
        raise ValueError("import_overrides_from_json expects a JSON array of bank statement rows")

    rows = [
        BankStatementRow(
            payment_number=entry.get("paymentNumber"),
            payment_amount=entry.get("paymentAmount"),
            interest_portion=entry.get("interestPortion"),
            principal_portion=entry.get("principalPortion"),
            remaining_balance=entry.get("remainingBalance"),
            reason=entry.get("reason"),
        )
        for entry in parsed
    ]
    return _parse_bank_statement_rows(rows)


_NUMERIC_FIELDS = {
    "paymentNumber",
    "paymentAmount",
    "interestPortion",
    "principalPortion",
    "remainingBalance",
}


def import_overrides_from_csv(csv_text: str) -> list[ManualPaymentOverride]:
    """Intentionally naive CSV parser: header row + comma-split, no quoted-field or
    embedded-comma support -- a documented v1 limitation, not an oversight."""
    lines = [line.strip() for line in csv_text.split("\n") if line.strip()]
    if not lines:
        raise ValueError("import_overrides_from_csv received an empty CSV")

    headers = [h.strip() for h in lines[0].split(",")]

    rows: list[BankStatementRow] = []
    for line in lines[1:]:
        cells = [c.strip() for c in line.split(",")]
        raw: dict[str, object] = {}
        for i, header in enumerate(headers):
            cell = cells[i] if i < len(cells) else None
            if cell is None or cell == "":
                raw[header] = None
            elif header in _NUMERIC_FIELDS:
                raw[header] = float(cell)
            else:
                raw[header] = cell

        rows.append(
            BankStatementRow(
                payment_number=raw.get("paymentNumber"),
                payment_amount=raw.get("paymentAmount"),
                interest_portion=raw.get("interestPortion"),
                principal_portion=raw.get("principalPortion"),
                remaining_balance=raw.get("remainingBalance"),
                reason=raw.get("reason"),
            )
        )

    return _parse_bank_statement_rows(rows)
