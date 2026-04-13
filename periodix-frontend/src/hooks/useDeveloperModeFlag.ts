import { useEffect, useState } from 'react';

function readBooleanQueryParam(paramName: string): boolean {
    if (typeof window === 'undefined') return false;

    try {
        const value = new URLSearchParams(window.location.search).get(
            paramName,
        );
        return (
            !!value && ['1', 'true', 'yes', 'on'].includes(value.toLowerCase())
        );
    } catch {
        return false;
    }
}

export function useDeveloperModeFlag() {
    const envDevFlag =
        String(import.meta.env.VITE_ENABLE_DEVELOPER_MODE ?? '')
            .trim()
            .toLowerCase() === 'true';

    // Only allow toggle if env flag OR query param present right now
    const isDeveloperModeEnabled = envDevFlag || readBooleanQueryParam('dev');

    const [isDeveloperMode, setIsDeveloperMode] = useState<boolean>(() => {
        if (typeof window === 'undefined') return false;
        try {
            return localStorage.getItem('PeriodixDevActive') === '1';
        } catch {
            return false;
        }
    });

    // Debug instrumentation flag (enabled if developer mode OR explicit debug query ?ttdebug=1)
    const isDebug =
        isDeveloperMode || readBooleanQueryParam('ttdebug') || false;

    useEffect(() => {
        try {
            localStorage.setItem(
                'PeriodixDevActive',
                isDeveloperMode ? '1' : '0',
            );
        } catch {
            /* ignore */
        }
    }, [isDeveloperMode]);

    useEffect(() => {
        if (!isDeveloperModeEnabled && isDeveloperMode) {
            setIsDeveloperMode(false);
        }
    }, [isDeveloperModeEnabled, isDeveloperMode]);

    return {
        isDeveloperModeEnabled,
        isDeveloperMode,
        setIsDeveloperMode,
        isDebug,
    };
}
