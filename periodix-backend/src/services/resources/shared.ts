import { WebUntis } from 'webuntis';
import { prisma } from '../../store/prisma.js';
import { decryptSecret } from '../../server/crypto.js';
import { UNTIS_DEFAULT_SCHOOL } from '../../server/config.js';
import { AppError } from '../../server/errors.js';
import {
    endOfISOWeek,
    normalizeUntisClass,
    startOfISOWeek,
    toHost,
    type UserClassRecord,
} from '../untisService.js';
import type { RoomInfo, TimegridDay } from './aggregate.js';

// Current and upcoming weeks are considered stale after this long.
// Past weeks never go stale: their timetable no longer changes.
export const FRESH_FOR_MS = 6 * 60 * 60 * 1000;
const METADATA_TTL_MS = 6 * 60 * 60 * 1000;
const BAD_CREDENTIALS_BACKOFF_MS = 6 * 60 * 60 * 1000;

export type Week = { key: string; start: Date; end: Date };

function fmtLocalDate(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

/** Snap any date string to its ISO week, matching how class timetables are cached. */
export function parseWeek(week?: string): Week {
    const ref = week ? new Date(week) : new Date();
    if (Number.isNaN(ref.getTime())) {
        throw new AppError('Invalid week', 400, 'INVALID_WEEK');
    }
    const start = startOfISOWeek(ref);
    return { key: fmtLocalDate(start), start, end: endOfISOWeek(ref) };
}

export function isFresh(createdAt: Date, week: Week): boolean {
    if (week.end.getTime() < Date.now()) return true;
    return Date.now() - createdAt.getTime() < FRESH_FOR_MS;
}

// --- Untis sessions --------------------------------------------------------

export const credentialUserSelect = {
    id: true,
    username: true,
    untisSecretCiphertext: true,
    untisSecretNonce: true,
    untisSecretKeyVersion: true,
} as const;

export type CredentialUser = {
    id: string;
    username: string;
    untisSecretCiphertext: Uint8Array | null;
    untisSecretNonce: Uint8Array | null;
    untisSecretKeyVersion: number | null;
};

export const hasCredentialsWhere = {
    untisSecretCiphertext: { not: null },
    untisSecretNonce: { not: null },
};

const badCredentials = new Map<string, number>();

export function markBadCredentials(userId: string) {
    badCredentials.set(userId, Date.now());
}

export function hasRecentBadCredentials(userId: string): boolean {
    const at = badCredentials.get(userId);
    if (!at) return false;
    if (Date.now() - at > BAD_CREDENTIALS_BACKOFF_MS) {
        badCredentials.delete(userId);
        return false;
    }
    return true;
}

export async function openUntisSession(user: CredentialUser): Promise<any> {
    if (!user.untisSecretCiphertext || !user.untisSecretNonce) {
        throw new AppError('Missing Untis credential', 400, 'MISSING_UNTIS_SECRET');
    }
    const password = decryptSecret({
        ciphertext: user.untisSecretCiphertext as any,
        nonce: user.untisSecretNonce as any,
        keyVersion: user.untisSecretKeyVersion || 1,
    });
    const untis = new WebUntis(
        UNTIS_DEFAULT_SCHOOL,
        user.username,
        password,
        toHost(),
    ) as any;
    try {
        await untis.login();
    } catch (e: any) {
        if (String(e?.message || '').includes('bad credentials')) {
            markBadCredentials(user.id);
            throw new AppError('Invalid Untis credentials', 401, 'BAD_CREDENTIALS');
        }
        throw new AppError('Untis login failed', 502, 'UNTIS_LOGIN_FAILED');
    }
    return untis;
}

export async function closeUntisSession(untis: any) {
    try {
        await untis?.logout?.();
    } catch {}
}

/** Run `fn` with the first account that can log in. */
export async function withAnyUntisSession<T>(
    fn: (untis: any) => Promise<T>,
    maxAttempts = 3,
): Promise<T> {
    const users: CredentialUser[] = await prisma.user.findMany({
        where: hasCredentialsWhere,
        select: credentialUserSelect,
        orderBy: { updatedAt: 'desc' },
        take: 20,
    });
    let lastError: unknown = new AppError(
        'No account with Untis credentials available',
        503,
        'NO_UNTIS_ACCOUNT',
    );
    let attempts = 0;
    for (const user of users) {
        if (hasRecentBadCredentials(user.id)) continue;
        if (attempts++ >= maxAttempts) break;
        let untis: any;
        try {
            untis = await openUntisSession(user);
            return await fn(untis);
        } catch (e) {
            lastError = e;
        } finally {
            await closeUntisSession(untis);
        }
    }
    throw lastError;
}

// --- School-wide metadata (all classes, rooms, period grid) ----------------

export type SchoolMetadata = {
    classes: UserClassRecord[];
    rooms: RoomInfo[];
    timegrid: TimegridDay[];
};

let metadataCache: { data: SchoolMetadata; at: number } | null = null;
let metadataInFlight: Promise<SchoolMetadata> | null = null;

async function fetchMetadata(): Promise<SchoolMetadata> {
    return withAnyUntisSession(async (untis) => {
        let rawClasses: any[] = [];
        try {
            const schoolYear = await untis.getCurrentSchoolyear();
            rawClasses = await untis.getClasses(true, schoolYear?.id);
        } catch {
            rawClasses = await untis.getClasses();
        }
        const classes = (Array.isArray(rawClasses) ? rawClasses : [])
            .filter((c: any) => c?.active !== false)
            .map((c: any) => normalizeUntisClass(c))
            .filter((c): c is UserClassRecord => c !== null);

        let rooms: RoomInfo[] = [];
        try {
            const rawRooms = await untis.getRooms();
            rooms = (Array.isArray(rawRooms) ? rawRooms : [])
                .filter((r: any) => r?.active !== false)
                .map((r: any) => ({
                    id: r.id,
                    name: r.name,
                    longName: r.longName || r.name,
                }));
        } catch (e: any) {
            console.warn('[resources] getRooms failed', e?.message || e);
        }

        let timegrid: TimegridDay[] = [];
        try {
            const raw = await untis.getTimegrid();
            if (Array.isArray(raw)) timegrid = raw;
        } catch (e: any) {
            console.warn('[resources] getTimegrid failed', e?.message || e);
        }

        return { classes, rooms, timegrid };
    });
}

export async function getSchoolMetadata(): Promise<SchoolMetadata> {
    if (metadataCache && Date.now() - metadataCache.at < METADATA_TTL_MS) {
        return metadataCache.data;
    }
    if (!metadataInFlight) {
        metadataInFlight = fetchMetadata()
            .then((data) => {
                metadataCache = { data, at: Date.now() };
                return data;
            })
            .finally(() => {
                metadataInFlight = null;
            });
    }
    try {
        return await metadataInFlight;
    } catch (e) {
        // Serve stale metadata rather than failing the whole overview
        if (metadataCache) return metadataCache.data;
        throw e;
    }
}
