export const PAYMENTS_PER_YEAR = {
    monthly: 12,
    semiMonthly: 24,
    biweekly: 26,
    weekly: 52,
    acceleratedBiweekly: 26,
    acceleratedWeekly: 52,
};
export function isFiniteNumber(x) {
    return typeof x === 'number' && Number.isFinite(x);
}
