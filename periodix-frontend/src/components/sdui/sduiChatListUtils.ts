/* eslint-disable @typescript-eslint/no-explicit-any */
import { firstBooleanLike } from './sduiChatPermissionUtils';
import { getChatName, getMessageChatId } from './sduiChatUtils';

type SduiChatItem = any;

// Observed SDUI chat-list fields (GET /v1/users/{id}/channels/chats),
// checked against the official app's badges:
//   meta.last_unread_count unread message count (what the official app shows)
//   meta.is_unread         "marked as unread" flag, true without a count
//   meta.is_pinned         pinned in SDUI (ignored: Periodix keeps its own pins)
//   meta.subtitle          sender of the latest message
//   meta.shortcut          two-letter initials, pivot.color hex colour
//   is_twoway              false = only admins can write (one-way chat)

function getRawUnreadCount(chat: SduiChatItem): number {
    for (const value of [chat?.meta?.last_unread_count, chat?.meta?.unread_count]) {
        const count = Number(value);
        if (value != null && Number.isFinite(count) && count > 0) {
            return Math.floor(count);
        }
    }
    return 0;
}

function isMarkedUnread(chat: SduiChatItem): boolean {
    return (
        firstBooleanLike([chat?.meta?.is_unread, chat?.meta?.isUnread]) ?? false
    );
}

export function isChatUnread(chat: SduiChatItem): boolean {
    return getRawUnreadCount(chat) > 0 || isMarkedUnread(chat);
}

/** Unread message count; 1 for a chat that is only marked as unread. */
export function getChatUnreadCount(chat: SduiChatItem): number {
    const count = getRawUnreadCount(chat);
    if (count > 0) return count;
    return isMarkedUnread(chat) ? 1 : 0;
}

export function isOneWayChat(chat: SduiChatItem): boolean {
    return chat?.is_twoway === false;
}

/** Copy of the chat with its unread state cleared (optimistic mark-as-read). */
export function withChatMarkedRead(chat: SduiChatItem): SduiChatItem {
    return {
        ...chat,
        meta: {
            ...(chat?.meta ?? {}),
            is_unread: false,
            last_unread_count: 0,
        },
    };
}

export function getChatActivityTimestamp(chat: SduiChatItem): number {
    const raw =
        chat?.activity_at ||
        chat?.meta?.activity_at ||
        chat?.chat?.activity_at ||
        chat?.updated_at;
    if (!raw) return 0;
    const time = new Date(raw).getTime();
    return Number.isNaN(time) ? 0 : time;
}

/** Compact list time: "14:32", "Gestern", "Mo", or "03.11.25". */
export function formatChatListTime(
    chat: SduiChatItem,
    now: Date = new Date(),
): string {
    const timestamp = getChatActivityTimestamp(chat);
    if (!timestamp) return '';

    const date = new Date(timestamp);
    const startOfDay = (value: Date) =>
        new Date(value.getFullYear(), value.getMonth(), value.getDate());
    const dayDiff = Math.round(
        (startOfDay(now).getTime() - startOfDay(date).getTime()) / 86_400_000,
    );

    if (dayDiff <= 0) {
        return date.toLocaleTimeString('de-DE', {
            hour: '2-digit',
            minute: '2-digit',
        });
    }
    if (dayDiff === 1) return 'Gestern';
    if (dayDiff < 7) {
        return date.toLocaleDateString('de-DE', { weekday: 'short' });
    }
    return date.toLocaleDateString('de-DE', {
        day: '2-digit',
        month: '2-digit',
        year: '2-digit',
    });
}

export function getChatAvatarUrl(chat: SduiChatItem): string | null {
    for (const candidate of [chat?.avatar, chat?.meta?.avatar_url, chat?.icon]) {
        const url =
            typeof candidate === 'string'
                ? candidate
                : typeof candidate?.url === 'string'
                  ? candidate.url
                  : '';
        if (/^https?:\/\//i.test(url.trim())) return url.trim();
    }
    return null;
}

export function getChatInitials(chat: SduiChatItem): string {
    const shortcut =
        typeof chat?.meta?.shortcut === 'string' ? chat.meta.shortcut.trim() : '';
    if (shortcut) return shortcut.slice(0, 2).toUpperCase();

    const words = getChatName(chat)
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .split(/\s+/)
        .filter(Boolean);
    if (words.length === 0) return '?';
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return (words[0][0] + words[1][0]).toUpperCase();
}

/** The chat colour SDUI assigned (pivot.color, hex without '#'), if any. */
export function getChatColor(chat: SduiChatItem): string | null {
    const raw = String(chat?.pivot?.color ?? chat?.color ?? '')
        .trim()
        .replace(/^#/, '');
    return /^[0-9a-f]{6}$/i.test(raw) ? `#${raw}` : null;
}

/** Stable hue (0-359) per chat so avatars keep their colour between loads. */
export function getChatHue(chat: SduiChatItem): number {
    const seed = getMessageChatId(chat) || getChatName(chat);
    let hash = 0;
    for (let i = 0; i < seed.length; i += 1) {
        hash = (hash * 31 + seed.charCodeAt(i)) | 0;
    }
    // Golden-angle step spreads neighbouring ids (e.g. 3, 4, 5) across the wheel.
    return Math.round(Math.abs(hash) * 137.508) % 360;
}

const LOCAL_PINS_KEY = 'periodix.sdui.pinnedChats';

export function readLocalPinnedChatIds(): string[] {
    try {
        const raw = localStorage.getItem(LOCAL_PINS_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed)
            ? parsed.filter((id): id is string => typeof id === 'string')
            : [];
    } catch {
        return [];
    }
}

export function writeLocalPinnedChatIds(ids: string[]): void {
    try {
        localStorage.setItem(LOCAL_PINS_KEY, JSON.stringify(ids));
    } catch {
        // Storage unavailable (private mode etc.): pins just won't persist.
    }
}

/** Merge a fresh first page of chats into the full list, newest activity first. */
export function mergeChatLists(
    existing: SduiChatItem[],
    fresh: SduiChatItem[],
): SduiChatItem[] {
    const byId = new Map<string, SduiChatItem>();
    for (const chat of existing) byId.set(getMessageChatId(chat), chat);
    for (const chat of fresh) byId.set(getMessageChatId(chat), chat);
    return Array.from(byId.values()).sort(
        (a, b) => getChatActivityTimestamp(b) - getChatActivityTimestamp(a),
    );
}
