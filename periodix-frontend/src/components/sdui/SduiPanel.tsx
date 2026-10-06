import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { SduiChat } from './SduiChat';

interface SduiPanelProps {
    isOpen: boolean;
    onClose: () => void;
}

export default function SduiPanel({ isOpen, onClose }: SduiPanelProps) {
    const [animating, setAnimating] = useState(false);
    const [hasOpenedOnce, setHasOpenedOnce] = useState(false);
    const panelRef = useRef<HTMLDivElement | null>(null);
    const appScrollSnapshotRef = useRef(0);

    useEffect(() => {
        if (isOpen) {
            setHasOpenedOnce(true);
            const appScroll = document.getElementById('app-scroll');
            appScrollSnapshotRef.current = appScroll
                ? appScroll.scrollTop
                : window.scrollY;
            requestAnimationFrame(() => setAnimating(true));
        } else {
            setAnimating(false);
        }
    }, [isOpen]);

    if (!hasOpenedOnce) return null;

    const restoreViewportAfterClose = () => {
        const activeElement = document.activeElement as HTMLElement | null;
        if (activeElement && panelRef.current?.contains(activeElement)) {
            activeElement.blur();
        }

        const restoreScroll = () => {
            const appScroll = document.getElementById('app-scroll');
            if (appScroll) {
                appScroll.scrollTop = appScrollSnapshotRef.current;
            }

            // iOS/PWA can leave window scrolled after keyboard close.
            window.scrollTo(0, 0);
        };

        requestAnimationFrame(() => {
            restoreScroll();
            requestAnimationFrame(restoreScroll);
            window.setTimeout(restoreScroll, 180);
        });
    };

    const handleRequestClose = () => {
        restoreViewportAfterClose();
        onClose();
    };

    const handleBackdropClick = (e: React.MouseEvent) => {
        if (e.target === e.currentTarget) {
            handleRequestClose();
        }
    };

    return createPortal(
        <div
            className={`fixed inset-0 z-50 flex items-stretch md:items-center md:justify-center bg-slate-950/45 backdrop-blur-md transition-opacity duration-300 ${animating ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
            onClick={handleBackdropClick}
        >
            <div
                ref={panelRef}
                className={`relative flex h-dvh w-full min-h-0 flex-col overflow-hidden bg-white shadow-2xl transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] dark:bg-slate-900 md:h-[96dvh] md:w-[min(96vw,1120px)] md:rounded-3xl md:border md:border-white/50 dark:md:border-slate-700/70 ${animating ? 'sdui-animate-shell translate-y-0 md:scale-100' : 'translate-y-6 md:translate-y-3 md:scale-[0.985]'}`}
            >
                <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-linear-to-r from-cyan-500/10 via-sky-500/10 to-emerald-500/10 sdui-animate-float" />
                <div
                    className={`relative flex items-center justify-between gap-4 border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur dark:border-slate-800 dark:bg-slate-900/90 md:px-5 ${animating ? 'sdui-animate-content' : ''}`}
                >
                    <div className="min-w-0">
                        <h2 className="truncate text-lg font-semibold text-slate-900 dark:text-white">
                            SDUI Integration
                        </h2>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                            Chats und News in einem fokussierten Fenster.
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={handleRequestClose}
                        className="rounded-full border border-slate-200 p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                        aria-label="SDUI-Fenster schliessen"
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
                                d="M6 18L18 6M6 6l12 12"
                            />
                        </svg>
                    </button>
                </div>
                <div className="relative min-h-0 w-full flex-1 overflow-hidden">
                    <SduiChat />
                </div>
            </div>
        </div>,
        document.body,
    );
}
