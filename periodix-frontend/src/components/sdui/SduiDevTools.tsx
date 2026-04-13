import { useState } from 'react';

function safeJsonStringify(value: unknown): string {
    try {
        return JSON.stringify(value, null, 2);
    } catch (error) {
        return `Could not serialize raw data: ${String(error)}`;
    }
}

export function isSduiDeveloperModeEnabled(): boolean {
    if (typeof window === 'undefined') return false;

    try {
        const devFlag = new URLSearchParams(window.location.search).get('dev');
        const queryEnabled =
            !!devFlag &&
            ['1', 'true', 'yes', 'on'].includes(devFlag.toLowerCase());
        const persistedEnabled =
            window.localStorage.getItem('PeriodixDevActive') === '1';
        return queryEnabled || persistedEnabled;
    } catch {
        return false;
    }
}

export function SduiRawJsonBlock({
    title,
    data,
    initiallyOpen = false,
}: {
    title: string;
    data: unknown;
    initiallyOpen?: boolean;
}) {
    const [isOpen, setIsOpen] = useState<boolean>(initiallyOpen);

    return (
        <details
            open={isOpen}
            onToggle={(event) => {
                setIsOpen((event.currentTarget as HTMLDetailsElement).open);
            }}
            className="rounded-lg border border-indigo-200/80 bg-indigo-50/50 dark:border-indigo-900/70 dark:bg-indigo-950/20"
        >
            <summary className="cursor-pointer select-none px-3 py-2 text-[11px] font-semibold text-indigo-800 dark:text-indigo-200">
                {title}
            </summary>
            {isOpen && (
                <pre className="max-h-72 overflow-auto border-t border-indigo-200/80 px-3 py-2 text-[10px] leading-relaxed text-indigo-950 dark:border-indigo-900/70 dark:text-indigo-100">
                    {safeJsonStringify(data)}
                </pre>
            )}
        </details>
    );
}
