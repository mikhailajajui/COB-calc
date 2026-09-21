# cob-calculator

Cost of borrowing / segmented mortgage amortization calculator engine, in TypeScript.
No UI — this is a pure calculation library.

Modeled loosely on [calculator.net's mortgage calculator](https://www.calculator.net/mortgage-calculator.html)
for the baseline amortization math, extended to support a Canadian-style mortgage
lifecycle: **renewals**, mid-stream **payment changes**, and **variable rate changes**
— all modeled as a single mortgage made of an ordered list of **segments**.

## Install / build / test

```bash
npm install
npm run typecheck
npm test
npm run build
```

## Usage

### Simple fixed-rate loan (no renewal)

```ts
import { summarizeLoan } from 'cob-calculator';

const summary = summarizeLoan({
  loanAmount: 200000,
  annualInterestRatePercent: 6,
  termYears: 30,
  startDate: new Date('2024-01-01'),
});

console.log(summary.segmentSummaries[0].monthlyPayment); // fixed monthly payment
console.log(summary.totalInterestPaid);
console.log(summary.schedule.length); // 360
```

### Segmented mortgage (renewal, payment change, variable rate change)

```ts
import { summarizeMortgage } from 'cob-calculator';

const summary = summarizeMortgage({
  segments: [
    {
      // Original 5-year term, 25-year amortization
      startDate: new Date('2020-01-01'),
      annualInterestRatePercent: 5,
      amortizationMonthsRemaining: 300,
      termMonths: 60,
      startingBalance: 200000,
    },
    {
      // Renewed at a new rate for the remaining 20-year amortization
      startDate: new Date('2025-01-01'),
      annualInterestRatePercent: 4,
      amortizationMonthsRemaining: 240,
      // termMonths omitted: this segment runs to payoff
    },
  ],
  // Optional: correct specific rows to match a real bank statement.
  manualOverrides: [{ paymentNumber: 30, interestPortion: 812.34, principalPortion: 431.2 }],
});
```

A **payment change** or **variable rate change** is just another segment: same
mechanism as a renewal, started whenever it actually happened (it doesn't have to wait
for a term to finish), with a manually chosen `paymentAmount` and/or a new
`annualInterestRatePercent`.

## Out of scope for v1 / Roadmap

Not implemented yet, but the types (`MortgageInput`, `AmortizationEntry`,
`LoanSummary`) leave commented, additive extension points for:

- Recurring costs: property tax, home insurance, PMI (with 80% LTV auto-drop), HOA,
  other costs, and their annual percentage increases.
- Extra one-time/recurring principal payments.
- Lump-sum payments applied at a renewal.
- Cost breakdown (pie-chart-style P&I/tax/insurance/PMI/HOA split).
