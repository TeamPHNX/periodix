type FallbackNoticeModalData = {
    reason: string;
    errorCode?: string | number;
    errorMessage?: string;
};

interface FallbackNoticeModalProps {
    notice: FallbackNoticeModalData | null;
    fallbackModalMessage: string | null;
    fallbackNoticeTimestamp: string | null;
    fallbackNoticeCheckedTimestamp: string | null;
    onDismiss: () => void;
    onOpenSettings: () => void;
}

export default function FallbackNoticeModal({
    notice,
    fallbackModalMessage,
    fallbackNoticeTimestamp,
    fallbackNoticeCheckedTimestamp,
    onDismiss,
    onOpenSettings,
}: FallbackNoticeModalProps) {
    if (!notice) return null;

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 px-4"
            onClick={onDismiss}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="cached-timetable-title"
        >
            <div
                className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 shadow-2xl border border-slate-200 dark:border-slate-700 p-6 relative"
                onClick={(event) => event.stopPropagation()}
            >
                <button
                    onClick={onDismiss}
                    className="absolute right-3 top-3 rounded-full p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:text-slate-500 dark:hover:text-slate-300 dark:hover:bg-slate-800"
                    aria-label="Dismiss cached timetable notice"
                >
                    <svg
                        className="w-4 h-4"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                    >
                        <path
                            d="M6 6l12 12M6 18L18 6"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        />
                    </svg>
                </button>
                <h2
                    id="cached-timetable-title"
                    className="text-xl font-semibold text-slate-900 dark:text-slate-100"
                >
                    Cached timetable loaded
                </h2>
                {fallbackModalMessage && (
                    <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
                        {fallbackModalMessage}
                    </p>
                )}
                {fallbackNoticeTimestamp && (
                    <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
                        Last synced {fallbackNoticeTimestamp}.
                        {fallbackNoticeCheckedTimestamp && (
                            <> Checked {fallbackNoticeCheckedTimestamp}.</>
                        )}
                    </p>
                )}
                {notice.errorMessage && (
                    <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">
                        {notice.errorMessage}
                    </p>
                )}
                {notice.errorCode && (
                    <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
                        Code: {notice.errorCode}
                    </p>
                )}
                <div className="mt-6 flex flex-wrap justify-end gap-2">
                    {notice.reason === 'BAD_CREDENTIALS' && (
                        <button
                            className="rounded-lg border border-indigo-500 px-4 py-2 text-sm font-medium text-indigo-600 hover:bg-indigo-50 dark:border-indigo-400 dark:text-indigo-300 dark:hover:bg-indigo-900/40"
                            onClick={onOpenSettings}
                        >
                            Open settings
                        </button>
                    )}
                    <button
                        className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-400"
                        onClick={onDismiss}
                    >
                        Got it
                    </button>
                </div>
            </div>
        </div>
    );
}
