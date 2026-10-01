const MS_PER_DAY = 24 * 60 * 60 * 1000;
export function isLeapYear(year) {
    return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}
export function utcDateOnly(date) {
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}
export function daysBetween(start, end) {
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        throw new RangeError('start/end must be valid Dates');
    }
    return Math.round((utcDateOnly(end) - utcDateOnly(start)) / MS_PER_DAY);
}
export function dayCountFraction(start, end) {
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        throw new RangeError('start/end must be valid Dates');
    }
    const endUtc = utcDateOnly(end);
    let cursor = utcDateOnly(start);
    if (cursor > endUtc) {
        throw new RangeError('start must be on or before end');
    }
    let fraction = 0;
    while (cursor < endUtc) {
        const year = new Date(cursor).getUTCFullYear();
        const nextYearStart = Date.UTC(year + 1, 0, 1);
        const segmentEnd = Math.min(nextYearStart, endUtc);
        const daysInSegment = Math.round((segmentEnd - cursor) / MS_PER_DAY);
        const daysInYear = isLeapYear(year) ? 366 : 365;
        fraction += daysInSegment / daysInYear;
        cursor = segmentEnd;
    }
    return fraction;
}
export function addUtcDays(date, days) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days));
}
export function daysInUtcMonth(year, monthIndex) {
    return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}
export function isLastDayOfMonth(date) {
    return date.getUTCDate() === daysInUtcMonth(date.getUTCFullYear(), date.getUTCMonth());
}
export function addMonthsClamped(date, months) {
    const year = date.getUTCFullYear();
    const monthIndex = date.getUTCMonth() + months;
    const lastDay = daysInUtcMonth(year, monthIndex);
    const day = isLastDayOfMonth(date) ? lastDay : Math.min(date.getUTCDate(), lastDay);
    return new Date(Date.UTC(year, monthIndex, day));
}
export function termBetween(from, to) {
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
        throw new RangeError('from/to must be valid Dates');
    }
    const start = new Date(utcDateOnly(from));
    const end = new Date(utcDateOnly(to));
    if (start.getTime() > end.getTime()) {
        throw new RangeError('from must be on or before to');
    }
    let totalMonths = (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + (end.getUTCMonth() - start.getUTCMonth());
    if (addMonthsClamped(start, totalMonths).getTime() > end.getTime()) {
        totalMonths -= 1;
    }
    const months = totalMonths % 12;
    const years = (totalMonths - months) / 12;
    const days = daysBetween(addMonthsClamped(start, totalMonths), end);
    return { years, months, days };
}
export function endOfUtcMonth(date) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
}
export function nextSemiMonthlyDate(firstPaymentDate, currentDate) {
    const first = new Date(utcDateOnly(firstPaymentDate));
    const current = new Date(utcDateOnly(currentDate));
    const firstDay = first.getUTCDate();
    const isEom = endOfUtcMonth(first).getTime() === first.getTime() || firstDay === 15;
    const day1 = firstDay >= 15 ? firstDay - 15 : firstDay;
    const currDay = current.getUTCDate();
    const currEom = endOfUtcMonth(current);
    if (current.getTime() === currEom.getTime() && isEom) {
        return new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, 15));
    }
    if (currDay === 15 && isEom) {
        return currEom;
    }
    if (currDay > 15) {
        return new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, day1));
    }
    const nextDate = addUtcDays(current, 15);
    return nextDate.getTime() > currEom.getTime() ? currEom : nextDate;
}
export function effectiveFirstPaymentDate(frequency, first) {
    if (frequency !== 'semiMonthly' || Number.isNaN(first.getTime())) {
        return first;
    }
    const year = first.getUTCFullYear();
    const monthIndex = first.getUTCMonth();
    const day = first.getUTCDate();
    const last = daysInUtcMonth(year, monthIndex);
    const movedDay = day === 15 || day === last ? day : day < 15 ? 15 : last;
    return new Date(Date.UTC(year, monthIndex, movedDay));
}
export function periodDateFor(frequency, firstPaymentDate, index, previousPaymentDate) {
    switch (frequency) {
        case 'monthly':
            return addMonthsClamped(firstPaymentDate, index);
        case 'weekly':
        case 'acceleratedWeekly':
            return addUtcDays(firstPaymentDate, index * 7);
        case 'biweekly':
        case 'acceleratedBiweekly':
            return addUtcDays(firstPaymentDate, index * 14);
        case 'semiMonthly':
            return index === 0 ? new Date(utcDateOnly(firstPaymentDate)) : nextSemiMonthlyDate(firstPaymentDate, previousPaymentDate);
    }
}
