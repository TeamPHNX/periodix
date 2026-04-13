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
import { SduiDevPanel } from './SduiDevPanel';
import { SduiRawJsonBlock, isSduiDeveloperModeEnabled } from './SduiDevTools';
import {
    extractImageUrls,
    getImageDedupeKey,
    extractMessageAttachments,
    formatFileSize,
    getAttachmentDisplayName,
    looksLikeAttachmentPathText,
} from './sduiAttachmentUtils';
import { renderTextWithLinks } from './sduiLinkText';
import {
    canWriteToChat,
    extractNewsId,
    getChatName,
    getChatPreview,
    getChatTimestamp,
    getLinkedNews,
    getMessageChatId,
    getMessageDateTime,
    getMessageDeletePermission,
    getMessageInfoPermission,
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
    isDeletedMessage,
    isInfoMessage,
    mergeUniqueMessages,
    normalizeArrayResponse,
    normalizeReaderList,
    normalizeTextForComparison,
    shouldHideDuplicateAttachmentText,
} from './sduiChatUtils';

type SduiChatItem = any;
type SduiMessage = any;
type SduiNews = any;

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
    const messageElementsRef = useRef<Record<string, HTMLDivElement | null>>(
        {},
    );
    const replyHighlightTimeoutRef = useRef<number | null>(null);

    const selectedChatId = useMemo(
        () => (selectedChat ? getMessageChatId(selectedChat) : ''),
        [selectedChat],
    );
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
                                            w-full text-left rounded-lg border px-3 py-2 transition-colors sdui-animate-stagger
                                        ${
                                            active
                                                ? 'border-blue-300 bg-blue-100 dark:border-blue-700 dark:bg-blue-900/40'
                                                : unread
                                                  ? 'border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-900/20'
                                                  : 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700/50'
                                        }
                                    `}
                                                style={{
                                                    animationDelay: `${Math.min(index, 10) * 24}ms`,
                                                }}
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
                                                    extractImageUrls(
                                                        linkedNews,
                                                    );
                                                const newsImageKeys = new Set(
                                                    newsImages.map((src) =>
                                                        getImageDedupeKey(src),
                                                    ),
                                                );
                                                const messageAttachments =
                                                    extractMessageAttachments(
                                                        message,
                                                    );
                                                const visibleImageAttachments =
                                                    messageAttachments.filter(
                                                        (attachment) => {
                                                            if (
                                                                !attachment.isImage
                                                            ) {
                                                                return false;
                                                            }

                                                            if (
                                                                hiddenImageUrls[
                                                                    attachment
                                                                        .url
                                                                ]
                                                            ) {
                                                                return false;
                                                            }

                                                            if (
                                                                actionKey !==
                                                                'news.posted'
                                                            ) {
                                                                return true;
                                                            }

                                                            return !newsImageKeys.has(
                                                                getImageDedupeKey(
                                                                    attachment.url,
                                                                ),
                                                            );
                                                        },
                                                    );
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
                                                const canJumpToReplyReference =
                                                    Boolean(
                                                        replyReferencePreview?.uuid,
                                                    );
                                                const isHighlightedMessage =
                                                    highlightedMessageKey ===
                                                    messageKey;
                                                const linkClassName = info
                                                    ? 'underline decoration-amber-400/80 underline-offset-2 text-amber-800 dark:text-amber-200 hover:text-amber-900 dark:hover:text-amber-100'
                                                    : 'underline decoration-blue-400/80 underline-offset-2 text-blue-700 dark:text-blue-300 hover:text-blue-800 dark:hover:text-blue-200';

                                                return (
                                                    <div
                                                        key={messageKey}
                                                        ref={(element) => {
                                                            if (element) {
                                                                messageElementsRef.current[
                                                                    messageKey
                                                                ] = element;
                                                            } else {
                                                                delete messageElementsRef
                                                                    .current[
                                                                    messageKey
                                                                ];
                                                            }
                                                        }}
                                                        className={`max-w-[90%] rounded-2xl border px-3 py-2 transition-all duration-300 ${
                                                            info
                                                                ? 'border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20'
                                                                : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800'
                                                        } ${
                                                            isHighlightedMessage
                                                                ? 'ring-2 ring-sky-400/90 dark:ring-sky-500/90 shadow-[0_0_0_4px_rgba(14,165,233,0.16)]'
                                                                : ''
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
                                                            <button
                                                                type="button"
                                                                onClick={() => {
                                                                    if (
                                                                        replyReferencePreview.uuid
                                                                    ) {
                                                                        jumpToMessageByUuid(
                                                                            replyReferencePreview.uuid,
                                                                        );
                                                                    }
                                                                }}
                                                                disabled={
                                                                    !canJumpToReplyReference
                                                                }
                                                                className={`mb-2 w-full rounded-xl border border-slate-200/90 dark:border-slate-700/80 bg-linear-to-br from-slate-50 via-slate-50 to-indigo-50/60 dark:from-slate-900/70 dark:via-slate-900/65 dark:to-indigo-950/20 px-2.5 py-1.5 text-left transition ${
                                                                    canJumpToReplyReference
                                                                        ? 'cursor-pointer hover:border-slate-300 dark:hover:border-slate-600 hover:from-slate-100 hover:to-indigo-100/60 dark:hover:from-slate-800/80 dark:hover:to-indigo-900/30'
                                                                        : 'cursor-default'
                                                                }`}
                                                            >
                                                                <div className="text-[10px] font-semibold text-slate-600 dark:text-slate-300">
                                                                    Antwort auf{' '}
                                                                    {
                                                                        replyReferencePreview.sender
                                                                    }
                                                                    {replyReferencePreview.time
                                                                        ? ` • ${replyReferencePreview.time}`
                                                                        : ''}
                                                                    {canJumpToReplyReference
                                                                        ? ' • Zum Original'
                                                                        : ''}
                                                                </div>
                                                                <div className="mt-0.5 text-xs text-slate-700 dark:text-slate-200 line-clamp-2">
                                                                    {replyReferencePreview.text ||
                                                                        'Nachricht'}
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
                                                                                    title={
                                                                                        attachment.name
                                                                                    }
                                                                                >
                                                                                    {getAttachmentDisplayName(
                                                                                        attachment,
                                                                                    )}
                                                                                </span>
                                                                            </div>
                                                                            <span className="text-[10px] font-semibold text-cyan-700 dark:text-cyan-300 shrink-0">
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

                                                        {isSduiDevMode && (
                                                            <div className="mt-2">
                                                                <SduiRawJsonBlock
                                                                    title="Raw Message / Linked News / Permissions"
                                                                    data={{
                                                                        message,
                                                                        linkedNews,
                                                                        attachments:
                                                                            messageAttachments,
                                                                        permissions:
                                                                            message?.can,
                                                                        replyPreview:
                                                                            replyReferencePreview,
                                                                    }}
                                                                />
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })
                                        )}
                                        <div ref={messagesEndRef} />
                                    </main>

                                    <footer
                                        className={`border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 pt-3 ${
                                            shouldCompactComposerSpacing
                                                ? 'pb-3'
                                                : 'pb-[calc(env(safe-area-inset-bottom)+0.75rem)]'
                                        } md:p-3`}
                                    >
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
                                            className="flex gap-2"
                                        >
                                            <input
                                                type="text"
                                                value={draft}
                                                onChange={(e) =>
                                                    setDraft(e.target.value)
                                                }
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
