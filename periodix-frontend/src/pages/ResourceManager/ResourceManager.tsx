import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
    FreeRoomsResponse,
    Holiday,
    LessonColors,
    ResourceIndexResponse,
    ResourceType,
    TimetableResponse,
    User,
} from '../../types';
import {
    getFreeRooms,
    getResourceIndex,
    getResourceRefreshStatus,
    getResourceTimetable,
    refreshResources,
} from '../../api';
import Timetable from '../../components/Timetable';
import Spinner from '../../components/Spinner';
import { addDays, fmtLocal } from '../../utils/dates';
import ResourcePicker from './ResourcePicker';
import CoverageBar from './CoverageBar';
import FreeRoomsGrid from './FreeRoomsGrid';

type Tab = ResourceType | 'free';

const TABS: Array<{ id: Tab; label: string }> = [
    { id: 'teacher', label: 'Teachers' },
    { id: 'room', label: 'Rooms' },
    { id: 'free', label: 'Free rooms' },
];
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const STORAGE_KEY = 'periodix:resources';
const POLL_MS = 2500;
const MAX_RECENTS = 6;

type StoredPrefs = {
    tab: Tab;
    selected: Record<ResourceType, number | null>;
    recents: Record<ResourceType, number[]>;
};

const DEFAULT_PREFS: StoredPrefs = {
    tab: 'teacher',
    selected: { teacher: null, room: null },
    recents: { teacher: [], room: [] },
};

function loadPrefs(): StoredPrefs {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return DEFAULT_PREFS;
        const parsed = JSON.parse(raw);
        return {
            tab: TABS.some((t) => t.id === parsed?.tab) ? parsed.tab : 'teacher',
            selected: { ...DEFAULT_PREFS.selected, ...(parsed?.selected ?? {}) },
            recents: { ...DEFAULT_PREFS.recents, ...(parsed?.recents ?? {}) },
        };
    } catch {
        return DEFAULT_PREFS;
    }
}

function errorMessage(err: unknown): string {
    const raw = err instanceof Error ? err.message : String(err);
    try {
        return JSON.parse(raw)?.error || raw;
    } catch {
        return raw;
    }
}

interface ResourceManagerProps {
    token: string;
    user: User;
    weekStart: Date;
    holidays?: Holiday[];
    lessonColors?: LessonColors;
    defaultLessonColors?: LessonColors;
    onWeekNavigate?: (direction: 'prev' | 'next') => void;
}

export default function ResourceManager({
    token,
    user,
    weekStart,
    holidays,
    lessonColors,
    defaultLessonColors,
    onWeekNavigate,
}: ResourceManagerProps) {
    const allowed = !!(user.isUserManager || user.isAdmin);
    const weekKey = fmtLocal(weekStart);

    const [prefs, setPrefs] = useState<StoredPrefs>(loadPrefs);
    const [index, setIndex] = useState<ResourceIndexResponse | null>(null);
    const [indexError, setIndexError] = useState<string | null>(null);
    const [refreshing, setRefreshing] = useState(false);
    // Bumped after a refresh job finishes so open views refetch
    const [dataVersion, setDataVersion] = useState(0);

    const [timetable, setTimetable] = useState<TimetableResponse | null>(null);
    const [timetableError, setTimetableError] = useState<string | null>(null);

    const todayOffset = useMemo(() => {
        const diff = Math.floor(
            (new Date().setHours(0, 0, 0, 0) - new Date(weekStart).setHours(0, 0, 0, 0)) /
                86_400_000,
        );
        return diff >= 0 && diff <= 4 ? diff : 0;
    }, [weekStart]);
    const [freeDay, setFreeDay] = useState(todayOffset);
    const [freeRooms, setFreeRooms] = useState<FreeRoomsResponse | null>(null);
    const [freeRoomsError, setFreeRoomsError] = useState<string | null>(null);

    useEffect(() => setFreeDay(todayOffset), [todayOffset]);

    useEffect(() => {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
        } catch {
            /* storage unavailable: preferences just won't persist */
        }
    }, [prefs]);

    const tab = prefs.tab;
    const resourceType: ResourceType | null = tab === 'free' ? null : tab;
    const selectedId = resourceType ? prefs.selected[resourceType] : null;

    // --- Week index (lists + coverage); opening a stale week starts a refresh on the server
    const loadIndex = useCallback(async () => {
        try {
            const res = await getResourceIndex(token, weekKey);
            setIndex(res);
            setIndexError(null);
        } catch (err) {
            setIndexError(errorMessage(err));
        }
    }, [token, weekKey]);

    // Only clear the view when the week changes, not when the token is refreshed
    useEffect(() => {
        setIndex(null);
    }, [weekKey]);

    useEffect(() => {
        if (!allowed) return;
        void loadIndex();
    }, [allowed, loadIndex]);

    // --- Poll a running refresh job, then reload everything once it is done
    const jobRunning = index?.job?.state === 'running';
    const lastCompletedRef = useRef(0);
    useEffect(() => {
        if (!jobRunning) return;
        lastCompletedRef.current = 0;
        let cancelled = false;
        const timer = window.setInterval(async () => {
            try {
                const { job } = await getResourceRefreshStatus(token, weekKey);
                if (cancelled) return;
                if (!job || job.state === 'done') {
                    await loadIndex();
                    setDataVersion((v) => v + 1);
                    return;
                }
                setIndex((prev) => (prev ? { ...prev, job } : prev));
                // Show partial results every few classes so the page fills in progressively
                if (job.completed - lastCompletedRef.current >= 8) {
                    lastCompletedRef.current = job.completed;
                    await loadIndex();
                    setDataVersion((v) => v + 1);
                }
            } catch {
                /* transient; try again next tick */
            }
        }, POLL_MS);
        return () => {
            cancelled = true;
            window.clearInterval(timer);
        };
    }, [jobRunning, token, weekKey, loadIndex]);

    const handleRefresh = async () => {
        setRefreshing(true);
        try {
            const { job } = await refreshResources(token, weekKey);
            setIndex((prev) => (prev ? { ...prev, job } : prev));
        } catch (err) {
            setIndexError(errorMessage(err));
        } finally {
            setRefreshing(false);
        }
    };

    // --- Teacher / room timetable
    useEffect(() => {
        if (!allowed || !resourceType || selectedId === null) {
            setTimetable(null);
            return;
        }
        let cancelled = false;
        getResourceTimetable(token, resourceType, selectedId, weekKey)
            .then((res) => {
                if (cancelled) return;
                setTimetable(res);
                setTimetableError(null);
            })
            .catch((err) => {
                if (!cancelled) setTimetableError(errorMessage(err));
            });
        return () => {
            cancelled = true;
        };
    }, [allowed, token, resourceType, selectedId, weekKey, dataVersion]);

    // --- Free rooms for one day of the week
    const freeDate = fmtLocal(addDays(weekStart, freeDay));
    useEffect(() => {
        if (!allowed || tab !== 'free') return;
        let cancelled = false;
        getFreeRooms(token, freeDate)
            .then((res) => {
                if (cancelled) return;
                setFreeRooms(res);
                setFreeRoomsError(null);
            })
            .catch((err) => {
                if (!cancelled) setFreeRoomsError(errorMessage(err));
            });
        return () => {
            cancelled = true;
        };
    }, [allowed, token, tab, freeDate, dataVersion]);

    const setTab = (next: Tab) => setPrefs((p) => ({ ...p, tab: next }));

    const selectResource = (type: ResourceType, id: number) => {
        if (prefs.selected[type] !== id) setTimetable(null);
        setPrefs((p) => ({
            ...p,
            tab: type,
            selected: { ...p.selected, [type]: id },
            recents: {
                ...p.recents,
                [type]: [id, ...p.recents[type].filter((r) => r !== id)].slice(0, MAX_RECENTS),
            },
        }));
    };

    if (!allowed) {
        return (
            <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-rose-800 dark:border-rose-700 dark:bg-rose-900/40 dark:text-rose-200">
                Only user managers can open the resource overview.
            </div>
        );
    }

    const resources = resourceType && index ? index[resourceType === 'teacher' ? 'teachers' : 'rooms'] : [];
    const selectedSummary = resources.find((r) => r.id === selectedId);

    return (
        <div className="space-y-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                <div
                    role="tablist"
                    className="inline-flex shrink-0 self-start rounded-lg border border-slate-200 bg-slate-100 p-0.5 dark:border-slate-700 dark:bg-slate-800"
                >
                    {TABS.map((t) => (
                        <button
                            key={t.id}
                            role="tab"
                            aria-selected={tab === t.id}
                            type="button"
                            onClick={() => setTab(t.id)}
                            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                                tab === t.id
                                    ? 'bg-white text-sky-700 shadow-sm dark:bg-slate-700 dark:text-sky-300'
                                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
                            }`}
                        >
                            {t.label}
                        </button>
                    ))}
                </div>

                {resourceType && index && (
                    <ResourcePicker
                        key={resourceType}
                        type={resourceType}
                        resources={resources}
                        selectedId={selectedId}
                        recentIds={prefs.recents[resourceType]}
                        onSelect={(id) => selectResource(resourceType, id)}
                    />
                )}

                {tab === 'free' && (
                    <div className="inline-flex self-start rounded-lg border border-slate-200 p-0.5 dark:border-slate-700">
                        {WEEKDAYS.map((label, i) => (
                            <button
                                key={label}
                                type="button"
                                onClick={() => setFreeDay(i)}
                                className={`rounded-md px-2.5 py-1 text-sm ${
                                    freeDay === i
                                        ? 'bg-sky-600 text-white'
                                        : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700'
                                }`}
                            >
                                {label}
                                <span className="ml-1 text-xs opacity-70">
                                    {addDays(weekStart, i).getDate()}.
                                </span>
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {indexError && (
                <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-900/40 dark:text-amber-200">
                    {indexError}
                </div>
            )}

            {index ? (
                <CoverageBar index={index} refreshing={refreshing} onRefresh={handleRefresh} />
            ) : (
                !indexError && (
                    <div className="flex justify-center p-8">
                        <Spinner />
                    </div>
                )
            )}

            {index && resourceType && (
                <>
                    {selectedId === null ? (
                        <div className="rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 dark:border-slate-600 dark:text-slate-400">
                            {resources.length
                                ? `Pick a ${resourceType === 'teacher' ? 'teacher' : 'room'} to see their week.`
                                : jobRunning
                                  ? 'Loading class timetables for this week…'
                                  : 'No lessons known for this week yet.'}
                        </div>
                    ) : (
                        <>
                            {timetableError && (
                                <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-900/40 dark:text-amber-200">
                                    {timetableError}
                                </div>
                            )}
                            {selectedSummary && (
                                <div className="flex items-baseline gap-2 px-1">
                                    <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                                        {selectedSummary.longName}
                                    </h2>
                                    {selectedSummary.longName !== selectedSummary.name && (
                                        <span className="text-sm text-slate-500 dark:text-slate-400">
                                            {selectedSummary.name}
                                        </span>
                                    )}
                                    <span className="ml-auto text-xs text-slate-500 dark:text-slate-400">
                                        {selectedSummary.lessonCount} lessons this week
                                    </span>
                                </div>
                            )}
                            <Timetable
                                data={timetable}
                                holidays={holidays}
                                weekStart={weekStart}
                                lessonColors={lessonColors}
                                defaultLessonColors={defaultLessonColors}
                                token={token}
                                onWeekNavigate={onWeekNavigate}
                                isClassView
                                resourceView={resourceType}
                            />
                        </>
                    )}
                </>
            )}

            {index && tab === 'free' && (
                <>
                    {freeRoomsError && (
                        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-700 dark:bg-amber-900/40 dark:text-amber-200">
                            {freeRoomsError}
                        </div>
                    )}
                    {freeRooms ? (
                        <FreeRoomsGrid
                            data={freeRooms}
                            onOpenRoom={(id) => selectResource('room', id)}
                        />
                    ) : (
                        !freeRoomsError && (
                            <div className="flex justify-center p-8">
                                <Spinner />
                            </div>
                        )
                    )}
                </>
            )}
        </div>
    );
}
