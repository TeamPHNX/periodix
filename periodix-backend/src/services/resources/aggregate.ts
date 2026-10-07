// Pure aggregation of cached class timetables into teacher / room views.
// No DB or Untis access here so it can be tested in isolation.

export type UntisElement = {
    id: number;
    name: string;
    longname?: string;
    orgid?: number;
    orgname?: string;
};

export type UntisLesson = {
    id: number;
    date: number; // yyyymmdd
    startTime: number; // HHmm
    endTime: number; // HHmm
    code?: string;
    kl?: UntisElement[] | undefined;
    te?: UntisElement[] | undefined;
    su?: UntisElement[];
    ro?: UntisElement[] | undefined;
    info?: string;
    lstext?: string;
    substText?: string;
    lsnumber?: number;
    activityType?: string;
    [key: string]: unknown;
};

export type ResourceType = 'teacher' | 'room';

export type ResourceSummary = {
    id: number;
    name: string;
    longName: string;
    lessonCount: number; // non-cancelled lessons this week
};

export type TimegridUnit = { name: string; startTime: number; endTime: number };
export type TimegridDay = { day: number; timeUnits: TimegridUnit[] }; // day: 1=Sun..7=Sat (Untis)
export type RoomInfo = { id: number; name: string; longName: string };

type ResourceEntry = {
    id: number;
    name: string;
    longName: string;
    // Lessons this resource actually holds
    lessonIds: Set<number>;
    // Lessons this resource was replaced in (substitution / room change)
    displacedLessonIds: Set<number>;
};

export type WeekAggregate = {
    lessons: Map<number, UntisLesson>;
    teachers: Map<number, ResourceEntry>;
    rooms: Map<number, ResourceEntry>;
};

const isCancelled = (l: UntisLesson) => l.code === 'cancelled';

function mergeElements(
    a: UntisElement[] | undefined,
    b: UntisElement[] | undefined,
): UntisElement[] | undefined {
    if (!b?.length) return a;
    if (!a?.length) return b;
    const seen = new Set(a.map((e) => e.id));
    return [...a, ...b.filter((e) => !seen.has(e.id))];
}

function upsertEntry(
    map: Map<number, ResourceEntry>,
    el: { id: number; name: string; longname?: string },
): ResourceEntry {
    let entry = map.get(el.id);
    if (!entry) {
        entry = {
            id: el.id,
            name: el.name,
            longName: el.longname || el.name,
            lessonIds: new Set(),
            displacedLessonIds: new Set(),
        };
        map.set(el.id, entry);
    } else if (entry.longName === entry.name && el.longname) {
        entry.longName = el.longname;
    }
    return entry;
}

function indexElements(
    map: Map<number, ResourceEntry>,
    lessonId: number,
    elements: UntisElement[] | undefined,
) {
    for (const el of elements ?? []) {
        // id 0 / '---' marks "no teacher/room" in substitutions
        if (el.id > 0 && el.name && el.name !== '---') {
            upsertEntry(map, el).lessonIds.add(lessonId);
        }
        if (el.orgid && el.orgid > 0 && el.orgid !== el.id && el.orgname) {
            upsertEntry(map, {
                id: el.orgid,
                name: el.orgname,
            }).displacedLessonIds.add(lessonId);
        }
    }
}

/**
 * Merge the class timetables of one week. The same Untis lesson id shows up
 * in every class that takes part in it, so lessons are merged by id and their
 * class / teacher / room lists unioned.
 */
export function aggregateWeek(payloads: unknown[]): WeekAggregate {
    const lessons = new Map<number, UntisLesson>();
    for (const payload of payloads) {
        if (!Array.isArray(payload)) continue;
        for (const raw of payload as UntisLesson[]) {
            if (!raw || typeof raw.id !== 'number') continue;
            const existing = lessons.get(raw.id);
            if (!existing) {
                lessons.set(raw.id, { ...raw });
                continue;
            }
            existing.kl = mergeElements(existing.kl, raw.kl);
            existing.te = mergeElements(existing.te, raw.te);
            existing.ro = mergeElements(existing.ro, raw.ro);
        }
    }

    const teachers = new Map<number, ResourceEntry>();
    const rooms = new Map<number, ResourceEntry>();
    for (const lesson of lessons.values()) {
        indexElements(teachers, lesson.id, lesson.te);
        indexElements(rooms, lesson.id, lesson.ro);
    }
    // A substitute's own entry wins over the "displaced" marker
    for (const map of [teachers, rooms]) {
        for (const entry of map.values()) {
            for (const id of entry.lessonIds) entry.displacedLessonIds.delete(id);
        }
    }
    return { lessons, teachers, rooms };
}

export function summarize(
    agg: WeekAggregate,
    type: ResourceType,
): ResourceSummary[] {
    const map = type === 'teacher' ? agg.teachers : agg.rooms;
    return Array.from(map.values())
        .map((entry) => {
            let lessonCount = 0;
            for (const id of entry.lessonIds) {
                const lesson = agg.lessons.get(id);
                if (lesson && !isCancelled(lesson)) lessonCount++;
            }
            return {
                id: entry.id,
                name: entry.name,
                longName: entry.longName,
                lessonCount,
            };
        })
        .sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

/**
 * Lessons for one teacher or room, shaped like a normal timetable payload.
 * Lessons the resource was replaced in are included as cancelled copies so
 * the view shows "you were substituted / moved" instead of silently dropping them.
 */
export function resourceLessons(
    agg: WeekAggregate,
    type: ResourceType,
    id: number,
): UntisLesson[] {
    const entry = (type === 'teacher' ? agg.teachers : agg.rooms).get(id);
    if (!entry) return [];
    const result: UntisLesson[] = [];
    for (const lessonId of entry.lessonIds) {
        const lesson = agg.lessons.get(lessonId);
        if (lesson) result.push(lesson);
    }
    for (const lessonId of entry.displacedLessonIds) {
        const lesson = agg.lessons.get(lessonId);
        if (!lesson) continue;
        const replacement = (type === 'teacher' ? lesson.te : lesson.ro)
            ?.filter((el) => el.orgid === id)
            .map((el) => el.name)
            .filter((name) => name && name !== '---')
            .join(', ');
        const note =
            type === 'teacher'
                ? replacement
                    ? `Vertreten durch ${replacement}`
                    : 'Entfällt für diese Lehrkraft'
                : replacement
                  ? `Verlegt nach ${replacement}`
                  : 'Raum nicht mehr belegt';
        result.push({
            ...lesson,
            code: 'cancelled',
            info: lesson.info ? `${note} · ${lesson.info}` : note,
        });
    }
    return result.sort((a, b) => a.date - b.date || a.startTime - b.startTime);
}

export type FreeRoomSlotState = 'free' | 'busy' | 'shared' | 'conflict';

export type FreeRoomsResponse = {
    date: number;
    periods: TimegridUnit[];
    rooms: Array<{
        id: number;
        name: string;
        longName: string;
        slots: Array<{
            state: FreeRoomSlotState;
            lessons: Array<{
                subject: string;
                classes: string[];
                teachers: string[];
            }>;
        }>;
    }>;
};

function untisDateToJsDay(date: number): number {
    const y = Math.floor(date / 10000);
    const m = Math.floor((date % 10000) / 100) - 1;
    const d = date % 100;
    return new Date(Date.UTC(y, m, d)).getUTCDay();
}

/**
 * Room occupancy for one day, period by period. Cancelled lessons free their
 * room. More than one active lesson in a room at once is "shared" when they
 * have a teacher in common (combined courses), otherwise a "conflict".
 */
export function freeRooms(
    agg: WeekAggregate,
    date: number,
    timegrid: TimegridDay[],
    knownRooms: RoomInfo[],
): FreeRoomsResponse {
    const untisDay = untisDateToJsDay(date) + 1;
    const periods =
        timegrid.find((d) => d.day === untisDay)?.timeUnits ??
        timegrid[0]?.timeUnits ??
        [];

    const rooms = new Map<number, RoomInfo>();
    for (const room of knownRooms) rooms.set(room.id, room);
    for (const entry of agg.rooms.values()) {
        if (!rooms.has(entry.id)) {
            rooms.set(entry.id, {
                id: entry.id,
                name: entry.name,
                longName: entry.longName,
            });
        }
    }

    const dayLessons = Array.from(agg.lessons.values()).filter(
        (l) => l.date === date && !isCancelled(l),
    );

    const result = Array.from(rooms.values())
        .sort((a, b) => a.name.localeCompare(b.name, 'de'))
        .map((room) => {
            const inRoom = dayLessons.filter((l) =>
                l.ro?.some((r) => r.id === room.id),
            );
            const slots = periods.map((p) => {
                const overlapping = inRoom.filter(
                    (l) => l.startTime < p.endTime && l.endTime > p.startTime,
                );
                let state: FreeRoomSlotState = 'free';
                if (overlapping.length === 1) state = 'busy';
                if (overlapping.length > 1) {
                    const teacherSets = overlapping.map(
                        (l) => new Set((l.te ?? []).map((t) => t.id)),
                    );
                    const [first, ...rest] = teacherSets;
                    const sharesTeacher = [...(first ?? [])].some((id) =>
                        rest.every((set) => set.has(id)),
                    );
                    state = sharesTeacher ? 'shared' : 'conflict';
                }
                return {
                    state,
                    lessons: overlapping.map((l) => ({
                        subject: l.su?.[0]?.name ?? l.lstext ?? l.activityType ?? '',
                        classes: (l.kl ?? []).map((k) => k.name),
                        teachers: (l.te ?? []).map((t) => t.name),
                    })),
                };
            });
            return { ...room, slots };
        });

    return { date, periods, rooms: result };
}
