import type { Holiday } from '../types';
import type { HolidaySpan } from '../utils/holidaySpans';

/**
 * One banner per run of consecutive days of the same holiday, laid over the
 * week's day columns. Uses the same gaps as the week row so it lines up.
 */
export default function HolidaySpanOverlay({
    spans,
    dayCount,
    onHolidayClick,
}: {
    spans: HolidaySpan[];
    dayCount: number;
    onHolidayClick?: (holiday: Holiday) => void;
}) {
    if (!spans.length) return null;
    return (
        <div
            className="pointer-events-none absolute inset-0 z-30 grid gap-x-px sm:gap-x-1"
            style={{ gridTemplateColumns: `repeat(${dayCount}, minmax(0, 1fr))` }}
        >
            {spans.map((span) => (
                <div
                    key={`${span.holiday.id}-${span.startIndex}`}
                    className={`relative row-start-1 overflow-hidden rounded-xl ${
                        onHolidayClick ? 'pointer-events-auto cursor-pointer' : ''
                    }`}
                    style={{ gridColumn: `${span.startIndex + 1} / ${span.endIndex + 2}` }}
                    onClick={() => onHolidayClick?.(span.holiday)}
                >
                    <div className="absolute inset-0 bg-yellow-50/90 dark:bg-yellow-900/40 backdrop-blur-[2px]" />
                    <div className="absolute inset-0 flex items-center justify-center p-1 sm:p-4 text-center">
                        <div className="bg-white/50 dark:bg-black/20 p-2 sm:p-5 rounded-xl sm:rounded-2xl shadow-sm ring-1 ring-black/5 dark:ring-white/5 backdrop-blur-md max-w-full">
                            <h3 className="text-sm sm:text-lg font-bold text-yellow-900 dark:text-yellow-100 leading-tight whitespace-normal break-words">
                                {span.holiday.longName}
                            </h3>
                            {span.holiday.name !== span.holiday.longName && (
                                <p className="mt-1 text-[10px] sm:text-sm font-medium text-yellow-800 dark:text-yellow-200">
                                    {span.holiday.name}
                                </p>
                            )}
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
}
