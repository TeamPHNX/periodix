import type { Holiday } from '../types';

export type HolidaySpan = {
    startIndex: number; // first day index within the week (inclusive)
    endIndex: number; // last day index within the week (inclusive)
    holiday: Holiday;
};

function parseUntisDate(n: number): Date {
    const s = String(n);
    return new Date(Number(s.slice(0, 4)), Number(s.slice(4, 6)) - 1, Number(s.slice(6, 8)));
}

/**
 * The holiday covering `day`. Public holidays often sit inside school breaks
 * (e.g. Ostermontag within Osterferien); the longest one wins so a break is
 * not split around them.
 */
export function getHolidayForDate(holidays: Holiday[], day: Date): Holiday | undefined {
    const current = new Date(day);
    current.setHours(0, 0, 0, 0);
    let best: Holiday | undefined;
    let bestLength = -1;
    for (const h of holidays) {
        const start = parseUntisDate(h.startDate);
        const end = parseUntisDate(h.endDate);
        if (current < start || current > end) continue;
        const length = end.getTime() - start.getTime();
        if (length > bestLength) {
            best = h;
            bestLength = length;
        }
    }
    return best;
}

const sameHoliday = (a: Holiday, b: Holiday) =>
    a.id === b.id && a.startDate === b.startDate && a.endDate === b.endDate;

/**
 * Runs of at least two consecutive days in the week that belong to the same
 * holiday, so they can be shown as one banner instead of one per day.
 */
export function getHolidaySpans(weekDays: Date[], holidays: Holiday[]): HolidaySpan[] {
    if (!holidays.length) return [];
    const perDay = weekDays.map((d) => getHolidayForDate(holidays, d));
    const spans: HolidaySpan[] = [];
    let i = 0;
    while (i < perDay.length) {
        const holiday = perDay[i];
        if (!holiday) {
            i++;
            continue;
        }
        let end = i;
        while (end + 1 < perDay.length && perDay[end + 1] && sameHoliday(perDay[end + 1]!, holiday)) {
            end++;
        }
        if (end > i) spans.push({ startIndex: i, endIndex: end, holiday });
        i = end + 1;
    }
    return spans;
}

export function daysCoveredBySpans(spans: HolidaySpan[]): Set<number> {
    const covered = new Set<number>();
    for (const span of spans) {
        for (let i = span.startIndex; i <= span.endIndex; i++) covered.add(i);
    }
    return covered;
}
