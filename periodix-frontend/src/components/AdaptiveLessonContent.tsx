import {
    useState,
    useLayoutEffect,
    useRef,
    useCallback,
    useMemo,
    type FC,
    type ReactNode,
    memo,
} from 'react';

/**
 * Layout levels for progressive content disclosure (highest to lowest detail)
 * Level 0: Full - Subject, Teacher, Room, Time
 * Level 1: NoTime - Subject, Teacher, Room (no time)
 * Level 2: Compact - Subject + Teacher inline, Room below
 * Level 3: SubjectRoom - Subject, Room only (no teacher)
 * Level 4: InlineRoom - Subject + Room on same line
 * Level 5: SubjectOnly - Just the subject
 * Level 6: InlineAll - Subject, Room, Teacher on one line (no time)
 */
export type LayoutLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface AdaptiveLessonContentProps {
    /** Available height in pixels for the content */
    availableHeight: number;
    /** Available width in pixels for the content */
    availableWidth: number;
    /** Content for each layout level - only provide the ones relevant to your use case */
    layouts: Partial<{
        full: ReactNode; // Level 0: Subject, Teacher, Room, Time
        noTime: ReactNode; // Level 1: Subject, Teacher, Room
        compact: ReactNode; // Level 2: Subject + Teacher inline, Room
        subjectRoom: ReactNode; // Level 3: Subject, Room (no teacher)
        inlineRoom: ReactNode; // Level 4: Subject + Room inline
        subjectOnly: ReactNode; // Level 5: Subject only
        inlineAll: ReactNode; // Level 6: Subject + Room + Teacher inline (no time)
    }>;
    /** Minimum scale factor before dropping to next layout (default: 0.88) */
    minScale?: number;
    /** Maximum scale factor (default: 1.3) */
    maxScale?: number;
    /** Additional className for the container */
    className?: string;
    /** Whether this is a side-by-side lesson - affects layout priority */
    isSideBySide?: boolean;
    /** Whether this is a cancelled/irregular lesson - affects layout priority */
    isCancelledOrIrregular?: boolean;
    /** Reserved space at bottom (pixels) - passed through to measurement */
    reserveBottom?: number;
    /** Debug hook to observe layout decisions */
    onDecision?: (decision: LayoutDecision) => void;
}

// One line of lesson text (13px semibold, leading-tight) measures ~17px
const SINGLE_LINE_MAX_HEIGHT_PX = 22;

const AdaptiveLessonContent: FC<AdaptiveLessonContentProps> = memo(
    ({
        availableHeight,
        availableWidth,
        layouts,
        minScale = 0.88,
        maxScale = 1.3,
        className,
        isSideBySide = false,
        isCancelledOrIrregular = false,
        reserveBottom = 0,
        onDecision,
    }) => {
        const measureContainerRef = useRef<HTMLDivElement>(null);

        // Get ordered list of layouts to try (most detailed first)
        const getLayoutOrder = useCallback((): LayoutLevel[] => {
            let allLevels: LayoutLevel[] = [0, 1, 2, 6, 3, 4, 5];

            if (!isSideBySide) {
                if (availableHeight < 38) {
                    allLevels = [6, 0, 1, 2, 3, 4, 5];
                } else if (availableHeight < 70) {
                    allLevels = [2, 0, 1, 6, 3, 4, 5];
                }
            }

            const availableLevels = allLevels.filter((level) => {
                const key = levelToKey(level);
                return layouts[key] !== undefined;
            });

            if (isSideBySide && !isCancelledOrIrregular) {
                return availableLevels.sort((a, b) => {
                    const priority: Record<LayoutLevel, number> = {
                        0: 0,
                        1: 1,
                        3: 2,
                        6: 3,
                        2: 4,
                        4: 5,
                        5: 6,
                    };
                    return priority[a] - priority[b];
                });
            }

            return availableLevels;
        }, [layouts, isSideBySide, isCancelledOrIrregular, availableHeight]);

        const layoutOrder = useMemo(() => getLayoutOrder(), [getLayoutOrder]);

        // Initial guess based on available space
        const [selectedLevel, setSelectedLevel] = useState<LayoutLevel>(() => {
            // If very little horizontal space, guess inlineAll or subjectOnly
            if (availableWidth < 120) return layoutOrder.find(l => l >= 3) ?? (layoutOrder[0] ?? 0);
            return layoutOrder[0] ?? 0;
        });
        const [scale, setScale] = useState(1);

        const getLayoutContent = useCallback(
            (level: LayoutLevel): ReactNode => {
                const key = levelToKey(level);
                return layouts[key];
            },
            [layouts],
        );

        useLayoutEffect(() => {
            const container = measureContainerRef.current;
            const effectiveHeight = availableHeight - reserveBottom;

            if (!container || effectiveHeight <= 0 || availableWidth <= 0) {
                return;
            }

            if (layoutOrder.length === 0) return;

            const attempts: Array<LayoutAttempt> = [];
            let bestLevel: LayoutLevel = layoutOrder[layoutOrder.length - 1];
            let bestScale = minScale;

            const isSingleLineNoTeacher = (level: LayoutLevel) =>
                level === 4 || level === 5;

            const passes =
                isSideBySide && !isCancelledOrIrregular
                    ? [layoutOrder.filter(isSingleLineNoTeacher), layoutOrder]
                    : [layoutOrder];

            let found = false;
            for (const passLevels of passes) {
                if (found) break;
                for (const level of passLevels) {
                    const content = container.querySelector(
                        `[data-layout-level="${level}"]`,
                    ) as HTMLElement;
                    if (!content) continue;

                    const contentHeight = content.scrollHeight;
                    const contentWidth = content.scrollWidth;

                    const alreadyRecorded = attempts.some(
                        (a) => a.level === level,
                    );
                    if (!alreadyRecorded) {
                        if (contentHeight <= 0 || contentWidth <= 0) {
                            attempts.push({
                                level,
                                contentHeight,
                                contentWidth,
                                requiredScale: 0,
                                accepted: false,
                            });
                            continue;
                        }

                        const scaleH = effectiveHeight / contentHeight;
                        const scaleW = availableWidth / contentWidth;

                        // "Single-line" layouts only get the relaxed height rule while
                        // they really render as one line. In narrow blocks inlineAll
                        // wraps to two lines and was accepted anyway, spilling out of
                        // short blocks although a true one-liner (inlineRoom) fit.
                        const isSingleLineLayout =
                            (level === 4 || level === 5 || level === 6) &&
                            contentHeight <= SINGLE_LINE_MAX_HEIGHT_PX;

                        let requiredScale: number;
                        if (isSingleLineLayout) {
                            requiredScale =
                                scaleH >= 0.5
                                    ? scaleW
                                    : Math.min(scaleH, scaleW);
                        } else {
                            requiredScale = Math.min(scaleH, scaleW);
                        }

                        attempts.push({
                            level,
                            contentHeight,
                            contentWidth,
                            requiredScale,
                            accepted: requiredScale >= minScale,
                        });
                    }

                    const attempt = attempts.find((a) => a.level === level);
                    if (!attempt || attempt.requiredScale < minScale) continue;

                    bestLevel = level;
                    bestScale = Math.min(
                        maxScale,
                        Math.max(1, attempt.requiredScale),
                    );
                    found = true;
                    break;
                }
            }

            setSelectedLevel(bestLevel);
            setScale(bestScale);

            if (onDecision) {
                onDecision({
                    selectedLevel: bestLevel,
                    bestScale,
                    layoutOrder,
                    attempts,
                    availableHeight: effectiveHeight,
                    availableWidth,
                    reserveBottom,
                    isSideBySide,
                    isCancelledOrIrregular,
                });
            }
        }, [
            availableHeight,
            availableWidth,
            reserveBottom,
            layouts,
            minScale,
            maxScale,
            layoutOrder,
            isSideBySide,
            isCancelledOrIrregular,
            onDecision,
        ]);

        return (
            <div
                className={className}
                style={{
                    height: '100%',
                    overflow: 'hidden',
                    position: 'relative',
                }}
            >
                {/* Hidden measurement container */}
                <div
                    ref={measureContainerRef}
                    aria-hidden="true"
                    style={{
                        position: 'absolute',
                        visibility: 'hidden',
                        pointerEvents: 'none',
                        width: availableWidth,
                        left: -9999,
                        top: 0,
                    }}
                >
                    {layoutOrder.map((level) => (
                        <div
                            key={level}
                            data-layout-level={level}
                            style={{ display: 'block' }}
                        >
                            {getLayoutContent(level)}
                        </div>
                    ))}
                </div>

                {/* Visible content - renders immediately with best guess */}
                <div
                    style={{
                        transform: scale !== 1 ? `scale(${scale})` : undefined,
                        transformOrigin: 'top left',
                    }}
                >
                    {getLayoutContent(selectedLevel)}
                </div>
            </div>
        );
    },
);

AdaptiveLessonContent.displayName = 'AdaptiveLessonContent';

function levelToKey(
    level: LayoutLevel,
): keyof AdaptiveLessonContentProps['layouts'] {
    const map: Record<
        LayoutLevel,
        keyof AdaptiveLessonContentProps['layouts']
    > = {
        0: 'full',
        1: 'noTime',
        2: 'compact',
        3: 'subjectRoom',
        4: 'inlineRoom',
        5: 'subjectOnly',
        6: 'inlineAll',
    };
    return map[level];
}

export type LayoutAttempt = {
    level: LayoutLevel;
    contentHeight: number;
    contentWidth: number;
    requiredScale: number;
    accepted: boolean;
};

export type LayoutDecision = {
    selectedLevel: LayoutLevel;
    bestScale: number;
    layoutOrder: LayoutLevel[];
    attempts: LayoutAttempt[];
    availableHeight: number;
    availableWidth: number;
    reserveBottom: number;
    isSideBySide: boolean;
    isCancelledOrIrregular: boolean;
};

export default AdaptiveLessonContent;
