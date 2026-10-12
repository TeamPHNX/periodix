import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type {
    AbsenceHistoryEntry,
    AbsencePreset,
    AbsenceRecord,
    AbsenceResponse,
    DateRange,
} from '../types';
import {
    ABSENCE_PRESET_LABELS,
    ABSENCE_PRESET_ORDER,
} from '../utils/absencePresets';
import { fmtHM, untisToMinutes, yyyymmddToISO } from '../utils/dates';

function formatUntisDate(value?: number) {
    if (!value || Number.isNaN(value)) return null;
    try {
        const iso = yyyymmddToISO(value);
        const date = new Date(`${iso}T00:00:00Z`);
        if (Number.isNaN(date.getTime())) return iso;
        return date.toLocaleDateString(undefined, {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            timeZone: 'UTC',
        });
    } catch {
        return null;
    }
}

function formatMillisTimestamp(value?: number | null) {
    if (typeof value !== 'number' || Number.isNaN(value)) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleString(undefined, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

const HISTORY_FIELD_LABELS: Record<string, string> = {
    startDate: 'Start date',
    endDate: 'End date',
    startTime: 'Start time',
    endTime: 'End time',
    reason: 'Reason',
    isExcused: 'Excused',
    excuseStatus: 'Status',
    text: 'Note',
};

function formatHistoryValue(
    field: string,
    value: string | number | boolean | null,
): string {
    if (value === null || value === undefined || value === '') return '—';
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (typeof value === 'number') {
        if (field === 'startDate' || field === 'endDate') {
            return formatUntisDate(value) ?? String(value);
        }
        if (field === 'startTime' || field === 'endTime') {
            return formatUntisTime(value) ?? String(value);
        }
    }
    return String(value);
}

function AbsenceHistory({ entries }: { entries: AbsenceHistoryEntry[] }) {
    return (
        <details className="mt-3 group">
            <summary className="cursor-pointer select-none text-xs font-medium text-indigo-600 dark:text-indigo-300">
                Edited {entries.length}{' '}
                {entries.length === 1 ? 'time' : 'times'}
            </summary>
            <ol className="mt-2 space-y-2 border-l border-slate-200 pl-3 dark:border-slate-700">
                {entries.map((entry, i) => (
                    <li key={`${entry.editedAt}-${i}`} className="text-xs">
                        <p className="text-slate-500 dark:text-slate-400">
                            {formatMillisTimestamp(
                                new Date(entry.editedAt).getTime(),
                            )}
                            {entry.editedBy ? ` · ${entry.editedBy}` : ''}
                        </p>
                        <ul className="mt-0.5 text-slate-700 dark:text-slate-200">
                            {entry.changes.map((c) => (
                                <li key={c.field}>
                                    {HISTORY_FIELD_LABELS[c.field] ?? c.field}:{' '}
                                    <span
                                        className={`opacity-70 ${
                                            c.from === null || c.from === ''
                                                ? ''
                                                : 'line-through'
                                        }`}
                                    >
                                        {formatHistoryValue(c.field, c.from)}
                                    </span>{' '}
                                    → {formatHistoryValue(c.field, c.to)}
                                </li>
                            ))}
                        </ul>
                    </li>
                ))}
            </ol>
        </details>
    );
}

function formatUntisTime(value?: number) {
    if (typeof value !== 'number' || Number.isNaN(value)) return null;
    return fmtHM(untisToMinutes(value));
}

function formatDateRange(range: DateRange, includeYear = false) {
    const opts: Intl.DateTimeFormatOptions = {
        day: 'numeric',
        month: 'short',
        ...(includeYear ? { year: 'numeric' } : {}),
        timeZone: 'UTC',
    };

    const format = (value?: string) => {
        if (!value) return null;
        const date = new Date(`${value}T00:00:00Z`);
        if (Number.isNaN(date.getTime())) return null;
        return date.toLocaleDateString(undefined, opts);
    };

    const start = format(range.start) ?? range.start ?? '—';
    const end = format(range.end) ?? range.end ?? '—';

    if (start === end) return start;
    return `${start} – ${end}`;
}

function formatAbsenceRange(absence: AbsenceRecord) {
    const startIso = yyyymmddToISO(absence.startDate);
    const endIso = yyyymmddToISO(absence.endDate);
    const startDate = new Date(`${startIso}T00:00:00Z`);
    const endDate = new Date(`${endIso}T00:00:00Z`);
    const sameDay = startIso === endIso;
    const startLabel = Number.isNaN(startDate.getTime())
        ? startIso
        : startDate.toLocaleDateString(undefined, {
              weekday: 'short',
              day: 'numeric',
              month: 'short',
              timeZone: 'UTC',
          });
    const endLabel = sameDay
        ? null
        : Number.isNaN(endDate.getTime())
        ? endIso
        : endDate.toLocaleDateString(undefined, {
              weekday: 'short',
              day: 'numeric',
              month: 'short',
              timeZone: 'UTC',
          });
    const startTime = formatUntisTime(absence.startTime);
    const endTime = formatUntisTime(absence.endTime);
    const timeLabel = startTime && endTime ? `${startTime} – ${endTime}` : null;

    return {
        startLabel,
        endLabel,
        sameDay,
        timeLabel,
    };
}

function getStatusChip(absence: AbsenceRecord) {
    const excused = Boolean(absence.isExcused || absence.excuse?.isExcused);
    const statusText =
        absence.excuseStatus || (excused ? 'Excused' : 'Pending');
    if (excused) {
        return {
            label: statusText,
            className:
                'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200',
        };
    }
    const pending = !absence.excuseStatus || /pending|open/i.test(statusText);
    if (pending) {
        return {
            label: statusText || 'Pending',
            className:
                'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200',
        };
    }
    return {
        label: statusText,
        className:
            'bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-200',
    };
}

interface AbsencePanelProps {
    isOpen: boolean;
    onClose: () => void;
    data: AbsenceResponse | null;
    loading: boolean;
    error: string | null;
    onRefresh: () => void;
    selectedPreset: AbsencePreset;
    onSelectPreset: (preset: AbsencePreset) => void;
    selectedRange: DateRange;
    presetRanges: Record<AbsencePreset, DateRange>;
}

export default function AbsencePanel({
    isOpen,
    onClose,
    data,
    loading,
    error,
    onRefresh,
    selectedPreset,
    onSelectPreset,
    selectedRange,
    presetRanges,
}: AbsencePanelProps) {
    const [shouldRender, setShouldRender] = useState(false);
    const [animating, setAnimating] = useState(false);
    const scrollAreaRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        let timeout: number | undefined;
        if (isOpen) {
            if (!shouldRender) setShouldRender(true);
            timeout = window.setTimeout(() => setAnimating(true), 10);
        } else if (shouldRender) {
            setAnimating(false);
            timeout = window.setTimeout(() => setShouldRender(false), 200);
        }
        return () => {
            if (timeout) clearTimeout(timeout);
        };
    }, [isOpen, shouldRender]);

    const sortedAbsences = useMemo(() => {
        if (!data?.absences) return [] as AbsenceRecord[];
        return [...data.absences].sort((a, b) => {
            if (a.startDate !== b.startDate) return b.startDate - a.startDate;
            return (b.startTime ?? 0) - (a.startTime ?? 0);
        });
    }, [data?.absences]);

    const isCached = Boolean(data?.cached);
    const isStale = Boolean(data?.stale);

    const selectedRangeLabel = useMemo(
        () => formatDateRange(selectedRange, true),
        [selectedRange]
    );

    if (!shouldRender) return null;

    return createPortal(
        <div className="fixed inset-0 z-50 overflow-hidden">
            <div
                className={`absolute inset-0 bg-black transition-opacity duration-200 ${
                    animating ? 'opacity-50' : 'opacity-0'
                }`}
                onClick={onClose}
            />
            <div
                className={`absolute right-0 top-0 h-full w-full max-w-2xl bg-white dark:bg-slate-950 shadow-2xl transform transition-transform duration-200 flex flex-col ${
                    animating ? 'translate-x-0' : 'translate-x-full'
                }`}
            >
                <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-800 relative z-30 bg-white dark:bg-slate-950">
                    <div>
                        <div className="flex items-center gap-2">
                            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                                Absences
                            </h2>
                            <span className="inline-flex items-center px-2 py-0.5 text-xs rounded-full bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200">
                                {sortedAbsences.length}
                            </span>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={onRefresh}
                            disabled={loading}
                            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 dark:border-slate-700 px-3 py-1.5 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50"
                        >
                            {loading && (
                                <svg
                                    className="h-4 w-4 animate-spin"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                >
                                    <circle
                                        cx="12"
                                        cy="12"
                                        r="9"
                                        className="opacity-25"
                                    />
                                    <path
                                        d="M21 12a9 9 0 0 0-9-9"
                                        className="opacity-75"
                                    />
                                </svg>
                            )}
                            <span>{loading ? 'Refreshing…' : 'Refresh'}</span>
                        </button>
                        <button
                            onClick={onClose}
                            className="rounded-full p-2 hover:bg-slate-100 dark:hover:bg-slate-800"
                            aria-label="Close"
                        >
                            <svg
                                className="w-5 h-5 text-slate-500"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                            >
                                <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M6 18L18 6M6 6l12 12"
                                />
                            </svg>
                        </button>
                    </div>
                </div>

                <div
                    ref={scrollAreaRef}
                    className="flex-1 overflow-y-auto absence-scroll relative"
                >
                    <div
                        className="bg-white dark:bg-slate-950 p-4 border-b border-slate-200 dark:border-slate-800"
                    >
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-3">
                            <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                Timeframe
                            </p>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                                Showing {selectedRangeLabel}
                            </p>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                            {ABSENCE_PRESET_ORDER.map((preset) => {
                                const label = ABSENCE_PRESET_LABELS[preset];
                                const range =
                                    presetRanges[preset] || selectedRange;
                                const preview = formatDateRange(range, true);
                                const isSelected = preset === selectedPreset;
                                return (
                                    <button
                                        key={preset}
                                        type="button"
                                        onClick={() => {
                                            if (preset !== selectedPreset) {
                                                onSelectPreset(preset);
                                            }
                                        }}
                                        className={`rounded-2xl border px-4 py-3 text-left transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:focus-visible:ring-indigo-300 ${
                                            isSelected
                                                ? 'border-indigo-500 bg-indigo-50 text-indigo-900 dark:border-indigo-400 dark:bg-indigo-900/30 dark:text-indigo-100'
                                                : 'border-slate-200 bg-white text-slate-900 hover:border-indigo-200 dark:border-slate-800 dark:bg-slate-900/50 dark:text-slate-100'
                                        }`}
                                    >
                                        <span className="block text-sm font-semibold">
                                            {label}
                                        </span>
                                        <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">
                                            {preview}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    <div className="p-4 space-y-4">
                        {error && (
                            <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-200">
                                {error}
                            </div>
                        )}

                        {isCached && isStale && (
                            <div className="rounded-lg border border-indigo-300 bg-indigo-50 px-3 py-2 text-sm text-indigo-800 dark:border-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-200">
                                Showing cached data because Untis is currently
                                unavailable.
                            </div>
                        )}

                        {loading && !sortedAbsences.length ? (
                            <div className="flex flex-col items-center justify-center h-48 text-slate-500">
                                <svg
                                    className="h-8 w-8 animate-spin"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                >
                                    <circle
                                        cx="12"
                                        cy="12"
                                        r="9"
                                        className="opacity-25"
                                    />
                                    <path
                                        d="M21 12a9 9 0 0 0-9-9"
                                        className="opacity-75"
                                    />
                                </svg>
                                <p className="mt-3 text-sm">
                                    Loading absences…
                                </p>
                            </div>
                        ) : sortedAbsences.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-48 text-center text-slate-500 dark:text-slate-400">
                                <div className="w-16 h-16 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-3">
                                    <svg
                                        className="w-8 h-8"
                                        fill="none"
                                        stroke="currentColor"
                                        viewBox="0 0 24 24"
                                    >
                                        <path
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            strokeWidth={1.5}
                                            d="M3 4h18M7 4v16m10-16v16M5 20h14"
                                        />
                                    </svg>
                                </div>
                                <p className="font-medium text-slate-600 dark:text-slate-300">
                                    No absences in this range
                                </p>
                                <p className="text-sm mt-1">
                                    Choose a different preset to search for
                                    older records.
                                </p>
                            </div>
                        ) : (
                            sortedAbsences.map((absence) => {
                                const rangeInfo = formatAbsenceRange(absence);
                                const status = getStatusChip(absence);
                                const created = formatMillisTimestamp(
                                    absence.createDate
                                );
                                const updated = formatMillisTimestamp(
                                    absence.lastUpdate
                                );
                                const excuseDate = absence.excuse?.excuseDate
                                    ? formatUntisDate(absence.excuse.excuseDate)
                                    : null;
                                return (
                                    <div
                                        key={`${absence.id}-${absence.startDate}-${absence.startTime}`}
                                        className="rounded-2xl border border-slate-200 bg-white/90 dark:border-slate-800 dark:bg-slate-900/60 shadow-sm p-4"
                                    >
                                        <div className="flex flex-wrap items-start justify-between gap-3">
                                            <div>
                                                <p className="text-sm text-slate-500 dark:text-slate-400">
                                                    {rangeInfo.startLabel}
                                                    {rangeInfo.endLabel && (
                                                        <>
                                                            {' '}
                                                            –{' '}
                                                            {rangeInfo.endLabel}
                                                        </>
                                                    )}
                                                </p>
                                                {rangeInfo.timeLabel && (
                                                    <p className="text-base font-semibold text-slate-900 dark:text-slate-100">
                                                        {rangeInfo.timeLabel}
                                                    </p>
                                                )}
                                                {!rangeInfo.timeLabel && (
                                                    <p className="text-base font-semibold text-slate-900 dark:text-slate-100">
                                                        Full day absence
                                                    </p>
                                                )}
                                            </div>
                                            <span
                                                className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${status.className}`}
                                            >
                                                {status.label}
                                            </span>
                                        </div>

                                        {absence.reason && (
                                            <p className="mt-3 text-sm text-slate-800 dark:text-slate-200 font-medium">
                                                Reason: {absence.reason}
                                            </p>
                                        )}
                                        {absence.text && (
                                            <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                                                {absence.text}
                                            </p>
                                        )}
                                        {absence.excuse?.text && (
                                            <div className="mt-3 rounded-lg bg-slate-50 dark:bg-slate-800/60 p-3 text-sm">
                                                <p className="text-slate-700 dark:text-slate-200 font-medium">
                                                    Excuse
                                                </p>
                                                <p className="text-slate-600 dark:text-slate-300">
                                                    {absence.excuse.text}
                                                </p>
                                                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                                                    {excuseDate
                                                        ? `Filed ${excuseDate}`
                                                        : 'Filed'}
                                                    {absence.excuse.username
                                                        ? ` · ${absence.excuse.username}`
                                                        : ''}
                                                </p>
                                            </div>
                                        )}

                                        {absence.history &&
                                            absence.history.length > 0 && (
                                                <AbsenceHistory
                                                    entries={absence.history}
                                                />
                                            )}

                                        <div className="mt-3 flex flex-wrap gap-4 text-xs text-slate-500 dark:text-slate-400">
                                            {created && (
                                                <span>Created {created}</span>
                                            )}
                                            {updated && (
                                                <span>Updated {updated}</span>
                                            )}
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
}
