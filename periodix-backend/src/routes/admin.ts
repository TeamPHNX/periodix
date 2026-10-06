import { Router } from 'express';
import { z } from 'zod';
import { adminOnly } from '../server/authMiddleware.js';
import { prisma } from '../store/prisma.js';

const router = Router();

const updateUserSchema = z.object({
    displayName: z.string().trim().max(100).nullable(),
});

// List users (basic fields only)
router.get('/users', adminOnly, async (_req, res) => {
    const users = await (prisma as any).user.findMany({
        select: {
            id: true,
            username: true,
            displayName: true,
            isUserManager: true,
        },
        orderBy: { username: 'asc' },
    });
    res.json({ users });
});

// Delete user by id
router.delete('/users/:id', adminOnly, async (req, res) => {
    const id = req.params.id;
    if (!id) return res.status(400).json({ error: 'Missing id' });
    try {
        const result = await (prisma as any).user.deleteMany({ where: { id } });
        if (result.count === 0)
            return res.status(404).json({ error: 'User not found' });
        res.json({ ok: true, count: result.count });
    } catch {
        res.status(400).json({ error: 'Failed to delete user' });
    }
});

// Update user display name
router.patch('/users/:id', adminOnly, async (req, res) => {
    const id = req.params.id;
    if (!id) return res.status(400).json({ error: 'Missing id' });

    const parsed = updateUserSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.flatten() });
    }

    try {
        const user = await (prisma as any).user.update({
            where: { id },
            data: { displayName: parsed.data.displayName },
            select: {
                id: true,
                username: true,
                displayName: true,
                isUserManager: true,
            },
        });
        res.json({ user });
    } catch {
        res.status(400).json({ error: 'Failed to update user' });
    }
});

// Grant user-manager status (admin only)
router.patch('/users/:id/grant-user-manager', adminOnly, async (req, res) => {
    const id = req.params.id;
    if (!id) return res.status(400).json({ error: 'Missing id' });

    try {
        const user = await (prisma as any).user.update({
            where: { id },
            data: { isUserManager: true },
            select: {
                id: true,
                username: true,
                displayName: true,
                isUserManager: true,
            },
        });
        res.json({ user });
    } catch {
        res.status(400).json({ error: 'Failed to grant user manager status' });
    }
});

// Revoke user-manager status (admin only)
router.patch('/users/:id/revoke-user-manager', adminOnly, async (req, res) => {
    const id = req.params.id;
    if (!id) return res.status(400).json({ error: 'Missing id' });

    try {
        const user = await (prisma as any).user.update({
            where: { id },
            data: { isUserManager: false },
            select: {
                id: true,
                username: true,
                displayName: true,
                isUserManager: true,
            },
        });
        res.json({ user });
    } catch {
        res.status(400).json({ error: 'Failed to revoke user manager status' });
    }
});

// Username whitelist management (DB-backed)
const whitelistCreateSchema = z.object({
    value: z.string().trim().min(1).max(100),
});

// List whitelist rules
router.get('/whitelist', adminOnly, async (_req, res) => {
    const rules = await (prisma as any).whitelistRule.findMany({
        orderBy: [{ value: 'asc' }],
        select: { id: true, value: true, createdAt: true },
    });
    res.json({ rules });
});

// Add a whitelist rule (idempotent)
router.post('/whitelist', adminOnly, async (req, res) => {
    const parsed = whitelistCreateSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.flatten() });
    }
    const value = parsed.data.value.toLowerCase();
    try {
        const existing = await (prisma as any).whitelistRule.findFirst({
            where: { value },
            select: { id: true, value: true, createdAt: true },
        });
        if (existing) return res.json({ rule: existing, created: false });

        const rule = await (prisma as any).whitelistRule.create({
            data: { value },
            select: { id: true, value: true, createdAt: true },
        });
        res.json({ rule, created: true });
    } catch {
        res.status(400).json({ error: 'Failed to create rule' });
    }
});

// Delete a whitelist rule
router.delete('/whitelist/:id', adminOnly, async (req, res) => {
    const id = req.params.id;
    if (!id) return res.status(400).json({ error: 'Missing id' });
    try {
        const result = await (prisma as any).whitelistRule.deleteMany({
            where: { id },
        });
        if (result.count === 0)
            return res.status(404).json({ error: 'Rule not found' });
        res.json({ ok: true });
    } catch {
        res.status(400).json({ error: 'Failed to delete rule' });
    }
});

// Access request management (admin only)

// List all pending access requests
router.get('/access-requests', adminOnly, async (_req, res) => {
    const requests = await (prisma as any).accessRequest.findMany({
        orderBy: [{ createdAt: 'desc' }],
        select: { id: true, username: true, message: true, createdAt: true },
    });
    res.json({ requests });
});

// Accept an access request (add to whitelist and delete request)
router.post('/access-requests/:id/accept', adminOnly, async (req, res) => {
    const id = req.params.id;
    if (!id) return res.status(400).json({ error: 'Missing id' });

    try {
        // Find the access request
        const request = await (prisma as any).accessRequest.findUnique({
            where: { id },
            select: { id: true, username: true },
        });

        if (!request) {
            return res.status(404).json({ error: 'Access request not found' });
        }

        // Check if already whitelisted
        const existingRule = await (prisma as any).whitelistRule.findFirst({
            where: { value: request.username },
        });

        if (existingRule) {
            // Delete the request since user is already whitelisted
            await (prisma as any).accessRequest.deleteMany({ where: { id } });
            return res.json({
                success: true,
                message: 'User was already whitelisted',
            });
        }

        // Add to whitelist and delete request in a transaction
        await (prisma as any).$transaction(async (tx: any) => {
            await tx.whitelistRule.create({
                data: { value: request.username },
            });
            await tx.accessRequest.deleteMany({ where: { id } });
        });

        res.json({ success: true });
    } catch {
        res.status(400).json({ error: 'Failed to accept access request' });
    }
});

// Decline an access request (delete request)
router.delete('/access-requests/:id', adminOnly, async (req, res) => {
    const id = req.params.id;
    if (!id) return res.status(400).json({ error: 'Missing id' });

    try {
        const result = await (prisma as any).accessRequest.deleteMany({
            where: { id },
        });
        if (result.count === 0) {
            return res.status(404).json({ error: 'Access request not found' });
        }
        res.json({ success: true });
    } catch {
        res.status(400).json({ error: 'Failed to decline access request' });
    }
});

// Get admin notification settings
router.get('/notification-settings', adminOnly, async (_req, res) => {
    try {
        let settings = await (
            prisma as any
        ).adminNotificationSettings.findFirst();

        // Create default settings if they don't exist
        if (!settings) {
            settings = await (prisma as any).adminNotificationSettings.create({
                data: {
                    timetableFetchInterval: 30,
                    enableTimetableNotifications: true,
                    enableAccessRequestNotifications: true,
                },
            });
        }

        res.json({ settings });
    } catch {
        res.status(500).json({
            error: 'Failed to fetch admin notification settings',
        });
    }
});

// Update admin notification settings
const updateNotificationSettingsSchema = z.object({
    timetableFetchInterval: z.number().min(5).max(1440).optional(), // 5 minutes to 24 hours
    enableTimetableNotifications: z.boolean().optional(),
    enableAccessRequestNotifications: z.boolean().optional(),
});

router.put('/notification-settings', adminOnly, async (req, res) => {
    const parsed = updateNotificationSettingsSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.flatten() });
    }

    try {
        // Get existing settings or create default
        let settings = await (
            prisma as any
        ).adminNotificationSettings.findFirst();

        if (!settings) {
            settings = await (prisma as any).adminNotificationSettings.create({
                data: {
                    timetableFetchInterval: 30,
                    enableTimetableNotifications: true,
                    enableAccessRequestNotifications: true,
                    ...parsed.data,
                },
            });
        } else {
            settings = await (prisma as any).adminNotificationSettings.update({
                where: { id: settings.id },
                data: parsed.data,
            });
        }

        res.json({ settings, success: true });
    } catch {
        res.status(500).json({
            error: 'Failed to update admin notification settings',
        });
    }
});

export default router;
