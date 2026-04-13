/* eslint-disable @typescript-eslint/no-explicit-any */
import React, {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import { SduiMessageActionsMenu } from './SduiMessageActionsMenu';
import { SduiDeleteConfirmModal } from './SduiDeleteConfirmModal';
import { SduiMessageInfoModal } from './SduiMessageInfoModal';
import {
    extractImageUrls,
    extractMessageAttachments,
    formatFileSize,
    getAttachmentDisplayName,
    looksLikeAttachmentPathText,
    type SduiAttachment,
} from './sduiAttachmentUtils';
import { renderTextWithLinks } from './sduiLinkText';

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

function normalizeArrayResponse(input: any): any[] {
    if (Array.isArray(input)) return input;
    if (Array.isArray(input?.data)) return input.data;
    return [];
}

function isActionKey(value: string): boolean {
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

function stripHtml(input: string): string {
    return input
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>\s*<p>/gi, '\n\n')
        .replace(/<[^>]+>/g, '')
        .trim();
}

function normalizeMessageText(raw: unknown): string {
    if (typeof raw !== 'string') return '';
    const trimmed = raw.trim();
    if (!trimmed) return '';
    if (trimmed.includes('<') && trimmed.includes('>')) {
        return stripHtml(trimmed);
    }
    return trimmed;
}

function getChatName(chat: SduiChatItem): string {
    if (chat?.meta?.displayname) return chat.meta.displayname;
    if (chat?.name === 'channels.conversation.name') return 'Privater Chat';
    return chat?.name || 'Unbekannter Chat';
}

function getChatPreview(chat: SduiChatItem): string {
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

function getChatTimestamp(chat: SduiChatItem): string {
    const raw = chat?.activity_at || chat?.updated_at;
    if (!raw) return '';
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString('de-DE');
}

function getMessageChatId(chat: SduiChatItem): string {
    return String(chat?.chat?.id ?? chat?.chat_id ?? chat?.id ?? '');
}

function getMessageUuid(message: SduiMessage): string {
    return String(message?.uuid ?? message?.id ?? '').trim();
}

function hasNonEmptyDateValue(value: unknown): boolean {
    if (typeof value === 'string') return value.trim().length > 0;
    return Boolean(value);
}

function isDeletedMessage(message: SduiMessage): boolean {
    return (
        hasNonEmptyDateValue(message?.unset_at) ||
        hasNonEmptyDateValue(message?.deleted_at)
    );
}

function getMessageDeletePermission(
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

function getMessageInfoPermission(message: SduiMessage): boolean {
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

function getMessageKey(message: SduiMessage): string {
    return String(
        message?.uuid ??
            message?.id ??
            `${message?.created_at || message?.updated_at || ''}-${message?.user_id || ''}-${message?.content || ''}`,
    );
}

function getMessageTimestamp(message: SduiMessage): number {
    const raw = message?.created_at || message?.updated_at;
    if (!raw) return 0;
    const time = new Date(raw).getTime();
    return Number.isNaN(time) ? 0 : time;
}

function mergeUniqueMessages(
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

function isInfoMessage(message: SduiMessage): boolean {
    const content = typeof message?.content === 'string' ? message.content : '';
    return message?.type === 'HINT' || isActionKey(content);
}

function extractNewsId(message: SduiMessage): string {
    return String(
        message?.target?.id ??
            message?.payload?.news_id ??
            message?.payload?.news?.id ??
            message?.preview?.id ??
            '',
    );
}

function indexNewsList(newsItems: SduiNews[]): Record<string, SduiNews> {
    const index: Record<string, SduiNews> = {};
    for (const item of newsItems) {
        const id = String(item?.id ?? item?.news_id ?? item?.uuid ?? '');
        if (id) index[id] = item;
    }
    return index;
}

function getLinkedNews(
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

function getNewsTitle(news: SduiNews | null): string {
    if (!news) return '';
    return (
        normalizeMessageText(news?.title) ||
        normalizeMessageText(news?.name) ||
        normalizeMessageText(news?.meta?.displayname) ||
        ''
    );
}

function getNewsBody(news: SduiNews | null): string {
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

function getNewsItemId(news: SduiNews, index = 0): string {
    return String(
        news?.id ?? news?.news_id ?? news?.uuid ?? news?.meta?.id ?? index,
    );
}

function getNewsTimestamp(news: SduiNews): number {
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

function getNewsDateTime(news: SduiNews): string {
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

function getNewsAuthor(news: SduiNews): string {
    return (
        news?.author?.displayname ||
        news?.author?.name ||
        news?.user?.meta?.displayname ||
        news?.user?.name ||
        news?.meta?.author ||
        'Unbekannt'
    );
}

function getNewsAudience(news: SduiNews): string {
    return (
        news?.channel?.name ||
        news?.chat?.name ||
        news?.group?.name ||
        news?.audience?.name ||
        news?.meta?.scope ||
        'Alle'
    );
}

function normalizeTextForComparison(value: string): string {
    return value
        .toLowerCase()
        .replace(/<[^>]+>/g, ' ')
        .replace(/[\u2010-\u2015]/g, '-')
        .replace(/[._-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function shouldHideDuplicateAttachmentText(
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

type SduiReplyPreview = {
    uuid: string;
    sender: string;
    text: string;
    time: string;
};

function isLikelyMessageReferenceId(value: unknown): boolean {
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

function pickFirstReplyReferenceId(candidates: unknown[]): string {
    for (const value of candidates) {
        if (!isLikelyMessageReferenceId(value)) continue;
        return String(value).trim();
    }
    return '';
}

function extractReplyReferenceUuid(message: SduiMessage): string {
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

function extractReplyReferenceMessage(
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

function getReplyPreviewForMessage(
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

function getMessageText(
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

function getMessageSender(message: SduiMessage): string {
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

function getMessageTime(message: SduiMessage): string {
    const raw = message?.created_at || message?.updated_at;
    if (!raw) return '';
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleTimeString('de-DE', {
        hour: '2-digit',
        minute: '2-digit',
    });
}

function getMessageDateTime(message: SduiMessage): string {
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

function normalizeReaderList(input: any): any[] {
    if (Array.isArray(input)) return input;
    if (Array.isArray(input?.data)) return input.data;
    if (Array.isArray(input?.readers)) return input.readers;
    return [];
}

function getReaderName(reader: any): string {
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

function normalizeForPermissionMatch(value: string): string {
    return value
        .toLowerCase()
        .replace(/ä/g, 'ae')
        .replace(/ö/g, 'oe')
        .replace(/ü/g, 'ue')
        .replace(/ß/g, 'ss');
}

function firstBooleanLike(values: unknown[]): boolean | null {
    for (const value of values) {
        if (typeof value === 'boolean') {
            return value;
        }

        if (typeof value === 'number') {
            if (value === 1) return true;
            if (value === 0) return false;
        }

        if (typeof value === 'string') {
            const normalized = normalizeForPermissionMatch(value.trim());
            if (normalized === 'true' || normalized === '1') return true;
            if (normalized === 'false' || normalized === '0') return false;
        }
    }

    return null;
}

function containsOneWayRestrictionText(input: string): boolean {
    const normalized = normalizeForPermissionMatch(input)
        .replace(/["']/g, '')
        .replace(/\s+/g, ' ')
        .trim();

    if (!normalized) return false;

    const hasOneWayTerm =
        normalized.includes('one-way') || normalized.includes('one way');
    const hasAdminWriteRestriction =
        normalized.includes('nur administratoren duerfen schreiben') ||
        normalized.includes('nur gruppen-administratoren duerfen schreiben') ||
        normalized.includes('nur gruppenadministratoren duerfen schreiben');

    return (
        hasAdminWriteRestriction ||
        (hasOneWayTerm &&
            (normalized.includes('duerfen schreiben') ||
                normalized.includes('konversation eroeffnen') ||
                normalized.includes('anklopfen')))
    );
}

function hasOneWayRestrictionSignal(source: unknown, depth = 0): boolean {
    if (source == null || depth > 6) return false;

    if (typeof source === 'string') {
        return containsOneWayRestrictionText(source);
    }

    if (Array.isArray(source)) {
        return source.some((item) =>
            hasOneWayRestrictionSignal(item, depth + 1),
        );
    }

    if (typeof source !== 'object') return false;

    for (const [rawKey, value] of Object.entries(
        source as Record<string, unknown>,
    )) {
        const key = normalizeForPermissionMatch(rawKey);

        if (typeof value === 'boolean') {
            if (
                value === true &&
                (key.includes('one_way') ||
                    key.includes('oneway') ||
                    key.includes('read_only') ||
                    key.includes('readonly') ||
                    key.includes('broadcast') ||
                    key.includes('announcement'))
            ) {
                return true;
            }

            if (
                value === false &&
                (key.includes('can_write') ||
                    key.includes('canwrite') ||
                    key.includes('can_post') ||
                    key.includes('canpost') ||
                    key.includes('writable') ||
                    key.includes('writeable'))
            ) {
                return true;
            }
        }

        if (
            typeof value === 'number' &&
            value === 0 &&
            (key.includes('can_write') ||
                key.includes('canwrite') ||
                key.includes('can_post') ||
                key.includes('canpost') ||
                key.includes('writable') ||
                key.includes('writeable'))
        ) {
            return true;
        }

        if (typeof value === 'string' && containsOneWayRestrictionText(value)) {
            return true;
        }

        if (
            typeof value === 'object' &&
            hasOneWayRestrictionSignal(value, depth + 1)
        ) {
            return true;
        }
    }

    return false;
}

function getPathValue(source: any, path: string): unknown {
    return path.split('.').reduce((value: any, segment: string) => {
        if (value == null) return undefined;
        return value[segment];
    }, source);
}

function getValueMode(values: unknown[]): unknown {
    const counts = new Map<string, { count: number; value: unknown }>();

    for (const value of values) {
        if (
            typeof value !== 'boolean' &&
            typeof value !== 'number' &&
            typeof value !== 'string'
        ) {
            continue;
        }

        const key = `${typeof value}:${String(value)}`;
        const entry = counts.get(key);
        if (entry) {
            entry.count += 1;
        } else {
            counts.set(key, { count: 1, value });
        }
    }

    let mode: unknown = undefined;
    let modeCount = 0;
    for (const entry of counts.values()) {
        if (entry.count > modeCount) {
            mode = entry.value;
            modeCount = entry.count;
        }
    }

    return mode;
}

function isRestrictivePermissionValue(value: unknown): boolean {
    if (value === false) return true;
    if (typeof value === 'number') return value === 0;

    if (typeof value === 'string') {
        const normalized = normalizeForPermissionMatch(value.trim());
        return (
            normalized.includes('read_only') ||
            normalized.includes('readonly') ||
            normalized.includes('receiver') ||
            normalized.includes('announcement') ||
            normalized.includes('broadcast') ||
            normalized.includes('disabled') ||
            normalized.includes('muted') ||
            normalized.includes('cannot_post') ||
            normalized.includes('no_write')
        );
    }

    return false;
}

function getExplicitWritePermission(chat: SduiChatItem | null): boolean | null {
    if (!chat) return null;

    const explicitWritePermission = firstBooleanLike([
        chat?.can_write,
        chat?.canWrite,
        chat?.writable,
        chat?.writeable,
        chat?.permissions?.write,
        chat?.permissions?.can_write,
        chat?.permissions?.canWrite,
        chat?.permissions?.post,
        chat?.permissions?.can_post,
        chat?.permissions?.canPost,
        chat?.meta?.can_write,
        chat?.meta?.canWrite,
        chat?.meta?.writable,
        chat?.meta?.writeable,
        chat?.meta?.permissions?.write,
        chat?.meta?.permissions?.can_write,
        chat?.meta?.permissions?.canWrite,
        chat?.meta?.permissions?.post,
        chat?.meta?.permissions?.can_post,
        chat?.meta?.permissions?.canPost,
        chat?.can?.['post-message'],
        chat?.chat?.can?.['post-message'],
        chat?.meta?.can?.['post-message'],
        chat?.chat?.meta?.can?.['post-message'],
    ]);
    if (explicitWritePermission !== null) {
        return explicitWritePermission;
    }

    const explicitReadonly = firstBooleanLike([
        chat?.read_only,
        chat?.readOnly,
        chat?.readonly,
        chat?.is_readonly,
        chat?.isReadOnly,
        chat?.meta?.read_only,
        chat?.meta?.readOnly,
        chat?.meta?.readonly,
        chat?.meta?.is_readonly,
        chat?.meta?.isReadOnly,
        chat?.one_way,
        chat?.oneWay,
        chat?.oneway,
        chat?.chat?.one_way,
        chat?.chat?.oneWay,
        chat?.chat?.oneway,
        chat?.meta?.one_way,
        chat?.meta?.oneWay,
        chat?.meta?.oneway,
    ]);
    if (explicitReadonly === true) {
        return false;
    }

    const roleHint = normalizeForPermissionMatch(
        String(chat?.member?.role ?? chat?.role ?? chat?.meta?.role ?? ''),
    );
    if (
        roleHint.includes('read_only') ||
        roleHint.includes('readonly') ||
        roleHint.includes('receiver')
    ) {
        return false;
    }

    const typeHint = normalizeForPermissionMatch(
        String(chat?.type ?? chat?.meta?.type ?? ''),
    );
    if (typeHint.includes('announcement') || typeHint.includes('broadcast')) {
        return false;
    }

    return null;
}

function canWriteToChat(
    chat: SduiChatItem | null,
    chats: SduiChatItem[],
    chatDetails: SduiChatItem | null,
    messages: SduiMessage[],
): boolean {
    if (!chat) return false;

    const explicitPermissionFromDetails =
        getExplicitWritePermission(chatDetails);
    if (explicitPermissionFromDetails !== null) {
        return explicitPermissionFromDetails;
    }

    const explicitPermissionFromChat = getExplicitWritePermission(chat);
    if (explicitPermissionFromChat !== null) {
        return explicitPermissionFromChat;
    }

    if (
        hasOneWayRestrictionSignal(chatDetails) ||
        hasOneWayRestrictionSignal(chat) ||
        hasOneWayRestrictionSignal(messages)
    ) {
        return false;
    }

    const referenceChats = chats.filter((item) => item !== chat);
    if (referenceChats.length === 0) {
        return true;
    }

    const comparablePaths = [
        'can.post-message',
        'chat.can.post-message',
        'meta.can.post-message',
        'chat.meta.can.post-message',
        'can.toggle-oneway',
        'chat.can.toggle-oneway',
        'meta.can.toggle-oneway',
        'chat.meta.can.toggle-oneway',
        'permissions.write',
        'permissions.can_write',
        'permissions.canWrite',
        'permissions.post',
        'permissions.can_post',
        'permissions.canPost',
        'meta.permissions.write',
        'meta.permissions.can_write',
        'meta.permissions.canWrite',
        'meta.permissions.post',
        'meta.permissions.can_post',
        'meta.permissions.canPost',
        'read_only',
        'readOnly',
        'readonly',
        'is_readonly',
        'isReadOnly',
        'meta.read_only',
        'meta.readOnly',
        'meta.readonly',
        'meta.is_readonly',
        'meta.isReadOnly',
        'role',
        'member.role',
        'meta.role',
        'type',
        'meta.type',
        'channel_type',
        'meta.channel_type',
    ];

    for (const path of comparablePaths) {
        const selectedValue =
            getPathValue(chatDetails, path) ?? getPathValue(chat, path);
        if (selectedValue == null) continue;

        const referenceValues = referenceChats
            .map((item) => getPathValue(item, path))
            .filter((value) => value != null);
        if (referenceValues.length === 0) continue;

        const referenceMode = getValueMode(referenceValues);
        if (referenceMode == null) continue;

        const selectedIsRestrictive =
            isRestrictivePermissionValue(selectedValue);
        const referenceIsRestrictive =
            isRestrictivePermissionValue(referenceMode);

        if (selectedIsRestrictive && !referenceIsRestrictive) {
            return false;
        }
    }

    return true;
}

export function SduiChat() {
    const [chats, setChats] = useState<SduiChatItem[]>([]);
    const [isAuthenticated, setIsAuthenticated] = useState<boolean>(true);
    const [loading, setLoading] = useState<boolean>(true);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    const [selectedChat, setSelectedChat] = useState<SduiChatItem | null>(null);
    const [selectedChatDetails, setSelectedChatDetails] =
        useState<SduiChatItem | null>(null);
    const [messages, setMessages] = useState<SduiMessage[]>([]);
    const [loadingMessages, setLoadingMessages] = useState<boolean>(false);
    const [loadingOlderMessages, setLoadingOlderMessages] =
        useState<boolean>(false);
    const [hasMoreMessages, setHasMoreMessages] = useState<boolean>(true);
    const [messagePage, setMessagePage] = useState<number>(1);

    const [messageError, setMessageError] = useState<string | null>(null);
    const [newsById, setNewsById] = useState<Record<string, SduiNews>>({});
    const [hiddenImageUrls, setHiddenImageUrls] = useState<
        Record<string, true>
    >({});
    const [lightboxImageUrl, setLightboxImageUrl] = useState<string | null>(
        null,
    );
    const [newsPage, setNewsPage] = useState<number>(0);
    const [hasMoreNews, setHasMoreNews] = useState<boolean>(true);
    const [loadingNews, setLoadingNews] = useState<boolean>(false);
    const [activeTab, setActiveTab] = useState<'chats' | 'news'>('chats');
    const [newsSearchQuery, setNewsSearchQuery] = useState<string>('');
    const [expandedNewsIds, setExpandedNewsIds] = useState<
        Record<string, true>
    >({});

    const [draft, setDraft] = useState<string>('');
    const [sending, setSending] = useState<boolean>(false);
    const [replyToMessage, setReplyToMessage] = useState<SduiMessage | null>(
        null,
    );
    const [deletingMessageKey, setDeletingMessageKey] = useState<string | null>(
        null,
    );
    const [copiedMessageKey, setCopiedMessageKey] = useState<string | null>(
        null,
    );
    const [messageInfoTarget, setMessageInfoTarget] =
        useState<SduiMessage | null>(null);
    const [messageReaders, setMessageReaders] = useState<any[]>([]);
    const [loadingMessageReaders, setLoadingMessageReaders] =
        useState<boolean>(false);
    const [messageInfoError, setMessageInfoError] = useState<string | null>(
        null,
    );
    const [openMessageMenuKey, setOpenMessageMenuKey] = useState<string | null>(
        null,
    );
    const [deleteTargetMessage, setDeleteTargetMessage] =
        useState<SduiMessage | null>(null);

    const messagesEndRef = useRef<HTMLDivElement | null>(null);
    const messagesContainerRef = useRef<HTMLDivElement | null>(null);
    const messagesRef = useRef<SduiMessage[]>([]);
    const loadingOlderRef = useRef<boolean>(false);
    const loadingNewsRef = useRef<boolean>(false);
    const hasMoreNewsRef = useRef<boolean>(true);
    const shouldStickToBottomRef = useRef<boolean>(true);

    const selectedChatId = useMemo(
        () => (selectedChat ? getMessageChatId(selectedChat) : ''),
        [selectedChat],
    );
    const oneWayDetected = useMemo(
        () =>
            hasOneWayRestrictionSignal(selectedChatDetails) ||
            hasOneWayRestrictionSignal(selectedChat) ||
            hasOneWayRestrictionSignal(messages),
        [selectedChatDetails, selectedChat, messages],
    );
    const canWriteInSelectedChat = useMemo(
        () =>
            canWriteToChat(selectedChat, chats, selectedChatDetails, messages),
        [selectedChat, chats, selectedChatDetails, messages],
    );
    const replyPreview = useMemo(() => {
        if (!replyToMessage) return null;

        const linkedNews = getLinkedNews(replyToMessage, newsById);
        return {
            key: getMessageKey(replyToMessage),
            uuid: getMessageUuid(replyToMessage),
            sender: getMessageSender(replyToMessage),
            text: getMessageText(replyToMessage, linkedNews),
            time: getMessageTime(replyToMessage),
        };
    }, [newsById, replyToMessage]);
    const messageByUuid = useMemo(() => {
        const index: Record<string, SduiMessage> = {};
        for (const message of messages) {
            const uuid = getMessageUuid(message);
            if (uuid) index[uuid] = message;
        }
        return index;
    }, [messages]);
    const newsItems = useMemo(
        () =>
            Object.values(newsById).sort(
                (a, b) => getNewsTimestamp(b) - getNewsTimestamp(a),
            ),
        [newsById],
    );
    const filteredNewsItems = useMemo(() => {
        const query = normalizeTextForComparison(newsSearchQuery);
        if (!query) return newsItems;

        return newsItems.filter((news) => {
            const haystack = normalizeTextForComparison(
                `${getNewsTitle(news)} ${getNewsBody(news)} ${getNewsAuthor(news)} ${getNewsAudience(news)}`,
            );
            return haystack.includes(query);
        });
    }, [newsItems, newsSearchQuery]);
    const deleteTargetPreview = useMemo(() => {
        if (!deleteTargetMessage) return null;
        const linkedNews = getLinkedNews(deleteTargetMessage, newsById);
        return {
            key: getMessageKey(deleteTargetMessage),
            sender: getMessageSender(deleteTargetMessage),
            text: getMessageText(deleteTargetMessage, linkedNews),
        };
    }, [deleteTargetMessage, newsById]);

    useEffect(() => {
        if (!lightboxImageUrl) return;

        const previousOverflow = document.body.style.overflow;
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setLightboxImageUrl(null);
            }
        };

        document.body.style.overflow = 'hidden';
        window.addEventListener('keydown', handleKeyDown);

        return () => {
            document.body.style.overflow = previousOverflow;
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [lightboxImageUrl]);

    useEffect(() => {
        if (!messageInfoTarget) return;

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setMessageInfoTarget(null);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [messageInfoTarget]);

    useEffect(() => {
        if (!deleteTargetMessage) return;

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setDeleteTargetMessage(null);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [deleteTargetMessage]);

    useEffect(() => {
        const handlePointerDown = (event: PointerEvent) => {
            const target = event.target as HTMLElement | null;
            if (target?.closest('[data-sdui-message-menu="true"]')) return;
            setOpenMessageMenuKey(null);
        };

        window.addEventListener('pointerdown', handlePointerDown);
        return () =>
            window.removeEventListener('pointerdown', handlePointerDown);
    }, []);

    const loadChats = useCallback(async () => {
        const token = localStorage.getItem('token');
        const res = await fetch('/api/sdui/chats', {
            headers: { Authorization: `Bearer ${token}` },
        });

        if (res.status === 401) {
            setIsAuthenticated(false);
            return;
        }

        if (!res.ok) {
            throw new Error('Failed to fetch chats');
        }

        const body = await res.json();
        setChats(normalizeArrayResponse(body));
        setIsAuthenticated(true);
    }, []);

    const loadNewsPage = useCallback(async (page: number): Promise<number> => {
        if (loadingNewsRef.current || !hasMoreNewsRef.current) return 0;

        loadingNewsRef.current = true;
        setLoadingNews(true);
        try {
            const token = localStorage.getItem('token');
            const res = await fetch(`/api/sdui/news?page=${page}`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!res.ok) return 0;

            const body = await res.json();
            const newsList = normalizeArrayResponse(body);

            if (newsList.length === 0) {
                hasMoreNewsRef.current = false;
                setHasMoreNews(false);
                return 0;
            }

            setNewsById((prev) => ({
                ...prev,
                ...indexNewsList(newsList),
            }));
            setNewsPage((prev) => Math.max(prev, page));
            return newsList.length;
        } finally {
            loadingNewsRef.current = false;
            setLoadingNews(false);
        }
    }, []);

    const ensureNewsForMessages = useCallback(
        async (batch: SduiMessage[]) => {
            const unresolvedNews = batch.some((m) => {
                if (m?.content !== 'news.posted') return false;
                const newsId = extractNewsId(m);
                return newsId ? !newsById[newsId] : true;
            });

            if (!unresolvedNews || !hasMoreNews) return;

            let nextPage = newsPage + 1;
            for (let i = 0; i < 2; i += 1) {
                const loaded = await loadNewsPage(nextPage);
                if (loaded === 0) break;
                nextPage += 1;
            }
        },
        [hasMoreNews, loadNewsPage, newsById, newsPage],
    );

    const scrollToBottom = useCallback((smooth = false) => {
        const container = messagesContainerRef.current;
        if (!container) return;

        shouldStickToBottomRef.current = true;
        const applyBottomPosition = () => {
            container.scrollTop = container.scrollHeight;
        };

        if (smooth && messagesEndRef.current) {
            messagesEndRef.current.scrollIntoView({
                behavior: 'smooth',
                block: 'end',
            });
        }

        requestAnimationFrame(() => {
            applyBottomPosition();
            requestAnimationFrame(applyBottomPosition);
            window.setTimeout(applyBottomPosition, 120);
        });
    }, []);
    const stickToBottomIfNeeded = useCallback(() => {
        if (!shouldStickToBottomRef.current) return;
        scrollToBottom(false);
    }, [scrollToBottom]);

    React.useEffect(() => {
        messagesRef.current = messages;
        if (shouldStickToBottomRef.current) {
            scrollToBottom(false);
        }
    }, [messages, scrollToBottom]);

    React.useEffect(() => {
        hasMoreNewsRef.current = hasMoreNews;
    }, [hasMoreNews]);

    const loadMessagesPage = useCallback(
        async (
            chat: SduiChatItem,
            page: number,
            mode: 'replace' | 'prepend' = 'replace',
            showLoader = true,
        ) => {
            const chatId = getMessageChatId(chat);
            if (!chatId) {
                setMessageError('Chat-ID fehlt.');
                return;
            }

            const isReplace = mode === 'replace';
            if (isReplace && showLoader) {
                setLoadingMessages(true);
            }

            try {
                const token = localStorage.getItem('token');
                const res = await fetch(
                    `/api/sdui/chats/${encodeURIComponent(chatId)}/messages?page=${page}`,
                    {
                        headers: { Authorization: `Bearer ${token}` },
                    },
                );

                if (!res.ok) {
                    const err = await res.json().catch(() => ({}));
                    throw new Error(
                        err?.error ||
                            'Nachrichten konnten nicht geladen werden.',
                    );
                }

                const body = await res.json();
                const incoming = normalizeArrayResponse(body).sort(
                    (a: SduiMessage, b: SduiMessage) =>
                        getMessageTimestamp(a) - getMessageTimestamp(b),
                );

                const previousMessages = messagesRef.current;
                const previousKeys = new Set(
                    previousMessages.map((message) => getMessageKey(message)),
                );
                const uniqueIncomingCount = incoming.filter(
                    (message) => !previousKeys.has(getMessageKey(message)),
                ).length;

                if (isReplace) {
                    setMessages(incoming);
                    setMessagePage(page);
                    setHasMoreMessages(incoming.length > 0);
                    shouldStickToBottomRef.current = true;
                    scrollToBottom(false);
                } else {
                    const container = messagesContainerRef.current;
                    const previousHeight = container?.scrollHeight ?? 0;

                    setMessages((prev) => mergeUniqueMessages(prev, incoming));
                    setMessagePage(page);
                    setHasMoreMessages(
                        incoming.length > 0 && uniqueIncomingCount > 0,
                    );

                    requestAnimationFrame(() => {
                        if (container) {
                            const nextHeight = container.scrollHeight;
                            const delta = nextHeight - previousHeight;
                            container.scrollTop = container.scrollTop + delta;
                        }
                    });
                }

                await ensureNewsForMessages(incoming);
            } catch (error: any) {
                if (isReplace) {
                    setMessages([]);
                }
                setMessageError(
                    error?.message ||
                        'Nachrichten konnten nicht geladen werden.',
                );
            } finally {
                if (isReplace && showLoader) {
                    setLoadingMessages(false);
                }
            }
        },
        [ensureNewsForMessages, scrollToBottom],
    );

    const bootstrap = useCallback(async () => {
        setLoading(true);
        setErrorMsg(null);
        setSelectedChatDetails(null);
        setNewsById({});
        setNewsPage(0);
        setHasMoreNews(true);

        try {
            await loadChats();
            await loadNewsPage(1);
        } catch (error) {
            console.error(error);
            setErrorMsg('SDUI Chats konnten nicht geladen werden.');
        } finally {
            setLoading(false);
        }
    }, [loadChats, loadNewsPage]);

    React.useEffect(() => {
        bootstrap().catch((error) => {
            console.error(error);
            setLoading(false);
        });
    }, [bootstrap]);

    const handleAuth = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setErrorMsg(null);

        try {
            const token = localStorage.getItem('token');
            const res = await fetch('/api/sdui/auth', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({}),
            });

            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(
                    errData?.error ||
                        'SDUI Authentifizierung mit WebUntis ist fehlgeschlagen.',
                );
            }

            await bootstrap();
        } catch (error: any) {
            setErrorMsg(error?.message || 'Netzwerkfehler bei SDUI.');
            setLoading(false);
        }
    };

    const loadChatDetails = useCallback(async (chat: SduiChatItem) => {
        const chatId = getMessageChatId(chat);
        if (!chatId) {
            setSelectedChatDetails(null);
            return;
        }

        try {
            const token = localStorage.getItem('token');
            const res = await fetch(
                `/api/sdui/chats/${encodeURIComponent(chatId)}`,
                {
                    headers: { Authorization: `Bearer ${token}` },
                },
            );

            if (!res.ok) {
                throw new Error('Chat-Details konnten nicht geladen werden.');
            }

            const body = await res.json();
            const details = Array.isArray(body)
                ? body[0]
                : Array.isArray(body?.data)
                  ? body.data[0]
                  : body?.data || body;

            if (details && typeof details === 'object') {
                setSelectedChatDetails(details);
            } else {
                setSelectedChatDetails(null);
            }
        } catch (error) {
            console.error(error);
            setSelectedChatDetails(null);
        }
    }, []);

    const handleSelectChat = async (chat: SduiChatItem) => {
        setActiveTab('chats');
        setSelectedChat(chat);
        setSelectedChatDetails(null);
        setMessages([]);
        setMessageError(null);
        setDraft('');
        setReplyToMessage(null);
        setDeletingMessageKey(null);
        setCopiedMessageKey(null);
        setMessageInfoTarget(null);
        setMessageReaders([]);
        setMessageInfoError(null);
        setLoadingMessageReaders(false);
        setOpenMessageMenuKey(null);
        setDeleteTargetMessage(null);
        setMessagePage(1);
        setHasMoreMessages(true);
        setLoadingOlderMessages(false);
        shouldStickToBottomRef.current = true;
        await Promise.all([
            loadMessagesPage(chat, 1, 'replace', true),
            loadChatDetails(chat),
        ]);
    };

    const handleMessagesScroll = async (
        event: React.UIEvent<HTMLDivElement>,
    ) => {
        const element = event.currentTarget;
        const distanceFromBottom =
            element.scrollHeight - element.scrollTop - element.clientHeight;
        shouldStickToBottomRef.current = distanceFromBottom <= 96;

        if (
            !selectedChat ||
            loadingMessages ||
            loadingOlderMessages ||
            !hasMoreMessages ||
            loadingOlderRef.current
        ) {
            return;
        }

        if (element.scrollTop > 40) {
            return;
        }

        loadingOlderRef.current = true;
        setLoadingOlderMessages(true);
        try {
            const nextPage = messagePage + 1;
            await loadMessagesPage(selectedChat, nextPage, 'prepend');

            if (hasMoreNews && !loadingNews) {
                await loadNewsPage(newsPage + 1);
            }
        } finally {
            setLoadingOlderMessages(false);
            loadingOlderRef.current = false;
        }
    };

    const handleNewsScroll = async (event: React.UIEvent<HTMLDivElement>) => {
        if (!hasMoreNews || loadingNews) return;

        const element = event.currentTarget;
        const distanceToBottom =
            element.scrollHeight - element.scrollTop - element.clientHeight;

        if (distanceToBottom > 160) return;
        await loadNewsPage(newsPage + 1);
    };

    const handleCopyMessageText = useCallback(
        async (message: SduiMessage) => {
            const linkedNews = getLinkedNews(message, newsById);
            const text = getMessageText(message, linkedNews).trim();
            if (!text) return;

            const messageKey = getMessageKey(message);

            try {
                if (navigator?.clipboard?.writeText) {
                    await navigator.clipboard.writeText(text);
                } else {
                    const textarea = document.createElement('textarea');
                    textarea.value = text;
                    textarea.style.position = 'fixed';
                    textarea.style.opacity = '0';
                    document.body.appendChild(textarea);
                    textarea.focus();
                    textarea.select();
                    document.execCommand('copy');
                    document.body.removeChild(textarea);
                }

                setCopiedMessageKey(messageKey);
                window.setTimeout(() => {
                    setCopiedMessageKey((current) =>
                        current === messageKey ? null : current,
                    );
                }, 1400);
            } catch (error) {
                console.error(error);
                setMessageError('Nachricht konnte nicht kopiert werden.');
            }
        },
        [newsById],
    );

    const handleDeleteMessage = useCallback(
        async (message: SduiMessage): Promise<boolean> => {
            if (!selectedChatId) return false;

            const messageUuid = getMessageUuid(message);
            if (!messageUuid) {
                setMessageError('Nachricht kann nicht gelöscht werden.');
                return false;
            }

            const messageKey = getMessageKey(message);
            setOpenMessageMenuKey(null);
            setDeletingMessageKey(messageKey);
            setMessageError(null);

            try {
                const token = localStorage.getItem('token');
                const res = await fetch(
                    `/api/sdui/chats/${encodeURIComponent(selectedChatId)}/messages/${encodeURIComponent(messageUuid)}`,
                    {
                        method: 'DELETE',
                        headers: {
                            Authorization: `Bearer ${token}`,
                        },
                    },
                );

                if (!res.ok) {
                    const err = await res.json().catch(() => ({}));
                    throw new Error(
                        err?.error || 'Nachricht konnte nicht gelöscht werden.',
                    );
                }

                if (
                    replyToMessage &&
                    getMessageKey(replyToMessage) === messageKey
                ) {
                    setReplyToMessage(null);
                }

                if (
                    messageInfoTarget &&
                    getMessageKey(messageInfoTarget) === messageKey
                ) {
                    setMessageInfoTarget(null);
                }

                if (selectedChat) {
                    await loadMessagesPage(selectedChat, 1, 'replace', false);
                }

                return true;
            } catch (error: any) {
                setMessageError(
                    error?.message || 'Nachricht konnte nicht gelöscht werden.',
                );
                return false;
            } finally {
                setDeletingMessageKey((current) =>
                    current === messageKey ? null : current,
                );
            }
        },
        [
            loadMessagesPage,
            messageInfoTarget,
            replyToMessage,
            selectedChat,
            selectedChatId,
        ],
    );

    const handleRequestDeleteMessage = useCallback((message: SduiMessage) => {
        setOpenMessageMenuKey(null);
        setDeleteTargetMessage(message);
    }, []);

    const handleConfirmDeleteMessage = useCallback(async () => {
        if (!deleteTargetMessage) return;
        const deleted = await handleDeleteMessage(deleteTargetMessage);
        if (deleted) {
            setDeleteTargetMessage(null);
        }
    }, [deleteTargetMessage, handleDeleteMessage]);

    const handleOpenMessageInfo = useCallback(
        async (message: SduiMessage) => {
            setOpenMessageMenuKey(null);
            setMessageInfoTarget(message);
            setMessageReaders([]);
            setMessageInfoError(null);

            const messageUuid = getMessageUuid(message);
            if (!selectedChatId || !messageUuid) {
                return;
            }

            setLoadingMessageReaders(true);
            try {
                const token = localStorage.getItem('token');
                const res = await fetch(
                    `/api/sdui/chats/${encodeURIComponent(selectedChatId)}/messages/${encodeURIComponent(messageUuid)}/readers?page=1`,
                    {
                        headers: {
                            Authorization: `Bearer ${token}`,
                        },
                    },
                );

                if (!res.ok) {
                    const err = await res.json().catch(() => ({}));
                    throw new Error(
                        err?.error ||
                            'Nachrichteninformationen konnten nicht geladen werden.',
                    );
                }

                const body = await res.json();
                setMessageReaders(normalizeReaderList(body));
            } catch (error: any) {
                setMessageInfoError(
                    error?.message ||
                        'Nachrichteninformationen konnten nicht geladen werden.',
                );
            } finally {
                setLoadingMessageReaders(false);
            }
        },
        [selectedChatId],
    );

    const handleSendMessage = async (e: React.FormEvent) => {
        e.preventDefault();
        const content = draft.trim();
        if (!selectedChatId || !content || !canWriteInSelectedChat) return;

        const replyUuid = replyPreview?.uuid || '';
        const sendAsReply = Boolean(replyToMessage && replyUuid);

        setSending(true);
        setMessageError(null);

        try {
            const token = localStorage.getItem('token');
            const endpoint = sendAsReply
                ? `/api/sdui/chats/${encodeURIComponent(selectedChatId)}/messages/${encodeURIComponent(replyUuid)}/reply`
                : `/api/sdui/chats/${encodeURIComponent(selectedChatId)}/messages`;
            const res = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ content }),
            });

            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(
                    err?.error || 'Nachricht konnte nicht gesendet werden.',
                );
            }

            setDraft('');
            setReplyToMessage(null);
            if (selectedChat) {
                await loadMessagesPage(selectedChat, 1, 'replace', false);
            }
        } catch (error: any) {
            setMessageError(
                error?.message || 'Nachricht konnte nicht gesendet werden.',
            );
        } finally {
            setSending(false);
        }
    };

    if (loading) {
        return (
            <div className="h-full p-4 space-y-4">
                <div className="h-12 w-full bg-slate-200 dark:bg-slate-800 animate-pulse rounded-md" />
                <div className="h-[calc(100%-4rem)] w-full bg-slate-200 dark:bg-slate-800 animate-pulse rounded-md" />
            </div>
        );
    }

    if (!isAuthenticated) {
        return (
            <div className="max-w-md mx-auto p-6 mt-8 bg-white dark:bg-slate-900 rounded-xl shadow-md border border-slate-100 dark:border-slate-800">
                <div className="mb-6">
                    <h2 className="text-xl font-semibold mb-2 text-slate-900 dark:text-slate-100">
                        Connect SDUI
                    </h2>
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                        Your WebUntis credentials will be securely used to
                        auto-authenticate with SDUI.
                    </p>
                </div>
                {errorMsg && (
                    <div className="mb-4 text-red-700 bg-red-50 p-2 rounded-md border border-red-200 text-sm">
                        {errorMsg}
                    </div>
                )}
                <form onSubmit={handleAuth} className="space-y-4">
                    <button
                        type="submit"
                        className="w-full rounded-md bg-blue-600 text-white hover:bg-blue-700 h-10 px-4 py-2 text-sm font-medium"
                    >
                        Connect with WebUntis
                    </button>
                </form>
            </div>
        );
    }

    const showInitialMessagesSpinner = loadingMessages && messages.length === 0;
    const serializedMessageInfo = (() => {
        if (!messageInfoTarget) return '';
        try {
            return JSON.stringify(messageInfoTarget, null, 2);
        } catch {
            return '';
        }
    })();

    return (
        <div className="h-full w-full flex flex-col bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100">
            <div className="shrink-0 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2">
                <div className="inline-flex rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 p-1">
                    <button
                        type="button"
                        onClick={() => {
                            setActiveTab('chats');
                            setOpenMessageMenuKey(null);
                        }}
                        className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                            activeTab === 'chats'
                                ? 'bg-white dark:bg-slate-700 text-blue-700 dark:text-blue-300 shadow-sm'
                                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100'
                        }`}
                    >
                        Chats
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            setActiveTab('news');
                            setOpenMessageMenuKey(null);
                            setDeleteTargetMessage(null);
                            setReplyToMessage(null);
                        }}
                        className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                            activeTab === 'news'
                                ? 'bg-white dark:bg-slate-700 text-blue-700 dark:text-blue-300 shadow-sm'
                                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100'
                        }`}
                    >
                        News
                    </button>
                </div>
            </div>

            <div className="min-h-0 flex-1 flex overflow-hidden">
                {activeTab === 'chats' ? (
                    <>
                        <aside
                            className={`
                    ${selectedChat ? 'hidden md:flex' : 'flex'}
                    w-full md:w-[340px] lg:w-[380px] shrink-0 min-h-0 flex-col
                    border-r border-slate-200 dark:border-slate-800
                `}
                        >
                            <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain p-2 space-y-2">
                                {errorMsg && (
                                    <div className="rounded-md border border-red-200 bg-red-50 text-red-700 px-3 py-2 text-sm">
                                        {errorMsg}
                                    </div>
                                )}

                                {chats.length === 0 ? (
                                    <div className="p-4 rounded-md border text-blue-800 border-blue-200 bg-blue-50 dark:bg-blue-950 dark:text-blue-200 dark:border-blue-900">
                                        <p className="text-sm">
                                            Keine Chats gefunden.
                                        </p>
                                    </div>
                                ) : (
                                    chats.map((chat, index) => {
                                        const active =
                                            selectedChat?.id === chat?.id;
                                        const unread = Boolean(
                                            chat?.meta?.is_unread,
                                        );

                                        return (
                                            <button
                                                key={chat?.id || index}
                                                onClick={() =>
                                                    handleSelectChat(chat)
                                                }
                                                className={`
                                            w-full text-left rounded-lg border px-3 py-2 transition-colors
                                        ${
                                            active
                                                ? 'border-blue-300 bg-blue-100 dark:border-blue-700 dark:bg-blue-900/40'
                                                : unread
                                                  ? 'border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-900/20'
                                                  : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700/50'
                                        }
                                    `}
                                            >
                                                <div className="flex items-start justify-between gap-2">
                                                    <h3 className="min-w-0 font-semibold text-sm truncate">
                                                        {getChatName(chat)}
                                                    </h3>
                                                    <span className="text-[10px] text-slate-400 dark:text-slate-500 shrink-0">
                                                        {getChatTimestamp(chat)}
                                                    </span>
                                                </div>
                                                <p className="text-xs mt-1 leading-snug text-slate-500 dark:text-slate-400 line-clamp-2">
                                                    {getChatPreview(chat)}
                                                </p>
                                            </button>
                                        );
                                    })
                                )}
                            </div>
                        </aside>

                        <section className="flex-1 min-w-0 flex flex-col bg-slate-50 dark:bg-slate-950">
                            {!selectedChat ? (
                                <div className="hidden md:flex flex-1 items-center justify-center text-slate-400 dark:text-slate-500 text-sm">
                                    Chat auswaehlen, um den Verlauf zu sehen.
                                </div>
                            ) : (
                                <>
                                    <header className="h-[69px] px-4 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center gap-3">
                                        <button
                                            onClick={() => {
                                                setSelectedChat(null);
                                                setSelectedChatDetails(null);
                                                setReplyToMessage(null);
                                                setMessageInfoTarget(null);
                                                setMessageReaders([]);
                                                setMessageInfoError(null);
                                                setOpenMessageMenuKey(null);
                                                setDeleteTargetMessage(null);
                                            }}
                                            className="md:hidden p-2 -ml-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800"
                                            aria-label="Zurueck zur Chatliste"
                                        >
                                            <svg
                                                className="w-5 h-5"
                                                fill="none"
                                                viewBox="0 0 24 24"
                                                stroke="currentColor"
                                            >
                                                <path
                                                    strokeLinecap="round"
                                                    strokeLinejoin="round"
                                                    strokeWidth={2}
                                                    d="M15 19l-7-7 7-7"
                                                />
                                            </svg>
                                        </button>
                                        <div className="min-w-0">
                                            <h2 className="font-semibold text-base truncate">
                                                {getChatName(selectedChat)}
                                            </h2>
                                            {selectedChat?.meta?.subtitle && (
                                                <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                                                    {selectedChat.meta.subtitle}
                                                </p>
                                            )}
                                        </div>
                                    </header>

                                    <main
                                        ref={messagesContainerRef}
                                        onScroll={handleMessagesScroll}
                                        className="flex-1 overflow-y-auto p-4 space-y-3"
                                    >
                                        {showInitialMessagesSpinner ? (
                                            <div className="h-full flex items-center justify-center">
                                                <div className="h-8 w-8 rounded-full border-2 border-slate-300 border-t-blue-600 animate-spin" />
                                            </div>
                                        ) : messageError ? (
                                            <div className="rounded-md border border-red-200 bg-red-50 text-red-700 px-3 py-2 text-sm">
                                                {messageError}
                                            </div>
                                        ) : messages.length === 0 ? (
                                            <div className="h-full flex items-center justify-center text-sm text-slate-400 dark:text-slate-500">
                                                Keine Nachrichten in diesem
                                                Chat.
                                            </div>
                                        ) : (
                                            messages.map((message) => {
                                                const messageKey =
                                                    getMessageKey(message);
                                                const messageUuid =
                                                    getMessageUuid(message);
                                                const actionKey =
                                                    typeof message?.content ===
                                                    'string'
                                                        ? message.content.trim()
                                                        : '';
                                                const info =
                                                    isInfoMessage(message);
                                                const linkedNews =
                                                    getLinkedNews(
                                                        message,
                                                        newsById,
                                                    );
                                                const messageText =
                                                    getMessageText(
                                                        message,
                                                        linkedNews,
                                                    );
                                                const newsTitle =
                                                    getNewsTitle(linkedNews);
                                                const newsBody =
                                                    getNewsBody(linkedNews);
                                                const newsImages =
                                                    extractImageUrls([
                                                        linkedNews,
                                                        message,
                                                    ]);
                                                const visibleNewsImages =
                                                    newsImages.filter(
                                                        (src) =>
                                                            !hiddenImageUrls[
                                                                src
                                                            ],
                                                    );
                                                const singleNewsImage =
                                                    visibleNewsImages.length ===
                                                    1;
                                                const messageAttachments =
                                                    extractMessageAttachments(
                                                        message,
                                                    );
                                                const visibleImageAttachments =
                                                    messageAttachments.filter(
                                                        (attachment) =>
                                                            attachment.isImage &&
                                                            !hiddenImageUrls[
                                                                attachment.url
                                                            ],
                                                    );
                                                const fileAttachments =
                                                    messageAttachments.filter(
                                                        (attachment) =>
                                                            !attachment.isImage,
                                                    );
                                                const singleAttachmentImage =
                                                    visibleImageAttachments.length ===
                                                    1;
                                                const messageIsDeleted =
                                                    isDeletedMessage(message);
                                                const replyReferencePreview =
                                                    getReplyPreviewForMessage(
                                                        message,
                                                        messageByUuid,
                                                        newsById,
                                                    );
                                                const hideDuplicateAttachmentTitleText =
                                                    shouldHideDuplicateAttachmentText(
                                                        messageText,
                                                        fileAttachments,
                                                    );
                                                const hideAttachmentLikeMessageText =
                                                    (visibleImageAttachments.length >
                                                        0 ||
                                                        fileAttachments.length >
                                                            0) &&
                                                    (looksLikeAttachmentPathText(
                                                        messageText,
                                                    ) ||
                                                        hideDuplicateAttachmentTitleText);
                                                const showMessageText =
                                                    Boolean(messageText) &&
                                                    !hideAttachmentLikeMessageText;
                                                const canReplyToMessage =
                                                    canWriteInSelectedChat &&
                                                    !info &&
                                                    !messageIsDeleted &&
                                                    Boolean(messageUuid);
                                                const canDeleteMessage =
                                                    !messageIsDeleted &&
                                                    getMessageDeletePermission(
                                                        message,
                                                        canWriteInSelectedChat,
                                                    ) &&
                                                    Boolean(messageUuid);
                                                const canViewMessageInfo =
                                                    getMessageInfoPermission(
                                                        message,
                                                    ) && Boolean(messageUuid);
                                                const canCopyMessage =
                                                    !messageIsDeleted &&
                                                    showMessageText;
                                                const hasMenuActions =
                                                    canReplyToMessage ||
                                                    canCopyMessage ||
                                                    canViewMessageInfo ||
                                                    canDeleteMessage;
                                                const isDeletingThisMessage =
                                                    deletingMessageKey ===
                                                    messageKey;
                                                const isCopiedThisMessage =
                                                    copiedMessageKey ===
                                                    messageKey;
                                                const linkClassName = info
                                                    ? 'underline decoration-amber-400/80 underline-offset-2 text-amber-800 dark:text-amber-200 hover:text-amber-900 dark:hover:text-amber-100'
                                                    : 'underline decoration-blue-400/80 underline-offset-2 text-blue-700 dark:text-blue-300 hover:text-blue-800 dark:hover:text-blue-200';

                                                return (
                                                    <div
                                                        key={messageKey}
                                                        className={`max-w-[90%] rounded-2xl border px-3 py-2 ${
                                                            info
                                                                ? 'border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20'
                                                                : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800'
                                                        }`}
                                                    >
                                                        <div className="flex items-center justify-between gap-4 mb-1">
                                                            <span
                                                                className={`text-xs font-semibold ${
                                                                    info
                                                                        ? 'text-amber-700 dark:text-amber-300'
                                                                        : 'text-blue-600 dark:text-blue-400'
                                                                }`}
                                                            >
                                                                {getMessageSender(
                                                                    message,
                                                                )}
                                                            </span>
                                                            <div className="flex items-center gap-1">
                                                                <span className="text-[10px] text-slate-400 dark:text-slate-500">
                                                                    {getMessageTime(
                                                                        message,
                                                                    )}
                                                                </span>
                                                                <SduiMessageActionsMenu
                                                                    hasMenuActions={
                                                                        hasMenuActions
                                                                    }
                                                                    isOpen={
                                                                        openMessageMenuKey ===
                                                                        messageKey
                                                                    }
                                                                    canReplyToMessage={
                                                                        canReplyToMessage
                                                                    }
                                                                    canCopyMessage={
                                                                        canCopyMessage
                                                                    }
                                                                    canViewMessageInfo={
                                                                        canViewMessageInfo
                                                                    }
                                                                    canDeleteMessage={
                                                                        canDeleteMessage
                                                                    }
                                                                    isCopiedThisMessage={
                                                                        isCopiedThisMessage
                                                                    }
                                                                    isDeletingThisMessage={
                                                                        isDeletingThisMessage
                                                                    }
                                                                    onToggle={(
                                                                        event,
                                                                    ) => {
                                                                        event.stopPropagation();
                                                                        setOpenMessageMenuKey(
                                                                            (
                                                                                current,
                                                                            ) =>
                                                                                current ===
                                                                                messageKey
                                                                                    ? null
                                                                                    : messageKey,
                                                                        );
                                                                    }}
                                                                    onReply={() => {
                                                                        setReplyToMessage(
                                                                            message,
                                                                        );
                                                                        setOpenMessageMenuKey(
                                                                            null,
                                                                        );
                                                                    }}
                                                                    onCopy={() => {
                                                                        void handleCopyMessageText(
                                                                            message,
                                                                        );
                                                                        setOpenMessageMenuKey(
                                                                            null,
                                                                        );
                                                                    }}
                                                                    onInfo={() => {
                                                                        void handleOpenMessageInfo(
                                                                            message,
                                                                        );
                                                                    }}
                                                                    onDelete={() => {
                                                                        handleRequestDeleteMessage(
                                                                            message,
                                                                        );
                                                                    }}
                                                                />
                                                            </div>
                                                        </div>

                                                        {replyReferencePreview && (
                                                            <div className="mb-2 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/60 px-2.5 py-1.5">
                                                                <div className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                                                                    Antwort auf{' '}
                                                                    {
                                                                        replyReferencePreview.sender
                                                                    }
                                                                    {replyReferencePreview.time
                                                                        ? ` • ${replyReferencePreview.time}`
                                                                        : ''}
                                                                </div>
                                                                <div className="mt-0.5 text-xs text-slate-700 dark:text-slate-200 line-clamp-2">
                                                                    {replyReferencePreview.text ||
                                                                        'Nachricht'}
                                                                </div>
                                                            </div>
                                                        )}

                                                        {showMessageText && (
                                                            <div
                                                                className={`text-sm whitespace-pre-wrap wrap-break-word ${
                                                                    messageIsDeleted
                                                                        ? 'italic text-slate-500 dark:text-slate-400'
                                                                        : info
                                                                          ? 'text-amber-900 dark:text-amber-100'
                                                                          : 'text-slate-800 dark:text-slate-200'
                                                                }`}
                                                            >
                                                                {renderTextWithLinks(
                                                                    messageText,
                                                                    linkClassName,
                                                                )}
                                                            </div>
                                                        )}

                                                        {visibleImageAttachments.length >
                                                            0 && (
                                                            <div
                                                                className={`mt-2 ${
                                                                    singleAttachmentImage
                                                                        ? ''
                                                                        : 'grid grid-cols-1 sm:grid-cols-2 gap-2'
                                                                }`}
                                                            >
                                                                {visibleImageAttachments.map(
                                                                    (
                                                                        attachment,
                                                                    ) => (
                                                                        <div
                                                                            key={`${messageKey}-${attachment.url}`}
                                                                            className={`rounded-md overflow-hidden border border-slate-200/80 dark:border-slate-700/70 bg-slate-50 dark:bg-slate-900/50 ${
                                                                                singleAttachmentImage
                                                                                    ? 'w-full'
                                                                                    : ''
                                                                            }`}
                                                                        >
                                                                            <button
                                                                                type="button"
                                                                                onClick={() =>
                                                                                    setLightboxImageUrl(
                                                                                        attachment.url,
                                                                                    )
                                                                                }
                                                                                className="block w-full"
                                                                            >
                                                                                <img
                                                                                    src={
                                                                                        attachment.url
                                                                                    }
                                                                                    alt={
                                                                                        attachment.name
                                                                                    }
                                                                                    loading="lazy"
                                                                                    className={`w-full bg-slate-100 dark:bg-slate-800 ${
                                                                                        singleAttachmentImage
                                                                                            ? 'h-auto max-h-112 object-contain'
                                                                                            : 'h-36 object-cover'
                                                                                    }`}
                                                                                    onError={() => {
                                                                                        setHiddenImageUrls(
                                                                                            (
                                                                                                prev,
                                                                                            ) => {
                                                                                                if (
                                                                                                    prev[
                                                                                                        attachment
                                                                                                            .url
                                                                                                    ]
                                                                                                ) {
                                                                                                    return prev;
                                                                                                }
                                                                                                return {
                                                                                                    ...prev,
                                                                                                    [attachment.url]: true,
                                                                                                };
                                                                                            },
                                                                                        );
                                                                                    }}
                                                                                    onLoad={
                                                                                        stickToBottomIfNeeded
                                                                                    }
                                                                                />
                                                                            </button>
                                                                            <a
                                                                                href={
                                                                                    attachment.url
                                                                                }
                                                                                target="_blank"
                                                                                rel="noreferrer"
                                                                                download={
                                                                                    attachment.name
                                                                                }
                                                                                className="block px-2 py-1 text-xs text-blue-700 dark:text-blue-300 hover:underline truncate"
                                                                                title={
                                                                                    attachment.name
                                                                                }
                                                                            >
                                                                                {getAttachmentDisplayName(
                                                                                    attachment,
                                                                                )}
                                                                            </a>
                                                                        </div>
                                                                    ),
                                                                )}
                                                            </div>
                                                        )}

                                                        {fileAttachments.length >
                                                            0 && (
                                                            <div className="mt-2 space-y-1">
                                                                {fileAttachments.map(
                                                                    (
                                                                        attachment,
                                                                    ) => (
                                                                        <a
                                                                            key={`${messageKey}-${attachment.url}`}
                                                                            href={
                                                                                attachment.url
                                                                            }
                                                                            target="_blank"
                                                                            rel="noreferrer"
                                                                            download={
                                                                                attachment.name
                                                                            }
                                                                            className="flex min-w-0 items-center justify-between gap-2 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 px-2 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-800"
                                                                        >
                                                                            <span
                                                                                className="min-w-0 text-xs text-slate-700 dark:text-slate-200 truncate"
                                                                                title={
                                                                                    attachment.name
                                                                                }
                                                                            >
                                                                                {getAttachmentDisplayName(
                                                                                    attachment,
                                                                                )}
                                                                            </span>
                                                                            <span className="text-[10px] text-slate-500 dark:text-slate-400 shrink-0">
                                                                                {formatFileSize(
                                                                                    attachment.size,
                                                                                ) ||
                                                                                    'Download'}
                                                                            </span>
                                                                        </a>
                                                                    ),
                                                                )}
                                                            </div>
                                                        )}

                                                        {actionKey ===
                                                            'news.posted' &&
                                                            (newsTitle ||
                                                                newsBody ||
                                                                visibleNewsImages.length >
                                                                    0) && (
                                                                <div className="mt-2 rounded-lg border border-amber-300/60 dark:border-amber-700/60 bg-white/70 dark:bg-slate-900/40 p-2">
                                                                    <div className="text-[11px] uppercase tracking-wide font-semibold text-amber-700 dark:text-amber-300 mb-1">
                                                                        News-Inhalt
                                                                    </div>
                                                                    {newsTitle && (
                                                                        <div className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-1">
                                                                            {
                                                                                newsTitle
                                                                            }
                                                                        </div>
                                                                    )}
                                                                    {newsBody && (
                                                                        <div className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap wrap-break-word">
                                                                            {renderTextWithLinks(
                                                                                newsBody,
                                                                                'underline decoration-blue-400/70 underline-offset-2 text-blue-700 dark:text-blue-300 hover:text-blue-800 dark:hover:text-blue-200',
                                                                            )}
                                                                        </div>
                                                                    )}
                                                                    {visibleNewsImages.length >
                                                                        0 && (
                                                                        <div
                                                                            className={`mt-2 ${
                                                                                singleNewsImage
                                                                                    ? ''
                                                                                    : 'grid grid-cols-1 sm:grid-cols-2 gap-2'
                                                                            }`}
                                                                        >
                                                                            {visibleNewsImages.map(
                                                                                (
                                                                                    src,
                                                                                ) => (
                                                                                    <button
                                                                                        type="button"
                                                                                        key={
                                                                                            src
                                                                                        }
                                                                                        onClick={() =>
                                                                                            setLightboxImageUrl(
                                                                                                src,
                                                                                            )
                                                                                        }
                                                                                        className={`block rounded-md overflow-hidden border border-amber-200/70 dark:border-amber-700/50 ${
                                                                                            singleNewsImage
                                                                                                ? 'w-full'
                                                                                                : ''
                                                                                        }`}
                                                                                    >
                                                                                        <img
                                                                                            src={
                                                                                                src
                                                                                            }
                                                                                            alt=""
                                                                                            loading="lazy"
                                                                                            className={`w-full bg-slate-100 dark:bg-slate-800 ${
                                                                                                singleNewsImage
                                                                                                    ? 'h-auto max-h-112 object-contain'
                                                                                                    : 'h-36 object-cover'
                                                                                            }`}
                                                                                            onError={() => {
                                                                                                setHiddenImageUrls(
                                                                                                    (
                                                                                                        prev,
                                                                                                    ) => {
                                                                                                        if (
                                                                                                            prev[
                                                                                                                src
                                                                                                            ]
                                                                                                        ) {
                                                                                                            return prev;
                                                                                                        }
                                                                                                        return {
                                                                                                            ...prev,
                                                                                                            [src]: true,
                                                                                                        };
                                                                                                    },
                                                                                                );
                                                                                            }}
                                                                                            onLoad={
                                                                                                stickToBottomIfNeeded
                                                                                            }
                                                                                        />
                                                                                    </button>
                                                                                ),
                                                                            )}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            )}
                                                    </div>
                                                );
                                            })
                                        )}
                                        <div ref={messagesEndRef} />
                                    </main>

                                    <footer className="border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3">
                                        {!canWriteInSelectedChat && (
                                            <div className="mb-2 rounded-md border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 px-3 py-2 text-xs">
                                                {oneWayDetected
                                                    ? 'Dieser Chat steht aktuell auf "One-Way". Nur Administratoren duerfen schreiben oder eine Konversation eröffnen.'
                                                    : 'Du hast in diesem Chat keine Schreibrechte.'}
                                            </div>
                                        )}
                                        {replyPreview && (
                                            <div className="mb-2 rounded-md border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 px-3 py-2">
                                                <div className="flex items-start justify-between gap-3">
                                                    <div className="min-w-0">
                                                        <div className="text-[11px] font-semibold text-blue-700 dark:text-blue-300">
                                                            Antwort an{' '}
                                                            {
                                                                replyPreview.sender
                                                            }
                                                        </div>
                                                        <div className="text-xs text-slate-700 dark:text-slate-200 line-clamp-2">
                                                            {replyPreview.text ||
                                                                'Nachricht'}
                                                        </div>
                                                    </div>
                                                    <button
                                                        type="button"
                                                        onClick={() =>
                                                            setReplyToMessage(
                                                                null,
                                                            )
                                                        }
                                                        className="text-[11px] rounded-full border border-blue-300 dark:border-blue-700 px-2 py-0.5 text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/40"
                                                    >
                                                        Abbrechen
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                        <form
                                            onSubmit={handleSendMessage}
                                            className="flex gap-2"
                                        >
                                            <input
                                                type="text"
                                                value={draft}
                                                onChange={(e) =>
                                                    setDraft(e.target.value)
                                                }
                                                placeholder={
                                                    canWriteInSelectedChat
                                                        ? replyPreview
                                                            ? 'Antwort schreiben...'
                                                            : 'Nachricht schreiben...'
                                                        : oneWayDetected
                                                          ? 'One-Way Chat: Schreiben ist nur fuer Administratoren erlaubt.'
                                                          : 'Schreiben in diesem Chat nicht erlaubt.'
                                                }
                                                disabled={
                                                    !canWriteInSelectedChat
                                                }
                                                className={`flex-1 rounded-full px-4 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 border border-transparent focus:outline-none focus:border-blue-500 disabled:cursor-not-allowed disabled:opacity-70 ${
                                                    canWriteInSelectedChat
                                                        ? 'bg-slate-100 dark:bg-slate-800'
                                                        : 'bg-slate-200 dark:bg-slate-700'
                                                }`}
                                            />
                                            <button
                                                type="submit"
                                                disabled={
                                                    !canWriteInSelectedChat ||
                                                    sending ||
                                                    !draft.trim()
                                                }
                                                className="rounded-full px-4 py-2 text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                                            >
                                                {replyPreview
                                                    ? 'Antworten'
                                                    : 'Senden'}
                                            </button>
                                        </form>
                                    </footer>
                                </>
                            )}
                        </section>
                    </>
                ) : (
                    <section className="flex-1 min-w-0 flex flex-col bg-slate-50 dark:bg-slate-950">
                        <header className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
                            <div className="relative">
                                <input
                                    value={newsSearchQuery}
                                    onChange={(event) =>
                                        setNewsSearchQuery(event.target.value)
                                    }
                                    type="search"
                                    placeholder="News suchen"
                                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
                                />
                            </div>
                        </header>

                        <main
                            onScroll={handleNewsScroll}
                            className="flex-1 overflow-y-auto p-4 space-y-4"
                        >
                            {filteredNewsItems.length === 0 ? (
                                <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 text-sm text-slate-500 dark:text-slate-400">
                                    Keine News gefunden.
                                </div>
                            ) : (
                                filteredNewsItems.map((news, index) => {
                                    const newsId = getNewsItemId(news, index);
                                    const newsTitle = getNewsTitle(news);
                                    const newsBody = getNewsBody(news);
                                    const newsImages = extractImageUrls(news);
                                    const visibleImages = newsImages.filter(
                                        (src) => !hiddenImageUrls[src],
                                    );
                                    const isExpanded = Boolean(
                                        expandedNewsIds[newsId],
                                    );
                                    const showExpandToggle =
                                        newsBody.length > 260;

                                    return (
                                        <article
                                            key={newsId}
                                            className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm p-4"
                                        >
                                            <div className="flex flex-wrap items-center gap-2">
                                                <span className="rounded-full bg-blue-100 dark:bg-blue-900/40 px-2 py-0.5 text-xs font-semibold text-blue-700 dark:text-blue-300">
                                                    {getNewsAuthor(news)}
                                                </span>
                                                <span className="rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-xs font-semibold text-slate-600 dark:text-slate-300">
                                                    {getNewsAudience(news)}
                                                </span>
                                            </div>

                                            {getNewsDateTime(news) && (
                                                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                                                    {getNewsDateTime(news)}
                                                </p>
                                            )}

                                            {newsTitle && (
                                                <h3 className="mt-2 text-2xl font-semibold text-slate-900 dark:text-slate-100">
                                                    {newsTitle}
                                                </h3>
                                            )}

                                            {newsBody && (
                                                <div
                                                    className={`mt-3 text-base text-slate-700 dark:text-slate-300 whitespace-pre-wrap ${
                                                        isExpanded
                                                            ? ''
                                                            : 'line-clamp-5'
                                                    }`}
                                                >
                                                    {renderTextWithLinks(
                                                        newsBody,
                                                        'underline decoration-blue-400/70 underline-offset-2 text-blue-700 dark:text-blue-300 hover:text-blue-800 dark:hover:text-blue-200',
                                                    )}
                                                </div>
                                            )}

                                            {showExpandToggle && (
                                                <button
                                                    type="button"
                                                    onClick={() =>
                                                        setExpandedNewsIds(
                                                            (current) => {
                                                                if (
                                                                    current[
                                                                        newsId
                                                                    ]
                                                                ) {
                                                                    const next =
                                                                        {
                                                                            ...current,
                                                                        };
                                                                    delete next[
                                                                        newsId
                                                                    ];
                                                                    return next;
                                                                }
                                                                return {
                                                                    ...current,
                                                                    [newsId]: true,
                                                                };
                                                            },
                                                        )
                                                    }
                                                    className="mt-3 text-sm font-medium text-pink-600 hover:text-pink-700 dark:text-pink-400 dark:hover:text-pink-300"
                                                >
                                                    {isExpanded
                                                        ? 'Weniger'
                                                        : 'Mehr'}
                                                </button>
                                            )}

                                            {visibleImages.length > 0 && (
                                                <div className="mt-4 space-y-2">
                                                    {visibleImages.map(
                                                        (src) => (
                                                            <button
                                                                type="button"
                                                                key={`${newsId}-${src}`}
                                                                onClick={() =>
                                                                    setLightboxImageUrl(
                                                                        src,
                                                                    )
                                                                }
                                                                className="block w-full rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700"
                                                            >
                                                                <img
                                                                    src={src}
                                                                    alt=""
                                                                    loading="lazy"
                                                                    className="w-full h-auto max-h-[560px] object-cover bg-slate-100 dark:bg-slate-800"
                                                                    onError={() => {
                                                                        setHiddenImageUrls(
                                                                            (
                                                                                prev,
                                                                            ) => {
                                                                                if (
                                                                                    prev[
                                                                                        src
                                                                                    ]
                                                                                ) {
                                                                                    return prev;
                                                                                }
                                                                                return {
                                                                                    ...prev,
                                                                                    [src]: true,
                                                                                };
                                                                            },
                                                                        );
                                                                    }}
                                                                />
                                                            </button>
                                                        ),
                                                    )}
                                                </div>
                                            )}
                                        </article>
                                    );
                                })
                            )}

                            {loadingNews && (
                                <div className="flex justify-center py-2">
                                    <div className="h-7 w-7 rounded-full border-2 border-slate-300 border-t-blue-600 animate-spin" />
                                </div>
                            )}
                        </main>
                    </section>
                )}
            </div>

            <SduiMessageInfoModal
                messageInfoTarget={messageInfoTarget}
                loadingMessageReaders={loadingMessageReaders}
                messageInfoError={messageInfoError}
                messageReaders={messageReaders}
                serializedMessageInfo={serializedMessageInfo}
                onClose={() => setMessageInfoTarget(null)}
                getMessageSender={getMessageSender}
                getMessageDateTime={getMessageDateTime}
                getMessageUuid={getMessageUuid}
                getReaderName={getReaderName}
            />

            <SduiDeleteConfirmModal
                isOpen={Boolean(deleteTargetPreview)}
                sender={deleteTargetPreview?.sender || ''}
                messagePreview={deleteTargetPreview?.text || ''}
                isDeleting={
                    Boolean(deleteTargetPreview?.key) &&
                    deletingMessageKey === deleteTargetPreview?.key
                }
                onCancel={() => setDeleteTargetMessage(null)}
                onConfirm={() => {
                    void handleConfirmDeleteMessage();
                }}
            />

            {lightboxImageUrl && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
                    onClick={() => setLightboxImageUrl(null)}
                    role="dialog"
                    aria-modal="true"
                    aria-label="Bildvorschau"
                >
                    <button
                        type="button"
                        className="absolute top-4 right-4 h-10 w-10 rounded-full bg-black/50 text-white hover:bg-black/70 text-2xl leading-none"
                        onClick={() => setLightboxImageUrl(null)}
                        aria-label="Schliessen"
                    >
                        ×
                    </button>
                    <div
                        className="max-w-[95vw] max-h-[90vh]"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <img
                            src={lightboxImageUrl}
                            alt=""
                            className="max-w-[95vw] max-h-[90vh] w-auto h-auto object-contain rounded-lg"
                        />
                    </div>
                </div>
            )}
        </div>
    );
}
