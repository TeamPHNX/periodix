export function startOfDay(d: Date): Date {
    const nd = new Date(d);
    nd.setHours(0, 0, 0, 0);
    return nd;
}

export function endOfDay(d: Date): Date {
    const nd = new Date(d);
    nd.setHours(23, 59, 59, 999);
    return nd;
}

export function startOfISOWeek(date: Date): Date {
    const d = startOfDay(date);
    // ISO week starts Monday (1); JS Sunday = 0
    const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diff);
    return d;
}

export function endOfISOWeek(date: Date): Date {
    const start = startOfISOWeek(date);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return endOfDay(end);
}

export function normalizeRange(
    start?: string,
    end?: string,
): {
    normStart: Date | undefined;
    normEnd: Date | undefined;
} {
    if (!start || !end) return { normStart: undefined, normEnd: undefined };

    // Treat ranges spanning a full week the same by snapping to ISO week
    const sd = new Date(start);
    const ed = new Date(end);
    const spanMs = ed.getTime() - sd.getTime();

    // If the provided range length >= 5 days we assume week intentions and snap
    if (spanMs >= 5 * 24 * 60 * 60 * 1000) {
        return { normStart: startOfISOWeek(sd), normEnd: endOfISOWeek(sd) };
    }

    // Otherwise just normalize to day bounds
    return { normStart: startOfDay(sd), normEnd: endOfDay(ed) };
}
