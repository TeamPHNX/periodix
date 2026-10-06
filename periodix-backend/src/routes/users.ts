import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../server/authMiddleware.js';
import { prisma } from '../store/prisma.js';
import { WHITELIST_ENABLED } from '../server/config.js';

const router = Router();

const querySchema = z.object({ q: z.string().trim().min(1).max(100) });
const updateMeSchema = z.object({
    displayName: z.string().trim().max(100).nullable(),
    timezone: z.string().trim().min(1).max(100).optional(), // IANA timezone identifier
});

// User preferences schema
const preferencesUpdateSchema = z.object({
    hiddenSubjects: z.array(z.string().min(1)).optional(),
    onboardingCompleted: z.boolean().optional(),
});

async function hasActiveWhitelistAccess(userId: string): Promise<boolean> {
    if (!WHITELIST_ENABLED) return true;

    const requester = await prisma.user.findUnique({
        where: { id: userId },
        select: { username: true },
    });

    if (!requester?.username) return false;

    const usernameRule = await (prisma as any).whitelistRule.findFirst({
        where: { value: requester.username.toLowerCase() },
        select: { id: true },
    });

    return Boolean(usernameRule);
}

// Authenticated user search (by username/displayName)
// NOTE: Consider adding rate limiting in front of this route in production.
router.get('/search', authMiddleware, async (req, res) => {
    const parsed = querySchema.safeParse({ q: req.query.q ?? '' });
    if (!parsed.success) return res.json({ users: [] });
    const q = parsed.data.q;
    const requesterId = req.user!.id;

    try {
        const isAdmin = Boolean(req.user?.isAdmin);

        // Admins can search all users
        if (isAdmin) {
            const users = await prisma.user.findMany({
                where: {
                    OR: [
                        { username: { contains: q, mode: 'insensitive' } },
                        { displayName: { contains: q, mode: 'insensitive' } },
                    ],
                },
                select: { id: true, username: true, displayName: true },
                orderBy: [{ username: 'asc' }],
                take: 20,
            });
            return res.json({ users });
        }

        // Check global sharing setting
        const appSettings = await (prisma as any).appSettings.findFirst();
        if (appSettings && !appSettings.globalSharingEnabled) {
            return res.json({ users: [] });
        }

        // Regular users: only return users who are sharing their timetable with the requester
        // First, find all users matching the search query who have sharing enabled
        const usersWithSharing = await (prisma as any).user.findMany({
            where: {
                AND: [
                    {
                        OR: [
                            { username: { contains: q, mode: 'insensitive' } },
                            {
                                displayName: {
                                    contains: q,
                                    mode: 'insensitive',
                                },
                            },
                        ],
                    },
                    { sharingEnabled: true },
                    { id: { not: requesterId } }, // Exclude self
                ],
            },
            select: { id: true, username: true, displayName: true },
            orderBy: [{ username: 'asc' }],
            take: 20,
        });

        // Filter to only include users who are sharing with the requester
        const userIds = usersWithSharing.map((u: any) => u.id);
        if (userIds.length === 0) {
            return res.json({ users: [] });
        }

        const sharedWith = await (prisma as any).timetableShare.findMany({
            where: {
                ownerId: { in: userIds },
                sharedWithId: requesterId,
            },
            select: { ownerId: true },
        });

        const sharedUserIds = new Set(sharedWith.map((s: any) => s.ownerId));
        const filteredUsers = usersWithSharing.filter((u: any) =>
            sharedUserIds.has(u.id),
        );

        res.json({ users: filteredUsers });
    } catch {
        res.status(500).json({ error: 'Search failed' });
    }
});

// Search users to share with (for settings page)
router.get('/search-to-share', authMiddleware, async (req, res) => {
    const parsed = querySchema.safeParse({ q: req.query.q ?? '' });
    if (!parsed.success) return res.json({ users: [] });
    const q = parsed.data.q;
    const requesterId = req.user!.id;

    try {
        const hasWhitelistAccess = await hasActiveWhitelistAccess(requesterId);
        if (!hasWhitelistAccess) {
            return res.json({ users: [] });
        }

        // Check global sharing setting
        const appSettings = await (prisma as any).appSettings.findFirst();
        if (appSettings && !appSettings.globalSharingEnabled) {
            return res.json({ users: [] });
        }

        // Find all users matching the search query, excluding self
        const users = await (prisma as any).user.findMany({
            where: {
                AND: [
                    {
                        OR: [
                            { username: { contains: q, mode: 'insensitive' } },
                            {
                                displayName: {
                                    contains: q,
                                    mode: 'insensitive',
                                },
                            },
                        ],
                    },
                    { shareSearchVisible: true },
                    { id: { not: requesterId } }, // Exclude self
                ],
            },
            select: { id: true, username: true, displayName: true },
            orderBy: [{ username: 'asc' }],
            take: 20,
        });

        res.json({ users });
    } catch {
        res.status(500).json({ error: 'Search failed' });
    }
});

// Update current user's display name
router.patch('/me', authMiddleware, async (req, res) => {
    const parsed = updateMeSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.flatten() });
    }
    try {
        const userId = req.user!.id;
        const updateData: any = { displayName: parsed.data.displayName };

        // Add timezone to update data if provided
        if (parsed.data.timezone !== undefined) {
            updateData.timezone = parsed.data.timezone;
        }

        const user = await prisma.user.update({
            where: { id: userId },
            data: updateData,
            select: {
                id: true,
                username: true,
                displayName: true,
                timezone: true,
            },
        });
        res.json({ user });
    } catch {
        res.status(400).json({ error: 'Failed to update profile' });
    }
});

export default router;

// New routes for per-user preferences (hidden subjects + onboarding)
router.get('/preferences', authMiddleware, async (req, res) => {
    try {
        const userId = req.user!.id;
        // Use any-cast to avoid type drift when Prisma client isn't re-generated
        const user = await (prisma as any).user.findUnique({
            where: { id: userId },
            select: { hiddenSubjects: true, onboardingCompleted: true },
        });
        const hiddenSubjects: string[] = Array.isArray(user?.hiddenSubjects)
            ? user.hiddenSubjects
            : [];
        const onboardingCompleted: boolean = Boolean(user?.onboardingCompleted);
        res.json({ hiddenSubjects, onboardingCompleted });
    } catch {
        res.status(500).json({ error: 'Failed to load preferences' });
    }
});

router.put('/preferences', authMiddleware, async (req, res) => {
    const parsed = preferencesUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.flatten() });
    }
    try {
        const userId = req.user!.id;
        const data: any = {};
        if (parsed.data.hiddenSubjects !== undefined) {
            // De-duplicate and sort for stability
            const unique = Array.from(new Set(parsed.data.hiddenSubjects)).sort(
                (a, b) => a.localeCompare(b),
            );
            data.hiddenSubjects = unique;
        }
        if (parsed.data.onboardingCompleted !== undefined) {
            data.onboardingCompleted = parsed.data.onboardingCompleted;
        }
        if (Object.keys(data).length === 0) {
            return res.json({ success: true });
        }
        const updated = await (prisma as any).user.update({
            where: { id: userId },
            data,
            select: { hiddenSubjects: true, onboardingCompleted: true },
        });
        res.json({
            success: true,
            hiddenSubjects: updated.hiddenSubjects || [],
            onboardingCompleted: Boolean(updated.onboardingCompleted),
        });
    } catch {
        res.status(400).json({ error: 'Failed to update preferences' });
    }
});
