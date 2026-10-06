import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { prisma } from '../store/prisma.js';
import { WHITELIST_ENABLED } from '../server/config.js';
import { notificationService } from '../services/notificationService.js';

const router = Router();

const GENERIC_ACCESS_REQUEST_RESPONSE = {
    success: true,
    message:
        'If this account is eligible, an access request has been submitted.',
};

// Rate limit for access requests to prevent spam
const accessRequestLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    limit: 5, // limit each IP to 5 requests per window
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: {
        error: 'Too many access requests. Please try again later.',
    },
});

const createAccessRequestSchema = z.object({
    username: z.string().trim().min(1).max(100),
    message: z.string().trim().max(500).optional(),
});

// Create an access request
router.post('/', accessRequestLimiter, async (req, res) => {
    // Only allow access requests when whitelist is enabled
    if (!WHITELIST_ENABLED) {
        return res
            .status(400)
            .json({ error: 'Access requests are not available' });
    }

    const parsed = createAccessRequestSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.flatten() });
    }

    const { username, message } = parsed.data;
    const normalizedUsername = username.toLowerCase();

    try {
        // Check if user is already whitelisted
        const existingRule = await (prisma as any).whitelistRule.findFirst({
            where: { value: normalizedUsername },
        });

        if (existingRule) {
            return res.json(GENERIC_ACCESS_REQUEST_RESPONSE);
        }

        // Check if request already exists
        const existingRequest = await (prisma as any).accessRequest.findFirst({
            where: { username: normalizedUsername },
        });

        if (existingRequest) {
            return res.json(GENERIC_ACCESS_REQUEST_RESPONSE);
        }

        // Create the access request
        const request = await (prisma as any).accessRequest.create({
            data: {
                username: normalizedUsername,
                message: message || null,
            },
            select: {
                id: true,
                username: true,
                message: true,
                createdAt: true,
            },
        });

        // Notify user managers about the new access request
        await notificationService.notifyAccessRequest(
            normalizedUsername,
            message,
        );

        res.json({ ...GENERIC_ACCESS_REQUEST_RESPONSE, request });
    } catch {
        res.status(500).json({ error: 'Failed to create access request' });
    }
});

export default router;
