import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../server/authMiddleware.js';
import {
    getOrFetchTimetableRange,
    getHolidays,
    getUserClasses,
    getClassTimetable,
    searchClasses,
    getAbsentLessons,
} from '../services/untisService.js';
import {
    untisUserLimiter,
    untisClassLimiter,
} from '../server/untisRateLimiter.js';
import { prisma } from '../store/prisma.js';

const router = Router();

const rangeSchema = z.object({
    userId: z.string().uuid().optional(),
    start: z.string().optional(),
    end: z.string().optional(),
});

const classRangeSchema = z.object({
    classId: z.coerce.number(),
    start: z.string().optional(),
    end: z.string().optional(),
});

const absenceRangeSchema = z.object({
    start: z.string().optional(),
    end: z.string().optional(),
    excuseStatusId: z.coerce.number().int().optional(),
});

router.get('/holidays', authMiddleware, async (req, res) => {
    try {
        const holidays = await getHolidays(req.user!.id);
        res.json({ ok: true, data: holidays });
    } catch (e: any) {
        const status = e?.status || 500;
        const isServerError = status >= 500;
        console.error('[timetable/holidays] error', {
            status,
            message: e?.message,
            code: e?.code,
        });
        res.status(status).json({
            error: isServerError ? 'Failed' : e?.message || 'Failed',
            code: isServerError ? undefined : e?.code,
        });
    }
});

router.get('/absences', authMiddleware, untisUserLimiter, async (req, res) => {
    const params = absenceRangeSchema.safeParse(req.query);
    if (!params.success) {
        return res.status(400).json({ error: params.error.flatten() });
    }
    try {
        const payload: {
            userId: string;
            start?: string;
            end?: string;
            excuseStatusId?: number;
        } = { userId: req.user!.id };
        if (params.data.start) payload.start = params.data.start;
        if (params.data.end) payload.end = params.data.end;
        if (typeof params.data.excuseStatusId === 'number') {
            payload.excuseStatusId = params.data.excuseStatusId;
        }
        const data = await getAbsentLessons(payload);
        res.json(data);
    } catch (e: any) {
        const status = e?.status || 500;
        const isServerError = status >= 500;
        console.error('[timetable/absences] error', {
            status,
            message: e?.message,
            code: e?.code,
        });
        res.status(status).json({
            error: isServerError ? 'Failed' : e?.message || 'Failed',
            code: isServerError ? undefined : e?.code,
        });
    }
});

router.get('/me', authMiddleware, untisUserLimiter, async (req, res) => {
    try {
        const start = req.query.start as string | undefined;
        const end = req.query.end as string | undefined;
        const data = await getOrFetchTimetableRange({
            requesterId: req.user!.id,
            targetUserId: req.user!.id,
            start,
            end,
        });
        res.json(data);
    } catch (e: any) {
        const status = e?.status || 500;
        const isServerError = status >= 500;
        console.error('[timetable/me] error', {
            status,
            message: e?.message,
            code: e?.code,
        });
        res.status(status).json({
            error: isServerError ? 'Failed' : e?.message || 'Failed',
            code: isServerError ? undefined : e?.code,
        });
    }
});

router.get(
    '/user/:userId',
    authMiddleware,
    untisUserLimiter,
    async (req, res) => {
        const params = rangeSchema.safeParse({
            ...req.query,
            userId: req.params.userId,
        });
        if (!params.success)
            return res.status(400).json({ error: params.error.flatten() });
        try {
            const { userId, start, end } = params.data;
            const requesterId = req.user!.id;

            const isAdmin = Boolean(req.user?.isAdmin);

            // Admins can view any user's timetable
            if (isAdmin) {
                const data = await getOrFetchTimetableRange({
                    requesterId: userId!,
                    targetUserId: userId!,
                    start,
                    end,
                });
                return res.json(data);
            }

            // Check if requesting own timetable
            if (requesterId === userId) {
                const data = await getOrFetchTimetableRange({
                    requesterId,
                    targetUserId: userId!,
                    start,
                    end,
                });
                return res.json(data);
            }

            // Check global sharing setting
            const appSettings = await (prisma as any).appSettings.findFirst();
            if (appSettings && !appSettings.globalSharingEnabled) {
                return res.status(403).json({
                    error: 'Timetable sharing is currently disabled',
                });
            }

            // Check if target user has sharing enabled and is sharing with requester
            const targetUser = await (prisma as any).user.findUnique({
                where: { id: userId },
                select: { sharingEnabled: true },
            });

            if (!targetUser || !targetUser.sharingEnabled) {
                return res.status(403).json({
                    error: 'User is not sharing their timetable',
                });
            }

            // Check if there's a sharing relationship
            const shareRelationship = await (
                prisma as any
            ).timetableShare.findUnique({
                where: {
                    ownerId_sharedWithId: {
                        ownerId: userId!,
                        sharedWithId: requesterId,
                    },
                },
            });

            if (!shareRelationship) {
                return res.status(403).json({
                    error: 'You do not have permission to view this timetable',
                });
            }

            const data = await getOrFetchTimetableRange({
                requesterId,
                targetUserId: userId!,
                start,
                end,
            });
            res.json(data);
        } catch (e: any) {
            const status = e?.status || 500;
            const isServerError = status >= 500;
            console.error('[timetable/user] error', {
                status,
                message: e?.message,
                code: e?.code,
            });
            res.status(status).json({
                error: isServerError ? 'Failed' : e?.message || 'Failed',
                code: isServerError ? undefined : e?.code,
            });
        }
    },
);

// Get list of classes available to the user
router.get('/classes', authMiddleware, untisClassLimiter, async (req, res) => {
    try {
        const classes = await getUserClasses(req.user!.id);
        res.json({ ok: true, classes });
    } catch (e: any) {
        const status = e?.status || 500;
        const isServerError = status >= 500;
        console.error('[timetable/classes] error', {
            status,
            message: e?.message,
            code: e?.code,
        });
        res.status(status).json({
            error: isServerError ? 'Failed' : e?.message || 'Failed',
            code: isServerError ? undefined : e?.code,
        });
    }
});

// Get class timetable
router.get(
    '/class/:classId',
    authMiddleware,
    untisClassLimiter,
    async (req, res) => {
        const params = classRangeSchema.safeParse({
            ...req.query,
            classId: req.params.classId,
        });
        if (!params.success) {
            return res.status(400).json({ error: params.error.flatten() });
        }
        try {
            const { classId, start, end } = params.data;
            const requesterId = req.user!.id;

            const data = await getClassTimetable({
                requesterId,
                classId,
                start,
                end,
            });
            res.json(data);
        } catch (e: any) {
            const status = e?.status || 500;
            const isServerError = status >= 500;
            console.error('[timetable/class] error', {
                status,
                message: e?.message,
                code: e?.code,
            });
            res.status(status).json({
                error: isServerError ? 'Failed' : e?.message || 'Failed',
                code: isServerError ? undefined : e?.code,
            });
        }
    },
);

// Search for classes
router.get(
    '/classes/search',
    authMiddleware,
    untisClassLimiter,
    async (req, res) => {
        const q = (req.query.q as string)?.trim();
        if (!q || q.length < 2) {
            return res.json({ classes: [] });
        }

        try {
            const classes = await searchClasses(req.user!.id, q);
            res.json({ classes });
        } catch (e: any) {
            const status = e?.status || 500;
            const isServerError = status >= 500;
            console.error('[timetable/classes/search] error', {
                status,
                message: e?.message,
                code: e?.code,
            });
            res.status(status).json({
                error: isServerError ? 'Failed' : e?.message || 'Failed',
                code: isServerError ? undefined : e?.code,
            });
        }
    },
);

export default router;
