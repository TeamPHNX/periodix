type ViteImportMeta = { env?: { VITE_API_BASE?: string } };
const API_BASE: string | undefined = (import.meta as unknown as ViteImportMeta)
    .env?.VITE_API_BASE;

import type {
    LessonColors,
    LessonOffsets,
    User,
    Notification,
    NotificationSettings,
    AdminNotificationSettings,
    Holiday,
    TimetableResponse,
    AbsenceResponse,
} from './types';

// Global logout handler - will be set by App.tsx
let globalLogoutHandler: (() => void) | null = null;
// Global token update handler - will be set by App.tsx
let globalTokenUpdateHandler: ((newToken: string) => void) | null = null;

export function setGlobalLogoutHandler(handler: () => void) {
    globalLogoutHandler = handler;
}

export function setGlobalTokenUpdateHandler(
    handler: (newToken: string) => void,
) {
    globalTokenUpdateHandler = handler;
}

function handleAuthError(text: string): void {
    // Check if this is an "Invalid token" error
    if (text.includes('Invalid token') && globalLogoutHandler) {
        console.warn('Invalid token detected, logging out automatically');
        globalLogoutHandler();
    }
}

function handleTokenRefresh(response: Response): void {
    // Check if response contains a refreshed token
    const refreshedToken = response.headers.get('X-Refreshed-Token');
    if (refreshedToken && globalTokenUpdateHandler) {
        globalTokenUpdateHandler(refreshedToken);
    }
}

export async function api<T>(
    path: string,
    opts: RequestInit & { token?: string } = {},
): Promise<T> {
    // Prefer configured API base; otherwise, build relative to current host
    // This ensures requests go to the same IP/host the site was loaded from
    const base = (API_BASE ?? '').trim();
    if (!base) {
        // Use relative path so the browser hits the same host/IP the site was loaded from
        return fetch(path, {
            ...opts,
            headers: {
                'Content-Type': 'application/json',
                ...(opts.token
                    ? { Authorization: `Bearer ${opts.token}` }
                    : {}),
                ...(opts.headers || {}),
            },
        }).then(async (res) => {
            const text = await res.text();
            if (!res.ok) {
                // Bubble up structured info for 429 to support auto-retry
                if (res.status === 429) {
                    const retryAfterHeader = res.headers.get('Retry-After');
                    let retryAfter: number | undefined = undefined;
                    const n = Number(retryAfterHeader);
                    if (Number.isFinite(n) && n >= 0) retryAfter = n;
                    try {
                        const body = JSON.parse(text);
                        const payload = {
                            error: body?.error || text || 'Too Many Requests',
                            status: 429,
                            retryAfter: body?.retryAfter ?? retryAfter,
                        };
                        throw new Error(JSON.stringify(payload));
                    } catch {
                        const payload = {
                            error: text || 'Too Many Requests',
                            status: 429,
                            retryAfter,
                        };
                        throw new Error(JSON.stringify(payload));
                    }
                }
                // Check for authentication errors and trigger auto-logout
                if (res.status === 401) {
                    handleAuthError(text);
                }
                throw new Error(text);
            }
            // Handle token refresh for successful responses
            handleTokenRefresh(res);
            return text ? JSON.parse(text) : (undefined as unknown as T);
        });
    }
    const baseNormalized = base.replace(/\/$/, '');
    const url = `${baseNormalized}${path}`;
    const res = await fetch(url, {
        ...opts,
        headers: {
            'Content-Type': 'application/json',
            ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
            ...(opts.headers || {}),
        },
    });
    const text = await res.text();
    if (!res.ok) {
        if (res.status === 429) {
            const retryAfterHeader = res.headers.get('Retry-After');
            let retryAfter: number | undefined = undefined;
            const n = Number(retryAfterHeader);
            if (Number.isFinite(n) && n >= 0) retryAfter = n;
            try {
                const body = JSON.parse(text);
                const payload = {
                    error: body?.error || text || 'Too Many Requests',
                    status: 429,
                    retryAfter: body?.retryAfter ?? retryAfter,
                };
                throw new Error(JSON.stringify(payload));
            } catch {
                const payload = {
                    error: text || 'Too Many Requests',
                    status: 429,
                    retryAfter,
                };
                throw new Error(JSON.stringify(payload));
            }
        }
        // Check for authentication errors and trigger auto-logout
        if (res.status === 401) {
            handleAuthError(text);
        }
        throw new Error(text);
    }
    // Handle token refresh for successful responses
    handleTokenRefresh(res);
    return text ? JSON.parse(text) : (undefined as unknown as T);
}

// Lesson color API functions
export async function getLessonColors(
    token: string,
): Promise<{ colors: LessonColors; offsets: LessonOffsets }> {
    return api<{ colors: LessonColors; offsets: LessonOffsets }>(
        '/api/lesson-colors/my-colors',
        { token },
    );
}

export async function getHolidays(token: string): Promise<{ data: Holiday[] }> {
    return api<{ data: Holiday[] }>('/api/timetable/holidays', { token });
}

export async function setLessonColor(
    token: string,
    lessonName: string,
    color: string,
    viewingUserId?: string,
    offset?: number,
): Promise<{ success: boolean; type?: string }> {
    const body: {
        lessonName: string;
        color: string;
        viewingUserId?: string;
        offset?: number;
    } = { lessonName, color };
    if (viewingUserId) {
        body.viewingUserId = viewingUserId;
    }
    if (offset !== undefined) body.offset = offset;
    return api<{ success: boolean; type?: string }>(
        '/api/lesson-colors/set-color',
        {
            method: 'POST',
            token,
            body: JSON.stringify(body),
        },
    );
}

export async function removeLessonColor(
    token: string,
    lessonName: string,
    viewingUserId?: string,
): Promise<{ success: boolean; type?: string }> {
    const body: { lessonName: string; viewingUserId?: string } = { lessonName };
    if (viewingUserId) {
        body.viewingUserId = viewingUserId;
    }
    return api<{ success: boolean; type?: string }>(
        '/api/lesson-colors/remove-color',
        {
            method: 'DELETE',
            token,
            body: JSON.stringify(body),
        },
    );
}

export async function getDefaultLessonColors(
    token: string,
): Promise<LessonColors> {
    return api<LessonColors>('/api/lesson-colors/defaults', { token });
}

export async function setDefaultLessonColor(
    token: string,
    lessonName: string,
    color: string,
): Promise<{ success: boolean }> {
    return api<{ success: boolean }>('/api/lesson-colors/set-default', {
        method: 'POST',
        token,
        body: JSON.stringify({ lessonName, color }),
    });
}

// Sharing API functions
export type SharingSettings = {
    sharingEnabled: boolean;
    listedInShareSearch: boolean;
    sharingWith: Array<{ id: string; username: string; displayName?: string }>;
    globalSharingEnabled: boolean;
    isAdmin: boolean;
    whitelistEnabled?: boolean;
};

export async function getSharingSettings(
    token: string,
): Promise<SharingSettings> {
    return api<SharingSettings>('/api/sharing/settings', { token });
}

export async function updateSharingEnabled(
    token: string,
    enabled: boolean,
): Promise<{ success: boolean }> {
    return api<{ success: boolean }>('/api/sharing/settings', {
        method: 'PUT',
        token,
        body: JSON.stringify({ enabled }),
    });
}

export async function updateSharingListing(
    token: string,
    listedInShareSearch: boolean,
): Promise<{ success: boolean }> {
    return api<{ success: boolean }>('/api/sharing/settings', {
        method: 'PUT',
        token,
        body: JSON.stringify({ listedInShareSearch }),
    });
}

export async function shareWithUser(
    token: string,
    userId: string,
): Promise<{ success: boolean; user?: User }> {
    return api<{ success: boolean; user?: User }>('/api/sharing/share', {
        method: 'POST',
        token,
        body: JSON.stringify({ userId }),
    });
}

export async function stopSharingWithUser(
    token: string,
    userId: string,
): Promise<{ success: boolean }> {
    return api<{ success: boolean }>(`/api/sharing/share/${userId}`, {
        method: 'DELETE',
        token,
    });
}

export async function updateGlobalSharing(
    token: string,
    enabled: boolean,
): Promise<{ success: boolean }> {
    return api<{ success: boolean }>('/api/sharing/global', {
        method: 'PUT',
        token,
        body: JSON.stringify({ enabled }),
    });
}

export async function searchUsersToShare(
    token: string,
    query: string,
): Promise<{
    users: Array<{ id: string; username: string; displayName?: string }>;
}> {
    return api<{
        users: Array<{ id: string; username: string; displayName?: string }>;
    }>(`/api/users/search-to-share?q=${encodeURIComponent(query)}`, { token });
}

// Admin user management
export async function updateUserDisplayName(
    token: string,
    userId: string,
    displayName: string | null,
): Promise<{
    user: { id: string; username: string; displayName: string | null };
}> {
    return api<{
        user: { id: string; username: string; displayName: string | null };
    }>(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        token,
        body: JSON.stringify({ displayName }),
    });
}

// New: current user can update their own display name and timezone
export async function updateMyProfile(
    token: string,
    data: { displayName?: string | null; timezone?: string },
): Promise<{
    user: {
        id: string;
        username: string;
        displayName: string | null;
        timezone?: string;
    };
}> {
    return api<{
        user: {
            id: string;
            username: string;
            displayName: string | null;
            timezone?: string;
        };
    }>(`/api/users/me`, {
        method: 'PATCH',
        token,
        body: JSON.stringify(data),
    });
}

// New: Whitelist management (username-only)
export type WhitelistRule = { id: string; value: string; createdAt: string };
export async function listWhitelist(
    token: string,
): Promise<{ rules: WhitelistRule[] }> {
    return api<{ rules: WhitelistRule[] }>(`/api/admin/whitelist`, { token });
}
export async function addWhitelistRule(
    token: string,
    value: string,
): Promise<{ rule: WhitelistRule; created: boolean }> {
    return api<{ rule: WhitelistRule; created: boolean }>(
        `/api/admin/whitelist`,
        {
            method: 'POST',
            token,
            body: JSON.stringify({ value }),
        },
    );
}
export async function deleteWhitelistRule(
    token: string,
    id: string,
): Promise<{ ok: boolean }> {
    return api<{ ok: boolean }>(`/api/admin/whitelist/${id}`, {
        method: 'DELETE',
        token,
    });
}

// Access request API functions
export type AccessRequest = {
    id: string;
    username: string;
    message?: string;
    createdAt: string;
};

export async function createAccessRequest(
    username: string,
    message?: string,
): Promise<{ request?: AccessRequest; success: boolean; message?: string }> {
    return api<{ request?: AccessRequest; success: boolean; message?: string }>(
        '/api/access-request',
        {
            method: 'POST',
            body: JSON.stringify({ username, message }),
        },
    );
}

export async function listAccessRequests(
    token: string,
): Promise<{ requests: AccessRequest[] }> {
    return api<{ requests: AccessRequest[] }>('/api/admin/access-requests', {
        token,
    });
}

export async function acceptAccessRequest(
    token: string,
    id: string,
): Promise<{ success: boolean; message?: string }> {
    return api<{ success: boolean; message?: string }>(
        `/api/admin/access-requests/${id}/accept`,
        {
            method: 'POST',
            token,
        },
    );
}

export async function declineAccessRequest(
    token: string,
    id: string,
): Promise<{ success: boolean }> {
    return api<{ success: boolean }>(`/api/admin/access-requests/${id}`, {
        method: 'DELETE',
        token,
    });
}

// Admin user management functions
export async function listAllUsers(token: string): Promise<{
    users: Array<{
        id: string;
        username: string;
        displayName: string | null;
        isUserManager: boolean;
    }>;
}> {
    return api<{
        users: Array<{
            id: string;
            username: string;
            displayName: string | null;
            isUserManager: boolean;
        }>;
    }>('/api/admin/users', { token });
}

export async function deleteUser(
    token: string,
    userId: string,
): Promise<{ ok: boolean; count: number }> {
    return api<{ ok: boolean; count: number }>(`/api/admin/users/${userId}`, {
        method: 'DELETE',
        token,
    });
}

export async function adminUpdateUserDisplayName(
    token: string,
    userId: string,
    displayName: string | null,
): Promise<{
    user: {
        id: string;
        username: string;
        displayName: string | null;
        isUserManager: boolean;
    };
}> {
    return api<{
        user: {
            id: string;
            username: string;
            displayName: string | null;
            isUserManager: boolean;
        };
    }>(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        token,
        body: JSON.stringify({ displayName }),
    });
}

// User-manager management (admin only)
export async function grantUserManagerStatus(
    token: string,
    userId: string,
): Promise<{
    user: {
        id: string;
        username: string;
        displayName: string | null;
        isUserManager: boolean;
    };
}> {
    return api<{
        user: {
            id: string;
            username: string;
            displayName: string | null;
            isUserManager: boolean;
        };
    }>(`/api/admin/users/${userId}/grant-user-manager`, {
        method: 'PATCH',
        token,
    });
}

export async function revokeUserManagerStatus(
    token: string,
    userId: string,
): Promise<{
    user: {
        id: string;
        username: string;
        displayName: string | null;
        isUserManager: boolean;
    };
}> {
    return api<{
        user: {
            id: string;
            username: string;
            displayName: string | null;
            isUserManager: boolean;
        };
    }>(`/api/admin/users/${userId}/revoke-user-manager`, {
        method: 'PATCH',
        token,
    });
}

// User-manager API functions (accessible by admin or user-manager)
export async function userManagerUpdateUserDisplayName(
    token: string,
    userId: string,
    displayName: string | null,
): Promise<{
    user: { id: string; username: string; displayName: string | null };
}> {
    return api<{
        user: { id: string; username: string; displayName: string | null };
    }>(`/api/user-manager/users/${userId}`, {
        method: 'PATCH',
        token,
        body: JSON.stringify({ displayName }),
    });
}

export async function userManagerListWhitelist(
    token: string,
): Promise<{ rules: WhitelistRule[] }> {
    return api<{ rules: WhitelistRule[] }>('/api/user-manager/whitelist', {
        token,
    });
}

export async function userManagerAddWhitelistRule(
    token: string,
    value: string,
): Promise<{ rule: WhitelistRule; created: boolean }> {
    return api<{ rule: WhitelistRule; created: boolean }>(
        '/api/user-manager/whitelist',
        {
            method: 'POST',
            token,
            body: JSON.stringify({ value }),
        },
    );
}

export async function userManagerDeleteWhitelistRule(
    token: string,
    id: string,
): Promise<{ ok: boolean }> {
    return api<{ ok: boolean }>(`/api/user-manager/whitelist/${id}`, {
        method: 'DELETE',
        token,
    });
}

export async function userManagerListAccessRequests(
    token: string,
): Promise<{ requests: AccessRequest[] }> {
    return api<{ requests: AccessRequest[] }>(
        '/api/user-manager/access-requests',
        { token },
    );
}

export async function userManagerAcceptAccessRequest(
    token: string,
    id: string,
): Promise<{ success: boolean; message?: string }> {
    return api<{ success: boolean; message?: string }>(
        `/api/user-manager/access-requests/${id}/accept`,
        {
            method: 'POST',
            token,
        },
    );
}

export async function userManagerDeclineAccessRequest(
    token: string,
    id: string,
): Promise<{ success: boolean }> {
    return api<{ success: boolean }>(
        `/api/user-manager/access-requests/${id}`,
        {
            method: 'DELETE',
            token,
        },
    );
}

// Notification API functions
export async function getNotifications(
    token: string,
): Promise<{ notifications: Notification[] }> {
    return api<{ notifications: Notification[] }>('/api/notifications', {
        token,
    });
}

export async function markNotificationAsRead(
    token: string,
    notificationId: string,
): Promise<{ success: boolean }> {
    return api<{ success: boolean }>(
        `/api/notifications/${notificationId}/read`,
        {
            method: 'PATCH',
            token,
        },
    );
}

export async function markAllNotificationsAsRead(
    token: string,
): Promise<{ success: boolean }> {
    return api<{ success: boolean }>('/api/notifications/read-all', {
        method: 'PATCH',
        token,
    });
}

export async function deleteNotification(
    token: string,
    notificationId: string,
): Promise<{ success: boolean }> {
    return api<{ success: boolean }>(`/api/notifications/${notificationId}`, {
        method: 'DELETE',
        token,
    });
}

export async function getNotificationSettings(
    token: string,
): Promise<{ settings: NotificationSettings }> {
    return api<{ settings: NotificationSettings }>(
        '/api/notifications/settings',
        { token },
    );
}

export async function updateNotificationSettings(
    token: string,
    settings: Partial<
        Pick<
            NotificationSettings,
            | 'browserNotificationsEnabled'
            | 'pushNotificationsEnabled'
            | 'timetableChangesEnabled'
            | 'accessRequestsEnabled'
            | 'irregularLessonsEnabled'
            | 'cancelledLessonsEnabled'
            | 'upcomingLessonsEnabled'
            | 'devicePreferences'
        >
    >,
): Promise<{ settings: NotificationSettings; success: boolean }> {
    return api<{ settings: NotificationSettings; success: boolean }>(
        '/api/notifications/settings',
        {
            method: 'PUT',
            token,
            body: JSON.stringify(settings),
        },
    );
}

export async function subscribeToPushNotifications(
    token: string,
    subscription: {
        endpoint: string;
        p256dh: string;
        auth: string;
        userAgent?: string;
        deviceType?: 'mobile' | 'desktop' | 'tablet';
    },
): Promise<{ subscription: Record<string, unknown>; success: boolean }> {
    return api<{ subscription: Record<string, unknown>; success: boolean }>(
        '/api/notifications/subscribe',
        {
            method: 'POST',
            token,
            body: JSON.stringify(subscription),
        },
    );
}

export async function unsubscribeFromPushNotifications(
    token: string,
    endpoint: string,
): Promise<{ success: boolean }> {
    // Single canonical form: query parameter only (prevents accidental legacy path usage)
    return api<{ success: boolean }>(
        `/api/notifications/subscribe?endpoint=${encodeURIComponent(endpoint)}`,
        {
            method: 'DELETE',
            token,
        },
    );
}

// Get VAPID public key for push notifications
export async function getVapidPublicKey(): Promise<{ publicKey: string }> {
    return api<{ publicKey: string }>('/api/notifications/vapid-public-key');
}

// Admin notification settings
export async function getAdminNotificationSettings(
    token: string,
): Promise<{ settings: AdminNotificationSettings }> {
    return api<{ settings: AdminNotificationSettings }>(
        '/api/admin/notification-settings',
        { token },
    );
}

export async function updateAdminNotificationSettings(
    token: string,
    settings: Partial<
        Pick<
            AdminNotificationSettings,
            | 'timetableFetchInterval'
            | 'enableTimetableNotifications'
            | 'enableAccessRequestNotifications'
        >
    >,
): Promise<{ settings: AdminNotificationSettings; success: boolean }> {
    return api<{ settings: AdminNotificationSettings; success: boolean }>(
        '/api/admin/notification-settings',
        {
            method: 'PUT',
            token,
            body: JSON.stringify(settings),
        },
    );
}

// Analytics API functions
export interface DashboardStats {
    totalUsers: number;
    activeUsersToday: number;
    newUsersToday: number;
    totalLoginsToday: number;
    timetableViewsToday: number;
    searchQueriesToday: number;
    avgSessionDuration?: number;
    peakHour?: number;
    serverOffsetMinutes?: number;
}

export interface UserEngagementMetrics {
    mostActiveUsers: Array<{
        userId: string;
        username: string;
        displayName: string | null;
        activityCount: number;
        lastActivity: Date;
    }>;
    userGrowthTrend: Array<{
        date: string;
        newUsers: number;
        totalUsers: number;
    }>;
    retentionRate: number;
}

export interface ActivityTrends {
    hourlyActivity: Array<{
        hour: number;
        count: number;
        label: string;
    }>;
    dailyActivity: Array<{
        date: string;
        logins: number;
        timetableViews: number;
        searches: number;
    }>;
    featureUsage: Array<{
        feature: string;
        count: number;
        percentage: number;
    }>;
    serverOffsetMinutes?: number;
}

export interface AnalyticsOverview {
    dashboard: DashboardStats;
    engagement: UserEngagementMetrics;
    trends: ActivityTrends;
}

export type AnalyticsDetailMetric =
    | 'logins_today'
    | 'active_today'
    | 'timetable_views_today'
    | 'searches_today'
    | 'new_users_today'
    | 'session_duration_top'
    | 'total_users'
    | 'retention';
export interface AnalyticsDetailItem {
    userId: string;
    username: string;
    displayName: string | null;
    count?: number;
    firstAt?: string;
    lastAt?: string;
    avgSessionMinutes?: number;
    sessionCount?: number;
}
export interface AnalyticsDetailsResponse {
    metric: AnalyticsDetailMetric;
    items: AnalyticsDetailItem[];
}

// Per-user insight types
export interface UserInsightSummary {
    userId: string;
    username: string;
    displayName: string | null;
    totalActivities: number;
    firstActivityAt?: string;
    lastActivityAt?: string;
    todayActivityCount: number;
    avgSessionMinutesToday?: number;
    featureUsage: Array<{
        feature: string;
        count: number;
        percentage: number;
    }>;
    recentActivities: Array<{
        action: string;
        createdAt: string;
    }>;
}

export async function trackActivity(
    token: string,
    action: string,
    details?: Record<string, unknown>,
): Promise<{ success: boolean }> {
    return api<{ success: boolean }>('/api/analytics/track', {
        method: 'POST',
        token,
        body: JSON.stringify({ action, details }),
    });
}

export async function getDashboardStats(
    token: string,
): Promise<{ stats: DashboardStats }> {
    return api<{ stats: DashboardStats }>('/api/analytics/dashboard', {
        token,
    });
}

export async function getUserEngagementMetrics(
    token: string,
): Promise<{ metrics: UserEngagementMetrics }> {
    return api<{ metrics: UserEngagementMetrics }>(
        '/api/analytics/engagement',
        { token },
    );
}

export async function getActivityTrends(
    token: string,
): Promise<{ trends: ActivityTrends }> {
    return api<{ trends: ActivityTrends }>('/api/analytics/trends', { token });
}

export async function getAnalyticsOverview(
    token: string,
): Promise<AnalyticsOverview> {
    return api<AnalyticsOverview>('/api/analytics/overview', { token });
}

export async function getAnalyticsDetails(
    token: string,
    metric: AnalyticsDetailMetric,
): Promise<{ details: AnalyticsDetailsResponse }> {
    const params = new URLSearchParams({ metric });
    return api<{ details: AnalyticsDetailsResponse }>(
        `/api/analytics/details?${params.toString()}`,
        { token },
    );
}

export async function getUserInsight(
    token: string,
    userId: string,
): Promise<{ insight: UserInsightSummary }> {
    return api<{ insight: UserInsightSummary }>(
        `/api/analytics/user/${encodeURIComponent(userId)}`,
        { token },
    );
}

export { API_BASE };

// User preferences (hidden subjects + onboarding)
export type UserPreferences = {
    hiddenSubjects: string[];
    onboardingCompleted: boolean;
};

export async function getUserPreferences(
    token: string,
): Promise<UserPreferences> {
    return api<UserPreferences>('/api/users/preferences', { token });
}

export async function updateUserPreferences(
    token: string,
    prefs: Partial<UserPreferences>,
): Promise<{ success: boolean } & Partial<UserPreferences>> {
    return api<{ success: boolean } & Partial<UserPreferences>>(
        '/api/users/preferences',
        {
            method: 'PUT',
            token,
            body: JSON.stringify(prefs),
        },
    );
}

// Class timetable API functions
export type ClassInfo = {
    id: number;
    name: string;
    longName: string;
};

export async function getUserClasses(
    token: string,
): Promise<{ classes: ClassInfo[] }> {
    return api<{ classes: ClassInfo[] }>('/api/timetable/classes', { token });
}

export async function getClassTimetable(
    token: string,
    classId: number,
    start?: string,
    end?: string,
): Promise<TimetableResponse> {
    const params = new URLSearchParams();
    if (start) params.append('start', start);
    if (end) params.append('end', end);
    const query = params.toString();
    const url = `/api/timetable/class/${classId}${query ? `?${query}` : ''}`;
    return api<TimetableResponse>(url, { token });
}

export async function searchClasses(
    token: string,
    query: string,
): Promise<{ classes: ClassInfo[] }> {
    return api<{ classes: ClassInfo[] }>(
        `/api/timetable/classes/search?q=${encodeURIComponent(query)}`,
        { token },
    );
}

export async function getAbsentLessons(
    token: string,
    options?: { start?: string; end?: string; excuseStatusId?: number },
): Promise<AbsenceResponse> {
    const params = new URLSearchParams();
    if (options?.start) params.append('start', options.start);
    if (options?.end) params.append('end', options.end);
    if (
        typeof options?.excuseStatusId === 'number' &&
        Number.isFinite(options.excuseStatusId)
    ) {
        params.append('excuseStatusId', String(options.excuseStatusId));
    }
    const query = params.toString();
    const url = `/api/timetable/absences${query ? `?${query}` : ''}`;
    return api<AbsenceResponse>(url, { token });
}
