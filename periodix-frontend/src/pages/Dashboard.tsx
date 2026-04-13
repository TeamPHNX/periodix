import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    lazy,
    Suspense,
} from 'react';
import Timetable from '../components/Timetable';
import MoonIcon from '../components/MoonIcon';
import NotificationBell from '../components/NotificationBell';
import FallbackNoticeModal from '../components/FallbackNoticeModal';

// Lazy load heavy components that aren't needed for initial render
const SettingsModal = lazy(() => import('../components/SettingsModal'));
const NotificationPanel = lazy(() => import('../components/NotificationPanel'));
const SduiPanel = lazy(() => import('../components/sdui/SduiPanel'));
const OnboardingModal = lazy(() => import('../components/OnboardingModal'));
const AbsencePanel = lazy(() => import('../components/AbsencePanel'));

import {
    API_BASE,
    getLessonColors,
    setLessonColor,
    removeLessonColor,
    getDefaultLessonColors,
    getNotifications,
    trackActivity,
    getNotificationSettings,
    getVapidPublicKey,
    subscribeToPushNotifications as apiSubscribeToPush,
    updateNotificationSettings,
    getUserPreferences,
    updateUserPreferences,
    getHolidays,
    getUserClasses,
    getClassTimetable,
    getAbsentLessons,
    type ClassInfo,
} from '../api';
import {
    isServiceWorkerSupported,
    isIOS,
    isStandalonePWA,
    subscribeToPushNotifications as utilsSubscribeToPush,
} from '../utils/notifications';
import {
    addDays,
    fmtLocal,
    startOfWeek,
    getISOWeekNumber,
} from '../utils/dates';
import { useTimetableCache } from '../hooks/useTimetableCache';
import type {
    TimetableResponse,
    User,
    LessonColors,
    LessonOffsets,
    Notification,
    TimetableFallbackReason,
    Holiday,
    AbsenceResponse,
    DateRange,
    AbsencePreset,
} from '../types';
import { getAbsencePresetRange } from '../utils/absencePresets';

type SearchResult = {
    type: 'user';
    id: string;
    username: string;
    displayName: string | null;
};

type FallbackNoticeState = {
    reason: TimetableFallbackReason | 'UNKNOWN';
    lastUpdated?: string | null;
    lastChecked?: string | null;
    errorCode?: string | number;
    errorMessage?: string;
};

const CLASS_TIMETABLE_CACHE_TTL_MS = 60 * 1000;

export default function Dashboard({
    token,
    user,
    onLogout,
    dark,
    setDark,
    onUserUpdate,
}: {
    token: string;
    user: User;
    onLogout: () => void;
    dark: boolean;
    setDark: (v: boolean) => void;
    onUserUpdate: (u: User) => void;
}) {
    // Selected date (week is derived from this)
    const [start, setStart] = useState<string>(() => {
        const now = new Date();
        const day = now.getDay();
        // If Saturday (6) or Sunday (0), show next week
        if (day === 6) return fmtLocal(addDays(now, 2));
        if (day === 0) return fmtLocal(addDays(now, 1));
        return fmtLocal(now);
    });
    const [mine, setMine] = useState<TimetableResponse | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [colorError, setColorError] = useState<string | null>(null);
    const [queryText, setQueryText] = useState('');
    const [results, setResults] = useState<SearchResult[]>([]);
    const [availableClasses, setAvailableClasses] = useState<ClassInfo[]>([]);
    const primaryClass = useMemo(
        () => availableClasses[0] ?? null,
        [availableClasses],
    );
    // Track loading & error state for search to avoid flicker on mobile
    const [searchLoading, setSearchLoading] = useState(false);
    const [searchError, setSearchError] = useState<string | null>(null);
    // Persist last successful results so they don't vanish while a new request is in-flight
    const lastResultsRef = useRef<SearchResult[]>([]);
    const [selectedUser, setSelectedUser] = useState<{
        id: string;
        username: string;
        displayName: string | null;
    } | null>(null);
    const [selectedClass, setSelectedClass] = useState<ClassInfo | null>(null);

    const isClassViewActive = !!(
        primaryClass && selectedClass?.id === primaryClass.id
    );
    const isHomeViewActive = !selectedClass && !selectedUser;
    const isSearchViewActive = !!selectedUser && selectedUser.id !== user.id;

    const abortRef = useRef<AbortController | null>(null);
    const searchBoxRef = useRef<HTMLDivElement | null>(null);
    const [mobileSearchOpen, setMobileSearchOpen] = useState(false); // full-screen popup on mobile
    const [isMenuOpen, setIsMenuOpen] = useState(false); // hamburger menu state
    const menuRef = useRef<HTMLDivElement | null>(null);

    // Auto-focus mobile search input when overlay opens
    useEffect(() => {
        if (mobileSearchOpen) {
            const t = setTimeout(() => {
                const el = document.getElementById(
                    'mobile-search-input',
                ) as HTMLInputElement | null;
                el?.focus();
            }, 30);
            return () => clearTimeout(t);
        }
    }, [mobileSearchOpen]);
    const [lessonColors, setLessonColors] = useState<LessonColors>({});
    const [defaultLessonColors, setDefaultLessonColors] =
        useState<LessonColors>({});
    const [lessonOffsets, setLessonOffsets] = useState<LessonOffsets>({});
    const [holidays, setHolidays] = useState<Holiday[]>([]);
    const [fallbackNotice, setFallbackNotice] =
        useState<FallbackNoticeState | null>(null);
    const [globalFallbackNotice, setGlobalFallbackNotice] =
        useState<FallbackNoticeState | null>(null);
    const fallbackDismissedRef = useRef<Set<string>>(new Set());
    const fallbackKeyRef = useRef<string | null>(null);
    const classTimetableCacheRef = useRef<
        Map<string, { data: TimetableResponse; timestamp: number }>
    >(new Map());
    const [isAbsencePanelOpen, setIsAbsencePanelOpen] = useState(false);
    const [absenceData, setAbsenceData] = useState<AbsenceResponse | null>(
        null,
    );
    const [absencesLoading, setAbsencesLoading] = useState(false);
    const [absencesError, setAbsencesError] = useState<string | null>(null);
    const [absencePreset, setAbsencePreset] =
        useState<AbsencePreset>('schoolYear');
    const [absenceRange, setAbsenceRange] = useState<DateRange>(() =>
        getAbsencePresetRange('schoolYear'),
    );

    // Initialize timetable cache hook
    const { getTimetableData, getCachedData } = useTimetableCache();

    const formatTimestamp = useCallback((iso?: string | null) => {
        if (!iso) return null;
        const date = new Date(iso);
        if (Number.isNaN(date.getTime())) return null;
        return date.toLocaleString(undefined, {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    }, []);

    // Compute the week range based on the selected date
    const weekStartDate = useMemo(() => startOfWeek(new Date(start)), [start]);
    const weekStartStr = useMemo(
        () => fmtLocal(weekStartDate),
        [weekStartDate],
    );
    const weekEndStr = useMemo(
        () => fmtLocal(addDays(weekStartDate, 6)),
        [weekStartDate],
    );

    // Function to get cached timetable data for adjacent weeks
    const getAdjacentWeekData = useCallback(
        (direction: 'prev' | 'next'): TimetableResponse | null => {
            const targetDate =
                direction === 'prev'
                    ? addDays(weekStartDate, -7)
                    : addDays(weekStartDate, 7);

            const targetWeekStartStr = fmtLocal(targetDate);
            const targetWeekEndStr = fmtLocal(addDays(targetDate, 6));

            if (selectedClass) {
                const cacheKey = `${selectedClass.id}:${targetWeekStartStr}:${targetWeekEndStr}`;
                const cached = classTimetableCacheRef.current.get(cacheKey);
                return cached ? cached.data : null;
            }

            const targetUserId = selectedUser?.id || user.id;

            // Get cached data for the target week
            return getCachedData(
                targetUserId,
                targetWeekStartStr,
                targetWeekEndStr,
            );
        },
        [
            weekStartDate,
            selectedUser?.id,
            user.id,
            getCachedData,
            selectedClass,
        ],
    );
    // Short auto-retry countdown for rate limit (429)
    const [retrySeconds, setRetrySeconds] = useState<number | null>(null);
    // Settings modal state
    const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);

    // Notification state
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [isNotificationPanelOpen, setIsNotificationPanelOpen] =
        useState(false);

    // SDUI status
    const [isSduiPanelOpen, setIsSduiPanelOpen] = useState(false);

    // Onboarding state
    const [isOnboardingOpen, setIsOnboardingOpen] = useState(false);
    const [isLessonModalOpen, setIsLessonModalOpen] = useState(false);

    const loadAbsences = useCallback(
        async (rangeOverride?: DateRange) => {
            const targetRange =
                rangeOverride ?? getAbsencePresetRange(absencePreset);
            setAbsenceRange(targetRange);
            setAbsencesLoading(true);
            setAbsencesError(null);
            try {
                const res = await getAbsentLessons(token, targetRange);
                setAbsenceData(res);
            } catch (err) {
                let msg =
                    err instanceof Error
                        ? err.message
                        : 'Failed to load absences';
                try {
                    const parsed = JSON.parse(msg);
                    if (parsed?.error) msg = parsed.error;
                } catch {
                    /* ignore parse errors */
                }
                setAbsencesError(msg);
            } finally {
                setAbsencesLoading(false);
            }
        },
        [token, absencePreset],
    );

    const handleAbsencePresetChange = useCallback(
        (preset: AbsencePreset) => {
            setAbsencePreset(preset);
            const range = getAbsencePresetRange(preset);
            loadAbsences(range);
        },
        [loadAbsences],
    );

    const presetReference = new Date();
    const presetRanges: Record<AbsencePreset, DateRange> = {
        thisMonth: getAbsencePresetRange('thisMonth', presetReference),
        schoolYear: getAbsencePresetRange('schoolYear', presetReference),
        allTime: getAbsencePresetRange('allTime', presetReference),
    };

    // (Analytics moved into Settings modal; no tab bar on dashboard anymore)

    // Derive a friendly info message for admin users when their own timetable isn't available
    const adminInfoMessage = useMemo(() => {
        if (!loadError || !user?.isAdmin) return null;
        // loadError may be raw text or a JSON string like {"error":"Target user not found"}
        let msg = loadError;
        try {
            const parsed = JSON.parse(loadError);
            if (parsed && typeof parsed === 'object' && parsed.error)
                msg = String(parsed.error);
        } catch {
            // ignore JSON parse errors; use loadError as-is
        }
        if (/target user not found/i.test(msg)) {
            return `Admins don't have a personal timetable. Use "Find student" above to search and view a user's timetable.`;
        }
        return null;
    }, [loadError, user?.isAdmin]);

    // Calculate the calendar week number
    const calendarWeek = useMemo(
        () => getISOWeekNumber(weekStartDate),
        [weekStartDate],
    );

    const fallbackBannerTimestamp = useMemo(
        () =>
            formatTimestamp(
                mine?.stale
                    ? mine?.lastUpdated
                    : globalFallbackNotice?.lastUpdated,
            ),
        [
            mine?.stale,
            mine?.lastUpdated,
            globalFallbackNotice?.lastUpdated,
            formatTimestamp,
        ],
    );

    const fallbackBannerCheckedTimestamp = useMemo(
        () => formatTimestamp(globalFallbackNotice?.lastChecked),
        [globalFallbackNotice?.lastChecked, formatTimestamp],
    );

    const fallbackBannerMessage = useMemo(() => {
        const isStale = !!(mine?.cached && mine?.stale);
        const notice = isStale
            ? { reason: mine?.fallbackReason }
            : globalFallbackNotice;

        if (!notice) return null;

        const reason = isStale
            ? mine?.fallbackReason
            : globalFallbackNotice?.reason;

        if (reason === 'BAD_CREDENTIALS') {
            return 'Untis reported invalid credentials. If you recently changed your Untis password, please update it in Settings.';
        }
        return 'Untis did not respond. Their servers might be offline or your Untis password may have changed. We will refresh automatically once Untis is reachable.';
    }, [mine, globalFallbackNotice]);

    const fallbackNoticeTimestamp = useMemo(
        () => formatTimestamp(fallbackNotice?.lastUpdated || null),
        [fallbackNotice?.lastUpdated, formatTimestamp],
    );

    const fallbackNoticeCheckedTimestamp = useMemo(
        () => formatTimestamp(fallbackNotice?.lastChecked || null),
        [fallbackNotice?.lastChecked, formatTimestamp],
    );

    const fallbackModalMessage = useMemo(() => {
        if (!fallbackNotice) return null;
        if (fallbackNotice.reason === 'BAD_CREDENTIALS') {
            return 'Untis rejected the stored credentials. If you recently changed your Untis password, update it in Settings → Timetable. We loaded the most recent cached timetable so you can keep working.';
        }
        return 'Untis did not respond. The official servers might be offline or your Untis password may have changed. We loaded the most recent cached timetable so you can keep working and will refresh automatically once Untis responds.';
    }, [fallbackNotice]);

    const loadMine = useCallback(
        async (forceRefresh: boolean = false) => {
            setLoadError(null);
            try {
                // Track timetable view
                trackActivity(token, 'timetable_view', {
                    userId: user.id,
                }).catch(console.error);

                const { data: res, fromCache } = await getTimetableData(
                    user.id,
                    user.id,
                    weekStartDate,
                    token,
                    true,
                    forceRefresh,
                );
                setMine(res);

                // Update global fallback notice if it's a fresh fetch
                if (!fromCache) {
                    if (res.stale) {
                        setGlobalFallbackNotice({
                            reason:
                                (res.fallbackReason as TimetableFallbackReason) ||
                                'UNKNOWN',
                            lastUpdated: res.lastUpdated,
                            lastChecked: new Date().toISOString(),
                            errorCode: res.errorCode,
                            errorMessage: res.errorMessage,
                        });
                    } else {
                        setGlobalFallbackNotice(null);
                        fallbackDismissedRef.current.clear();
                    }
                } else if (res.stale) {
                    // If from cache but we know it's stale (e.g. background fetch triggered it),
                    // we can still update the checked time if we have a global notice
                    setGlobalFallbackNotice((prev) =>
                        prev
                            ? { ...prev, lastChecked: new Date().toISOString() }
                            : null,
                    );
                }
            } catch (e) {
                const msg = e instanceof Error ? e.message : 'Failed to load';
                // Auto-retry if rate-limited; avoid replacing timetable with an empty one
                try {
                    const parsed = JSON.parse(msg);
                    if (parsed?.status === 429) {
                        const retryAfterSec = Math.max(
                            1,
                            Number(parsed?.retryAfter || 0) || 1,
                        );
                        setRetrySeconds(retryAfterSec);
                        setLoadError(null); // handled by retry banner below
                        const t = setTimeout(() => {
                            setRetrySeconds(null);
                            loadMine(forceRefresh);
                        }, retryAfterSec * 1000);
                        // Best-effort: clear timer if component unmounts or deps change
                        return () => clearTimeout(t);
                    }
                } catch {
                    // ignore JSON parse errors and non-structured messages
                }
                setLoadError(msg);
                // Non-429: fall back to an empty timetable to keep UI consistent
                setMine({
                    userId: user.id,
                    rangeStart: weekStartStr,
                    rangeEnd: weekEndStr,
                    payload: [],
                });
            } finally {
                /* no loading flag */
            }
        },
        [
            getTimetableData,
            user.id,
            weekStartDate,
            token,
            weekStartStr,
            weekEndStr,
        ],
    );

    const loadUser = useCallback(
        async (userId: string, forceRefresh: boolean = false) => {
            /* no loading flag */
            setLoadError(null);
            try {
                // Track timetable view for other users
                trackActivity(token, 'timetable_view', {
                    viewedUserId: userId,
                }).catch(console.error);

                const { data: res, fromCache } = await getTimetableData(
                    user.id,
                    userId,
                    weekStartDate,
                    token,
                    false,
                    forceRefresh,
                );
                setMine(res);

                // Update global fallback notice if it's a fresh fetch
                if (!fromCache) {
                    if (res.stale) {
                        setGlobalFallbackNotice({
                            reason:
                                (res.fallbackReason as TimetableFallbackReason) ||
                                'UNKNOWN',
                            lastUpdated: res.lastUpdated,
                            lastChecked: new Date().toISOString(),
                            errorCode: res.errorCode,
                            errorMessage: res.errorMessage,
                        });
                    } else {
                        setGlobalFallbackNotice(null);
                        fallbackDismissedRef.current.clear();
                    }
                } else if (res.stale) {
                    setGlobalFallbackNotice((prev) =>
                        prev
                            ? { ...prev, lastChecked: new Date().toISOString() }
                            : null,
                    );
                }
            } catch (e) {
                const msg = e instanceof Error ? e.message : 'Failed to load';
                // Auto-retry if rate-limited; avoid replacing timetable with an empty one
                try {
                    const parsed = JSON.parse(msg);
                    if (parsed?.status === 429) {
                        const retryAfterSec = Math.max(
                            1,
                            Number(parsed?.retryAfter || 0) || 1,
                        );
                        setRetrySeconds(retryAfterSec);
                        setLoadError(null);
                        const t = setTimeout(() => {
                            setRetrySeconds(null);
                            loadUser(userId, forceRefresh);
                        }, retryAfterSec * 1000);
                        return () => clearTimeout(t);
                    }
                } catch {
                    // ignore JSON parse errors and non-structured messages
                }
                setLoadError(msg);
                setMine({
                    userId,
                    rangeStart: weekStartStr,
                    rangeEnd: weekEndStr,
                    payload: [],
                });
            } finally {
                /* no loading flag */
            }
        },
        [
            getTimetableData,
            user.id,
            weekStartDate,
            token,
            weekStartStr,
            weekEndStr,
        ],
    );

    const loadClass = useCallback(
        async (classId: number, forceRefresh: boolean = false) => {
            setLoadError(null);
            const cacheKey = `${classId}:${weekStartStr}:${weekEndStr}`;

            // Prefetch adjacent weeks for smooth swiping
            const prefetchAdjacent = () => {
                const baseDate = new Date(weekStartStr);
                [-7, 7].forEach(async (offset) => {
                    const targetDate = addDays(baseDate, offset);
                    const s = fmtLocal(targetDate);
                    const e = fmtLocal(addDays(targetDate, 6));
                    const k = `${classId}:${s}:${e}`;

                    // Skip if already cached and fresh enough
                    const existing = classTimetableCacheRef.current.get(k);
                    if (
                        !forceRefresh &&
                        existing &&
                        Date.now() - existing.timestamp <
                            CLASS_TIMETABLE_CACHE_TTL_MS
                    )
                        return;

                    try {
                        const res = await getClassTimetable(
                            token,
                            classId,
                            s,
                            e,
                        );
                        classTimetableCacheRef.current.set(k, {
                            data: res,
                            timestamp: Date.now(),
                        });
                    } catch {
                        // Ignore prefetch errors
                    }
                });
            };

            const cached = classTimetableCacheRef.current.get(cacheKey);
            if (
                !forceRefresh &&
                cached &&
                Date.now() - cached.timestamp < CLASS_TIMETABLE_CACHE_TTL_MS
            ) {
                setMine(cached.data);
                prefetchAdjacent();
                return;
            }
            try {
                // Track class timetable view
                trackActivity(token, 'class_timetable_view', {
                    classId,
                }).catch(console.error);

                const res = await getClassTimetable(
                    token,
                    classId,
                    weekStartStr,
                    weekEndStr,
                );
                setMine(res);

                // Update global fallback notice
                if (res.stale) {
                    setGlobalFallbackNotice({
                        reason:
                            (res.fallbackReason as TimetableFallbackReason) ||
                            'UNKNOWN',
                        lastUpdated: res.lastUpdated,
                        lastChecked: new Date().toISOString(),
                        errorCode: res.errorCode,
                        errorMessage: res.errorMessage,
                    });
                } else {
                    setGlobalFallbackNotice(null);
                    fallbackDismissedRef.current.clear();
                }

                classTimetableCacheRef.current.set(cacheKey, {
                    data: res,
                    timestamp: Date.now(),
                });

                prefetchAdjacent();

                if (classTimetableCacheRef.current.size > 20) {
                    const oldestKey = Array.from(
                        classTimetableCacheRef.current.entries(),
                    ).sort((a, b) => a[1].timestamp - b[1].timestamp)[0]?.[0];
                    if (oldestKey)
                        classTimetableCacheRef.current.delete(oldestKey);
                }
            } catch (e) {
                const msg = e instanceof Error ? e.message : 'Failed to load';
                // Auto-retry if rate-limited
                try {
                    const parsed = JSON.parse(msg);
                    if (parsed?.status === 429) {
                        const retryAfterSec = Math.max(
                            1,
                            Number(parsed?.retryAfter || 0) || 1,
                        );
                        setRetrySeconds(retryAfterSec);
                        setLoadError(null);
                        const t = setTimeout(() => {
                            setRetrySeconds(null);
                            loadClass(classId, forceRefresh);
                        }, retryAfterSec * 1000);
                        return () => clearTimeout(t);
                    }
                } catch {
                    // ignore JSON parse errors
                }
                setLoadError(msg);
                setMine({
                    userId: user.id,
                    rangeStart: weekStartStr,
                    rangeEnd: weekEndStr,
                    payload: [],
                });
            }
        },
        [token, weekStartStr, weekEndStr, user.id],
    );

    useEffect(() => {
        if (selectedClass) {
            loadClass(selectedClass.id);
        } else if (selectedUser && selectedUser.id !== user.id) {
            loadUser(selectedUser.id);
        } else {
            loadMine();
        }
    }, [loadClass, loadUser, loadMine, selectedClass, selectedUser, user.id]);

    // Visibility and Online listeners to trigger natural refreshes
    useEffect(() => {
        const handleRefresh = () => {
            // Only refresh if the page is visible and we are online
            if (document.visibilityState === 'visible' && navigator.onLine) {
                if (selectedClass) {
                    loadClass(selectedClass.id);
                } else if (selectedUser && selectedUser.id !== user.id) {
                    loadUser(selectedUser.id);
                } else {
                    loadMine();
                }
            }
        };

        window.addEventListener('focus', handleRefresh);
        window.addEventListener('online', handleRefresh);
        document.addEventListener('visibilitychange', handleRefresh);

        return () => {
            window.removeEventListener('focus', handleRefresh);
            window.removeEventListener('online', handleRefresh);
            document.removeEventListener('visibilitychange', handleRefresh);
        };
    }, [loadMine, loadUser, loadClass, selectedClass, selectedUser, user.id]);

    useEffect(() => {
        if (!mine) {
            fallbackKeyRef.current = null;
            setFallbackNotice(null);
            return;
        }
        if (mine.cached && mine.stale) {
            const key = [mine.userId, mine.fallbackReason ?? 'UNKNOWN'].join(
                '|',
            );
            fallbackKeyRef.current = key;
            if (!fallbackDismissedRef.current.has(key)) {
                setFallbackNotice({
                    reason:
                        (mine.fallbackReason as
                            | TimetableFallbackReason
                            | undefined) ?? 'UNKNOWN',
                    lastUpdated: mine.lastUpdated,
                    lastChecked: globalFallbackNotice?.lastChecked,
                    errorCode: mine.errorCode,
                    errorMessage: mine.errorMessage,
                });
            }
        } else {
            fallbackKeyRef.current = null;
            setFallbackNotice(null);
        }
    }, [globalFallbackNotice?.lastChecked, mine]);

    // Load user's lesson colors
    useEffect(() => {
        const loadLessonColors = async () => {
            try {
                const { colors, offsets } = await getLessonColors(token);
                setLessonColors(colors);
                setLessonOffsets(offsets || {});
            } catch (error) {
                console.error('Failed to load lesson colors:', error);
                // Don't show error to user for colors, just use defaults
            }
        };
        const loadDefaults = async () => {
            try {
                const defaults = await getDefaultLessonColors(token);
                setDefaultLessonColors(defaults);
            } catch {
                // Ignore; fallback to hardcoded defaults in UI
            }
        };
        loadLessonColors();
        loadDefaults();
    }, [token]);

    useEffect(() => {
        let cancelled = false;
        const loadClassesOnce = async () => {
            try {
                const { classes } = await getUserClasses(token);
                if (!cancelled) setAvailableClasses(classes || []);
            } catch (error) {
                if (!cancelled)
                    console.error('Failed to load class list:', error);
            }
        };
        loadClassesOnce();
        return () => {
            cancelled = true;
        };
    }, [token]);

    const handleViewMyClass = useCallback(() => {
        if (!primaryClass) {
            setLoadError('No class is linked to your account yet.');
            return;
        }

        // Toggle off if already selected
        if (selectedClass?.id === primaryClass.id) {
            setSelectedClass(null);
            setQueryText('');
            setResults([]);
            setMobileSearchOpen(false);
            return;
        }

        setSelectedClass(primaryClass);
        setSelectedUser(null);
        setQueryText('');
        setResults([]);
        setMobileSearchOpen(false);
    }, [primaryClass, selectedClass]);

    // Load holidays
    useEffect(() => {
        getHolidays(token)
            .then((res) => setHolidays(res.data))
            .catch((err) => console.error('Failed to load holidays:', err));
    }, [token]);

    // Handle lesson color changes
    const handleColorChange = useCallback(
        async (lessonName: string, color: string | null, offset?: number) => {
            // Clear any previous color error when starting a new change
            setColorError(null);

            try {
                // Track color change activity
                trackActivity(token, 'color_change', {
                    lessonName,
                    color: color || 'removed',
                    viewingUserId: selectedUser?.id,
                }).catch(console.error);

                const viewingUserId = selectedUser?.id;
                if (color) {
                    await setLessonColor(
                        token,
                        lessonName,
                        color,
                        viewingUserId,
                        offset,
                    );
                    setLessonColors((prev) => ({
                        ...prev,
                        [lessonName]: color,
                    }));
                    // If admin, this sets a global default too; reflect immediately
                    if (user.isAdmin) {
                        setDefaultLessonColors((prev) => ({
                            ...prev,
                            [lessonName]: color,
                        }));
                        // Re-fetch to avoid any drift or silent failure
                        getDefaultLessonColors(token)
                            .then((d) => setDefaultLessonColors(d))
                            .catch(() => undefined);
                    }
                } else {
                    await removeLessonColor(token, lessonName, viewingUserId);
                    setLessonColors((prev) => {
                        const updated = { ...prev };
                        delete updated[lessonName];
                        return updated;
                    });
                    // If admin, removing resets the global default; update fallback immediately
                    if (user.isAdmin) {
                        setDefaultLessonColors((prev) => {
                            const updated = { ...prev };
                            delete updated[lessonName];
                            return updated;
                        });
                        // Also clear any local offset cache for that lesson so the UI doesn't show stale variation
                        try {
                            const k = 'adminLessonGradientOffsets';
                            const raw = localStorage.getItem(k);
                            if (raw) {
                                const obj = JSON.parse(raw);
                                if (obj && typeof obj === 'object') {
                                    delete obj[lessonName];
                                    localStorage.setItem(
                                        k,
                                        JSON.stringify(obj),
                                    );
                                }
                            }
                        } catch {
                            // ignore localStorage errors
                        }
                        // Re-fetch to confirm removal persisted (and not re-created elsewhere)
                        getDefaultLessonColors(token)
                            .then((d) => setDefaultLessonColors(d))
                            .catch(() => undefined);
                    }
                }

                // Force refresh current and adjacent pages to ensure absolute consistency across all cached views
                if (selectedClass) {
                    loadClass(selectedClass.id, true);
                } else if (selectedUser && selectedUser.id !== user.id) {
                    loadUser(selectedUser.id, true);
                } else {
                    loadMine(true);
                }
            } catch (error) {
                console.error('Failed to update lesson color:', error);

                // Parse error message for user-friendly display
                let userMessage =
                    'Failed to update lesson color. Please try again.';

                try {
                    const errorMessage =
                        error instanceof Error ? error.message : String(error);
                    const parsed = JSON.parse(errorMessage);

                    // Handle rate limiting errors specifically
                    if (parsed.status === 429) {
                        const errorText = parsed.error || errorMessage;
                        if (errorText.includes('Too many color requests')) {
                            userMessage =
                                'Too many color changes. Please wait a moment before trying again.';
                        } else if (
                            errorText.includes('Too many WebUntis requests')
                        ) {
                            userMessage =
                                'Rate limit reached. Please wait a few seconds before changing colors.';
                        } else {
                            userMessage =
                                'Too many requests. Please slow down and try again in a moment.';
                        }
                    } else if (parsed.error) {
                        userMessage = parsed.error;
                    }
                } catch {
                    // If error parsing fails, check for common rate limit messages in raw error
                    const errorText =
                        error instanceof Error ? error.message : String(error);
                    if (
                        errorText.includes('rate limit') ||
                        errorText.includes('too many')
                    ) {
                        userMessage =
                            'Rate limit reached. Please wait before changing colors again.';
                    }
                }

                // Show error to user
                setColorError(userMessage);

                // Auto-clear error after 5 seconds
                setTimeout(() => setColorError(null), 5000);
            }
        },
        [
            loadClass,
            loadMine,
            loadUser,
            selectedClass,
            selectedUser,
            token,
            user.id,
            user.isAdmin,
        ],
    );

    const handleDismissFallback = useCallback(() => {
        if (fallbackKeyRef.current) {
            fallbackDismissedRef.current.add(fallbackKeyRef.current);
        }
        setFallbackNotice(null);
    }, []);

    const handleOpenSettingsFromFallback = useCallback(() => {
        handleDismissFallback();
        setIsSettingsModalOpen(true);
    }, [handleDismissFallback]);

    // Load notifications
    const loadNotifications = useCallback(async () => {
        try {
            const response = await getNotifications(token);
            // Show browser notifications for newly arrived items if user enabled them
            setNotifications((prev) => {
                const prevIds = new Set(prev.map((n) => n.id));
                const next = response.notifications;
                try {
                    // Read user settings from local storage cache written by settings screen if present
                    const raw = localStorage.getItem(
                        'periodix:notificationSettings',
                    );
                    const settings = raw ? JSON.parse(raw) : null;
                    const perm = Notification?.permission;
                    const appVisible =
                        typeof document !== 'undefined' &&
                        document.visibilityState === 'visible';
                    if (
                        settings?.browserNotificationsEnabled &&
                        perm === 'granted' &&
                        Array.isArray(next) &&
                        // Avoid duplicates: don't show when app is visible (user just opened it)
                        !appVisible &&
                        // If push is enabled, rely on service worker push instead of poll-based toasts
                        !settings?.pushNotificationsEnabled
                    ) {
                        // Notify only for truly new, unread items
                        next.forEach((n) => {
                            if (!prevIds.has(n.id) && !n.read) {
                                try {
                                    new Notification(n.title, {
                                        body: n.message,
                                        icon: '/icon-192.png',
                                        badge: '/icon-192.png',
                                        tag: `periodix-${n.id}`,
                                        data: {
                                            ...(n.data || {}),
                                            notificationId: n.id,
                                        },
                                    });
                                } catch {
                                    // Ignore notification errors
                                }
                            }
                        });
                    }
                } catch {
                    // Ignore storage/permission parse issues
                }
                return next;
            });
        } catch (error) {
            console.error('Failed to load notifications:', error);
        }
    }, [token]);

    // Load notifications on component mount and periodically
    useEffect(() => {
        loadNotifications();

        // Reload notifications every 30 seconds
        const interval = setInterval(loadNotifications, 30000);
        return () => clearInterval(interval);
    }, [loadNotifications]);

    // Listen for push-triggered SW postMessage events to refresh immediately (no 30s delay / manual refresh)
    useEffect(() => {
        if (typeof navigator === 'undefined' || !('serviceWorker' in navigator))
            return;
        const handler = (event: MessageEvent) => {
            const data = event.data;
            if (!data || typeof data !== 'object') return;
            if (data.type === 'periodix:new-notification') {
                // Fetch latest notifications; cheaper than trying to reconstruct full object from push payload
                loadNotifications();
            }
        };
        navigator.serviceWorker.addEventListener('message', handler);
        return () => {
            navigator.serviceWorker.removeEventListener('message', handler);
        };
    }, [loadNotifications]);

    // Cache notification settings for browser notifications gating
    useEffect(() => {
        getNotificationSettings(token)
            .then((data) => {
                try {
                    localStorage.setItem(
                        'periodix:notificationSettings',
                        JSON.stringify(data.settings),
                    );
                } catch {
                    // ignore localStorage errors
                }
            })
            .catch(() => {
                // ignore errors
            });
    }, [token]);

    // Auto-setup push subscription if permission is already granted
    useEffect(() => {
        let cancelled = false;
        const run = async () => {
            try {
                if (!isServiceWorkerSupported()) return;
                if (Notification?.permission !== 'granted') return;
                // iOS requires installed PWA; other platforms OK in tab
                if (isIOS() && !isStandalonePWA()) return;

                const [{ settings }, { publicKey }] = await Promise.all([
                    getNotificationSettings(token),
                    getVapidPublicKey(),
                ]);
                if (cancelled) return;
                if (!publicKey) return;

                // If already enabled, still ensure backend knows latest subscription
                const sub = await utilsSubscribeToPush(publicKey);
                if (!sub) return;

                await apiSubscribeToPush(token, {
                    endpoint: sub.endpoint,
                    p256dh: btoa(
                        String.fromCharCode(
                            ...new Uint8Array(sub.getKey('p256dh')!),
                        ),
                    ),
                    auth: btoa(
                        String.fromCharCode(
                            ...new Uint8Array(sub.getKey('auth')!),
                        ),
                    ),
                    userAgent: navigator.userAgent,
                    deviceType: /mobi/i.test(navigator.userAgent)
                        ? 'mobile'
                        : /tablet|ipad|playbook|silk/i.test(navigator.userAgent)
                          ? 'tablet'
                          : 'desktop',
                });

                if (!settings.pushNotificationsEnabled) {
                    await updateNotificationSettings(token, {
                        pushNotificationsEnabled: true,
                        browserNotificationsEnabled:
                            settings.browserNotificationsEnabled ?? true,
                    }).catch(() => {});
                }
            } catch {
                // best-effort only
            }
        };
        run();
        return () => {
            cancelled = true;
        };
    }, [token]);

    // Preferences bootstrap: fetch server preferences to seed localStorage hiddenSubjects and onboarding
    useEffect(() => {
        let cancelled = false;
        let timer: ReturnType<typeof setTimeout> | null = null;
        getUserPreferences(token)
            .then((prefs) => {
                if (cancelled) return;
                // Seed hidden subjects into localStorage and notify timetable
                if (Array.isArray(prefs.hiddenSubjects)) {
                    try {
                        localStorage.setItem(
                            'periodix:hiddenSubjects:self',
                            JSON.stringify(prefs.hiddenSubjects),
                        );
                        // trigger re-filter if Timetable is mounted
                        window.dispatchEvent(
                            new Event('periodix:hiddenSubjects:changed'),
                        );
                    } catch {
                        // ignore storage errors
                    }
                }
                // Control onboarding: show only if not completed on server and not marked locally
                const localDone = localStorage.getItem(
                    'periodix-onboarding-completed',
                );
                if (!prefs.onboardingCompleted && !localDone) {
                    timer = setTimeout(() => {
                        setIsOnboardingOpen(true);
                    }, 1000);
                }
            })
            .catch(() => {
                // Fallback to local behavior on failure
                const hasSeenOnboarding = localStorage.getItem(
                    'periodix-onboarding-completed',
                );
                if (!hasSeenOnboarding) {
                    timer = setTimeout(() => {
                        setIsOnboardingOpen(true);
                    }, 1000);
                }
            });
        return () => {
            cancelled = true;
            if (timer) clearTimeout(timer);
        };
    }, [token]);

    useEffect(() => {
        const q = queryText.trim();
        if (!q) {
            // Clear everything when field emptied
            setResults([]);
            lastResultsRef.current = [];
            setSearchLoading(false);
            setSearchError(null);
            abortRef.current?.abort();
            return;
        }
        if (q.length < 2) {
            // Don't search with less than 2 characters - clear results and loading state
            setResults([]);
            lastResultsRef.current = [];
            setSearchLoading(false);
            setSearchError(null);
            abortRef.current?.abort();
            return;
        }
        let cancelled = false;
        setSearchLoading(true);
        setSearchError(null);
        const currentQuery = q;
        const h = setTimeout(async () => {
            abortRef.current?.abort();
            const ac = new AbortController();
            abortRef.current = ac;
            try {
                // Track search activity
                trackActivity(token, 'search', {
                    query: currentQuery,
                    mode: 'students',
                }).catch(console.error);

                const base = API_BASE
                    ? String(API_BASE).replace(/\/$/, '')
                    : '';

                // Fetch users (students only - search is restricted to user's class on backend)
                const usersResponse = await fetch(
                    `${base}/api/users/search?q=${encodeURIComponent(
                        currentQuery,
                    )}`,
                    {
                        headers: { Authorization: `Bearer ${token}` },
                        signal: ac.signal,
                    },
                );
                const usersData = usersResponse.ok
                    ? await usersResponse.json()
                    : { users: [] };

                if (cancelled) return;
                if (queryText.trim() !== currentQuery) return; // stale

                const users: SearchResult[] = (
                    Array.isArray(usersData.users) ? usersData.users : []
                ).map((u: unknown) => ({
                    ...(u as {
                        id: string;
                        username: string;
                        displayName?: string | null;
                    }),
                    type: 'user' as const,
                }));

                setResults(users);
                lastResultsRef.current = users;
            } catch (e: unknown) {
                if (
                    e &&
                    typeof e === 'object' &&
                    (e as { name?: string }).name === 'AbortError'
                )
                    return; // superseded
                if (!cancelled) {
                    setSearchError(
                        e instanceof Error ? e.message : 'Search failed',
                    );
                    // Retain previous successful results (no setResults) to avoid disappear
                }
            } finally {
                if (!cancelled) setSearchLoading(false);
            }
        }, 180); // slightly faster debounce for snappier feel
        return () => {
            cancelled = true;
            clearTimeout(h);
        };
    }, [queryText, token]);

    const handleOnboardingComplete = () => {
        try {
            localStorage.setItem('periodix-onboarding-completed', 'true');
        } catch {
            // ignore localStorage errors
        }
        // Persist to server (best effort)
        updateUserPreferences(token, { onboardingCompleted: true }).catch(
            () => undefined,
        );
        setIsOnboardingOpen(false);
    };

    // Development helper - expose function to reset onboarding
    useEffect(() => {
        if (typeof window !== 'undefined') {
            (
                window as Window &
                    typeof globalThis & { resetOnboarding?: () => void }
            ).resetOnboarding = () => {
                localStorage.removeItem('periodix-onboarding-completed');
                setIsOnboardingOpen(true);
                console.log('Onboarding reset - modal will show');
            };
        }
    }, []);

    // Close the search dropdown on outside click or Escape (desktop only)
    useEffect(() => {
        const handlePointer = (e: MouseEvent | TouchEvent) => {
            // Skip if mobile search is open to avoid interference
            if (mobileSearchOpen) return;

            const node = searchBoxRef.current;
            if (!node) return;
            if (!node.contains(e.target as Node)) {
                if (results.length) setResults([]);
            }
        };
        const handleKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                if (results.length) setResults([]);
                if (isMenuOpen) setIsMenuOpen(false);
            }
        };
        document.addEventListener('mousedown', handlePointer);
        document.addEventListener('touchstart', handlePointer);
        document.addEventListener('keydown', handleKey);
        return () => {
            document.removeEventListener('mousedown', handlePointer);
            document.removeEventListener('touchstart', handlePointer);
            document.removeEventListener('keydown', handleKey);
        };
    }, [results.length, mobileSearchOpen, isMenuOpen]);

    // Close hamburger menu on outside click
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent | TouchEvent) => {
            const node = menuRef.current;
            if (!node) return;
            if (!node.contains(e.target as Node)) {
                setIsMenuOpen(false);
            }
        };
        if (isMenuOpen) {
            document.addEventListener('mousedown', handleClickOutside);
            document.addEventListener('touchstart', handleClickOutside);
        }
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('touchstart', handleClickOutside);
        };
    }, [isMenuOpen]);

    const handleWeekNavigate = useCallback(
        (dir: 'prev' | 'next') => {
            const currentStart = new Date(start);
            const nextDate =
                dir === 'prev'
                    ? addDays(currentStart, -7)
                    : addDays(currentStart, 7);
            const nextStartStr = fmtLocal(nextDate);

            // Optimistic update: try to find cached data for the target week
            // and set it immediately so Timetable has data during the transition
            const targetWeekStart = startOfWeek(nextDate);
            const s = fmtLocal(targetWeekStart);
            const e = fmtLocal(addDays(targetWeekStart, 6));

            let cached: TimetableResponse | null = null;
            if (selectedClass) {
                const cacheKey = `${selectedClass.id}:${s}:${e}`;
                const entry = classTimetableCacheRef.current.get(cacheKey);
                if (entry) cached = entry.data;
            } else {
                const targetUserId = selectedUser?.id || user.id;
                cached = getCachedData(targetUserId, s, e);
            }

            if (cached) {
                setMine(cached);
            }

            setStart(nextStartStr);
        },
        [start, selectedClass, selectedUser, user.id, getCachedData],
    );

    useEffect(() => {
        if (isAbsencePanelOpen && !absenceData && !absencesLoading) {
            void loadAbsences(absenceRange);
        }
    }, [
        isAbsencePanelOpen,
        absenceData,
        absencesLoading,
        loadAbsences,
        absenceRange,
    ]);

    useEffect(() => {
        if (
            typeof window === 'undefined' ||
            !absenceData?.absences ||
            !absenceData.absences.length
        ) {
            return;
        }
        absenceData.absences.forEach((absence, idx) => {
            console.log('[Absence]', idx, {
                id: absence.id,
                startDate: absence.startDate,
                endDate: absence.endDate,
                startTime: absence.startTime,
                endTime: absence.endTime,
                createDate: absence.createDate,
                lastUpdate: absence.lastUpdate,
            });
        });
    }, [absenceData]);

    return (
        <div className={'min-h-screen'}>
            <header className="header-blur sticky top-0 z-50">
                <div className="mx-auto flex items-center justify-between p-4">
                    <div className="logo-text text-xl sm:text-2xl">
                        Periodix
                    </div>
                    <div className="flex items-center">
                        <div className="hidden sm:block text-sm text-slate-600 dark:text-slate-300 mr-4">
                            {user.displayName || user.username}
                        </div>
                        <button
                            onClick={() => setIsSduiPanelOpen(true)}
                            className="flex items-center justify-center p-2 mr-2 rounded-full hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors text-slate-600 dark:text-slate-300"
                            title="SDUI Chats"
                        >
                            <svg
                                className="w-5 h-5"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth={2}
                                viewBox="0 0 24 24"
                            >
                                <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                                />
                            </svg>
                        </button>
                        <NotificationBell
                            notifications={notifications}
                            onClick={() =>
                                setIsNotificationPanelOpen(
                                    !isNotificationPanelOpen,
                                )
                            }
                            className="mr-1"
                            isOpen={isNotificationPanelOpen}
                        />
                        {/* Hamburger menu */}
                        <div className="relative z-100" ref={menuRef}>
                            <button
                                className={`rounded-full p-2 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors ${
                                    isMenuOpen
                                        ? 'bg-slate-200 dark:bg-slate-700'
                                        : ''
                                }`}
                                title="Menu"
                                onClick={() => setIsMenuOpen(!isMenuOpen)}
                                aria-label="Open menu"
                                aria-expanded={isMenuOpen}
                            >
                                <svg
                                    className="h-5 w-5 text-slate-600 dark:text-slate-300 transition-transform duration-200"
                                    style={{
                                        transform: isMenuOpen
                                            ? 'rotate(90deg)'
                                            : 'rotate(0deg)',
                                    }}
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                >
                                    <line x1="3" y1="6" x2="21" y2="6" />
                                    <line x1="3" y1="12" x2="21" y2="12" />
                                    <line x1="3" y1="18" x2="21" y2="18" />
                                </svg>
                            </button>
                            {/* Dropdown menu */}
                            <div
                                className={`absolute right-0 mt-2 w-48 rounded-xl border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-800 overflow-hidden transition-all duration-200 ease-out origin-top-right z-50 ${
                                    isMenuOpen
                                        ? 'opacity-100 scale-100 translate-y-0'
                                        : 'opacity-0 scale-95 -translate-y-2 pointer-events-none'
                                }`}
                            >
                                <div className="py-1">
                                    {/* Settings */}
                                    <button
                                        className="w-full flex items-center gap-3 px-4 py-3 text-left text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                                        onClick={() => {
                                            setIsMenuOpen(false);
                                            setIsSettingsModalOpen(true);
                                            trackActivity(
                                                token,
                                                'settings',
                                            ).catch(console.error);
                                        }}
                                    >
                                        <svg
                                            width="18"
                                            height="18"
                                            viewBox="0 0 24 24"
                                            fill="none"
                                            className="text-slate-500 dark:text-slate-400"
                                        >
                                            <path
                                                d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"
                                                stroke="currentColor"
                                                strokeWidth="2"
                                                strokeLinecap="round"
                                                strokeLinejoin="round"
                                            />
                                            <circle
                                                cx="12"
                                                cy="12"
                                                r="3"
                                                stroke="currentColor"
                                                strokeWidth="2"
                                            />
                                        </svg>
                                        Settings
                                    </button>
                                    {/* Absences */}
                                    <button
                                        className="w-full flex items-center gap-3 px-4 py-3 text-left text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                                        onClick={() => {
                                            setIsMenuOpen(false);
                                            setIsAbsencePanelOpen(
                                                !isAbsencePanelOpen,
                                            );
                                        }}
                                    >
                                        <svg
                                            width="18"
                                            height="18"
                                            viewBox="0 0 24 24"
                                            fill="none"
                                            stroke="currentColor"
                                            strokeWidth="1.8"
                                            className="text-slate-500 dark:text-slate-400"
                                        >
                                            <rect
                                                x="3"
                                                y="4"
                                                width="18"
                                                height="16"
                                                rx="2"
                                            />
                                            <path d="M3 9h18" />
                                            <path d="M8 2v4" />
                                            <path d="M16 2v4" />
                                            <path d="M8 14h8" />
                                        </svg>
                                        Absences
                                    </button>
                                    {/* Dark mode toggle */}
                                    <button
                                        className="w-full flex items-center gap-3 px-4 py-3 text-left text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                                        onClick={() => {
                                            setDark(!dark);
                                            setIsMenuOpen(false);
                                        }}
                                    >
                                        {dark ? (
                                            <svg
                                                xmlns="http://www.w3.org/2000/svg"
                                                viewBox="0 0 24 24"
                                                fill="currentColor"
                                                className="h-[18px] w-[18px] text-amber-500"
                                            >
                                                <path d="M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12Z" />
                                                <path
                                                    fillRule="evenodd"
                                                    d="M12 2.25a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-1.5 0V3a.75.75 0 0 1 .75-.75Zm0 16.5a.75.75 0 0 1 .75.75v1.5a.75.75 0 0 1-1.5 0V19.5a.75.75 0 0 1 .75-.75Zm9-6a.75.75 0 0 1-.75.75h-1.5a.75.75 0 0 1 0-1.5H20.25a.75.75 0 0 1 .75.75Zm-16.5 0a.75.75 0 0 1-.75.75H2.25a.75.75 0 0 1 0-1.5H3.75a.75.75 0 0 1 .75.75ZM18.53 5.47a.75.75 0 0 1 0 1.06l-1.06 1.06a.75.75 0 0 1-1.061-1.06l1.06-1.06a.75.75 0 0 1 1.06 0ZM7.59 16.41a.75.75 0 0 1 0 1.061L6.53 18.53a.75.75 0 1 1-1.06-1.061l1.06-1.06a.75.75 0 0 1 1.06 0ZM18.53 18.53a.75.75 0 0 1-1.06 0l-1.06-1.06a.75.75 0 0 1 1.06-1.061l1.06 1.06c.293.293.293.768 0 1.061ZM7.59 7.59A.75.75 0 0 1 6.53 6.53L5.47 5.47a.75.75 0 1 1 1.06-1.06l1.06 1.06c.293.293.293.768 0 1.061Z"
                                                    clipRule="evenodd"
                                                />
                                            </svg>
                                        ) : (
                                            <MoonIcon className="h-[18px] w-[18px] text-indigo-500" />
                                        )}
                                        {dark ? 'Light mode' : 'Dark mode'}
                                    </button>
                                    {/* Divider */}
                                    <div className="my-1 border-t border-slate-200 dark:border-slate-700" />
                                    {/* Logout */}
                                    <button
                                        className="w-full flex items-center gap-3 px-4 py-3 text-left text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                                        onClick={() => {
                                            setIsMenuOpen(false);
                                            onLogout();
                                        }}
                                    >
                                        <svg
                                            xmlns="http://www.w3.org/2000/svg"
                                            viewBox="0 0 24 24"
                                            fill="none"
                                            stroke="currentColor"
                                            strokeWidth="2"
                                            className="h-[18px] w-[18px]"
                                        >
                                            <path
                                                strokeLinecap="round"
                                                strokeLinejoin="round"
                                                d="M15 3h3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-3"
                                            />
                                            <path
                                                strokeLinecap="round"
                                                strokeLinejoin="round"
                                                d="M10 17l5-5-5-5M15 12H3"
                                            />
                                        </svg>
                                        Log out
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </header>

            <main className="mx-auto p-1 sm:p-4">
                <section className="card p-1 sm:p-4 max-sm:rounded-none max-sm:border-x-0">
                    <div className="space-y-2 sm:space-y-4">
                        {/* Week navigation buttons (desktop only) - separate row */}
                        <div className="hidden sm:flex mr-auto">
                            <div className="flex gap-2">
                                <button
                                    className="btn-secondary px-8 py-3 text-base font-medium"
                                    onClick={() => {
                                        const prevWeek = fmtLocal(
                                            addDays(new Date(start), -7),
                                        );
                                        setStart(prevWeek);
                                    }}
                                    title="Previous week"
                                >
                                    ‹ Prev
                                </button>
                                <button
                                    className="btn-secondary px-8 py-3 text-base font-medium"
                                    onClick={() => {
                                        setStart(fmtLocal(new Date()));
                                    }}
                                    title="Current week"
                                >
                                    This Week
                                </button>
                                <button
                                    className="btn-secondary px-8 py-3 text-base font-medium"
                                    onClick={() => {
                                        const nextWeek = fmtLocal(
                                            addDays(new Date(start), 7),
                                        );
                                        setStart(nextWeek);
                                    }}
                                    title="Next week"
                                >
                                    Next ›
                                </button>
                            </div>
                        </div>

                        {/* Search (desktop), mobile icons (search+home), week picker */}
                        <div className="flex flex-wrap items-end gap-3">
                            {/* Desktop search */}
                            <div
                                className="hidden sm:flex items-end gap-3 max-w-xs"
                                ref={searchBoxRef}
                            >
                                <div className="flex-1">
                                    <div className="relative">
                                        <svg
                                            className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none z-10"
                                            viewBox="0 0 24 24"
                                            fill="none"
                                            stroke="currentColor"
                                            strokeWidth="2"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                        >
                                            <circle cx="11" cy="11" r="8" />
                                            <path d="m21 21-4.35-4.35" />
                                        </svg>
                                        <input
                                            className="input text-sm pr-8"
                                            style={{ paddingLeft: '2.5rem' }}
                                            placeholder="Search students..."
                                            value={queryText}
                                            onChange={(e) =>
                                                setQueryText(e.target.value)
                                            }
                                        />
                                        {searchLoading &&
                                            queryText.trim().length >= 2 && (
                                                <div
                                                    className="absolute right-7 top-1/2 -translate-y-1/2 animate-spin text-slate-400"
                                                    aria-label="Loading"
                                                    role="status"
                                                >
                                                    <svg
                                                        viewBox="0 0 24 24"
                                                        className="h-4 w-4"
                                                        fill="none"
                                                        stroke="currentColor"
                                                        strokeWidth="2"
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
                                                </div>
                                            )}
                                        {queryText && (
                                            <button
                                                type="button"
                                                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                                                aria-label="Clear search"
                                                onClick={() => setQueryText('')}
                                            >
                                                ×
                                            </button>
                                        )}
                                        {results.length > 0 && (
                                            <div className="absolute z-40 mt-1 w-full rounded-md border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-800">
                                                <ul className="max-h-60 overflow-auto py-1 text-sm">
                                                    {results.map((r) => (
                                                        <li
                                                            key={`${r.type}-${r.id}`}
                                                        >
                                                            <button
                                                                className="w-full px-3 py-2 text-left hover:bg-slate-100 dark:hover:bg-slate-700"
                                                                onClick={() => {
                                                                    setSelectedUser(
                                                                        r,
                                                                    );
                                                                    setSelectedClass(
                                                                        null,
                                                                    );
                                                                    setQueryText(
                                                                        r.displayName ||
                                                                            r.username,
                                                                    );
                                                                    setResults(
                                                                        [],
                                                                    );
                                                                    if (
                                                                        r.id !==
                                                                        user.id
                                                                    )
                                                                        loadUser(
                                                                            r.id,
                                                                        );
                                                                    else
                                                                        loadMine();
                                                                }}
                                                            >
                                                                <div className="font-medium">
                                                                    {r.displayName ||
                                                                        r.username}
                                                                </div>
                                                                <div className="text-xs text-slate-500">
                                                                    {r.displayName
                                                                        ? r.username
                                                                        : 'Student'}
                                                                </div>
                                                            </button>
                                                        </li>
                                                    ))}
                                                </ul>
                                            </div>
                                        )}
                                        {searchError &&
                                            queryText.trim().length >= 2 && (
                                                <div className="absolute z-40 mt-1 w-full rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-600 dark:bg-amber-900/40 dark:text-amber-200">
                                                    {searchError}
                                                </div>
                                            )}
                                        {queryText.trim().length === 1 && (
                                            <div className="absolute z-40 mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-[11px] text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
                                                Type at least 2 characters…
                                            </div>
                                        )}
                                    </div>
                                </div>
                                <div className="hidden sm:flex pb-[2px]">
                                    <button
                                        type="button"
                                        className={`rounded-full p-2 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-60 transition-all ${
                                            isClassViewActive
                                                ? 'bg-slate-200 dark:bg-slate-700 text-sky-600 dark:text-sky-400 shadow-[0_0_10px_rgba(14,165,233,0.5)] dark:shadow-[0_0_10px_rgba(56,189,248,0.4)]'
                                                : 'text-slate-600 dark:text-slate-300'
                                        }`}
                                        onClick={handleViewMyClass}
                                        disabled={!primaryClass}
                                        title="Class timetable"
                                        aria-label="View my class timetable"
                                    >
                                        <svg
                                            width="20"
                                            height="20"
                                            viewBox="0 0 24 24"
                                            fill="none"
                                            stroke="currentColor"
                                            strokeWidth="1.8"
                                            className="h-5 w-5"
                                        >
                                            {/* Group of people icon for class timetable */}
                                            <circle cx="9" cy="7" r="3" />
                                            <circle cx="17" cy="7" r="2" />
                                            <path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2" />
                                            <path d="M21 21v-1.5a3 3 0 0 0-3-3h-1" />
                                        </svg>
                                    </button>
                                </div>
                                <div className="hidden sm:flex pb-[2px]">
                                    <button
                                        className={`rounded-full p-2 hover:bg-slate-200 dark:hover:bg-slate-700 transition-all ${
                                            isHomeViewActive
                                                ? 'bg-slate-200 dark:bg-slate-700 text-sky-600 dark:text-sky-400 shadow-[0_0_10px_rgba(14,165,233,0.5)] dark:shadow-[0_0_10px_rgba(56,189,248,0.4)]'
                                                : 'text-slate-600 dark:text-slate-300'
                                        }`}
                                        title="My timetable"
                                        aria-label="Load my timetable"
                                        onClick={() => {
                                            setSelectedUser(null);
                                            setSelectedClass(null);
                                            setQueryText('');
                                            setStart(fmtLocal(new Date())); // Return to current week
                                        }}
                                    >
                                        <svg
                                            xmlns="http://www.w3.org/2000/svg"
                                            viewBox="0 0 24 24"
                                            fill="none"
                                            stroke="currentColor"
                                            strokeWidth="1.8"
                                            className="h-5 w-5"
                                        >
                                            <path d="M3 10.5 12 3l9 7.5" />
                                            <path d="M5 10v10h14V10" />
                                            <path d="M9 21v-6h6v6" />
                                        </svg>
                                    </button>
                                </div>
                            </div>
                            {/* Mobile icon cluster */}
                            <div className="flex items-end gap-2 sm:hidden ml-2">
                                <button
                                    type="button"
                                    className={`rounded-full p-2 hover:bg-slate-200 dark:hover:bg-slate-700 transition-all ${
                                        isSearchViewActive
                                            ? 'bg-slate-200 dark:bg-slate-700 text-sky-600 dark:text-sky-400 shadow-[0_0_10px_rgba(14,165,233,0.5)] dark:shadow-[0_0_10px_rgba(56,189,248,0.4)]'
                                            : 'text-slate-600 dark:text-slate-300'
                                    }`}
                                    aria-label="Open search"
                                    onClick={() => setMobileSearchOpen(true)}
                                >
                                    <svg
                                        width="20"
                                        height="20"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="2"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                    >
                                        <circle cx="11" cy="11" r="8" />
                                        <path d="m21 21-4.35-4.35" />
                                    </svg>
                                </button>
                                <button
                                    type="button"
                                    className={`rounded-full p-2 hover:bg-slate-200 dark:hover:bg-slate-700 transition-all ${
                                        isClassViewActive
                                            ? 'bg-slate-200 dark:bg-slate-700 text-sky-600 dark:text-sky-400 shadow-[0_0_10px_rgba(14,165,233,0.5)] dark:shadow-[0_0_10px_rgba(56,189,248,0.4)]'
                                            : 'text-slate-600 dark:text-slate-300'
                                    }`}
                                    aria-label="View my class timetable"
                                    onClick={() => {
                                        setMobileSearchOpen(false);
                                        handleViewMyClass();
                                    }}
                                    disabled={!primaryClass}
                                >
                                    <svg
                                        width="20"
                                        height="20"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="2"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                    >
                                        {/* Group of people icon for class timetable */}
                                        <circle cx="9" cy="7" r="3" />
                                        <circle cx="17" cy="7" r="2" />
                                        <path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2" />
                                        <path d="M21 21v-1.5a3 3 0 0 0-3-3h-1" />
                                    </svg>
                                </button>

                                <button
                                    className={`rounded-full p-2 hover:bg-slate-200 dark:hover:bg-slate-700 transition-all ${
                                        isHomeViewActive
                                            ? 'bg-slate-200 dark:bg-slate-700 text-sky-600 dark:text-sky-400 shadow-[0_0_10px_rgba(14,165,233,0.5)] dark:shadow-[0_0_10px_rgba(56,189,248,0.4)]'
                                            : 'text-slate-600 dark:text-slate-300'
                                    }`}
                                    title="My timetable"
                                    onClick={() => {
                                        setSelectedUser(null);
                                        setSelectedClass(null);
                                        setQueryText('');
                                        setStart(fmtLocal(new Date())); // Return to current week
                                    }}
                                    aria-label="Load my timetable"
                                >
                                    <svg
                                        xmlns="http://www.w3.org/2000/svg"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="1.8"
                                        className="h-5 w-5"
                                    >
                                        <path d="M3 10.5 12 3l9 7.5" />
                                        <path d="M5 10v10h14V10" />
                                        <path d="M9 21v-6h6v6" />
                                    </svg>
                                </button>
                            </div>
                            {/* Week picker with calendar week display */}
                            <div className="flex items-end gap-3 ml-auto week-picker-right-gap">
                                <div className="w-[min(7.5rem,60vw)] sm:w-[min(14rem,80vw)]">
                                    <div className="relative flex items-center w-full">
                                        <label className="label sm:text-sm text-[11px]">
                                            Week
                                        </label>
                                        <label className="label sm:text-sm text-[11px] text-right absolute week-cw-right">
                                            CW {calendarWeek}
                                        </label>
                                    </div>
                                    <input
                                        type="date"
                                        className="input text-sm input-week-compact"
                                        value={start}
                                        onChange={(e) =>
                                            setStart(e.target.value)
                                        }
                                    />
                                </div>
                            </div>
                        </div>
                        {/* Week info removed */}
                    </div>
                    <div className="mt-2 sm:mt-4">
                        {retrySeconds !== null ? (
                            <div className="mb-3 rounded-md border border-sky-300 bg-sky-50 p-3 text-sky-800 dark:border-sky-700 dark:bg-sky-900/40 dark:text-sky-200">
                                Rate limit reached. Retrying in {retrySeconds}s…
                            </div>
                        ) : adminInfoMessage ? (
                            <div className="mb-3 rounded-md border border-sky-300 bg-sky-50 p-3 text-sky-800 dark:border-sky-700 dark:bg-sky-900/40 dark:text-sky-200">
                                {adminInfoMessage}
                            </div>
                        ) : loadError ? (
                            <div className="mb-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-800 dark:border-amber-700 dark:bg-amber-900/40 dark:text-amber-200">
                                {(() => {
                                    try {
                                        const parsed = JSON.parse(loadError);
                                        return parsed?.error || loadError;
                                    } catch {
                                        return loadError;
                                    }
                                })()}
                            </div>
                        ) : null}

                        {mine?.cached && mine?.stale && (
                            <div className="mb-3 rounded-md border border-indigo-300 bg-indigo-50 p-3 text-indigo-800 dark:border-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-200">
                                <div className="flex flex-col gap-1">
                                    <span className="font-medium tracking-tight">
                                        Showing cached timetable
                                    </span>
                                    {fallbackBannerTimestamp && (
                                        <span className="text-sm opacity-90">
                                            Last synced{' '}
                                            {fallbackBannerTimestamp}.
                                            {fallbackBannerCheckedTimestamp && (
                                                <span className="opacity-75">
                                                    {' '}
                                                    Checked{' '}
                                                    {
                                                        fallbackBannerCheckedTimestamp
                                                    }
                                                    .
                                                </span>
                                            )}
                                        </span>
                                    )}
                                    {fallbackBannerMessage && (
                                        <span className="text-sm opacity-90">
                                            {fallbackBannerMessage}
                                        </span>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Color change error message */}
                        {colorError && (
                            <div className="mb-3 rounded-md border border-rose-300 bg-rose-50 p-3 text-rose-800 dark:border-rose-700 dark:bg-rose-900/40 dark:text-rose-200">
                                <div className="flex items-start gap-2">
                                    <svg
                                        className="w-5 h-5 mt-0.5 flex-shrink-0"
                                        fill="none"
                                        stroke="currentColor"
                                        viewBox="0 0 24 24"
                                    >
                                        <path
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            strokeWidth={2}
                                            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z"
                                        />
                                    </svg>
                                    <span>{colorError}</span>
                                </div>
                            </div>
                        )}

                        <Timetable
                            data={mine}
                            holidays={holidays}
                            weekStart={weekStartDate}
                            lessonColors={lessonColors}
                            defaultLessonColors={defaultLessonColors}
                            isAdmin={!!user.isAdmin}
                            onColorChange={handleColorChange}
                            serverLessonOffsets={lessonOffsets}
                            token={token}
                            viewingUserId={selectedUser?.id}
                            onWeekNavigate={handleWeekNavigate}
                            getAdjacentWeekData={getAdjacentWeekData}
                            onLessonModalStateChange={setIsLessonModalOpen}
                            isOnboardingActive={isOnboardingOpen}
                            isRateLimited={retrySeconds !== null}
                            isClassView={!!selectedClass}
                        />
                    </div>
                </section>
            </main>

            {/* Mobile full-screen search overlay */}
            {mobileSearchOpen && (
                <div className="sm:hidden fixed inset-0 z-250 bg-white dark:bg-slate-900 flex flex-col">
                    {/* Header with gradient blur effect */}
                    <div className="header-blur p-4 border-b border-slate-200/60 dark:border-slate-700/60">
                        <div className="flex items-center gap-3">
                            <div className="flex-1 relative">
                                <input
                                    id="mobile-search-input"
                                    className="w-full rounded-xl border border-slate-300 dark:border-slate-600 bg-white/95 dark:bg-slate-800/95 px-4 py-3 text-slate-900 dark:text-slate-100 placeholder:text-slate-500 dark:placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500 text-base shadow-sm"
                                    placeholder="Search for a student..."
                                    value={queryText}
                                    onChange={(e) =>
                                        setQueryText(e.target.value)
                                    }
                                />
                                {queryText && (
                                    <button
                                        className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-full hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400"
                                        onClick={() => setQueryText('')}
                                        aria-label="Clear search"
                                        title="Clear search"
                                    >
                                        <svg
                                            xmlns="http://www.w3.org/2000/svg"
                                            viewBox="0 0 24 24"
                                            fill="none"
                                            stroke="currentColor"
                                            strokeWidth="2"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            className="h-5 w-5"
                                        >
                                            <path d="M18 6 6 18" />
                                            <path d="M6 6l12 12" />
                                        </svg>
                                    </button>
                                )}
                                {searchLoading &&
                                    queryText.trim().length >= 2 && (
                                        <div
                                            className="absolute right-10 top-1/2 -translate-y-1/2 animate-spin text-slate-400"
                                            aria-label="Loading"
                                            role="status"
                                        >
                                            <svg
                                                viewBox="0 0 24 24"
                                                className="h-5 w-5"
                                                fill="none"
                                                stroke="currentColor"
                                                strokeWidth="2"
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
                                        </div>
                                    )}
                                {searchError &&
                                    queryText.trim().length >= 2 && (
                                        <div className="absolute left-0 right-0 top-full mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-600 dark:bg-amber-900/40 dark:text-amber-200 shadow">
                                            {searchError}
                                        </div>
                                    )}
                                {queryText.trim().length === 1 && (
                                    <div className="absolute left-0 right-0 top-full mt-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400 shadow">
                                        Type at least 2 characters…
                                    </div>
                                )}
                            </div>
                            <button
                                className="rounded-xl px-4 py-3 bg-slate-200/90 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 font-medium shadow-sm"
                                onClick={() => {
                                    setMobileSearchOpen(false);
                                    setQueryText(''); // Clear search when closing
                                    setResults([]); // Clear results when closing
                                }}
                                aria-label="Close search"
                            >
                                Close
                            </button>
                        </div>
                    </div>

                    {/* Results area with improved styling */}
                    <div className="flex-1 overflow-auto p-4">
                        {(() => {
                            const trimmed = queryText.trim();
                            if (!trimmed) {
                                return (
                                    <div className="flex flex-col items-center justify-center py-12 text-center">
                                        <div className="w-16 h-16 rounded-full bg-gradient-to-br from-sky-100 to-indigo-100 dark:from-sky-900/30 dark:to-indigo-900/30 flex items-center justify-center mb-4">
                                            <svg
                                                className="w-8 h-8 text-sky-600 dark:text-sky-400"
                                                fill="none"
                                                stroke="currentColor"
                                                viewBox="0 0 24 24"
                                            >
                                                <path
                                                    strokeLinecap="round"
                                                    strokeLinejoin="round"
                                                    strokeWidth="1.5"
                                                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                                                />
                                            </svg>
                                        </div>
                                        <p className="text-slate-600 dark:text-slate-300 text-lg font-medium mb-2">
                                            Search for students
                                        </p>
                                        <p className="text-slate-500 dark:text-slate-400 text-sm">
                                            Start typing to find a student and
                                            view their timetable
                                        </p>
                                    </div>
                                );
                            }
                            if (trimmed.length === 1) {
                                return (
                                    <div className="flex flex-col items-center justify-center py-12 text-center">
                                        <div className="w-16 h-16 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-4">
                                            <svg
                                                className="w-8 h-8 text-slate-400 dark:text-slate-500"
                                                fill="none"
                                                stroke="currentColor"
                                                viewBox="0 0 24 24"
                                            >
                                                <path
                                                    strokeLinecap="round"
                                                    strokeLinejoin="round"
                                                    strokeWidth="1.5"
                                                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                                                />
                                            </svg>
                                        </div>
                                        <p className="text-slate-500 dark:text-slate-400 text-lg font-medium mb-2">
                                            Keep typing…
                                        </p>
                                        <p className="text-slate-400 dark:text-slate-500 text-sm">
                                            Type at least 2 characters to search
                                        </p>
                                    </div>
                                );
                            }
                            if (searchLoading) {
                                return (
                                    <div className="flex flex-col items-center justify-center py-12 text-center">
                                        <div className="w-16 h-16 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-4 animate-spin text-slate-400 dark:text-slate-500">
                                            <svg
                                                viewBox="0 0 24 24"
                                                className="w-8 h-8"
                                                fill="none"
                                                stroke="currentColor"
                                                strokeWidth="2"
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
                                        </div>
                                        <p className="text-slate-500 dark:text-slate-400 text-sm">
                                            Searching…
                                        </p>
                                    </div>
                                );
                            }
                            if (searchError) {
                                return (
                                    <div className="flex flex-col items-center justify-center py-12 text-center">
                                        <div className="w-16 h-16 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center mb-4">
                                            <svg
                                                className="w-8 h-8 text-amber-600 dark:text-amber-300"
                                                fill="none"
                                                stroke="currentColor"
                                                viewBox="0 0 24 24"
                                            >
                                                <path
                                                    strokeLinecap="round"
                                                    strokeLinejoin="round"
                                                    strokeWidth="1.5"
                                                    d="M12 9v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                                                />
                                            </svg>
                                        </div>
                                        <p className="text-amber-700 dark:text-amber-300 text-sm mb-1">
                                            {searchError}
                                        </p>
                                        <p className="text-slate-400 dark:text-slate-500 text-xs">
                                            Adjust your search and try again
                                        </p>
                                    </div>
                                );
                            }
                            if (results.length === 0) {
                                return (
                                    <div className="flex flex-col items-center justify-center py-12 text-center">
                                        <div className="w-16 h-16 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-4">
                                            <svg
                                                className="w-8 h-8 text-slate-400 dark:text-slate-500"
                                                fill="none"
                                                stroke="currentColor"
                                                viewBox="0 0 24 24"
                                            >
                                                <path
                                                    strokeLinecap="round"
                                                    strokeLinejoin="round"
                                                    strokeWidth="1.5"
                                                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                                                />
                                            </svg>
                                        </div>
                                        <p className="text-slate-500 dark:text-slate-400 text-lg font-medium mb-2">
                                            No results found
                                        </p>
                                        <p className="text-slate-400 dark:text-slate-500 text-sm">
                                            Try a different search term
                                        </p>
                                    </div>
                                );
                            }
                            return (
                                <div className="space-y-2">
                                    {results.map((r, index) => (
                                        <div
                                            key={`${r.type}-${r.id}`}
                                            className="animate-fade-in"
                                            style={{
                                                animationDelay: `${
                                                    index * 50
                                                }ms`,
                                            }}
                                        >
                                            <button
                                                className="w-full rounded-xl p-4 text-left bg-slate-50 hover:bg-slate-100 dark:bg-slate-800/50 dark:hover:bg-slate-800 border border-slate-200/60 dark:border-slate-700/60 hover:border-slate-300 dark:hover:border-slate-600 transition-all duration-200 shadow-sm hover:shadow-md group"
                                                onClick={() => {
                                                    setSelectedUser(r);
                                                    setSelectedClass(null);
                                                    setQueryText('');
                                                    setResults([]);
                                                    setMobileSearchOpen(false);
                                                    if (r.id !== user.id)
                                                        loadUser(r.id);
                                                    else loadMine();
                                                }}
                                            >
                                                <div className="flex items-center gap-3">
                                                    <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-semibold text-sm shadow-md bg-gradient-to-br from-sky-500 to-indigo-600">
                                                        {(
                                                            r.displayName ||
                                                            r.username
                                                        )
                                                            .charAt(0)
                                                            .toUpperCase()}
                                                    </div>
                                                    <div className="flex-1">
                                                        <div className="font-semibold text-slate-900 dark:text-slate-100 group-hover:text-sky-700 dark:group-hover:text-sky-300 transition-colors">
                                                            {r.displayName ||
                                                                r.username}
                                                        </div>
                                                        <div className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                                                            {r.displayName
                                                                ? `@${r.username}`
                                                                : 'Student'}
                                                        </div>
                                                    </div>
                                                </div>
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            );
                        })()}
                    </div>
                </div>
            )}
            <FallbackNoticeModal
                notice={fallbackNotice}
                fallbackModalMessage={fallbackModalMessage}
                fallbackNoticeTimestamp={fallbackNoticeTimestamp}
                fallbackNoticeCheckedTimestamp={fallbackNoticeCheckedTimestamp}
                onDismiss={handleDismissFallback}
                onOpenSettings={handleOpenSettingsFromFallback}
            />

            <SettingsModal
                token={token}
                user={user}
                isOpen={isSettingsModalOpen}
                onClose={() => setIsSettingsModalOpen(false)}
                onUserUpdate={onUserUpdate}
            />

            <AbsencePanel
                isOpen={isAbsencePanelOpen}
                onClose={() => setIsAbsencePanelOpen(false)}
                data={absenceData}
                loading={absencesLoading}
                error={absencesError}
                onRefresh={() => {
                    void loadAbsences();
                }}
                selectedPreset={absencePreset}
                onSelectPreset={handleAbsencePresetChange}
                selectedRange={absenceRange}
                presetRanges={presetRanges}
            />

            <NotificationPanel
                notifications={notifications}
                token={token}
                isOpen={isNotificationPanelOpen}
                onClose={() => setIsNotificationPanelOpen(false)}
                onNotificationUpdate={loadNotifications}
            />

            <Suspense fallback={null}>
                <SduiPanel
                    isOpen={isSduiPanelOpen}
                    onClose={() => setIsSduiPanelOpen(false)}
                />
                <OnboardingModal
                    isOpen={isOnboardingOpen}
                    onClose={() => setIsOnboardingOpen(false)}
                    onComplete={handleOnboardingComplete}
                    isSettingsModalOpen={isSettingsModalOpen}
                    onOpenSettings={() => setIsSettingsModalOpen(true)}
                    isLessonModalOpen={isLessonModalOpen}
                />
            </Suspense>
        </div>
    );
}
