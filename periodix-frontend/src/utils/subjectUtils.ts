/**
 * Extract subject type from lesson name for color grouping.
 * 
 * If the lesson name contains an underscore, returns the part before the first underscore.
 * Otherwise, returns the entire lesson name.
 * 
 * Examples:
 * - "M_LK_1" -> "M"
 * - "M" -> "M"
 * - "English_Advanced" -> "English"
 * - "PE" -> "PE"
 * 
 * @param lessonName The full lesson name from the lesson data
 * @returns The subject type to use for color grouping
 */
export function extractSubjectType(lessonName: string): string {
    if (lessonName.includes('_')) {
        const beforeUnderscore = lessonName.split('_')[0];
        return beforeUnderscore || lessonName;
    }
    return lessonName;
}
/**
 * Display name for a lesson's subject.
 *
 * Exam supervision slots often come without a subject or activity type; for
 * those the subjects are taken from the exam (e.g. "M_LK_1/154, Ph_LK_1/143"
 * becomes "M/Ph") instead of showing a bare dash.
 */
export function getLessonSubjectName(lesson: {
    su?: Array<{ name: string }>;
    activityType?: string;
    sg?: string;
    exams?: Array<{ name: string; subject?: { name: string } }>;
}): string {
    const direct = lesson.su?.[0]?.name || lesson.activityType;
    if (direct) return direct;

    const examSubjects = new Set<string>();
    for (const exam of lesson.exams ?? []) {
        if (exam.subject?.name) {
            examSubjects.add(extractSubjectType(exam.subject.name));
            continue;
        }
        for (const part of (exam.name ?? '').split(',')) {
            const course = part.trim().split('/')[0].trim();
            if (course) examSubjects.add(extractSubjectType(course));
        }
    }
    // No spaces: phone columns are only ~60px wide
    if (examSubjects.size > 0) return Array.from(examSubjects).join('/');

    // Class timetables carry no exam details, only the student group ("EXAM_2893")
    if (lesson.sg?.startsWith('EXAM')) return 'Exam';

    return '—';
}
