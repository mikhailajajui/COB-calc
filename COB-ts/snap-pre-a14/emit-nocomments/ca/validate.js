import { PAYMENTS_PER_YEAR, isFiniteNumber } from './types.js';
import { effectiveFirstPaymentDate, utcDateOnly } from './calendar.js';
import { totalCashFees, totalFinancedFees, validateFeeSchedule } from './fees.js';
import { FLOWS, FLOW_IDS, requiresSemiAnnualDate } from './flows.js';
import { allowedPaymentFrequencies } from './products.js';
const PRODUCT_TYPES = ['mortgage', 'personalLoan'];
const RATE_TYPES = ['variable', 'fixed'];
function isOneOf(allowed, x) {
    return typeof x === 'string' && allowed.includes(x);
}
function isValidDate(x) {
    return x instanceof Date && Number.isFinite(x.getTime());
}
function checkInput(input, report) {
    let loanOk = false;
    if (!isFiniteNumber(input.loanAmount)) {
        report({ field: 'loanAmount', message: `loanAmount must be a finite number, got ${String(input.loanAmount)}` });
    }
    else if (!(input.loanAmount > 0)) {
        report({ field: 'loanAmount', message: `loanAmount must be > 0, got ${input.loanAmount}` });
    }
    else {
        loanOk = true;
    }
    if (!isFiniteNumber(input.contractRatePercent)) {
        report({
            field: 'contractRatePercent',
            message: `contractRatePercent must be a finite number, got ${String(input.contractRatePercent)}`,
        });
    }
    else if (!(input.contractRatePercent > 0)) {
        report({ field: 'contractRatePercent', message: `contractRatePercent must be > 0, got ${input.contractRatePercent}` });
    }
    if (!isFiniteNumber(input.paymentAmount)) {
        report({ field: 'paymentAmount', message: `paymentAmount must be a finite number, got ${String(input.paymentAmount)}` });
    }
    else if (!(input.paymentAmount > 0)) {
        report({ field: 'paymentAmount', message: `paymentAmount must be > 0, got ${input.paymentAmount}` });
    }
    const freqOk = typeof input.paymentFrequency === 'string' && Object.hasOwn(PAYMENTS_PER_YEAR, input.paymentFrequency);
    if (!freqOk) {
        report({
            field: 'paymentFrequency',
            message: `paymentFrequency must be one of ${Object.keys(PAYMENTS_PER_YEAR).join('/')}, got ${String(input.paymentFrequency)}`,
        });
    }
    const flowOk = isOneOf(FLOW_IDS, input.flow);
    if (!flowOk) {
        report({ field: 'flow', message: `flow must be one of ${FLOW_IDS.join('/')}, got ${String(input.flow)}` });
    }
    const productOk = isOneOf(PRODUCT_TYPES, input.productType);
    if (!productOk) {
        report({
            field: 'productType',
            message: `productType must be one of ${PRODUCT_TYPES.join('/')}, got ${String(input.productType)}`,
        });
    }
    const rateOk = isOneOf(RATE_TYPES, input.rateType);
    if (!rateOk) {
        report({ field: 'rateType', message: `rateType must be one of ${RATE_TYPES.join('/')}, got ${String(input.rateType)}` });
    }
    const feesOk = validateFeeSchedule(input.fees, (message) => report({ field: 'fees', message }));
    if (feesOk && loanOk) {
        const groupedFees = totalFinancedFees(input.fees) + totalCashFees(input.fees);
        if (!(groupedFees < input.loanAmount)) {
            report({
                field: 'fees',
                message: `total fees (financed + non-financed) (${groupedFees}) must be less than loanAmount (${input.loanAmount})`,
            });
        }
    }
    if (flowOk && productOk && rateOk) {
        const flowSpec = FLOWS[input.flow];
        if ((flowSpec.forcedProductType !== null && input.productType !== flowSpec.forcedProductType) ||
            (flowSpec.forcedRateType !== null && input.rateType !== flowSpec.forcedRateType)) {
            const allowed = [
                flowSpec.forcedProductType,
                flowSpec.forcedRateType === null ? null : `${flowSpec.forcedRateType}-rate`,
            ]
                .filter((x) => x !== null)
                .join(' + ');
            report({
                field: 'flow',
                message: `flow '${input.flow}' is ${allowed} only, got productType='${input.productType}', rateType='${input.rateType}'`,
            });
        }
    }
    if (productOk && freqOk) {
        const allowedFrequencies = allowedPaymentFrequencies(input.productType);
        if (!allowedFrequencies.includes(input.paymentFrequency)) {
            report({
                field: 'paymentFrequency',
                message: `paymentFrequency '${input.paymentFrequency}' is not allowed for productType '${input.productType}' (allowed: ${allowedFrequencies.join('/')})`,
            });
        }
    }
    const firstOk = isValidDate(input.firstPaymentDate);
    if (!firstOk) {
        report({ field: 'firstPaymentDate', message: 'firstPaymentDate must be a valid Date' });
    }
    const endOk = isValidDate(input.endDate);
    if (!endOk) {
        report({ field: 'endDate', message: 'endDate must be a valid Date' });
    }
    const effFirst = firstOk && freqOk ? effectiveFirstPaymentDate(input.paymentFrequency, input.firstPaymentDate) : input.firstPaymentDate;
    const firstMoved = firstOk && utcDateOnly(effFirst) !== utcDateOnly(input.firstPaymentDate);
    if (firstOk && endOk && utcDateOnly(input.endDate) <= utcDateOnly(effFirst)) {
        const moved = firstMoved ? ` (moved to ${effFirst.toISOString().slice(0, 10)} for semi-monthly payments; compared as UTC calendar dates)` : ' (compared as UTC calendar dates)';
        report({ field: 'endDate', message: `endDate must be after firstPaymentDate${moved}` });
    }
    let startDate;
    if (flowOk) {
        const startField = FLOWS[input.flow].startDateField;
        const startValue = input[startField];
        if (startValue === undefined) {
            report({ field: startField, message: `flow '${input.flow}' requires ${startField}` });
        }
        else if (!isValidDate(startValue)) {
            report({ field: startField, message: `${startField} must be a valid Date` });
        }
        else if (firstOk && utcDateOnly(startValue) > utcDateOnly(effFirst)) {
            report({ field: startField, message: `${startField} must be on or before firstPaymentDate` });
        }
        else {
            startDate = startValue;
        }
    }
    if (flowOk && FLOWS[input.flow].accruedInterest === 'required' && input.accruedInterest === undefined) {
        report({
            field: 'accruedInterest',
            message: `flow '${input.flow}' requires accruedInterest (enter 0 if there is none)`,
        });
    }
    else if (input.accruedInterest !== undefined && !isFiniteNumber(input.accruedInterest)) {
        report({
            field: 'accruedInterest',
            message: `accruedInterest must be a finite number, got ${String(input.accruedInterest)}`,
        });
    }
    else if (input.accruedInterest !== undefined && !(input.accruedInterest >= 0)) {
        report({ field: 'accruedInterest', message: `accruedInterest must be >= 0, got ${input.accruedInterest}` });
    }
    if (requiresSemiAnnualDate(input.productType, input.rateType, true)) {
        if (input.semiAnnualCompoundingDate === undefined) {
            if (requiresSemiAnnualDate(input.productType, input.rateType)) {
                report({
                    field: 'semiAnnualCompoundingDate',
                    message: "productType 'mortgage' with rateType 'fixed' requires semiAnnualCompoundingDate " +
                        '(the semi-annual compounding reference anchor -- equation 1)',
                });
            }
        }
        else if (!isValidDate(input.semiAnnualCompoundingDate)) {
            report({ field: 'semiAnnualCompoundingDate', message: 'semiAnnualCompoundingDate must be a valid Date' });
        }
    }
    return startDate;
}
export function validateCobCanadaInput(input) {
    return {
        startDate: checkInput(input, (issue) => {
            throw new RangeError(issue.message);
        }),
    };
}
export function collectInputIssues(input) {
    const issues = [];
    checkInput(input, (issue) => {
        issues.push(issue);
    });
    return issues;
}
