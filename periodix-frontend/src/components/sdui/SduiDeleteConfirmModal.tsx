interface SduiDeleteConfirmModalProps {
    isOpen: boolean;
    sender: string;
    messagePreview: string;
    isDeleting: boolean;
    onCancel: () => void;
    onConfirm: () => void;
}

export function SduiDeleteConfirmModal({
    isOpen,
    sender,
    messagePreview,
    isDeleting,
    onCancel,
    onConfirm,
}: SduiDeleteConfirmModalProps) {
    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
            onClick={onCancel}
            role="dialog"
            aria-modal="true"
            aria-label="Nachricht loeschen"
        >
            <div
                className="w-full max-w-md rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl"
                onClick={(event) => event.stopPropagation()}
            >
                <div className="px-5 pt-5 pb-3 border-b border-slate-200 dark:border-slate-700">
                    <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                        Nachricht loeschen?
                    </h3>
                    <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                        Diese Aktion kann nicht rueckgaengig gemacht werden.
                    </p>
                </div>

                <div className="px-5 py-4">
                    <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 p-3">
                        <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                            {sender || 'Nachricht'}
                        </div>
                        <div className="mt-1 text-sm text-slate-800 dark:text-slate-200 line-clamp-3 whitespace-pre-wrap">
                            {messagePreview || 'Nachricht'}
                        </div>
                    </div>
                </div>

                <div className="px-5 pb-5 flex items-center justify-end gap-2">
                    <button
                        type="button"
                        onClick={onCancel}
                        disabled={isDeleting}
                        className="rounded-lg border border-slate-300 dark:border-slate-600 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-60"
                    >
                        Abbrechen
                    </button>
                    <button
                        type="button"
                        onClick={onConfirm}
                        disabled={isDeleting}
                        className="rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
                    >
                        {isDeleting ? 'Loesche...' : 'Loeschen'}
                    </button>
                </div>
            </div>
        </div>
    );
}
