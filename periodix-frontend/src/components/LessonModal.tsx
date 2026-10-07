import { useCallback, useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { Lesson, LessonColors } from '../types';
import { DevJsonPanel } from './lesson-modal/DevJsonPanel';
import { HomeworkList, ExamsList } from './lesson-modal/HomeworkList';
import { ColorCustomization } from './lesson-modal/ColorCustomization';
import {
    LessonInfoBlocks,
    LessonStatus,
    LessonInfoMessage,
} from './lesson-modal/InfoBlocks';

export default function LessonModal({
    lesson,
    lessonGroup,
    initialIndex,
    isOpen,
    onClose,
    isDeveloperMode,
    lessonColors,
    defaultLessonColors,
    isAdmin,
    onColorChange,
    gradientOffsets,
    onGradientOffsetChange,
    isOnboardingActive,
    showClasses = false,
}: {
    lesson: Lesson | null;
    // Optional: group of overlapping lessons to present as tabs
    lessonGroup?: Lesson[];
    // Optional: which lesson in the group should be active initially
    initialIndex?: number;
    isOpen: boolean;
    onClose: () => void;
    isDeveloperMode: boolean;
    lessonColors?: LessonColors;
    defaultLessonColors?: LessonColors;
    isAdmin?: boolean;
    onColorChange?: (
        lessonName: string,
        color: string | null,
        offset?: number
    ) => void;
    gradientOffsets?: Record<string, number>;
    onGradientOffsetChange?: (lessonName: string, offset: number) => void;
    isOnboardingActive?: boolean;
    showClasses?: boolean;
}) {
    const [animatingOut, setAnimatingOut] = useState(false);
    const [entered, setEntered] = useState(false);
    const [copied, setCopied] = useState(false);
    const [activeIndex, setActiveIndex] = useState<number>(initialIndex ?? 0);
    const tabListRef = useRef<HTMLDivElement | null>(null);
    const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

    // Keep active tab in sync when opened with a different target
    useEffect(() => {
        if (isOpen) setActiveIndex(initialIndex ?? 0);
    }, [isOpen, initialIndex]);

    // Auto-scroll the active tab into view on open and when switching
    useEffect(() => {
        if (!isOpen) return;
        const container = tabListRef.current;
        const el = tabRefs.current[activeIndex] ?? null;
        if (!container || !el) return;
        // Center the active tab within the scroll container
        const elCenter = el.offsetLeft + el.offsetWidth / 2;
        const target = Math.max(0, elCenter - container.clientWidth / 2);
        try {
            container.scrollTo({ left: target, behavior: 'smooth' });
        } catch {
            container.scrollLeft = target;
        }
    }, [activeIndex, isOpen]);

    const lockScroll = () => {
        document.documentElement.classList.add('modal-open');
    };
    const unlockScroll = () => {
        document.documentElement.classList.remove('modal-open');
    };

    const shouldRender = isOpen || animatingOut;

    useEffect(() => {
        let raf1: number | null = null;
        let raf2: number | null = null;
        if (isOpen) {
            setAnimatingOut(false);
            setEntered(false); // ensure starting state for transition
            lockScroll();
            // Use double rAF to guarantee initial styles are committed before transition (Firefox smoothness)
            raf1 = requestAnimationFrame(() => {
                raf2 = requestAnimationFrame(() => setEntered(true));
            });
        } else {
            // If modal is programmatically hidden without close animation
            if (!animatingOut) {
                unlockScroll();
            }
        }
        return () => {
            if (raf1) cancelAnimationFrame(raf1);
            if (raf2) cancelAnimationFrame(raf2);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen]);

    const handleClose = useCallback(() => {
        setEntered(false);
        setAnimatingOut(true);
        setTimeout(() => {
            setAnimatingOut(false);
            unlockScroll();
            onClose();
        }, 200);
    }, [onClose]);

    useEffect(() => {
        const handleEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') handleClose();
        };
        if (shouldRender) document.addEventListener('keydown', handleEscape);
        return () => document.removeEventListener('keydown', handleEscape);
    }, [shouldRender, handleClose]);

    // Determine the current lesson to display (tabbed or single)
    const lessonsArray =
        lessonGroup && lessonGroup.length > 0
            ? lessonGroup
            : lesson
            ? [lesson]
            : [];
    const currentLesson = lessonsArray[activeIndex] ?? lesson ?? null;

    if (!shouldRender || !currentLesson) return null;

    const copyToClipboard = async (text: string) => {
        try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch (err) {
            console.error('Failed to copy: ', err);
        }
    };

    const cancelled = currentLesson.code === 'cancelled';

    return createPortal(
        <div
            className={`fixed inset-0 z-[9999] modal-portal flex items-center justify-center p-4 bg-black/50 ${
                isOnboardingActive
                    ? 'backdrop-blur-sm backdrop-saturate-100 backdrop-contrast-100'
                    : 'backdrop-blur-lg backdrop-saturate-150 backdrop-contrast-125'
            } transition-opacity duration-200 ease-out ${
                entered ? 'opacity-100' : 'opacity-0'
            }`}
            onClick={handleClose}
        >
            <div
                className={`relative w-full max-w-2xl max-h-[85vh] overflow-y-auto no-native-scrollbar rounded-2xl shadow-2xl ring-1 ring-black/10 dark:ring-white/10 bg-white/75 dark:bg-slate-900/80 backdrop-blur-md transition-all duration-200 ease-out will-change-transform will-change-opacity ${
                    entered
                        ? 'opacity-100 translate-y-0'
                        : 'opacity-0 translate-y-2'
                }`}
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
            >
                <div className="flex items-center justify-between p-6 border-b border-slate-200/60 dark:border-slate-700/60 bg-gradient-to-r from-slate-50/60 to-white/30 dark:from-slate-800/60 dark:to-slate-900/30 rounded-t-2xl">
                    <div className="flex-1 min-w-0">
                        <h2 className="text-xl font-semibold text-slate-900 dark:text-slate-100 truncate">
                            {isDeveloperMode
                                ? 'Lesson Data (Developer Mode)'
                                : 'Lesson Details'}
                        </h2>
                        {/* Tabs for overlapping lessons */}
                        {lessonsArray.length > 1 && (
                            <div className="mt-2 -mb-2">
                                <div
                                    role="tablist"
                                    aria-label="Overlapping lessons"
                                    className="flex items-end gap-2 overflow-x-auto scroll-area-native pr-1 border-b border-slate-200/60 dark:border-slate-700/60"
                                    ref={tabListRef}
                                >
                                    {lessonsArray.map((lsn, idx) => {
                                        const subj =
                                            lsn.su?.[0]?.name ??
                                            lsn.activityType ??
                                            '—';
                                        const room =
                                            lsn.ro
                                                ?.map((r) => r.name)
                                                .join(', ') || '';
                                        const label = room
                                            ? `${subj} · ${room}`
                                            : subj;
                                        const isActive = idx === activeIndex;
                                        return (
                                            <button
                                                key={`${lsn.id}-${idx}`}
                                                id={`lesson-tab-${idx}`}
                                                role="tab"
                                                aria-selected={isActive}
                                                aria-controls={`lesson-tabpanel-${idx}`}
                                                onClick={() =>
                                                    setActiveIndex(idx)
                                                }
                                                ref={(node) => {
                                                    tabRefs.current[idx] = node;
                                                }}
                                                className={`relative shrink-0 max-w-[68vw] sm:max-w-[260px] px-1.5 sm:px-2.5 py-2 text-[11px] sm:text-sm font-medium whitespace-nowrap border-b-2 transition-colors outline-none ${
                                                    isActive
                                                        ? 'text-slate-900 dark:text-white border-indigo-600'
                                                        : 'text-slate-600 dark:text-slate-300 border-transparent hover:text-slate-900 dark:hover:text-white'
                                                }`}
                                                title={`${subj}${
                                                    room ? ` • ${room}` : ''
                                                }`}
                                            >
                                                <span className="inline-block truncate align-middle">
                                                    {label}
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </div>
                    <button
                        onClick={handleClose}
                        className="inline-flex items-center justify-center rounded-md p-2 text-slate-500 hover:text-slate-700 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-slate-800/60 transition"
                        aria-label="Close"
                    >
                        <svg
                            className="w-5 h-5"
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

                <div className="p-6">
                    {isDeveloperMode ? (
                        <div className="space-y-4">
                            <div className="flex items-center justify-between">
                                <h3 className="text-lg font-medium text-slate-900 dark:text-slate-100">
                                    Raw JSON Data
                                </h3>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() =>
                                            copyToClipboard(
                                                JSON.stringify(
                                                    currentLesson,
                                                    null,
                                                    2
                                                )
                                            )
                                        }
                                        className={`px-3 py-1.5 text-sm rounded-md shadow transition inline-flex items-center gap-1 ${
                                            copied
                                                ? 'bg-emerald-600 hover:bg-emerald-600 text-white'
                                                : 'bg-indigo-600 hover:bg-indigo-500 text-white'
                                        }`}
                                        aria-live="polite"
                                    >
                                        {copied ? (
                                            <>
                                                <svg
                                                    className="w-4 h-4"
                                                    viewBox="0 0 24 24"
                                                    fill="none"
                                                    stroke="currentColor"
                                                >
                                                    <path
                                                        strokeLinecap="round"
                                                        strokeLinejoin="round"
                                                        strokeWidth="2"
                                                        d="M5 13l4 4L19 7"
                                                    />
                                                </svg>
                                                <span>Copied</span>
                                            </>
                                        ) : (
                                            <>
                                                <svg
                                                    className="w-4 h-4"
                                                    viewBox="0 0 24 24"
                                                    fill="none"
                                                    stroke="currentColor"
                                                >
                                                    <path
                                                        strokeLinecap="round"
                                                        strokeLinejoin="round"
                                                        strokeWidth="2"
                                                        d="M8 16h8M8 12h8m-7 8h6a2 2 0 002-2V7a2 2 0 00-2-2h-3.5L10 3H8a2 2 0 00-2 2v13a2 2 0 002 2z"
                                                    />
                                                </svg>
                                                <span>Copy JSON</span>
                                            </>
                                        )}
                                    </button>
                                </div>
                            </div>
                            <pre className="bg-slate-900/90 text-slate-100 p-4 rounded-lg text-xs overflow-x-auto ring-1 ring-black/10 dark:ring-white/10">
                                {JSON.stringify(currentLesson, null, 2)}
                            </pre>
                        </div>
                    ) : (
                        <div
                            id={`lesson-tabpanel-${activeIndex}`}
                            role="tabpanel"
                            aria-labelledby={`lesson-tab-${activeIndex}`}
                            className="space-y-6"
                        >
                            <LessonInfoBlocks
                                lesson={currentLesson}
                                cancelled={cancelled}
                                showClasses={showClasses}
                            />
                            <LessonStatus code={currentLesson.code} />

                            {currentLesson.info && (
                                <LessonInfoMessage
                                    title="Lesson Information"
                                    text={currentLesson.info}
                                    variant="info"
                                    cancelled={cancelled}
                                />
                            )}

                            {currentLesson.lstext && (
                                <LessonInfoMessage
                                    title="Lesson Notes"
                                    text={currentLesson.lstext}
                                    variant="notes"
                                    cancelled={cancelled}
                                />
                            )}

                            <HomeworkList lesson={currentLesson} />

                            <ExamsList lesson={currentLesson} />

                            <ColorCustomization
                                lesson={currentLesson}
                                lessonColors={lessonColors}
                                defaultLessonColors={defaultLessonColors}
                                gradientOffsets={gradientOffsets}
                                isAdmin={isAdmin}
                                onColorChange={onColorChange}
                                onGradientOffsetChange={onGradientOffsetChange}
                            />

                            {/* Inline raw JSON (collapsible) when developer mode env is enabled. */}
                            {String(
                                import.meta.env.VITE_ENABLE_DEVELOPER_MODE ?? ''
                            )
                                .trim()
                                .toLowerCase() === 'true' && (
                                <DevJsonPanel lesson={currentLesson} />
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>,
        document.body
    );
}
