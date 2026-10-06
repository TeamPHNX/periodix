import { Router, type Response } from 'express';
import { z } from 'zod';
import { adminOrUserManagerOnly } from '../server/authMiddleware.js';
import {
    getFreeRooms,
    getResourceIndex,
    getResourceRefreshStatus,
    getResourceTimetable,
    refreshResources,
} from '../services/resourceService.js';

// Teacher / room overview aggregated from all class timetables.
// Only user managers and the admin can see this.
const router = Router();
router.use(adminOrUserManagerOnly);

const dateString = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

const weekSchema = z.object({ week: dateString.optional() });

const timetableSchema = z.object({
    type: z.enum(['teacher', 'room']),
    id: z.coerce.number().int().positive(),
    week: dateString.optional(),
});

const freeRoomsSchema = z.object({ date: dateString });

function sendError(res: Response, route: string, e: any) {
    const status = e?.status || 500;
    console.error(`[resources/${route}] error`, {
        status,
        message: e?.message,
        code: e?.code,
    });
    res.status(status).json({ error: e?.message || 'Failed', code: e?.code });
}

router.get('/index', async (req, res) => {
    const parsed = weekSchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    try {
        res.json(await getResourceIndex(parsed.data.week));
    } catch (e) {
        sendError(res, 'index', e);
    }
});

router.get('/timetable', async (req, res) => {
    const parsed = timetableSchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    try {
        res.json(await getResourceTimetable(parsed.data));
    } catch (e) {
        sendError(res, 'timetable', e);
    }
});

router.get('/free-rooms', async (req, res) => {
    const parsed = freeRoomsSchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    try {
        res.json(await getFreeRooms(parsed.data.date));
    } catch (e) {
        sendError(res, 'free-rooms', e);
    }
});

router.post('/refresh', async (req, res) => {
    const parsed = weekSchema.safeParse(req.body ?? {});
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    try {
        res.status(202).json({ job: refreshResources(parsed.data.week) });
    } catch (e) {
        sendError(res, 'refresh', e);
    }
});

router.get('/refresh/status', (req, res) => {
    const parsed = weekSchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    try {
        res.json({ job: getResourceRefreshStatus(parsed.data.week) });
    } catch (e) {
        sendError(res, 'refresh/status', e);
    }
});

export default router;
