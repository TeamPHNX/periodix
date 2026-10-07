// On-demand refresh of all class timetables for one week.
// Nothing here runs on a timer: a job starts only when a user manager opens a
// week whose data is missing/stale, or presses "refresh".

import { prisma } from '../../store/prisma.js';
import { AppError } from '../../server/errors.js';
import {
    fetchOwnClassesFromUntis,
    rememberClassMemberships,
    storeClassTimetableRecord,
} from '../untisService.js';
import {
    closeUntisSession,
    credentialUserSelect,
    getSchoolMetadata,
    hasCredentialsWhere,
    hasRecentBadCredentials,
    isFresh,
    openUntisSession,
    type CredentialUser,
    type Week,
} from './shared.js';

const MAX_PARALLEL_SESSIONS = 3;
const MEMBERSHIP_RESYNC_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_DISCOVERY_PER_JOB = 30;
const FINISHED_JOB_RETENTION_MS = 60 * 60 * 1000;

export type ClassRefreshStatus =
    | 'pending'
    | 'fetched'
    | 'cached'
    | 'failed'
    | 'no-account';

export type RefreshJobSnapshot = {
    week: string;
    state: 'running' | 'done';
    phase: 'discovering' | 'fetching' | 'done';
    trigger: 'auto' | 'manual';
    startedAt: string;
    finishedAt: string | null;
    total: number;
    completed: number;
    failed: number;
    classes: Record<number, { status: ClassRefreshStatus; error?: string }>;
};

type RefreshJob = {
    week: Week;
    state: 'running' | 'done';
    phase: RefreshJobSnapshot['phase'];
    trigger: RefreshJobSnapshot['trigger'];
    startedAt: Date;
    finishedAt: Date | null;
    classes: Map<number, { status: ClassRefreshStatus; error?: string }>;
};

const jobs = new Map<string, RefreshJob>();

function createSessionLimiter(max: number) {
    let active = 0;
    const waiting: Array<() => void> = [];
    return async function run<T>(fn: () => Promise<T>): Promise<T> {
        if (active >= max) await new Promise<void>((r) => waiting.push(r));
        active++;
        try {
            return await fn();
        } finally {
            active--;
            waiting.shift()?.();
        }
    };
}

// Shared across jobs so several weeks refreshing at once still stay polite to Untis
const withSessionSlot = createSessionLimiter(MAX_PARALLEL_SESSIONS);

function snapshot(job: RefreshJob): RefreshJobSnapshot {
    let completed = 0;
    let failed = 0;
    const classes: RefreshJobSnapshot['classes'] = {};
    for (const [id, entry] of job.classes) {
        classes[id] = entry;
        if (entry.status !== 'pending') completed++;
        if (entry.status === 'failed') failed++;
    }
    return {
        week: job.week.key,
        state: job.state,
        phase: job.phase,
        trigger: job.trigger,
        startedAt: job.startedAt.toISOString(),
        finishedAt: job.finishedAt?.toISOString() ?? null,
        total: job.classes.size,
        completed,
        failed,
        classes,
    };
}

export function getRefreshJob(weekKey: string): RefreshJobSnapshot | null {
    const job = jobs.get(weekKey);
    if (!job) return null;
    if (
        job.finishedAt &&
        Date.now() - job.finishedAt.getTime() > FINISHED_JOB_RETENTION_MS
    ) {
        jobs.delete(weekKey);
        return null;
    }
    return snapshot(job);
}

export function startRefreshJob(
    week: Week,
    options: { force: boolean; trigger: 'auto' | 'manual' },
): RefreshJobSnapshot {
    const existing = jobs.get(week.key);
    if (existing?.state === 'running') return snapshot(existing);

    const job: RefreshJob = {
        week,
        state: 'running',
        phase: 'discovering',
        trigger: options.trigger,
        startedAt: new Date(),
        finishedAt: null,
        classes: new Map(),
    };
    jobs.set(week.key, job);

    runJob(job, options.force)
        .catch((e) => console.error('[resources] refresh job failed', e))
        .finally(() => {
            job.state = 'done';
            job.phase = 'done';
            job.finishedAt = new Date();
            for (const entry of job.classes.values()) {
                if (entry.status === 'pending') {
                    entry.status = 'failed';
                    entry.error = entry.error ?? 'Aborted';
                }
            }
        });

    return snapshot(job);
}

function needsDiscoveryWhere() {
    const cutoff = new Date(Date.now() - MEMBERSHIP_RESYNC_MS);
    return {
        ...hasCredentialsWhere,
        OR: [{ classesSyncedAt: null }, { classesSyncedAt: { lt: cutoff } }],
    };
}

/** Accounts whose classes are unknown or outdated (a refresh could find new representatives). */
export async function hasAccountsNeedingDiscovery(): Promise<boolean> {
    const count = await prisma.user.count({ where: needsDiscoveryWhere() });
    return count > 0;
}

/** Learn the classes of accounts we have not checked recently. */
async function discoverMemberships() {
    const users: CredentialUser[] = await prisma.user.findMany({
        where: needsDiscoveryWhere(),
        select: credentialUserSelect,
        orderBy: { updatedAt: 'desc' },
        take: MAX_DISCOVERY_PER_JOB,
    });
    const candidates = users.filter((u) => !hasRecentBadCredentials(u.id));
    await Promise.allSettled(
        candidates.map((user) =>
            withSessionSlot(async () => {
                let untis: any;
                try {
                    untis = await openUntisSession(user);
                    const classes = await fetchOwnClassesFromUntis(untis);
                    await rememberClassMemberships(user.id, classes);
                } catch (e: any) {
                    // Don't retry this account on every job; it is re-checked after the resync window
                    await prisma.user
                        .update({
                            where: { id: user.id },
                            data: { classesSyncedAt: new Date() },
                        })
                        .catch(() => {});
                    if (!(e instanceof AppError)) {
                        console.warn('[resources] membership discovery failed', {
                            userId: user.id,
                            message: e?.message || String(e),
                        });
                    }
                } finally {
                    await closeUntisSession(untis);
                }
            }),
        ),
    );
}

async function latestRowTimes(week: Week): Promise<Map<number, Date>> {
    const rows: Array<{ classId: number; createdAt: Date }> =
        await prisma.classTimetableCache.findMany({
            where: { rangeStart: week.start, rangeEnd: week.end },
            orderBy: [{ classId: 'asc' }, { createdAt: 'desc' }],
            distinct: ['classId'],
            select: { classId: true, createdAt: true },
        });
    return new Map(rows.map((r) => [r.classId, r.createdAt]));
}

function isNoResultError(e: any): boolean {
    const msg = String(e?.message || '').toLowerCase();
    return (
        msg.includes("didn't return any result") ||
        msg.includes('did not return any result') ||
        msg.includes('no result')
    );
}

async function runJob(job: RefreshJob, force: boolean) {
    const { week } = job;
    const metadata = await getSchoolMetadata();

    for (const cls of metadata.classes) {
        job.classes.set(cls.id, { status: 'pending' });
    }

    await discoverMemberships();
    job.phase = 'fetching';

    const cachedAt = await latestRowTimes(week);
    const pending = new Set<number>();
    for (const cls of metadata.classes) {
        const at = cachedAt.get(cls.id);
        if (!force && at && isFresh(at, week)) {
            job.classes.set(cls.id, { status: 'cached' });
        } else {
            pending.add(cls.id);
        }
    }
    if (!pending.size) return;

    const memberships = await prisma.userClassMembership.findMany({
        where: {
            classId: { in: Array.from(pending) },
            user: hasCredentialsWhere,
        },
        select: {
            classId: true,
            user: { select: { ...credentialUserSelect, updatedAt: true } },
        },
    });
    // Most recently active members first
    const candidatesByClass = new Map<number, CredentialUser[]>();
    memberships
        .sort((a, b) => b.user.updatedAt.getTime() - a.user.updatedAt.getTime())
        .forEach((m) => {
            const list = candidatesByClass.get(m.classId) ?? [];
            list.push(m.user);
            candidatesByClass.set(m.classId, list);
        });

    const failedUsers = new Set<string>();
    const failedPairs = new Set<string>(); // `${userId}:${classId}`
    const lastError = new Map<number, string>();

    // Each round assigns every pending class to one representative; a
    // representative logs in once and fetches all of its assigned classes.
    // Classes whose representative failed are retried with the next member.
    while (pending.size) {
        const assignments = new Map<string, { user: CredentialUser; classIds: number[] }>();
        for (const classId of pending) {
            const rep = (candidatesByClass.get(classId) ?? []).find(
                (u) =>
                    !failedUsers.has(u.id) &&
                    !failedPairs.has(`${u.id}:${classId}`) &&
                    !hasRecentBadCredentials(u.id),
            );
            if (!rep) {
                pending.delete(classId);
                const hadCandidates = (candidatesByClass.get(classId) ?? []).length > 0;
                job.classes.set(
                    classId,
                    hadCandidates
                        ? {
                              status: 'failed',
                              error: lastError.get(classId) ?? 'No working account',
                          }
                        : { status: 'no-account' },
                );
                continue;
            }
            const slot = assignments.get(rep.id) ?? { user: rep, classIds: [] };
            slot.classIds.push(classId);
            assignments.set(rep.id, slot);
        }
        if (!assignments.size) break;

        await Promise.allSettled(
            Array.from(assignments.values()).map(({ user, classIds }) =>
                withSessionSlot(async () => {
                    let untis: any;
                    try {
                        untis = await openUntisSession(user);
                    } catch (e: any) {
                        failedUsers.add(user.id);
                        for (const id of classIds) lastError.set(id, e?.message || 'Login failed');
                        return;
                    }
                    try {
                        for (const classId of classIds) {
                            try {
                                const lessons = await untis.getTimetableForRange(
                                    week.start,
                                    week.end,
                                    classId,
                                    1,
                                );
                                await storeClassTimetableRecord({
                                    classId,
                                    rangeStart: week.start,
                                    rangeEnd: week.end,
                                    payload: Array.isArray(lessons) ? lessons : [],
                                });
                                pending.delete(classId);
                                job.classes.set(classId, { status: 'fetched' });
                            } catch (e: any) {
                                // An account's own class returns [] in holidays; "no result"
                                // means no access (stale membership) or outside the school year.
                                failedPairs.add(`${user.id}:${classId}`);
                                if (isNoResultError(e)) {
                                    lastError.set(classId, 'No data for this week (no access or outside school year)');
                                    await prisma.user
                                        .update({
                                            where: { id: user.id },
                                            data: { classesSyncedAt: null },
                                        })
                                        .catch(() => {});
                                } else {
                                    lastError.set(classId, e?.message || 'Fetch failed');
                                }
                            }
                        }
                    } finally {
                        await closeUntisSession(untis);
                    }
                }),
            ),
        );
    }
}
