import { Router } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import {
    createUserIfNotExists,
    findUserByCredentials,
} from '../services/userService.js';
import {
    ADMIN_USERNAME,
    ADMIN_PASSWORD,
    WHITELIST_ENABLED,
} from '../server/config.js';
import { verifyUntisCredentials } from '../services/untisService.js';
import { signToken, authMiddleware } from '../server/authMiddleware.js';
import { untisUserLimiter } from '../server/untisRateLimiter.js';
import { prisma } from '../store/prisma.js';
import {
    clearLoginFailures,
    loginRetryAfterSeconds,
    recordLoginFailure,
} from '../server/loginThrottle.js';
import {
    trackActivity,
    type TrackingData,
} from '../services/analytics/index.js';

const router = Router();

// Constant-time comparison so response timing doesn't leak the admin password
function safeEqual(a: string, b: string): boolean {
    const ha = crypto.createHash('sha256').update(a).digest();
    const hb = crypto.createHash('sha256').update(b).digest();
    return crypto.timingSafeEqual(ha, hb);
}

const loginSchema = z.object({
    username: z.string().min(1),
    password: z.string().min(1),
});

router.post('/login', untisUserLimiter, async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.flatten() });
    }
    const ip = req.ip;
    const retryAfter = loginRetryAfterSeconds(parsed.data.username, ip);
    if (retryAfter > 0) {
        res.setHeader('Retry-After', String(retryAfter));
        return res.status(429).json({
            error: 'Too many failed login attempts. Please try again later.',
            retryAfter,
        });
    }

    // Admin login via env credentials
    if (
        ADMIN_USERNAME &&
        ADMIN_PASSWORD &&
        parsed.data.username === ADMIN_USERNAME
    ) {
        if (!safeEqual(parsed.data.password, ADMIN_PASSWORD)) {
            recordLoginFailure(parsed.data.username, ip);
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        clearLoginFailures(parsed.data.username);
        const token = signToken({ userId: 'admin', isAdmin: true });

        // Track admin login activity
        const trackingData: TrackingData = {
            userId: 'admin',
            action: 'login',
        };

        const ipAddr = req.ip || req.connection.remoteAddress;
        if (ipAddr) trackingData.ipAddress = ipAddr;

        const userAgent = req.get('User-Agent');
        if (userAgent) trackingData.userAgent = userAgent;

        trackActivity(trackingData).catch(console.error);

        return res.json({
            token,
            user: {
                id: 'admin',
                username: ADMIN_USERNAME,
                displayName: 'Administrator',
                isAdmin: true,
                timezone: 'Europe/Berlin', // Default timezone for admin
            },
        });
    }

    // Try to find existing user first
    const existingUser = await findUserByCredentials({ ...parsed.data });
    if (existingUser) {
        clearLoginFailures(parsed.data.username);
        const token = signToken({ userId: existingUser.id });

        // Track login activity for existing user
        const trackingData: TrackingData = {
            userId: existingUser.id,
            action: 'login',
        };

        const ipAddr = req.ip || req.connection.remoteAddress;
        if (ipAddr) trackingData.ipAddress = ipAddr;

        const userAgent = req.get('User-Agent');
        if (userAgent) trackingData.userAgent = userAgent;

        trackActivity(trackingData).catch(console.error);

        return res.json({
            token,
            user: {
                id: existingUser.id,
                username: existingUser.username,
                displayName: existingUser.displayName,
                isAdmin: false,
                isUserManager: existingUser.isUserManager || false,
                timezone: existingUser.timezone,
            },
        });
    }

    // User not found in database - verify with Untis and auto-register
    try {
        await verifyUntisCredentials(
            parsed.data.username,
            parsed.data.password
        );
    } catch (e: any) {
        const status = e?.status || 401;
        // Only wrong credentials count; Untis outages must not lock people out
        if (status === 401) recordLoginFailure(parsed.data.username, ip);
        return res.status(status).json({
            error: e?.message || 'Invalid credentials',
            code: e?.code,
        });
    }

    // Check whitelist (DB-backed) if enabled — username-only
    if (WHITELIST_ENABLED) {
        const username = parsed.data.username.toLowerCase();

        // Check direct username rule
        const usernameRule = await (prisma as any).whitelistRule.findFirst({
            where: { value: username },
            select: { id: true },
        });

        const isWhitelisted = Boolean(usernameRule);
        if (!isWhitelisted) {
            // Before telling the user they're not authorized, check if an access request already exists
            try {
                const existingAccessRequest = await (
                    prisma as any
                ).accessRequest.findFirst({
                    where: { username },
                    select: { id: true, createdAt: true },
                });
                if (existingAccessRequest) {
                    return res.status(403).json({
                        error: 'Your access request is already pending approval.',
                        code: 'ACCESS_REQUEST_PENDING',
                        requestedAt: existingAccessRequest.createdAt,
                    });
                }
            } catch (e) {
                // Non-fatal; fall through to generic not-whitelisted error
            }
            return res.status(403).json({
                error: 'Access denied. Your account is not authorized for this beta.',
                code: 'NOT_WHITELISTED',
            });
        }
    }

    // Create user with Untis credentials
    clearLoginFailures(parsed.data.username);
    const user = await createUserIfNotExists({ ...parsed.data });
    const token = signToken({ userId: user.id });

    // Track login activity for newly created user
    const trackingData: TrackingData = {
        userId: user.id,
        action: 'login',
    };

    const ipAddr = req.ip || req.connection.remoteAddress;
    if (ipAddr) trackingData.ipAddress = ipAddr;

    const userAgent = req.get('User-Agent');
    if (userAgent) trackingData.userAgent = userAgent;

    trackActivity(trackingData).catch(console.error);

    res.json({
        token,
        user: {
            id: user.id,
            username: user.username,
            displayName: user.displayName,
            isAdmin: false,
            isUserManager: user.isUserManager || false,
            timezone: user.timezone,
        },
    });
});

router.get('/me', authMiddleware, async (req, res) => {
    res.json({ userId: req.user!.id });
});

export default router;
