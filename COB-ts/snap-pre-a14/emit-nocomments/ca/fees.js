import { isFiniteNumber } from './types.js';
function throwRangeError(message) {
    throw new RangeError(message);
}
export function validateFee(fee, index, report = throwRangeError) {
    if (typeof fee !== 'object' || fee === null) {
        report(`fees.fees[${index}] must be a fee object, got ${String(fee)}`);
        return false;
    }
    const label = fee.name || `fees.fees[${index}]`;
    if (!isFiniteNumber(fee.amount)) {
        report(`${label} amount must be a finite number, got ${String(fee.amount)}`);
        return false;
    }
    if (!(fee.amount >= 0)) {
        report(`${label} amount must be >= 0, got ${fee.amount}`);
        return false;
    }
    if (typeof fee.financed !== 'boolean') {
        report(`${label}.financed must be a boolean, got ${String(fee.financed)}`);
        return false;
    }
    const includedInCob = fee.includedInCob;
    if (includedInCob !== undefined && typeof includedInCob !== 'boolean') {
        report(`${label}.includedInCob must be a boolean if present, got ${String(includedInCob)}`);
        return false;
    }
    return true;
}
export function validateFeeSchedule(schedule, report = throwRangeError) {
    if (typeof schedule !== 'object' || schedule === null || !Array.isArray(schedule.fees)) {
        report('fees must be an object with a fees array');
        return false;
    }
    let ok = true;
    schedule.fees.forEach((fee, index) => {
        if (!validateFee(fee, index, report))
            ok = false;
    });
    return ok;
}
export function totalFinancedFees(schedule) {
    return schedule.fees.filter((fee) => fee.financed).reduce((sum, fee) => sum + fee.amount, 0);
}
export function totalCashFees(schedule) {
    return schedule.fees.filter((fee) => !fee.financed).reduce((sum, fee) => sum + fee.amount, 0);
}
