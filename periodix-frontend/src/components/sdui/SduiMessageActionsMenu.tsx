import type { MouseEvent } from 'react';

interface SduiMessageActionsMenuProps {
    hasMenuActions: boolean;
    isOpen: boolean;
    canReplyToMessage: boolean;
    canCopyMessage: boolean;
    canViewMessageInfo: boolean;
    canDeleteMessage: boolean;
    isCopiedThisMessage: boolean;
    isDeletingThisMessage: boolean;
    onToggle: (event: MouseEvent<HTMLButtonElement>) => void;
    onReply: () => void;
    onCopy: () => void;
    onInfo: () => void;
    onDelete: () => void;
}

export function SduiMessageActionsMenu({
    hasMenuActions,
    isOpen,
    canReplyToMessage,
    canCopyMessage,
    canViewMessageInfo,
    canDeleteMessage,
    isCopiedThisMessage,
    isDeletingThisMessage,
    onToggle,
    onReply,
    onCopy,
    onInfo,
    onDelete,
}: SduiMessageActionsMenuProps) {
    if (!hasMenuActions) return null;

    return (
        <div className="relative" data-sdui-message-menu="true">
            <button
                type="button"
                onClick={onToggle}
                className="h-6 w-6 rounded-full border border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
                aria-label="Nachrichtenaktionen"
            >
                <svg
                    className="w-4 h-4 mx-auto"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    aria-hidden="true"
                >
                    <circle cx="6" cy="12" r="1.8" />
                    <circle cx="12" cy="12" r="1.8" />
                    <circle cx="18" cy="12" r="1.8" />
                </svg>
            </button>

            {isOpen && (
                <div className="absolute right-0 mt-1 w-36 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg z-20 overflow-hidden">
                    {canReplyToMessage && (
                        <button
                            type="button"
                            onClick={onReply}
                            className="w-full text-left px-3 py-2 text-xs hover:bg-slate-100 dark:hover:bg-slate-800"
                        >
                            Antworten
                        </button>
                    )}
                    {canCopyMessage && (
                        <button
                            type="button"
                            onClick={onCopy}
                            className="w-full text-left px-3 py-2 text-xs hover:bg-slate-100 dark:hover:bg-slate-800"
                        >
                            {isCopiedThisMessage ? 'Kopiert' : 'Kopieren'}
                        </button>
                    )}
                    {canViewMessageInfo && (
                        <button
                            type="button"
                            onClick={onInfo}
                            className="w-full text-left px-3 py-2 text-xs hover:bg-slate-100 dark:hover:bg-slate-800"
                        >
                            Info
                        </button>
                    )}
                    {canDeleteMessage && (
                        <button
                            type="button"
                            onClick={onDelete}
                            disabled={isDeletingThisMessage}
                            className="w-full text-left px-3 py-2 text-xs text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-60"
                        >
                            {isDeletingThisMessage ? 'Löscht...' : 'Löschen'}
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}
