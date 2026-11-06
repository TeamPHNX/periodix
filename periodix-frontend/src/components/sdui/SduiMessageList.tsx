/* eslint-disable @typescript-eslint/no-explicit-any */
import { memo, useCallback } from 'react';
import { SduiMessageActionsMenu } from './SduiMessageActionsMenu';
import { SduiRawJsonBlock } from './SduiDevTools';
import { SduiChatImage } from './SduiChatImage';
import {
    extractImageUrls,
    extractMessageAttachments,
    formatFileSize,
    getAttachmentDisplayName,
    getImageDedupeKey,
    looksLikeAttachmentPathText,
} from './sduiAttachmentUtils';
import { renderTextWithLinks } from './sduiLinkText';
import {
    getMessageDateTime,
    getMessageDeletePermission,
    getMessageInfoPermission,
    getMessageKey,
    getMessageSender,
    getMessageText,
    getMessageTime,
    getMessageUuid,
    getNewsBody,
    getNewsTitle,
    getReplyPreviewForMessage,
    isDeletedMessage,
    isInfoMessage,
    shouldHideDuplicateAttachmentText,
} from './sduiChatUtils';
import { formatDayLabel, type MessageDaySection } from './sduiMessageGrouping';

type SduiMessage = any;
type SduiNews = any;
type ReplyPreview = ReturnType<typeof getReplyPreviewForMessage>;

/**
 * Everything the list can ask the chat to do. Built once with stable
 * callbacks so memoized bubbles don't re-render while the user types.
 */
export interface SduiMessageActions {
    toggleMenu: (messageKey: string) => void;
    reply: (message: SduiMessage) => void;
    copy: (message: SduiMessage) => void;
    info: (message: SduiMessage) => void;
    requestDelete: (message: SduiMessage) => void;
    jumpToMessage: (messageUuid: string) => void;
    openImage: (url: string, previewUrl?: string) => void;
    hideImage: (url: string) => void;
    registerElement: (messageKey: string, element: HTMLElement | null) => void;
    toggleInfoGroup: (groupKey: string, anchor: HTMLElement) => void;
}

const INFO_LINK_CLASS =
    'underline decoration-amber-400/80 underline-offset-2 text-amber-800 dark:text-amber-200 hover:text-amber-900 dark:hover:text-amber-100';
const MESSAGE_LINK_CLASS =
    'underline decoration-blue-400/80 underline-offset-2 text-blue-700 dark:text-blue-300 hover:text-blue-800 dark:hover:text-blue-200';
const NEWS_LINK_CLASS =
    'underline decoration-blue-400/70 underline-offset-2 text-blue-700 dark:text-blue-300 hover:text-blue-800 dark:hover:text-blue-200';

const INFO_GROUP_VISIBLE_ROWS = 3;

function useRegisterElement(messageKey: string, actions: SduiMessageActions) {
    return useCallback(
        (element: HTMLElement | null) =>
            actions.registerElement(messageKey, element),
        [actions, messageKey],
    );
}

// ---------------------------------------------------------------------------
// "⋯" menu of one message

interface MessageMenuProps {
    message: SduiMessage;
    info: boolean;
    canCopy: boolean;
    canWriteInChat: boolean;
    isOpen: boolean;
    isCopied: boolean;
    isDeleting: boolean;
    actions: SduiMessageActions;
}

function MessageMenu({
    message,
    info,
    canCopy,
    canWriteInChat,
    isOpen,
    isCopied,
    isDeleting,
    actions,
}: MessageMenuProps) {
    const messageKey = getMessageKey(message);
    const messageUuid = getMessageUuid(message);
    const messageIsDeleted = isDeletedMessage(message);
    const canReplyToMessage =
        canWriteInChat && !info && !messageIsDeleted && Boolean(messageUuid);
    const canDeleteMessage =
        !messageIsDeleted &&
        getMessageDeletePermission(message, canWriteInChat) &&
        Boolean(messageUuid);
    const canViewMessageInfo =
        getMessageInfoPermission(message) && Boolean(messageUuid);
    const canCopyMessage = !messageIsDeleted && canCopy;

    return (
        <SduiMessageActionsMenu
            hasMenuActions={
                canReplyToMessage ||
                canCopyMessage ||
                canViewMessageInfo ||
                canDeleteMessage
            }
            isOpen={isOpen}
            canReplyToMessage={canReplyToMessage}
            canCopyMessage={canCopyMessage}
            canViewMessageInfo={canViewMessageInfo}
            canDeleteMessage={canDeleteMessage}
            isCopiedThisMessage={isCopied}
            isDeletingThisMessage={isDeleting}
            onToggle={(event) => {
                event.stopPropagation();
                actions.toggleMenu(messageKey);
            }}
            onReply={() => actions.reply(message)}
            onCopy={() => actions.copy(message)}
            onInfo={() => actions.info(message)}
            onDelete={() => actions.requestDelete(message)}
        />
    );
}

// ---------------------------------------------------------------------------
// One message bubble

interface MessageBubbleProps {
    message: SduiMessage;
    linkedNews: SduiNews | null;
    replyPreview: ReplyPreview;
    hiddenImageUrls: Record<string, boolean>;
    continuesPrevious: boolean;
    spacingClass: string;
    canWriteInChat: boolean;
    isMenuOpen: boolean;
    isCopied: boolean;
    isDeleting: boolean;
    isHighlighted: boolean;
    devMode: boolean;
    actions: SduiMessageActions;
}

const MessageBubble = memo(function MessageBubble({
    message,
    linkedNews,
    replyPreview,
    hiddenImageUrls,
    continuesPrevious,
    spacingClass,
    canWriteInChat,
    isMenuOpen,
    isCopied,
    isDeleting,
    isHighlighted,
    devMode,
    actions,
}: MessageBubbleProps) {
    const messageKey = getMessageKey(message);
    const registerElement = useRegisterElement(messageKey, actions);
    const actionKey =
        typeof message?.content === 'string' ? message.content.trim() : '';
    const info = isInfoMessage(message);
    const messageText = getMessageText(message, linkedNews);
    const newsTitle = getNewsTitle(linkedNews);
    const newsBody = getNewsBody(linkedNews);
    const newsImages = extractImageUrls(linkedNews);
    const newsImageKeys = new Set(
        newsImages.map((src) => getImageDedupeKey(src)),
    );
    const messageAttachments = extractMessageAttachments(message);
    const visibleImageAttachments = messageAttachments.filter((attachment) => {
        if (!attachment.isImage) return false;
        if (hiddenImageUrls[attachment.url]) return false;
        if (actionKey !== 'news.posted') return true;
        return !newsImageKeys.has(getImageDedupeKey(attachment.url));
    });
    const visibleNewsImages = newsImages.filter(
        (src) => !hiddenImageUrls[src],
    );
    const singleNewsImage = visibleNewsImages.length === 1;
    const fileAttachments = messageAttachments.filter(
        (attachment) => !attachment.isImage,
    );
    const singleAttachmentImage = visibleImageAttachments.length === 1;
    const messageIsDeleted = isDeletedMessage(message);
    const hideAttachmentLikeMessageText =
        (visibleImageAttachments.length > 0 || fileAttachments.length > 0) &&
        (looksLikeAttachmentPathText(messageText) ||
            shouldHideDuplicateAttachmentText(messageText, fileAttachments));
    const showMessageText =
        Boolean(messageText) && !hideAttachmentLikeMessageText;
    const canJumpToReplyReference = Boolean(replyPreview?.uuid);
    const linkClassName = info ? INFO_LINK_CLASS : MESSAGE_LINK_CLASS;

    const timeAndMenu = (
        <>
            <span
                className="text-[10px] text-slate-400 dark:text-slate-500"
                title={getMessageDateTime(message)}
            >
                {getMessageTime(message)}
            </span>
            <MessageMenu
                message={message}
                info={info}
                canCopy={showMessageText}
                canWriteInChat={canWriteInChat}
                isOpen={isMenuOpen}
                isCopied={isCopied}
                isDeleting={isDeleting}
                actions={actions}
            />
        </>
    );

    return (
        <div
            ref={registerElement}
            className={`${spacingClass} flow-root max-w-[90%] rounded-2xl border px-3 py-2 transition-all duration-300 ${
                info
                    ? 'border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20'
                    : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800'
            } ${
                isHighlighted
                    ? 'ring-2 ring-sky-400/90 dark:ring-sky-500/90 shadow-[0_0_0_4px_rgba(14,165,233,0.16)]'
                    : ''
            }`}
        >
            {continuesPrevious ? (
                // Follow-up from the same sender: no name, time and menu float
                // right so short texts stay on one line.
                <div className="float-right ml-3 -mr-1 -mt-0.5 flex items-center gap-1">
                    {timeAndMenu}
                </div>
            ) : (
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
                    <div className="flex items-center gap-1">{timeAndMenu}</div>
                </div>
            )}

            {replyPreview && (
                <button
                    type="button"
                    onClick={() => {
                        if (replyPreview.uuid) {
                            actions.jumpToMessage(replyPreview.uuid);
                        }
                    }}
                    disabled={!canJumpToReplyReference}
                    className={`clear-right mb-2 w-full rounded-xl border border-slate-200/90 dark:border-slate-700/80 bg-linear-to-br from-slate-50 via-slate-50 to-indigo-50/60 dark:from-slate-900/70 dark:via-slate-900/65 dark:to-indigo-950/20 px-2.5 py-1.5 text-left transition ${
                        canJumpToReplyReference
                            ? 'cursor-pointer hover:border-slate-300 dark:hover:border-slate-600 hover:from-slate-100 hover:to-indigo-100/60 dark:hover:from-slate-800/80 dark:hover:to-indigo-900/30'
                            : 'cursor-default'
                    }`}
                >
                    <div className="text-[10px] font-semibold text-slate-600 dark:text-slate-300">
                        Antwort auf {replyPreview.sender}
                        {replyPreview.time ? ` • ${replyPreview.time}` : ''}
                        {canJumpToReplyReference ? ' • Zum Original' : ''}
                    </div>
                    <div className="mt-0.5 text-xs text-slate-700 dark:text-slate-200 line-clamp-2">
                        {replyPreview.text || 'Nachricht'}
                    </div>
                </button>
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
                    {renderTextWithLinks(messageText, linkClassName)}
                </div>
            )}

            {visibleImageAttachments.length > 0 && (
                <div
                    className={`clear-right mt-2 ${
                        singleAttachmentImage
                            ? ''
                            : 'grid grid-cols-1 sm:grid-cols-2 gap-2'
                    }`}
                >
                    {visibleImageAttachments.map((attachment) => (
                        <div
                            key={`${messageKey}-${attachment.url}`}
                            className={`rounded-md overflow-hidden border border-slate-200/80 dark:border-slate-700/70 bg-slate-50 dark:bg-slate-900/50 ${
                                singleAttachmentImage ? 'w-full' : ''
                            }`}
                        >
                            <button
                                type="button"
                                onClick={() =>
                                    actions.openImage(
                                        attachment.url,
                                        attachment.previewUrl,
                                    )
                                }
                                className="block w-full"
                            >
                                <SduiChatImage
                                    src={attachment.url}
                                    previewSrc={attachment.previewUrl}
                                    alt={attachment.name}
                                    fit={
                                        singleAttachmentImage
                                            ? 'contain'
                                            : 'cover'
                                    }
                                    onError={() =>
                                        actions.hideImage(attachment.url)
                                    }
                                />
                            </button>
                            <a
                                href={attachment.url}
                                target="_blank"
                                rel="noreferrer"
                                download={attachment.name}
                                className="block px-2 py-1 text-xs text-blue-700 dark:text-blue-300 hover:underline truncate"
                                title={attachment.name}
                            >
                                {getAttachmentDisplayName(attachment)}
                            </a>
                        </div>
                    ))}
                </div>
            )}

            {fileAttachments.length > 0 && (
                <div className="clear-right mt-2 space-y-1">
                    {fileAttachments.map((attachment) => (
                        <a
                            key={`${messageKey}-${attachment.url}`}
                            href={attachment.url}
                            target="_blank"
                            rel="noreferrer"
                            download={attachment.name}
                            className="flex min-w-0 items-center justify-between gap-2 rounded-lg border border-emerald-200/80 dark:border-emerald-800/70 bg-linear-to-r from-emerald-50 to-cyan-50 dark:from-emerald-950/30 dark:to-cyan-950/25 px-2.5 py-2 transition hover:from-emerald-100 hover:to-cyan-100 dark:hover:from-emerald-900/35 dark:hover:to-cyan-900/35"
                        >
                            <div className="min-w-0 flex items-center gap-2">
                                <span className="shrink-0 flex h-5 w-5 items-center justify-center rounded-md bg-emerald-600 text-white">
                                    <svg
                                        className="h-3 w-3"
                                        viewBox="0 0 20 20"
                                        fill="currentColor"
                                        aria-hidden="true"
                                    >
                                        <path d="M10 2a.75.75 0 01.75.75v7.19l1.72-1.72a.75.75 0 111.06 1.06l-3 3a.75.75 0 01-1.06 0l-3-3a.75.75 0 011.06-1.06l1.72 1.72V2.75A.75.75 0 0110 2z" />
                                        <path d="M4.5 13.25a.75.75 0 00-1.5 0V15A2.5 2.5 0 005.5 17.5h9A2.5 2.5 0 0017 15v-1.75a.75.75 0 00-1.5 0V15a1 1 0 01-1 1h-9a1 1 0 01-1-1v-1.75z" />
                                    </svg>
                                </span>
                                <span
                                    className="min-w-0 text-xs font-medium text-emerald-900 dark:text-emerald-100 truncate"
                                    title={attachment.name}
                                >
                                    {getAttachmentDisplayName(attachment)}
                                </span>
                            </div>
                            <span className="text-[10px] font-semibold text-cyan-700 dark:text-cyan-300 shrink-0">
                                {formatFileSize(attachment.size) || 'Download'}
                            </span>
                        </a>
                    ))}
                </div>
            )}

            {actionKey === 'news.posted' &&
                (newsTitle || newsBody || visibleNewsImages.length > 0) && (
                    <div className="clear-right mt-2 rounded-lg border border-amber-300/60 dark:border-amber-700/60 bg-white/70 dark:bg-slate-900/40 p-2">
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
                                {renderTextWithLinks(newsBody, NEWS_LINK_CLASS)}
                            </div>
                        )}
                        {visibleNewsImages.length > 0 && (
                            <div
                                className={`mt-2 ${
                                    singleNewsImage
                                        ? ''
                                        : 'grid grid-cols-1 sm:grid-cols-2 gap-2'
                                }`}
                            >
                                {visibleNewsImages.map((src) => (
                                    <button
                                        type="button"
                                        key={src}
                                        onClick={() => actions.openImage(src)}
                                        className={`block rounded-md overflow-hidden border border-amber-200/70 dark:border-amber-700/50 ${
                                            singleNewsImage ? 'w-full' : ''
                                        }`}
                                    >
                                        <SduiChatImage
                                            src={src}
                                            alt=""
                                            fit={
                                                singleNewsImage
                                                    ? 'contain'
                                                    : 'cover'
                                            }
                                            onError={() =>
                                                actions.hideImage(src)
                                            }
                                        />
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                )}

            {devMode && (
                <div className="clear-right mt-2">
                    <SduiRawJsonBlock
                        title="Raw Message / Linked News / Permissions"
                        data={{
                            message,
                            linkedNews,
                            attachments: messageAttachments,
                            permissions: message?.can,
                            replyPreview,
                        }}
                    />
                </div>
            )}
        </div>
    );
});

// ---------------------------------------------------------------------------
// Run of system notices as one card, one row per notice

interface InfoGroupProps {
    groupKey: string;
    messages: SduiMessage[];
    expanded: boolean;
    spacingClass: string;
    canWriteInChat: boolean;
    openMenuKey: string | null;
    copiedKey: string | null;
    deletingKey: string | null;
    highlightedKey: string | null;
    devMode: boolean;
    actions: SduiMessageActions;
}

function InfoGroupRow({
    message,
    canWriteInChat,
    isMenuOpen,
    isCopied,
    isDeleting,
    isHighlighted,
    actions,
}: {
    message: SduiMessage;
    canWriteInChat: boolean;
    isMenuOpen: boolean;
    isCopied: boolean;
    isDeleting: boolean;
    isHighlighted: boolean;
    actions: SduiMessageActions;
}) {
    const messageKey = getMessageKey(message);
    const registerElement = useRegisterElement(messageKey, actions);
    const messageText = getMessageText(message, null);

    return (
        <li
            ref={registerElement}
            className={`flex items-center gap-2 py-1 rounded-lg transition-shadow duration-300 ${
                isHighlighted ? 'ring-2 ring-sky-400/90 dark:ring-sky-500/90' : ''
            }`}
        >
            <span className="min-w-0 flex-1 text-sm text-amber-900 dark:text-amber-100 whitespace-pre-wrap wrap-break-word">
                {renderTextWithLinks(messageText, INFO_LINK_CLASS)}
            </span>
            <span
                className="shrink-0 text-[10px] text-slate-400 dark:text-slate-500"
                title={getMessageDateTime(message)}
            >
                {getMessageTime(message)}
            </span>
            <MessageMenu
                message={message}
                info
                canCopy={Boolean(messageText)}
                canWriteInChat={canWriteInChat}
                isOpen={isMenuOpen}
                isCopied={isCopied}
                isDeleting={isDeleting}
                actions={actions}
            />
        </li>
    );
}

const InfoGroup = memo(function InfoGroup({
    groupKey,
    messages,
    expanded,
    spacingClass,
    canWriteInChat,
    openMenuKey,
    copiedKey,
    deletingKey,
    highlightedKey,
    devMode,
    actions,
}: InfoGroupProps) {
    const collapsible = messages.length > INFO_GROUP_VISIBLE_ROWS + 1;
    const visibleMessages =
        collapsible && !expanded
            ? messages.slice(-INFO_GROUP_VISIBLE_ROWS)
            : messages;
    const hiddenCount = messages.length - visibleMessages.length;

    return (
        <div
            className={`${spacingClass} max-w-[90%] rounded-2xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-3 py-1`}
        >
            {collapsible && (
                <button
                    type="button"
                    onClick={(event) =>
                        actions.toggleInfoGroup(groupKey, event.currentTarget)
                    }
                    aria-expanded={expanded}
                    className="w-full py-1.5 text-left text-xs font-semibold text-amber-700 dark:text-amber-300 hover:underline"
                >
                    {expanded
                        ? 'Weniger anzeigen'
                        : `${hiddenCount} frühere Hinweise anzeigen`}
                </button>
            )}
            <ul
                className={`divide-y divide-amber-200/70 dark:divide-amber-800/50 ${
                    collapsible
                        ? 'border-t border-amber-200/70 dark:border-amber-800/50'
                        : ''
                }`}
            >
                {visibleMessages.map((message) => {
                    const messageKey = getMessageKey(message);
                    return (
                        <InfoGroupRow
                            key={messageKey}
                            message={message}
                            canWriteInChat={canWriteInChat}
                            isMenuOpen={openMenuKey === messageKey}
                            isCopied={copiedKey === messageKey}
                            isDeleting={deletingKey === messageKey}
                            isHighlighted={highlightedKey === messageKey}
                            actions={actions}
                        />
                    );
                })}
            </ul>
            {devMode && (
                <div className="my-2">
                    <SduiRawJsonBlock
                        title={`Raw Messages (Gruppe, ${messages.length})`}
                        data={messages}
                    />
                </div>
            )}
        </div>
    );
});

// ---------------------------------------------------------------------------
// The whole list: day sections with sticky date labels

interface SduiMessageListProps {
    sections: MessageDaySection[];
    linkedNewsByKey: Record<string, SduiNews | null>;
    replyPreviewByKey: Record<string, ReplyPreview>;
    hiddenImageUrls: Record<string, boolean>;
    expandedInfoGroups: Record<string, boolean>;
    canWriteInChat: boolean;
    openMenuKey: string | null;
    copiedKey: string | null;
    deletingKey: string | null;
    highlightedKey: string | null;
    hasMoreMessages: boolean;
    loadingOlderMessages: boolean;
    devMode: boolean;
    actions: SduiMessageActions;
    contentRef: (element: HTMLDivElement | null) => void;
}

export const SduiMessageList = memo(function SduiMessageList({
    sections,
    linkedNewsByKey,
    replyPreviewByKey,
    hiddenImageUrls,
    expandedInfoGroups,
    canWriteInChat,
    openMenuKey,
    copiedKey,
    deletingKey,
    highlightedKey,
    hasMoreMessages,
    loadingOlderMessages,
    devMode,
    actions,
    contentRef,
}: SduiMessageListProps) {
    const now = new Date();

    return (
        <div ref={contentRef}>
            {/* Fixed-height slot, so showing the spinner doesn't shift the list. */}
            <div className="flex h-8 items-center justify-center text-xs text-slate-400 dark:text-slate-500">
                {loadingOlderMessages ? (
                    <span className="h-4 w-4 rounded-full border-2 border-slate-300 dark:border-slate-600 border-t-blue-600 animate-spin" />
                ) : !hasMoreMessages ? (
                    'Beginn des Chats'
                ) : null}
            </div>
            {sections.map((section, sectionIndex) => (
                <section
                    key={section.key}
                    className={sectionIndex === 0 ? '' : 'mt-3'}
                >
                    <div className="pointer-events-none sticky top-0 z-10 flex justify-center py-1.5">
                        <span className="rounded-full bg-white/95 dark:bg-slate-800/95 px-3 py-1 text-xs font-medium text-slate-600 dark:text-slate-300 shadow-sm ring-1 ring-slate-200 dark:ring-slate-700">
                            {formatDayLabel(section.dayStart, now)}
                        </span>
                    </div>
                    {section.items.map((item, itemIndex) => {
                        if (item.kind === 'infoGroup') {
                            return (
                                <InfoGroup
                                    key={item.key}
                                    groupKey={item.key}
                                    messages={item.messages}
                                    expanded={Boolean(
                                        expandedInfoGroups[item.key],
                                    )}
                                    spacingClass={
                                        itemIndex === 0 ? 'mt-1.5' : 'mt-3'
                                    }
                                    canWriteInChat={canWriteInChat}
                                    openMenuKey={openMenuKey}
                                    copiedKey={copiedKey}
                                    deletingKey={deletingKey}
                                    highlightedKey={highlightedKey}
                                    devMode={devMode}
                                    actions={actions}
                                />
                            );
                        }
                        const messageKey = getMessageKey(item.message);
                        return (
                            <MessageBubble
                                key={messageKey}
                                message={item.message}
                                linkedNews={linkedNewsByKey[messageKey] ?? null}
                                replyPreview={
                                    replyPreviewByKey[messageKey] ?? null
                                }
                                hiddenImageUrls={hiddenImageUrls}
                                continuesPrevious={item.continuesPrevious}
                                spacingClass={
                                    itemIndex === 0
                                        ? 'mt-1.5'
                                        : item.continuesPrevious
                                          ? 'mt-1'
                                          : 'mt-3'
                                }
                                canWriteInChat={canWriteInChat}
                                isMenuOpen={openMenuKey === messageKey}
                                isCopied={copiedKey === messageKey}
                                isDeleting={deletingKey === messageKey}
                                isHighlighted={highlightedKey === messageKey}
                                devMode={devMode}
                                actions={actions}
                            />
                        );
                    })}
                </section>
            ))}
        </div>
    );
});

