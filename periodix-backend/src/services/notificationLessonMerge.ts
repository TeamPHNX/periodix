// Lesson merging utilities for notifications

/**
 * Check if two lessons can be merged for notification purposes.
 * Based on the frontend merging logic but adapted for backend lesson format.
 */
export function canMergeLessonsForNotifications(
    lesson1: any,
    lesson2: any,
): boolean {
    const subject1 = lesson1.su?.[0]?.name ?? lesson1.activityType ?? '';
    const subject2 = lesson2.su?.[0]?.name ?? lesson2.activityType ?? '';
    if (subject1 !== subject2) return false;

    const teacher1 = (lesson1.te ?? [])
        .map((t: any) => t.name)
        .sort()
        .join(',');
    const teacher2 = (lesson2.te ?? [])
        .map((t: any) => t.name)
        .sort()
        .join(',');
    if (teacher1 !== teacher2) return false;

    const room1 = (lesson1.ro ?? [])
        .map((r: any) => r.name)
        .sort()
        .join(',');
    const room2 = (lesson2.ro ?? [])
        .map((r: any) => r.name)
        .sort()
        .join(',');
    if (room1 !== room2) return false;

    if (lesson1.code !== lesson2.code) return false;
    if (lesson1.date !== lesson2.date) return false;

    // Convert Untis HHmm format to minutes since midnight.
    const toMinutes = (hhmm: number) =>
        Math.floor(hhmm / 100) * 60 + (hhmm % 100);
    const lesson1EndMin = toMinutes(lesson1.endTime);
    const lesson2StartMin = toMinutes(lesson2.startTime);
    const breakMinutes = lesson2StartMin - lesson1EndMin;

    // Merge if break is 5 minutes or less (including overlap).
    return breakMinutes <= 5;
}

/**
 * Group consecutive lessons that can be merged for notification purposes.
 */
export function groupLessonsForNotifications(lessons: any[]): any[][] {
    if (lessons.length <= 1) return lessons.map((l) => [l]);

    const sortedLessons = [...lessons].sort((a, b) => {
        if (Number(a.date) !== Number(b.date)) {
            return Number(a.date) - Number(b.date);
        }
        return Number(a.startTime) - Number(b.startTime);
    });

    const groups: any[][] = [];
    let currentGroup = [sortedLessons[0]];

    for (let i = 1; i < sortedLessons.length; i++) {
        const currentLesson = currentGroup[currentGroup.length - 1];
        const nextLesson = sortedLessons[i];

        if (canMergeLessonsForNotifications(currentLesson, nextLesson)) {
            currentGroup.push(nextLesson);
        } else {
            groups.push(currentGroup);
            currentGroup = [nextLesson];
        }
    }

    groups.push(currentGroup);
    return groups;
}

/**
 * Create a canonical signature for dedupe keys when IDs are missing.
 */
export function createCanonicalSignature(lesson: any): string {
    const subject = lesson.su?.[0]?.name ?? lesson.activityType ?? 'unknown';
    const teachers =
        (lesson.te ?? [])
            .map((t: any) => t.name)
            .sort()
            .join(',') || 'no-teacher';
    const rooms =
        (lesson.ro ?? [])
            .map((r: any) => r.name)
            .sort()
            .join(',') || 'no-room';
    return `${subject}:${teachers}:${rooms}`;
}
