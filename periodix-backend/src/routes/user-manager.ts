import { Router } from 'express';
import { z } from 'zod';
import { adminOrUserManagerOnly } from '../server/authMiddleware.js';
import { prisma } from '../store/prisma.js';

const router = Router();

const updateUserSchema = z.object({
    displayName: z.string().trim().max(100).nullable(),
});

// List users (basic fields only) - accessible by admin or user-manager
router.get('/users', adminOrUserManagerOnly, async (_req, res) => {
    const users = await (prisma as any).user.findMany({
        select: { id: true, username: true, displayName: true },
        orderBy: { username: 'asc' },
    });
    res.json({ users });
});

// Delete user by id - accessible by admin or user-manager
router.delete('/users/:id', adminOrUserManagerOnly, async (req, res) => {
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

// Update user display name - accessible by admin or user-manager
router.patch('/users/:id', adminOrUserManagerOnly, async (req, res) => {
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
            select: { id: true, username: true, displayName: true },
        });
        res.json({ user });
    } catch {
        res.status(400).json({ error: 'Failed to update user' });
    }
});

// Username whitelist management (DB-backed)
const whitelistCreateSchema = z.object({
    value: z.string().trim().min(1).max(100),
});

// List whitelist rules - accessible by admin or user-manager
router.get('/whitelist', adminOrUserManagerOnly, async (_req, res) => {
    const rules = await (prisma as any).whitelistRule.findMany({
        orderBy: [{ value: 'asc' }],
        select: { id: true, value: true, createdAt: true },
    });
    res.json({ rules });
});

// Add a whitelist rule (idempotent) - accessible by admin or user-manager
router.post('/whitelist', adminOrUserManagerOnly, async (req, res) => {
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

// Delete a whitelist rule - accessible by admin or user-manager
router.delete('/whitelist/:id', adminOrUserManagerOnly, async (req, res) => {
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

// Access request management - accessible by admin or user-manager

// List all pending access requests
router.get('/access-requests', adminOrUserManagerOnly, async (_req, res) => {
    const requests = await (prisma as any).accessRequest.findMany({
        orderBy: [{ createdAt: 'desc' }],
        select: { id: true, username: true, message: true, createdAt: true },
    });
    res.json({ requests });
});

// Accept an access request (add to whitelist and delete request)
router.post(
    '/access-requests/:id/accept',
    adminOrUserManagerOnly,
    async (req, res) => {
        const id = req.params.id;
        if (!id) return res.status(400).json({ error: 'Missing id' });

        try {
            // Find the access request
            const request = await (prisma as any).accessRequest.findUnique({
                where: { id },
                select: { id: true, username: true },
            });

            if (!request) {
                return res
                    .status(404)
                    .json({ error: 'Access request not found' });
            }

            // Check if already whitelisted
            const existingRule = await (prisma as any).whitelistRule.findFirst({
                where: { value: request.username },
            });

            if (existingRule) {
                // Delete the request since user is already whitelisted
                await (prisma as any).accessRequest.deleteMany({
                    where: { id },
                });
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
    },
);

// Decline an access request (delete request)
router.delete(
    '/access-requests/:id',
    adminOrUserManagerOnly,
    async (req, res) => {
        const id = req.params.id;
        if (!id) return res.status(400).json({ error: 'Missing id' });

        try {
            const result = await (prisma as any).accessRequest.deleteMany({
                where: { id },
            });
            if (result.count === 0) {
                return res
                    .status(404)
                    .json({ error: 'Access request not found' });
            }
            res.json({ success: true });
        } catch {
            res.status(400).json({ error: 'Failed to decline access request' });
        }
    },
);

export default router;
