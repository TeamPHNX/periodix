import type { Lesson } from '../../types';
import SubstitutionNoteIcon from '../SubstitutionNoteIcon';
import { fmtHM, untisToMinutes } from '../../utils/dates';
import {
    getTeacherDisplayText,
    getRoomDisplayText,
} from '../../utils/lessonChanges';

export function LessonInfoBlocks({
    lesson,
    cancelled,
    showClasses = false,
}: {
    lesson: Lesson;
    cancelled: boolean;
    showClasses?: boolean;
}) {
    const subject = lesson.su?.[0]?.name ?? lesson.activityType ?? '—';
    const subjectLong = lesson.su?.[0]?.longname ?? subject;
    const teacherInfo = getTeacherDisplayText(lesson);
    const roomInfo = getRoomDisplayText(lesson);
    const teacher = teacherInfo.current;
    const teacherLong =
        lesson.te?.map((t) => t.longname || t.name).join(', ') || '';
    const room = roomInfo.current;
    const roomLong =
        lesson.ro?.map((r) => r.longname || r.name).join(', ') || '';
    const startTime = fmtHM(untisToMinutes(lesson.startTime));
    const endTime = fmtHM(untisToMinutes(lesson.endTime));
    return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
                <h3 className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-2">
                    Subject
                </h3>
                <p
                    className={`text-slate-900 dark:text-slate-100 ${
                        cancelled ? 'lesson-cancelled-subject' : ''
                    }`}
                >
                    {subjectLong}
                </p>
                {subjectLong !== subject && (
                    <p
                        className={`text-sm text-slate-600 dark:text-slate-400 ${
                            cancelled ? 'lesson-cancelled' : ''
                        }`}
                    >
                        ({subject})
                    </p>
                )}
            </div>
            <div>
                <h3 className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-2">
                    Time
                </h3>
                <p
                    className={`text-slate-900 dark:text-slate-100 ${
                        cancelled ? 'lesson-cancelled-time' : ''
                    }`}
                >
                    {startTime} - {endTime}
                </p>
            </div>
            {showClasses && !!lesson.kl?.length && (
                <div>
                    <h3 className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-2">
                        Classes
                    </h3>
                    <p
                        className={`text-slate-900 dark:text-slate-100 ${
                            cancelled ? 'lesson-cancelled' : ''
                        }`}
                    >
                        {lesson.kl.map((k) => k.name).join(', ')}
                    </p>
                </div>
            )}
            {teacherInfo.current && (
                <div>
                    <h3 className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-2">
                        Teacher
                    </h3>
                    <div className="space-y-1">
                        <p
                            className={`text-slate-900 dark:text-slate-100 ${
                                cancelled ? 'lesson-cancelled-teacher' : ''
                            }`}
                        >
                            {teacherInfo.hasChanges ? (
                                <span className="change-highlight">
                                    {teacherLong && teacherLong !== teacher
                                        ? `${teacherLong} (${teacher})`
                                        : teacherLong || teacher}
                                </span>
                            ) : teacherLong && teacherLong !== teacher ? (
                                `${teacherLong} (${teacher})`
                            ) : (
                                teacherLong || teacher
                            )}
                        </p>
                        {teacherInfo.hasChanges && teacherInfo.original && (
                            <p
                                className={`text-sm change-original ${
                                    cancelled ? 'lesson-cancelled' : ''
                                }`}
                            >
                                Original: {teacherInfo.original}
                            </p>
                        )}
                    </div>
                </div>
            )}
            {roomInfo.current && (
                <div>
                    <h3 className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-2">
                        Room
                    </h3>
                    <div className="space-y-1">
                        <p
                            className={`text-slate-900 dark:text-slate-100 ${
                                cancelled ? 'lesson-cancelled-room' : ''
                            }`}
                        >
                            {roomInfo.hasChanges ? (
                                <span className="change-highlight">
                                    {roomLong && roomLong !== room
                                        ? `${roomLong} (${room})`
                                        : roomLong || room}
                                </span>
                            ) : roomLong && roomLong !== room ? (
                                `${roomLong} (${room})`
                            ) : (
                                roomLong || room
                            )}
                        </p>
                        {roomInfo.hasChanges && roomInfo.original && (
                            <p
                                className={`text-sm change-original ${
                                    cancelled ? 'lesson-cancelled' : ''
                                }`}
                            >
                                Original: {roomInfo.original}
                            </p>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

export function LessonStatus({ code }: { code?: string }) {
    if (!code) return null;
    return (
        <div>
            <h3 className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-2">
                Status
            </h3>
            <p
                className={`inline-block px-2 py-1 rounded-md text-xs font-semibold tracking-wide ${
                    code === 'cancelled'
                        ? 'bg-rose-100 text-rose-800 dark:bg-rose-900/60 dark:text-rose-200'
                        : code === 'irregular'
                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200'
                        : 'bg-slate-100 text-slate-800 dark:bg-slate-800/60 dark:text-slate-200'
                }`}
            >
                {code.charAt(0).toUpperCase() + code.slice(1)}
            </p>
        </div>
    );
}

type NoteVariant = 'info' | 'notes' | 'substitution';

const NOTE_STYLES: Record<
    NoteVariant,
    { container: string; badge: string; iconColor: string; text: string; muted: string }
> = {
    info: {
        container:
            'bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800/50',
        badge: 'bg-blue-100 dark:bg-blue-900/50 border border-blue-300 dark:border-blue-700',
        iconColor: 'text-blue-600 dark:text-blue-400',
        text: 'text-blue-900 dark:text-blue-100',
        muted: 'text-blue-700/70 dark:text-blue-300/60',
    },
    notes: {
        container:
            'bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800/50',
        badge: 'bg-indigo-100 dark:bg-indigo-900/50 border border-indigo-300 dark:border-indigo-700',
        iconColor: 'text-indigo-600 dark:text-indigo-400',
        text: 'text-indigo-900 dark:text-indigo-100',
        muted: 'text-indigo-700/70 dark:text-indigo-300/60',
    },
    substitution: {
        container:
            'bg-fuchsia-50 dark:bg-fuchsia-900/20 border border-fuchsia-200 dark:border-fuchsia-800/50',
        badge: 'bg-fuchsia-100 dark:bg-fuchsia-900/50 border border-fuchsia-300 dark:border-fuchsia-700',
        iconColor: 'text-fuchsia-600 dark:text-fuchsia-400',
        text: 'text-fuchsia-900 dark:text-fuchsia-100',
        muted: 'text-fuchsia-700/70 dark:text-fuchsia-300/60',
    },
};

function NoteIcon({ variant, className }: { variant: NoteVariant; className: string }) {
    if (variant === 'substitution') return <SubstitutionNoteIcon className={className} />;
    return (
        <svg className={className} fill="currentColor" viewBox="0 0 20 20">
            {variant === 'info' ? (
                <path
                    fillRule="evenodd"
                    d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                    clipRule="evenodd"
                />
            ) : (
                <path d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h8.5a2 2 0 001.414-.586l2.5-2.5A2 2 0 0017 12.5V5a2 2 0 00-2-2H4zm9 10h1.586L13 14.586V13z" />
            )}
        </svg>
    );
}

export function LessonInfoMessage({
    title,
    text,
    variant,
    cancelled,
    periods,
}: {
    title: string;
    text?: string;
    variant: NoteVariant;
    cancelled: boolean;
    // Per-hour texts of a merged block; shown instead of `text` when they differ
    periods?: Array<{ startTime: number; endTime: number; text: string }>;
}) {
    const styles = NOTE_STYLES[variant];
    const range = (start: number, end: number) =>
        `${fmtHM(untisToMinutes(start))} – ${fmtHM(untisToMinutes(end))}`;
    return (
        <div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-medium text-slate-500 dark:text-slate-400">
                    {title}
                </h3>
                {periods && (
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${styles.badge} ${styles.iconColor}`}>
                        Differs between periods
                    </span>
                )}
            </div>
            <div className={`${styles.container} rounded-lg p-4`}>
                <div className="flex items-start gap-3">
                    <div
                        className={`mt-1 flex-shrink-0 w-6 h-6 ${styles.badge} rounded-md flex items-center justify-center`}
                    >
                        <NoteIcon variant={variant} className={`w-3.5 h-3.5 ${styles.iconColor}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                        {periods ? (
                            <ul className="space-y-2">
                                {periods.map((p, i) => (
                                    <li key={`${p.startTime}-${i}`} className="text-sm">
                                        <span className={`block font-medium tabular-nums ${styles.text}`}>
                                            {range(p.startTime, p.endTime)}
                                        </span>
                                        <span
                                            className={`block whitespace-pre-wrap ${
                                                p.text ? styles.text : `italic ${styles.muted}`
                                            } ${cancelled ? 'lesson-cancelled' : ''}`}
                                        >
                                            {p.text || 'Nothing for this period'}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <p
                                className={`text-sm whitespace-pre-wrap ${
                                    styles.text
                                } ${cancelled ? 'lesson-cancelled' : ''}`}
                            >
                                {text}
                            </p>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

/**
 * One of the lesson's note fields. On a merged block whose hours carry
 * different texts, each hour is listed and the difference flagged.
 */
export function LessonNote({
    lesson,
    field,
    title,
    variant,
    cancelled,
}: {
    lesson: Lesson;
    field: 'substText' | 'info' | 'lstext';
    title: string;
    variant: NoteVariant;
    cancelled: boolean;
}) {
    const periods = lesson.periods ?? [];
    const perPeriod = periods.map((p) => p[field]?.trim() || '');
    const differs = periods.length > 1 && new Set(perPeriod).size > 1;
    const text = differs ? undefined : (perPeriod[0] ?? lesson[field]?.trim());
    if (!differs && !text) return null;
    return (
        <LessonInfoMessage
            title={title}
            text={text}
            variant={variant}
            cancelled={cancelled}
            periods={
                differs
                    ? periods.map((p, i) => ({
                          startTime: p.startTime,
                          endTime: p.endTime,
                          text: perPeriod[i],
                      }))
                    : undefined
            }
        />
    );
}
