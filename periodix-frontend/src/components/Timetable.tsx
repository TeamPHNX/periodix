import {
    useEffect,
    useMemo,
    useState,
    useRef,
    useCallback,
    useLayoutEffect,
} from 'react';
import type {
    Lesson,
    TimetableResponse,
    LessonColors,
    Holiday,
} from '../types';
import {
    addDays,
    fmtLocal,
    startOfWeek,
    yyyymmddToISO,
    fmtHM,
    untisToMinutes,
    getNextWorkday,
    getPreviousWorkday,
} from '../utils/dates';
import { setLessonColor } from '../api';
import { isMobileViewport, MOBILE_MEDIA_QUERY } from '../utils/responsive';
import { useDeveloperModeFlag } from '../hooks/useDeveloperModeFlag';
import LessonModal from './LessonModal';
import HolidayModal from './HolidayModal';
import TimeAxis from './TimeAxis';
import DayColumn from './DayColumn';
import TimetableSkeleton from './TimetableSkeleton';
import {
    shouldNavigateWeek,
    applyRubberBandResistance,
} from '../utils/timetable/layout';
import { mergeLessons } from '../utils/timetable/lessonMerging';
import { calculateWeekMaxColCount } from '../utils/dayColumn/layout';
// (Mobile vertical layout removed; keeping original horizontal week view across breakpoints)

// Augment global Window type for debug object (scoped here to avoid polluting other modules)
declare global {
    interface Window {
        PeriodixTTDebug?: {
            getState: () => {
                translateX: number;
                isAnimating: boolean;
                isDragging: boolean;
                lastNavigationTime: number;
                now: number;
                gestureAttachAttempts: number;
                forceGestureReattach: number;
            };
            forceReset: () => string;
            forceGestureReattach: () => string;
        };
    }
}

export default function Timetable({
    data,
    holidays = [],
    weekStart,
    lessonColors = {},
    defaultLessonColors = {},
    isAdmin = false,
    onColorChange,
    serverLessonOffsets = {},
    token,
    viewingUserId,
    onWeekNavigate,
    getAdjacentWeekData,
    onLessonModalStateChange,
    isOnboardingActive,
    isRateLimited,
    isClassView = false,
}: {
    data: TimetableResponse | null;
    holidays?: Holiday[];
    weekStart: Date;
    lessonColors?: LessonColors;
    defaultLessonColors?: LessonColors;
    isAdmin?: boolean;
    onColorChange?: (
        lessonName: string,
        color: string | null,
        offset?: number,
    ) => void;
    serverLessonOffsets?: Record<string, number>;
    token?: string;
    viewingUserId?: string; // if admin is viewing a student
    onWeekNavigate?: (direction: 'prev' | 'next') => void; // optional external navigation handler
    getAdjacentWeekData?: (
        direction: 'prev' | 'next',
    ) => TimetableResponse | null; // function to get cached data for adjacent weeks
    onLessonModalStateChange?: (isOpen: boolean) => void; // callback for onboarding
    isOnboardingActive?: boolean;
    isRateLimited?: boolean;
    isClassView?: boolean;
    // Extended: allow passing current offset when color set
    // (so initial color creation can persist chosen offset)
    // Keeping backwards compatibility (third param optional)
}) {
    const START_MIN = 7 * 60 + 40; // 07:40
    const END_MIN = 17 * 60 + 15; // 17:15
    const totalMinutes = END_MIN - START_MIN;

    const [now, setNow] = useState<Date>(() => new Date());
    useEffect(() => {
        const update = () => setNow(new Date());
        update();
        const id = setInterval(update, 30_000);
        return () => clearInterval(id);
    }, []);

    // Use synchronous media query to set initial state correctly (avoids layout shift on mobile)
    // without relying on potentially unstable PWA window dimensions.
    const initialMobile =
        typeof window !== 'undefined'
            ? window.matchMedia(MOBILE_MEDIA_QUERY).matches
            : false;

    // Default mobile scale estimate: 660px height / totalMinutes
    // 660 is the minimum clamped height logic used in computeScale
    const MOBILE_DEFAULT_SCALE = 660 / totalMinutes;

    const [SCALE, setSCALE] = useState<number>(
        initialMobile ? MOBILE_DEFAULT_SCALE : 1,
    );
    const [axisWidth, setAxisWidth] = useState<number>(initialMobile ? 44 : 56);
    const [estimatedDayWidth, setEstimatedDayWidth] = useState<number>(0);
    const [estimatedFocusedDayWidth, setEstimatedFocusedDayWidth] =
        useState<number>(0);
    // Responsive vertical spacing; mobile gets tighter layout
    const [BOTTOM_PAD_PX, setBOTTOM_PAD_PX] = useState(initialMobile ? 6 : 14);
    const [DAY_HEADER_PX, setDAY_HEADER_PX] = useState(initialMobile ? 40 : 32);
    // Single-day focus mode: when set to an ISO date string (yyyy-mm-dd) only that day is shown full-width
    const [focusedDay, setFocusedDay] = useState<string | null>(null);
    // Day view animation state
    const [dayTranslateX, setDayTranslateX] = useState(0);
    const [isDayAnimating, setIsDayAnimating] = useState(false);
    const [isDayDragging, setIsDayDragging] = useState(false);
    const dayAnimationRef = useRef<number | null>(null);
    const dayTranslateXRef = useRef(0);
    useEffect(() => {
        dayTranslateXRef.current = dayTranslateX;
    }, [dayTranslateX]);
    const isDayAnimatingRef = useRef(false);
    const isDayDraggingRef = useRef(false);
    useEffect(() => {
        isDayAnimatingRef.current = isDayAnimating;
    }, [isDayAnimating]);
    useEffect(() => {
        isDayDraggingRef.current = isDayDragging;
    }, [isDayDragging]);
    const {
        isDeveloperModeEnabled,
        isDeveloperMode,
        setIsDeveloperMode,
        isDebug,
    } = useDeveloperModeFlag();
    const [selectedLesson, setSelectedLesson] = useState<Lesson | null>(null);
    const [selectedGroup, setSelectedGroup] = useState<Lesson[] | null>(null);
    const [selectedIndexInGroup, setSelectedIndexInGroup] = useState<number>(0);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [selectedHoliday, setSelectedHoliday] = useState<Holiday | null>(
        null,
    );
    const [isHolidayModalOpen, setIsHolidayModalOpen] = useState(false);

    const handleHolidayClick = (holiday: Holiday) => {
        setSelectedHoliday(holiday);
        setIsHolidayModalOpen(true);
    };
    // For privacy: non-admins always use their own (viewer) bucket, never the timetable owner's ID.
    // If we later have the viewer's concrete user id, swap 'self' with it; this prevents leaking offsets across viewed timetables.
    const storageKey = isAdmin
        ? 'adminLessonGradientOffsets'
        : 'lessonGradientOffsets:self';
    const legacyKey = 'lessonGradientOffsets';
    const [gradientOffsets, setGradientOffsets] = useState<
        Record<string, number>
    >(() => {
        // Attempt to load user‑scoped first
        try {
            const raw = localStorage.getItem(storageKey);
            if (raw) return JSON.parse(raw);
            // Migrate legacy key once if present
            const legacy = localStorage.getItem(legacyKey);
            if (legacy) {
                localStorage.setItem(storageKey, legacy);
                return JSON.parse(legacy);
            }
        } catch {
            /* ignore */
        }
        return serverLessonOffsets || {};
    });

    // When server offsets change (after fetch), merge them (client overrides win if exist)
    useEffect(() => {
        if (serverLessonOffsets && Object.keys(serverLessonOffsets).length) {
            // Prefer fresh server values over any cached local ones to avoid stale offsets
            setGradientOffsets((prev) => ({ ...prev, ...serverLessonOffsets }));
        }
    }, [serverLessonOffsets]);

    // Reload offsets if user changes (e.g., switching accounts without full reload)
    useEffect(() => {
        try {
            const raw = localStorage.getItem(storageKey);
            if (raw) setGradientOffsets(JSON.parse(raw));
            else setGradientOffsets({});
        } catch {
            setGradientOffsets({});
        }
    }, [storageKey]);

    // Debounce timers per lesson to avoid hammering the API while user drags slider
    const offsetPersistTimers = useRef<Record<string, number>>({});
    const OFFSET_DEBOUNCE_MS = 600;

    const updateGradientOffset = (lessonName: string, offset: number) => {
        // Immediate local/UI update
        setGradientOffsets((prev) => {
            const next = { ...prev };
            if (offset === 0.5) delete next[lessonName];
            else next[lessonName] = offset;
            try {
                localStorage.setItem(storageKey, JSON.stringify(next));
            } catch {
                /* ignore */
            }
            return next;
        });

        // Only schedule persistence if a real color override exists (custom or admin default)
        const hasExplicitColor =
            !!lessonColors[lessonName] || !!defaultLessonColors[lessonName];
        if (!token || !hasExplicitColor) return;

        // Clear any pending timer for this lesson
        const existing = offsetPersistTimers.current[lessonName];
        if (existing) window.clearTimeout(existing);

        // Schedule new persistence after user stops adjusting
        offsetPersistTimers.current[lessonName] = window.setTimeout(() => {
            const color =
                lessonColors[lessonName] || defaultLessonColors[lessonName]!;
            setLessonColor(
                token,
                lessonName,
                color,
                viewingUserId,
                offset,
            ).catch(() => undefined);
            delete offsetPersistTimers.current[lessonName];
        }, OFFSET_DEBOUNCE_MS);
    };

    // Cleanup timers on unmount
    useEffect(() => {
        const timersRef = offsetPersistTimers.current; // snapshot
        return () => {
            Object.values(timersRef).forEach((id) => window.clearTimeout(id));
        };
    }, []);

    const handleLessonClick = (lesson: Lesson) => {
        setSelectedLesson(lesson);
        // Build overlapping group for the clicked lesson within its day
        try {
            const dayIso = yyyymmddToISO(lesson.date);
            const dayLessons = lessonsByDay[dayIso] || [];
            const s0 = untisToMinutes(lesson.startTime);
            const e0 = untisToMinutes(lesson.endTime);
            const overlaps = dayLessons.filter((lsn) => {
                const s1 = untisToMinutes(lsn.startTime);
                const e1 = untisToMinutes(lsn.endTime);
                return s1 < e0 && s0 < e1; // overlap
            });
            overlaps.sort(
                (a, b) => a.startTime - b.startTime || a.endTime - b.endTime,
            );
            const idx = overlaps.findIndex((l) => l.id === lesson.id);
            setSelectedGroup(overlaps.length > 1 ? overlaps : null);
            setSelectedIndexInGroup(idx >= 0 ? idx : 0);
        } catch {
            setSelectedGroup(null);
            setSelectedIndexInGroup(0);
        }
        setIsModalOpen(true);

        // Notify onboarding if active (global callback)
        if (
            typeof (
                window as Window &
                    typeof globalThis & {
                        onboardingLessonModalStateChange?: (
                            isOpen: boolean,
                        ) => void;
                    }
            ).onboardingLessonModalStateChange === 'function'
        ) {
            (
                window as Window &
                    typeof globalThis & {
                        onboardingLessonModalStateChange: (
                            isOpen: boolean,
                        ) => void;
                    }
            ).onboardingLessonModalStateChange(true);
        }

        // Notify parent component (Dashboard) for onboarding
        if (onLessonModalStateChange) {
            onLessonModalStateChange(true);
        }
    };

    useEffect(() => {
        function computeScale() {
            const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
            const vw = typeof window !== 'undefined' ? window.innerWidth : 1024;
            // Raised mobile threshold from 640px to 768px (see utils/responsive.ts)
            const isMobile = isMobileViewport(vw);

            let currentAxisWidth = 56;

            // Target vertical pixels for timetable (excludes header) – dynamic for better fill
            // Mobile: keep more compact (1.0–1.15 px/min) to avoid excessive scrolling
            if (isMobile) {
                const targetHeight = Math.min(
                    880,
                    Math.max(660, Math.floor(vh * 0.9)),
                );
                setSCALE(targetHeight / totalMinutes);
                currentAxisWidth = vw < 400 ? 40 : 44;
                setAxisWidth(currentAxisWidth);
                setDAY_HEADER_PX(40); // a little taller, easier tap
                setBOTTOM_PAD_PX(6);
            } else {
                const targetHeight = Math.max(560, Math.floor(vh * 0.78));
                setSCALE(targetHeight / totalMinutes);
                currentAxisWidth = 56;
                setAxisWidth(currentAxisWidth);
                setDAY_HEADER_PX(32);
                setBOTTOM_PAD_PX(14);
            }

            // Calculate estimated day width for week view
            // Available width = vw - axisWidth
            // Gaps: 4 gaps between 5 columns.
            // Gap size: sm (640px) ? 12px (gap-3) : 4px (gap-1)
            const isTailwindSm = vw >= 640;
            const gapSize = isTailwindSm ? 12 : 4;
            const totalGaps = 4 * gapSize;
            const availableWidth = vw - currentAxisWidth;
            // Ensure we don't divide by zero or get negative
            const colWidth = Math.max(0, (availableWidth - totalGaps) / 5);
            setEstimatedDayWidth(colWidth);

            // Calculate estimated width for focused day view (full available width)
            setEstimatedFocusedDayWidth(availableWidth);
        }
        // Verify dimensions on mount as initialLayout from useMemo might be based on stale/pre-standalone PWA dimensions
        computeScale();
        window.addEventListener('resize', computeScale);
        return () => window.removeEventListener('resize', computeScale);
    }, [totalMinutes]);

    const monday = startOfWeek(weekStart);
    const days = useMemo(
        () => Array.from({ length: 5 }, (_, i) => addDays(monday, i)),
        [monday],
    );

    const [translateX, setTranslateX] = useState(0); // Current transform offset
    const [isDragging, setIsDragging] = useState(false);
    const [isAnimating, setIsAnimating] = useState(false);
    const [isHighlightVisible, setIsHighlightVisible] = useState(false);

    // Multi-week data for sliding animation
    const prevWeekMonday = useMemo(() => addDays(monday, -7), [monday]);
    const nextWeekMonday = useMemo(() => addDays(monday, 7), [monday]);

    const prevWeekDays = useMemo(
        () => Array.from({ length: 5 }, (_, i) => addDays(prevWeekMonday, i)),
        [prevWeekMonday],
    );

    const nextWeekDays = useMemo(
        () => Array.from({ length: 5 }, (_, i) => addDays(nextWeekMonday, i)),
        [nextWeekMonday],
    );

    const todayISO = useMemo(() => fmtLocal(now), [now]);
    const isCurrentWeek = useMemo(
        () => days.some((d) => fmtLocal(d) === todayISO),
        [days, todayISO],
    );
    const isPrevWeekCurrent = useMemo(
        () => prevWeekDays.some((d) => fmtLocal(d) === todayISO),
        [prevWeekDays, todayISO],
    );
    const isNextWeekCurrent = useMemo(
        () => nextWeekDays.some((d) => fmtLocal(d) === todayISO),
        [nextWeekDays, todayISO],
    );

    const hasTodayInTrack =
        isCurrentWeek || isPrevWeekCurrent || isNextWeekCurrent;

    // Control highlight visibility - shows when moving or briefly after settling on Today
    useEffect(() => {
        if (!hasTodayInTrack) {
            setIsHighlightVisible(false);
            return;
        }

        const isActivelyMoving = isAnimating || Math.abs(translateX) > 25;

        if (isActivelyMoving) {
            setIsHighlightVisible(true);
        } else if (isCurrentWeek && isHighlightVisible) {
            // Once settled specifically on Today's week, keep visible for a bit then fade
            const tid = setTimeout(() => {
                setIsHighlightVisible(false);
            }, 300);
            return () => clearTimeout(tid);
        } else {
            // Settled on a week that isn't Today (but Today is still in the track buffer)
            // Immediately hide to avoid confusion
            setIsHighlightVisible(false);
        }
    }, [
        hasTodayInTrack,
        isCurrentWeek,
        isDragging,
        isAnimating,
        translateX,
        isHighlightVisible,
    ]);

    // Advanced swipe animation for smooth week navigation
    const touchStartX = useRef<number | null>(null);
    const touchStartY = useRef<number | null>(null);
    const touchStartTime = useRef<number | null>(null);
    const lastMoveXRef = useRef<number | null>(null);
    const lastMoveTimeRef = useRef<number | null>(null);
    const flingVelocityRef = useRef<number>(0); // px per second captured at release
    const containerRef = useRef<HTMLDivElement | null>(null);
    const slidingTrackRef = useRef<HTMLDivElement | null>(null);
    // Navigation lock to avoid double week jumps when diagonal / fast gestures overshoot
    const lastNavigationTimeRef = useRef<number>(0);

    const animationRef = useRef<number | null>(null);
    const translateXRef = useRef(0); // keep latest translateX for animation starts
    useEffect(() => {
        translateXRef.current = translateX;
    }, [translateX]);
    // Refs mirroring mutable interaction state for stable single-mount handlers
    const isAnimatingRef = useRef(isAnimating);
    const isDraggingRef = useRef(isDragging);
    const axisWidthRef = useRef(axisWidth);
    const onWeekNavigateRef = useRef(onWeekNavigate);
    const focusedDayRef = useRef(focusedDay);
    const weekStartRef = useRef(weekStart);
    const isDebugRef = useRef(false);
    isDebugRef.current = isDebug; // recompute each render

    useEffect(() => {
        isAnimatingRef.current = isAnimating;
    }, [isAnimating]);
    useEffect(() => {
        isDraggingRef.current = isDragging;
    }, [isDragging]);
    useEffect(() => {
        axisWidthRef.current = axisWidth;
    }, [axisWidth]);
    useEffect(() => {
        onWeekNavigateRef.current = onWeekNavigate;
    }, [onWeekNavigate]);
    useEffect(() => {
        focusedDayRef.current = focusedDay;
    }, [focusedDay]);
    useEffect(() => {
        weekStartRef.current = weekStart;
    }, [weekStart]);

    // Refs to expose navigation functions for debug buttons
    const triggerNavigationRef = useRef<
        ((direction: 'prev' | 'next') => void) | null
    >(null);
    const triggerDayNavigationRef = useRef<
        ((direction: 'prev' | 'next') => void) | null
    >(null);

    // Lifecycle reset: when page/tab is hidden or app backgrounded (PWA iOS), ensure we reset drag/animation state
    const [forceGestureReattach, setForceGestureReattach] = useState(0);
    useEffect(() => {
        function resetTransientGestureState() {
            // Reset state variables
            setIsDragging(false);
            setTranslateX(0);
            setIsAnimating(false);

            // Reset day view state
            setDayTranslateX(0);
            setIsDayAnimating(false);
            setIsDayDragging(false);

            // Reset all touch tracking refs to prevent stale gesture state
            // This fixes the issue where swiping doesn't work after PWA close/reopen
            // because the refs retain old touch values from previous session
            touchStartX.current = null;
            touchStartY.current = null;
            touchStartTime.current = null;
            lastMoveXRef.current = null;
            lastMoveTimeRef.current = null;

            // Reset ref mirrors to match state
            isDraggingRef.current = false;
            isAnimatingRef.current = false;
            isDayAnimatingRef.current = false;
            isDayDraggingRef.current = false;

            // Force gesture re-attachment by incrementing the force flag
            // This ensures gesture handlers are properly re-attached after PWA resume
            // even when the container ref already exists
            setForceGestureReattach((prev) => prev + 1);
        }
        const handleVisibility = () => {
            if (document.hidden) {
                resetTransientGestureState();
            } else {
                // Also reset when becoming visible again to ensure clean state on PWA reopen
                resetTransientGestureState();
            }
        };
        // iOS PWA sometimes fires pagehide instead of visibilitychange before suspension
        window.addEventListener('visibilitychange', handleVisibility);
        window.addEventListener('pagehide', resetTransientGestureState);
        window.addEventListener('blur', resetTransientGestureState);
        window.addEventListener('focus', resetTransientGestureState);

        // Additional PWA-specific events for trackpad-based suspend/resume
        // These events may fire differently when PWA is closed via trackpad gestures
        window.addEventListener('beforeunload', resetTransientGestureState);
        window.addEventListener('unload', resetTransientGestureState);
        document.addEventListener('resume', resetTransientGestureState);
        document.addEventListener('pause', resetTransientGestureState);

        // Handle potential input device changes that might affect gesture handling
        window.addEventListener('pointercancel', resetTransientGestureState);

        return () => {
            window.removeEventListener('visibilitychange', handleVisibility);
            window.removeEventListener('pagehide', resetTransientGestureState);
            window.removeEventListener('blur', resetTransientGestureState);
            window.removeEventListener('focus', resetTransientGestureState);
            window.removeEventListener(
                'beforeunload',
                resetTransientGestureState,
            );
            window.removeEventListener('unload', resetTransientGestureState);
            document.removeEventListener('resume', resetTransientGestureState);
            document.removeEventListener('pause', resetTransientGestureState);
            window.removeEventListener(
                'pointercancel',
                resetTransientGestureState,
            );
        };
    }, []);

    // Reset transform when week changes (continuous band effect)
    useLayoutEffect(() => {
        // Always reset when weekStart changes - this ensures clean state for new week
        setTranslateX(0);
        setIsAnimating(false);
        isAnimatingRef.current = false;
        setIsDragging(false);
        isDraggingRef.current = false;
        flingVelocityRef.current = 0;
        lastNavigationTimeRef.current = Date.now();
    }, [weekStart]);

    const hasData = !!data;
    const [gestureAttachAttempts, setGestureAttachAttempts] = useState(0);
    useEffect(() => {
        const el = containerRef.current;
        if (!el) {
            if (gestureAttachAttempts < 8) {
                if (isDebugRef.current)
                    console.debug('[TT] gesture attach retry', {
                        attempt: gestureAttachAttempts,
                    });
                requestAnimationFrame(() =>
                    setGestureAttachAttempts((a) => a + 1),
                );
            } else if (isDebugRef.current) {
                console.debug(
                    '[TT] gesture attach giving up (container still null)',
                );
            }
            return;
        }
        if (isDebugRef.current)
            console.debug('[TT] gesture handlers attach', {
                attempt: gestureAttachAttempts,
                forceReattach: forceGestureReattach,
            });

        // Capture the ref at the beginning of the effect
        const currentAnimationRef = animationRef.current;

        let skipSwipe = false;
        // (removed legacy wheelTimeout; using wheelChainTimer approach now)
        // Trackpad gesture management state
        // We treat a sequence of wheel events with short gaps as one "wheel gesture chain".
        // Only one week navigation is allowed per chain. Chain ends after inactivity timeout.
        let wheelChainActive = false;
        let wheelChainTimer: number | null = null;
        let hasNavigatedThisWheelChain = false;
        // Additional global cooldown (belt & suspenders) in case momentum resumes after chain end
        let lastWheelNavTime = 0;
        const WHEEL_COOLDOWN_MS = 800; // Slightly longer to avoid rapid accidental double jumps
        const WHEEL_CHAIN_INACTIVITY_MS = 260; // If no wheel events in this window, new chain may start
        // Track scroll position at the start of a wheel chain to detect edge overscroll
        let wheelInitialScrollTop = 0;
        let wheelInitialMaxScrollTop = 0;
        const INTERACTIVE_SELECTOR =
            'input,textarea,select,button,[contenteditable="true"],[role="textbox"]';

        // Touch handling for week navigation swipes

        const handleTouchStart = (e: TouchEvent) => {
            if (e.touches.length !== 1 || isAnimatingRef.current) {
                if (isDebugRef.current) {
                    console.debug('[TT] touchstart gated', {
                        touches: e.touches.length,
                        animating: isAnimatingRef.current,
                    });
                }
                return;
            }
            const target = e.target as HTMLElement | null;
            // Ignore swipe if user starts on an interactive control
            // BUT allow swiping on the sticky header (day buttons)
            const isHeader = target?.closest('.sticky');
            if (
                target &&
                !isHeader &&
                (target.closest(INTERACTIVE_SELECTOR) ||
                    target.tagName === 'INPUT')
            ) {
                skipSwipe = true;
                return;
            }

            skipSwipe = false;

            setIsDragging(true);
            isDraggingRef.current = true;
            touchStartX.current = e.touches[0].clientX;
            touchStartY.current = e.touches[0].clientY;
            touchStartTime.current = Date.now();
            flingVelocityRef.current = 0;
        };

        const handleTouchMove = (e: TouchEvent) => {
            if (
                !isDraggingRef.current ||
                touchStartX.current == null ||
                touchStartY.current == null
            ) {
                return;
            }

            const currentX = e.touches[0].clientX;
            const currentY = e.touches[0].clientY;
            const dx = currentX - touchStartX.current;
            const dy = currentY - touchStartY.current;

            // If skipSwipe was set (e.g., started on interactive element), bail
            if (skipSwipe) {
                return;
            }

            // For horizontal swipes (week navigation), check if movement is primarily horizontal
            const isHorizontalSwipe =
                Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 10;

            // If it's clearly a vertical scroll, let browser handle it (pull-to-refresh handled by library)
            if (!isHorizontalSwipe && Math.abs(dy) > 15) {
                skipSwipe = true;
                setIsDragging(false);
                isDraggingRef.current = false;
                setTranslateX(0);
                translateXRef.current = 0;
                return;
            }

            // Prevent default only for horizontal swipes to avoid conflicts with scrolling
            if (isHorizontalSwipe) {
                e.preventDefault();
            }

            // Update transform with improved rubber band resistance
            const containerWidth = el.getBoundingClientRect().width;
            const newTranslateX = applyRubberBandResistance(dx, containerWidth);

            // Check if in day view mode - update dayTranslateX instead of translateX
            if (focusedDayRef.current) {
                setDayTranslateX(newTranslateX);
                setIsDayDragging(true);
                isDayDraggingRef.current = true;
            } else {
                setTranslateX(newTranslateX);
            }

            // Calculate instantaneous velocity for fling
            const now = performance.now();
            if (lastMoveTimeRef.current && lastMoveXRef.current !== null) {
                const dt = now - lastMoveTimeRef.current;
                const dxMove = currentX - lastMoveXRef.current;
                if (dt > 8) {
                    // Avoid division by zero or tiny intervals
                    const v = Math.abs(dxMove / dt) * 1000;
                    // Simple smoothing: 0.6 * new + 0.4 * old to reduce noise
                    const oldV = flingVelocityRef.current || 0;
                    flingVelocityRef.current = oldV * 0.4 + v * 0.6;
                }
            }

            // Track recent movement for velocity (use last segment for fling feel)
            lastMoveXRef.current = currentX;
            lastMoveTimeRef.current = now;
        };

        const performDayNavigation = (
            direction: 'prev' | 'next',
            userVelocityPxPerSec?: number,
        ) => {
            if (isDayAnimatingRef.current || isAnimatingRef.current) {
                // Don't interrupt ongoing animations
                setDayTranslateX(0);
                setIsDayDragging(false);
                return;
            }

            const currentFocusedDay = focusedDayRef.current;
            if (!currentFocusedDay) {
                // If not in focused day mode, fallback to week navigation
                return performNavigation(direction, userVelocityPxPerSec);
            }

            const currentDate = new Date(currentFocusedDay);
            let targetDate: Date;

            if (direction === 'next') {
                targetDate = getNextWorkday(currentDate);
            } else {
                targetDate = getPreviousWorkday(currentDate);
            }

            const targetDateStr = fmtLocal(targetDate);

            // Check if we need to change weeks
            const currentWeek = startOfWeek(currentDate);
            const targetWeek = startOfWeek(targetDate);
            const needsWeekChange =
                fmtLocal(currentWeek) !== fmtLocal(targetWeek);

            // Start animation
            setIsDayAnimating(true);
            isDayAnimatingRef.current = true;

            // Cancel any in-flight animation
            if (dayAnimationRef.current) {
                cancelAnimationFrame(dayAnimationRef.current);
                dayAnimationRef.current = null;
            }

            // Calculate target position (full container width for day view)
            const containerWidth =
                el.getBoundingClientRect().width - axisWidthRef.current;
            const startX = dayTranslateXRef.current;
            const targetX =
                direction === 'next' ? -containerWidth : containerWidth;
            const delta = targetX - startX;

            // Determine duration based on velocity
            const stride = Math.abs(delta);
            const DEFAULT_SPEED = 1900;
            const MIN_DURATION = 180;
            const MAX_DURATION = 420;
            const speed = Math.min(
                6000,
                Math.max(900, userVelocityPxPerSec || DEFAULT_SPEED),
            );
            let duration = (stride / speed) * 1000;
            if (!isFinite(duration)) duration = 300;
            duration = Math.min(MAX_DURATION, Math.max(MIN_DURATION, duration));
            const startTime = performance.now();

            // Smooth ease-out for natural feel
            const ease = (t: number) => {
                if (t <= 0) return 0;
                if (t >= 1) return 1;
                const u = 1 - t;
                return 1 - u * u * u;
            };

            const step = (now: number) => {
                const t = Math.min(1, (now - startTime) / duration);
                const eased = ease(t);
                setDayTranslateX(startX + delta * eased);

                if (t < 1) {
                    dayAnimationRef.current = requestAnimationFrame(step);
                } else {
                    // Animation complete - update the focused day
                    setDayTranslateX(targetX);

                    requestAnimationFrame(() => {
                        if (needsWeekChange) {
                            // Navigate to the new week first
                            const weekDirection =
                                fmtLocal(targetWeek) > fmtLocal(currentWeek)
                                    ? 'next'
                                    : 'prev';
                            onWeekNavigateRef.current?.(weekDirection);
                            // Set focused day after brief delay for week data to update
                            setTimeout(() => {
                                setFocusedDay(targetDateStr);
                                setDayTranslateX(0);
                                setIsDayAnimating(false);
                                isDayAnimatingRef.current = false;
                                setIsDayDragging(false);
                                isDayDraggingRef.current = false;
                            }, 50);
                        } else {
                            // Same week - just update the focused day
                            setFocusedDay(targetDateStr);
                            setDayTranslateX(0);
                            setIsDayAnimating(false);
                            isDayAnimatingRef.current = false;
                            setIsDayDragging(false);
                            isDayDraggingRef.current = false;
                        }
                    });
                }
            };

            dayAnimationRef.current = requestAnimationFrame(step);

            if (isDebugRef.current) {
                console.debug('[TT] day navigation animation start', {
                    direction,
                    from: currentFocusedDay,
                    to: targetDateStr,
                    needsWeekChange,
                    containerWidth,
                    targetX,
                });
            }
        };

        const performNavigation = (
            direction: 'prev' | 'next',
            userVelocityPxPerSec?: number,
        ) => {
            if (isAnimatingRef.current) {
                // Ignore new navigation until current finishes; snap back for safety
                setTranslateX(0);
                setIsDragging(false);
                if (isDebugRef.current) {
                    console.debug(
                        '[TT] performNavigation blocked: already animating',
                        {
                            direction,
                            translateX: translateXRef.current,
                        },
                    );
                }
                return;
            }
            // Do NOT update lastNavigationTimeRef yet; we move it to end so user can chain swipes fluidly.
            setIsAnimating(true);
            isAnimatingRef.current = true;
            if (isDebugRef.current) {
                console.debug('[TT] performNavigation start', {
                    direction,
                    userVelocityPxPerSec,
                    translateXStart: translateXRef.current,
                });
            }

            // Cancel any in‑flight animation
            if (animationRef.current) {
                cancelAnimationFrame(animationRef.current);
                animationRef.current = null;
            }

            // Determine precise stride (distance between week centers) to avoid gap/overshoot.
            let targetX: number;
            const startX = translateXRef.current; // may be partial if user let go mid-drag
            const track = slidingTrackRef.current;
            if (track) {
                const weekEls = Array.from(track.children) as HTMLElement[]; // [prev,current,next]
                if (weekEls.length === 3) {
                    const currentBox = weekEls[1].getBoundingClientRect();
                    // Measure stride using adjacent week's left delta (accounts for gap + exact width)
                    const nextBox = weekEls[2].getBoundingClientRect();
                    const prevBox = weekEls[0].getBoundingClientRect();
                    const strideNext = nextBox.left - currentBox.left;
                    const stridePrev = currentBox.left - prevBox.left;
                    const stride =
                        direction === 'next' ? strideNext : stridePrev;
                    targetX = direction === 'next' ? -stride : stride; // move opposite to direction to reveal that week
                } else {
                    // Fallback: approximate using container width minus axis column (prevents large overshoot)
                    const fullWidth = el.getBoundingClientRect().width;
                    targetX =
                        direction === 'next'
                            ? -(fullWidth - axisWidth)
                            : fullWidth - axisWidth;
                }
            } else {
                const fullWidth = el.getBoundingClientRect().width;
                targetX =
                    direction === 'next'
                        ? -(fullWidth - axisWidth)
                        : fullWidth - axisWidth;
            }
            const delta = targetX - startX;

            // Determine duration based on stride & user swipe velocity (if provided)
            const stride = Math.abs(delta);
            const DEFAULT_SPEED = 1900; // px/sec baseline similar to prior perceived speed
            const MIN_DURATION = 180; // ms
            const MAX_DURATION = 520; // ms (fallback upper bound)
            const speed = Math.min(
                6000,
                Math.max(900, userVelocityPxPerSec || DEFAULT_SPEED),
            );
            let DURATION = (stride / speed) * 1000; // ms
            if (!isFinite(DURATION)) DURATION = 380;
            DURATION = Math.min(MAX_DURATION, Math.max(MIN_DURATION, DURATION));
            const durationMs = DURATION; // capture for closure clarity
            const startTime = performance.now();

            // Mild ease-out to mask discrete frame finish while keeping momentum feel
            const ease = (t: number) => {
                if (t <= 0) return 0;
                if (t >= 1) return 1;
                // easeOutCubic
                const u = 1 - t;
                return 1 - u * u * u;
            };

            const step = (now: number) => {
                const t = Math.min(1, (now - startTime) / durationMs);
                const eased = ease(t);
                setTranslateX(startX + delta * eased);
                if (t < 1) {
                    animationRef.current = requestAnimationFrame(step);
                } else {
                    // Finalize at exact target to avoid sub‑pixel remainder
                    setTranslateX(targetX);
                    if (isDebugRef.current) {
                        console.debug('[TT] animation reached target', {
                            direction,
                            targetX,
                        });
                    }
                    // Immediately swap week (without visible jump) by resetting translateX after data update
                    // Use rAF so layout with final frame paints first
                    requestAnimationFrame(() => {
                        resetWheelChain();

                        if (onWeekNavigateRef.current) {
                            onWeekNavigateRef.current(direction);
                            // Defer reset to useLayoutEffect on weekStart change
                            if (isDebugRef.current) {
                                console.debug(
                                    '[TT] navigation callback fired, awaiting prop update',
                                );
                            }
                            // Safety timeout in case prop update fails or is too slow
                            setTimeout(() => {
                                if (isAnimatingRef.current) {
                                    setTranslateX(0);
                                    setIsAnimating(false);
                                    isAnimatingRef.current = false;
                                    setIsDragging(false);
                                    isDraggingRef.current = false;
                                    flingVelocityRef.current = 0;
                                    lastNavigationTimeRef.current = Date.now();
                                }
                            }, 400);
                        } else {
                            // No handler, snap back immediately
                            setTranslateX(0);
                            setIsAnimating(false);
                            isAnimatingRef.current = false;
                            setIsDragging(false);
                            isDraggingRef.current = false;
                            flingVelocityRef.current = 0;
                            lastNavigationTimeRef.current = Date.now();
                            if (isDebugRef.current) {
                                console.debug(
                                    '[TT] navigation complete (local reset)',
                                    {
                                        direction,
                                        lastNavigationTime:
                                            lastNavigationTimeRef.current,
                                    },
                                );
                            }
                        }
                    });
                }
            };
            animationRef.current = requestAnimationFrame(step);
        };

        const handleTouchEnd = (e: TouchEvent) => {
            if (skipSwipe) {
                skipSwipe = false;
                setIsDragging(false);
                setTranslateX(0);
                return;
            }

            if (
                !isDraggingRef.current ||
                touchStartX.current == null ||
                touchStartY.current == null ||
                touchStartTime.current == null
            ) {
                setIsDragging(false);
                setTranslateX(0);
                return;
            }

            const currentX = e.changedTouches[0].clientX;
            const currentY = e.changedTouches[0].clientY;

            setIsDragging(false);
            isDraggingRef.current = false;

            // Pull-to-refresh is now handled by pulltorefreshjs library

            // Use improved navigation detection
            const navigation = shouldNavigateWeek(
                touchStartX.current,
                touchStartY.current,
                currentX,
                currentY,
                touchStartTime.current,
            );

            if (navigation.shouldNavigate && navigation.direction) {
                // Compute fling velocity using last segment vs touch start for fallback
                let velocity = flingVelocityRef.current;
                if (
                    !velocity &&
                    lastMoveXRef.current != null &&
                    lastMoveTimeRef.current != null &&
                    touchStartX.current != null &&
                    touchStartTime.current != null
                ) {
                    const dtTotal =
                        (performance.now() - touchStartTime.current) / 1000; // s
                    const dxTotal = lastMoveXRef.current - touchStartX.current; // px
                    if (dtTotal > 0) velocity = Math.abs(dxTotal / dtTotal); // px/s
                }

                // Check if we're in focused day mode
                if (focusedDayRef.current) {
                    // Use day navigation instead of week navigation
                    performDayNavigation(navigation.direction, velocity);
                    if (isDebugRef.current) {
                        console.debug('[TT] day navigation trigger', {
                            direction: navigation.direction,
                            focusedDay: focusedDayRef.current,
                            velocity,
                        });
                    }
                } else {
                    // Standard week navigation
                    performNavigation(navigation.direction, velocity);
                    if (isDebugRef.current) {
                        console.debug('[TT] week navigation trigger', {
                            direction: navigation.direction,
                            velocity,
                        });
                    }
                }
            } else {
                // Snap back to current position
                if (focusedDayRef.current) {
                    setDayTranslateX(0);
                    setIsDayDragging(false);
                    isDayDraggingRef.current = false;
                } else {
                    setTranslateX(0);
                }
                if (isDebugRef.current) {
                    console.debug('[TT] touch gesture cancelled / snap back');
                }
            }

            touchStartX.current = null;
            touchStartY.current = null;
            touchStartTime.current = null;
        };

        const recentWheelEvents: { dx: number; dy: number; t: number }[] = [];
        const resetWheelChain = () => {
            wheelChainActive = false;
            hasNavigatedThisWheelChain = false;
            recentWheelEvents.length = 0;
            if (wheelChainTimer) {
                clearTimeout(wheelChainTimer);
                wheelChainTimer = null;
            }
        };
        const WHEEL_SAMPLE_WINDOW_MS = 140; // window of recent events to classify intent
        const handleWheel = (e: WheelEvent) => {
            if (isAnimatingRef.current) return;
            const nowTs = Date.now();
            if (nowTs - lastWheelNavTime < WHEEL_COOLDOWN_MS) return;

            const target = e.target as HTMLElement | null;
            // Allow swiping on the sticky header (day buttons)
            const isHeader = target?.closest('.sticky');
            if (
                target &&
                !isHeader &&
                (target.closest(INTERACTIVE_SELECTOR) ||
                    target.tagName === 'INPUT')
            )
                return;

            // Start / extend chain
            if (!wheelChainActive) {
                wheelChainActive = true;
                hasNavigatedThisWheelChain = false;
                wheelInitialScrollTop = el.scrollTop;
                wheelInitialMaxScrollTop = el.scrollHeight - el.clientHeight;
            }
            if (wheelChainTimer) clearTimeout(wheelChainTimer);
            wheelChainTimer = window.setTimeout(() => {
                wheelChainActive = false;
                hasNavigatedThisWheelChain = false;
                recentWheelEvents.length = 0;
            }, WHEEL_CHAIN_INACTIVITY_MS);

            // Record event
            recentWheelEvents.push({ dx: e.deltaX, dy: e.deltaY, t: nowTs });
            // Drop old samples
            while (
                recentWheelEvents.length &&
                nowTs - recentWheelEvents[0].t > WHEEL_SAMPLE_WINDOW_MS
            ) {
                recentWheelEvents.shift();
            }
            if (hasNavigatedThisWheelChain) {
                if (isDebugRef.current)
                    console.debug(
                        '[TT] wheel ignored: already navigated this chain',
                    );
                return;
            }

            const sumX = recentWheelEvents.reduce((a, v) => a + v.dx, 0);
            const sumY = recentWheelEvents.reduce((a, v) => a + v.dy, 0);
            const absX = Math.abs(sumX);
            const absY = Math.abs(sumY);

            // Edge bounce suppression
            const atTopStart = wheelInitialScrollTop <= 2;
            const atBottomStart =
                wheelInitialScrollTop >= wheelInitialMaxScrollTop - 2;
            const verticalEdgePush =
                (atTopStart && sumY < -25) || (atBottomStart && sumY > 25);

            // Only block if vertical push is significant AND dominant-ish
            // If we are clearly swiping horizontally (absX > absY * 1.2), don't let edge bounce block us
            if (verticalEdgePush && absY > 22 && absY * 1.2 > absX) {
                if (isDebugRef.current)
                    console.debug('[TT] wheel ignored: vertical edge bounce');
                return;
            }

            // Threshold logic tuned for short rolling window
            const HORIZONTAL_MIN = 60; // lowered from 95 to be more responsive
            const RATIO_REQ = 1.5; // lowered from 1.7
            if (absY > 80) {
                if (isDebugRef.current)
                    console.debug('[TT] wheel ignored: too vertical', {
                        absX,
                        absY,
                    });
                return;
            }
            if (absX < HORIZONTAL_MIN || absX <= absY * RATIO_REQ) {
                if (isDebugRef.current)
                    console.debug(
                        '[TT] wheel ignored: insufficient horizontal intent',
                        { absX, absY },
                    );
                return;
            }

            e.preventDefault();
            const direction = sumX > 0 ? 'next' : 'prev';
            hasNavigatedThisWheelChain = true;
            lastWheelNavTime = nowTs;
            const gestureSpeed = Math.min(4200, Math.max(1200, absX * 14));

            // Check if we're in focused day mode
            if (focusedDayRef.current) {
                // Use day navigation instead of week navigation
                performDayNavigation(direction, gestureSpeed);
                if (isDebugRef.current) {
                    console.debug('[TT] wheel day navigation trigger', {
                        direction,
                        focusedDay: focusedDayRef.current,
                        absX,
                        absY,
                        gestureSpeed,
                        samples: recentWheelEvents.length,
                    });
                }
            } else {
                // Standard week navigation
                performNavigation(direction, gestureSpeed);
                if (isDebugRef.current) {
                    console.debug('[TT] wheel week navigation trigger', {
                        direction,
                        absX,
                        absY,
                        gestureSpeed,
                        samples: recentWheelEvents.length,
                    });
                }
            }
        };

        el.addEventListener('touchstart', handleTouchStart, { passive: true });
        el.addEventListener('touchmove', handleTouchMove, { passive: false });
        el.addEventListener('touchend', handleTouchEnd, { passive: true });
        // touchcancel fires on iOS (esp. PWA) when system interrupts (notification, gesture) mid drag
        const handleTouchCancel = () => {
            setIsDragging(false);
            isDraggingRef.current = false;
            setTranslateX(0);
            translateXRef.current = 0;

            // Also reset day view state
            setDayTranslateX(0);
            setIsDayDragging(false);
            isDayDraggingRef.current = false;

            // Reset touch tracking refs to prevent stale gesture state
            touchStartX.current = null;
            touchStartY.current = null;
            touchStartTime.current = null;
            lastMoveXRef.current = null;
            lastMoveTimeRef.current = null;

            skipSwipe = false;
        };
        el.addEventListener('touchcancel', handleTouchCancel, {
            passive: true,
        });
        el.addEventListener('wheel', handleWheel, { passive: false });

        // Expose navigation functions for debug buttons
        triggerNavigationRef.current = (direction: 'prev' | 'next') => {
            performNavigation(direction, 1500); // Use moderate speed for button-triggered navigation
        };
        triggerDayNavigationRef.current = (direction: 'prev' | 'next') => {
            performDayNavigation(direction, 1500);
        };

        return () => {
            el.removeEventListener('touchstart', handleTouchStart);
            el.removeEventListener('touchmove', handleTouchMove);
            el.removeEventListener('touchend', handleTouchEnd);
            el.removeEventListener('touchcancel', handleTouchCancel);
            el.removeEventListener('wheel', handleWheel);
            // Clear navigation refs on cleanup
            triggerNavigationRef.current = null;
            triggerDayNavigationRef.current = null;
            // Use the captured ref value for cleanup
            if (currentAnimationRef) cancelAnimationFrame(currentAnimationRef);
            if (isDebugRef.current) {
                console.debug('[TT] gesture effect cleanup');
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [gestureAttachAttempts, forceGestureReattach, hasData]);

    // Watchdog for stuck animation or leftover translation, plus gesture handler health check
    useEffect(() => {
        const interval = setInterval(() => {
            // Reset stuck animation state
            // Only reset if:
            // 1. Not animating
            // 2. Has non-zero translation
            // 3. Not currently dragging OR dragging has been stale for > 5 seconds (user inactivity)
            const timeSinceLastMove = lastMoveTimeRef.current
                ? performance.now() - lastMoveTimeRef.current
                : 999999;
            const isStaleDrag =
                isDraggingRef.current && timeSinceLastMove > 5000;

            // Reset week view stuck state
            if (
                !isAnimatingRef.current &&
                Math.abs(translateXRef.current) > 2 &&
                (!isDraggingRef.current || isStaleDrag)
            ) {
                setTranslateX(0);
                // If we force reset, ensure drag state is cleared too
                if (isDraggingRef.current) {
                    setIsDragging(false);
                    isDraggingRef.current = false;
                }
                if (isDebugRef.current)
                    console.debug(
                        '[TT] watchdog: corrected non-zero translateX while not animating',
                    );
            }

            // Reset day view stuck state
            const isStaleDayDrag =
                isDayDraggingRef.current && timeSinceLastMove > 5000;
            if (
                !isDayAnimatingRef.current &&
                Math.abs(dayTranslateXRef.current) > 2 &&
                (!isDayDraggingRef.current || isStaleDayDrag)
            ) {
                setDayTranslateX(0);
                if (isDayDraggingRef.current) {
                    setIsDayDragging(false);
                    isDayDraggingRef.current = false;
                }
                if (isDebugRef.current)
                    console.debug(
                        '[TT] watchdog: corrected non-zero dayTranslateX while not animating',
                    );
            }

            // Periodically ensure gesture handlers are attached by forcing re-attachment
            // This helps catch cases where PWA suspend/resume doesn't trigger lifecycle events properly
            // Especially important for trackpad-based PWA closing which may bypass normal event flow
            if (Date.now() % 30000 < 1000) {
                // Every ~30 seconds (when interval fires close to 30s mark)
                setForceGestureReattach((prev) => prev + 1);
                if (isDebugRef.current)
                    console.debug(
                        '[TT] watchdog: periodic gesture reattachment',
                    );
            }
        }, 1000);
        return () => clearInterval(interval);
    }, []);

    // Expose minimal debug snapshot API on window for deeper inspection when user reports being stuck
    useEffect(() => {
        if (!isDebug || typeof window === 'undefined') return;
        window.PeriodixTTDebug = {
            getState: () => ({
                translateX,
                isAnimating,
                isDragging,
                lastNavigationTime: lastNavigationTimeRef.current,
                now: Date.now(),
                gestureAttachAttempts,
                forceGestureReattach,
            }),
            forceReset: () => {
                setTranslateX(0);
                setIsAnimating(false);
                setIsDragging(false);
                return 'reset-done';
            },
            forceGestureReattach: () => {
                setForceGestureReattach((prev) => prev + 1);
                return 'gesture-reattach-forced';
            },
        };
        return () => {
            if (window.PeriodixTTDebug) {
                delete window.PeriodixTTDebug;
            }
        };
    }, [
        isDebug,
        translateX,
        isAnimating,
        isDragging,
        gestureAttachAttempts,
        forceGestureReattach,
    ]);

    const nowMin = now.getHours() * 60 + now.getMinutes();
    const isWithinDay = nowMin >= START_MIN && nowMin <= END_MIN;
    const showNowLine = isCurrentWeek && isWithinDay;
    // When using sticky external header we shrink internal header in columns to 0px
    const internalHeaderPx = 0; // must match DayColumn hideHeader calculation
    const nowY = (nowMin - START_MIN) * SCALE + internalHeaderPx;

    const [hiddenBump, setHiddenBump] = useState(0);
    const lessonsByDay = useMemo(() => {
        void hiddenBump; // tie memo to hidden changes
        // bump to re-read hidden subjects when settings change
        // (updated via custom event listener below)
        // Load hidden subjects set (user-scoped key; legacy support)
        let hiddenSubjects = new Set<string>();
        try {
            const raw = localStorage.getItem('periodix:hiddenSubjects:self');
            if (raw) hiddenSubjects = new Set(JSON.parse(raw));
            else {
                const legacy = localStorage.getItem('hiddenSubjects');
                if (legacy) {
                    localStorage.setItem(
                        'periodix:hiddenSubjects:self',
                        legacy,
                    );
                    hiddenSubjects = new Set(JSON.parse(legacy));
                }
            }
        } catch {
            /* ignore */
        }
        const byDay: Record<string, Lesson[]> = {};
        for (const d of days) byDay[fmtLocal(d)] = [];
        const lessons = Array.isArray(data?.payload)
            ? (data?.payload as Lesson[])
            : [];
        for (const l of lessons) {
            const dStr = yyyymmddToISO(l.date);
            const subj = l.su?.[0]?.name ?? l.activityType ?? '';
            const shouldHide = subj && hiddenSubjects.has(subj);
            if (byDay[dStr] && !shouldHide)
                byDay[dStr].push({
                    ...l,
                    // Only show homework on the day it's due
                    homework: (l.homework || []).filter(
                        (hw) => hw.date === l.date,
                    ),
                });
        }
        for (const k of Object.keys(byDay)) {
            byDay[k].sort(
                (a, b) => a.startTime - b.startTime || a.endTime - b.endTime,
            );
            // Apply lesson merging after sorting
            byDay[k] = mergeLessons(byDay[k]);
        }
        return byDay;
    }, [data?.payload, days, hiddenBump]);

    // Force re-render when hidden subjects change via settings
    useEffect(() => {
        const handler = () => setHiddenBump((v) => v + 1);
        window.addEventListener('periodix:hiddenSubjects:changed', handler);
        return () =>
            window.removeEventListener(
                'periodix:hiddenSubjects:changed',
                handler,
            );
    }, []);

    // Process previous week's data
    const prevWeekLessonsByDay = useMemo(() => {
        void hiddenBump; // tie memo to hidden changes
        let hiddenSubjects = new Set<string>();
        try {
            const raw = localStorage.getItem('periodix:hiddenSubjects:self');
            if (raw) hiddenSubjects = new Set(JSON.parse(raw));
        } catch {
            /* ignore */
        }
        const byDay: Record<string, Lesson[]> = {};
        for (const d of prevWeekDays) byDay[fmtLocal(d)] = [];

        const prevWeekData = getAdjacentWeekData?.('prev');
        const lessons = Array.isArray(prevWeekData?.payload)
            ? (prevWeekData?.payload as Lesson[])
            : [];

        for (const l of lessons) {
            const dStr = yyyymmddToISO(l.date);
            const subj = l.su?.[0]?.name ?? l.activityType ?? '';
            const shouldHide = subj && hiddenSubjects.has(subj);
            if (byDay[dStr] && !shouldHide)
                byDay[dStr].push({
                    ...l,
                    homework: (l.homework || []).filter(
                        (hw) => hw.date === l.date,
                    ),
                });
        }
        for (const k of Object.keys(byDay)) {
            byDay[k].sort(
                (a, b) => a.startTime - b.startTime || a.endTime - b.endTime,
            );
            // Apply lesson merging after sorting
            byDay[k] = mergeLessons(byDay[k]);
        }
        return byDay;
    }, [prevWeekDays, getAdjacentWeekData, hiddenBump]);

    // Process next week's data
    const nextWeekLessonsByDay = useMemo(() => {
        void hiddenBump; // tie memo to hidden changes
        let hiddenSubjects = new Set<string>();
        try {
            const raw = localStorage.getItem('periodix:hiddenSubjects:self');
            if (raw) hiddenSubjects = new Set(JSON.parse(raw));
        } catch {
            /* ignore */
        }
        const byDay: Record<string, Lesson[]> = {};
        for (const d of nextWeekDays) byDay[fmtLocal(d)] = [];

        const nextWeekData = getAdjacentWeekData?.('next');
        const lessons = Array.isArray(nextWeekData?.payload)
            ? (nextWeekData?.payload as Lesson[])
            : [];

        for (const l of lessons) {
            const dStr = yyyymmddToISO(l.date);
            const subj = l.su?.[0]?.name ?? l.activityType ?? '';
            const shouldHide = subj && hiddenSubjects.has(subj);
            if (byDay[dStr] && !shouldHide)
                byDay[dStr].push({
                    ...l,
                    homework: (l.homework || []).filter(
                        (hw) => hw.date === l.date,
                    ),
                });
        }
        for (const k of Object.keys(byDay)) {
            byDay[k].sort(
                (a, b) => a.startTime - b.startTime || a.endTime - b.endTime,
            );
            // Apply lesson merging after sorting
            byDay[k] = mergeLessons(byDay[k]);
        }
        return byDay;
    }, [nextWeekDays, getAdjacentWeekData, hiddenBump]);

    const hasLessons = useMemo(
        () => Object.values(lessonsByDay).some((arr) => arr.length > 0),
        [lessonsByDay],
    );

    // Calculate the maximum number of overlapping lessons across all days in the week
    // This ensures consistent column width/positioning across all days
    const weekMaxColCount = useMemo(
        () => calculateWeekMaxColCount(lessonsByDay, START_MIN, END_MIN),
        [lessonsByDay, START_MIN, END_MIN],
    );

    // Helper to check if a week is a full holiday
    const getWeekHolidayInfo = useCallback(
        (weekDays: Date[]) => {
            if (!holidays.length) return null;

            const getHolidayForDate = (d: Date) => {
                const current = new Date(d);
                current.setHours(0, 0, 0, 0);

                return holidays.find((h) => {
                    const parseUntisDate = (n: number) => {
                        const s = String(n);
                        const y = Number(s.slice(0, 4));
                        const mo = Number(s.slice(4, 6));
                        const day = Number(s.slice(6, 8));
                        return new Date(y, mo - 1, day);
                    };

                    const start = parseUntisDate(h.startDate);
                    const end = parseUntisDate(h.endDate);
                    start.setHours(0, 0, 0, 0);
                    end.setHours(0, 0, 0, 0);
                    return current >= start && current <= end;
                });
            };

            const dayHolidays = weekDays.map((d) => getHolidayForDate(d));
            const allDaysAreHolidays = dayHolidays.every((h) => !!h);

            if (!allDaysAreHolidays) return null;

            const firstHolidayName = dayHolidays[0]?.name;
            const isSameHoliday = dayHolidays.every(
                (h) => h?.name === firstHolidayName,
            );

            return {
                isFullWeek: true,
                isSameHoliday,
                holiday: dayHolidays[0],
            };
        },
        [holidays],
    );

    const weekHolidayInfo = useMemo(
        () => getWeekHolidayInfo(days),
        [days, getWeekHolidayInfo],
    );
    const prevWeekHolidayInfo = useMemo(
        () => getWeekHolidayInfo(prevWeekDays),
        [prevWeekDays, getWeekHolidayInfo],
    );
    const nextWeekHolidayInfo = useMemo(
        () => getWeekHolidayInfo(nextWeekDays),
        [nextWeekDays, getWeekHolidayInfo],
    );

    if (!data) return <TimetableSkeleton />;

    return (
        <div
            ref={containerRef}
            className="relative w-full overflow-x-hidden pt-[env(safe-area-inset-top)] animate-fade-in"
        >
            {isDeveloperModeEnabled && (
                <div className="mb-4 flex justify-end px-2 gap-2 flex-wrap">
                    {/* Navigation debug buttons - only shown when developer mode is active */}
                    {isDeveloperMode && (
                        <>
                            <button
                                type="button"
                                onClick={() => {
                                    if (focusedDay) {
                                        triggerDayNavigationRef.current?.(
                                            'prev',
                                        );
                                    } else {
                                        triggerNavigationRef.current?.('prev');
                                    }
                                }}
                                className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 shadow ring-1 ring-slate-900/10 dark:ring-white/10 bg-emerald-600 text-white hover:bg-emerald-700 transition"
                                aria-label="Navigate to previous"
                            >
                                <svg
                                    className="w-4 h-4"
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                >
                                    <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={2}
                                        d="M15 19l-7-7 7-7"
                                    />
                                </svg>
                                <span className="text-sm font-medium">
                                    Prev
                                </span>
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    if (focusedDay) {
                                        triggerDayNavigationRef.current?.(
                                            'next',
                                        );
                                    } else {
                                        triggerNavigationRef.current?.('next');
                                    }
                                }}
                                className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 shadow ring-1 ring-slate-900/10 dark:ring-white/10 bg-emerald-600 text-white hover:bg-emerald-700 transition"
                                aria-label="Navigate to next"
                            >
                                <span className="text-sm font-medium">
                                    Next
                                </span>
                                <svg
                                    className="w-4 h-4"
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                >
                                    <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        strokeWidth={2}
                                        d="M9 5l7 7-7 7"
                                    />
                                </svg>
                            </button>
                        </>
                    )}
                    <button
                        type="button"
                        onClick={() => setIsDeveloperMode((v) => !v)}
                        className={`group inline-flex items-center gap-2 rounded-full px-3 py-1.5 shadow ring-1 ring-slate-900/10 dark:ring-white/10 transition ${
                            isDeveloperMode
                                ? 'bg-indigo-600 text-white'
                                : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200'
                        }`}
                        aria-pressed={isDeveloperMode}
                        aria-label="Toggle developer mode"
                    >
                        <span
                            className={`relative inline-flex h-5 w-9 items-center rounded-full transition ${
                                isDeveloperMode
                                    ? 'bg-indigo-500'
                                    : 'bg-slate-300 dark:bg-slate-600'
                            }`}
                        >
                            <span
                                className={`absolute left-0 h-5 w-5 rounded-full bg-white dark:bg-slate-200 shadow transform transition-transform duration-200 ${
                                    isDeveloperMode
                                        ? 'translate-x-4'
                                        : 'translate-x-0'
                                }`}
                            />
                        </span>
                        <span className="text-sm font-medium">
                            Developer Mode
                        </span>
                    </button>
                </div>
            )}

            {/* Pull-to-refresh is handled by pulltorefreshjs library - it adds its own UI */}

            {/* Unified horizontal week view (fits viewport width) */}
            {/* Sticky weekday header (separate from columns so it stays visible during vertical scroll) */}
            <div
                className="sticky top-0 z-30 bg-gradient-to-b from-white/85 to-white/60 dark:from-slate-900/85 dark:to-slate-900/60 backdrop-blur supports-[backdrop-filter]:backdrop-blur mb-1"
                style={{
                    paddingRight: 'env(safe-area-inset-right)',
                    paddingLeft: 'env(safe-area-inset-left)',
                }}
            >
                <div
                    className="grid"
                    style={{
                        gridTemplateColumns: `${axisWidth}px repeat(${
                            focusedDay ? 1 : 5
                        }, 1fr)`,
                    }}
                >
                    <div className="h-10 flex items-center justify-center text-[11px] sm:text-xs font-medium text-slate-500 dark:text-slate-400 select-none">
                        <span>Time</span>
                    </div>
                    {(focusedDay
                        ? days.filter((d) => fmtLocal(d) === focusedDay)
                        : days
                    ).map((d) => {
                        const iso = fmtLocal(d);
                        const isToday = iso === todayISO;
                        const isFocused = focusedDay === iso;
                        return (
                            <button
                                key={iso}
                                type="button"
                                aria-pressed={isFocused}
                                onClick={() =>
                                    setFocusedDay((prev) =>
                                        prev === iso ? null : iso,
                                    )
                                }
                                className="h-10 flex flex-col items-center justify-center py-1 transition-colors rounded-md outline-none hover:bg-slate-200/60 dark:hover:bg-slate-700/40 focus-visible:ring-2 focus-visible:ring-slate-400/60 dark:focus-visible:ring-slate-500/60"
                            >
                                <div
                                    className={`text-[11px] sm:text-xs font-semibold leading-tight ${
                                        isToday
                                            ? 'text-amber-700 dark:text-amber-300'
                                            : 'text-slate-700 dark:text-slate-200'
                                    }`}
                                >
                                    {d.toLocaleDateString(undefined, {
                                        weekday: 'short',
                                    })}
                                </div>
                                <div
                                    className={`text-[10px] sm:text-[11px] font-medium ${
                                        isToday
                                            ? 'text-amber-600 dark:text-amber-200'
                                            : 'text-slate-500 dark:text-slate-400'
                                    }`}
                                >
                                    {d.toLocaleDateString(undefined, {
                                        day: '2-digit',
                                        month: '2-digit',
                                    })}
                                </div>
                            </button>
                        );
                    })}
                </div>
                {/* Removed extra informational text under the day header in focused mode */}
            </div>

            <div className="overflow-hidden w-full pr-0.5 sm:pr-0">
                {/* When focusedDay is active, render 3-panel sliding day view */}
                {focusedDay ? (
                    <div className="flex w-full relative">
                        <div style={{ width: `${axisWidth}px` }}>
                            <TimeAxis
                                START_MIN={START_MIN}
                                END_MIN={END_MIN}
                                SCALE={SCALE}
                                DAY_HEADER_PX={DAY_HEADER_PX}
                                BOTTOM_PAD_PX={BOTTOM_PAD_PX}
                                internalHeaderPx={internalHeaderPx}
                            />
                        </div>
                        {/* 3-panel sliding track for smooth day navigation */}
                        <div className="flex-1 overflow-hidden relative">
                            {isDayDragging && (
                                <div className="absolute inset-0 bg-black/5 dark:bg-white/5 z-20 pointer-events-none transition-opacity duration-150" />
                            )}
                            <div
                                className="flex"
                                style={{
                                    transform: `translateX(calc(-33.333% + ${dayTranslateX}px))`,
                                    width: '300%',
                                    transition: 'none',
                                }}
                            >
                                {/* Previous Day Panel */}
                                <div
                                    className="relative"
                                    style={{ width: 'calc(33.333%)' }}
                                >
                                    {(() => {
                                        const currentDayDate = new Date(
                                            focusedDay,
                                        );
                                        const prevDayDate =
                                            getPreviousWorkday(currentDayDate);
                                        const prevDayStr =
                                            fmtLocal(prevDayDate);
                                        const prevDayWeek =
                                            startOfWeek(prevDayDate);
                                        const currentWeek =
                                            startOfWeek(weekStart);
                                        const isSameWeek =
                                            fmtLocal(prevDayWeek) ===
                                            fmtLocal(currentWeek);

                                        // Get lessons from appropriate week data
                                        let items: Lesson[] = [];
                                        if (isSameWeek) {
                                            items =
                                                lessonsByDay[prevDayStr] || [];
                                        } else {
                                            items =
                                                prevWeekLessonsByDay[
                                                    prevDayStr
                                                ] || [];
                                        }

                                        const isToday = prevDayStr === todayISO;
                                        return (
                                            <div className="relative h-full">
                                                {/* Current time line for prev day if it's today */}
                                                {showNowLine && isToday && (
                                                    <div
                                                        aria-hidden
                                                        className="pointer-events-none absolute -translate-y-1/2 z-50 left-0 right-0"
                                                        style={{ top: nowY }}
                                                    >
                                                        <div className="relative w-full">
                                                            <div className="h-[1px] w-full bg-gradient-to-r from-rose-500 via-fuchsia-500 to-pink-500 shadow-[0_0_4px_rgba(244,63,94,0.4)] -translate-y-1/2" />
                                                            <div className="absolute top-0 h-[3px] -translate-y-1/2 left-0 right-0 bg-gradient-to-r from-rose-500 via-fuchsia-500 to-pink-500" />
                                                            <div className="absolute -top-[15px] left-2">
                                                                <span
                                                                    className="rounded-full bg-rose-500/95 px-1 py-[1px] text-[10px] font-semibold text-white shadow-lg"
                                                                    style={{
                                                                        filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.3))',
                                                                    }}
                                                                >
                                                                    {fmtHM(
                                                                        nowMin,
                                                                    )}
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                )}
                                                <DayColumn
                                                    day={prevDayDate}
                                                    keyStr={prevDayStr}
                                                    items={items}
                                                    holidays={holidays}
                                                    START_MIN={START_MIN}
                                                    END_MIN={END_MIN}
                                                    SCALE={SCALE}
                                                    DAY_HEADER_PX={
                                                        DAY_HEADER_PX
                                                    }
                                                    BOTTOM_PAD_PX={
                                                        BOTTOM_PAD_PX
                                                    }
                                                    lessonColors={lessonColors}
                                                    defaultLessonColors={
                                                        defaultLessonColors
                                                    }
                                                    onLessonClick={
                                                        handleLessonClick
                                                    }
                                                    isToday={isToday}
                                                    gradientOffsets={
                                                        gradientOffsets
                                                    }
                                                    hideHeader
                                                    isDeveloperMode={
                                                        isDeveloperMode
                                                    }
                                                    isClassTimetable={
                                                        isClassView
                                                    }
                                                    estimatedWidth={
                                                        estimatedFocusedDayWidth
                                                    }
                                                    weekMaxColCount={
                                                        weekMaxColCount
                                                    }
                                                    isDayView
                                                />
                                            </div>
                                        );
                                    })()}
                                </div>

                                {/* Current Day Panel */}
                                <div
                                    className="relative"
                                    style={{ width: 'calc(33.333%)' }}
                                >
                                    {(() => {
                                        const dayObj =
                                            days.find(
                                                (d) =>
                                                    fmtLocal(d) === focusedDay,
                                            ) || new Date(focusedDay);
                                        const key = fmtLocal(dayObj);
                                        const items = lessonsByDay[key] || [];
                                        const isToday = key === todayISO;
                                        return (
                                            <div className="relative h-full">
                                                {/* Current time line overlay for focused day */}
                                                {showNowLine && isToday && (
                                                    <div
                                                        aria-hidden
                                                        className="pointer-events-none absolute -translate-y-1/2 z-50 left-0 right-0"
                                                        style={{ top: nowY }}
                                                    >
                                                        <div className="relative w-full">
                                                            <div className="h-[1px] w-full bg-gradient-to-r from-rose-500 via-fuchsia-500 to-pink-500 shadow-[0_0_4px_rgba(244,63,94,0.4)] -translate-y-1/2" />
                                                            <div className="absolute top-0 h-[3px] -translate-y-1/2 left-0 right-0 bg-gradient-to-r from-rose-500 via-fuchsia-500 to-pink-500" />
                                                            <div className="absolute -top-[15px] left-2">
                                                                <span
                                                                    className="rounded-full bg-rose-500/95 px-1 py-[1px] text-[10px] font-semibold text-white shadow-lg"
                                                                    style={{
                                                                        filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.3))',
                                                                    }}
                                                                >
                                                                    {fmtHM(
                                                                        nowMin,
                                                                    )}
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                )}
                                                <DayColumn
                                                    day={
                                                        dayObj instanceof Date
                                                            ? dayObj
                                                            : new Date(dayObj)
                                                    }
                                                    keyStr={key}
                                                    items={items}
                                                    holidays={holidays}
                                                    START_MIN={START_MIN}
                                                    END_MIN={END_MIN}
                                                    SCALE={SCALE}
                                                    DAY_HEADER_PX={
                                                        DAY_HEADER_PX
                                                    }
                                                    BOTTOM_PAD_PX={
                                                        BOTTOM_PAD_PX
                                                    }
                                                    lessonColors={lessonColors}
                                                    defaultLessonColors={
                                                        defaultLessonColors
                                                    }
                                                    onLessonClick={
                                                        handleLessonClick
                                                    }
                                                    isToday={isToday}
                                                    gradientOffsets={
                                                        gradientOffsets
                                                    }
                                                    hideHeader
                                                    isDeveloperMode={
                                                        isDeveloperMode
                                                    }
                                                    isClassTimetable={
                                                        isClassView
                                                    }
                                                    estimatedWidth={
                                                        estimatedFocusedDayWidth
                                                    }
                                                    weekMaxColCount={
                                                        weekMaxColCount
                                                    }
                                                    isDayView
                                                />
                                                {!items.length && (
                                                    <div className="absolute inset-0 flex items-center justify-center z-40">
                                                        <div className="bg-white/90 dark:bg-slate-900/90 backdrop-blur-sm rounded-lg border border-dashed border-slate-300 dark:border-slate-600 p-6 text-center text-slate-600 dark:text-slate-300 shadow-lg">
                                                            No lessons for this
                                                            day.
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })()}
                                </div>

                                {/* Next Day Panel */}
                                <div
                                    className="relative"
                                    style={{ width: 'calc(33.333%)' }}
                                >
                                    {(() => {
                                        const currentDayDate = new Date(
                                            focusedDay,
                                        );
                                        const nextDayDate =
                                            getNextWorkday(currentDayDate);
                                        const nextDayStr =
                                            fmtLocal(nextDayDate);
                                        const nextDayWeek =
                                            startOfWeek(nextDayDate);
                                        const currentWeek =
                                            startOfWeek(weekStart);
                                        const isSameWeek =
                                            fmtLocal(nextDayWeek) ===
                                            fmtLocal(currentWeek);

                                        // Get lessons from appropriate week data
                                        let items: Lesson[] = [];
                                        if (isSameWeek) {
                                            items =
                                                lessonsByDay[nextDayStr] || [];
                                        } else {
                                            items =
                                                nextWeekLessonsByDay[
                                                    nextDayStr
                                                ] || [];
                                        }

                                        const isToday = nextDayStr === todayISO;
                                        return (
                                            <div className="relative h-full">
                                                {/* Current time line for next day if it's today */}
                                                {showNowLine && isToday && (
                                                    <div
                                                        aria-hidden
                                                        className="pointer-events-none absolute -translate-y-1/2 z-50 left-0 right-0"
                                                        style={{ top: nowY }}
                                                    >
                                                        <div className="relative w-full">
                                                            <div className="h-[1px] w-full bg-gradient-to-r from-rose-500 via-fuchsia-500 to-pink-500 shadow-[0_0_4px_rgba(244,63,94,0.4)] -translate-y-1/2" />
                                                            <div className="absolute top-0 h-[3px] -translate-y-1/2 left-0 right-0 bg-gradient-to-r from-rose-500 via-fuchsia-500 to-pink-500" />
                                                            <div className="absolute -top-[15px] left-2">
                                                                <span
                                                                    className="rounded-full bg-rose-500/95 px-1 py-[1px] text-[10px] font-semibold text-white shadow-lg"
                                                                    style={{
                                                                        filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.3))',
                                                                    }}
                                                                >
                                                                    {fmtHM(
                                                                        nowMin,
                                                                    )}
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                )}
                                                <DayColumn
                                                    day={nextDayDate}
                                                    keyStr={nextDayStr}
                                                    items={items}
                                                    holidays={holidays}
                                                    START_MIN={START_MIN}
                                                    END_MIN={END_MIN}
                                                    SCALE={SCALE}
                                                    DAY_HEADER_PX={
                                                        DAY_HEADER_PX
                                                    }
                                                    BOTTOM_PAD_PX={
                                                        BOTTOM_PAD_PX
                                                    }
                                                    lessonColors={lessonColors}
                                                    defaultLessonColors={
                                                        defaultLessonColors
                                                    }
                                                    onLessonClick={
                                                        handleLessonClick
                                                    }
                                                    isToday={isToday}
                                                    gradientOffsets={
                                                        gradientOffsets
                                                    }
                                                    hideHeader
                                                    isDeveloperMode={
                                                        isDeveloperMode
                                                    }
                                                    isClassTimetable={
                                                        isClassView
                                                    }
                                                    estimatedWidth={
                                                        estimatedFocusedDayWidth
                                                    }
                                                    weekMaxColCount={
                                                        weekMaxColCount
                                                    }
                                                    isDayView
                                                />
                                            </div>
                                        );
                                    })()}
                                </div>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="flex w-full relative">
                        {/* Fixed TimeAxis - stays in place */}
                        <div style={{ width: `${axisWidth}px` }}>
                            <TimeAxis
                                START_MIN={START_MIN}
                                END_MIN={END_MIN}
                                SCALE={SCALE}
                                DAY_HEADER_PX={DAY_HEADER_PX}
                                BOTTOM_PAD_PX={BOTTOM_PAD_PX}
                                internalHeaderPx={internalHeaderPx}
                            />
                        </div>

                        {/* Current time line overlay - moved outside overflow-hidden container */}
                        {showNowLine && (
                            <div
                                aria-hidden
                                className="pointer-events-none absolute top-0 bottom-0 z-50"
                                style={{
                                    left: `${axisWidth}px`,
                                    right: 0,
                                    overflow: 'visible',
                                }}
                            >
                                <div
                                    className="relative h-full"
                                    style={{
                                        transform: `translateX(${translateX}px)`,
                                    }}
                                >
                                    <div
                                        className="absolute w-full"
                                        style={{ top: nowY }}
                                    >
                                        <div className="relative w-full">
                                            <div className="h-[1px] w-full bg-gradient-to-r from-rose-500 via-fuchsia-500 to-pink-500 shadow-[0_0_4px_rgba(244,63,94,0.4)] -translate-y-1/2" />
                                            <div
                                                className="absolute top-0 h-[3px] -translate-y-1/2"
                                                style={{
                                                    left: `${
                                                        (days.findIndex(
                                                            (d) =>
                                                                fmtLocal(d) ===
                                                                todayISO,
                                                        ) /
                                                            5) *
                                                        100
                                                    }%`,
                                                    width: '20%',
                                                    background: `linear-gradient(to right, transparent 0%, rgba(244,63,94,0.3) 2%, rgb(244,63,94) 8%, rgb(217,70,239) 50%, rgb(236,72,153) 92%, rgba(236,72,153,0.3) 98%, transparent 100%)`,
                                                    filter: 'drop-shadow(0 0 6px rgba(244,63,94,0.6))',
                                                }}
                                            />
                                            <div
                                                className="absolute top-0 h-[5px] -translate-y-1/2 opacity-40"
                                                style={{
                                                    left: `${
                                                        (days.findIndex(
                                                            (d) =>
                                                                fmtLocal(d) ===
                                                                todayISO,
                                                        ) /
                                                            5) *
                                                        100
                                                    }%`,
                                                    width: '20%',
                                                    background: `linear-gradient(to right, transparent 0%, rgba(244,63,94,0.1) 5%, rgba(244,63,94,0.6) 50%, rgba(244,63,94,0.1) 95%, transparent 100%)`,
                                                    filter: 'blur(1px)',
                                                }}
                                            />
                                            <div
                                                className="absolute top-1/2 -translate-y-1/2"
                                                style={{
                                                    left: `${
                                                        (days.findIndex(
                                                            (d) =>
                                                                fmtLocal(d) ===
                                                                todayISO,
                                                        ) /
                                                            5) *
                                                        100
                                                    }%`,
                                                }}
                                            >
                                                <div className="absolute -top-[15px] -translate-x-1/2 whitespace-nowrap">
                                                    <span
                                                        className="rounded-full bg-rose-500/95 px-1 py-[1px] text-[10px] font-semibold text-white shadow-lg"
                                                        style={{
                                                            filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.3))',
                                                        }}
                                                    >
                                                        {fmtHM(nowMin)}
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Original sliding container for week navigation */}
                        <div className="flex-1 overflow-hidden relative">
                            {isDragging && (
                                <div className="absolute inset-0 bg-black/5 dark:bg-white/5 z-20 pointer-events-none transition-opacity duration-150" />
                            )}
                            <div
                                ref={slidingTrackRef}
                                className="flex"
                                style={{
                                    transform: `translateX(calc(-33.333% + ${translateX}px))`,
                                    width: '300%',
                                    transition: 'none',
                                    gap: '0.25rem',
                                }}
                            >
                                {/* Previous Week */}
                                <div
                                    className="flex gap-x-px sm:gap-x-1 relative"
                                    style={{ width: 'calc(33.333% - 0.17rem)' }}
                                >
                                    {isPrevWeekCurrent && (
                                        <div
                                            className={`absolute -inset-1.5 z-0 pointer-events-none rounded-2xl transition-opacity duration-500 ${
                                                isHighlightVisible
                                                    ? 'opacity-100'
                                                    : 'opacity-0'
                                            } bg-orange-200/40 dark:bg-orange-500/20 ring-2 ring-orange-400/50 dark:ring-orange-500/30`}
                                        />
                                    )}
                                    {prevWeekDays.map((d) => {
                                        const key = fmtLocal(d);
                                        const items =
                                            prevWeekLessonsByDay[key] || [];
                                        return (
                                            <div key={key} className="flex-1">
                                                <DayColumn
                                                    day={d}
                                                    keyStr={key}
                                                    items={items}
                                                    holidays={holidays}
                                                    START_MIN={START_MIN}
                                                    END_MIN={END_MIN}
                                                    SCALE={SCALE}
                                                    DAY_HEADER_PX={
                                                        DAY_HEADER_PX
                                                    }
                                                    BOTTOM_PAD_PX={
                                                        BOTTOM_PAD_PX
                                                    }
                                                    lessonColors={lessonColors}
                                                    defaultLessonColors={
                                                        defaultLessonColors
                                                    }
                                                    onLessonClick={
                                                        handleLessonClick
                                                    }
                                                    isToday={false}
                                                    gradientOffsets={
                                                        gradientOffsets
                                                    }
                                                    hideHeader
                                                    isDeveloperMode={
                                                        isDeveloperMode
                                                    }
                                                    isClassTimetable={
                                                        isClassView
                                                    }
                                                    suppressHolidayBanner={
                                                        prevWeekHolidayInfo?.isSameHoliday
                                                    }
                                                    onHolidayClick={
                                                        handleHolidayClick
                                                    }
                                                    estimatedWidth={
                                                        estimatedDayWidth
                                                    }
                                                    weekMaxColCount={
                                                        weekMaxColCount
                                                    }
                                                />
                                            </div>
                                        );
                                    })}
                                    {prevWeekHolidayInfo?.isSameHoliday &&
                                        prevWeekHolidayInfo.holiday && (
                                            <div
                                                className="absolute inset-0 z-40 flex items-center justify-center p-4 cursor-pointer"
                                                onClick={() =>
                                                    handleHolidayClick(
                                                        prevWeekHolidayInfo.holiday!,
                                                    )
                                                }
                                            >
                                                <div className="absolute inset-0 bg-yellow-50/60 dark:bg-yellow-900/30 backdrop-blur-[1px] rounded-xl" />
                                                <div className="relative bg-white/80 dark:bg-black/40 p-6 rounded-2xl shadow-sm ring-1 ring-black/5 dark:ring-white/5 backdrop-blur-md max-w-md text-center">
                                                    <h3 className="text-xl font-bold text-yellow-900 dark:text-yellow-100 leading-tight mb-2">
                                                        {
                                                            prevWeekHolidayInfo
                                                                .holiday
                                                                .longName
                                                        }
                                                    </h3>
                                                    {prevWeekHolidayInfo.holiday
                                                        .name !==
                                                        prevWeekHolidayInfo
                                                            .holiday
                                                            .longName && (
                                                        <p className="text-base font-medium text-yellow-800 dark:text-yellow-200">
                                                            {
                                                                prevWeekHolidayInfo
                                                                    .holiday
                                                                    .name
                                                            }
                                                        </p>
                                                    )}
                                                </div>
                                            </div>
                                        )}
                                </div>
                                {/* Current Week */}
                                <div
                                    className="flex gap-x-px sm:gap-x-1 relative"
                                    style={{ width: 'calc(33.333% - 0.17rem)' }}
                                >
                                    {isCurrentWeek && (
                                        <div
                                            className={`absolute -inset-1.5 z-0 pointer-events-none rounded-2xl transition-opacity duration-500 ${
                                                isHighlightVisible
                                                    ? 'opacity-100'
                                                    : 'opacity-0'
                                            } bg-orange-200/40 dark:bg-orange-500/20 ring-2 ring-orange-400/50 dark:ring-orange-500/30`}
                                        />
                                    )}
                                    {/* Current time line moved to parent container */}

                                    {days.map((d) => {
                                        const key = fmtLocal(d);
                                        const items = lessonsByDay[key] || [];
                                        const isToday = key === todayISO;
                                        return (
                                            <div key={key} className="flex-1">
                                                <DayColumn
                                                    day={d}
                                                    keyStr={key}
                                                    items={items}
                                                    holidays={holidays}
                                                    START_MIN={START_MIN}
                                                    END_MIN={END_MIN}
                                                    SCALE={SCALE}
                                                    DAY_HEADER_PX={
                                                        DAY_HEADER_PX
                                                    }
                                                    BOTTOM_PAD_PX={
                                                        BOTTOM_PAD_PX
                                                    }
                                                    lessonColors={lessonColors}
                                                    defaultLessonColors={
                                                        defaultLessonColors
                                                    }
                                                    onLessonClick={
                                                        handleLessonClick
                                                    }
                                                    isToday={isToday}
                                                    gradientOffsets={
                                                        gradientOffsets
                                                    }
                                                    hideHeader
                                                    isDeveloperMode={
                                                        isDeveloperMode
                                                    }
                                                    suppressHolidayBanner={
                                                        weekHolidayInfo?.isSameHoliday
                                                    }
                                                    isClassTimetable={
                                                        isClassView
                                                    }
                                                    onHolidayClick={
                                                        handleHolidayClick
                                                    }
                                                    estimatedWidth={
                                                        estimatedDayWidth
                                                    }
                                                    weekMaxColCount={
                                                        weekMaxColCount
                                                    }
                                                />
                                            </div>
                                        );
                                    })}
                                    {!hasLessons &&
                                        !weekHolidayInfo?.isFullWeek &&
                                        !isRateLimited && (
                                            <div className="absolute inset-0 flex items-center justify-center z-50">
                                                <div className="bg-white/90 dark:bg-slate-900/90 backdrop-blur-sm rounded-lg border border-dashed border-slate-300 dark:border-slate-600 p-6 text-center text-slate-600 dark:text-slate-300 shadow-lg">
                                                    No timetable for this week.
                                                </div>
                                            </div>
                                        )}
                                    {weekHolidayInfo?.isSameHoliday &&
                                        weekHolidayInfo.holiday && (
                                            <div
                                                className="absolute inset-0 z-40 flex items-center justify-center p-4 cursor-pointer"
                                                onClick={() =>
                                                    handleHolidayClick(
                                                        weekHolidayInfo.holiday!,
                                                    )
                                                }
                                            >
                                                <div className="absolute inset-0 bg-yellow-50/60 dark:bg-yellow-900/30 backdrop-blur-[1px] rounded-xl" />
                                                <div className="relative bg-white/80 dark:bg-black/40 p-6 rounded-2xl shadow-sm ring-1 ring-black/5 dark:ring-white/5 backdrop-blur-md max-w-md text-center">
                                                    <h3 className="text-xl font-bold text-yellow-900 dark:text-yellow-100 leading-tight mb-2">
                                                        {
                                                            weekHolidayInfo
                                                                .holiday
                                                                .longName
                                                        }
                                                    </h3>
                                                    {weekHolidayInfo.holiday
                                                        .name !==
                                                        weekHolidayInfo.holiday
                                                            .longName && (
                                                        <p className="text-base font-medium text-yellow-800 dark:text-yellow-200">
                                                            {
                                                                weekHolidayInfo
                                                                    .holiday
                                                                    .name
                                                            }
                                                        </p>
                                                    )}
                                                </div>
                                            </div>
                                        )}
                                </div>
                                {/* Next Week */}
                                <div
                                    className="flex gap-x-px sm:gap-x-1 relative"
                                    style={{ width: 'calc(33.333% - 0.17rem)' }}
                                >
                                    {isNextWeekCurrent && (
                                        <div
                                            className={`absolute -inset-1.5 z-0 pointer-events-none rounded-2xl transition-opacity duration-500 ${
                                                isHighlightVisible
                                                    ? 'opacity-100'
                                                    : 'opacity-0'
                                            } bg-orange-200/40 dark:bg-orange-500/20 ring-2 ring-orange-400/50 dark:ring-orange-500/30`}
                                        />
                                    )}
                                    {nextWeekDays.map((d) => {
                                        const key = fmtLocal(d);
                                        const items =
                                            nextWeekLessonsByDay[key] || [];
                                        return (
                                            <div key={key} className="flex-1">
                                                <DayColumn
                                                    day={d}
                                                    keyStr={key}
                                                    items={items}
                                                    holidays={holidays}
                                                    START_MIN={START_MIN}
                                                    END_MIN={END_MIN}
                                                    SCALE={SCALE}
                                                    DAY_HEADER_PX={
                                                        DAY_HEADER_PX
                                                    }
                                                    BOTTOM_PAD_PX={
                                                        BOTTOM_PAD_PX
                                                    }
                                                    lessonColors={lessonColors}
                                                    defaultLessonColors={
                                                        defaultLessonColors
                                                    }
                                                    onLessonClick={
                                                        handleLessonClick
                                                    }
                                                    isToday={false}
                                                    gradientOffsets={
                                                        gradientOffsets
                                                    }
                                                    hideHeader
                                                    isDeveloperMode={
                                                        isDeveloperMode
                                                    }
                                                    isClassTimetable={
                                                        isClassView
                                                    }
                                                    suppressHolidayBanner={
                                                        nextWeekHolidayInfo?.isSameHoliday
                                                    }
                                                    onHolidayClick={
                                                        handleHolidayClick
                                                    }
                                                    estimatedWidth={
                                                        estimatedDayWidth
                                                    }
                                                    weekMaxColCount={
                                                        weekMaxColCount
                                                    }
                                                />
                                            </div>
                                        );
                                    })}
                                    {nextWeekHolidayInfo?.isSameHoliday &&
                                        nextWeekHolidayInfo.holiday && (
                                            <div
                                                className="absolute inset-0 z-40 flex items-center justify-center p-4 cursor-pointer"
                                                onClick={() =>
                                                    handleHolidayClick(
                                                        nextWeekHolidayInfo.holiday!,
                                                    )
                                                }
                                            >
                                                <div className="absolute inset-0 bg-yellow-50/60 dark:bg-yellow-900/30 backdrop-blur-[1px] rounded-xl" />
                                                <div className="relative bg-white/80 dark:bg-black/40 p-6 rounded-2xl shadow-sm ring-1 ring-black/5 dark:ring-white/5 backdrop-blur-md max-w-md text-center">
                                                    <h3 className="text-xl font-bold text-yellow-900 dark:text-yellow-100 leading-tight mb-2">
                                                        {
                                                            nextWeekHolidayInfo
                                                                .holiday
                                                                .longName
                                                        }
                                                    </h3>
                                                    {nextWeekHolidayInfo.holiday
                                                        .name !==
                                                        nextWeekHolidayInfo
                                                            .holiday
                                                            .longName && (
                                                        <p className="text-base font-medium text-yellow-800 dark:text-yellow-200">
                                                            {
                                                                nextWeekHolidayInfo
                                                                    .holiday
                                                                    .name
                                                            }
                                                        </p>
                                                    )}
                                                </div>
                                            </div>
                                        )}
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            <LessonModal
                lesson={selectedLesson}
                lessonGroup={selectedGroup ?? undefined}
                initialIndex={selectedIndexInGroup}
                isOpen={isModalOpen}
                onClose={() => {
                    setIsModalOpen(false);
                    setSelectedLesson(null);
                    setSelectedGroup(null);
                    setSelectedIndexInGroup(0);

                    // Notify onboarding if active (global callback)
                    if (
                        typeof (
                            window as Window &
                                typeof globalThis & {
                                    onboardingLessonModalStateChange?: (
                                        isOpen: boolean,
                                    ) => void;
                                }
                        ).onboardingLessonModalStateChange === 'function'
                    ) {
                        (
                            window as Window &
                                typeof globalThis & {
                                    onboardingLessonModalStateChange: (
                                        isOpen: boolean,
                                    ) => void;
                                }
                        ).onboardingLessonModalStateChange(false);
                    }

                    // Notify parent component (Dashboard) for onboarding
                    if (onLessonModalStateChange) {
                        onLessonModalStateChange(false);
                    }
                }}
                isDeveloperMode={isDeveloperMode}
                lessonColors={lessonColors}
                defaultLessonColors={defaultLessonColors}
                isAdmin={isAdmin}
                onColorChange={onColorChange}
                gradientOffsets={gradientOffsets}
                onGradientOffsetChange={updateGradientOffset}
                isOnboardingActive={isOnboardingActive}
            />
            <HolidayModal
                holiday={selectedHoliday}
                isOpen={isHolidayModalOpen}
                onClose={() => setIsHolidayModalOpen(false)}
            />
        </div>
    );
}
