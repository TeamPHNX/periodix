import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware, adminOnly } from '../server/authMiddleware.js';
import rateLimit from 'express-rate-limit';
import { prisma } from '../store/prisma.js';

const router = Router();

// Rate limit for color operations
const colorLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    limit: 1000, // increased: allow up to 1000 requests per minute per IP
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: {
        error: 'Too many color requests (1000/min). Please slow down briefly.',
    },
});

const colorSchema = z.object({
    lessonName: z.string().min(1).max(100),
    color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Invalid hex color format'),
    offset: z.number().min(0).max(1).optional(),
});

const colorWithContextSchema = z.object({
    lessonName: z.string().min(1).max(100),
    color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Invalid hex color format'),
    offset: z.number().min(0).max(1).optional(),
    viewingUserId: z.string().optional(), // The user whose timetable is being viewed
});

const offsetSchema = z.object({
    lessonName: z.string().min(1).max(100),
    offset: z.number().min(0).max(1),
});

const offsetWithContextSchema = offsetSchema.extend({
    viewingUserId: z.string().optional(),
});

const lessonNameSchema = z.object({
    lessonName: z.string().min(1).max(100),
});

const lessonNameWithContextSchema = z.object({
    lessonName: z.string().min(1).max(100),
    viewingUserId: z.string().optional(), // The user whose timetable is being viewed
});

// Get user's lesson colors
router.get('/my-colors', authMiddleware, colorLimiter, async (req, res) => {
    try {
        const isAdmin = Boolean(req.user?.isAdmin);

        // Admin: return global defaults (admin has no per-user settings)
        if (isAdmin) {
            const defaults = await (prisma as any).defaultLessonColor.findMany({
                select: { lessonName: true, color: true, offset: true },
            });
            const colorMap = (
                defaults as Array<{
                    lessonName: string;
                    color: string;
                    offset: number;
                }>
            ).reduce(
                (acc: Record<string, string>, item) => {
                    acc[item.lessonName] = item.color;
                    return acc;
                },
                {} as Record<string, string>,
            );
            // Return offsets separately to avoid breaking existing clients
            const offsetMap = (
                defaults as Array<{
                    lessonName: string;
                    color: string;
                    offset: number;
                }>
            ).reduce(
                (acc: Record<string, number>, item) => {
                    acc[item.lessonName] = item.offset;
                    return acc;
                },
                {} as Record<string, number>,
            );
            res.json({ colors: colorMap, offsets: offsetMap });
            return;
        }

        // Non-admin: merge global defaults with user overrides
        const [defaults, overrides] = await Promise.all([
            (prisma as any).defaultLessonColor.findMany({
                select: { lessonName: true, color: true, offset: true },
            }),
            (prisma as any).lessonColorSetting.findMany({
                where: { userId: req.user!.id },
                select: { lessonName: true, color: true, offset: true },
            }),
        ]);

        const colorMerged: Record<string, string> = {};
        const offsetMerged: Record<string, number> = {};
        for (const item of defaults as Array<{
            lessonName: string;
            color: string;
            offset: number;
        }>) {
            colorMerged[item.lessonName] = item.color;
            offsetMerged[item.lessonName] = item.offset;
        }
        for (const item of overrides as Array<{
            lessonName: string;
            color: string;
            offset: number;
        }>) {
            colorMerged[item.lessonName] = item.color;
            offsetMerged[item.lessonName] = item.offset;
        }
        res.json({ colors: colorMerged, offsets: offsetMerged });
    } catch (error) {
        console.error('[lessonColors/my-colors] error', error);
        res.status(500).json({ error: 'Failed to fetch lesson colors' });
    }
});

// Set color for a lesson
router.post('/set-color', authMiddleware, colorLimiter, async (req, res) => {
    const validation = colorWithContextSchema.safeParse(req.body);
    if (!validation.success) {
        return res.status(400).json({ error: validation.error.flatten() });
    }

    const { lessonName, color, viewingUserId, offset } = validation.data;
    const isAdmin = Boolean(req.user?.isAdmin);
    const currentUserId = req.user!.id;

    try {
        // Scenario 1: Admin viewing another user's timetable -> modify global defaults
        if (isAdmin && viewingUserId && viewingUserId !== currentUserId) {
            await (prisma as any).defaultLessonColor.upsert({
                where: { lessonName },
                update: { color, ...(offset !== undefined ? { offset } : {}) },
                create: { lessonName, color, offset: offset ?? 0.5 },
            });
            res.json({ success: true, type: 'default' });
            return;
        }

        // Scenario 2: Admin viewing their own timetable (admin user doesn't exist in DB)
        if (isAdmin && (!viewingUserId || viewingUserId === currentUserId)) {
            // For admin users, also modify global defaults since they don't have a User record
            await (prisma as any).defaultLessonColor.upsert({
                where: { lessonName },
                update: { color, ...(offset !== undefined ? { offset } : {}) },
                create: { lessonName, color, offset: offset ?? 0.5 },
            });
            res.json({ success: true, type: 'default' });
            return;
        }

        // Scenario 3: Regular user viewing *another* user's timetable -> deny
        if (!isAdmin && viewingUserId && viewingUserId !== currentUserId) {
            return res.status(403).json({
                error: 'Not allowed to change colors while viewing another user',
            });
        }

        // Scenario 4: Regular user (own timetable) -> save user preference
        await (prisma as any).lessonColorSetting.upsert({
            where: {
                userId_lessonName: {
                    userId: currentUserId,
                    lessonName,
                },
            },
            update: { color, ...(offset !== undefined ? { offset } : {}) },
            create: {
                userId: currentUserId,
                lessonName,
                color,
                offset: offset ?? 0.5,
            },
        });

        res.json({ success: true, type: 'user' });
    } catch (error) {
        console.error('[lessonColors/set-color] error', error);
        res.status(500).json({ error: 'Failed to set lesson color' });
    }
});

// Remove color for a lesson (revert to default)
router.delete(
    '/remove-color',
    authMiddleware,
    colorLimiter,
    async (req, res) => {
        const validation = lessonNameWithContextSchema.safeParse(req.body);
        if (!validation.success) {
            return res.status(400).json({ error: validation.error.flatten() });
        }

        const { lessonName, viewingUserId } = validation.data;
        const isAdmin = Boolean(req.user?.isAdmin);
        const currentUserId = req.user!.id;

        try {
            // Scenario 1 & 2: Admin user -> remove global default
            if (isAdmin) {
                await (prisma as any).defaultLessonColor.deleteMany({
                    where: { lessonName },
                });
                res.json({ success: true, type: 'default' });
                return;
            }

            // Scenario 3: Regular user viewing another user's timetable -> forbid
            if (!isAdmin && viewingUserId && viewingUserId !== currentUserId) {
                return res.status(403).json({
                    error: 'Not allowed to modify colors for another user',
                });
            }

            // Scenario 4: Regular user -> remove their user-specific color
            await (prisma as any).lessonColorSetting.deleteMany({
                where: {
                    userId: currentUserId,
                    lessonName,
                },
            });

            res.json({ success: true, type: 'user' });
        } catch (error) {
            console.error('[lessonColors/remove-color] error', error);
            res.status(500).json({ error: 'Failed to remove lesson color' });
        }
    },
);

// Admin routes for default colors
router.get('/defaults', authMiddleware, colorLimiter, async (req, res) => {
    try {
        const defaults = await (prisma as any).defaultLessonColor.findMany({
            select: {
                lessonName: true,
                color: true,
            },
        });

        const colorMap = defaults.reduce(
            (
                acc: Record<string, string>,
                { lessonName, color }: { lessonName: string; color: string },
            ) => {
                acc[lessonName] = color;
                return acc;
            },
            {} as Record<string, string>,
        );

        res.json(colorMap);
    } catch (error) {
        console.error('[lessonColors/defaults] error', error);
        res.status(500).json({
            error: 'Failed to fetch default lesson colors',
        });
    }
});

router.post(
    '/set-default',
    authMiddleware,
    adminOnly,
    colorLimiter,
    async (req, res) => {
        const validation = colorSchema.safeParse(req.body);
        if (!validation.success) {
            return res.status(400).json({ error: validation.error.flatten() });
        }

        const { lessonName, color, offset } = validation.data;

        try {
            await (prisma as any).defaultLessonColor.upsert({
                where: { lessonName },
                update: { color, ...(offset !== undefined ? { offset } : {}) },
                create: { lessonName, color, offset: offset ?? 0.5 },
            });

            res.json({ success: true });
        } catch (error) {
            console.error('[lessonColors/set-default] error', error);
            res.status(500).json({
                error: 'Failed to set default lesson color',
            });
        }
    },
);

export default router;
