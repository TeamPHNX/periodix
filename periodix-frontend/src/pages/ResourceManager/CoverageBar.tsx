import { useState } from 'react';
import type { ClassCoverageStatus, ResourceIndexResponse } from '../../types';

const STATUS_LABEL: Record<ClassCoverageStatus, string> = {
    fresh: 'Up to date',
    stale: 'Outdated',
    missing: 'Not loaded yet',
    'no-account': 'No account in this class',
    failed: 'Failed',
};

const STATUS_DOT: Record<ClassCoverageStatus, string> = {
    fresh: 'bg-emerald-500',
    stale: 'bg-amber-400',
    missing: 'bg-slate-400',
    'no-account': 'bg-slate-300 dark:bg-slate-600',
    failed: 'bg-rose-500',
};

function relativeTime(iso: string | null): string {
    if (!iso) return 'never';
    const diffMin = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin} min ago`;
    const hours = Math.round(diffMin / 60);
    if (hours < 48) return `${hours} h ago`;
    return new Date(iso).toLocaleDateString();
}

type Props = {
    index: ResourceIndexResponse;
    refreshing: boolean;
    onRefresh: () => void;
};

export default function CoverageBar({ index, refreshing, onRefresh }: Props) {
    const [expanded, setExpanded] = useState(false);
    const { coverage, job } = index;
    const running = job?.state === 'running';
    const noAccount = coverage.classes.filter((c) => c.status === 'no-account').length;
    const failed = coverage.classes.filter((c) => c.status === 'failed').length;
    const progress =
        running && job && job.total > 0 ? Math.round((job.completed / job.total) * 100) : null;

    return (
        <div className="rounded-lg border border-slate-200 bg-white/70 text-sm dark:border-slate-700 dark:bg-slate-800/60">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                <button
                    type="button"
                    onClick={() => setExpanded((v) => !v)}
                    className="flex items-center gap-2 text-slate-700 hover:text-slate-900 dark:text-slate-200 dark:hover:text-white"
                    aria-expanded={expanded}
                >
                    <span
                        className={`inline-block h-2 w-2 rounded-full ${
                            coverage.withData === coverage.total && coverage.total > 0
                                ? 'bg-emerald-500'
                                : 'bg-amber-400'
                        }`}
                    />
                    <span className="font-medium tabular-nums">
                        {coverage.withData}/{coverage.total} classes
                    </span>
                    <svg
                        className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`}
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                    >
                        <path d="m6 9 6 6 6-6" />
                    </svg>
                </button>
                <span className="text-slate-500 dark:text-slate-400">
                    updated {relativeTime(index.lastUpdated)}
                </span>
                {noAccount > 0 && (
                    <span className="text-slate-500 dark:text-slate-400">
                        · {noAccount} without account
                    </span>
                )}
                {failed > 0 && (
                    <span className="text-rose-600 dark:text-rose-400">· {failed} failed</span>
                )}
                <div className="ml-auto flex items-center gap-2">
                    {running && (
                        <span className="text-xs text-sky-700 dark:text-sky-300">
                            {job?.phase === 'discovering'
                                ? 'Checking accounts…'
                                : `Loading ${job?.completed}/${job?.total}`}
                        </span>
                    )}
                    <button
                        type="button"
                        onClick={onRefresh}
                        disabled={running || refreshing}
                        className="flex items-center gap-1.5 rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
                        title="Fetch every class timetable of this week again"
                    >
                        <svg
                            className={`h-3.5 w-3.5 ${running || refreshing ? 'animate-spin' : ''}`}
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                        >
                            <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
                            <path d="M21 3v5h-5" />
                        </svg>
                        Refresh
                    </button>
                </div>
            </div>
            {progress !== null && (
                <div className="h-0.5 w-full bg-slate-100 dark:bg-slate-700">
                    <div
                        className="h-full bg-sky-500 transition-all"
                        style={{ width: `${progress}%` }}
                    />
                </div>
            )}
            {expanded && (
                <div className="border-t border-slate-200 px-3 py-2 dark:border-slate-700">
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4 lg:grid-cols-6">
                        {coverage.classes.map((c) => (
                            <div
                                key={c.id}
                                className="flex items-center gap-2 truncate"
                                title={`${c.longName}: ${STATUS_LABEL[c.status]}${
                                    c.lastUpdated ? ` (${relativeTime(c.lastUpdated)})` : ''
                                }${c.error ? ` – ${c.error}` : ''}`}
                            >
                                <span
                                    className={`inline-block h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[c.status]}`}
                                />
                                <span className="truncate text-slate-700 dark:text-slate-200">
                                    {c.name}
                                </span>
                            </div>
                        ))}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
                        {(Object.keys(STATUS_LABEL) as ClassCoverageStatus[]).map((s) => (
                            <span key={s} className="flex items-center gap-1.5">
                                <span className={`inline-block h-2 w-2 rounded-full ${STATUS_DOT[s]}`} />
                                {STATUS_LABEL[s]}
                            </span>
                        ))}
                    </div>
                    <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                        Teacher and room views only contain lessons of classes with data.
                        Classes without a Periodix account cannot be loaded.
                    </p>
                </div>
            )}
        </div>
    );
}
