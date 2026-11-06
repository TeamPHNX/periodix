import { extractMessageAttachments } from './sduiAttachmentUtils';
import {
    getMessageKey,
    getMessageSender,
    getMessageTimestamp,
    isDeletedMessage,
    isInfoMessage,
} from './sduiChatUtils';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SduiMessage = any;

export type MessageRenderItem =
    | {
          kind: 'message';
          message: SduiMessage;
          /**
           * Same sender as the message right before it, a few minutes apart:
           * rendered without the sender name and closer to the previous one.
           */
          continuesPrevious: boolean;
      }
    | { kind: 'infoGroup'; key: string; messages: SduiMessage[] };

export interface MessageDaySection {
    key: string;
    /** Local midnight of the day, or 0 for messages without a timestamp. */
    dayStart: number;
    items: MessageRenderItem[];
}

const CONTINUATION_MAX_GAP_MS = 10 * 60 * 1000;

/**
 * System notices without content of their own ("X hat Y zur Gruppe
 * hinzugefügt", "One-Way aktiviert", ...). Shared news keep their own bubble
 * because they carry a news card.
 */
export function isGroupableInfoMessage(message: SduiMessage): boolean {
    if (!isInfoMessage(message) || isDeletedMessage(message)) return false;
    const content =
        typeof message?.content === 'string' ? message.content.trim() : '';
    if (content === 'news.posted') return false;
    if (message?.reply_uuid) return false;
    return extractMessageAttachments(message).length === 0;
}

function getSenderIdentity(message: SduiMessage): string {
    const id = message?.user_id ?? message?.user?.id;
    return id != null ? `id:${id}` : `name:${getMessageSender(message)}`;
}

function continuesPreviousMessage(
    previous: MessageRenderItem | undefined,
    message: SduiMessage,
): boolean {
    if (!previous || previous.kind !== 'message') return false;
    const before = previous.message;
    if (isInfoMessage(before) || isInfoMessage(message)) return false;
    if (getSenderIdentity(before) !== getSenderIdentity(message)) return false;
    const gap = getMessageTimestamp(message) - getMessageTimestamp(before);
    return gap >= 0 && gap <= CONTINUATION_MAX_GAP_MS;
}

/**
 * Collapses runs of two or more consecutive groupable notices into one item
 * and marks follow-up messages from the same sender. The group is keyed by
 * its newest message: older pages are prepended while scrolling up, so the
 * newest member is the one that stays stable.
 */
export function groupMessagesForDisplay(
    messages: SduiMessage[],
): MessageRenderItem[] {
    const items: MessageRenderItem[] = [];
    let run: SduiMessage[] = [];

    const pushMessage = (message: SduiMessage) => {
        items.push({
            kind: 'message',
            message,
            continuesPrevious: continuesPreviousMessage(
                items[items.length - 1],
                message,
            ),
        });
    };

    const flushRun = () => {
        if (run.length >= 2) {
            items.push({
                kind: 'infoGroup',
                key: `info-group-${getMessageKey(run[run.length - 1])}`,
                messages: run,
            });
        } else if (run.length === 1) {
            pushMessage(run[0]);
        }
        run = [];
    };

    for (const message of messages) {
        if (isGroupableInfoMessage(message)) {
            run.push(message);
        } else {
            flushRun();
            pushMessage(message);
        }
    }
    flushRun();

    return items;
}

function getLocalDayStart(timestamp: number): number {
    const date = new Date(timestamp);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
}

/**
 * Splits chronologically sorted messages into calendar days (local time),
 * then groups each day. Notices from different days never share a group.
 * Messages without a timestamp stay with the day before them.
 */
export function buildMessageSections(
    messages: SduiMessage[],
): MessageDaySection[] {
    const days: { dayStart: number; messages: SduiMessage[] }[] = [];

    for (const message of messages) {
        const timestamp = getMessageTimestamp(message);
        const current = days[days.length - 1];
        const dayStart = timestamp
            ? getLocalDayStart(timestamp)
            : (current?.dayStart ?? 0);
        if (current && current.dayStart === dayStart) {
            current.messages.push(message);
        } else {
            days.push({ dayStart, messages: [message] });
        }
    }

    return days.map(({ dayStart, messages: dayMessages }) => ({
        key: `day-${dayStart}`,
        dayStart,
        items: groupMessagesForDisplay(dayMessages),
    }));
}

/** WhatsApp-style day label: Heute, Gestern, weekday, then the date. */
export function formatDayLabel(dayStart: number, now = new Date()): string {
    if (!dayStart) return 'Unbekanntes Datum';
    const today = getLocalDayStart(now.getTime());
    const diffDays = Math.round((today - dayStart) / 86_400_000);
    const date = new Date(dayStart);

    if (diffDays === 0) return 'Heute';
    if (diffDays === 1) return 'Gestern';
    if (diffDays > 1 && diffDays < 7) {
        return date.toLocaleDateString('de-DE', { weekday: 'long' });
    }
    return date.toLocaleDateString('de-DE', {
        weekday: 'short',
        day: 'numeric',
        month: 'long',
        ...(date.getFullYear() !== now.getFullYear()
            ? { year: 'numeric' }
            : {}),
    });
}
