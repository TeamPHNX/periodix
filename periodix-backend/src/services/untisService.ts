import { WebUntis } from 'webuntis';
import { prisma } from '../store/prisma.js';
import { decryptSecret } from '../server/crypto.js';
import { UNTIS_DEFAULT_SCHOOL, UNTIS_HOST } from '../server/config.js';
import { AppError } from '../server/errors.js';
import { Prisma } from '@prisma/client';

// ---------------------------------------------------------------------------
// Timetable caching strategy
// ---------------------------------------------------------------------------
// Goals:
// 1. Avoid hitting WebUntis if we fetched the SAME week in the last 5 minutes.
// 2. Prefetch previous + next week (fire & forget) after a cache miss fetch.
// 3. Periodically prune old timetable cache rows to keep table small.
//    - Remove rows older than MAX_AGE_DAYS
//    - For a (userId, rangeStart, rangeEnd) keep only the most recent MAX_HISTORY_PER_RANGE rows
// 4. Keep implementation lightweight: no extra tables; in‑memory throttle for cleanup.

const WEEK_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_AGE_DAYS = 45; // Hard limit for any cached timetable
const MAX_HISTORY_PER_RANGE = 2; // Keep at most 2 historical copies per week
const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000; // Run pruning at most every 6h per process

// Simple in-memory cache for holidays: userId -> { data: any[], timestamp: number }
const holidayCache = new Map<string, { data: any[]; timestamp: number }>();
const HOLIDAY_CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours
type UserClassRecord = {
    id: number;
    name: string;
    longName: string;
};

const classListCache = new Map<
    string,
    { data: UserClassRecord[]; timestamp: number }
>();
const CLASS_LIST_CACHE_TTL = 30 * 60 * 1000; // 30 minutes

const allClassesCache = new Map<
    string,
    { data: UserClassRecord[]; timestamp: number }
>();
const ALL_CLASSES_CACHE_TTL = 60 * 60 * 1000; // 1 hour

const allTeachersCache = new Map<
    string,
    { data: any[]; timestamp: number }
>();
const ALL_TEACHERS_CACHE_TTL = 60 * 60 * 1000; // 1 hour

const ABSENCE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_ABSENCE_RANGE_DAYS = 0; // 0 disables auto-clamping to support full-school-year / all-time queries

type AbsenceCachePayload = {
    userId: string;
    rangeStart: string;
    rangeEnd: string;
    absences: any[];
    absenceReasons: any[];
    excuseStatuses: boolean;
    showAbsenceReasonChange: boolean;
    showCreateAbsence: boolean;
    lastUpdated: Date;
};

type AbsenceCacheEntry = {
    payload: AbsenceCachePayload;
    timestamp: number;
};

const absenceCache = new Map<string, AbsenceCacheEntry>();

let lastCleanupRun = 0; // In‑memory marker; acceptable for single process / ephemeral scaling
let lastClassCleanupRun = 0; // Separate throttling for class timetable cache pruning

type TimetableFallbackReason = 'UNTIS_UNAVAILABLE' | 'BAD_CREDENTIALS';

function startOfDay(d: Date) {
    const nd = new Date(d);
    nd.setHours(0, 0, 0, 0);
    return nd;
}

function endOfDay(d: Date) {
    const nd = new Date(d);
    nd.setHours(23, 59, 59, 999);
    return nd;
}

function startOfISOWeek(date: Date) {
    const d = startOfDay(date);
    // ISO week starts Monday (1); JS Sunday = 0
    const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day; // shift to Monday
    d.setDate(d.getDate() + diff);
    return d;
}

function endOfISOWeek(date: Date) {
    const start = startOfISOWeek(date);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);
    return endOfDay(end);
}

function normalizeRange(start?: string, end?: string) {
    if (!start || !end) return { normStart: undefined, normEnd: undefined };
    // Treat ranges spanning a full week the same by snapping to ISO week
    const sd = new Date(start);
    const ed = new Date(end);
    // If the provided range length >= 5 days we assume week intentions and snap
    const spanMs = ed.getTime() - sd.getTime();
    if (spanMs >= 5 * 24 * 60 * 60 * 1000) {
        return { normStart: startOfISOWeek(sd), normEnd: endOfISOWeek(sd) };
    }
    // Otherwise just normalize to day bounds
    return { normStart: startOfDay(sd), normEnd: endOfDay(ed) };
}

async function pruneOldTimetables() {
    const now = Date.now();
    if (now - lastCleanupRun < CLEANUP_INTERVAL_MS) return; // throttle
    lastCleanupRun = now;

    // Clear in-memory caches every 6 hours to prevent infinite growth
    holidayCache.clear();
    classListCache.clear();
    allClassesCache.clear();
    absenceCache.clear();

    const cutoff = new Date(Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000);
    try {
        // Delete very old rows
        await prisma.timetable.deleteMany({
            where: { createdAt: { lt: cutoff } },
        });

        // For each (ownerId, rangeStart, rangeEnd) keep only newest MAX_HISTORY_PER_RANGE
        // This is a bit heavy to do naively; limit to recent owners touched (lightweight): we pull ids via raw query.
        const rows: Array<{
            ownerId: string;
            rangeStart: Date | null;
            rangeEnd: Date | null;
        }> = await (prisma as any).$queryRawUnsafe(
            `SELECT DISTINCT "ownerId", "rangeStart", "rangeEnd" FROM "Timetable" WHERE "rangeStart" IS NOT NULL AND "rangeEnd" IS NOT NULL`,
        );
        for (const r of rows) {
            const keep = await prisma.timetable.findMany({
                where: {
                    ownerId: r.ownerId,
                    rangeStart: r.rangeStart,
                    rangeEnd: r.rangeEnd,
                },
                select: { id: true },
                orderBy: { createdAt: 'desc' },
                skip: 0,
                take: MAX_HISTORY_PER_RANGE,
            });
            const keepIds = new Set(keep.map((k: any) => k.id));
            await prisma.timetable.deleteMany({
                where: {
                    ownerId: r.ownerId,
                    rangeStart: r.rangeStart,
                    rangeEnd: r.rangeEnd,
                    NOT: { id: { in: Array.from(keepIds) } },
                },
            });
        }
    } catch (e) {
        console.warn('[timetable][cleanup] failed', e);
    }
}

async function getCachedRange(ownerId: string, start: Date, end: Date) {
    const since = new Date(Date.now() - WEEK_CACHE_TTL_MS);
    return prisma.timetable.findFirst({
        where: {
            ownerId,
            rangeStart: start,
            rangeEnd: end,
            createdAt: { gt: since },
        },
        orderBy: { createdAt: 'desc' },
    });
}

async function getLatestCachedTimetable(args: {
    ownerId: string;
    start?: Date | null;
    end?: Date | null;
}) {
    const { ownerId, start, end } = args;
    const primaryWhere: Prisma.TimetableWhereInput = {
        ownerId,
    };

    if (start && end) {
        primaryWhere.rangeStart = start;
        primaryWhere.rangeEnd = end;
    } else if (start || end) {
        if (start) primaryWhere.rangeStart = start;
        if (end) primaryWhere.rangeEnd = end;
    } else {
        primaryWhere.rangeStart = { equals: null };
        primaryWhere.rangeEnd = { equals: null };
    }

    let record = await prisma.timetable.findFirst({
        where: primaryWhere,
        orderBy: { createdAt: 'desc' },
    });

    if (!record) {
        record = await prisma.timetable.findFirst({
            where: { ownerId },
            orderBy: { createdAt: 'desc' },
        });
    }

    return record;
}

async function getCachedClassRange(classId: number, start: Date, end: Date) {
    const since = new Date(Date.now() - WEEK_CACHE_TTL_MS);
    return (prisma as any).classTimetableCache.findFirst({
        where: {
            classId,
            rangeStart: start,
            rangeEnd: end,
            createdAt: { gt: since },
        },
        orderBy: { createdAt: 'desc' },
    });
}

async function getLatestCachedClassTimetable(args: {
    classId: number;
    start?: Date | null;
    end?: Date | null;
}) {
    const { classId, start, end } = args;
    const primaryWhere: any = {
        classId,
    };

    if (start && end) {
        primaryWhere.rangeStart = start;
        primaryWhere.rangeEnd = end;
    } else if (start || end) {
        if (start) primaryWhere.rangeStart = start;
        if (end) primaryWhere.rangeEnd = end;
    } else {
        primaryWhere.rangeStart = { equals: null };
        primaryWhere.rangeEnd = { equals: null };
    }

    let record = await (prisma as any).classTimetableCache.findFirst({
        where: primaryWhere,
        orderBy: { createdAt: 'desc' },
    });

    if (!record) {
        record = await (prisma as any).classTimetableCache.findFirst({
            where: { classId },
            orderBy: { createdAt: 'desc' },
        });
    }

    return record;
}

async function storeClassTimetableRecord(args: {
    classId: number;
    rangeStart?: Date | null;
    rangeEnd?: Date | null;
    payload: any;
}) {
    return (prisma as any).classTimetableCache.create({
        data: {
            classId: args.classId,
            rangeStart: args.rangeStart ?? null,
            rangeEnd: args.rangeEnd ?? null,
            payload: args.payload,
        },
        select: {
            rangeStart: true,
            rangeEnd: true,
            payload: true,
            createdAt: true,
        },
    });
}

async function pruneOldClassTimetables() {
    const now = Date.now();
    if (now - lastClassCleanupRun < CLEANUP_INTERVAL_MS) return;
    lastClassCleanupRun = now;
    const cutoff = new Date(Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000);
    try {
        await (prisma as any).classTimetableCache.deleteMany({
            where: { createdAt: { lt: cutoff } },
        });

        const rows: Array<{
            classId: number;
            rangeStart: Date | null;
            rangeEnd: Date | null;
        }> = await (prisma as any).$queryRawUnsafe(
            `SELECT DISTINCT "classId", "rangeStart", "rangeEnd" FROM "ClassTimetableCache" WHERE "rangeStart" IS NOT NULL AND "rangeEnd" IS NOT NULL`,
        );
        for (const r of rows) {
            const keep = await (prisma as any).classTimetableCache.findMany({
                where: {
                    classId: r.classId,
                    rangeStart: r.rangeStart,
                    rangeEnd: r.rangeEnd,
                },
                select: { id: true },
                orderBy: { createdAt: 'desc' },
                take: MAX_HISTORY_PER_RANGE,
            });
            const keepIds = new Set(keep.map((k: any) => k.id));
            await (prisma as any).classTimetableCache.deleteMany({
                where: {
                    classId: r.classId,
                    rangeStart: r.rangeStart,
                    rangeEnd: r.rangeEnd,
                    NOT: { id: { in: Array.from(keepIds) } },
                },
            });
        }
    } catch (e) {
        console.warn('[class-timetable][cleanup] failed', e);
    }
}

function shouldFallbackToCache(error: AppError): boolean {
    const code = String(error.code ?? '').toUpperCase();
    return (
        code === 'UNTIS_LOGIN_FAILED' ||
        code === 'UNTIS_FETCH_FAILED' ||
        code === 'BAD_CREDENTIALS'
    );
}

function serializeTimetableResponse(payload: {
    userId: string;
    rangeStart?: Date | null;
    rangeEnd?: Date | null;
    data: any;
    cached: boolean;
    stale: boolean;
    lastUpdated?: Date | null | undefined;
    fallbackReason?: TimetableFallbackReason | undefined;
    errorCode?: string | number | undefined;
    errorMessage?: string | undefined;
}) {
    const { userId, rangeStart, rangeEnd, data, cached, stale } = payload;
    return {
        userId,
        rangeStart: rangeStart ? rangeStart.toISOString() : null,
        rangeEnd: rangeEnd ? rangeEnd.toISOString() : null,
        payload: data,
        cached,
        stale,
        source: cached ? 'cache' : 'live',
        lastUpdated: payload.lastUpdated
            ? payload.lastUpdated.toISOString()
            : null,
        fallbackReason: payload.fallbackReason,
        errorCode: payload.errorCode,
        errorMessage: payload.errorMessage,
    };
}

function buildAbsenceCacheKey(args: {
    userId: string;
    rangeStart: Date;
    rangeEnd: Date;
    excuseStatusId: number;
}) {
    return `${
        args.userId
    }:${args.rangeStart.toISOString()}:${args.rangeEnd.toISOString()}:${
        args.excuseStatusId
    }`;
}

function normalizeAbsenceRange(start?: string, end?: string) {
    const now = new Date();
    let rangeEnd = end ? new Date(end) : now;
    if (Number.isNaN(rangeEnd.getTime())) {
        throw new AppError('Invalid end date', 400, 'INVALID_RANGE');
    }
    rangeEnd = endOfDay(rangeEnd);

    let rangeStart = start ? new Date(start) : new Date(rangeEnd);
    if (Number.isNaN(rangeStart.getTime())) {
        throw new AppError('Invalid start date', 400, 'INVALID_RANGE');
    }
    if (!start) {
        rangeStart.setDate(rangeStart.getDate() - 30);
    }
    rangeStart = startOfDay(rangeStart);

    if (rangeStart > rangeEnd) {
        const tmp = rangeStart;
        rangeStart = startOfDay(new Date(rangeEnd));
        rangeEnd = endOfDay(tmp);
    }

    if (MAX_ABSENCE_RANGE_DAYS > 0) {
        const maxSpanMs = MAX_ABSENCE_RANGE_DAYS * 24 * 60 * 60 * 1000;
        if (rangeEnd.getTime() - rangeStart.getTime() > maxSpanMs) {
            rangeStart = new Date(rangeEnd.getTime() - maxSpanMs);
            rangeStart = startOfDay(rangeStart);
        }
    }

    return { rangeStart, rangeEnd };
}

function serializeAbsenceResponse(payload: {
    payload: AbsenceCachePayload;
    cached: boolean;
    stale: boolean;
    fallbackReason?: TimetableFallbackReason;
    errorCode?: string | number | undefined;
    errorMessage?: string | undefined;
}) {
    return {
        userId: payload.payload.userId,
        rangeStart: payload.payload.rangeStart,
        rangeEnd: payload.payload.rangeEnd,
        absences: payload.payload.absences,
        absenceReasons: payload.payload.absenceReasons,
        excuseStatuses: payload.payload.excuseStatuses,
        showAbsenceReasonChange: payload.payload.showAbsenceReasonChange,
        showCreateAbsence: payload.payload.showCreateAbsence,
        cached: payload.cached,
        stale: payload.stale,
        source: payload.cached ? 'cache' : 'live',
        lastUpdated: payload.payload.lastUpdated.toISOString(),
        fallbackReason: payload.fallbackReason,
        errorCode: payload.errorCode,
        errorMessage: payload.errorMessage,
    };
}

function normalizeUntisClass(entry: any): UserClassRecord | null {
    if (!entry) return null;
    const candidates = [
        entry.id,
        entry.klasseId,
        entry.classId,
        entry?.klasse?.id,
    ];
    const numericId = candidates
        .map((val) => (typeof val === 'string' ? parseInt(val, 10) : val))
        .find(
            (val) => typeof val === 'number' && Number.isFinite(val) && val > 0,
        );

    if (typeof numericId !== 'number') return null;
    const name =
        (typeof entry.name === 'string' && entry.name.trim()) ||
        (typeof entry.longName === 'string' && entry.longName.trim()) ||
        (typeof entry.longname === 'string' && entry.longname.trim()) ||
        (typeof entry.displayName === 'string' && entry.displayName.trim()) ||
        `Class ${numericId}`;
    const longName =
        (typeof entry.longName === 'string' && entry.longName.trim()) ||
        (typeof entry.longname === 'string' && entry.longname.trim()) ||
        name;
    return {
        id: numericId,
        name,
        longName,
    };
}

async function fetchOwnClassesFromUntis(
    untis: any,
): Promise<UserClassRecord[]> {
    const seen = new Map<number, UserClassRecord>();
    if (typeof untis.getOwnClassesList === 'function') {
        try {
            const classList = await untis.getOwnClassesList();
            if (Array.isArray(classList)) {
                classList.forEach((item: any) => {
                    const normalized = normalizeUntisClass(item);
                    if (normalized) seen.set(normalized.id, normalized);
                });
            }
        } catch (e: any) {
            console.warn('[classes] getOwnClassesList failed', e?.message || e);
        }
    }
    if (
        !seen.size &&
        typeof untis.getOwnStudentId === 'function' &&
        typeof untis.getStudent === 'function'
    ) {
        try {
            const studentId = await untis.getOwnStudentId();
            if (studentId) {
                const student = await untis.getStudent(studentId);
                const klasses = Array.isArray(student?.klasse)
                    ? student?.klasse
                    : student?.klasse
                      ? [student.klasse]
                      : [];
                klasses.forEach((item: any) => {
                    const normalized = normalizeUntisClass(item);
                    if (normalized) seen.set(normalized.id, normalized);
                });
            }
        } catch (e: any) {
            console.warn('[classes] student fallback failed', e?.message || e);
        }
    }

    // Fallback: try to infer from current week's timetable
    if (!seen.size) {
        try {
            const now = new Date();
            const start = startOfISOWeek(now);
            const end = endOfISOWeek(now);

            let lessons = [];
            if (typeof untis.getOwnTimetableForRange === 'function') {
                lessons = await untis.getOwnTimetableForRange(start, end);
            } else if (typeof untis.getOwnTimetableForToday === 'function') {
                lessons = await untis.getOwnTimetableForToday();
            }

            if (Array.isArray(lessons)) {
                lessons.forEach((lesson: any) => {
                    if (Array.isArray(lesson.kl)) {
                        lesson.kl.forEach((k: any) => {
                            const normalized = normalizeUntisClass(k);
                            if (normalized) seen.set(normalized.id, normalized);
                        });
                    }
                });
            }
        } catch (e: any) {
            console.warn(
                '[classes] timetable inference failed',
                e?.message || e,
            );
        }
    }

    return Array.from(seen.values());
}

function resolvePermittedClassId(
    requestedClassId: number | undefined,
    allowedClasses: UserClassRecord[],
): number | null {
    if (!allowedClasses.length) return null;
    if (
        typeof requestedClassId === 'number' &&
        allowedClasses.some((cls) => cls.id === requestedClassId)
    ) {
        return requestedClassId;
    }
    return allowedClasses[0]?.id ?? null;
}

async function fetchAndStoreUntis(args: {
    target: any;
    sd?: Date | undefined;
    ed?: Date | undefined;
}) {
    const { target, sd, ed } = args;
    // Fetch fresh from WebUntis
    const school = UNTIS_DEFAULT_SCHOOL;
    const host = toHost();
    console.debug('[timetable] using Untis', {
        school,
        host,
        username: target.username,
    });
    if (!target.untisSecretCiphertext || !target.untisSecretNonce) {
        throw new AppError(
            'User missing encrypted Untis credential',
            400,
            'MISSING_UNTIS_SECRET',
        );
    }
    let untisPassword: string;
    try {
        untisPassword = decryptSecret({
            ciphertext: target.untisSecretCiphertext as any,
            nonce: target.untisSecretNonce as any,
            keyVersion: target.untisSecretKeyVersion || 1,
        });
    } catch (e) {
        console.error('[timetable] decrypt secret failed', e);
        throw new AppError(
            'Credential decryption failed',
            500,
            'DECRYPT_FAILED',
        );
    }
    const untis = new WebUntis(
        school,
        target.username,
        untisPassword,
        host,
    ) as any;
    try {
        await untis.login();
    } catch (e: any) {
        const msg = e?.message || '';
        if (msg.includes('bad credentials')) {
            throw new AppError(
                'Invalid Untis credentials',
                401,
                'BAD_CREDENTIALS',
            );
        }
        throw new AppError('Untis login failed', 502, 'UNTIS_LOGIN_FAILED');
    }

    let lessonsData: any;
    let homeworkData: any[] = [];
    let examData: any = [];

    try {
        // Fetch all lessons using getOwnTimetableForRange
        if (sd && ed && typeof untis.getOwnTimetableForRange === 'function') {
            console.debug('[timetable] calling getOwnTimetableForRange', {
                start: sd,
                end: ed,
                startType: typeof sd,
                endType: typeof ed,
            });
            lessonsData = await untis.getOwnTimetableForRange(sd, ed);
        } else if (typeof untis.getOwnTimetableForToday === 'function') {
            console.debug('[timetable] calling getOwnTimetableForToday');
            lessonsData = await untis.getOwnTimetableForToday();
        } else {
            console.debug(
                '[timetable] calling getTimetableForToday (fallback)',
            );
            lessonsData = await untis.getTimetableForToday?.();
        }

        // Fetch homework separately using getHomeWorksFor
        if (sd && ed && typeof untis.getHomeWorksFor === 'function') {
            console.debug('[timetable] calling getHomeWorksFor', {
                start: sd,
                end: ed,
            });
            try {
                const hwResp = await untis.getHomeWorksFor(sd, ed);
                // Extract array of homework items from response shape
                homeworkData = Array.isArray(hwResp)
                    ? hwResp
                    : Array.isArray(hwResp?.homeworks)
                      ? hwResp.homeworks
                      : [];
                // Build a map of lessonId -> subject string if available
                const lessonSubjectByLessonId: Map<number, string> = new Map();
                const lessonsArr: any[] = Array.isArray(hwResp?.lessons)
                    ? hwResp.lessons
                    : [];
                for (const l of lessonsArr) {
                    if (
                        typeof l?.id === 'number' &&
                        typeof l?.subject === 'string'
                    ) {
                        lessonSubjectByLessonId.set(l.id, l.subject);
                    }
                }
                console.debug(
                    '[timetable] fetched homework count',
                    homeworkData.length,
                );
                // Persist with subject enrichment and due dates
                if (homeworkData.length > 0) {
                    try {
                        await storeHomeworkData(
                            target.id,
                            homeworkData,
                            lessonSubjectByLessonId,
                        );
                    } catch (e: any) {
                        console.warn(
                            '[timetable] failed to store homework data',
                            e?.message,
                        );
                    }
                }
            } catch (e: any) {
                console.warn(
                    '[timetable] getHomeWorksFor failed, continuing without homework',
                    e?.message,
                );
                homeworkData = [];
            }
        }

        // Fetch exams for the range if available
        if (sd && ed && typeof untis.getExamsForRange === 'function') {
            console.debug('[timetable] calling getExamsForRange', {
                start: sd,
                end: ed,
            });
            try {
                examData = await untis.getExamsForRange(sd, ed);
                // Force fallback if standard API returns empty, as it often returns [] instead of 403/error
                if (!Array.isArray(examData) || examData.length === 0) {
                    throw new Error(
                        'Standard API returned no exams, forcing fallback',
                    );
                }
            } catch (e: any) {
                console.warn(
                    '[timetable] getExamsForRange failed or empty, trying Public API fallback',
                    e?.message,
                );
                try {
                    examData = await fetchExamsFromPublicApi(untis, sd, ed);
                    console.debug(
                        `[timetable] Public API fallback found ${examData.length} exams`,
                    );
                } catch (e2: any) {
                    console.warn(
                        '[timetable] Public API fallback failed',
                        e2?.message,
                    );
                    examData = [];
                }
            }
        }

        // Fallback: Extract exams from timetable lessons if API failed or returned nothing
        if (
            (!examData || examData.length === 0) &&
            lessonsData &&
            lessonsData.length > 0
        ) {
            console.debug('[timetable] scanning lessons for exams (fallback)');

            // 1. Check for explicit exam objects (Public API style)
            // Some Untis instances return exams embedded in lessons with 'is.exam', 'cellState: EXAM', or an 'exam' object
            const explicitExams = lessonsData.filter(
                (l: any) =>
                    l.is?.exam === true ||
                    l.cellState === 'EXAM' ||
                    (l.exam && typeof l.exam === 'object'),
            );

            if (explicitExams.length > 0) {
                console.debug(
                    `[timetable] found ${explicitExams.length} explicit exams in lessons`,
                );
                examData = explicitExams.map((l: any) => ({
                    id: l.exam?.id || l.id,
                    date: l.exam?.date || l.date,
                    startTime: l.startTime,
                    endTime: l.endTime,
                    subject: l.su?.[0]
                        ? { id: l.su[0].id, name: l.su[0].name }
                        : undefined,
                    teachers: l.te?.map((t: any) => t.name),
                    rooms: l.ro?.map((r: any) => r.name),
                    name: l.exam?.name || 'Exam',
                    text: l.lstext || l.info || l.exam?.text || 'Exam',
                }));
            }
        }
    } catch (e: any) {
        const msg = String(e?.message || '').toLowerCase();
        if (
            msg.includes("didn't return any result") ||
            msg.includes('did not return any result') ||
            msg.includes('no result')
        ) {
            console.warn('[timetable] no result from Untis, returning empty');
            lessonsData = [];
            homeworkData = [];
            examData = [];
        } else {
            throw new AppError('Untis fetch failed', 502, 'UNTIS_FETCH_FAILED');
        }
    } finally {
        try {
            await untis.logout?.();
        } catch {}
    }

    // Store exam data in database
    if (examData && Array.isArray(examData) && examData.length > 0) {
        try {
            await storeExamData(target.id, examData);
        } catch (e: any) {
            console.warn('[timetable] failed to store exam data', e?.message);
        }
    }

    // Combine homework and exam data with lessons
    const enrichedLessons = await enrichLessonsWithHomeworkAndExams(
        target.id,
        lessonsData || [],
        sd,
        ed,
    );

    const payload = enrichedLessons;
    const rangeStart = sd ?? null;
    const rangeEnd = ed ?? null;

    const sample = Array.isArray(payload) ? payload.slice(0, 2) : payload;
    console.debug('[timetable] response summary', {
        hasPayload: !!payload,
        type: typeof payload,
        lessonsCount: Array.isArray(lessonsData) ? lessonsData.length : 0,
        homeworkCount: homeworkData.length,
        examsCount: Array.isArray(examData) ? examData.length : 0,
        sample: (() => {
            try {
                return JSON.stringify(sample).slice(0, 500);
            } catch {
                return '[unserializable]';
            }
        })(),
    });

    const record = await prisma.timetable.create({
        data: {
            ownerId: target.id,
            payload,
            rangeStart,
            rangeEnd,
        },
        select: {
            rangeStart: true,
            rangeEnd: true,
            payload: true,
            createdAt: true,
        },
    });

    return {
        userId: target.id,
        rangeStart: record.rangeStart,
        rangeEnd: record.rangeEnd,
        payload: record.payload,
        createdAt: record.createdAt,
    };
}

// Host is fixed via env. Keep helper for future flexibility.
function toHost() {
    return UNTIS_HOST;
}

function parseDate(date?: string) {
    return date ? new Date(date) : undefined;
}

export async function getOrFetchTimetableRange(args: {
    requesterId: string;
    targetUserId: string;
    start?: string | undefined;
    end?: string | undefined;
}) {
    console.debug('[timetable] request', {
        requesterId: args.requesterId,
        targetUserId: args.targetUserId,
        start: args.start,
        end: args.end,
    });
    const target: any = await (prisma as any).user.findUnique({
        where: { id: args.targetUserId },
        select: {
            id: true,
            username: true,
            untisSecretCiphertext: true,
            untisSecretNonce: true,
            untisSecretKeyVersion: true,
        },
    });
    if (!target) throw new Error('Target user not found');

    const { normStart, normEnd } = normalizeRange(args.start, args.end);
    let sd = normStart;
    let ed = normEnd;
    let cached: any = undefined;

    if (sd && ed) {
        try {
            cached = await getCachedRange(target.id, sd, ed);
        } catch (e) {
            console.warn('[timetable] cache lookup failed', e);
        }
        if (cached) {
            return serializeTimetableResponse({
                userId: target.id,
                rangeStart: cached.rangeStart,
                rangeEnd: cached.rangeEnd,
                data: cached.payload,
                cached: true,
                stale: false,
                lastUpdated: cached.createdAt,
            });
        }
    } else {
        // Range not provided: treat as 'today', define single-day normalization
        if (args.start) sd = startOfDay(new Date(args.start));
        if (args.end) ed = endOfDay(new Date(args.end));
    }

    let fresh;
    try {
        fresh = await fetchAndStoreUntis({ target, sd, ed });
    } catch (err: any) {
        if (err instanceof AppError && shouldFallbackToCache(err)) {
            const fallback = await getLatestCachedTimetable({
                ownerId: target.id,
                start: sd ?? null,
                end: ed ?? null,
            });
            if (fallback) {
                console.warn(
                    '[timetable] serving cached timetable due to error',
                    {
                        userId: target.id,
                        code: err.code,
                        message: err.message,
                    },
                );
                const fallbackReason: TimetableFallbackReason =
                    String(err.code ?? '').toUpperCase() === 'BAD_CREDENTIALS'
                        ? 'BAD_CREDENTIALS'
                        : 'UNTIS_UNAVAILABLE';
                return serializeTimetableResponse({
                    userId: target.id,
                    rangeStart: fallback.rangeStart,
                    rangeEnd: fallback.rangeEnd,
                    data: fallback.payload,
                    cached: true,
                    stale: true,
                    lastUpdated: fallback.createdAt,
                    fallbackReason,
                    errorCode: err.code,
                    errorMessage: err.message,
                });
            }
        }
        throw err;
    }

    // Fire & forget adjacent week prefetch if week context present
    if (sd && ed) {
        setTimeout(() => {
            const prevStart = new Date(sd!);
            prevStart.setDate(prevStart.getDate() - 7);
            const prevEnd = new Date(ed!);
            prevEnd.setDate(prevEnd.getDate() - 7);
            const nextStart = new Date(sd!);
            nextStart.setDate(nextStart.getDate() + 7);
            const nextEnd = new Date(ed!);
            nextEnd.setDate(nextEnd.getDate() + 7);
            const tasks = [
                { s: prevStart, e: prevEnd },
                { s: nextStart, e: nextEnd },
            ];
            tasks.forEach(async ({ s, e }) => {
                try {
                    const existing = await getCachedRange(target.id, s, e);
                    if (!existing) {
                        await fetchAndStoreUntis({ target, sd: s, ed: e });
                    }
                } catch (e) {
                    console.debug('[timetable][prefetch] skipped', e);
                }
            });
            pruneOldTimetables();
        }, 5); // slight delay to avoid blocking response
    }

    return serializeTimetableResponse({
        userId: fresh.userId,
        rangeStart: fresh.rangeStart,
        rangeEnd: fresh.rangeEnd,
        data: fresh.payload,
        cached: false,
        stale: false,
        lastUpdated: fresh.createdAt,
    });
}

export async function getHolidays(userId: string) {
    const cached = holidayCache.get(userId);
    if (cached && Date.now() - cached.timestamp < HOLIDAY_CACHE_TTL) {
        return cached.data;
    }

    const target: any = await (prisma as any).user.findUnique({
        where: { id: userId },
        select: {
            id: true,
            username: true,
            untisSecretCiphertext: true,
            untisSecretNonce: true,
            untisSecretKeyVersion: true,
        },
    });
    if (!target) throw new Error('User not found');

    if (!target.untisSecretCiphertext || !target.untisSecretNonce) {
        throw new AppError(
            'User missing encrypted Untis credential',
            400,
            'MISSING_UNTIS_SECRET',
        );
    }
    let untisPassword: string;
    try {
        untisPassword = decryptSecret({
            ciphertext: target.untisSecretCiphertext as any,
            nonce: target.untisSecretNonce as any,
            keyVersion: target.untisSecretKeyVersion || 1,
        });
    } catch (e) {
        throw new AppError(
            'Credential decryption failed',
            500,
            'DECRYPT_FAILED',
        );
    }
    const untis = new WebUntis(
        UNTIS_DEFAULT_SCHOOL,
        target.username,
        untisPassword,
        UNTIS_HOST,
    ) as any;

    try {
        await untis.login();
        let holidays = [];
        if (typeof untis.getHolidays === 'function') {
            holidays = await untis.getHolidays();
        } else {
            console.warn('[untis] getHolidays not available on client');
        }

        holidayCache.set(userId, { data: holidays, timestamp: Date.now() });
        return holidays;
    } catch (e: any) {
        const msg = e?.message || '';
        if (msg.includes('bad credentials')) {
            throw new AppError(
                'Invalid Untis credentials',
                401,
                'BAD_CREDENTIALS',
            );
        }
        // If login fails, try to return cached data even if expired
        if (cached) {
            return cached.data;
        }
        throw new AppError('Untis fetch failed', 502, 'UNTIS_FETCH_FAILED');
    } finally {
        try {
            await untis.logout?.();
        } catch (e) {}
    }
}

export async function getAbsentLessons(args: {
    userId: string;
    start?: string;
    end?: string;
    excuseStatusId?: number;
}) {
    const { rangeStart, rangeEnd } = normalizeAbsenceRange(
        args.start,
        args.end,
    );
    const normalizedExcuseId =
        typeof args.excuseStatusId === 'number' &&
        Number.isFinite(args.excuseStatusId)
            ? args.excuseStatusId
            : -1;
    const cacheKey = buildAbsenceCacheKey({
        userId: args.userId,
        rangeStart,
        rangeEnd,
        excuseStatusId: normalizedExcuseId,
    });
    const cached = absenceCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < ABSENCE_CACHE_TTL_MS) {
        return serializeAbsenceResponse({
            payload: cached.payload,
            cached: true,
            stale: false,
        });
    }

    const untis = await getUntisClientForUser(args.userId);
    let loggedIn = false;
    try {
        await untis.login();
        loggedIn = true;
    } catch (e: any) {
        const msg = e?.message || '';
        const code = msg.includes('bad credentials')
            ? 'BAD_CREDENTIALS'
            : 'UNTIS_LOGIN_FAILED';
        if (cached) {
            const fallbackReason: TimetableFallbackReason =
                code === 'BAD_CREDENTIALS'
                    ? 'BAD_CREDENTIALS'
                    : 'UNTIS_UNAVAILABLE';
            return serializeAbsenceResponse({
                payload: cached.payload,
                cached: true,
                stale: true,
                fallbackReason,
                errorCode: code,
                errorMessage: e?.message,
            });
        }
        if (code === 'BAD_CREDENTIALS') {
            throw new AppError(
                'Invalid Untis credentials',
                401,
                'BAD_CREDENTIALS',
            );
        }
        throw new AppError('Untis login failed', 502, 'UNTIS_LOGIN_FAILED');
    }

    try {
        if (typeof untis.getAbsentLesson !== 'function') {
            throw new AppError(
                'Absent lessons not supported by Untis',
                501,
                'METHOD_NOT_AVAILABLE',
            );
        }
        const raw = await untis.getAbsentLesson(
            rangeStart,
            rangeEnd,
            normalizedExcuseId,
        );
        const payload: AbsenceCachePayload = {
            userId: args.userId,
            rangeStart: rangeStart.toISOString(),
            rangeEnd: rangeEnd.toISOString(),
            absences: Array.isArray(raw?.absences) ? raw?.absences : [],
            absenceReasons: Array.isArray(raw?.absenceReasons)
                ? raw?.absenceReasons
                : [],
            excuseStatuses: Boolean(raw?.excuseStatuses),
            showAbsenceReasonChange: Boolean(raw?.showAbsenceReasonChange),
            showCreateAbsence: Boolean(raw?.showCreateAbsence),
            lastUpdated: new Date(),
        };
        absenceCache.set(cacheKey, {
            payload,
            timestamp: Date.now(),
        });
        return serializeAbsenceResponse({
            payload,
            cached: false,
            stale: false,
        });
    } catch (e: any) {
        if (e instanceof AppError) {
            if (cached && shouldFallbackToCache(e)) {
                const fallbackReason: TimetableFallbackReason =
                    String(e.code ?? '').toUpperCase() === 'BAD_CREDENTIALS'
                        ? 'BAD_CREDENTIALS'
                        : 'UNTIS_UNAVAILABLE';
                return serializeAbsenceResponse({
                    payload: cached.payload,
                    cached: true,
                    stale: true,
                    fallbackReason,
                    errorCode: e.code,
                    errorMessage: e.message,
                });
            }
            throw e;
        }

        if (cached) {
            return serializeAbsenceResponse({
                payload: cached.payload,
                cached: true,
                stale: true,
                fallbackReason: 'UNTIS_UNAVAILABLE',
                errorCode: 'UNTIS_FETCH_FAILED',
                errorMessage: e?.message,
            });
        }
        throw new AppError('Untis fetch failed', 502, 'UNTIS_FETCH_FAILED');
    } finally {
        if (loggedIn) {
            try {
                await untis.logout?.();
            } catch {}
        }
    }
}

export async function verifyUntisCredentials(
    username: string,
    password: string,
) {
    const school = UNTIS_DEFAULT_SCHOOL;
    const host = UNTIS_HOST;
    const untis = new WebUntis(school, username, password, host) as any;
    try {
        await untis.login();
        try {
            await untis.logout?.();
        } catch {}
    } catch (e: any) {
        const msg = e?.message || '';
        if (msg.includes('bad credentials')) {
            throw new AppError(
                'Invalid Untis credentials',
                401,
                'BAD_CREDENTIALS',
            );
        }
        throw new AppError('Untis login failed', 502, 'UNTIS_LOGIN_FAILED');
    }
}

export async function getUserClassInfo(
    username: string,
    password: string,
): Promise<string[]> {
    const school = UNTIS_DEFAULT_SCHOOL;
    const host = UNTIS_HOST;
    const untis = new WebUntis(school, username, password, host) as any;

    try {
        await untis.login();

        // Try to get user's classes/grades
        let classes: string[] = [];

        try {
            // Get current user info which might include class information
            if (typeof untis.getOwnClassesList === 'function') {
                const classList = await untis.getOwnClassesList();
                classes = Array.isArray(classList)
                    ? classList
                          .map((c: any) => c.name || c.longName || String(c))
                          .filter(Boolean)
                    : [];
            } else if (typeof untis.getOwnStudentId === 'function') {
                // Alternative approach: get student info
                const studentId = await untis.getOwnStudentId();
                if (studentId && typeof untis.getStudent === 'function') {
                    const student = await untis.getStudent(studentId);
                    if (student?.klasse) {
                        classes = Array.isArray(student.klasse)
                            ? student.klasse
                                  .map(
                                      (k: any) =>
                                          k.name || k.longName || String(k),
                                  )
                                  .filter(Boolean)
                            : [String(student.klasse)];
                    }
                }
            }

            // If we still don't have classes, try to get them from the general classes list
            if (
                classes.length === 0 &&
                typeof untis.getClasses === 'function'
            ) {
                const allClasses = await untis.getClasses();
                if (Array.isArray(allClasses)) {
                    // This is a fallback - we can't determine user's specific class this way
                    // but we'll return empty array and rely on username whitelist
                    classes = [];
                }
            }
        } catch (e: any) {
            console.warn(
                '[whitelist] failed to get user class info',
                e?.message,
            );
            classes = [];
        }

        try {
            await untis.logout?.();
        } catch {}

        return classes;
    } catch (e: any) {
        const msg = e?.message || '';
        if (msg.includes('bad credentials')) {
            throw new AppError(
                'Invalid Untis credentials',
                401,
                'BAD_CREDENTIALS',
            );
        }
        throw new AppError('Untis login failed', 502, 'UNTIS_LOGIN_FAILED');
    }
}

async function storeHomeworkData(
    userId: string,
    homeworkData: any[],
    lessonSubjectByLessonId?: Map<number, string>,
) {
    for (const hw of homeworkData) {
        try {
            // Determine subject string via mapping (fallback to hw.subject?.name)
            const subjectStr =
                (typeof hw.lessonId === 'number' &&
                    lessonSubjectByLessonId?.get(hw.lessonId)) ||
                hw.subject?.name ||
                '';
            await (prisma as any).homework.upsert({
                where: { userId_untisId: { userId, untisId: hw.id } },
                update: {
                    lessonId: hw.lessonId,
                    // Store due date; Untis returns both date (assigned) and dueDate
                    date: hw.dueDate ?? hw.date,
                    subjectId: Number.isInteger(hw.subject?.id)
                        ? hw.subject?.id
                        : 0,
                    subject: subjectStr,
                    text: hw.text || '',
                    remark: hw.remark,
                    completed: hw.completed || false,
                    fetchedAt: new Date(),
                },
                create: {
                    untisId: hw.id,
                    userId,
                    lessonId: hw.lessonId,
                    // Store due date; Untis returns both date (assigned) and dueDate
                    date: hw.dueDate ?? hw.date,
                    subjectId: Number.isInteger(hw.subject?.id)
                        ? hw.subject?.id
                        : 0,
                    subject: subjectStr,
                    text: hw.text || '',
                    remark: hw.remark,
                    completed: hw.completed || false,
                },
            });
        } catch (e: any) {
            console.warn(
                `[homework] failed to store homework ${hw?.id}:`,
                e?.message,
            );
        }
    }
}

export async function storeExamData(userId: string, examData: any[]) {
    // Group exams by ID to handle multi-lesson exams
    const examsById = new Map<number, any[]>();
    for (const exam of examData) {
        if (!examsById.has(exam.id)) {
            examsById.set(exam.id, []);
        }
        examsById.get(exam.id)?.push(exam);
    }

    for (const [id, exams] of examsById) {
        // Sort by start time to find range
        exams.sort((a, b) => a.startTime - b.startTime);

        const first = exams[0];
        const last = exams[exams.length - 1];

        // Use the aggregated range
        const startTime = first.startTime;
        const endTime = last.endTime;

        // Use properties from the first entry (assuming they are consistent)
        const exam = first;

        try {
            await (prisma as any).exam.upsert({
                where: { userId_untisId: { userId, untisId: exam.id } },
                update: {
                    date: exam.date,
                    startTime: startTime,
                    endTime: endTime,
                    subjectId: exam.subject?.id || 0,
                    subject: exam.subject?.name || '',
                    name: exam.name || '',
                    text: exam.text,
                    // Store as JSON or set null when absent
                    teachers: exam.teachers ?? null,
                    rooms: exam.rooms ?? null,
                    fetchedAt: new Date(),
                },
                create: {
                    untisId: exam.id,
                    userId,
                    date: exam.date,
                    startTime: startTime,
                    endTime: endTime,
                    subjectId: exam.subject?.id || 0,
                    subject: exam.subject?.name || '',
                    name: exam.name || '',
                    text: exam.text,
                    // Store as JSON or set null when absent
                    teachers: exam.teachers ?? null,
                    rooms: exam.rooms ?? null,
                },
            });
        } catch (e: any) {
            console.warn(`[exam] failed to store exam ${exam.id}:`, e?.message);
        }
    }
}

async function enrichLessonsWithHomeworkAndExams(
    userId: string,
    lessons: any[],
    startDate?: Date,
    endDate?: Date,
): Promise<any[]> {
    if (!Array.isArray(lessons)) return lessons;

    // Get homework and exams for the date range (due date for homework)
    const whereClause: any = { userId };
    if (startDate && endDate) {
        const startDateInt = parseInt(
            startDate.toISOString().slice(0, 10).replace(/-/g, ''),
        );
        const endDateInt = parseInt(
            endDate.toISOString().slice(0, 10).replace(/-/g, ''),
        );
        whereClause.date = {
            gte: startDateInt,
            lte: endDateInt,
        };
    }

    const [homework, exams] = await Promise.all([
        (prisma as any).homework.findMany({ where: whereClause }),
        (prisma as any).exam.findMany({ where: whereClause }),
    ]);

    const lessonMatchesHw = (hw: any, lesson: any) => {
        const idsToCheck = [
            lesson?.id,
            lesson?.lsnumber,
            lesson?.lsNumber,
            lesson?.ls,
            lesson?.lessonId,
        ].filter((v) => typeof v === 'number');
        return idsToCheck.some((v) => v === hw.lessonId);
    };

    const subjectMatches = (hwSubject: string, lessonSubject: string) => {
        if (!hwSubject || !lessonSubject) return false;
        // Normalize subject names for comparison (case insensitive, trim whitespace)
        return (
            hwSubject.toLowerCase().trim() ===
            lessonSubject.toLowerCase().trim()
        );
    };

    // Helper to check if homework date is within a reasonable range of lesson date
    const dateWithinRange = (
        hwDate: number,
        lessonDate: number,
        dayRange: number = 7,
    ) => {
        if (hwDate === lessonDate) return true;

        // Convert YYYYMMDD to Date objects for comparison
        const hwDateObj = new Date(
            Math.floor(hwDate / 10000),
            Math.floor((hwDate % 10000) / 100) - 1,
            hwDate % 100,
        );
        const lessonDateObj = new Date(
            Math.floor(lessonDate / 10000),
            Math.floor((lessonDate % 10000) / 100) - 1,
            lessonDate % 100,
        );

        const diffMs = Math.abs(hwDateObj.getTime() - lessonDateObj.getTime());
        const diffDays = diffMs / (1000 * 60 * 60 * 24);
        return diffDays <= dayRange;
    };

    // Enrich lessons with homework and exam data
    const lessonsWithCandidates = lessons.map((lesson) => {
        const subjectName = lesson.su?.[0]?.name;
        const lessonHomework = homework
            .filter((hw: any) => {
                // Primary matching: homework lessonId matches lesson ID
                if (lessonMatchesHw(hw, lesson)) {
                    return true;
                }

                // Secondary matching: subject matches and date is within reasonable range
                if (
                    hw.subject &&
                    subjectName &&
                    subjectMatches(hw.subject, subjectName)
                ) {
                    // Only attach if homework date is within 7 days of lesson date
                    // This prevents homework from being attached to all lessons of same subject
                    if (dateWithinRange(hw.date, lesson.date, 7)) {
                        return true;
                    }
                }

                return false;
            })
            .map((hw: any) => ({
                id: hw.untisId,
                lessonId: hw.lessonId,
                date: hw.date,
                subject: { id: hw.subjectId, name: hw.subject },
                text: hw.text,
                remark: hw.remark,
                completed: hw.completed,
            }));

        const lessonExams = exams
            .filter((exam: any) => {
                if (exam.date !== lesson.date) return false;
                // Do not attach exams to cancelled lessons
                if (lesson.code === 'cancelled') return false;

                // 1. Try exact subject match (case insensitive)
                const subjectMatch =
                    exam.subject &&
                    lesson.su?.[0]?.name &&
                    exam.subject.toLowerCase() ===
                        lesson.su[0].name.toLowerCase();

                if (subjectMatch) {
                    return true;
                }

                // 2. If subjects don't match (or one is missing), check for time overlap
                // This handles cases where exam subject might be generic or missing
                // Overlap: (StartA <= EndB) and (EndA >= StartB)
                const examStart = exam.startTime;
                const examEnd = exam.endTime;
                const lessonStart = lesson.startTime;
                const lessonEnd = lesson.endTime;

                if (examStart < lessonEnd && examEnd > lessonStart) {
                    // If exam has a subject and lesson has a DIFFERENT subject, do not match
                    if (exam.subject && lesson.su?.[0]?.name && !subjectMatch) {
                        return false;
                    }
                    return true;
                }

                return false;
            })
            .map((exam: any) => ({
                id: exam.untisId,
                date: exam.date,
                startTime: exam.startTime,
                endTime: exam.endTime,
                subject: { id: exam.subjectId, name: exam.subject },
                // Values are already JSON in DB
                teachers: exam.teachers ?? undefined,
                rooms: exam.rooms ?? undefined,
                name: exam.name,
                text: exam.text,
            }));

        return {
            ...lesson,
            homework: lessonHomework.length > 0 ? lessonHomework : undefined,
            exams: lessonExams.length > 0 ? lessonExams : undefined,
        };
    });

    // Pruning: Resolve conflicts where an exam is attached to multiple overlapping lessons
    // This happens when an exam (especially one without a specific subject) matches multiple lessons in the same time slot.
    // We use heuristics to pick the "best" lesson for the exam.

    const examToLessons = new Map<number, any[]>();
    for (const l of lessonsWithCandidates) {
        if (l.exams) {
            for (const e of l.exams) {
                if (!examToLessons.has(e.id)) examToLessons.set(e.id, []);
                examToLessons.get(e.id)?.push(l);
            }
        }
    }

    const removals = new Set<string>(); // Set of "lessonId_examId" to remove

    for (const [examId, candidateLessons] of examToLessons) {
        // Compare every pair of lessons that have this exam
        for (let i = 0; i < candidateLessons.length; i++) {
            for (let j = i + 1; j < candidateLessons.length; j++) {
                const l1 = candidateLessons[i];
                const l2 = candidateLessons[j];

                // Check for time overlap between the two lessons
                // (StartA < EndB) and (EndA > StartB)
                if (l1.startTime < l2.endTime && l1.endTime > l2.startTime) {
                    // They overlap. Determine which one is a better fit for this exam.

                    // Get the exam object (from l1, assuming identical across lessons)
                    const exam = l1.exams.find((e: any) => e.id === examId);

                    let l1Score = 0;
                    let l2Score = 0;

                    // Heuristic 1: Subject Match (Highest Priority)
                    // If the exam has a subject, prefer the lesson with matching subject
                    if (exam && exam.subject && exam.subject.name) {
                        const eSub = exam.subject.name.toLowerCase();
                        const s1 = l1.su?.[0]?.name?.toLowerCase();
                        const s2 = l2.su?.[0]?.name?.toLowerCase();

                        if (s1 === eSub) l1Score += 10;
                        if (s2 === eSub) l2Score += 10;
                    }

                    // Heuristic 2: Teacher Presence (Medium Priority)
                    // Prefer lessons that have a valid teacher assigned (likely not cancelled/empty)
                    // "---" or "?" are often placeholders for cancelled/substituted lessons without a teacher
                    const hasValidTeacher = (l: any) =>
                        l.te &&
                        l.te.some(
                            (t: any) =>
                                t.name &&
                                t.name.trim() !== '---' &&
                                t.name.trim() !== '?',
                        );

                    if (hasValidTeacher(l1)) l1Score += 5;
                    if (hasValidTeacher(l2)) l2Score += 5;

                    // Heuristic 3: Subject Presence (Low Priority)
                    // Prefer lessons that have a subject assigned
                    if (l1.su && l1.su.length > 0) l1Score += 1;
                    if (l2.su && l2.su.length > 0) l2Score += 1;

                    // Mark the loser for removal
                    if (l1Score > l2Score) {
                        removals.add(`${l2.id}_${examId}`);
                    } else if (l2Score > l1Score) {
                        removals.add(`${l1.id}_${examId}`);
                    } else {
                        // Tie-breaker: Prefer the shorter lesson (more specific)
                        // If durations are equal, prefer the one that starts later (often more specific in some contexts, or arbitrary stable sort)
                        const d1 = l1.endTime - l1.startTime;
                        const d2 = l2.endTime - l2.startTime;
                        if (d1 < d2) {
                            removals.add(`${l2.id}_${examId}`);
                        } else if (d2 < d1) {
                            removals.add(`${l1.id}_${examId}`);
                        } else {
                            // If durations equal, remove from the one with larger ID (arbitrary stable tie-breaker)
                            // This ensures we don't keep it on both
                            if (l1.id > l2.id) {
                                removals.add(`${l1.id}_${examId}`);
                            } else {
                                removals.add(`${l2.id}_${examId}`);
                            }
                        }
                    }
                }
            }
        }
    }

    // Apply removals
    return lessonsWithCandidates.map((l) => {
        if (!l.exams) return l;
        const filtered = l.exams.filter(
            (e: any) => !removals.has(`${l.id}_${e.id}`),
        );
        return {
            ...l,
            exams: filtered.length > 0 ? filtered : undefined,
        };
    });
}

export async function fetchExamsFromPublicApi(
    untis: any,
    start: Date,
    end: Date,
) {
    const exams: any[] = [];
    // Clone start date
    const current = new Date(start);

    // Align to Monday of the start week
    const day = current.getDay();
    const diff = current.getDate() - day + (day === 0 ? -6 : 1);
    current.setDate(diff);

    // Loop until we pass the end date
    // We add a buffer to end date to ensure we cover the last week if it's partial
    const loopEnd = new Date(end);
    loopEnd.setDate(loopEnd.getDate() + 7);

    while (current <= end) {
        try {
            // getOwnTimetableForWeek is available on the untis instance
            if (typeof untis.getOwnTimetableForWeek === 'function') {
                console.debug(
                    `[timetable] fetchExamsFromPublicApi: fetching week ${current.toISOString()}`,
                );
                const weekLessons = await untis.getOwnTimetableForWeek(current);
                console.debug(
                    `[timetable] fetchExamsFromPublicApi: got ${weekLessons.length} lessons`,
                );

                const explicitExams = weekLessons.filter(
                    (l: any) =>
                        l.is?.exam === true ||
                        l.cellState === 'EXAM' ||
                        (l.exam && typeof l.exam === 'object'),
                );

                console.debug(
                    `[timetable] fetchExamsFromPublicApi: found ${explicitExams.length} exams in week`,
                );

                if (explicitExams.length > 0) {
                    exams.push(
                        ...explicitExams.map((l: any) => ({
                            id: l.exam?.id || l.id,
                            date: l.exam?.date || l.date,
                            startTime: l.startTime,
                            endTime: l.endTime,
                            subject: l.su?.[0]
                                ? { id: l.su[0].id, name: l.su[0].name }
                                : undefined,
                            teachers: l.te?.map((t: any) => t.name),
                            rooms: l.ro?.map((r: any) => r.name),
                            name: l.exam?.name || 'Exam',
                            text: l.lstext || l.info || l.exam?.text || 'Exam',
                        })),
                    );
                }
            }
        } catch (e) {
            // Ignore errors for individual weeks (e.g. holidays, future years)
        }
        // Advance 7 days
        current.setDate(current.getDate() + 7);
    }
    return exams;
}

export async function getUntisClientForUser(userId: string) {
    const target: any = await (prisma as any).user.findUnique({
        where: { id: userId },
        select: {
            id: true,
            username: true,
            untisSecretCiphertext: true,
            untisSecretNonce: true,
            untisSecretKeyVersion: true,
        },
    });
    if (!target) throw new Error('User not found');

    if (!target.untisSecretCiphertext || !target.untisSecretNonce) {
        throw new AppError(
            'User missing encrypted Untis credential',
            400,
            'MISSING_UNTIS_SECRET',
        );
    }
    let untisPassword: string;
    try {
        untisPassword = decryptSecret({
            ciphertext: target.untisSecretCiphertext as any,
            nonce: target.untisSecretNonce as any,
            keyVersion: target.untisSecretKeyVersion || 1,
        });
    } catch (e) {
        throw new AppError(
            'Credential decryption failed',
            500,
            'DECRYPT_FAILED',
        );
    }
    const untis = new WebUntis(
        UNTIS_DEFAULT_SCHOOL,
        target.username,
        untisPassword,
        UNTIS_HOST,
    ) as any;

    return untis;
}

export async function updateExamsForUser(
    userId: string,
    start: Date,
    end: Date,
) {
    const untis = await getUntisClientForUser(userId);
    try {
        await untis.login();
    } catch (e: any) {
        const msg = e?.message || '';
        if (msg.includes('bad credentials')) {
            throw new AppError(
                'Invalid Untis credentials',
                401,
                'BAD_CREDENTIALS',
            );
        }
        throw new AppError('Untis login failed', 502, 'UNTIS_LOGIN_FAILED');
    }

    try {
        const exams = await fetchExamsFromPublicApi(untis, start, end);
        if (exams.length > 0) {
            await storeExamData(userId, exams);
        }
        return exams.length;
    } finally {
        try {
            await untis.logout();
        } catch {}
    }
}

/**
 * Get list of classes available to the user
 */
export async function getUserClasses(userId: string): Promise<
    Array<{
        id: number;
        name: string;
        longName: string;
    }>
> {
    const cached = classListCache.get(userId);
    if (cached && Date.now() - cached.timestamp < CLASS_LIST_CACHE_TTL) {
        return cached.data;
    }
    const target: any = await (prisma as any).user.findUnique({
        where: { id: userId },
        select: {
            id: true,
            username: true,
            untisSecretCiphertext: true,
            untisSecretNonce: true,
            untisSecretKeyVersion: true,
        },
    });
    if (!target) throw new Error('User not found');

    if (!target.untisSecretCiphertext || !target.untisSecretNonce) {
        throw new AppError(
            'User missing encrypted Untis credential',
            400,
            'MISSING_UNTIS_SECRET',
        );
    }

    let untisPassword: string;
    try {
        untisPassword = decryptSecret({
            ciphertext: target.untisSecretCiphertext as any,
            nonce: target.untisSecretNonce as any,
            keyVersion: target.untisSecretKeyVersion || 1,
        });
    } catch (e) {
        console.error('[classes] decrypt secret failed', e);
        throw new AppError(
            'Credential decryption failed',
            500,
            'DECRYPT_FAILED',
        );
    }

    const school = UNTIS_DEFAULT_SCHOOL;
    const host = toHost();
    const untis = new WebUntis(
        school,
        target.username,
        untisPassword,
        host,
    ) as any;

    try {
        await untis.login();
    } catch (e: any) {
        const msg = e?.message || '';
        if (msg.includes('bad credentials')) {
            throw new AppError(
                'Invalid Untis credentials',
                401,
                'BAD_CREDENTIALS',
            );
        }
        throw new AppError('Untis login failed', 502, 'UNTIS_LOGIN_FAILED');
    }

    try {
        const classes = await fetchOwnClassesFromUntis(untis);
        try {
            await untis.logout?.();
        } catch {}
        if (!classes.length) {
            throw new AppError(
                'No classes linked to this account',
                404,
                'NO_CLASSES_FOUND',
            );
        }
        classListCache.set(userId, { data: classes, timestamp: Date.now() });
        return classes;
    } catch (e: any) {
        try {
            await untis.logout?.();
        } catch {}
        if (e instanceof AppError) throw e;
        throw new AppError(
            'Failed to fetch classes',
            502,
            'UNTIS_FETCH_FAILED',
        );
    }
}

/**
 * Fetch all teachers from Untis (global list)
 */
export async function getAllTeachersFromUntis(requesterId: string): Promise<any[]> {
    const cached = allTeachersCache.get('global');
    if (cached && Date.now() - cached.timestamp < ALL_TEACHERS_CACHE_TTL) {
        return cached.data;
    }

    const requester: any = await (prisma as any).user.findUnique({
        where: { id: requesterId },
        select: {
            id: true,
            username: true,
            untisSecretCiphertext: true,
            untisSecretNonce: true,
            untisSecretKeyVersion: true,
        },
    });
    if (!requester) throw new Error('Requester not found');

    const untisPassword = await decryptSecret({
        ciphertext: requester.untisSecretCiphertext,
        nonce: requester.untisSecretNonce,
        keyVersion: requester.untisSecretKeyVersion,
    });

    const untis = new WebUntis(
        UNTIS_DEFAULT_SCHOOL,
        requester.username,
        untisPassword,
        UNTIS_HOST,
    ) as any;

    try {
        await untis.login();
        const teachers = await untis.getTeachers();
        try {
            await untis.logout?.();
        } catch {}
        allTeachersCache.set('global', { data: teachers, timestamp: Date.now() });
        return teachers;
    } catch (e: any) {
        try {
            await untis.logout?.();
        } catch {}
        console.error('[untis] Failed to fetch teachers list', e);
        return [];
    }
}

/**
 * Fetch class timetable for a given date range
 */
export async function getClassTimetable(args: {
    requesterId: string;
    classId: number;
    start?: string | undefined;
    end?: string | undefined;
}): Promise<any> {
    console.debug('[class-timetable] request', {
        requesterId: args.requesterId,
        classId: args.classId,
        start: args.start,
        end: args.end,
    });

    const requester: any = await (prisma as any).user.findUnique({
        where: { id: args.requesterId },
        select: {
            id: true,
            username: true,
            untisSecretCiphertext: true,
            untisSecretNonce: true,
            untisSecretKeyVersion: true,
        },
    });
    if (!requester) throw new Error('Requester not found');

    const { normStart, normEnd } = normalizeRange(args.start, args.end);
    const sd = normStart || startOfDay(new Date());
    const ed = normEnd || endOfDay(new Date());

    const requestedClassId = Number.isFinite(args.classId)
        ? args.classId
        : undefined;
    const cachedClasses = classListCache.get(requester.id);
    let allowedClasses: UserClassRecord[] =
        cachedClasses &&
        Date.now() - cachedClasses.timestamp < CLASS_LIST_CACHE_TTL
            ? (cachedClasses.data ?? [])
            : [];
    let resolvedClassId = resolvePermittedClassId(
        requestedClassId,
        allowedClasses,
    );
    let cachedTimetableRecord: any | null = null;

    if (typeof resolvedClassId === 'number') {
        try {
            cachedTimetableRecord = await getCachedClassRange(
                resolvedClassId,
                sd,
                ed,
            );
            if (cachedTimetableRecord) {
                return serializeTimetableResponse({
                    userId: requester.id,
                    rangeStart: cachedTimetableRecord.rangeStart,
                    rangeEnd: cachedTimetableRecord.rangeEnd,
                    data: cachedTimetableRecord.payload,
                    cached: true,
                    stale: false,
                    lastUpdated: cachedTimetableRecord.createdAt,
                });
            }
        } catch (e) {
            console.warn('[class-timetable] cache lookup failed', e);
        }
    }

    if (!requester.untisSecretCiphertext || !requester.untisSecretNonce) {
        throw new AppError(
            'User missing encrypted Untis credential',
            400,
            'MISSING_UNTIS_SECRET',
        );
    }

    let untisPassword: string;
    try {
        untisPassword = decryptSecret({
            ciphertext: requester.untisSecretCiphertext as any,
            nonce: requester.untisSecretNonce as any,
            keyVersion: requester.untisSecretKeyVersion || 1,
        });
    } catch (e) {
        console.error('[class-timetable] decrypt secret failed', e);
        throw new AppError(
            'Credential decryption failed',
            500,
            'DECRYPT_FAILED',
        );
    }

    const school = UNTIS_DEFAULT_SCHOOL;
    const host = toHost();
    const untis = new WebUntis(
        school,
        requester.username,
        untisPassword,
        host,
    ) as any;

    try {
        try {
            await untis.login();
        } catch (e: any) {
            const msg = e?.message || '';
            if (msg.includes('bad credentials')) {
                throw new AppError(
                    'Invalid Untis credentials',
                    401,
                    'BAD_CREDENTIALS',
                );
            }
            throw new AppError('Untis login failed', 502, 'UNTIS_LOGIN_FAILED');
        }

        if (!allowedClasses.length) {
            allowedClasses = await fetchOwnClassesFromUntis(untis);
            if (allowedClasses.length) {
                classListCache.set(requester.id, {
                    data: allowedClasses,
                    timestamp: Date.now(),
                });
            }
        }

        resolvedClassId =
            resolvedClassId ??
            resolvePermittedClassId(requestedClassId, allowedClasses);

        if (typeof resolvedClassId !== 'number') {
            throw new AppError(
                'No classes linked to this account',
                404,
                'NO_CLASSES_FOUND',
            );
        }

        if (!cachedTimetableRecord) {
            try {
                cachedTimetableRecord = await getCachedClassRange(
                    resolvedClassId,
                    sd,
                    ed,
                );
                if (cachedTimetableRecord) {
                    await untis.logout?.();
                    return serializeTimetableResponse({
                        userId: requester.id,
                        rangeStart: cachedTimetableRecord.rangeStart,
                        rangeEnd: cachedTimetableRecord.rangeEnd,
                        data: cachedTimetableRecord.payload,
                        cached: true,
                        stale: false,
                        lastUpdated: cachedTimetableRecord.createdAt,
                    });
                }
            } catch (cacheErr) {
                console.warn('[class-timetable] cache lookup failed', cacheErr);
            }
        }

        let lessonsData: any;
        if (typeof untis.getTimetableForRange === 'function') {
            console.debug('[class-timetable] calling getTimetableForRange', {
                start: sd,
                end: ed,
                classId: resolvedClassId,
            });
            try {
                lessonsData = await untis.getTimetableForRange(
                    sd,
                    ed,
                    resolvedClassId,
                    1,
                );
            } catch (err: any) {
                const msg = String(err?.message || '').toLowerCase();
                if (
                    msg.includes("didn't return any result") ||
                    msg.includes('did not return any result') ||
                    msg.includes('no result')
                ) {
                    console.warn(
                        '[class-timetable] no result from Untis, returning empty',
                    );
                    lessonsData = [];
                } else {
                    throw new AppError(
                        'Untis fetch failed',
                        502,
                        'UNTIS_FETCH_FAILED',
                    );
                }
            }
        } else {
            throw new AppError(
                'getTimetableForRange not available',
                501,
                'METHOD_NOT_AVAILABLE',
            );
        }

        // Class timetable does not include exams (exams are user-specific)
        const payload = Array.isArray(lessonsData) ? lessonsData : [];
        const record = await storeClassTimetableRecord({
            classId: resolvedClassId,
            rangeStart: sd,
            rangeEnd: ed,
            payload,
        });

        try {
            await untis.logout?.();
        } catch {}

        setTimeout(() => {
            pruneOldClassTimetables();
        }, 5);

        return serializeTimetableResponse({
            userId: requester.id,
            rangeStart: record.rangeStart,
            rangeEnd: record.rangeEnd,
            data: record.payload,
            cached: false,
            stale: false,
            lastUpdated: record.createdAt,
        });
    } catch (e: any) {
        try {
            await untis.logout?.();
        } catch {}

        if (
            e instanceof AppError &&
            shouldFallbackToCache(e) &&
            typeof resolvedClassId === 'number'
        ) {
            const fallback = await getLatestCachedClassTimetable({
                classId: resolvedClassId,
                start: sd,
                end: ed,
            });
            if (fallback) {
                const fallbackReason: TimetableFallbackReason =
                    String(e.code ?? '').toUpperCase() === 'BAD_CREDENTIALS'
                        ? 'BAD_CREDENTIALS'
                        : 'UNTIS_UNAVAILABLE';
                return serializeTimetableResponse({
                    userId: requester.id,
                    rangeStart: fallback.rangeStart,
                    rangeEnd: fallback.rangeEnd,
                    data: fallback.payload,
                    cached: true,
                    stale: true,
                    lastUpdated: fallback.createdAt,
                    fallbackReason,
                    errorCode: e.code,
                    errorMessage: e.message,
                });
            }
        }

        if (e instanceof AppError) {
            throw e;
        }

        const msg = e?.message || '';
        if (msg.includes('bad credentials')) {
            throw new AppError(
                'Invalid Untis credentials',
                401,
                'BAD_CREDENTIALS',
            );
        }
        throw new AppError(
            'Failed to fetch class timetable',
            502,
            'UNTIS_FETCH_FAILED',
        );
    }
}

/**
 * Search for classes matching a query
 */
export async function searchClasses(
    userId: string,
    query: string,
): Promise<UserClassRecord[]> {
    const q = query.trim().toLowerCase();
    if (!q) return [];

    // Check cache first
    const cached = allClassesCache.get(userId);
    let classes: UserClassRecord[] = [];

    if (cached && Date.now() - cached.timestamp < ALL_CLASSES_CACHE_TTL) {
        classes = cached.data;
    } else {
        const target: any = await (prisma as any).user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                username: true,
                untisSecretCiphertext: true,
                untisSecretNonce: true,
                untisSecretKeyVersion: true,
            },
        });
        if (!target) throw new Error('User not found');

        if (!target.untisSecretCiphertext || !target.untisSecretNonce) {
            throw new AppError(
                'User missing encrypted Untis credential',
                400,
                'MISSING_UNTIS_SECRET',
            );
        }

        let untisPassword: string;
        try {
            untisPassword = decryptSecret({
                ciphertext: target.untisSecretCiphertext as any,
                nonce: target.untisSecretNonce as any,
                keyVersion: target.untisSecretKeyVersion || 1,
            });
        } catch (e) {
            throw new AppError(
                'Credential decryption failed',
                500,
                'DECRYPT_FAILED',
            );
        }

        const school = UNTIS_DEFAULT_SCHOOL;
        const host = toHost();
        const untis = new WebUntis(
            school,
            target.username,
            untisPassword,
            host,
        ) as any;

        try {
            await untis.login();
            const rawClasses = await untis.getClasses();
            if (Array.isArray(rawClasses)) {
                classes = rawClasses
                    .map((c: any) => normalizeUntisClass(c))
                    .filter((c): c is UserClassRecord => c !== null);
            }
            try {
                await untis.logout?.();
            } catch {}

            // Cache the result
            allClassesCache.set(userId, {
                data: classes,
                timestamp: Date.now(),
            });
        } catch (e: any) {
            try {
                await untis.logout?.();
            } catch {}
            const msg = e?.message || '';
            if (msg.includes('bad credentials')) {
                throw new AppError(
                    'Invalid Untis credentials',
                    401,
                    'BAD_CREDENTIALS',
                );
            }
            // If fetch fails but we have stale cache, return it
            if (cached) {
                classes = cached.data;
            } else {
                throw new AppError(
                    'Failed to fetch classes',
                    502,
                    'UNTIS_FETCH_FAILED',
                );
            }
        }
    }

    // Filter classes by query
    return classes
        .filter(
            (c) =>
                c.name.toLowerCase().includes(q) ||
                c.longName.toLowerCase().includes(q),
        )
        .slice(0, 20); // Limit results
}

export async function fetchAbsencesFromUntis(
    userId: string,
    start: Date,
    end: Date,
) {
    const untis = await getUntisClientForUser(userId);
    try {
        await untis.login();
    } catch (e: any) {
        const msg = e?.message || '';
        if (msg.includes('bad credentials')) {
            throw new AppError(
                'Invalid Untis credentials',
                401,
                'BAD_CREDENTIALS',
            );
        }
        throw new AppError('Untis login failed', 502, 'UNTIS_LOGIN_FAILED');
    }

    try {
        if (typeof untis.getAbsentLesson !== 'function') {
            return [];
        }
        const raw = await untis.getAbsentLesson(start, end, -1);
        const absences = Array.isArray(raw?.absences) ? raw.absences : [];
        const reasons = Array.isArray(raw?.absenceReasons)
            ? raw.absenceReasons
            : [];

        // Map reasons for completeness
        const reasonsMap = new Map();
        for (const r of reasons) {
            reasonsMap.set(r.id, r.name);
        }

        return absences.map((a: any) => ({
            ...a,
            reason: a.reasonId ? reasonsMap.get(a.reasonId) || null : null,
        }));
    } finally {
        try {
            await untis.logout();
        } catch {}
    }
}

export async function storeAbsenceData(userId: string, absenceData: any[]) {
    for (const abs of absenceData) {
        try {
            await (prisma as any).absence.upsert({
                where: { userId_untisId: { userId, untisId: abs.id } },
                update: {
                    startDate: abs.startDate,
                    endDate: abs.endDate,
                    startTime: abs.startTime,
                    endTime: abs.endTime,
                    reason: abs.reason,
                    isExcused: abs.isExcused,
                    fetchedAt: new Date(),
                },
                create: {
                    untisId: abs.id,
                    userId,
                    startDate: abs.startDate,
                    endDate: abs.endDate,
                    startTime: abs.startTime,
                    endTime: abs.endTime,
                    reason: abs.reason,
                    isExcused: abs.isExcused,
                },
            });
        } catch (e: any) {
            console.warn(
                `[absence] failed to store absence ${abs.id}:`,
                e?.message,
            );
        }
    }
}
