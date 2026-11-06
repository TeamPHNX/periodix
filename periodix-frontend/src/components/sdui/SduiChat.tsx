/* eslint-disable @typescript-eslint/no-explicit-any */
import React, {
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import { SduiDeleteConfirmModal } from './SduiDeleteConfirmModal';
import { SduiMessageInfoModal } from './SduiMessageInfoModal';
import { SduiDevPanel } from './SduiDevPanel';
import { PinIcon, SduiChatList } from './SduiChatList';
import { SduiRawJsonBlock, isSduiDeveloperModeEnabled } from './SduiDevTools';
import { SduiImageLightbox, type SduiLightboxImage } from './SduiImageLightbox';
import { SduiMessageList, type SduiMessageActions } from './SduiMessageList';
import { buildMessageSections } from './sduiMessageGrouping';
import { extractImageUrls } from './sduiAttachmentUtils';
import { renderTextWithLinks } from './sduiLinkText';
import {
    isChatUnread,
    mergeChatLists,
    readLocalPinnedChatIds,
    withChatMarkedRead,
    writeLocalPinnedChatIds,
} from './sduiChatListUtils';
import {
    canWriteToChat,
    extractNewsId,
    getChatName,
    getLinkedNews,
    getMessageChatId,
    getMessageDateTime,
    getMessageKey,
    getMessageSender,
    getMessageText,
    getMessageTime,
    getMessageTimestamp,
    getMessageUuid,
    getNewsAudience,
    getNewsAuthor,
    getNewsBody,
    getNewsDateTime,
    getNewsItemId,
    getNewsTimestamp,
    getNewsTitle,
    getReaderName,
    getReplyPreviewForMessage,
    hasOneWayRestrictionSignal,
    indexNewsList,
    mergeUniqueMessages,
    normalizeArrayResponse,
    normalizeReaderList,
    normalizeTextForComparison,
} from './sduiChatUtils';

type SduiChatItem = any;
type SduiMessage = any;
type SduiNews = any;

const CHAT_POLL_INTERVAL_MS = 45_000;

interface SduiChatProps {
    /** Called whenever the number of unread chats changes. */
    onUnreadCountChange?: (unreadChats: number) => void;
}

export function SduiChat({ onUnreadCountChange }: SduiChatProps = {}) {
    const [chats, setChats] = useState<SduiChatItem[]>([]);
    const [chatSearchQuery, setChatSearchQuery] = useState<string>('');
    const [chatFilter, setChatFilter] = useState<'all' | 'unread'>('all');
    const [localPinnedIds, setLocalPinnedIds] = useState<string[]>(() =>
        readLocalPinnedChatIds(),
    );
    const [failedAvatarIds, setFailedAvatarIds] = useState<
        Record<string, true>
    >({});
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
    const [lightboxImage, setLightboxImage] =
        useState<SduiLightboxImage | null>(null);
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
    const [isComposerFocused, setIsComposerFocused] = useState<boolean>(false);
    const [isMobileKeyboardOpen, setIsMobileKeyboardOpen] =
        useState<boolean>(false);
    const [highlightedMessageKey, setHighlightedMessageKey] = useState<
        string | null
    >(null);
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
    const visualViewportBaseHeightRef = useRef<number>(0);
    const messagePageRef = useRef<number>(1);
    const hasMoreMessagesRef = useRef<boolean>(true);
    const messageElementsRef = useRef<Record<string, HTMLElement | null>>(
        {},
    );
    const replyHighlightTimeoutRef = useRef<number | null>(null);
    const composerRef = useRef<HTMLTextAreaElement | null>(null);

    // Grow the composer with its content (up to the CSS max-height), and
    // shrink it back when the draft is cleared after sending.
    const resizeComposer = useCallback(
        (el: HTMLTextAreaElement | null = composerRef.current) => {
            if (!el) return;
            el.style.height = 'auto';
            const border = el.offsetHeight - el.clientHeight;
            el.style.height = `${el.scrollHeight + border}px`;
        },
        [],
    );
    const setComposerRef = useCallback(
        (el: HTMLTextAreaElement | null) => {
            composerRef.current = el;
            resizeComposer(el);
        },
        [resizeComposer],
    );
    useLayoutEffect(() => {
        resizeComposer();
    }, [draft, resizeComposer]);

    const selectedChatId = useMemo(
        () => (selectedChat ? getMessageChatId(selectedChat) : ''),
        [selectedChat],
    );
    const selectedChatRef = useRef<SduiChatItem | null>(null);
    useEffect(() => {
        selectedChatRef.current = selectedChat;
    }, [selectedChat]);

    // Only pins set in Periodix lift a chat to the top. SDUI's own pins
    // (meta.is_pinned) are deliberately ignored so they don't force order.
    const isChatPinned = useCallback(
        (chat: SduiChatItem) =>
            localPinnedIds.includes(getMessageChatId(chat)),
        [localPinnedIds],
    );
    const toggleLocalPin = useCallback((chat: SduiChatItem) => {
        const chatId = getMessageChatId(chat);
        if (!chatId) return;
        setLocalPinnedIds((current) => {
            const next = current.includes(chatId)
                ? current.filter((id) => id !== chatId)
                : [chatId, ...current];
            writeLocalPinnedChatIds(next);
            return next;
        });
    }, []);
    const unreadChatCount = useMemo(
        () => chats.filter((chat) => isChatUnread(chat)).length,
        [chats],
    );
    useEffect(() => {
        onUnreadCountChange?.(unreadChatCount);
    }, [onUnreadCountChange, unreadChatCount]);
    const { pinnedChats, otherChats } = useMemo(() => {
        const query = normalizeTextForComparison(chatSearchQuery);
        const visible = chats.filter((chat) => {
            if (chatFilter === 'unread' && !isChatUnread(chat)) return false;
            if (!query) return true;
            return normalizeTextForComparison(
                `${getChatName(chat)} ${chat?.meta?.subtitle ?? ''}`,
            ).includes(query);
        });
        return {
            pinnedChats: visible.filter((chat) => isChatPinned(chat)),
            otherChats: visible.filter((chat) => !isChatPinned(chat)),
        };
    }, [chatFilter, chatSearchQuery, chats, isChatPinned]);
    const isSduiDevMode = useMemo(() => isSduiDeveloperModeEnabled(), []);
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
    const messageSections = useMemo(
        () => buildMessageSections(messages),
        [messages],
    );
    // Per-message lookups computed once per messages/news change, so the
    // memoized bubbles receive the same objects while the user types.
    const messageLookups = useMemo(() => {
        const linkedNewsByKey: Record<string, SduiNews | null> = {};
        const replyPreviewByKey: Record<
            string,
            ReturnType<typeof getReplyPreviewForMessage>
        > = {};
        for (const message of messages) {
            const key = getMessageKey(message);
            linkedNewsByKey[key] = getLinkedNews(message, newsById);
            replyPreviewByKey[key] = getReplyPreviewForMessage(
                message,
                messageByUuid,
                newsById,
            );
        }
        return { linkedNewsByKey, replyPreviewByKey };
    }, [messages, messageByUuid, newsById]);
    // "New messages" button: messages that arrived while scrolled up.
    const [unseenMessageCount, setUnseenMessageCount] = useState(0);
    const [isAwayFromBottom, setIsAwayFromBottom] = useState(false);
    const newestMessageTimestampRef = useRef(0);
    const [expandedInfoGroups, setExpandedInfoGroups] = useState<
        Record<string, boolean>
    >({});
    const scrollAndHighlightMessageByKey = useCallback((targetKey: string) => {
        const targetElement = messageElementsRef.current[targetKey];
        if (!targetElement) return false;

        shouldStickToBottomRef.current = false;
        targetElement.scrollIntoView({
            behavior: 'smooth',
            block: 'center',
        });

        if (replyHighlightTimeoutRef.current !== null) {
            window.clearTimeout(replyHighlightTimeoutRef.current);
        }

        setHighlightedMessageKey(targetKey);
        replyHighlightTimeoutRef.current = window.setTimeout(() => {
            setHighlightedMessageKey((current) =>
                current === targetKey ? null : current,
            );
            replyHighlightTimeoutRef.current = null;
        }, 1800);

        return true;
    }, []);
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
        if (!lightboxImage) return;

        const previousOverflow = document.body.style.overflow;
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setLightboxImage(null);
            }
        };

        document.body.style.overflow = 'hidden';
        window.addEventListener('keydown', handleKeyDown);

        return () => {
            document.body.style.overflow = previousOverflow;
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [lightboxImage]);

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

    useEffect(() => {
        return () => {
            if (replyHighlightTimeoutRef.current !== null) {
                window.clearTimeout(replyHighlightTimeoutRef.current);
            }
        };
    }, []);

    useEffect(() => {
        if (typeof window === 'undefined') return;

        const viewport = window.visualViewport;
        if (!viewport) return;

        const updateKeyboardState = () => {
            const currentHeight = viewport.height;
            if (
                !visualViewportBaseHeightRef.current ||
                currentHeight > visualViewportBaseHeightRef.current
            ) {
                visualViewportBaseHeightRef.current = currentHeight;
            }

            const heightDelta =
                visualViewportBaseHeightRef.current - currentHeight;
            setIsMobileKeyboardOpen(heightDelta > 140);
        };

        const resetViewportBase = () => {
            visualViewportBaseHeightRef.current = viewport.height;
            updateKeyboardState();
        };

        resetViewportBase();
        viewport.addEventListener('resize', updateKeyboardState);
        viewport.addEventListener('scroll', updateKeyboardState);
        window.addEventListener('orientationchange', resetViewportBase);

        return () => {
            viewport.removeEventListener('resize', updateKeyboardState);
            viewport.removeEventListener('scroll', updateKeyboardState);
            window.removeEventListener('orientationchange', resetViewportBase);
        };
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
        setChats(mergeChatLists([], normalizeArrayResponse(body)));
        setIsAuthenticated(true);
    }, []);

    // Marks the chat read in SDUI too, so the official app's badge clears.
    const markChatRead = useCallback(async (chat: SduiChatItem) => {
        const chatId = getMessageChatId(chat);
        if (!chatId || !isChatUnread(chat)) return;

        setChats((current) =>
            current.map((candidate) =>
                getMessageChatId(candidate) === chatId
                    ? withChatMarkedRead(candidate)
                    : candidate,
            ),
        );

        try {
            const token = localStorage.getItem('token');
            await fetch(`/api/sdui/chats/${encodeURIComponent(chatId)}/read`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` },
            });
        } catch (error) {
            // Not critical: the next poll shows the real state again.
            console.error(error);
        }
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

    const smoothScrollToBottomUntilRef = useRef(0);
    // Content that grows afterwards (images, prepended pages) is kept at the
    // bottom by the ResizeObserver below while shouldStickToBottomRef is set.
    const scrollToBottom = useCallback((smooth = false) => {
        const container = messagesContainerRef.current;
        if (!container) return;

        shouldStickToBottomRef.current = true;
        if (smooth) {
            // The animation's own scroll events must not switch sticking
            // off, or content growing meanwhile would leave it short.
            smoothScrollToBottomUntilRef.current = performance.now() + 1000;
            container.scrollTo({
                top: container.scrollHeight,
                behavior: 'smooth',
            });
        } else {
            container.scrollTop = container.scrollHeight;
        }
    }, []);

    // Scroll anchoring: when content changes height (images loading, older
    // pages prepended, news cards resolving), keep the topmost visible message
    // at the same spot on screen, or stay at the bottom if the user was there.
    // The browser's own overflow-anchor is turned off on the container so the
    // two don't fight; Safari doesn't implement it anyway.
    const scrollAnchorRef = useRef<{
        element: HTMLElement;
        offset: number;
    } | null>(null);
    const contentResizeObserverRef = useRef<ResizeObserver | null>(null);

    const captureScrollAnchor = useCallback(() => {
        const container = messagesContainerRef.current;
        if (!container) return;
        const containerTop = container.getBoundingClientRect().top;
        let anchor: { element: HTMLElement; offset: number } | null = null;
        for (const element of Object.values(messageElementsRef.current)) {
            if (!element) continue;
            const rect = element.getBoundingClientRect();
            if (rect.bottom <= containerTop) continue;
            const offset = rect.top - containerTop;
            if (!anchor || offset < anchor.offset) {
                anchor = { element, offset };
            }
        }
        scrollAnchorRef.current = anchor;
    }, []);

    // Pin an element (e.g. a group's expand button the user just clicked) so
    // the content it reveals grows downwards instead of shifting the view.
    const anchorScrollToElement = useCallback((element: HTMLElement) => {
        const container = messagesContainerRef.current;
        if (!container) return;
        scrollAnchorRef.current = {
            element,
            offset:
                element.getBoundingClientRect().top -
                container.getBoundingClientRect().top,
        };
    }, []);

    const restoreScrollAnchor = useCallback(() => {
        const container = messagesContainerRef.current;
        if (!container) return;
        if (shouldStickToBottomRef.current) {
            container.scrollTop = container.scrollHeight;
            return;
        }
        const anchor = scrollAnchorRef.current;
        if (!anchor || !anchor.element.isConnected) return;
        const offset =
            anchor.element.getBoundingClientRect().top -
            container.getBoundingClientRect().top;
        const delta = offset - anchor.offset;
        if (Math.abs(delta) >= 1) {
            container.scrollTop += delta;
        }
    }, []);

    // Callback ref for the message list: watches the list (content height)
    // and its scroll container (viewport height, e.g. the mobile keyboard).
    const setMessagesContentRef = useCallback(
        (element: HTMLDivElement | null) => {
            contentResizeObserverRef.current?.disconnect();
            contentResizeObserverRef.current = null;
            if (!element || typeof ResizeObserver === 'undefined') return;
            const observer = new ResizeObserver(restoreScrollAnchor);
            observer.observe(element);
            if (element.parentElement) observer.observe(element.parentElement);
            contentResizeObserverRef.current = observer;
        },
        [restoreScrollAnchor],
    );

    // Layout effect: jump to the bottom in the same commit that renders the
    // messages. Otherwise a scroll event from before the jump (scrollTop near
    // 0 with the new content) reaches handleMessagesScroll, which would turn
    // off sticking and load an older page nobody scrolled to.
    useLayoutEffect(() => {
        messagesRef.current = messages;

        const previousNewest = newestMessageTimestampRef.current;
        let newest = previousNewest;
        let arrived = 0;
        for (const message of messages) {
            const timestamp = getMessageTimestamp(message);
            if (timestamp > newest) newest = timestamp;
            if (previousNewest && timestamp > previousNewest) arrived += 1;
        }
        newestMessageTimestampRef.current = newest;

        if (shouldStickToBottomRef.current) {
            scrollToBottom(false);
        } else if (arrived > 0) {
            setUnseenMessageCount((count) => count + arrived);
        }
    }, [messages, scrollToBottom]);

    React.useEffect(() => {
        hasMoreNewsRef.current = hasMoreNews;
    }, [hasMoreNews]);

    React.useEffect(() => {
        messagePageRef.current = messagePage;
    }, [messagePage]);

    React.useEffect(() => {
        hasMoreMessagesRef.current = hasMoreMessages;
    }, [hasMoreMessages]);

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
                    // Prepending older messages: scroll anchoring keeps the
                    // messages on screen in place.
                    setMessages((prev) => mergeUniqueMessages(prev, incoming));
                    setMessagePage(page);
                    setHasMoreMessages(
                        incoming.length > 0 && uniqueIncomingCount > 0,
                    );
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

    // Merge the newest page into the loaded history without resetting scroll.
    const refreshLatestMessages = useCallback(
        async (chat: SduiChatItem) => {
            const chatId = getMessageChatId(chat);
            if (!chatId) return;
            const token = localStorage.getItem('token');
            const res = await fetch(
                `/api/sdui/chats/${encodeURIComponent(chatId)}/messages?page=1`,
                { headers: { Authorization: `Bearer ${token}` } },
            );
            if (!res.ok) return;
            const incoming = normalizeArrayResponse(await res.json());
            if (getMessageChatId(selectedChatRef.current) !== chatId) return;
            setMessages((prev) => mergeUniqueMessages(prev, incoming));
            await ensureNewsForMessages(incoming);
        },
        [ensureNewsForMessages],
    );

    const jumpToMessageByUuid = useCallback(
        async (targetMessageUuid: string) => {
            if (!targetMessageUuid) return;

            const findTargetMessage = (): SduiMessage | null => {
                return (
                    messagesRef.current.find(
                        (candidate) =>
                            getMessageUuid(candidate) === targetMessageUuid,
                    ) || null
                );
            };

            let targetMessage = findTargetMessage();

            if (!targetMessage && selectedChat) {
                let safetyCounter = 0;

                while (
                    !targetMessage &&
                    hasMoreMessagesRef.current &&
                    safetyCounter < 25
                ) {
                    if (loadingOlderRef.current) break;

                    loadingOlderRef.current = true;
                    setLoadingOlderMessages(true);
                    try {
                        const nextPage = messagePageRef.current + 1;
                        await loadMessagesPage(
                            selectedChat,
                            nextPage,
                            'prepend',
                            false,
                        );
                    } finally {
                        loadingOlderRef.current = false;
                        setLoadingOlderMessages(false);
                    }

                    targetMessage = findTargetMessage();
                    safetyCounter += 1;
                }
            }

            if (!targetMessage) {
                setMessageError(
                    'Originalnachricht konnte nicht im Verlauf gefunden werden.',
                );
                return;
            }

            const targetKey = getMessageKey(targetMessage);
            if (!scrollAndHighlightMessageByKey(targetKey)) {
                requestAnimationFrame(() => {
                    scrollAndHighlightMessageByKey(targetKey);
                });
                window.setTimeout(() => {
                    scrollAndHighlightMessageByKey(targetKey);
                }, 160);
            }
        },
        [loadMessagesPage, scrollAndHighlightMessageByKey, selectedChat],
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

    // Keep the list in step with the official app: refresh the first page
    // (SDUI sorts by activity) while the tab is visible. If the open chat
    // got new messages, pull them in and mark the chat read again.
    useEffect(() => {
        if (loading || !isAuthenticated) return;

        let cancelled = false;
        const poll = async () => {
            if (document.visibilityState !== 'visible') return;
            try {
                const token = localStorage.getItem('token');
                const res = await fetch('/api/sdui/chats?page=1', {
                    headers: { Authorization: `Bearer ${token}` },
                });
                if (!res.ok || cancelled) return;
                const fresh = normalizeArrayResponse(await res.json());
                setChats((current) => mergeChatLists(current, fresh));

                const openChat = selectedChatRef.current;
                if (!openChat) return;
                const openChatId = getMessageChatId(openChat);
                const freshOpenChat = fresh.find(
                    (chat) => getMessageChatId(chat) === openChatId,
                );
                if (freshOpenChat && isChatUnread(freshOpenChat)) {
                    await refreshLatestMessages(openChat);
                    if (!cancelled) void markChatRead(freshOpenChat);
                }
            } catch (error) {
                console.error(error);
            }
        };

        const intervalId = window.setInterval(poll, CHAT_POLL_INTERVAL_MS);
        const onVisible = () => {
            if (document.visibilityState === 'visible') void poll();
        };
        document.addEventListener('visibilitychange', onVisible);
        return () => {
            cancelled = true;
            window.clearInterval(intervalId);
            document.removeEventListener('visibilitychange', onVisible);
        };
    }, [isAuthenticated, loading, markChatRead, refreshLatestMessages]);

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
        void markChatRead(chat);
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
        setUnseenMessageCount(0);
        setIsAwayFromBottom(false);
        newestMessageTimestampRef.current = 0;
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
        shouldStickToBottomRef.current =
            distanceFromBottom <= 96 ||
            performance.now() < smoothScrollToBottomUntilRef.current;
        captureScrollAnchor();
        const awayFromBottom = distanceFromBottom > 240;
        setIsAwayFromBottom((current) =>
            current === awayFromBottom ? current : awayFromBottom,
        );
        if (distanceFromBottom <= 96) setUnseenMessageCount(0);

        if (
            !selectedChat ||
            loadingMessages ||
            loadingOlderMessages ||
            !hasMoreMessages ||
            loadingOlderRef.current
        ) {
            return;
        }

        // Start loading the previous page well before the top is reached,
        // so scrolling up rarely has to wait.
        if (element.scrollTop > 600) {
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

    const registerMessageElement = useCallback(
        (messageKey: string, element: HTMLElement | null) => {
            if (element) {
                messageElementsRef.current[messageKey] = element;
            } else {
                delete messageElementsRef.current[messageKey];
            }
        },
        [],
    );
    const messageActions = useMemo<SduiMessageActions>(
        () => ({
            toggleMenu: (messageKey) =>
                setOpenMessageMenuKey((current) =>
                    current === messageKey ? null : messageKey,
                ),
            reply: (message) => {
                setReplyToMessage(message);
                setOpenMessageMenuKey(null);
            },
            copy: (message) => {
                void handleCopyMessageText(message);
                setOpenMessageMenuKey(null);
            },
            info: (message) => {
                void handleOpenMessageInfo(message);
            },
            requestDelete: handleRequestDeleteMessage,
            jumpToMessage: (messageUuid) => {
                void jumpToMessageByUuid(messageUuid);
            },
            openImage: (url, previewUrl) =>
                setLightboxImage({ url, previewUrl }),
            hideImage: (url) =>
                setHiddenImageUrls((prev) =>
                    prev[url] ? prev : { ...prev, [url]: true },
                ),
            registerElement: registerMessageElement,
            toggleInfoGroup: (groupKey, anchor) => {
                anchorScrollToElement(anchor);
                setExpandedInfoGroups((current) => ({
                    ...current,
                    [groupKey]: !current[groupKey],
                }));
            },
        }),
        [
            anchorScrollToElement,
            handleCopyMessageText,
            handleOpenMessageInfo,
            handleRequestDeleteMessage,
            jumpToMessageByUuid,
            registerMessageElement,
        ],
    );

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
            <div className="flex h-full items-center justify-center bg-linear-to-b from-slate-50 via-white to-sky-50/70 p-4 dark:from-slate-900 dark:via-slate-900 dark:to-slate-950">
                <div className="w-full max-w-2xl overflow-hidden rounded-3xl border border-slate-200/80 bg-white/95 shadow-xl shadow-slate-900/10 dark:border-slate-700/70 dark:bg-slate-900/95 sdui-animate-content">
                    <div className="grid md:grid-cols-[1.1fr_0.9fr]">
                        <div
                            className="relative border-b border-slate-200/80 p-6 sm:p-7 dark:border-slate-700/70 md:border-b-0 md:border-r sdui-animate-stagger"
                            style={{ animationDelay: '40ms' }}
                        >
                            <div className="pointer-events-none absolute -right-16 -top-16 h-44 w-44 rounded-full bg-sky-300/20 blur-3xl dark:bg-sky-500/20" />
                            <div className="relative">
                                <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 dark:border-emerald-900/70 dark:bg-emerald-900/30 dark:text-emerald-200">
                                    <span className="h-2 w-2 rounded-full bg-emerald-500" />
                                    Sicher verbunden
                                </div>
                                <h2 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
                                    SDUI in Periodix aktivieren
                                </h2>
                                <p className="mt-3 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                                    Verbinde SDUI einmalig ueber deinen
                                    bestehenden WebUntis-Login und erhalte Chats
                                    und News direkt in Periodix.
                                </p>
                                <ul className="mt-5 space-y-2 text-sm text-slate-700 dark:text-slate-200">
                                    <li className="flex items-start gap-2">
                                        <span className="mt-0.5 h-5 w-5 shrink-0 rounded-full bg-sky-100 text-center text-xs font-semibold leading-5 text-sky-700 dark:bg-sky-900/40 dark:text-sky-200">
                                            1
                                        </span>
                                        Automatische Anmeldung mit deinen
                                        bereits hinterlegten Zugangsdaten
                                    </li>
                                    <li className="flex items-start gap-2">
                                        <span className="mt-0.5 h-5 w-5 shrink-0 rounded-full bg-sky-100 text-center text-xs font-semibold leading-5 text-sky-700 dark:bg-sky-900/40 dark:text-sky-200">
                                            2
                                        </span>
                                        Chatverlaeufe und Schul-News gebuendelt
                                        in einem Fenster
                                    </li>
                                    <li className="flex items-start gap-2">
                                        <span className="mt-0.5 h-5 w-5 shrink-0 rounded-full bg-sky-100 text-center text-xs font-semibold leading-5 text-sky-700 dark:bg-sky-900/40 dark:text-sky-200">
                                            3
                                        </span>
                                        Schneller Zugriff ohne Medienbruch im
                                        Dashboard
                                    </li>
                                </ul>
                            </div>
                        </div>

                        <div
                            className="p-6 sm:p-7 sdui-animate-stagger"
                            style={{ animationDelay: '120ms' }}
                        >
                            <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                                Integration starten
                            </h3>
                            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                                Ein Klick reicht, um die SDUI-Verbindung ueber
                                WebUntis einzurichten.
                            </p>
                            {errorMsg && (
                                <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">
                                    {errorMsg}
                                </div>
                            )}
                            <form onSubmit={handleAuth} className="mt-5">
                                <button
                                    type="submit"
                                    className="group flex w-full items-center justify-center gap-2 rounded-xl bg-linear-to-r from-sky-600 to-cyan-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-sky-900/20 transition-all duration-300 hover:-translate-y-0.5 hover:from-sky-700 hover:to-cyan-700"
                                >
                                    Mit WebUntis verbinden
                                    <svg
                                        className="h-4 w-4 transition-transform group-hover:translate-x-0.5"
                                        viewBox="0 0 20 20"
                                        fill="currentColor"
                                        aria-hidden="true"
                                    >
                                        <path
                                            fillRule="evenodd"
                                            d="M3 10a.75.75 0 01.75-.75h10.69L11.22 6.03a.75.75 0 111.06-1.06l4.5 4.5a.75.75 0 010 1.06l-4.5 4.5a.75.75 0 11-1.06-1.06l3.22-3.22H3.75A.75.75 0 013 10z"
                                            clipRule="evenodd"
                                        />
                                    </svg>
                                </button>
                            </form>
                            <p className="mt-3 text-xs text-slate-400 dark:text-slate-500">
                                Es werden keine zusaetzlichen Zugangsdaten im
                                Browser abgefragt.
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    const showInitialMessagesSpinner = loadingMessages && messages.length === 0;
    const shouldCompactComposerSpacing =
        isMobileKeyboardOpen || isComposerFocused;
    const serializedMessageInfo = (() => {
        if (!messageInfoTarget) return '';
        try {
            return JSON.stringify(messageInfoTarget, null, 2);
        } catch {
            return '';
        }
    })();

    return (
        <div className="h-full w-full flex flex-col bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 sdui-animate-content">
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
                        {unreadChatCount > 0 && (
                            <span className="ml-1.5 rounded-full bg-sky-500 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
                                {unreadChatCount}
                            </span>
                        )}
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

            <SduiDevPanel
                isVisible={isSduiDevMode}
                chats={chats}
                selectedChat={selectedChat}
                selectedChatId={selectedChatId}
                selectedChatDetails={selectedChatDetails}
                canWriteInSelectedChat={canWriteInSelectedChat}
                oneWayDetected={oneWayDetected}
                activeTab={activeTab}
            />

            <div className="min-h-0 flex-1 flex overflow-hidden">
                {activeTab === 'chats' ? (
                    <>
                        <aside
                            className={`${selectedChat ? 'hidden md:flex' : 'flex'} w-full md:w-[340px] lg:w-[380px] shrink-0 min-h-0 flex-col border-r border-slate-200 dark:border-slate-800`}
                        >
                            <SduiChatList
                                pinnedChats={pinnedChats}
                                otherChats={otherChats}
                                totalChats={chats.length}
                                unreadChatCount={unreadChatCount}
                                selectedChatId={selectedChatId}
                                searchQuery={chatSearchQuery}
                                filter={chatFilter}
                                errorMsg={errorMsg}
                                failedAvatarIds={failedAvatarIds}
                                onSearchChange={setChatSearchQuery}
                                onFilterChange={setChatFilter}
                                onSelectChat={(chat) => {
                                    void handleSelectChat(chat);
                                }}
                                onAvatarError={(chatId) =>
                                    setFailedAvatarIds((current) =>
                                        current[chatId]
                                            ? current
                                            : { ...current, [chatId]: true },
                                    )
                                }
                            />
                        </aside>

                        <section className="flex-1 min-w-0 flex flex-col bg-slate-50 dark:bg-slate-950 sdui-animate-tab">
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
                                        {(() => {
                                            const pinned =
                                                isChatPinned(selectedChat);
                                            return (
                                                <button
                                                    type="button"
                                                    onClick={() =>
                                                        toggleLocalPin(
                                                            selectedChat,
                                                        )
                                                    }
                                                    aria-pressed={pinned}
                                                    aria-label={
                                                        pinned
                                                            ? 'Chat loesen'
                                                            : 'Chat anheften'
                                                    }
                                                    title={
                                                        pinned
                                                            ? 'Chat loesen'
                                                            : 'Chat anheften'
                                                    }
                                                    className={`ml-auto shrink-0 rounded-full p-2 transition-colors ${
                                                        pinned
                                                            ? 'text-sky-600 bg-sky-50 dark:text-sky-300 dark:bg-sky-500/15'
                                                            : 'text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200'
                                                    }`}
                                                >
                                                    <PinIcon className="h-4 w-4" />
                                                </button>
                                            );
                                        })()}
                                    </header>

                                    <main
                                        ref={messagesContainerRef}
                                        onScroll={handleMessagesScroll}
                                        className="flex-1 overflow-y-auto px-4 pb-4 [overflow-anchor:none]"
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
                                            <SduiMessageList
                                                sections={messageSections}
                                                linkedNewsByKey={
                                                    messageLookups.linkedNewsByKey
                                                }
                                                replyPreviewByKey={
                                                    messageLookups.replyPreviewByKey
                                                }
                                                hiddenImageUrls={hiddenImageUrls}
                                                expandedInfoGroups={
                                                    expandedInfoGroups
                                                }
                                                canWriteInChat={
                                                    canWriteInSelectedChat
                                                }
                                                openMenuKey={openMessageMenuKey}
                                                copiedKey={copiedMessageKey}
                                                deletingKey={deletingMessageKey}
                                                highlightedKey={
                                                    highlightedMessageKey
                                                }
                                                hasMoreMessages={hasMoreMessages}
                                                loadingOlderMessages={
                                                    loadingOlderMessages
                                                }
                                                devMode={isSduiDevMode}
                                                actions={messageActions}
                                                contentRef={
                                                    setMessagesContentRef
                                                }
                                            />
                                        )}
                                        <div ref={messagesEndRef} />
                                    </main>

                                    <footer
                                        className={`relative border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 pt-3 ${
                                            shouldCompactComposerSpacing
                                                ? 'pb-3'
                                                : 'pb-[calc(env(safe-area-inset-bottom)+0.75rem)]'
                                        } md:p-3`}
                                    >
                                        {(isAwayFromBottom ||
                                            unseenMessageCount > 0) && (
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setUnseenMessageCount(0);
                                                    scrollToBottom(true);
                                                }}
                                                aria-label={
                                                    unseenMessageCount > 0
                                                        ? `${unseenMessageCount} neue Nachrichten, zum Ende springen`
                                                        : 'Zum Ende springen'
                                                }
                                                className="absolute right-4 bottom-full mb-3 z-20 flex h-10 items-center gap-1.5 rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-sm font-medium text-slate-700 dark:text-slate-200 shadow-lg hover:bg-slate-50 dark:hover:bg-slate-700 sdui-animate-tab"
                                            >
                                                {unseenMessageCount > 0 && (
                                                    <span className="rounded-full bg-blue-600 px-2 py-0.5 text-xs font-semibold text-white">
                                                        {unseenMessageCount > 99
                                                            ? '99+'
                                                            : unseenMessageCount}{' '}
                                                        neu
                                                    </span>
                                                )}
                                                <svg
                                                    className="h-4 w-4"
                                                    viewBox="0 0 20 20"
                                                    fill="currentColor"
                                                    aria-hidden="true"
                                                >
                                                    <path
                                                        fillRule="evenodd"
                                                        d="M10 3a.75.75 0 01.75.75v10.638l3.96-4.158a.75.75 0 111.08 1.04l-5.25 5.5a.75.75 0 01-1.08 0l-5.25-5.5a.75.75 0 111.08-1.04l3.96 4.158V3.75A.75.75 0 0110 3z"
                                                        clipRule="evenodd"
                                                    />
                                                </svg>
                                            </button>
                                        )}
                                        {!canWriteInSelectedChat && (
                                            <div className="mb-2 rounded-md border border-slate-300 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 px-3 py-2 text-xs">
                                                {oneWayDetected
                                                    ? 'Dieser Chat steht aktuell auf "One-Way". Nur Administratoren duerfen schreiben oder eine Konversation eröffnen.'
                                                    : 'Du hast in diesem Chat keine Schreibrechte.'}
                                            </div>
                                        )}
                                        {replyPreview && (
                                            <div className="mb-2 rounded-xl border border-slate-200/90 dark:border-slate-700/80 bg-linear-to-br from-slate-50 via-slate-50 to-indigo-50/60 dark:from-slate-900/70 dark:via-slate-900/65 dark:to-indigo-950/20 px-3 py-2">
                                                <div className="flex items-start justify-between gap-3">
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            if (
                                                                replyPreview.uuid
                                                            ) {
                                                                jumpToMessageByUuid(
                                                                    replyPreview.uuid,
                                                                );
                                                            }
                                                        }}
                                                        className="min-w-0 text-left"
                                                    >
                                                        <div className="text-[11px] font-semibold text-slate-700 dark:text-slate-200">
                                                            Antwort an{' '}
                                                            {
                                                                replyPreview.sender
                                                            }
                                                            {replyPreview.uuid
                                                                ? ' • Zum Original'
                                                                : ''}
                                                        </div>
                                                        <div className="text-xs text-slate-700 dark:text-slate-200 line-clamp-2">
                                                            {replyPreview.text ||
                                                                'Nachricht'}
                                                        </div>
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() =>
                                                            setReplyToMessage(
                                                                null,
                                                            )
                                                        }
                                                        className="text-[11px] rounded-full border border-slate-300 dark:border-slate-600 px-2 py-0.5 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/70"
                                                    >
                                                        Abbrechen
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                        <form
                                            onSubmit={handleSendMessage}
                                            className="flex items-end gap-2"
                                        >
                                            <textarea
                                                ref={setComposerRef}
                                                rows={1}
                                                value={draft}
                                                onChange={(e) =>
                                                    setDraft(e.target.value)
                                                }
                                                // Enter always inserts a newline;
                                                // only the send button submits.
                                                enterKeyHint="enter"
                                                onFocus={() =>
                                                    setIsComposerFocused(true)
                                                }
                                                onBlur={() =>
                                                    setIsComposerFocused(false)
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
                                                className={`flex-1 min-w-0 resize-none overflow-y-auto max-h-40 leading-5 rounded-2xl px-4 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 border border-transparent focus:outline-none focus:border-blue-500 disabled:cursor-not-allowed disabled:opacity-70 ${
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
                    <section className="flex-1 min-w-0 flex flex-col bg-slate-50 dark:bg-slate-950 sdui-animate-tab">
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
                                            className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm p-4 sdui-animate-stagger"
                                            style={{
                                                animationDelay: `${Math.min(index, 10) * 28}ms`,
                                            }}
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
                                                                    setLightboxImage(
                                                                        {
                                                                            url: src,
                                                                        },
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

                                            {isSduiDevMode && (
                                                <div className="mt-4">
                                                    <SduiRawJsonBlock
                                                        title="Raw News Item"
                                                        data={news}
                                                    />
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

            {lightboxImage && (
                <SduiImageLightbox
                    key={lightboxImage.url}
                    image={lightboxImage}
                    onClose={() => setLightboxImage(null)}
                />
            )}
        </div>
    );
}
