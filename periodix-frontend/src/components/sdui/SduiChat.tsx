import React, {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
} from 'react';

type SduiChatItem = any;
type SduiMessage = any;
type SduiNews = any;

type SduiAttachment = {
    url: string;
    name: string;
    mime: string;
    size: number | null;
    isImage: boolean;
};

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

function normalizeArrayResponse(input: any): any[] {
    if (Array.isArray(input)) return input;
    if (Array.isArray(input?.data)) return input.data;
    return [];
}

function isActionKey(value: string): boolean {
    return /^[a-z_]+(\.[a-z_]+)+$/i.test(value);
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

function normalizeImageUrl(url: string): string {
    if (url.startsWith('/')) return `https://api.sdui.app${url}`;
    if (url.startsWith('//')) return `https:${url}`;
    return url;
}

function getImageFingerprint(url: string): string {
    try {
        const parsed = new URL(url, 'https://api.sdui.app');
        const pathname = parsed.pathname.toLowerCase();

        const uuidMatch = pathname.match(
            /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
        );
        if (uuidMatch?.[0]) {
            return `uuid:${uuidMatch[0].toLowerCase()}`;
        }

        const longIdMatch = pathname.match(/[0-9a-f]{24,}/i);
        if (longIdMatch?.[0]) {
            return `hex:${longIdMatch[0].toLowerCase()}`;
        }

        const baseName = pathname
            .split('/')
            .pop()
            ?.replace(/\.[a-z0-9]+$/i, '')
            .replace(
                /([_-])(small|thumb|thumbnail|preview|large|medium)$/i,
                '',
            );

        return `${parsed.origin}${pathname}|${baseName || ''}`;
    } catch {
        const clean = url.split('?')[0].split('#')[0].toLowerCase();
        return clean.replace(
            /([_-])(small|thumb|thumbnail|preview|large|medium)(\.[a-z0-9]+)?$/i,
            '$3',
        );
    }
}

function addImageUrl(bucket: Map<string, string>, candidate: string): void {
    const normalized = normalizeImageUrl(candidate.trim());
    if (!normalized) return;
    if (/placeholder|blank|dummy/i.test(normalized)) return;
    const fingerprint = getImageFingerprint(normalized);
    if (!bucket.has(fingerprint)) {
        bucket.set(fingerprint, normalized);
    }
}

function extractImageUrls(source: any): string[] {
    const urls = new Map<string, string>();

    const htmlCandidates = [
        source?.content_rendered,
        source?.content,
        source?.text,
        source?.description,
        source?.preview,
    ];

    for (const html of htmlCandidates) {
        if (typeof html !== 'string') continue;
        const regex = /<img[^>]+src=["']([^"']+)["']/gi;
        let match: RegExpExecArray | null;
        while ((match = regex.exec(html)) !== null) {
            if (match[1]) addImageUrl(urls, match[1]);
        }
    }

    const directCandidates = [
        source?.image,
        source?.image_url,
        source?.preview_image,
        source?.meta?.image,
        source?.meta?.image_url,
    ];

    for (const candidate of directCandidates) {
        if (typeof candidate === 'string' && candidate.trim()) {
            addImageUrl(urls, candidate);
        }
    }

    const mediaArrays = [source?.attachments, source?.files, source?.media];
    for (const list of mediaArrays) {
        if (!Array.isArray(list)) continue;
        for (const item of list) {
            const itemUrl =
                item?.url || item?.src || item?.image || item?.preview;
            if (typeof itemUrl === 'string' && itemUrl.trim()) {
                addImageUrl(urls, itemUrl);
            }
        }
    }

    const walk = (node: any, depth = 0) => {
        if (!node || depth > 6) return;

        if (Array.isArray(node)) {
            for (const item of node) walk(item, depth + 1);
            return;
        }

        if (typeof node !== 'object') return;

        const mime =
            typeof node?.mime === 'string'
                ? node.mime
                : typeof node?.mimetype === 'string'
                  ? node.mimetype
                  : '';
        const isImageMime = mime.toLowerCase().startsWith('image/');

        for (const [key, value] of Object.entries(node)) {
            if (typeof value === 'string') {
                const candidate = value.trim();
                if (!candidate) continue;

                const looksLikeImageByKey =
                    /(image|thumbnail|preview|avatar)/i.test(key);
                const looksLikeImageByUrl =
                    /\.(png|jpe?g|gif|webp|avif|svg)(\?|$)/i.test(candidate) ||
                    /\/image(s)?\//i.test(candidate);

                if (isImageMime || looksLikeImageByKey || looksLikeImageByUrl) {
                    addImageUrl(urls, candidate);
                }
            } else if (typeof value === 'object' && value !== null) {
                walk(value, depth + 1);
            }
        }
    };

    walk(source);

    return Array.from(urls.values());
}

function getFileNameFromUrl(url: string): string {
    try {
        const parsed = new URL(url, 'https://api.sdui.app');
        const rawName = parsed.pathname.split('/').pop() || 'Datei';
        return decodeURIComponent(rawName);
    } catch {
        const rawName =
            url.split('?')[0].split('#')[0].split('/').pop() || 'Datei';
        try {
            return decodeURIComponent(rawName);
        } catch {
            return rawName;
        }
    }
}

function isImageFile(mime: string, url: string, name: string): boolean {
    if (mime.toLowerCase().startsWith('image/')) return true;
    const urlValue = `${url}`.toLowerCase();
    if (/\.(png|jpe?g|gif|webp|avif|svg)(\?|$)/i.test(urlValue)) return true;
    return /\.(png|jpe?g|gif|webp|avif|svg)$/i.test(name.trim());
}

function formatFileSize(bytes: number | null): string {
    if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isLikelyAttachmentPath(path: string): boolean {
    return /(^|\.|\[)(attachment|attachments|file|files|upload|uploads|document|documents|chat_attachments?)(\.|\[|$)/i.test(
        path,
    );
}

function isSupportedAttachmentUrl(value: string): boolean {
    const candidate = value.trim();
    if (!candidate) return false;
    if (!/^https?:\/\//i.test(candidate) && !candidate.startsWith('/')) {
        return false;
    }

    const lowered = candidate.toLowerCase();
    if (lowered === '/download' || lowered === 'download') return false;
    return true;
}

function hasFilenameExtension(name: string): boolean {
    return /\.[a-z0-9]{2,8}$/i.test(name.trim());
}

function isGenericDerivedFileName(name: string): boolean {
    const normalized = name.trim().toLowerCase();
    if (!normalized) return true;
    if (normalized === 'download' || normalized === 'datei') return true;
    if (/^[0-9]+$/.test(normalized)) return true;
    if (
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            normalized,
        )
    ) {
        return true;
    }
    return false;
}

function sanitizeAttachmentName(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const normalized = normalizeMessageText(value).trim();
    if (!normalized) return null;
    if (isActionKey(normalized)) return null;
    if (isGenericDerivedFileName(normalized)) return null;
    return normalized;
}

function isUsableAttachmentName(name: string): boolean {
    return sanitizeAttachmentName(name) !== null;
}

function isLikelyDownloadUrl(url: string): boolean {
    const value = url.toLowerCase();
    return (
        /\/download\b/.test(value) ||
        /[?&]download=(true|1)\b/.test(value) ||
        /[?&]disposition=attachment\b/.test(value)
    );
}

function scoreAttachmentUrl(url: string, mime: string): number {
    let score = 0;
    const value = url.toLowerCase();

    if (!isLikelyDownloadUrl(value)) score += 3;
    if (/\.(png|jpe?g|gif|webp|avif|svg)(\?|$)/i.test(value)) score += 2;
    if (/\/(image|images|media)\//i.test(value)) score += 1;
    if (mime.toLowerCase().startsWith('image/')) score += 1;

    return score;
}

function getAttachmentIdentityKey(name: string, size: number | null): string {
    const normalized = sanitizeAttachmentName(name);
    if (!normalized) return '';
    if (!hasFilenameExtension(normalized)) return '';
    return `${normalized.toLowerCase()}|${size ?? 'na'}`;
}

function pickBetterAttachmentName(current: string, incoming: string): string {
    const currentUsable = isUsableAttachmentName(current);
    const incomingUsable = isUsableAttachmentName(incoming);

    if (incomingUsable && !currentUsable) return incoming;
    if (currentUsable && !incomingUsable) return current;
    if (incomingUsable && currentUsable) {
        if (!hasFilenameExtension(current) && hasFilenameExtension(incoming)) {
            return incoming;
        }
        if (incoming.length > current.length) return incoming;
    }
    return current;
}

function getMessageFilenameHint(source: any): string | null {
    const candidates = [source?.content, source?.text, source?.message];
    for (const value of candidates) {
        if (typeof value !== 'string') continue;
        const normalized = normalizeMessageText(value).trim();
        if (!normalized) continue;
        if (normalized.length > 200) continue;
        if (/[\n\r]/.test(normalized)) continue;
        if (hasFilenameExtension(normalized)) return normalized;
    }
    return null;
}

function extractMessageAttachments(source: any): SduiAttachment[] {
    const bucket = new Map<string, SduiAttachment>();
    const identityToFingerprint = new Map<string, string>();
    const messageFilenameHint = getMessageFilenameHint(source);

    const addAttachment = (node: any, hintKey = '') => {
        if (!node || typeof node !== 'object') return;

        const keyHint = String(hintKey || '').toLowerCase();
        const attachmentPathHint = isLikelyAttachmentPath(keyHint);

        const urlCandidate = [
            node?.url,
            node?.download_url,
            node?.downloadUrl,
            node?.file_url,
            node?.fileUrl,
            node?.src,
            node?.uri,
        ].find((value) => typeof value === 'string' && value.trim());

        if (!urlCandidate) return;
        if (!isSupportedAttachmentUrl(String(urlCandidate))) return;

        const url = normalizeImageUrl(String(urlCandidate).trim());
        if (!url) return;

        const mime = String(
            node?.mime || node?.mimetype || node?.content_type || '',
        ).trim();

        const contextualNameCandidates = attachmentPathHint
            ? [node?.title, node?.meta?.title, node?.meta?.displayname]
            : [];

        const explicitNameCandidate = [
            node?.name,
            node?.filename,
            node?.file_name,
            node?.original_name,
            node?.originalName,
            ...contextualNameCandidates,
        ]
            .map(sanitizeAttachmentName)
            .find((value) => Boolean(value));

        const metadataNameCandidate = [
            node?.meta?.filename,
            node?.meta?.file_name,
            node?.meta?.original_name,
            node?.meta?.originalName,
            messageFilenameHint,
        ]
            .map(sanitizeAttachmentName)
            .find((value) => Boolean(value));

        const fallbackNameFromUrl = getFileNameFromUrl(url);
        const safeNameFromUrl =
            sanitizeAttachmentName(fallbackNameFromUrl) || fallbackNameFromUrl;

        const name =
            explicitNameCandidate || metadataNameCandidate || safeNameFromUrl;

        const rawSize =
            node?.size ?? node?.filesize ?? node?.file_size ?? node?.byte_size;
        const parsedSize =
            typeof rawSize === 'number'
                ? rawSize
                : Number.parseInt(String(rawSize ?? ''), 10);
        const size = Number.isFinite(parsedSize) ? parsedSize : null;

        const typeHint = String(
            node?.type || node?.kind || node?.resource_type || '',
        ).toLowerCase();
        const hasAttachmentTypeHint = /(file|attachment|upload|document)/i.test(
            typeHint,
        );
        const hasExplicitName = Boolean(explicitNameCandidate);
        const hasMime = mime.length > 0;
        const hasFileSize = size !== null;

        const isClearlyAttachment =
            attachmentPathHint || hasAttachmentTypeHint || hasExplicitName;
        if (!isClearlyAttachment) return;

        const hasStrongFileIdentity =
            hasExplicitName ||
            hasMime ||
            hasFileSize ||
            hasFilenameExtension(name) ||
            hasFilenameExtension(fallbackNameFromUrl);
        if (!hasStrongFileIdentity) return;

        if (!hasExplicitName && isGenericDerivedFileName(name)) {
            return;
        }

        const attachment: SduiAttachment = {
            url,
            name,
            mime,
            size,
            isImage: isImageFile(mime, url, name),
        };

        const fingerprint = getImageFingerprint(url);
        const identityKey = getAttachmentIdentityKey(name, size);
        const mappedFingerprint = identityKey
            ? identityToFingerprint.get(identityKey)
            : undefined;
        const dedupeKey = mappedFingerprint || fingerprint;

        const existing = bucket.get(dedupeKey);
        if (!existing) {
            bucket.set(dedupeKey, attachment);
            if (identityKey) {
                identityToFingerprint.set(identityKey, dedupeKey);
            }
            return;
        }

        const existingScore = scoreAttachmentUrl(existing.url, existing.mime);
        const incomingScore = scoreAttachmentUrl(
            attachment.url,
            attachment.mime,
        );
        const preferredUrl =
            incomingScore > existingScore ? attachment.url : existing.url;

        bucket.set(dedupeKey, {
            ...existing,
            url: preferredUrl,
            name: pickBetterAttachmentName(existing.name, attachment.name),
            mime: existing.mime || attachment.mime,
            size: existing.size ?? attachment.size,
            isImage: existing.isImage || attachment.isImage,
        });

        if (identityKey) {
            identityToFingerprint.set(identityKey, dedupeKey);
        }
    };

    if (typeof source?.file === 'string' && source.file.trim()) {
        addAttachment(
            {
                url: source.file,
                name: source?.file_name || source?.filename,
                mime: source?.mime || source?.mimetype,
            },
            'file',
        );
    }

    const walk = (node: any, path = 'root', depth = 0) => {
        if (!node || depth > 7) return;

        if (Array.isArray(node)) {
            for (const [index, item] of node.entries()) {
                walk(item, `${path}[${index}]`, depth + 1);
            }
            return;
        }

        if (typeof node !== 'object') return;

        addAttachment(node, path);

        for (const [key, value] of Object.entries(node)) {
            if (value && typeof value === 'object') {
                walk(value, `${path}.${key}`, depth + 1);
            }
        }
    };

    walk(source);
    return Array.from(bucket.values());
}

function getChatName(chat: SduiChatItem): string {
    if (chat?.meta?.displayname) return chat.meta.displayname;
    if (chat?.name === 'channels.conversation.name') return 'Privater Chat';
    return chat?.name || 'Unbekannter Chat';
}

function getChatPreview(chat: SduiChatItem): string {
    return chat?.meta?.description || 'Keine neuen Nachrichten';
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

function getMessageText(
    message: SduiMessage,
    linkedNews: SduiNews | null,
): string {
    const formatActionMessage = (actionKey: string): string => {
        if (actionKey === 'news.posted' && linkedNews) {
            const newsBody = getNewsBody(linkedNews);
            if (newsBody) return newsBody;
        }

        if (ACTION_MESSAGE_MAP[actionKey]) {
            return ACTION_MESSAGE_MAP[actionKey];
        }

        const humanized = actionKey
            .split('.')
            .map((part: string) => part.replace(/_/g, ' '))
            .join(' - ');

        return `Systemaktion: ${humanized}`;
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

    const [draft, setDraft] = useState<string>('');
    const [sending, setSending] = useState<boolean>(false);

    const messagesEndRef = useRef<HTMLDivElement | null>(null);
    const messagesContainerRef = useRef<HTMLDivElement | null>(null);
    const messagesRef = useRef<SduiMessage[]>([]);
    const loadingOlderRef = useRef<boolean>(false);
    const loadingNewsRef = useRef<boolean>(false);
    const hasMoreNewsRef = useRef<boolean>(true);

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

    const scrollToBottom = () => {
        requestAnimationFrame(() => {
            messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        });
    };

    React.useEffect(() => {
        messagesRef.current = messages;
    }, [messages]);

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
                    scrollToBottom();
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
        [ensureNewsForMessages],
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
        setSelectedChat(chat);
        setSelectedChatDetails(null);
        setMessages([]);
        setMessageError(null);
        setDraft('');
        setMessagePage(1);
        setHasMoreMessages(true);
        setLoadingOlderMessages(false);
        await Promise.all([
            loadMessagesPage(chat, 1, 'replace', true),
            loadChatDetails(chat),
        ]);
    };

    const handleMessagesScroll = async (
        event: React.UIEvent<HTMLDivElement>,
    ) => {
        if (
            !selectedChat ||
            loadingMessages ||
            loadingOlderMessages ||
            !hasMoreMessages ||
            loadingOlderRef.current
        ) {
            return;
        }

        const element = event.currentTarget;
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

    const handleSendMessage = async (e: React.FormEvent) => {
        e.preventDefault();
        const content = draft.trim();
        if (!selectedChatId || !content || !canWriteInSelectedChat) return;

        setSending(true);
        setMessageError(null);

        try {
            const token = localStorage.getItem('token');
            const res = await fetch(
                `/api/sdui/chats/${encodeURIComponent(selectedChatId)}/messages`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${token}`,
                    },
                    body: JSON.stringify({ text: content }),
                },
            );

            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(
                    err?.error || 'Nachricht konnte nicht gesendet werden.',
                );
            }

            setDraft('');
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

    return (
        <div className="h-full w-full flex bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100">
            <aside
                className={`
                    ${selectedChat ? 'hidden md:flex' : 'flex'}
                    w-full md:w-[340px] lg:w-[380px] shrink-0 flex-col
                    border-r border-slate-200 dark:border-slate-800
                `}
            >
                <div className="flex-1 overflow-y-auto p-2 space-y-2">
                    {errorMsg && (
                        <div className="rounded-md border border-red-200 bg-red-50 text-red-700 px-3 py-2 text-sm">
                            {errorMsg}
                        </div>
                    )}

                    {chats.length === 0 ? (
                        <div className="p-4 rounded-md border text-blue-800 border-blue-200 bg-blue-50 dark:bg-blue-950 dark:text-blue-200 dark:border-blue-900">
                            <p className="text-sm">Keine Chats gefunden.</p>
                        </div>
                    ) : (
                        chats.map((chat, index) => {
                            const active = selectedChat?.id === chat?.id;
                            const unread = Boolean(chat?.meta?.is_unread);

                            return (
                                <button
                                    key={chat?.id || index}
                                    onClick={() => handleSelectChat(chat)}
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
                                        <h3 className="font-semibold text-sm line-clamp-1">
                                            {getChatName(chat)}
                                        </h3>
                                        <span className="text-[10px] text-slate-400 dark:text-slate-500 shrink-0">
                                            {getChatTimestamp(chat)}
                                        </span>
                                    </div>
                                    <p className="text-xs mt-1 text-slate-500 dark:text-slate-400 line-clamp-2">
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
                                    Keine Nachrichten in diesem Chat.
                                </div>
                            ) : (
                                messages.map((message) => {
                                    const actionKey =
                                        typeof message?.content === 'string'
                                            ? message.content.trim()
                                            : '';
                                    const info = isInfoMessage(message);
                                    const linkedNews = getLinkedNews(
                                        message,
                                        newsById,
                                    );
                                    const messageText = getMessageText(
                                        message,
                                        linkedNews,
                                    );
                                    const newsTitle = getNewsTitle(linkedNews);
                                    const newsBody = getNewsBody(linkedNews);
                                    const newsImages = extractImageUrls([
                                        linkedNews,
                                        message,
                                    ]);
                                    const visibleNewsImages = newsImages.filter(
                                        (src) => !hiddenImageUrls[src],
                                    );
                                    const singleNewsImage =
                                        visibleNewsImages.length === 1;
                                    const messageAttachments =
                                        extractMessageAttachments(message);
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
                                            (attachment) => !attachment.isImage,
                                        );
                                    const singleAttachmentImage =
                                        visibleImageAttachments.length === 1;

                                    return (
                                        <div
                                            key={getMessageKey(message)}
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
                                                    {getMessageSender(message)}
                                                </span>
                                                <span className="text-[10px] text-slate-400 dark:text-slate-500">
                                                    {getMessageTime(message)}
                                                </span>
                                            </div>

                                            <div
                                                className={`text-sm whitespace-pre-wrap wrap-break-word ${
                                                    info
                                                        ? 'text-amber-900 dark:text-amber-100'
                                                        : 'text-slate-800 dark:text-slate-200'
                                                }`}
                                            >
                                                {messageText}
                                            </div>

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
                                                        (attachment) => (
                                                            <div
                                                                key={`${getMessageKey(message)}-${attachment.url}`}
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
                                                                    {
                                                                        attachment.name
                                                                    }
                                                                </a>
                                                            </div>
                                                        ),
                                                    )}
                                                </div>
                                            )}

                                            {fileAttachments.length > 0 && (
                                                <div className="mt-2 space-y-1">
                                                    {fileAttachments.map(
                                                        (attachment) => (
                                                            <a
                                                                key={`${getMessageKey(message)}-${attachment.url}`}
                                                                href={
                                                                    attachment.url
                                                                }
                                                                target="_blank"
                                                                rel="noreferrer"
                                                                download={
                                                                    attachment.name
                                                                }
                                                                className="flex items-center justify-between gap-2 rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 px-2 py-1.5 hover:bg-slate-100 dark:hover:bg-slate-800"
                                                            >
                                                                <span
                                                                    className="text-xs text-slate-700 dark:text-slate-200 truncate"
                                                                    title={
                                                                        attachment.name
                                                                    }
                                                                >
                                                                    {
                                                                        attachment.name
                                                                    }
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

                                            {actionKey === 'news.posted' &&
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
                                                                {newsTitle}
                                                            </div>
                                                        )}
                                                        {newsBody && (
                                                            <div className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap wrap-break-word">
                                                                {newsBody}
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
                                                                    (src) => (
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
                                        ? 'Dieser Chat steht aktuell auf "One-Way". Nur Administratoren duerfen schreiben oder eine Konversation eroeffnen.'
                                        : 'Du hast in diesem Chat keine Schreibrechte.'}
                                </div>
                            )}
                            <form
                                onSubmit={handleSendMessage}
                                className="flex gap-2"
                            >
                                <input
                                    type="text"
                                    value={draft}
                                    onChange={(e) => setDraft(e.target.value)}
                                    placeholder={
                                        canWriteInSelectedChat
                                            ? 'Nachricht schreiben...'
                                            : oneWayDetected
                                              ? 'One-Way Chat: Schreiben ist nur fuer Administratoren erlaubt.'
                                              : 'Schreiben in diesem Chat nicht erlaubt.'
                                    }
                                    disabled={!canWriteInSelectedChat}
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
                                    Senden
                                </button>
                            </form>
                        </footer>
                    </>
                )}
            </section>

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
