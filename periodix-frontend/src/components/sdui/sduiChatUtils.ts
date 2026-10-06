/* eslint-disable @typescript-eslint/no-explicit-any */
import {
    getAttachmentDisplayName,
    type SduiAttachment,
} from './sduiAttachmentUtils';
import {
    firstBooleanLike,
    normalizeForPermissionMatch,
} from './sduiChatPermissionUtils';

type SduiChatItem = any;
type SduiMessage = any;
type SduiNews = any;

const ACTION_MESSAGE_MAP: Record<string, string> = {
    'news.posted': 'News wurde in dieser Gruppe geteilt.',
    'users.added': 'Nutzer wurden zur Gruppe hinzugefuegt.',
    'users.removed': 'Nutzer wurden aus der Gruppe entfernt.',
    'users.left': 'Ein Nutzer hat die Gruppe verlassen.',
    'channel.created': 'Gruppe wurde erstellt.',
    'channel.renamed': 'Gruppenname wurde geaendert.',
    'channel.avatar.updated': 'Gruppenbild wurde aktualisiert.',
    'chat.pinned': 'Chat wurde fixiert.',
    'chat.unpinned': 'Chat wurde entpinnt.',
};

const ACTION_KEY_PREFIXES = [
    'news.',
    'users.',
    'channel.',
    'chat.',
    'message.',
    'member.',
    'conversation.',
];

export function normalizeArrayResponse(input: any): any[] {
    if (Array.isArray(input)) return input;
    if (Array.isArray(input?.data)) return input.data;
    return [];
}

export function isActionKey(value: string): boolean {
    const normalized = value.trim();
    if (!normalized) return false;
    if (!/^[a-z_]+(\.[a-z_]+)+$/i.test(normalized)) return false;

    const lowered = normalized.toLowerCase();
    if (
        /\.(png|jpe?g|gif|webp|avif|svg|pdf|docx?|xlsx?|pptx?|txt|zip)$/.test(
            lowered,
        )
    ) {
        return false;
    }

    if (ACTION_MESSAGE_MAP[lowered]) return true;
    return ACTION_KEY_PREFIXES.some((prefix) => lowered.startsWith(prefix));
}

export function stripHtml(input: string): string {
    return input
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>\s*<p>/gi, '\n\n')
        .replace(/<[^>]+>/g, '')
        .trim();
}

export function normalizeMessageText(raw: unknown): string {
    if (typeof raw !== 'string') return '';
    const trimmed = raw.trim();
    if (!trimmed) return '';
    if (trimmed.includes('<') && trimmed.includes('>')) {
        return stripHtml(trimmed);
    }
    return trimmed;
}

export function getChatName(chat: SduiChatItem): string {
    if (chat?.meta?.displayname) return chat.meta.displayname;
    if (chat?.name === 'channels.conversation.name') return 'Privater Chat';
    return chat?.name || 'Unbekannter Chat';
}

export function getChatPreview(chat: SduiChatItem): string {
    const rawPreview =
        typeof chat?.meta?.description === 'string'
            ? chat.meta.description
            : typeof chat?.meta?.last_message === 'string'
              ? chat.meta.last_message
              : typeof chat?.description === 'string'
                ? chat.description
                : '';

    const normalized = rawPreview.replace(/\s+/g, ' ').trim();
    if (!normalized) return 'Keine neuen Nachrichten';
    if (normalized.length > 180) {
        return `${normalized.slice(0, 177)}...`;
    }

    return normalized;
}

export function getChatTimestamp(chat: SduiChatItem): string {
    const raw = chat?.activity_at || chat?.updated_at;
    if (!raw) return '';
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString('de-DE');
}

export function getMessageChatId(chat: SduiChatItem): string {
    return String(chat?.chat?.id ?? chat?.chat_id ?? chat?.id ?? '');
}

export function getMessageUuid(message: SduiMessage): string {
    return String(message?.uuid ?? message?.id ?? '').trim();
}

export function hasNonEmptyDateValue(value: unknown): boolean {
    if (typeof value === 'string') return value.trim().length > 0;
    return Boolean(value);
}

export function isDeletedMessage(message: SduiMessage): boolean {
    return (
        hasNonEmptyDateValue(message?.unset_at) ||
        hasNonEmptyDateValue(message?.deleted_at)
    );
}

export function getMessageDeletePermission(
    message: SduiMessage,
    fallbackWritePermission: boolean,
): boolean {
    const explicit = firstBooleanLike([
        message?.can?.delete,
        message?.can?.['delete'],
        message?.can?.remove,
        message?.can?.['remove'],
    ]);

    if (explicit !== null) return explicit;
    return fallbackWritePermission;
}

export function getMessageInfoPermission(message: SduiMessage): boolean {
    const explicit = firstBooleanLike([
        message?.can?.['view-readers-list'],
        message?.can?.view_readers_list,
        message?.can?.viewReadersList,
        message?.can?.['view_readers_list'],
        message?.can?.readers,
        message?.can?.['readers'],
    ]);

    if (explicit !== null) return explicit;
    return true;
}

export function getMessageKey(message: SduiMessage): string {
    return String(
        message?.uuid ??
            message?.id ??
            `${message?.created_at || message?.updated_at || ''}-${message?.user_id || ''}-${message?.content || ''}`,
    );
}

export function getMessageTimestamp(message: SduiMessage): number {
    const raw = message?.created_at || message?.updated_at;
    if (!raw) return 0;
    const time = new Date(raw).getTime();
    return Number.isNaN(time) ? 0 : time;
}

export function mergeUniqueMessages(
    existing: SduiMessage[],
    incoming: SduiMessage[],
): SduiMessage[] {
    const merged = [...existing, ...incoming];
    const map = new Map<string, SduiMessage>();
    for (const message of merged) {
        map.set(getMessageKey(message), message);
    }
    return Array.from(map.values()).sort(
        (a, b) => getMessageTimestamp(a) - getMessageTimestamp(b),
    );
}

export function isInfoMessage(message: SduiMessage): boolean {
    const content = typeof message?.content === 'string' ? message.content : '';
    return message?.type === 'HINT' || isActionKey(content);
}

export function extractNewsId(message: SduiMessage): string {
    return String(
        message?.target?.id ??
            message?.payload?.news_id ??
            message?.payload?.news?.id ??
            message?.preview?.id ??
            '',
    );
}

export function indexNewsList(newsItems: SduiNews[]): Record<string, SduiNews> {
    const index: Record<string, SduiNews> = {};
    for (const item of newsItems) {
        const id = String(item?.id ?? item?.news_id ?? item?.uuid ?? '');
        if (id) index[id] = item;
    }
    return index;
}

export function getLinkedNews(
    message: SduiMessage,
    newsById: Record<string, SduiNews>,
): SduiNews | null {
    const actionKey =
        typeof message?.content === 'string' ? message.content.trim() : '';
    if (actionKey !== 'news.posted') return null;

    const fromIndex = newsById[extractNewsId(message)];
    if (fromIndex) return fromIndex;

    return (
        message?.payload?.news ||
        message?.preview ||
        message?.target_snapshot ||
        null
    );
}

export function getNewsTitle(news: SduiNews | null): string {
    if (!news) return '';
    return (
        normalizeMessageText(news?.title) ||
        normalizeMessageText(news?.name) ||
        normalizeMessageText(news?.meta?.displayname) ||
        ''
    );
}

export function getNewsBody(news: SduiNews | null): string {
    if (!news) return '';
    return (
        normalizeMessageText(news?.content_rendered) ||
        normalizeMessageText(news?.content) ||
        normalizeMessageText(news?.text) ||
        normalizeMessageText(news?.description) ||
        normalizeMessageText(news?.meta?.description) ||
        normalizeMessageText(news?.preview) ||
        ''
    );
}

export function getNewsItemId(news: SduiNews, index = 0): string {
    return String(
        news?.id ?? news?.news_id ?? news?.uuid ?? news?.meta?.id ?? index,
    );
}

export function getNewsTimestamp(news: SduiNews): number {
    const raw =
        news?.published_at ||
        news?.created_at ||
        news?.updated_at ||
        news?.date ||
        news?.meta?.published_at;

    if (!raw) return 0;
    const timestamp = new Date(raw).getTime();
    return Number.isNaN(timestamp) ? 0 : timestamp;
}

export function getNewsDateTime(news: SduiNews): string {
    const timestamp = getNewsTimestamp(news);
    if (!timestamp) return '';
    return new Date(timestamp).toLocaleString('de-DE', {
        day: '2-digit',
        month: '2-digit',
        year: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    });
}

export function getNewsAuthor(news: SduiNews): string {
    return (
        news?.author?.displayname ||
        news?.author?.name ||
        news?.user?.meta?.displayname ||
        news?.user?.name ||
        news?.meta?.author ||
        'Unbekannt'
    );
}

export function getNewsAudience(news: SduiNews): string {
    return (
        news?.channel?.name ||
        news?.chat?.name ||
        news?.group?.name ||
        news?.audience?.name ||
        news?.meta?.scope ||
        'Alle'
    );
}

export function normalizeTextForComparison(value: string): string {
    return value
        .toLowerCase()
        .replace(/<[^>]+>/g, ' ')
        .replace(/[\u2010-\u2015]/g, '-')
        .replace(/[._-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

export function shouldHideDuplicateAttachmentText(
    messageText: string,
    attachments: SduiAttachment[],
): boolean {
    const normalizedMessage = normalizeTextForComparison(messageText);
    if (!normalizedMessage) return false;
    if (attachments.length === 0) return false;

    const names = attachments
        .map((attachment) => getAttachmentDisplayName(attachment))
        .concat(attachments.map((attachment) => attachment.name))
        .map((value) => normalizeTextForComparison(String(value || '')))
        .filter(Boolean);

    if (names.length === 0) return false;

    const lines = messageText
        .split(/\r?\n+/)
        .map((line) => normalizeTextForComparison(line))
        .filter(Boolean);

    if (lines.length === 0) return false;
    if (lines.length <= 2 && lines.every((line) => names.includes(line))) {
        return true;
    }

    if (lines.length === 1) {
        return names.some((name) => {
            if (normalizedMessage === name) return true;
            if (normalizedMessage === `${name} download`) return true;
            return false;
        });
    }

    return false;
}

export type SduiReplyPreview = {
    uuid: string;
    sender: string;
    text: string;
    time: string;
};

export function isLikelyMessageReferenceId(value: unknown): boolean {
    const normalized = String(value ?? '').trim();
    if (!normalized) return false;

    if (/\s/.test(normalized)) return false;
    if (/[/?&#=]/.test(normalized)) return false;
    if (
        /\.(png|jpe?g|gif|webp|avif|svg|pdf|docx?|xlsx?|pptx?|txt|zip)$/i.test(
            normalized,
        )
    ) {
        return false;
    }

    if (
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            normalized,
        )
    ) {
        return true;
    }

    if (/^[0-9a-f]{16,}$/i.test(normalized)) return true;
    if (/^[0-9]{4,20}$/.test(normalized)) return true;
    if (/^[a-z0-9][a-z0-9_-]{7,}$/i.test(normalized)) return true;

    return false;
}

export function pickFirstReplyReferenceId(candidates: unknown[]): string {
    for (const value of candidates) {
        if (!isLikelyMessageReferenceId(value)) continue;
        return String(value).trim();
    }
    return '';
}

export function extractReplyReferenceUuid(message: SduiMessage): string {
    const candidates: unknown[] = [
        message?.reply_to_uuid,
        message?.reply_uuid,
        message?.replyToUuid,
        message?.in_reply_to,
        message?.inReplyTo,
        message?.thread_parent_uuid,
        message?.meta?.reply_to_uuid,
        message?.meta?.reply_uuid,
        message?.payload?.reply_to_uuid,
        message?.payload?.reply_uuid,
        message?.payload?.reply?.uuid,
        message?.payload?.reply_to?.uuid,
        message?.payload?.reply?.id,
        message?.payload?.reply_to?.id,
        message?.reply?.uuid,
        message?.reply?.id,
        message?.reply_to?.uuid,
        message?.reply_to?.id,
        message?.quote?.uuid,
        message?.quote?.id,
        message?.quoted_message?.uuid,
        message?.quoted_message?.id,
    ];

    const embeddedReferenceNodes = [
        message?.reply,
        message?.reply_to,
        message?.payload?.reply,
        message?.payload?.reply_to,
        message?.meta?.reply,
        message?.meta?.reply_to,
        message?.quote,
        message?.quoted_message,
    ];

    for (const node of embeddedReferenceNodes) {
        if (!node || typeof node !== 'object' || Array.isArray(node)) {
            continue;
        }

        candidates.push(
            node?.message_uuid,
            node?.reply_to_uuid,
            node?.uuid,
            node?.id,
        );
    }

    const references = Array.isArray(message?.references)
        ? message.references
        : [];

    for (const reference of references) {
        if (!reference || typeof reference !== 'object') continue;

        const referenceType = normalizeForPermissionMatch(
            String(
                reference?.type ||
                    reference?.kind ||
                    reference?.resource_type ||
                    '',
            ),
        );

        const looksLikeReplyReference =
            referenceType.includes('reply') ||
            referenceType.includes('quote') ||
            referenceType.includes('thread') ||
            reference?.reply != null ||
            reference?.reply_to != null ||
            reference?.reply_to_uuid != null ||
            reference?.in_reply_to != null ||
            reference?.quote != null;

        if (!looksLikeReplyReference) continue;

        candidates.push(
            reference?.reply_to_uuid,
            reference?.in_reply_to,
            reference?.uuid,
            reference?.id,
            reference?.reply?.uuid,
            reference?.reply?.id,
            reference?.reply_to?.uuid,
            reference?.reply_to?.id,
            reference?.quote?.uuid,
            reference?.quote?.id,
        );
    }

    return pickFirstReplyReferenceId(candidates);
}

export function extractReplyReferenceMessage(
    message: SduiMessage,
): SduiMessage | null {
    const candidates = [
        message?.reply_to_message,
        message?.reply_to,
        message?.reply,
        message?.quoted_message,
        message?.quote,
        message?.payload?.reply,
        message?.payload?.reply_to,
        message?.meta?.reply,
        message?.meta?.reply_to,
        message?.reference?.message,
    ];

    const references = Array.isArray(message?.references)
        ? message.references
        : [];
    for (const reference of references) {
        if (!reference || typeof reference !== 'object') continue;

        const referenceType = normalizeForPermissionMatch(
            String(
                reference?.type ||
                    reference?.kind ||
                    reference?.resource_type ||
                    '',
            ),
        );

        const looksLikeReplyReference =
            referenceType.includes('reply') ||
            referenceType.includes('quote') ||
            referenceType.includes('thread') ||
            reference?.reply != null ||
            reference?.reply_to != null ||
            reference?.reply_to_uuid != null ||
            reference?.in_reply_to != null ||
            reference?.quote != null;

        if (!looksLikeReplyReference) continue;

        candidates.push(
            reference?.message,
            reference?.reply,
            reference?.reply_to,
            reference?.quote,
        );
    }

    for (const candidate of candidates) {
        if (
            !candidate ||
            typeof candidate !== 'object' ||
            Array.isArray(candidate)
        ) {
            continue;
        }

        const hasMessageBody =
            candidate?.content ||
            candidate?.content_rendered ||
            candidate?.text ||
            candidate?.message;

        if (hasMessageBody) {
            return candidate;
        }
    }

    return null;
}

export function getReplyPreviewForMessage(
    message: SduiMessage,
    messageByUuid: Record<string, SduiMessage>,
    newsById: Record<string, SduiNews>,
): SduiReplyPreview | null {
    const directReference = extractReplyReferenceMessage(message);
    const replyUuid = extractReplyReferenceUuid(message);

    const fallbackReference = replyUuid ? messageByUuid[replyUuid] : null;
    const referencedMessage = directReference || fallbackReference || null;

    if (!referencedMessage) {
        return null;
    }

    const ownUuid = getMessageUuid(message);
    const referencedUuid = getMessageUuid(referencedMessage) || replyUuid;
    if (referencedUuid && ownUuid && referencedUuid === ownUuid) {
        return null;
    }

    const linkedNews = getLinkedNews(referencedMessage, newsById);
    return {
        uuid: referencedUuid || '',
        sender: getMessageSender(referencedMessage),
        text: getMessageText(referencedMessage, linkedNews),
        time: getMessageTime(referencedMessage),
    };
}

export function getMessageText(
    message: SduiMessage,
    linkedNews: SduiNews | null,
): string {
    if (isDeletedMessage(message)) {
        return 'Nachricht wurde gelöscht.';
    }

    const formatActionMessage = (actionKey: string): string => {
        if (actionKey === 'news.posted' && linkedNews) {
            const newsBody = getNewsBody(linkedNews);
            if (newsBody) return newsBody;
        }

        if (ACTION_MESSAGE_MAP[actionKey]) {
            return ACTION_MESSAGE_MAP[actionKey];
        }

        return actionKey;
    };

    const rendered = normalizeMessageText(message?.content_rendered);
    if (rendered) {
        if (isActionKey(rendered)) {
            return formatActionMessage(rendered);
        }
        return rendered;
    }

    const actionKey =
        typeof message?.content === 'string' ? message.content.trim() : '';

    if (isActionKey(actionKey)) {
        return formatActionMessage(actionKey);
    }

    const text = normalizeMessageText(
        message?.text ||
            message?.message ||
            message?.content ||
            message?.meta?.description ||
            '',
    );

    return text || 'Nachricht';
}

export function getMessageSender(message: SduiMessage): string {
    const first = message?.user?.firstname || '';
    const last = message?.user?.lastname || '';
    const fullName = `${first} ${last}`.trim();

    return (
        message?.author?.displayname ||
        message?.author?.name ||
        message?.user?.meta?.displayname ||
        fullName ||
        'SDUI Nutzer'
    );
}

export function getMessageTime(message: SduiMessage): string {
    const raw = message?.created_at || message?.updated_at;
    if (!raw) return '';
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleTimeString('de-DE', {
        hour: '2-digit',
        minute: '2-digit',
    });
}

export function getMessageDateTime(message: SduiMessage): string {
    const raw = message?.created_at || message?.updated_at;
    if (!raw) return 'Unbekannt';

    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return 'Unbekannt';

    return date.toLocaleString('de-DE', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

export function normalizeReaderList(input: any): any[] {
    if (Array.isArray(input)) return input;
    if (Array.isArray(input?.data)) return input.data;
    if (Array.isArray(input?.readers)) return input.readers;
    return [];
}

export function getReaderName(reader: any): string {
    const first = reader?.firstname || reader?.first_name || '';
    const last = reader?.lastname || reader?.last_name || '';
    const fullName = `${first} ${last}`.trim();

    return (
        reader?.displayname ||
        reader?.name ||
        reader?.meta?.displayname ||
        fullName ||
        'Unbekannter Leser'
    );
}

export {
    canWriteToChat,
    hasOneWayRestrictionSignal,
} from './sduiChatPermissionUtils';
