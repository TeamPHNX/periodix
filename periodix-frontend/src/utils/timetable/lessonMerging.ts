import type { Lesson, Homework, Exam } from '../../types';
import { untisToMinutes } from '../dates';

const MERGE_MAX_BREAK_MINUTES = 5;
const LESSON_IDENTIFIER_FIELDS = [
    'lsid',
    'ls',
    'lsNumber',
    'lsnumber',
    'lessonId',
    'lessonID',
];

type MaybeIdentifiedLesson = Lesson & Record<string, unknown>;

function sortAndJoinNames(entries?: Array<{ name?: string }>) {
    return (entries || [])
        .map((entry) => entry?.name || '')
        .filter(Boolean)
        .sort()
        .join(',');
}

function extractLessonIdentifier(lesson: MaybeIdentifiedLesson): string | null {
    for (const key of LESSON_IDENTIFIER_FIELDS) {
        const value = lesson[key];
        if (
            typeof value === 'number' ||
            (typeof value === 'string' && value.trim().length > 0)
        ) {
            return String(value);
        }
    }
    return null;
}

function buildLessonBaseSignature(lesson: Lesson): string {
    const subject = lesson.su?.[0]?.name ?? lesson.activityType ?? '';
    const teacher = sortAndJoinNames(lesson.te);
    const room = sortAndJoinNames(lesson.ro);
    const code = lesson.code || '';
    return `${subject}|${teacher}|${room}|${code}`;
}

function deriveLessonSignature(lesson: Lesson) {
    return {
        identifier: extractLessonIdentifier(lesson as MaybeIdentifiedLesson),
        base: buildLessonBaseSignature(lesson),
    };
}

function getLessonMergeKey(lesson: Lesson): string {
    const signature = deriveLessonSignature(lesson);
    const code = lesson.code || '';
    if (signature.identifier) {
        // Include code in the key so lessons with different codes (e.g., cancelled vs normal)
        // are bucketed separately even if they share the same identifier
        return `${lesson.date}|id:${signature.identifier}|code:${code}`;
    }
    return `${lesson.date}|base:${signature.base}`;
}

export function isLessonIrregular(lesson: Lesson): boolean {
    return (
        lesson.code === 'irregular' ||
        !!lesson.te?.some((t: any) => t.orgname !== undefined) ||
        !!lesson.ro?.some((r: any) => r.orgname !== undefined)
    );
}

/**
 * Check if two lessons can be merged based on matching criteria
 * and break time between them (5 minutes or less)
 */
export function canMergeLessons(lesson1: Lesson, lesson2: Lesson): boolean {
    if (lesson1.date !== lesson2.date) return false;

    // Never merge lessons with different codes (e.g., cancelled vs non-cancelled)
    // This ensures that when only one lesson of a double lesson is cancelled,
    // they are kept separate rather than merged together
    const code1 = lesson1.code || '';
    const code2 = lesson2.code || '';
    if (code1 !== code2) return false;

    // Never merge a normal lesson with an irregular lesson
    const isIrregular1 = isLessonIrregular(lesson1);
    const isIrregular2 = isLessonIrregular(lesson2);
    if (isIrregular1 !== isIrregular2) return false;

    const sig1 = deriveLessonSignature(lesson1);
    const sig2 = deriveLessonSignature(lesson2);
    const sameGroup =
        sig1.identifier && sig2.identifier
            ? sig1.identifier === sig2.identifier
            : sig1.base === sig2.base;

    if (!sameGroup) return false;

    const lesson1EndMin = untisToMinutes(lesson1.endTime);
    const lesson2StartMin = untisToMinutes(lesson2.startTime);
    const breakMinutes = lesson2StartMin - lesson1EndMin;

    return breakMinutes <= MERGE_MAX_BREAK_MINUTES;
}

/**
 * Check if two homework items are identical based on content
 */
export function areHomeworkIdentical(hw1: Homework, hw2: Homework): boolean {
    return (
        hw1.text === hw2.text &&
        hw1.subject?.name === hw2.subject?.name &&
        hw1.date === hw2.date &&
        hw1.remark === hw2.remark
    );
}

/**
 * Check if two exam items are identical based on content
 */
export function areExamsIdentical(exam1: Exam, exam2: Exam): boolean {
    return (
        exam1.name === exam2.name &&
        exam1.subject?.name === exam2.subject?.name &&
        exam1.date === exam2.date &&
        exam1.startTime === exam2.startTime &&
        exam1.endTime === exam2.endTime &&
        exam1.text === exam2.text
    );
}

/**
 * Deduplicate homework arrays, preserving completed status
 */
export function deduplicateHomework(
    homework1: Homework[] = [],
    homework2: Homework[] = []
): Homework[] {
    const allHomework = [...homework1, ...homework2];
    const deduplicated: Homework[] = [];

    for (const hw of allHomework) {
        const existingIndex = deduplicated.findIndex((existing) =>
            areHomeworkIdentical(existing, hw)
        );

        if (existingIndex === -1) {
            // New homework, add it
            deduplicated.push(hw);
        } else {
            // Duplicate found, merge completion status (completed if either is completed)
            deduplicated[existingIndex] = {
                ...deduplicated[existingIndex],
                completed:
                    deduplicated[existingIndex].completed || hw.completed,
            };
        }
    }

    return deduplicated;
}

/**
 * Deduplicate exam arrays
 */
export function deduplicateExams(
    exams1: Exam[] = [],
    exams2: Exam[] = []
): Exam[] {
    const allExams = [...exams1, ...exams2];
    const deduplicated: Exam[] = [];

    for (const exam of allExams) {
        const existingIndex = deduplicated.findIndex((existing) =>
            areExamsIdentical(existing, exam)
        );

        if (existingIndex === -1) {
            // New exam, add it
            deduplicated.push(exam);
        }
        // For exams, we don't merge anything - just avoid duplicates
    }

    return deduplicated;
}

/**
 * Merge two lessons into one, combining their time ranges and preserving all data
 */
export function mergeTwoLessons(lesson1: Lesson, lesson2: Lesson): Lesson {
    // Helper to combine textual note fields without duplicating identical segments
    const combineNotes = (a?: string, b?: string): string | undefined => {
        const parts: string[] = [];
        const add = (val?: string) => {
            if (!val) return;
            // Split in case prior merge already joined with ' | '
            val.split('|')
                .map((s) => s.trim())
                .filter(Boolean)
                .forEach((seg) => {
                    const normalized = seg.toLowerCase();
                    // Avoid duplicates (case-insensitive)
                    if (!parts.some((p) => p.toLowerCase() === normalized)) {
                        parts.push(seg);
                    }
                });
        };
        add(a);
        add(b);
        if (!parts.length) return undefined;
        return parts.join(' | ');
    };

    return {
        ...lesson1, // Use first lesson as base
        startTime: Math.min(lesson1.startTime, lesson2.startTime),
        endTime: Math.max(lesson1.endTime, lesson2.endTime),
        // Merge and deduplicate homework arrays
        homework: deduplicateHomework(lesson1.homework, lesson2.homework),
        // Merge and deduplicate exam arrays
        exams: deduplicateExams(lesson1.exams, lesson2.exams),
        // Combine info and lstext with separator, removing duplicates
        info: combineNotes(lesson1.info, lesson2.info),
        lstext: combineNotes(lesson1.lstext, lesson2.lstext),
        // Use lower ID to maintain consistency
        id: Math.min(lesson1.id, lesson2.id),
    };
}

/**
 * Process and merge consecutive lessons that meet the merging criteria
 */
export function mergeLessons(lessons: Lesson[]): Lesson[] {
    if (lessons.length <= 1) return lessons;

    const buckets = new Map<string, Lesson[]>();
    for (const lesson of lessons) {
        const key = getLessonMergeKey(lesson);
        const bucket = buckets.get(key);
        if (bucket) bucket.push(lesson);
        else buckets.set(key, [lesson]);
    }

    const merged: Lesson[] = [];
    for (const bucket of buckets.values()) {
        bucket.sort((a, b) => {
            if (a.date !== b.date) return a.date - b.date;
            if (a.startTime !== b.startTime) return a.startTime - b.startTime;
            return a.endTime - b.endTime;
        });

        let current = bucket[0];
        for (let i = 1; i < bucket.length; i++) {
            const next = bucket[i];
            if (canMergeLessons(current, next)) {
                current = mergeTwoLessons(current, next);
            } else {
                merged.push(current);
                current = next;
            }
        }
        merged.push(current);
    }

    return merged.sort((a, b) => {
        if (a.date !== b.date) return a.date - b.date;
        if (a.startTime !== b.startTime) return a.startTime - b.startTime;
        return a.endTime - b.endTime;
    });
}
