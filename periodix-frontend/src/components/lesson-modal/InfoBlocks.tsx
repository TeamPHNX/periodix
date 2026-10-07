import type { Lesson } from '../../types';
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

export function LessonInfoMessage({
    title,
    text,
    variant,
    cancelled,
}: {
    title: string;
    text: string;
    variant: 'info' | 'notes';
    cancelled: boolean;
}) {
    const styles =
        variant === 'info'
            ? {
                  container:
                      'bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800/50',
                  badge: 'bg-blue-100 dark:bg-blue-900/50 border border-blue-300 dark:border-blue-700',
                  iconColor: 'text-blue-600 dark:text-blue-400',
                  text: 'text-blue-900 dark:text-blue-100',
              }
            : {
                  container:
                      'bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800/50',
                  badge: 'bg-indigo-100 dark:bg-indigo-900/50 border border-indigo-300 dark:border-indigo-700',
                  iconColor: 'text-indigo-600 dark:text-indigo-400',
                  text: 'text-indigo-900 dark:text-indigo-100',
              };
    return (
        <div>
            <h3 className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-2">
                {title}
            </h3>
            <div className={`${styles.container} rounded-lg p-4`}>
                <div className="flex items-start gap-3">
                    <div
                        className={`mt-1 flex-shrink-0 w-6 h-6 ${styles.badge} rounded-md flex items-center justify-center`}
                    >
                        <svg
                            className={`w-3.5 h-3.5 ${styles.iconColor}`}
                            fill="currentColor"
                            viewBox="0 0 20 20"
                        >
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
                    </div>
                    <div className="flex-1 min-w-0">
                        <p
                            className={`text-sm whitespace-pre-wrap ${
                                styles.text
                            } ${cancelled ? 'lesson-cancelled' : ''}`}
                        >
                            {text}
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
