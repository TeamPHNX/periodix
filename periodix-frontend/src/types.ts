export type User = {
    id: string;
    username: string;
    displayName?: string | null;
    isAdmin?: boolean;
    isUserManager?: boolean;
    school?: string;
    timezone?: string; // IANA timezone identifier
};

export type TimetableFallbackReason = 'UNTIS_UNAVAILABLE' | 'BAD_CREDENTIALS';

export type TimetableSource = 'live' | 'cache';

export type TimetableResponse = {
    userId: string;
    rangeStart: string | null;
    rangeEnd: string | null;
    payload: unknown;
    cached?: boolean;
    stale?: boolean;
    source?: TimetableSource;
    lastUpdated?: string | null;
    fallbackReason?: TimetableFallbackReason;
    errorCode?: string | number;
    errorMessage?: string;
};

export type Lesson = {
    id: number;
    date: number; // yyyymmdd
    startTime: number; // Untis HHmm integer, e.g., 740 => 07:40
    endTime: number; // Untis HHmm integer, e.g., 825 => 08:25
    su?: Array<{ id: number; name: string; longname?: string }>;
    te?: Array<{
        id: number;
        name: string;
        longname?: string;
        orgname?: string;
    }>;
    ro?: Array<{
        id: number;
        name: string;
        longname?: string;
        orgname?: string;
    }>;
    code?: string; // e.g. 'cancelled'
    activityType?: string;
    info?: string; // Additional lesson information
    lstext?: string; // Additional lesson text (notes)
    homework?: Homework[]; // Associated homework
    exams?: Exam[]; // Associated exams
};

export type ResourceLesson = {
    date: number;
    startTime: number;
    endTime: number;
    classes: string[];
    subjects: string[];
    teachers: string[];
    rooms: string[];
    code?: string;
    info?: string;
};

export type TeacherResource = {
    id: string; // the shortname (e.g. "ABC")
    name: string; // longname if available
    lessons: ResourceLesson[];
};

export type RoomResource = {
    id: string; // room name
    name: string;
    lessons: ResourceLesson[];
};

export type AggregatedResourcesResponse = {
    teachers: TeacherResource[];
    rooms: RoomResource[];
};

export type Homework = {
    id: number;
    lessonId: number;
    date: number; // yyyymmdd - due date
    subject: { id: number; name: string; longname?: string };
    text: string;
    remark?: string;
    completed: boolean;
};

export type Exam = {
    id: number;
    date: number; // yyyymmdd - exam date
    startTime: number; // Untis HHmm integer
    endTime: number; // Untis HHmm integer
    subject: { id: number; name: string; longname?: string };
    teachers?: Array<{ id: number; name: string; longname?: string }>;
    rooms?: Array<{ id: number; name: string; longname?: string }>;
    name: string;
    text?: string;
};

export type AbsenceRecord = {
    id: number;
    startDate: number;
    endDate: number;
    startTime: number;
    endTime: number;
    createDate: number;
    lastUpdate: number;
    createdUser?: string;
    updatedUser?: string;
    reasonId?: number;
    reason?: string;
    text?: string;
    canEdit?: boolean;
    studentName?: string;
    excuseStatus?: string;
    isExcused?: boolean;
    excuse?: {
        id?: number;
        text?: string;
        excuseDate?: number;
        excuseStatus?: string;
        isExcused?: boolean;
        userId?: number;
        username?: string;
    } | null;
    interruptions?: unknown[];
};

export type AbsenceResponse = {
    userId: string;
    rangeStart: string | null;
    rangeEnd: string | null;
    absences: AbsenceRecord[];
    absenceReasons: unknown[];
    excuseStatuses: boolean;
    showAbsenceReasonChange: boolean;
    showCreateAbsence: boolean;
    cached?: boolean;
    stale?: boolean;
    source?: TimetableSource;
    lastUpdated?: string | null;
    fallbackReason?: TimetableFallbackReason;
    errorCode?: string | number;
    errorMessage?: string;
};

export type DateRange = {
    start: string;
    end: string;
};

export type AbsencePreset = 'thisMonth' | 'schoolYear' | 'allTime';

export type Holiday = {
    id: number;
    name: string;
    longName: string;
    startDate: number; // yyyymmdd
    endDate: number; // yyyymmdd
};

export type LessonColors = Record<string, string>; // lessonName -> hex color

export type ColorGradient = {
    from: string;
    via: string;
    to: string;
};

export type LessonOffsets = Record<string, number>; // lessonName -> gradient offset (0..1)

export type Notification = {
    id: string;
    type: string;
    title: string;
    message: string;
    data?: Record<string, unknown>;
    read: boolean;
    sent: boolean;
    createdAt: string;
    expiresAt?: string;
};

export type NotificationSettings = {
    id: string;
    userId: string;
    browserNotificationsEnabled: boolean;
    pushNotificationsEnabled: boolean;
    timetableChangesEnabled: boolean;
    accessRequestsEnabled: boolean;
    irregularLessonsEnabled: boolean;
    cancelledLessonsEnabled: boolean;
    upcomingLessonsEnabled: boolean;
    absencesEnabled: boolean;
    cancelledLessonsTimeScope: 'day' | 'week';
    irregularLessonsTimeScope: 'day' | 'week';
    devicePreferences?: Record<string, Record<string, unknown>>;
    createdAt: string;
    updatedAt: string;
};

export type NotificationSubscription = {
    id: string;
    userId: string;
    endpoint: string;
    p256dh: string;
    auth: string;
    userAgent?: string;
    deviceType?: 'mobile' | 'desktop' | 'tablet';
    active: boolean;
    createdAt: string;
    updatedAt: string;
};

export type AdminNotificationSettings = {
    id: string;
    timetableFetchInterval: number;
    enableTimetableNotifications: boolean;
    enableAccessRequestNotifications: boolean;
    createdAt: string;
    updatedAt: string;
};
