import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { SduiChat } from './SduiChat';

interface SduiPanelProps {
    isOpen: boolean;
    onClose: () => void;
}

export default function SduiPanel({ isOpen, onClose }: SduiPanelProps) {
    const [animating, setAnimating] = useState(false);
    const [hasOpenedOnce, setHasOpenedOnce] = useState(false);

    useEffect(() => {
        if (isOpen) {
            setHasOpenedOnce(true);
            requestAnimationFrame(() => setAnimating(true));
        } else {
            setAnimating(false);
        }
    }, [isOpen]);

    if (!hasOpenedOnce) return null;

    const handleBackdropClick = (e: React.MouseEvent) => {
        if (e.target === e.currentTarget) {
            onClose();
        }
    };

    return createPortal(
        <div
            className={`fixed inset-0 z-50 flex justify-end bg-black/20 backdrop-blur-sm transition-opacity duration-300 ${animating ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
            onClick={handleBackdropClick}
        >
            <div
                className={`w-full max-w-md md:max-w-5xl bg-white dark:bg-slate-900 shadow-xl h-dvh md:h-full min-h-0 flex flex-col transition-transform duration-300 ${animating ? '' : 'translate-x-full'}`}
            >
                <div className="flex items-center justify-between p-4 border-b border-slate-200 dark:border-slate-800">
                    <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                        SDUI
                    </h2>
                    <button
                        onClick={onClose}
                        className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 transition-colors"
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
                <div className="min-h-0 flex-1 overflow-hidden w-full">
                    <SduiChat />
                </div>
            </div>
        </div>,
        document.body,
    );
}
