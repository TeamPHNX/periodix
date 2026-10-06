import express from 'express';
import type { Response } from 'express';
import { SduiClient } from '@teamphnx/sduiapi';
import { authMiddleware } from '../server/authMiddleware.js';
import { decryptSecret } from '../server/crypto.js';
import { UNTIS_DEFAULT_SCHOOL } from '../server/config.js';
import { prisma } from '../store/prisma.js';

const router = express.Router();

function normalizeSchoolSlink(input: string): string {
    return input
        .trim()
        .replace(/^['"]|['"]$/g, '')
        .toLowerCase();
}

function getSinglePathParam(
    param: string | string[] | undefined,
): string | undefined {
    return Array.isArray(param) ? param[0] : param;
}

const SDUI_USER_SELECT = {
    id: true,
    username: true,
    untisSecretCiphertext: true,
    untisSecretNonce: true,
    untisSecretKeyVersion: true,
    sduiAccessToken: true,
    sduiUserId: true,
    sduiSchoolLink: true,
} as const;

type SduiUserRecord = {
    id: string;
    username: string;
    untisSecretCiphertext: Uint8Array | null;
    untisSecretNonce: Uint8Array | null;
    untisSecretKeyVersion: number | null;
    sduiAccessToken: string | null;
    sduiUserId: string | null;
    sduiSchoolLink: string | null;
};

class SduiRouteError extends Error {
    statusCode: number;

    constructor(statusCode: number, message: string) {
        super(message);
        this.statusCode = statusCode;
    }
}

type SduiClientContext = {
    client: SduiClient;
    sduiUserId: string | null;
};

type SduiClientOptions = {
    requireUserId?: boolean;
};

function getErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message) {
        return error.message;
    }
    return String(error);
}

function getErrorCode(error: unknown): string | undefined {
    if (typeof error !== 'object' || error === null) {
        return undefined;
    }

    const maybeCode = (error as { code?: unknown }).code;
    return typeof maybeCode === 'string' ? maybeCode : undefined;
}

function getErrorStatus(error: unknown): number | undefined {
    if (typeof error !== 'object' || error === null) {
        return undefined;
    }

    const directStatus = (error as { status?: unknown }).status;
    if (typeof directStatus === 'number') {
        return directStatus;
    }

    const responseStatus = (
        error as {
            response?: {
                status?: unknown;
            };
        }
    ).response?.status;

    return typeof responseStatus === 'number' ? responseStatus : undefined;
}

function isUnauthorizedSduiError(error: unknown): boolean {
    return getErrorStatus(error) === 401;
}

function extractSduiUserId(me: any): string | null {
    if (me && me.data && me.data.id) {
        return String(me.data.id);
    }
    if (me && me.id) {
        return String(me.id);
    }
    return null;
}

function extractSduiAccessToken(client: SduiClient): string {
    const token = (client as any).accessToken ?? (client as any).token;
    if (typeof token !== 'string' || token.trim().length === 0) {
        throw new SduiRouteError(
            500,
            'SDUI authentication succeeded but no access token was returned',
        );
    }
    return token;
}

function getConfiguredSchoolSlink(
    user: Pick<SduiUserRecord, 'sduiSchoolLink'>,
): string {
    const schoolSlink = normalizeSchoolSlink(
        process.env.SDUI_DEFAULT_SCHOOL ||
            user.sduiSchoolLink ||
            UNTIS_DEFAULT_SCHOOL ||
            '',
    );

    if (!schoolSlink) {
        throw new SduiRouteError(
            500,
            'No SDUI school slink configured on server.',
        );
    }

    return schoolSlink;
}

async function getSduiUserById(userId: string): Promise<SduiUserRecord | null> {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: SDUI_USER_SELECT,
    });

    if (!user) {
        return null;
    }

    return {
        id: user.id,
        username: user.username,
        untisSecretCiphertext: user.untisSecretCiphertext,
        untisSecretNonce: user.untisSecretNonce,
        untisSecretKeyVersion: user.untisSecretKeyVersion,
        sduiAccessToken: user.sduiAccessToken,
        sduiUserId: user.sduiUserId,
        sduiSchoolLink: user.sduiSchoolLink,
    };
}

async function authenticateSduiForUser(user: SduiUserRecord): Promise<{
    client: SduiClient;
    token: string;
    sduiUserId: string | null;
}> {
    if (!user.untisSecretCiphertext || !user.untisSecretNonce) {
        throw new SduiRouteError(400, 'No stored WebUntis credentials found');
    }

    const schoolSlink = getConfiguredSchoolSlink(user);
    const password = decryptSecret({
        ciphertext: Buffer.from(user.untisSecretCiphertext),
        nonce: Buffer.from(user.untisSecretNonce),
        keyVersion: user.untisSecretKeyVersion ?? 1,
    });

    let client: SduiClient;
    try {
        client = await SduiClient.authenticateWithWebUntis({
            username: user.username,
            password,
            schoolSlink,
        });
    } catch (error) {
        const msg = getErrorMessage(error);
        const hasSchoolResolveError = msg
            .toLowerCase()
            .includes('unable to resolve identity provider url for school');

        if (hasSchoolResolveError) {
            throw new SduiRouteError(
                401,
                'Unable to resolve identity provider URL for school. Please configure SDUI_DEFAULT_SCHOOL with the correct SDUI school link.',
            );
        }

        throw new SduiRouteError(401, 'SDUI Authentication failed');
    }

    const me = await client.getCurrentUser<any>();
    const sduiUserId = extractSduiUserId(me);
    const token = extractSduiAccessToken(client);

    await prisma.user.update({
        where: { id: user.id },
        data: {
            sduiAccessToken: token,
            sduiUserId,
            sduiSchoolLink: schoolSlink,
        } as any,
    });

    return {
        client,
        token,
        sduiUserId,
    };
}

async function withSduiClient<T>(
    userId: string,
    operation: (ctx: SduiClientContext) => Promise<T>,
    options: SduiClientOptions = {},
): Promise<T> {
    const user = await getSduiUserById(userId);
    if (!user) {
        throw new SduiRouteError(401, 'Unauthorized');
    }

    if (!user.sduiAccessToken) {
        throw new SduiRouteError(401, 'SDUI not authenticated');
    }

    if (options.requireUserId && !user.sduiUserId) {
        throw new SduiRouteError(401, 'SDUI not authenticated');
    }

    const execute = (token: string, sduiUserId: string | null) =>
        operation({
            client: SduiClient.fromAccessToken(token),
            sduiUserId,
        });

    try {
        return await execute(user.sduiAccessToken, user.sduiUserId);
    } catch (error) {
        if (!isUnauthorizedSduiError(error)) {
            throw error;
        }

        const refreshed = await authenticateSduiForUser(user);
        if (options.requireUserId && !refreshed.sduiUserId) {
            throw new SduiRouteError(401, 'SDUI not authenticated');
        }

        return execute(refreshed.token, refreshed.sduiUserId);
    }
}

function logSduiError(context: string, error: unknown): void {
    const status = getErrorStatus(error);
    const code = getErrorCode(error);
    const message = getErrorMessage(error);

    console.error(`[sdui] ${context}`, {
        status,
        code,
        message,
    });
}

function respondWithSduiError(
    res: Response,
    error: unknown,
    fallbackMessage: string,
    context: string,
) {
    logSduiError(context, error);

    if (error instanceof SduiRouteError) {
        return res.status(error.statusCode).json({ error: error.message });
    }

    if (isUnauthorizedSduiError(error)) {
        return res.status(401).json({ error: 'SDUI not authenticated' });
    }

    return res.status(500).json({ error: fallbackMessage });
}

router.get('/chats', authMiddleware, async (req, res) => {
    try {
        if (!req.user?.id) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const chats = await withSduiClient(
            req.user.id,
            async ({ client, sduiUserId }) => {
                if (!sduiUserId) {
                    throw new SduiRouteError(401, 'SDUI not authenticated');
                }

                const PAGE_SIZE = 50;
                const MAX_PAGES = 20;
                const allChats: any[] = [];
                const seenIds = new Set<string>();

                for (let page = 1; page <= MAX_PAGES; page += 1) {
                    const chatResponse = await client.getUserChats<any>(
                        sduiUserId,
                        {
                            page,
                            limit: PAGE_SIZE,
                        },
                    );

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
                            allChats.push(chat);
                            continue;
                        }

                        if (!seenIds.has(chatId)) {
                            seenIds.add(chatId);
                            allChats.push(chat);
                        }
                    }

                    if (pageItems.length < PAGE_SIZE) {
                        break;
                    }
                }

                return allChats;
            },
            { requireUserId: true },
        );

        return res.json(chats);
    } catch (error) {
        return respondWithSduiError(
            res,
            error,
            'Failed to fetch SDUI chats',
            'fetch chats',
        );
    }
});

router.post('/auth', authMiddleware, async (req, res) => {
    try {
        if (!req.user?.id) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const user = await getSduiUserById(req.user.id);
        if (!user) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const authResult = await authenticateSduiForUser(user);

        return res.json({
            success: true,
            sduiAccessToken: authResult.token,
            sduiUserId: authResult.sduiUserId,
        });
    } catch (error) {
        return respondWithSduiError(
            res,
            error,
            'SDUI Authentication failed',
            'auth',
        );
    }
});

router.get('/chats/:chatId/messages', authMiddleware, async (req, res) => {
    try {
        if (!req.user?.id) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const chatId = getSinglePathParam(req.params.chatId);
        if (!chatId) {
            return res.status(400).json({ error: 'Missing chatId' });
        }

        const page = Number.parseInt(String(req.query.page ?? '1'), 10);
        const messages = await withSduiClient(req.user.id, async ({ client }) =>
            client.getChatMessages(chatId, {
                page: Number.isNaN(page) ? 1 : Math.max(1, page),
            }),
        );

        const body = (messages as any)?.data ?? messages;
        return res.json(body);
    } catch (error) {
        return respondWithSduiError(
            res,
            error,
            'Failed to fetch messages',
            'fetch messages',
        );
    }
});

router.get('/chats/:chatId', authMiddleware, async (req, res) => {
    try {
        if (!req.user?.id) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const chatId = getSinglePathParam(req.params.chatId);
        if (!chatId) {
            return res.status(400).json({ error: 'Missing chatId' });
        }

        const chatResponse = await withSduiClient(
            req.user.id,
            async ({ client }) =>
                client.request<any>({
                    method: 'GET',
                    url: `/v1/channels/chats/${encodeURIComponent(chatId)}`,
                }),
        );

        return res.json(chatResponse?.data ?? chatResponse);
    } catch (error) {
        return respondWithSduiError(
            res,
            error,
            'Failed to fetch chat detail',
            'fetch chat detail',
        );
    }
});

router.get('/news', authMiddleware, async (req, res) => {
    try {
        if (!req.user?.id) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const page = Number.parseInt(String(req.query.page ?? '1'), 10);
        const newsResponse = await withSduiClient(
            req.user.id,
            async ({ client, sduiUserId }) => {
                if (!sduiUserId) {
                    throw new SduiRouteError(401, 'SDUI not authenticated');
                }

                return client.getUserNews<any>(sduiUserId, {
                    page: Number.isNaN(page) ? 1 : Math.max(1, page),
                });
            },
            { requireUserId: true },
        );

        return res.json(newsResponse?.data ?? newsResponse);
    } catch (error) {
        return respondWithSduiError(
            res,
            error,
            'Failed to fetch news',
            'fetch news',
        );
    }
});

router.post('/chats/:chatId/messages', authMiddleware, async (req, res) => {
    try {
        if (!req.user?.id) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const chatId = getSinglePathParam(req.params.chatId);
        if (!chatId) {
            return res.status(400).json({ error: 'Missing chatId' });
        }

        const contentFromBody =
            typeof req.body?.content === 'string'
                ? req.body.content.trim()
                : '';
        const textFromBody =
            typeof req.body?.text === 'string' ? req.body.text.trim() : '';
        const content = contentFromBody || textFromBody;

        if (!content) {
            return res.status(400).json({ error: 'Missing text content' });
        }

        const result = await withSduiClient(req.user.id, async ({ client }) =>
            client.sendChatMessage(chatId, { content }),
        );

        return res.json(result);
    } catch (error) {
        return respondWithSduiError(
            res,
            error,
            'Failed to send message',
            'send message',
        );
    }
});

router.post(
    '/chats/:chatId/messages/:replyUuid/reply',
    authMiddleware,
    async (req, res) => {
        try {
            if (!req.user?.id) {
                return res.status(401).json({ error: 'Unauthorized' });
            }

            const chatId = getSinglePathParam(req.params.chatId);
            const replyUuid = getSinglePathParam(req.params.replyUuid);
            if (!chatId) {
                return res.status(400).json({ error: 'Missing chatId' });
            }
            if (!replyUuid) {
                return res.status(400).json({ error: 'Missing replyUuid' });
            }

            const contentFromBody =
                typeof req.body?.content === 'string'
                    ? req.body.content.trim()
                    : '';
            const textFromBody =
                typeof req.body?.text === 'string' ? req.body.text.trim() : '';
            const content = contentFromBody || textFromBody;

            if (!content) {
                return res.status(400).json({ error: 'Missing text content' });
            }

            const result = await withSduiClient(
                req.user.id,
                async ({ client }) =>
                    (client as any).replyToChatMessage(chatId, replyUuid, {
                        content,
                    }),
            );

            return res.json(result);
        } catch (error) {
            return respondWithSduiError(
                res,
                error,
                'Failed to send reply message',
                'send reply',
            );
        }
    },
);

router.delete(
    '/chats/:chatId/messages/:messageUuid',
    authMiddleware,
    async (req, res) => {
        try {
            if (!req.user?.id) {
                return res.status(401).json({ error: 'Unauthorized' });
            }

            const chatId = getSinglePathParam(req.params.chatId);
            const messageUuid = getSinglePathParam(req.params.messageUuid);
            if (!chatId) {
                return res.status(400).json({ error: 'Missing chatId' });
            }
            if (!messageUuid) {
                return res.status(400).json({ error: 'Missing messageUuid' });
            }

            const result = await withSduiClient(
                req.user.id,
                async ({ client }) =>
                    (client as any).deleteChatMessage(chatId, messageUuid),
            );

            return res.json(result);
        } catch (error) {
            return respondWithSduiError(
                res,
                error,
                'Failed to delete message',
                'delete message',
            );
        }
    },
);

router.get(
    '/chats/:chatId/messages/:messageUuid/readers',
    authMiddleware,
    async (req, res) => {
        try {
            if (!req.user?.id) {
                return res.status(401).json({ error: 'Unauthorized' });
            }

            const chatId = getSinglePathParam(req.params.chatId);
            const messageUuid = getSinglePathParam(req.params.messageUuid);
            if (!chatId) {
                return res.status(400).json({ error: 'Missing chatId' });
            }
            if (!messageUuid) {
                return res.status(400).json({ error: 'Missing messageUuid' });
            }

            const page = Number.parseInt(String(req.query.page ?? '1'), 10);
            const readers = await withSduiClient(
                req.user.id,
                async ({ client }) =>
                    (client as any).getMessageReaders(chatId, messageUuid, {
                        page: Number.isNaN(page) ? 1 : Math.max(1, page),
                    }),
            );

            return res.json((readers as any)?.data ?? readers);
        } catch (error) {
            return respondWithSduiError(
                res,
                error,
                'Failed to fetch message readers',
                'fetch message readers',
            );
        }
    },
);

export default router;
