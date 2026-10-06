import { prisma } from '../store/prisma.js';
import {
    getOrFetchTimetableRange,
    fetchAbsencesFromUntis,
    storeAbsenceData,
} from './untisService.js';
import {
    createCanonicalSignature,
    groupLessonsForNotifications,
} from './notificationLessonMerge.js';
import webpush from 'web-push';

// Initialize web-push with VAPID keys
const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
const vapidSubject = process.env.VAPID_SUBJECT || 'mailto:admin@periodix.de';

if (vapidPublicKey && vapidPrivateKey) {
    webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
    console.log('Web Push configured with VAPID keys');
} else {
    console.warn(
        'VAPID keys not configured - push notifications will not work',
    );
}

export interface NotificationData {
    type: string;
    title: string;
    message: string;
    data?: any;
    userId: string;
    expiresAt?: Date;
    notificationId?: string;
    // Optional idempotency key for robust deduplication across intervals/restarts
    dedupeKey?: string;
}

export class NotificationService {
    private static instance: NotificationService;
    private intervalId: NodeJS.Timeout | null = null;
    private upcomingIntervalId: NodeJS.Timeout | null = null;
    private absenceIntervalId: NodeJS.Timeout | null = null;
    // Reentrancy guards to avoid overlapping runs
    private isCheckingChanges = false;
    private isCheckingUpcoming = false;
    private isCheckingAbsences = false;

    private constructor() {}

    static getInstance(): NotificationService {
        if (!NotificationService.instance) {
            NotificationService.instance = new NotificationService();
        }
        return NotificationService.instance;
    }

    /**
     * Get the current date and time in the specified user's timezone.
     * This ensures lesson notifications are sent based on the user's local time,
     * not the server's UTC time.
     */
    private getNowInUserTimezone(userTimezone: string): Date {
        return new Date(
            new Date().toLocaleString('en-US', { timeZone: userTimezone }),
        );
    }

    // Create a notification (with robust deduplication)
    async createNotification(data: NotificationData): Promise<void> {
        try {
            // Prefer a stable event-level dedupe key when available (and column exists)
            if (data.dedupeKey) {
                try {
                    const byKey = await (prisma as any).notification.findFirst({
                        where: {
                            dedupeKey: data.dedupeKey,
                            userId: data.userId,
                        },
                        select: { id: true },
                    });
                    if (byKey) return;
                } catch {
                    // If the column doesn't exist yet, fall back to legacy dedupe below
                }
            }

            // Legacy safety net: skip if same (userId, type, title, message) exists recently.
            // IMPORTANT: If a dedupeKey is provided we intentionally bypass this legacy check
            // so that distinct events with identical messages (e.g. a re-submitted access request
            // after being declined) still generate a new notification. The unique constraint on
            // dedupeKey (when present) already protects against true duplicates for the same event.
            if (!data.dedupeKey) {
                const thirtyDaysAgo = new Date(
                    Date.now() - 30 * 24 * 60 * 60 * 1000,
                );
                try {
                    const existing = await (
                        prisma as any
                    ).notification.findFirst({
                        where: {
                            userId: data.userId,
                            type: data.type,
                            title: data.title,
                            message: data.message,
                            createdAt: { gt: thirtyDaysAgo },
                        },
                        select: { id: true },
                    });
                    if (existing) return;
                } catch {
                    // ignore and proceed
                }
            }

            // Create with dedupeKey when possible. If unique constraint triggers, treat as already created.
            let created: { id: string } | null = null;
            try {
                created = await (prisma as any).notification.create({
                    data: {
                        userId: data.userId,
                        type: data.type,
                        title: data.title,
                        message: data.message,
                        data: data.data || null,
                        expiresAt: data.expiresAt,
                        dedupeKey: data.dedupeKey,
                    },
                    select: { id: true },
                });
            } catch (e: any) {
                const msg = String(e?.message || '');
                const code = (e && (e.code || (e.meta && e.meta.code))) as
                    | string
                    | undefined;

                // If this is a unique constraint violation (P2002), the notification already exists.
                if (
                    code === 'P2002' ||
                    msg.includes('Unique constraint failed')
                ) {
                    return; // do not create a duplicate, and do not re-send push
                }

                // Fallback only if the dedupeKey column truly doesn't exist in the database/client
                const columnMissing =
                    msg.includes('Unknown arg `dedupeKey`') ||
                    msg.includes('column "dedupeKey" does not exist') ||
                    msg.includes('No such column: dedupeKey');
                if (columnMissing) {
                    created = await (prisma as any).notification.create({
                        data: {
                            userId: data.userId,
                            type: data.type,
                            title: data.title,
                            message: data.message,
                            data: data.data || null,
                            expiresAt: data.expiresAt,
                        },
                        select: { id: true },
                    });
                } else {
                    // Unknown error — log and abort to avoid duplicate sending
                    console.error('notification.create failed:', e);
                    return;
                }
            }

            // Try to send push notification if user has subscriptions
            if (created?.id) {
                await this.sendPushNotification({
                    ...data,
                    notificationId: created.id,
                });
            }
        } catch (error) {
            console.error('Failed to create notification:', error);
        }
    }

    // Send push notification to user's devices
    async sendPushNotification(data: NotificationData): Promise<void> {
        try {
            const user = await (prisma as any).user.findUnique({
                where: { id: data.userId },
                include: {
                    notificationSettings: true,
                    notificationSubscriptions: {
                        where: { active: true },
                    },
                },
            });

            if (!user?.notificationSettings?.pushNotificationsEnabled) {
                return;
            }

            // Check if notification type is enabled
            if (
                !this.isNotificationTypeEnabled(
                    data.type,
                    user.notificationSettings,
                )
            ) {
                return;
            }

            const subscriptions = user.notificationSubscriptions || [];
            if (subscriptions.length === 0) {
                return;
            }

            // Only send push notifications if VAPID keys are configured
            if (!vapidPublicKey || !vapidPrivateKey) {
                console.warn(
                    'VAPID keys not configured - skipping push notification',
                );
                return;
            }

            const payload = JSON.stringify({
                title: data.title,
                body: data.message,
                icon: '/icon-192.png',
                badge: '/icon-192.png',
                tag: data.notificationId
                    ? `periodix-${data.notificationId}`
                    : `periodix-${data.type}`,
                data: {
                    type: data.type,
                    notificationId: data.notificationId,
                    ...data.data,
                },
                actions: [
                    {
                        action: 'view',
                        title: 'View',
                        icon: '/icon-192.png',
                    },
                    {
                        action: 'dismiss',
                        title: 'Dismiss',
                    },
                ],
            });

            // Send push notification to all user's devices with per-device preferences
            const pushPromises = subscriptions.map(async (sub: any) => {
                try {
                    const devicePrefs = (user.notificationSettings
                        ?.devicePreferences || {}) as Record<string, any>;
                    const entry = devicePrefs[sub.endpoint] || {};
                    // Map type -> per-device flag key and default behavior
                    let flagKey: string | null = null;
                    let requireTrue = false; // when true, only send if flag strictly true
                    switch (data.type) {
                        case 'upcoming_lesson':
                            flagKey = 'upcomingLessonsEnabled';
                            requireTrue = true; // default off
                            break;
                        case 'cancelled_lesson':
                            flagKey = 'cancelledLessonsEnabled';
                            break;
                        case 'irregular_lesson':
                            flagKey = 'irregularLessonsEnabled';
                            break;
                        case 'timetable_change':
                            flagKey = 'timetableChangesEnabled';
                            break;
                        case 'access_request':
                            flagKey = 'accessRequestsEnabled';
                            break;
                        case 'absence_new':
                        case 'absence_change':
                            flagKey = 'absencesEnabled';
                            break;
                        default:
                            flagKey = null;
                    }
                    if (flagKey) {
                        const value = entry[flagKey];
                        if (requireTrue) {
                            if (value !== true) {
                                return; // skip unless explicitly enabled on this device
                            }
                        } else {
                            if (value === false) {
                                return; // skip if explicitly disabled on this device
                            }
                        }
                    }
                    const pushSubscription = {
                        endpoint: sub.endpoint,
                        keys: {
                            p256dh: sub.p256dh,
                            auth: sub.auth,
                        },
                    };

                    await webpush.sendNotification(pushSubscription, payload);
                    console.log(
                        `Push notification sent to device: ${sub.endpoint.substring(
                            0,
                            50,
                        )}...`,
                    );
                } catch (error: any) {
                    console.error('Failed to send push to device:', error);

                    // If subscription is invalid, mark it as inactive
                    if (error.statusCode === 410 || error.statusCode === 413) {
                        await (prisma as any).notificationSubscription.update({
                            where: { id: sub.id },
                            data: { active: false },
                        });
                        console.log(
                            `Marked subscription as inactive: ${sub.endpoint.substring(
                                0,
                                50,
                            )}...`,
                        );
                    }
                }
            });

            await Promise.allSettled(pushPromises);

            // Mark notification as sent
            await (prisma as any).notification.updateMany({
                where: {
                    userId: data.userId,
                    type: data.type,
                    title: data.title,
                    sent: false,
                },
                data: { sent: true },
            });

            console.log(
                `Push notification sent to ${subscriptions.length} devices for user ${data.userId}`,
            );
        } catch (error) {
            console.error('Failed to send push notification:', error);
        }
    }

    // Check if notification type is enabled for user
    private isNotificationTypeEnabled(type: string, settings: any): boolean {
        switch (type) {
            case 'timetable_change':
                return settings.timetableChangesEnabled;
            case 'cancelled_lesson':
                return settings.cancelledLessonsEnabled;
            case 'irregular_lesson':
                return settings.irregularLessonsEnabled;
            case 'upcoming_lesson':
                // Per-device setting handled later; don't block globally here
                return true;
            case 'access_request':
                return settings.accessRequestsEnabled;
            case 'absence_new':
            case 'absence_change':
                return settings.absencesEnabled;
            default:
                return true;
        }
    }

    // Notify user managers about new access requests
    async notifyAccessRequest(
        username: string,
        message?: string,
    ): Promise<void> {
        try {
            const userManagers = await (prisma as any).user.findMany({
                where: { isUserManager: true },
                include: { notificationSettings: true },
            });

            for (const manager of userManagers) {
                if (
                    manager.notificationSettings?.accessRequestsEnabled !==
                    false
                ) {
                    // Build a dedupeKey that allows repeated reminders after a decline while still throttling spam.
                    // Previous implementation bucketed per hour, which suppressed legitimate re-requests within the same hour.
                    // Strategy: bucket per 5-minute window + hash of base (username+trimmed message) to avoid duplicates caused by retry spam in a very short timeframe.
                    const base = `${username}:${(message || '')
                        .replace(/\(reminder[^)]+\)/gi, '')
                        .trim()
                        .slice(0, 160)}`; // strip prior reminder suffix to treat same logical message equally
                    const now = new Date();
                    const fiveMinBucket = new Date(now);
                    fiveMinBucket.setSeconds(0, 0);
                    const bucketIndex = Math.floor(now.getMinutes() / 5); // 0..11 per hour
                    fiveMinBucket.setMinutes(bucketIndex * 5);
                    // Simple FNV-1a hash for short stable identifier (no external deps)
                    let hash = 2166136261;
                    for (let i = 0; i < base.length; i++) {
                        hash ^= base.charCodeAt(i);
                        hash = (hash * 16777619) >>> 0;
                    }
                    const dedupeKey = `access_req:${
                        manager.id
                    }:v2:${hash.toString(36)}:${fiveMinBucket.toISOString()}`;
                    await this.createNotification({
                        type: 'access_request',
                        title: 'New Access Request',
                        message: `${username} has requested access${
                            message ? `: ${message}` : ''
                        }`,
                        userId: manager.id,
                        data: { username, message },
                        expiresAt: new Date(
                            Date.now() + 7 * 24 * 60 * 60 * 1000,
                        ), // 7 days
                        dedupeKey,
                    });
                }
            }
        } catch (error) {
            console.error('Failed to notify access request:', error);
        }
    }

    // Check for timetable changes and notify users
    async checkTimetableChanges(): Promise<void> {
        try {
            const adminSettings = await (
                prisma as any
            ).adminNotificationSettings.findFirst();
            if (!adminSettings?.enableTimetableNotifications) {
                return;
            }

            // Compute current ISO week range
            const now = new Date();
            const startOfISOWeek = (d: Date) => {
                const nd = new Date(d);
                nd.setHours(0, 0, 0, 0);
                const day = nd.getDay(); // 0=Sun..6=Sat
                const diff = day === 0 ? -6 : 1 - day; // shift to Monday
                nd.setDate(nd.getDate() + diff);
                return nd;
            };
            const endOfISOWeek = (d: Date) => {
                const start = startOfISOWeek(d);
                const end = new Date(start);
                end.setDate(start.getDate() + 6);
                end.setHours(23, 59, 59, 999);
                return end;
            };
            const s = startOfISOWeek(now).toISOString();
            const e = endOfISOWeek(now).toISOString();

            // Refresh cache for users who either enabled push (for upcoming) OR timetable change notifications
            const usersToRefresh = await (prisma as any).user.findMany({
                where: {
                    OR: [
                        {
                            notificationSettings: {
                                pushNotificationsEnabled: true,
                            },
                        },
                        {
                            notificationSettings: {
                                timetableChangesEnabled: true,
                            },
                        },
                    ],
                },
                include: {
                    notificationSettings: true,
                    timetables: { orderBy: { createdAt: 'desc' }, take: 1 },
                },
            });

            for (const user of usersToRefresh) {
                let tmpUser = user as any;
                try {
                    const fresh = await getOrFetchTimetableRange({
                        requesterId: user.id,
                        targetUserId: user.id,
                        start: s,
                        end: e,
                    });
                    tmpUser = {
                        ...user,
                        timetables: [
                            {
                                ...(user.timetables?.[0] || {}),
                                payload: fresh?.payload ?? [],
                            },
                        ],
                    } as any;
                } catch (fetchErr) {
                    // If fetching fails (e.g., missing Untis credentials), fall back to existing cache
                    console.warn(
                        `Admin interval refresh failed for ${user.id}:`,
                        (fetchErr as any)?.message || fetchErr,
                    );
                }

                // Only check irregular/cancelled changes for users who enabled it
                if (user.notificationSettings?.timetableChangesEnabled) {
                    await this.checkUserTimetableChanges(tmpUser, {
                        onlyUpcoming: false,
                    });
                }
            }
        } catch (error) {
            console.error('Failed to check timetable changes:', error);
        }
    }

    // Check for changes in a specific user's timetable
    private async checkUserTimetableChanges(
        user: any,
        options?: { onlyUpcoming?: boolean },
    ): Promise<void> {
        try {
            // This is a simplified version - in a real implementation you would:
            // 1. Fetch the latest timetable from WebUntis
            // 2. Compare with the stored timetable
            // 3. Detect changes (cancelled lessons, irregular lessons, etc.)
            // 4. Send notifications for changes

            const latestTimetable = user.timetables?.[0];
            if (!latestTimetable?.payload) {
                return;
            }

            // Extract lessons from the timetable payload
            const lessons = latestTimetable.payload as any[];
            if (!Array.isArray(lessons)) {
                return;
            }

            // Get current date info using the user's timezone
            const today = this.getNowInUserTimezone(
                user.timezone || 'Europe/Berlin',
            );
            const todayString =
                today.getFullYear() * 10000 +
                (today.getMonth() + 1) * 100 +
                today.getDate();
            // Current time in Untis HHmm for same-day comparisons
            const nowHm = today.getHours() * 100 + today.getMinutes();

            // Calculate week boundaries (assuming week starts on Monday)
            const startOfWeek = new Date(today);
            const dayOfWeek = startOfWeek.getDay();
            const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // Handle Sunday (0) as 6 days from Monday
            startOfWeek.setDate(today.getDate() - daysFromMonday);
            const startOfWeekString =
                startOfWeek.getFullYear() * 10000 +
                (startOfWeek.getMonth() + 1) * 100 +
                startOfWeek.getDate();

            const endOfWeek = new Date(startOfWeek);
            endOfWeek.setDate(startOfWeek.getDate() + 6);
            const endOfWeekString =
                endOfWeek.getFullYear() * 10000 +
                (endOfWeek.getMonth() + 1) * 100 +
                endOfWeek.getDate();

            // Helper formatters for messages
            const formatYmd = (n: number | undefined) => {
                if (!n || typeof n !== 'number') return '';
                const y = Math.floor(n / 10000);
                const m = Math.floor((n % 10000) / 100);
                const d = n % 100;
                return `${String(y)}-${String(m).padStart(2, '0')}-${String(
                    d,
                ).padStart(2, '0')}`;
            };
            const formatHm = (hhmm: number | undefined) => {
                if (!hhmm && hhmm !== 0) return '';
                const hh = Math.floor((hhmm as number) / 100);
                const mm = (hhmm as number) % 100;
                return `${String(hh).padStart(2, '0')}:${String(mm).padStart(
                    2,
                    '0',
                )}`;
            };

            if (!options?.onlyUpcoming) {
                // Filter lessons for scope and past/future, then group for notifications
                const eligibleLessons = lessons.filter((lesson) => {
                    // Skip any lesson whose end time is in the past (no notifications for past lessons)
                    const lDate: number | undefined =
                        typeof lesson?.date === 'number'
                            ? (lesson.date as number)
                            : undefined;

                    // Only filter out lessons from past DAYS.
                    // We keep today's past lessons so they can be merged with current/future lessons.
                    // We will filter out fully-past groups later.
                    if (typeof lDate === 'number' && lDate < todayString) {
                        return false; // past day
                    }
                    return true;
                });

                // Process cancelled lessons
                if (user.notificationSettings?.cancelledLessonsEnabled) {
                    const scope =
                        user.notificationSettings?.cancelledLessonsTimeScope ||
                        'day';
                    const cancelledLessons = eligibleLessons.filter(
                        (lesson) => {
                            if (lesson.code !== 'cancelled') return false;

                            let shouldNotify = false;
                            if (scope === 'day') {
                                shouldNotify = lesson.date === todayString;
                            } else if (scope === 'week') {
                                shouldNotify =
                                    lesson.date >= startOfWeekString &&
                                    lesson.date <= endOfWeekString;
                            }
                            return shouldNotify;
                        },
                    );

                    // Group consecutive cancelled lessons for merged notifications
                    const cancelledGroups =
                        groupLessonsForNotifications(cancelledLessons);

                    for (const group of cancelledGroups) {
                        // Skip group if it is fully in the past
                        const lastLesson = group[group.length - 1];
                        const lDate =
                            typeof lastLesson?.date === 'number'
                                ? lastLesson.date
                                : undefined;
                        const lEnd =
                            typeof lastLesson?.endTime === 'number'
                                ? lastLesson.endTime
                                : undefined;

                        if (
                            typeof lDate === 'number' &&
                            (lDate < todayString ||
                                (lDate === todayString &&
                                    typeof lEnd === 'number' &&
                                    lEnd < nowHm))
                        ) {
                            continue;
                        }

                        if (group.length === 1) {
                            // Single lesson - use existing logic
                            const lesson = group[0];
                            const subject = lesson.su?.[0]?.name || 'Lesson';
                            const when = `${formatYmd(lesson.date)} ${formatHm(
                                lesson.startTime,
                            )}`.trim();
                            const dedupeKey = [
                                'cancelled',
                                user.id,
                                lesson?.id ?? lesson?.lessonId ?? subject,
                                lesson?.date ?? '',
                                lesson?.startTime ?? '',
                            ].join(':');
                            await this.createNotification({
                                type: 'cancelled_lesson',
                                title: 'Lesson Cancelled',
                                message: `${subject} on ${when} has been cancelled`,
                                userId: user.id,
                                data: lesson,
                                dedupeKey,
                            });
                        } else {
                            // Multiple consecutive lessons - create merged notification
                            const firstLesson = group[0];
                            const lastLesson = group[group.length - 1];
                            const subject =
                                firstLesson.su?.[0]?.name || 'Lesson';
                            const startTime = formatHm(firstLesson.startTime);
                            const endTime = formatHm(lastLesson.endTime);
                            const date = formatYmd(firstLesson.date);

                            // Create a dedupe key based on the merged lesson group
                            const groupIds = group
                                .map(
                                    (l) =>
                                        l?.id ??
                                        l?.lessonId ??
                                        createCanonicalSignature(l),
                                )
                                .sort()
                                .join(',');
                            const dedupeKey = [
                                'cancelled_merged',
                                user.id,
                                groupIds,
                                firstLesson?.date ?? '',
                                firstLesson?.startTime ?? '',
                                lastLesson?.endTime ?? '',
                            ].join(':');

                            await this.createNotification({
                                type: 'cancelled_lesson',
                                title: 'Lessons Cancelled',
                                message: `${subject} lessons on ${date} from ${startTime} to ${endTime} have been cancelled`,
                                userId: user.id,
                                data: {
                                    lessons: group,
                                    merged: true,
                                    count: group.length,
                                },
                                dedupeKey,
                            });
                        }
                    }
                }

                // Process irregular lessons
                if (user.notificationSettings?.irregularLessonsEnabled) {
                    const scope =
                        user.notificationSettings?.irregularLessonsTimeScope ||
                        'day';
                    const irregularLessons = eligibleLessons.filter(
                        (lesson) => {
                            const isIrregular =
                                lesson.code === 'irregular' ||
                                lesson.te?.some((t: any) => t.orgname) ||
                                lesson.ro?.some((r: any) => r.orgname);

                            if (!isIrregular) return false;

                            let shouldNotify = false;
                            if (scope === 'day') {
                                shouldNotify = lesson.date === todayString;
                            } else if (scope === 'week') {
                                shouldNotify =
                                    lesson.date >= startOfWeekString &&
                                    lesson.date <= endOfWeekString;
                            }
                            return shouldNotify;
                        },
                    );

                    // Group consecutive irregular lessons for merged notifications
                    const irregularGroups =
                        groupLessonsForNotifications(irregularLessons);

                    for (const group of irregularGroups) {
                        // Skip group if it is fully in the past
                        const lastLesson = group[group.length - 1];
                        const lDate =
                            typeof lastLesson?.date === 'number'
                                ? lastLesson.date
                                : undefined;
                        const lEnd =
                            typeof lastLesson?.endTime === 'number'
                                ? lastLesson.endTime
                                : undefined;

                        if (
                            typeof lDate === 'number' &&
                            (lDate < todayString ||
                                (lDate === todayString &&
                                    typeof lEnd === 'number' &&
                                    lEnd < nowHm))
                        ) {
                            continue;
                        }

                        if (group.length === 1) {
                            // Single lesson - use existing logic
                            const lesson = group[0];
                            const irregularFlags: string[] = [];
                            if (lesson.code === 'irregular')
                                irregularFlags.push('schedule');
                            if (lesson.te?.some((t: any) => t.orgname))
                                irregularFlags.push('teacher');
                            if (lesson.ro?.some((r: any) => r.orgname))
                                irregularFlags.push('room');
                            const subject = lesson.su?.[0]?.name || 'Lesson';
                            const when = `${formatYmd(lesson.date)} ${formatHm(
                                lesson.startTime,
                            )}`.trim();
                            const dedupeKey = [
                                'irregular',
                                user.id,
                                lesson?.id ?? lesson?.lessonId ?? subject,
                                lesson?.date ?? '',
                                lesson?.startTime ?? '',
                                irregularFlags.sort().join('|'),
                            ].join(':');
                            await this.createNotification({
                                type: 'irregular_lesson',
                                title: 'Irregular Lesson',
                                message: `${subject} on ${when} has irregular changes (${irregularFlags.join(
                                    ', ',
                                )})`,
                                userId: user.id,
                                data: lesson,
                                dedupeKey,
                            });
                        } else {
                            // Multiple consecutive lessons - create merged notification
                            const firstLesson = group[0];
                            const lastLesson = group[group.length - 1];
                            const subject =
                                firstLesson.su?.[0]?.name || 'Lesson';
                            const startTime = formatHm(firstLesson.startTime);
                            const endTime = formatHm(lastLesson.endTime);
                            const date = formatYmd(firstLesson.date);

                            // Collect all irregular flags from the group
                            const allIrregularFlags = new Set<string>();
                            for (const lesson of group) {
                                if (lesson.code === 'irregular')
                                    allIrregularFlags.add('schedule');
                                if (lesson.te?.some((t: any) => t.orgname))
                                    allIrregularFlags.add('teacher');
                                if (lesson.ro?.some((r: any) => r.orgname))
                                    allIrregularFlags.add('room');
                            }
                            const irregularFlags =
                                Array.from(allIrregularFlags).sort();

                            // Create a dedupe key based on the merged lesson group
                            const groupIds = group
                                .map(
                                    (l) =>
                                        l?.id ??
                                        l?.lessonId ??
                                        createCanonicalSignature(l),
                                )
                                .sort()
                                .join(',');
                            const dedupeKey = [
                                'irregular_merged',
                                user.id,
                                groupIds,
                                firstLesson?.date ?? '',
                                firstLesson?.startTime ?? '',
                                lastLesson?.endTime ?? '',
                                irregularFlags.join('|'),
                            ].join(':');

                            await this.createNotification({
                                type: 'irregular_lesson',
                                title: 'Irregular Lessons',
                                message: `${subject} lessons on ${date} from ${startTime} to ${endTime} have irregular changes (${irregularFlags.join(
                                    ', ',
                                )})`,
                                userId: user.id,
                                data: {
                                    lessons: group,
                                    merged: true,
                                    count: group.length,
                                    irregularFlags,
                                },
                                dedupeKey,
                            });
                        }
                    }
                }
            }

            // Upcoming lesson reminders (Beta): send 5 minutes before start time
            if (options?.onlyUpcoming && user.notificationSettings) {
                const now = this.getNowInUserTimezone(
                    user.timezone || 'Europe/Berlin',
                );
                const nowMinutes = now.getHours() * 60 + now.getMinutes();
                const todayYmd =
                    now.getFullYear() * 10000 +
                    (now.getMonth() + 1) * 100 +
                    now.getDate();

                // helper to convert Untis HHmm int to minutes
                const toMinutes = (hhmm: number) =>
                    Math.floor(hhmm / 100) * 60 + (hhmm % 100);

                const globalUpcomingEnabled =
                    user.notificationSettings.upcomingLessonsEnabled === true;

                // Filter lessons that are eligible for upcoming notifications
                const eligibleUpcomingLessons = lessons.filter((lesson) => {
                    if (!lesson?.startTime) return false;
                    if (Number(lesson.date) !== todayYmd) return false;
                    if (lesson.code === 'cancelled') return false; // don't remind cancelled

                    const startMin = toMinutes(lesson.startTime);
                    const diff = startMin - nowMinutes; // whole minutes until start
                    // Allow a tolerance window (3-5 minutes before) to avoid missing due to interval drift.
                    return diff <= 5 && diff >= 3;
                });

                // Group eligible upcoming lessons for merged notifications
                const upcomingGroups = groupLessonsForNotifications(
                    eligibleUpcomingLessons,
                );

                for (const group of upcomingGroups) {
                    // Only send if at least one device opted in for upcoming reminders
                    const devicePrefs = (user.notificationSettings
                        ?.devicePreferences || {}) as Record<string, any>;
                    const anyDeviceEnabled = Object.values(devicePrefs).some(
                        (p: any) => p?.upcomingLessonsEnabled,
                    );
                    if (!anyDeviceEnabled && !globalUpcomingEnabled) continue;

                    if (group.length === 1) {
                        // Single lesson - use existing logic
                        const lesson = group[0];
                        // Check if a notification already exists for this upcoming lesson
                        const dedupeKeyPreview = [
                            'upcoming',
                            user.id,
                            lesson?.id ??
                                lesson?.lessonId ??
                                (lesson.su?.[0]?.name || 'Lesson'),
                            lesson?.date ?? '',
                            lesson?.startTime ?? '',
                        ].join(':');
                        try {
                            const existingUpcoming = await (
                                prisma as any
                            ).notification.findFirst({
                                where: {
                                    dedupeKey: dedupeKeyPreview,
                                    userId: user.id,
                                },
                                select: { id: true },
                            });
                            if (existingUpcoming) continue; // already queued/sent
                        } catch {
                            /* ignore errors */
                        }

                        // Build shortform info: subject, time, room, teacher
                        const subject = lesson.su?.[0]?.name || 'Lesson';
                        const hh = String(
                            Math.floor(lesson.startTime / 100),
                        ).padStart(2, '0');
                        const mm = String(lesson.startTime % 100).padStart(
                            2,
                            '0',
                        );
                        const room = lesson.ro
                            ?.map((r: any) => r.name)
                            .join(', ');
                        const teacher = lesson.te
                            ?.map((t: any) => t.name)
                            .join(', ');
                        const irregular =
                            lesson.code === 'irregular' ||
                            lesson.te?.some((t: any) => t.orgname) ||
                            lesson.ro?.some((r: any) => r.orgname);

                        const irregularParts: string[] = [];
                        if (lesson.te?.some((t: any) => t.orgname)) {
                            const changes = lesson.te
                                .filter((t: any) => t.orgname)
                                .map((t: any) => `${t.orgname} → ${t.name}`)
                                .join(', ');
                            if (changes)
                                irregularParts.push(`Teacher: ${changes}`);
                        }
                        if (lesson.ro?.some((r: any) => r.orgname)) {
                            const changes = lesson.ro
                                .filter((r: any) => r.orgname)
                                .map((r: any) => `${r.orgname} → ${r.name}`)
                                .join(', ');
                            if (changes)
                                irregularParts.push(`Room: ${changes}`);
                        }

                        const title = 'Upcoming lesson in 5 minutes';
                        const details = [
                            `${subject} @ ${hh}:${mm}`,
                            room ? `Room ${room}` : undefined,
                            teacher ? `with ${teacher}` : undefined,
                        ].filter(Boolean);
                        const message =
                            details.join(' • ') +
                            (irregular && irregularParts.length
                                ? ` — Irregular: ${irregularParts.join(', ')}`
                                : '');

                        await this.createNotification({
                            type: 'upcoming_lesson',
                            title,
                            message,
                            userId: user.id,
                            data: {
                                lesson,
                                irregular,
                                irregularDetails: irregularParts,
                            },
                            // auto-expire shortly after start time
                            expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
                            dedupeKey: dedupeKeyPreview,
                        });
                    } else {
                        // Multiple consecutive lessons - create merged upcoming notification
                        const firstLesson = group[0];
                        const lastLesson = group[group.length - 1];
                        const subject = firstLesson.su?.[0]?.name || 'Lesson';
                        const startTime = formatHm(firstLesson.startTime);
                        const endTime = formatHm(lastLesson.endTime);

                        // Create a dedupe key based on the merged lesson group
                        const groupIds = group
                            .map(
                                (l) =>
                                    l?.id ??
                                    l?.lessonId ??
                                    createCanonicalSignature(l),
                            )
                            .sort()
                            .join(',');
                        const dedupeKey = [
                            'upcoming_merged',
                            user.id,
                            groupIds,
                            firstLesson?.date ?? '',
                            firstLesson?.startTime ?? '',
                            lastLesson?.endTime ?? '',
                        ].join(':');

                        try {
                            const existingUpcoming = await (
                                prisma as any
                            ).notification.findFirst({
                                where: {
                                    dedupeKey: dedupeKey,
                                    userId: user.id,
                                },
                                select: { id: true },
                            });
                            if (existingUpcoming) continue; // already queued/sent
                        } catch {
                            /* ignore errors */
                        }

                        const room = (firstLesson.ro ?? [])
                            .map((r: any) => r.name)
                            .join(', ');
                        const teacher = (firstLesson.te ?? [])
                            .map((t: any) => t.name)
                            .join(', ');

                        // Check for irregular changes across the group
                        const hasIrregular = group.some(
                            (lesson) =>
                                lesson.code === 'irregular' ||
                                lesson.te?.some((t: any) => t.orgname) ||
                                lesson.ro?.some((r: any) => r.orgname),
                        );

                        const irregularPartsSet: Set<string> = new Set();
                        if (hasIrregular) {
                            // Collect all irregular flags from the group, deduplicated
                            for (const lesson of group) {
                                if (lesson.te?.some((t: any) => t.orgname)) {
                                    const changes = lesson.te
                                        .filter((t: any) => t.orgname)
                                        .map(
                                            (t: any) =>
                                                `${t.orgname} → ${t.name}`,
                                        )
                                        .join(', ');
                                    if (changes)
                                        irregularPartsSet.add(
                                            `Teacher: ${changes}`,
                                        );
                                }
                                if (lesson.ro?.some((r: any) => r.orgname)) {
                                    const changes = lesson.ro
                                        .filter((r: any) => r.orgname)
                                        .map(
                                            (r: any) =>
                                                `${r.orgname} → ${r.name}`,
                                        )
                                        .join(', ');
                                    if (changes)
                                        irregularPartsSet.add(
                                            `Room: ${changes}`,
                                        );
                                }
                            }
                        }
                        const irregularParts: string[] =
                            Array.from(irregularPartsSet);

                        const title = 'Upcoming lessons in 5 minutes';
                        const details = [
                            `${subject} from ${startTime} to ${endTime}`,
                            room ? `Room ${room}` : undefined,
                            teacher ? `with ${teacher}` : undefined,
                        ].filter(Boolean);
                        const message =
                            details.join(' • ') +
                            (hasIrregular && irregularParts.length
                                ? ` — Irregular: ${irregularParts.join(', ')}`
                                : '');

                        await this.createNotification({
                            type: 'upcoming_lesson',
                            title,
                            message,
                            userId: user.id,
                            data: {
                                lessons: group,
                                merged: true,
                                count: group.length,
                                irregular: hasIrregular,
                                irregularDetails: irregularParts,
                            },
                            // auto-expire shortly after start time of last lesson
                            expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
                            dedupeKey,
                        });
                    }
                }
            }
        } catch (error) {
            console.error(
                `Failed to check timetable changes for user ${user.id}:`,
                error,
            );
        }
    }

    // Fast path: check upcoming lessons for all users with setting enabled
    private async checkUpcomingLessons(): Promise<void> {
        try {
            // Previously this queried only users with pushNotificationsEnabled=true.
            // That prevented creation of upcoming notifications for users who had
            // enabled the feature (globally or per-device) but had not yet enabled
            // push (or whose push subscription failed). We now fetch ALL users that
            // have notification settings and perform precise filtering in-process.
            const users = await (prisma as any).user.findMany({
                where: {
                    notificationSettings: { isNot: null },
                },
                include: {
                    notificationSettings: true,
                    timetables: { orderBy: { createdAt: 'desc' }, take: 1 },
                },
            });

            for (const user of users) {
                try {
                    // Calculate current time in the user's timezone
                    const now = this.getNowInUserTimezone(
                        user.timezone || 'Europe/Berlin',
                    );
                    const todayYmd =
                        now.getFullYear() * 10000 +
                        (now.getMonth() + 1) * 100 +
                        now.getDate();

                    // Only process upcoming reminders if any device opted in
                    const devicePrefs = (user.notificationSettings
                        ?.devicePreferences || {}) as Record<string, any>;
                    const anyDeviceEnabled = Object.values(devicePrefs).some(
                        (p: any) => p?.upcomingLessonsEnabled === true,
                    );
                    const globalUpcomingEnabled =
                        user.notificationSettings?.upcomingLessonsEnabled ===
                        true;
                    // If neither global nor any per-device flag is enabled, skip.
                    if (!anyDeviceEnabled && !globalUpcomingEnabled) {
                        continue; // skip user to avoid unnecessary work
                    }

                    let latest = user.timetables?.[0];
                    let lessons: any[] = Array.isArray(latest?.payload)
                        ? (latest.payload as any[])
                        : [];
                    let hasToday = lessons.some(
                        (l: any) => Number(l?.date) === todayYmd,
                    );
                    if (!hasToday) {
                        // Attempt a lightweight refresh for just today to populate cache.
                        try {
                            const start = new Date(now);
                            start.setHours(0, 0, 0, 0);
                            const end = new Date(start);
                            end.setHours(23, 59, 59, 999);
                            const refreshed = await getOrFetchTimetableRange({
                                requesterId: user.id,
                                targetUserId: user.id,
                                start: start.toISOString(),
                                end: end.toISOString(),
                            });
                            if (refreshed?.payload) {
                                lessons = Array.isArray(refreshed.payload)
                                    ? (refreshed.payload as any[])
                                    : [];
                                hasToday = lessons.some(
                                    (l: any) => Number(l?.date) === todayYmd,
                                );
                                // IMPORTANT: Mutate the in-memory user object so that
                                // downstream checkUserTimetableChanges() sees the fresh
                                // payload. Previously we refreshed "lessons" locally but
                                // passed the original user whose timetables[0] still
                                // referenced the stale payload – causing upcoming reminders
                                // to be skipped entirely until the slower full refresh ran.
                                user.timetables = [
                                    {
                                        ...(latest || {
                                            id: 'temp',
                                            createdAt: new Date(),
                                        }),
                                        payload: lessons,
                                    },
                                ];
                                latest = user.timetables[0];
                            }
                        } catch (refreshErr) {
                            console.warn(
                                `Upcoming fast refresh failed for ${user.id}:`,
                                (refreshErr as any)?.message || refreshErr,
                            );
                        }
                    }
                    if (!hasToday) continue;

                    await this.checkUserTimetableChanges(user, {
                        onlyUpcoming: true,
                    });
                } catch (perUserErr) {
                    console.error(
                        `checkUpcomingLessons user ${user?.id} failed:`,
                        perUserErr,
                    );
                }
            }
        } catch (e) {
            console.error('checkUpcomingLessons failed:', e);
        }
    }

    // Start the background notification service
    async startService(): Promise<void> {
        if (this.intervalId) {
            return; // Already running
        }

        console.log('Starting notification service...');

        // Get fetch interval from admin settings
        const adminSettings = await (
            prisma as any
        ).adminNotificationSettings.findFirst();
        const intervalMinutes = adminSettings?.timetableFetchInterval || 30;

        this.intervalId = setInterval(
            async () => {
                if (this.isCheckingChanges) return;
                this.isCheckingChanges = true;
                try {
                    await this.checkTimetableChanges();
                } finally {
                    this.isCheckingChanges = false;
                }
            },
            intervalMinutes * 60 * 1000,
        ); // Convert minutes to milliseconds

        // Separate fast loop for upcoming lesson reminders (runs every 60s)
        if (!this.upcomingIntervalId) {
            this.upcomingIntervalId = setInterval(async () => {
                if (this.isCheckingUpcoming) return;
                this.isCheckingUpcoming = true;
                try {
                    await this.checkUpcomingLessons();
                } catch (e) {
                    console.error('Upcoming lesson check failed:', e);
                } finally {
                    this.isCheckingUpcoming = false;
                }
            }, 60 * 1000);
        }

        // Separate loop for absences (runs every 1 hour)
        if (!this.absenceIntervalId) {
            this.absenceIntervalId = setInterval(
                async () => {
                    if (this.isCheckingAbsences) return;
                    this.isCheckingAbsences = true;
                    try {
                        await this.checkAbsenceChanges();
                    } catch (e) {
                        console.error('Absence check failed:', e);
                    } finally {
                        this.isCheckingAbsences = false;
                    }
                },
                60 * 60 * 1000,
            );
        }

        // Run first absence check after a short delay
        setTimeout(() => this.checkAbsenceChanges(), 15000);

        console.log(
            `Notification service started with ${intervalMinutes} minute interval`,
        );
    }

    // Stop the background notification service
    stopService(): void {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
            console.log('Notification service stopped');
        }
        if (this.upcomingIntervalId) {
            clearInterval(this.upcomingIntervalId);
            this.upcomingIntervalId = null;
            console.log('Upcoming reminder loop stopped');
        }
        if (this.absenceIntervalId) {
            clearInterval(this.absenceIntervalId);
            this.absenceIntervalId = null;
            console.log('Absence check loop stopped');
        }
    }

    // Clean up expired notifications
    async cleanupExpiredNotifications(): Promise<void> {
        try {
            const result = await (prisma as any).notification.deleteMany({
                where: {
                    expiresAt: {
                        lt: new Date(),
                    },
                },
            });

            if (result.count > 0) {
                console.log(`Cleaned up ${result.count} expired notifications`);
            }
        } catch (error) {
            console.error('Failed to cleanup expired notifications:', error);
        }
    }

    // Check for absence changes and notify users
    async checkAbsenceChanges(): Promise<void> {
        try {
            const users = await (prisma as any).user.findMany({
                where: {
                    notificationSettings: {
                        absencesEnabled: true,
                    },
                },
                include: {
                    notificationSettings: true,
                },
            });

            for (const user of users) {
                try {
                    // Check absences for a 6-month window (-3 to +3 months)
                    const now = new Date();
                    const start = new Date(now);
                    start.setMonth(start.getMonth() - 3);
                    const end = new Date(now);
                    end.setMonth(end.getMonth() + 3);

                    const startInt = parseInt(
                        start.toISOString().slice(0, 10).replace(/-/g, ''),
                    );
                    const endInt = parseInt(
                        end.toISOString().slice(0, 10).replace(/-/g, ''),
                    );

                    const freshAbsences = await fetchAbsencesFromUntis(
                        user.id,
                        start,
                        end,
                    );

                    // Fetch existing from DB - use overlap logic to catch all relevant absences
                    const existingAbsences = await (
                        prisma as any
                    ).absence.findMany({
                        where: {
                            userId: user.id,
                            startDate: { lte: endInt },
                            endDate: { gte: startInt },
                        },
                    });

                    const existingMap = new Map(
                        existingAbsences.map((a: any) => [a.untisId, a]),
                    );

                    for (const fresh of freshAbsences) {
                        const existing = existingMap.get(fresh.id) as any;

                        if (!existing) {
                            // New absence
                            const dateStr = this.formatAbsenceDate(
                                fresh.startDate,
                            );
                            await this.createNotification({
                                type: 'absence_new',
                                title: 'New Absence',
                                message: `New absence recorded for ${dateStr}${
                                    fresh.reason ? `: ${fresh.reason}` : ''
                                }`,
                                userId: user.id,
                                data: fresh,
                                dedupeKey: `absence_new:${user.id}:${fresh.id}`,
                            });
                        } else {
                            // Check for changes
                            const changes: string[] = [];
                            if (existing.isExcused !== fresh.isExcused) {
                                changes.push(
                                    fresh.isExcused ? 'Excused' : 'Unexcused',
                                );
                            }
                            if (existing.reason !== fresh.reason) {
                                changes.push(
                                    `Reason: ${fresh.reason || 'None'}`,
                                );
                            }

                            if (changes.length > 0) {
                                const dateStr = this.formatAbsenceDate(
                                    fresh.startDate,
                                );
                                await this.createNotification({
                                    type: 'absence_change',
                                    title: 'Absence Updated',
                                    message: `Absence on ${dateStr} updated: ${changes.join(
                                        ', ',
                                    )}`,
                                    userId: user.id,
                                    data: { ...fresh, changes },
                                    dedupeKey: `absence_change:${user.id}:${
                                        fresh.id
                                    }:${changes.sort().join(',')}`, // Unique per change set
                                });
                            }
                        }
                    }

                    // Update DB
                    await storeAbsenceData(user.id, freshAbsences);
                } catch (e) {
                    console.error(
                        `Failed to check absences for user ${user.id}:`,
                        e,
                    );
                }
            }
        } catch (error) {
            console.error('Failed to check absence changes:', error);
        }
    }

    private formatAbsenceDate(dateInt: number): string {
        if (!dateInt) return '';
        const y = Math.floor(dateInt / 10000);
        const m = Math.floor((dateInt % 10000) / 100);
        const d = dateInt % 100;
        return `${String(y)}-${String(m).padStart(2, '0')}-${String(d).padStart(
            2,
            '0',
        )}`;
    }
}

export const notificationService = NotificationService.getInstance();
