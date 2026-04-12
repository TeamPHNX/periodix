
import { PrismaClient } from '@prisma/client';
import { prisma } from '../store/prisma.js';
import { getAllTeachersFromUntis } from './untisService.js';

interface UntisLesson {
    id: number;
    date: number;
    startTime: number;
    endTime: number;
    kl?: Array<{ id: number; name: string }>;
    te?: Array<{ id: number; name: string; longname?: string }>;
    roe?: Array<{ id: number; name: string; longname?: string }>; // Untis sometimes uses roe? Or ro? Frontend type says ro.
    ro?: Array<{ id: number; name: string; longname?: string }>;
    su?: Array<{ id: number; name: string; longname?: string }>;
    code?: string;
    activityType?: string;
}

interface ResourceLesson {
    date: number;
    startTime: number;
    endTime: number;
    classes: string[];
    subjects: string[];
    teachers: string[];
    rooms: string[];
    code?: string | undefined;
    info?: string | undefined;
}

interface TeacherResource {
    id: string; // the shortname (e.g. "ABC")
    name: string; // longname if available
    lessons: ResourceLesson[];
}

interface RoomResource {
    id: string; // room name
    name: string;
    lessons: ResourceLesson[];
}

export async function getAggregatedResources(requesterId?: string) {
    // 1. Fetch all cached user timetables AND class timetables
    const [userTimetables, classTimetables, allTeachers] = await Promise.all([
        prisma.timetable.findMany({
            select: { payload: true }
        }),
        prisma.classTimetableCache.findMany({
            select: { payload: true }
        }),
        requesterId ? getAllTeachersFromUntis(requesterId) : Promise.resolve([])
    ]);

    const teacherMap = new Map<string, TeacherResource>();
    const roomMap = new Map<string, RoomResource>();

    // Pre-populate teacherMap with all known teachers from Untis
    for (const t of allTeachers) {
        if (!teacherMap.has(t.name)) {
            teacherMap.set(t.name, {
                id: t.name,
                name: t.longName || t.name,
                lessons: []
            });
        }
    }

    const allPayloads = [
        ...userTimetables.map(t => t.payload),
        ...classTimetables.map(t => t.payload)
    ];

    for (const payload of allPayloads) {
        if (!payload || !Array.isArray(payload)) continue;
        const lessons = payload as unknown as UntisLesson[];

        for (const lesson of lessons) {
            // Process teachers
            const teachers = lesson.te || [];
            const rooms = lesson.ro || [];
            const classes = lesson.kl?.map(k => k.name) || [];
            const subjects = lesson.su?.map(s => s.name) || [];

            const resourceLesson: ResourceLesson = {
                date: lesson.date,
                startTime: lesson.startTime,
                endTime: lesson.endTime,
                classes,
                subjects,
                teachers: teachers.map(t => t.name),
                rooms: rooms.map(r => r.name),
                code: lesson.code
            };

            for (const te of teachers) {
                if (!teacherMap.has(te.name)) {
                    teacherMap.set(te.name, {
                        id: te.name,
                        name: te.longname || te.name,
                        lessons: []
                    });
                }
                // Avoid duplicates? A teacher might be in multiple users' timetables for the same lesson.
                // We should use a unique key for the lesson to dedupe.
                // A lesson is unique by teacher + date + startTime + endTime (roughly)
                // But simpler: just add it and we can dedupe later or now.
                // Let's check if we already have this lesson for this teacher.
                const existing = teacherMap.get(te.name)!;
                const isDuplicate = existing.lessons.some(l => 
                    l.date === resourceLesson.date && 
                    l.startTime === resourceLesson.startTime && 
                    l.endTime === resourceLesson.endTime
                );
                
                if (!isDuplicate) {
                    existing.lessons.push(resourceLesson);
                }
            }

            // Process rooms
            for (const ro of rooms) {
                 if (!roomMap.has(ro.name)) {
                    roomMap.set(ro.name, {
                        id: ro.name,
                        name: ro.longname || ro.name,
                        lessons: []
                    });
                }
                const existing = roomMap.get(ro.name)!;
                const isDuplicate = existing.lessons.some(l => 
                    l.date === resourceLesson.date && 
                    l.startTime === resourceLesson.startTime && 
                    l.endTime === resourceLesson.endTime
                );

                if (!isDuplicate) {
                    existing.lessons.push(resourceLesson);
                }
            }
        }
    }

    return {
        teachers: Array.from(teacherMap.values()),
        rooms: Array.from(roomMap.values())
    };
}
