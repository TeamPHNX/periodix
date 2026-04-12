import express from 'express';
import { authMiddleware } from '../server/authMiddleware.js';
import { prisma } from '../store/prisma.js';
import { decryptSecret } from '../server/crypto.js';
import { UNTIS_DEFAULT_SCHOOL } from '../server/config.js';
import { SduiClient } from '@teamphnx/sduiapi';

const router = express.Router();

router.get('/chats', authMiddleware, async (req, res) => {
    try {
        if (!req.user?.id)
            return res.status(401).json({ error: 'Unauthorized' });

        const user = await prisma.user.findUnique({
            where: { id: req.user.id },
        });
        if (!user?.sduiAccessToken || !user?.sduiUserId) {
            return res.status(401).json({ error: 'SDUI not authenticated' });
        }

        const sdui = SduiClient.fromAccessToken(user.sduiAccessToken);
        const PAGE_SIZE = 50;
        const MAX_PAGES = 20;

        const chats: any[] = [];
        const seenIds = new Set<string>();

        for (let page = 1; page <= MAX_PAGES; page += 1) {
            const chatResponse = await sdui.getUserChats<any>(user.sduiUserId, {
                page,
                limit: PAGE_SIZE,
            });

            const pageItems = Array.isArray(chatResponse)
                ? chatResponse
                : Array.isArray(chatResponse?.data)
                  ? chatResponse.data
                  : [];

            if (pageItems.length === 0) {
                break;
            }

            for (const chat of pageItems) {
                const chatId = String(
                    chat?.chat?.id ?? chat?.chat_id ?? chat?.id ?? '',
                );
                if (!chatId) {
                    chats.push(chat);
                    continue;
                }

                if (!seenIds.has(chatId)) {
                    seenIds.add(chatId);
                    chats.push(chat);
                }
            }

            if (pageItems.length < PAGE_SIZE) {
                break;
            }
        }

        res.json(chats);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Failed to fetch SDUI chats' });
    }
});

router.post('/auth', authMiddleware, async (req, res) => {
    try {
        if (!req.user?.id)
            return res.status(401).json({ error: 'Unauthorized' });

        const user = await prisma.user.findUnique({
            where: { id: req.user.id },
        });
        if (!user || !user.untisSecretCiphertext || !user.untisSecretNonce) {
            return res
                .status(400)
                .json({ error: 'No stored WebUntis credentials found' });
        }

        const password = decryptSecret({
            ciphertext: Buffer.from(user.untisSecretCiphertext),
            nonce: Buffer.from(user.untisSecretNonce),
            keyVersion: user.untisSecretKeyVersion ?? 1,
        });

        // Force explicit fallback configuration to prevent SSRF vulnerabilities and spoofing
        const schoolSlink =
            process.env.SDUI_DEFAULT_SCHOOL || UNTIS_DEFAULT_SCHOOL;

        const client = await SduiClient.authenticateWithWebUntis({
            username: user.username,
            password,
            schoolSlink,
        });
        const me = await client.getCurrentUser<any>();
        // Fallback or reflection hack if access token isn't public API - maybe `client.accessToken`
        const token =
            (client as any).accessToken || (client as any).token || 'unknown';

        let sduiUserId = null;
        if (me && me.data && me.data.id) {
            sduiUserId = String(me.data.id);
        } else if (me && me.id) {
            sduiUserId = String(me.id);
        }

        await prisma.user.update({
            where: { id: req.user.id },
            data: {
                sduiAccessToken: token,
                sduiUserId: sduiUserId,
                sduiSchoolLink: schoolSlink,
            },
        });

        res.json({
            success: true,
            sduiAccessToken: token,
            sduiUserId: sduiUserId,
        });
    } catch (e: any) {
        console.error('SDUI Auth err:', e);
        // Do not return the entire 'e' object as JSON to the client to avoid leaking upstream response configurations
        res.status(401).json({
            error: e?.message || 'SDUI Authentication failed',
        });
    }
});

router.get('/chats/:chatId/messages', authMiddleware, async (req, res) => {
    try {
        if (!req.user?.id)
            return res.status(401).json({ error: 'Unauthorized' });
        const chatId = req.params.chatId;
        if (!chatId) return res.status(400).json({ error: 'Missing chatId' });
        const page = Number.parseInt(String(req.query.page ?? '1'), 10);

        const user = await prisma.user.findUnique({
            where: { id: req.user.id },
        });
        if (!user?.sduiAccessToken)
            return res.status(401).json({ error: 'SDUI not authenticated' });

        const sdui = SduiClient.fromAccessToken(user.sduiAccessToken);
        const messages = await sdui.getChatMessages(chatId, {
            page: Number.isNaN(page) ? 1 : Math.max(1, page),
        });

        let msgs = messages;
        if ((messages as any)?.data) {
            msgs = (messages as any).data;
        }

        res.json(msgs);
    } catch (e: any) {
        console.error('Fetch messages err:', e);
        res.status(500).json({
            error: e?.message || 'Failed to fetch messages',
        });
    }
});

router.get('/chats/:chatId', authMiddleware, async (req, res) => {
    try {
        if (!req.user?.id)
            return res.status(401).json({ error: 'Unauthorized' });

        const chatId = req.params.chatId;
        if (!chatId) return res.status(400).json({ error: 'Missing chatId' });

        const user = await prisma.user.findUnique({
            where: { id: req.user.id },
        });
        if (!user?.sduiAccessToken)
            return res.status(401).json({ error: 'SDUI not authenticated' });

        const sdui = SduiClient.fromAccessToken(user.sduiAccessToken);
        const chatResponse = await sdui.request<any>({
            method: 'GET',
            url: `/v1/channels/chats/${encodeURIComponent(chatId)}`,
        });

        let chat = chatResponse;
        if (chatResponse && chatResponse.data) {
            chat = chatResponse.data;
        }

        res.json(chat);
    } catch (e: any) {
        console.error('Fetch chat detail err:', e);
        res.status(500).json({
            error: e?.message || 'Failed to fetch chat detail',
        });
    }
});

router.get('/news', authMiddleware, async (req, res) => {
    try {
        if (!req.user?.id)
            return res.status(401).json({ error: 'Unauthorized' });

        const user = await prisma.user.findUnique({
            where: { id: req.user.id },
        });
        if (!user?.sduiAccessToken || !user?.sduiUserId)
            return res.status(401).json({ error: 'SDUI not authenticated' });

        const page = Number.parseInt(String(req.query.page ?? '1'), 10);
        const sdui = SduiClient.fromAccessToken(user.sduiAccessToken);
        const newsResponse = await sdui.getUserNews<any>(user.sduiUserId, {
            page: Number.isNaN(page) ? 1 : Math.max(1, page),
        });

        let news = newsResponse;
        if (newsResponse && newsResponse.data) {
            news = newsResponse.data;
        }

        res.json(news);
    } catch (e: any) {
        console.error('Fetch news err:', e);
        res.status(500).json({ error: e?.message || 'Failed to fetch news' });
    }
});

router.post('/chats/:chatId/messages', authMiddleware, async (req, res) => {
    try {
        if (!req.user?.id)
            return res.status(401).json({ error: 'Unauthorized' });
        const chatId = req.params.chatId;
        if (!chatId) return res.status(400).json({ error: 'Missing chatId' });

        const user = await prisma.user.findUnique({
            where: { id: req.user.id },
        });
        if (!user?.sduiAccessToken)
            return res.status(401).json({ error: 'SDUI not authenticated' });

        const text =
            typeof req.body?.text === 'string' ? req.body.text.trim() : '';
        if (!text)
            return res.status(400).json({ error: 'Missing text content' });

        const sdui = SduiClient.fromAccessToken(user.sduiAccessToken);
        // SDUI API payload for sending messages
        const result = await sdui.sendChatMessage(chatId, { content: text });

        res.json(result);
    } catch (e: any) {
        console.error('Send message err:', e);
        res.status(500).json({ error: e?.message || 'Failed to send message' });
    }
});

export default router;
