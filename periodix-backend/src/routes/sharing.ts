import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../server/authMiddleware.js';
import { prisma } from '../store/prisma.js';
import { WHITELIST_ENABLED } from '../server/config.js';

const router = Router();

// Schema for sharing operations
const shareUserSchema = z.object({
    userId: z.string().uuid(),
});

const updateSharingSchema = z.object({
    enabled: z.boolean().optional(),
    listedInShareSearch: z.boolean().optional(),
});

const globalSharingSchema = z.object({
    enabled: z.boolean(),
});

// Utility: safely access a Prisma model that might not exist if the generated client is stale
function getModel(name: string): any | null {
    const m = (prisma as any)[name];
    if (!m) {
        // Log only once per model name to reduce noise
        const flag = `__logged_missing_${name}`;
        if (!(global as any)[flag]) {
            console.warn(
                `[sharing] Prisma model "${name}" missing. Likely prisma generate hasn't run after schema change.`,
            );
            (global as any)[flag] = true;
        }
        return null;
    }
    return m;
}

// Get current user's sharing settings and list
router.get('/settings', authMiddleware, async (req, res) => {
    try {
        const userId = req.user!.id;

        // Get user's sharing settings
        const user = await (prisma as any).user.findUnique({
            where: { id: userId },
            select: { sharingEnabled: true, shareSearchVisible: true },
        });

        // Get list of users this user is sharing with (guard if model missing)
        let sharingWith: any[] = [];
        const timetableShareModel = getModel('timetableShare');
        if (timetableShareModel) {
            sharingWith = await timetableShareModel.findMany({
                where: { ownerId: userId },
                include: {
                    sharedWith: {
                        select: { id: true, username: true, displayName: true },
                    },
                },
            });
        }

        // Get global sharing setting (for admins)
        let globalSharingEnabled = true;
        const admin = Boolean(req.user?.isAdmin);
        if (admin) {
            const appSettingsModel = getModel('appSettings');
            if (appSettingsModel) {
                const appSettings = await appSettingsModel.findFirst();
                globalSharingEnabled =
                    appSettings?.globalSharingEnabled ?? true;
            }
        }

        res.json({
            sharingEnabled: user?.sharingEnabled ?? false,
            listedInShareSearch: user?.shareSearchVisible ?? true,
            sharingWith: sharingWith.map((s: any) => s.sharedWith),
            globalSharingEnabled,
            isAdmin: admin,
            whitelistEnabled: WHITELIST_ENABLED === true,
            // Surface flag to frontend so it can optionally warn user
            _sharingFeatureDegraded: !timetableShareModel,
        });
    } catch (error) {
        console.error('[sharing/settings] error', error);
        res.status(500).json({ error: 'Failed to get sharing settings' });
    }
});

// Update user's sharing enabled/disabled setting
router.put('/settings', authMiddleware, async (req, res) => {
    const parsed = updateSharingSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.flatten() });
    }

    try {
        const userId = req.user!.id;
        const data: Record<string, unknown> = {};

        if (typeof parsed.data.enabled === 'boolean') {
            data.sharingEnabled = parsed.data.enabled;
        }
        if (typeof parsed.data.listedInShareSearch === 'boolean') {
            data.shareSearchVisible = parsed.data.listedInShareSearch;
        }

        if (Object.keys(data).length === 0) {
            return res.status(400).json({
                error: 'At least one sharing setting must be provided',
            });
        }

        await (prisma as any).user.update({
            where: { id: userId },
            data,
        });

        res.json({ success: true });
    } catch (error) {
        console.error('[sharing/settings] error', error);
        res.status(500).json({ error: 'Failed to update sharing settings' });
    }
});

// Share timetable with another user
router.post('/share', authMiddleware, async (req, res) => {
    const parsed = shareUserSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.flatten() });
    }

    try {
        const ownerId = req.user!.id;
        const { userId: sharedWithId } = parsed.data;

        // Can't share with yourself
        if (ownerId === sharedWithId) {
            return res
                .status(400)
                .json({ error: 'Cannot share with yourself' });
        }

        // Check if target user exists
        const targetUser = await (prisma as any).user.findUnique({
            where: { id: sharedWithId },
            select: { id: true, username: true, displayName: true },
        });

        if (!targetUser) {
            return res.status(404).json({ error: 'User not found' });
        }

        const timetableShareModel = getModel('timetableShare');
        if (!timetableShareModel) {
            return res
                .status(503)
                .json({
                    error: 'Sharing feature temporarily unavailable (server missing updated Prisma client)',
                });
        }
        // Create or update share relationship
        await timetableShareModel.upsert({
            where: {
                ownerId_sharedWithId: {
                    ownerId,
                    sharedWithId,
                },
            },
            update: {},
            create: {
                ownerId,
                sharedWithId,
            },
        });

        res.json({ success: true, user: targetUser });
    } catch (error) {
        console.error('[sharing/share] error', error);
        res.status(500).json({ error: 'Failed to share timetable' });
    }
});

// Stop sharing timetable with a user
router.delete('/share/:userId', authMiddleware, async (req, res) => {
    const parsed = shareUserSchema.safeParse({ userId: req.params.userId });
    if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.flatten() });
    }

    try {
        const ownerId = req.user!.id;
        const { userId: sharedWithId } = parsed.data;

        const timetableShareModel = getModel('timetableShare');
        if (!timetableShareModel) {
            return res
                .status(503)
                .json({
                    error: 'Sharing feature temporarily unavailable (server missing updated Prisma client)',
                });
        }
        await timetableShareModel.deleteMany({
            where: {
                ownerId,
                sharedWithId,
            },
        });

        res.json({ success: true });
    } catch (error) {
        console.error('[sharing/unshare] error', error);
        res.status(500).json({ error: 'Failed to stop sharing' });
    }
});

// Admin: Toggle global sharing
router.put('/global', authMiddleware, async (req, res) => {
    if (!req.user?.isAdmin) {
        return res.status(403).json({ error: 'Admin access required' });
    }

    const parsed = globalSharingSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.flatten() });
    }

    try {
        const { enabled } = parsed.data;

        const appSettingsModel = getModel('appSettings');
        if (!appSettingsModel) {
            return res
                .status(503)
                .json({
                    error: 'App settings unavailable (missing Prisma model)',
                });
        }
        // Upsert app settings
        await appSettingsModel.upsert({
            where: { id: 'singleton' },
            update: { globalSharingEnabled: enabled },
            create: { id: 'singleton', globalSharingEnabled: enabled },
        });

        res.json({ success: true });
    } catch (error) {
        console.error('[sharing/global] error', error);
        res.status(500).json({
            error: 'Failed to update global sharing setting',
        });
    }
});

export default router;
