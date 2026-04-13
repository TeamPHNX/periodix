/* eslint-disable @typescript-eslint/no-explicit-any */

export type SduiAttachment = {
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

const ACTION_KEY_PREFIXES = [
    'news.',
    'users.',
    'channel.',
    'chat.',
    'message.',
    'member.',
    'conversation.',
];

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

export function extractImageUrls(source: any): string[] {
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

export function formatFileSize(bytes: number | null): string {
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

export function extractMessageAttachments(source: any): SduiAttachment[] {
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

export function looksLikeAttachmentPathText(text: string): boolean {
    const normalized = text.trim();
    if (!normalized) return false;

    const lowered = normalized.toLowerCase();
    const hasFileExt =
        /\.(png|jpe?g|gif|webp|avif|svg|pdf|docx?|xlsx?|pptx?|txt|zip)(\?|#|$)/i.test(
            lowered,
        );
    const hasUrlishSignals =
        lowered.includes('http') ||
        lowered.includes('www.') ||
        lowered.includes('fileadmin') ||
        lowered.includes('upload') ||
        lowered.includes('download');
    const hasWhitespace = /\s/.test(normalized);

    if (hasFileExt && (hasUrlishSignals || !hasWhitespace)) return true;
    if (!hasWhitespace && normalized.length > 40 && /[._/-]/.test(normalized)) {
        return true;
    }

    return false;
}

export function getAttachmentDisplayName(attachment: SduiAttachment): string {
    const raw = String(attachment?.name || '').trim();
    const fallback = attachment.isImage ? 'Bilddatei' : 'Anhang';
    if (!raw) return fallback;

    const lowered = raw.toLowerCase();
    const looksLikePathNoise =
        !/\s/.test(raw) &&
        raw.length > 70 &&
        (lowered.includes('http') ||
            lowered.includes('www.') ||
            lowered.includes('fileadmin') ||
            lowered.includes('upload'));

    if (looksLikePathNoise) {
        const extension = raw.match(
            /\.(png|jpe?g|gif|webp|avif|svg|pdf|docx?|xlsx?|pptx?|txt|zip)(\?|#|$)/i,
        )?.[1];
        return extension ? `Anhang (${extension.toUpperCase()})` : fallback;
    }

    return raw;
}
