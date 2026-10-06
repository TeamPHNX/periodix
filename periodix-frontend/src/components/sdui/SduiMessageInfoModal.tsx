/* eslint-disable @typescript-eslint/no-explicit-any */

interface SduiMessageInfoModalProps {
    messageInfoTarget: any | null;
    loadingMessageReaders: boolean;
    messageInfoError: string | null;
    messageReaders: any[];
    serializedMessageInfo: string;
    onClose: () => void;
    getMessageSender: (message: any) => string;
    getMessageDateTime: (message: any) => string;
    getMessageUuid: (message: any) => string;
    getReaderName: (reader: any) => string;
}

export function SduiMessageInfoModal({
    messageInfoTarget,
    loadingMessageReaders,
    messageInfoError,
    messageReaders,
    serializedMessageInfo,
    onClose,
    getMessageSender,
    getMessageDateTime,
    getMessageUuid,
    getReaderName,
}: SduiMessageInfoModalProps) {
    if (!messageInfoTarget) return null;

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
            onClick={onClose}
            role="dialog"
            aria-modal="true"
            aria-label="Nachrichteninformationen"
        >
            <div
                className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xl"
                onClick={(event) => event.stopPropagation()}
            >
                <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 dark:border-slate-700 bg-white/95 dark:bg-slate-900/95 px-4 py-3 backdrop-blur">
                    <h3 className="text-sm font-semibold">Nachrichteninfo</h3>
                    <button
                        type="button"
                        onClick={onClose}
                        className="rounded-full h-8 w-8 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                        aria-label="Schliessen"
                    >
                        ×
                    </button>
                </div>

                <div className="p-4 space-y-4 text-sm">
                    <div className="grid grid-cols-[110px_1fr] gap-x-2 gap-y-1 text-xs">
                        <span className="text-slate-500 dark:text-slate-400">
                            Absender
                        </span>
                        <span>{getMessageSender(messageInfoTarget)}</span>

                        <span className="text-slate-500 dark:text-slate-400">
                            Zeitpunkt
                        </span>
                        <span>{getMessageDateTime(messageInfoTarget)}</span>

                        <span className="text-slate-500 dark:text-slate-400">
                            Nachricht-ID
                        </span>
                        <span className="break-all">
                            {getMessageUuid(messageInfoTarget) || 'Keine ID'}
                        </span>

                        <span className="text-slate-500 dark:text-slate-400">
                            Typ
                        </span>
                        <span>
                            {String(
                                messageInfoTarget?.type ||
                                    messageInfoTarget?.message_type ||
                                    'Unbekannt',
                            )}
                        </span>
                    </div>

                    <div>
                        <div className="text-xs font-semibold mb-1 text-slate-600 dark:text-slate-300">
                            Gelesen von
                        </div>
                        {loadingMessageReaders ? (
                            <div className="text-xs text-slate-500 dark:text-slate-400">
                                Lade Leser...
                            </div>
                        ) : messageInfoError ? (
                            <div className="text-xs text-red-700 dark:text-red-300">
                                {messageInfoError}
                            </div>
                        ) : messageReaders.length === 0 ? (
                            <div className="text-xs text-slate-500 dark:text-slate-400">
                                Keine Leserinformationen verfuegbar.
                            </div>
                        ) : (
                            <div className="space-y-1">
                                {messageReaders.map((reader, index) => (
                                    <div
                                        key={String(
                                            reader?.id || reader?.uuid || index,
                                        )}
                                        className="flex items-center justify-between rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 px-2 py-1"
                                    >
                                        <span className="text-xs">
                                            {getReaderName(reader)}
                                        </span>
                                        <span className="text-[10px] text-slate-500 dark:text-slate-400">
                                            {reader?.read_at
                                                ? new Date(
                                                      reader.read_at,
                                                  ).toLocaleString('de-DE')
                                                : 'Gelesen'}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {serializedMessageInfo && (
                        <details>
                            <summary className="cursor-pointer text-xs font-semibold text-slate-600 dark:text-slate-300">
                                Rohdaten anzeigen
                            </summary>
                            <pre className="mt-2 max-h-56 overflow-auto rounded-md bg-slate-100 dark:bg-slate-800 p-2 text-[11px] text-slate-700 dark:text-slate-200">
                                {serializedMessageInfo}
                            </pre>
                        </details>
                    )}
                </div>
            </div>
        </div>
    );
}
