// Resource overview for user managers: teacher and room timetables derived
// from the cached timetables of every class (one representative account per class).

import { prisma } from '../store/prisma.js';
import { AppError } from '../server/errors.js';
import {
    aggregateWeek,
    freeRooms,
    resourceLessons,
    summarize,
    type FreeRoomsResponse,
    type ResourceSummary,
    type ResourceType,
    type WeekAggregate,
} from './resources/aggregate.js';
import {
    getRefreshJob,
    hasAccountsNeedingDiscovery,
    startRefreshJob,
    type RefreshJobSnapshot,
} from './resources/refreshJob.js';
import {
    getSchoolMetadata,
    hasCredentialsWhere,
    isFresh,
    parseWeek,
    type Week,
} from './resources/shared.js';

// Don't keep re-triggering automatic refreshes for a week whose fetch keeps failing
const AUTO_REFRESH_COOLDOWN_MS = 10 * 60 * 1000;

export type ClassCoverageStatus =
    | 'fresh'
    | 'stale'
    | 'missing'
    | 'no-account'
    | 'failed';

export type ResourceIndexResponse = {
    week: { key: string; start: string; end: string };
    lastUpdated: string | null;
    coverage: {
        total: number;
        withData: number;
        classes: Array<{
            id: number;
            name: string;
            longName: string;
            status: ClassCoverageStatus;
            lastUpdated: string | null;
            error?: string;
        }>;
    };
    teachers: ResourceSummary[];
    rooms: ResourceSummary[];
    job: RefreshJobSnapshot | null;
};

type CachedAggregate = { signature: string; aggregate: WeekAggregate };
const aggregateCache = new Map<string, CachedAggregate>();
const lastAutoRefresh = new Map<string, number>();

type RowInfo = { id: string; classId: number; createdAt: Date };

async function latestRows(week: Week): Promise<RowInfo[]> {
    return prisma.classTimetableCache.findMany({
        where: { rangeStart: week.start, rangeEnd: week.end },
        orderBy: [{ classId: 'asc' }, { createdAt: 'desc' }],
        distinct: ['classId'],
        select: { id: true, classId: true, createdAt: true },
    });
}

function newest(rows: RowInfo[]): Date | null {
    return rows.reduce<Date | null>(
        (max, r) => (!max || r.createdAt > max ? r.createdAt : max),
        null,
    );
}

async function loadAggregate(week: Week, rows: RowInfo[]): Promise<WeekAggregate> {
    const signature = rows.map((r) => r.id).join(',');
    const cached = aggregateCache.get(week.key);
    if (cached && cached.signature === signature) return cached.aggregate;

    const payloadRows = rows.length
        ? await prisma.classTimetableCache.findMany({
              where: { id: { in: rows.map((r) => r.id) } },
              select: { payload: true },
          })
        : [];
    const aggregate = aggregateWeek(payloadRows.map((r) => r.payload));
    aggregateCache.delete(week.key);
    aggregateCache.set(week.key, { signature, aggregate });
    // Keep memory bounded: only a handful of recently viewed weeks
    if (aggregateCache.size > 8) {
        const oldest = aggregateCache.keys().next().value;
        if (oldest !== undefined) aggregateCache.delete(oldest);
    }
    return aggregate;
}

export async function getResourceIndex(weekParam?: string): Promise<ResourceIndexResponse> {
    const week = parseWeek(weekParam);
    const [metadata, rows, memberships] = await Promise.all([
        getSchoolMetadata(),
        latestRows(week),
        prisma.userClassMembership.findMany({
            where: { user: hasCredentialsWhere },
            distinct: ['classId'],
            select: { classId: true },
        }),
    ]);
    const aggregate = await loadAggregate(week, rows);
    const rowByClass = new Map(rows.map((r) => [r.classId, r]));
    const classesWithAccount = new Set(memberships.map((m) => m.classId));
    let job = getRefreshJob(week.key);

    const coverageFor = (
        classId: number,
    ): { status: ClassCoverageStatus; lastUpdated: string | null; error?: string } => {
        const row = rowByClass.get(classId);
        if (row) {
            return {
                status: isFresh(row.createdAt, week) ? 'fresh' : 'stale',
                lastUpdated: row.createdAt.toISOString(),
            };
        }
        const jobEntry = job?.classes[classId];
        if (jobEntry?.status === 'failed') {
            return {
                status: 'failed',
                lastUpdated: null,
                ...(jobEntry.error ? { error: jobEntry.error } : {}),
            };
        }
        return {
            status: classesWithAccount.has(classId) ? 'missing' : 'no-account',
            lastUpdated: null,
        };
    };

    const classes = metadata.classes
        .map((cls) => ({
            id: cls.id,
            name: cls.name,
            longName: cls.longName,
            ...coverageFor(cls.id),
        }))
        .sort((a, b) => a.name.localeCompare(b.name, 'de', { numeric: true }));

    // "When needed": missing or stale data that some account could fill. Classes
    // without an account only count while some account's classes are still unknown.
    const lastAuto = lastAutoRefresh.get(week.key) ?? 0;
    const mayAutoRefresh =
        job?.state !== 'running' && Date.now() - lastAuto > AUTO_REFRESH_COOLDOWN_MS;
    const needsRefresh =
        mayAutoRefresh &&
        (classes.some((c) => c.status === 'stale' || c.status === 'missing') ||
            (classes.some((c) => c.status === 'no-account') &&
                (await hasAccountsNeedingDiscovery())));
    if (needsRefresh) {
        lastAutoRefresh.set(week.key, Date.now());
        job = startRefreshJob(week, { force: false, trigger: 'auto' });
    }

    return {
        week: {
            key: week.key,
            start: week.start.toISOString(),
            end: week.end.toISOString(),
        },
        lastUpdated: newest(rows)?.toISOString() ?? null,
        coverage: {
            total: classes.length,
            withData: classes.filter((c) => c.status === 'fresh' || c.status === 'stale').length,
            classes,
        },
        teachers: summarize(aggregate, 'teacher'),
        rooms: summarize(aggregate, 'room'),
        job,
    };
}

export async function getResourceTimetable(args: {
    type: ResourceType;
    id: number;
    week?: string | undefined;
}) {
    const week = parseWeek(args.week);
    const rows = await latestRows(week);
    const aggregate = await loadAggregate(week, rows);
    // Same shape as a normal timetable response so the regular timetable view can render it
    return {
        userId: `${args.type}:${args.id}`,
        rangeStart: week.start.toISOString(),
        rangeEnd: week.end.toISOString(),
        payload: resourceLessons(aggregate, args.type, args.id),
        cached: true,
        stale: false,
        source: 'cache' as const,
        lastUpdated: newest(rows)?.toISOString() ?? null,
    };
}

export async function getFreeRooms(dateParam: string): Promise<FreeRoomsResponse> {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateParam);
    if (!match) throw new AppError('Invalid date', 400, 'INVALID_DATE');
    const untisDate = Number(`${match[1]}${match[2]}${match[3]}`);
    const week = parseWeek(dateParam);
    const [metadata, rows] = await Promise.all([getSchoolMetadata(), latestRows(week)]);
    const aggregate = await loadAggregate(week, rows);
    return freeRooms(aggregate, untisDate, metadata.timegrid, metadata.rooms);
}

export function refreshResources(weekParam?: string): RefreshJobSnapshot {
    return startRefreshJob(parseWeek(weekParam), { force: true, trigger: 'manual' });
}

export function getResourceRefreshStatus(weekParam?: string): RefreshJobSnapshot | null {
    return getRefreshJob(parseWeek(weekParam).key);
}
