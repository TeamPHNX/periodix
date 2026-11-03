/* eslint-disable @typescript-eslint/no-explicit-any */
import { getChatName, getChatPreview, getMessageChatId } from './sduiChatUtils';
import {
    formatChatListTime,
    getChatAvatarUrl,
    getChatColor,
    getChatHue,
    getChatInitials,
    getChatUnreadCount,
    isChatUnread,
    isOneWayChat,
} from './sduiChatListUtils';

type SduiChatItem = any;

interface SduiChatListProps {
    pinnedChats: SduiChatItem[];
    otherChats: SduiChatItem[];
    totalChats: number;
    unreadChatCount: number;
    selectedChatId: string;
    searchQuery: string;
    filter: 'all' | 'unread';
    errorMsg: string | null;
    failedAvatarIds: Record<string, true>;
    onSearchChange: (value: string) => void;
    onFilterChange: (value: 'all' | 'unread') => void;
    onSelectChat: (chat: SduiChatItem) => void;
    onAvatarError: (chatId: string) => void;
}

export function PinIcon({ className = 'h-3.5 w-3.5' }: { className?: string }) {
    return (
        <svg
            className={className}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <path d="M12 17v5" />
            <path d="M9 10.76V6h6v4.76a2 2 0 0 0 .55 1.38l1.9 2A1 1 0 0 1 16.72 16H7.28a1 1 0 0 1-.73-1.86l1.9-2A2 2 0 0 0 9 10.76Z" />
            <path d="M8 2h8" />
        </svg>
    );
}

function MutedIcon() {
    return (
        <svg
            className="h-3.5 w-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-label="Stummgeschaltet"
        >
            <path d="M11 5 6 9H2v6h4l5 4V5Z" />
            <path d="m22 9-6 6M16 9l6 6" />
        </svg>
    );
}

function ChatAvatar({
    chat,
    failed,
    onError,
}: {
    chat: SduiChatItem;
    failed: boolean;
    onError: () => void;
}) {
    const url = failed ? null : getChatAvatarUrl(chat);
    const color = getChatColor(chat);
    const hue = getChatHue(chat);

    if (url) {
        return (
            <img
                src={url}
                alt=""
                loading="lazy"
                onError={onError}
                className="h-11 w-11 shrink-0 rounded-2xl object-cover bg-slate-200 dark:bg-slate-700"
            />
        );
    }

    return (
        <div
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-sm font-semibold text-white shadow-inner"
            style={{
                background: color
                    ? color
                    : `linear-gradient(135deg, hsl(${hue} 65% 52%), hsl(${(hue + 40) % 360} 65% 42%))`,
            }}
            aria-hidden="true"
        >
            {getChatInitials(chat)}
        </div>
    );
}

function ChatRow({
    chat,
    active,
    pinned,
    failedAvatar,
    onSelect,
    onAvatarError,
}: {
    chat: SduiChatItem;
    active: boolean;
    pinned: boolean;
    failedAvatar: boolean;
    onSelect: () => void;
    onAvatarError: () => void;
}) {
    const unread = isChatUnread(chat);
    const unreadCount = getChatUnreadCount(chat);
    const muted = Boolean(chat?.meta?.is_muted);
    const subtitle =
        typeof chat?.meta?.subtitle === 'string' ? chat.meta.subtitle : '';

    return (
        <button
            type="button"
            onClick={onSelect}
            aria-current={active ? 'true' : undefined}
            aria-label={`${getChatName(chat)}${unread ? `, ${unreadCount} ungelesen` : ''}`}
            className={`relative flex w-full items-center gap-3 rounded-2xl px-2.5 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 ${
                active
                    ? 'bg-sky-100/80 dark:bg-sky-500/15'
                    : 'hover:bg-slate-100 dark:hover:bg-slate-800/70'
            }`}
        >
            {active && (
                <span className="absolute left-0 top-3 bottom-3 w-1 rounded-full bg-sky-500" />
            )}
            <ChatAvatar
                chat={chat}
                failed={failedAvatar}
                onError={onAvatarError}
            />
            <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                    <h3
                        className={`min-w-0 flex-1 truncate text-sm ${
                            unread
                                ? 'font-bold text-slate-900 dark:text-white'
                                : 'font-medium text-slate-800 dark:text-slate-100'
                        }`}
                    >
                        {isOneWayChat(chat) && (
                            <svg
                                className="mr-1 inline h-3 w-3 -translate-y-px text-slate-400 dark:text-slate-500"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth={2.5}
                                strokeLinecap="round"
                                aria-label="Nur Admins koennen schreiben"
                            >
                                <rect x="5" y="11" width="14" height="10" rx="2" />
                                <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                            </svg>
                        )}
                        {getChatName(chat)}
                    </h3>
                    <span
                        className={`shrink-0 text-[11px] tabular-nums ${
                            unread && !muted
                                ? 'font-semibold text-sky-600 dark:text-sky-400'
                                : 'text-slate-400 dark:text-slate-500'
                        }`}
                    >
                        {formatChatListTime(chat)}
                    </span>
                </div>
                <div className="mt-0.5 flex items-center gap-2">
                    <p
                        className={`min-w-0 flex-1 truncate text-xs ${
                            unread
                                ? 'text-slate-700 dark:text-slate-200'
                                : 'text-slate-500 dark:text-slate-400'
                        }`}
                    >
                        {subtitle && (
                            <span className="font-medium text-slate-500 dark:text-slate-400">
                                {subtitle} ·{' '}
                            </span>
                        )}
                        {getChatPreview(chat)}
                    </p>
                    <span className="flex shrink-0 items-center gap-1 text-slate-400 dark:text-slate-500">
                        {muted && <MutedIcon />}
                        {pinned && <PinIcon />}
                        {unread && (
                            <span
                                className={`min-w-5 rounded-full px-1.5 py-0.5 text-center text-[11px] font-bold leading-none text-white ${
                                    muted
                                        ? 'bg-slate-400 dark:bg-slate-600'
                                        : 'bg-sky-500'
                                }`}
                            >
                                {unreadCount > 99 ? '99+' : unreadCount}
                            </span>
                        )}
                    </span>
                </div>
            </div>
        </button>
    );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
    return (
        <div className="flex items-center gap-1.5 px-2.5 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
            {children}
        </div>
    );
}

export function SduiChatList({
    pinnedChats,
    otherChats,
    totalChats,
    unreadChatCount,
    selectedChatId,
    searchQuery,
    filter,
    errorMsg,
    failedAvatarIds,
    onSearchChange,
    onFilterChange,
    onSelectChat,
    onAvatarError,
}: SduiChatListProps) {
    const isEmpty = pinnedChats.length === 0 && otherChats.length === 0;

    const renderRows = (list: SduiChatItem[], pinned: boolean) =>
        list.map((chat, index) => {
            const chatId = getMessageChatId(chat);
            return (
                <ChatRow
                    key={chatId || index}
                    chat={chat}
                    pinned={pinned}
                    active={Boolean(chatId) && chatId === selectedChatId}
                    failedAvatar={Boolean(failedAvatarIds[chatId])}
                    onSelect={() => onSelectChat(chat)}
                    onAvatarError={() => onAvatarError(chatId)}
                />
            );
        });

    return (
        <>
            <div className="shrink-0 space-y-2 border-b border-slate-200 p-3 dark:border-slate-800">
                <label className="relative block">
                    <span className="sr-only">Chats durchsuchen</span>
                    <svg
                        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2}
                        strokeLinecap="round"
                        aria-hidden="true"
                    >
                        <circle cx="11" cy="11" r="7" />
                        <path d="m20 20-3.5-3.5" />
                    </svg>
                    <input
                        type="search"
                        value={searchQuery}
                        onChange={(event) => onSearchChange(event.target.value)}
                        placeholder="Chats durchsuchen"
                        className="w-full rounded-xl border border-transparent bg-slate-100 py-2 pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-sky-500 focus:bg-white focus:outline-none dark:bg-slate-800 dark:text-slate-100 dark:focus:bg-slate-900"
                    />
                </label>
                <div
                    className="flex gap-1.5"
                    role="radiogroup"
                    aria-label="Chatfilter"
                >
                    {(
                        [
                            ['all', 'Alle', totalChats],
                            ['unread', 'Ungelesen', unreadChatCount],
                        ] as const
                    ).map(([value, label, count]) => {
                        const selected = filter === value;
                        return (
                            <button
                                key={value}
                                type="button"
                                role="radio"
                                aria-checked={selected}
                                onClick={() => onFilterChange(value)}
                                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                                    selected
                                        ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900'
                                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
                                }`}
                            >
                                {label}
                                {count > 0 && (
                                    <span
                                        className={`rounded-full px-1.5 text-[10px] font-bold ${
                                            value === 'unread'
                                                ? 'bg-sky-500 text-white'
                                                : selected
                                                  ? 'bg-white/20 dark:bg-slate-900/15'
                                                  : 'bg-slate-200 dark:bg-slate-700'
                                        }`}
                                    >
                                        {count}
                                    </span>
                                )}
                            </button>
                        );
                    })}
                </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain px-2 pb-3">
                {errorMsg && (
                    <div className="mt-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200">
                        {errorMsg}
                    </div>
                )}

                {isEmpty ? (
                    <div className="flex flex-col items-center px-6 py-12 text-center text-sm text-slate-500 dark:text-slate-400">
                        {totalChats === 0
                            ? 'Keine Chats gefunden.'
                            : filter === 'unread' && !searchQuery
                              ? 'Alles gelesen. Keine ungelesenen Chats.'
                              : 'Kein Chat passt zur Suche.'}
                    </div>
                ) : (
                    <>
                        {pinnedChats.length > 0 && (
                            <>
                                <SectionLabel>
                                    <PinIcon className="h-3 w-3" />
                                    Angeheftet
                                </SectionLabel>
                                {renderRows(pinnedChats, true)}
                            </>
                        )}
                        {otherChats.length > 0 && (
                            <>
                                {pinnedChats.length > 0 && (
                                    <SectionLabel>Alle Chats</SectionLabel>
                                )}
                                <div className={pinnedChats.length ? '' : 'pt-2'}>
                                    {renderRows(otherChats, false)}
                                </div>
                            </>
                        )}
                    </>
                )}
            </div>
        </>
    );
}
