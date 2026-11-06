import { useState } from 'react';
import { createPortal } from 'react-dom';

export interface SduiLightboxImage {
    /** The original file; this is what the lightbox ends up showing. */
    url: string;
    /** Smaller copy already loaded inline, shown until the original is ready. */
    previewUrl?: string;
}

interface SduiImageLightboxProps {
    image: SduiLightboxImage;
    onClose: () => void;
}

/**
 * Full-screen image view. Always loads the original file. While it loads,
 * the (already cached) preview is shown with a hint, so the view opens
 * instantly but never stays on the reduced-quality copy.
 */
export function SduiImageLightbox({ image, onClose }: SduiImageLightboxProps) {
    const [originalLoaded, setOriginalLoaded] = useState(false);
    const [originalFailed, setOriginalFailed] = useState(false);
    const showPreview =
        Boolean(image.previewUrl) && !originalLoaded && !originalFailed;

    // Portal to <body>: the SDUI panel would otherwise contain (and clip)
    // the fixed overlay, so the image would not get the full screen.
    return createPortal(
        <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
            onClick={(event) => {
                // Rendered through a portal, so React would still bubble the
                // click into the chat and the SDUI panel; keep it here.
                event.stopPropagation();
                onClose();
            }}
            role="dialog"
            aria-modal="true"
            aria-label="Bildvorschau"
        >
            <button
                type="button"
                className="absolute top-4 right-4 h-10 w-10 rounded-full bg-black/50 text-white hover:bg-black/70 text-2xl leading-none"
                onClick={onClose}
                aria-label="Schliessen"
            >
                ×
            </button>
            <div
                className="relative max-w-[95vw] max-h-[90vh]"
                onClick={(event) => event.stopPropagation()}
            >
                {showPreview && (
                    <img
                        src={image.previewUrl}
                        alt=""
                        className="max-w-[95vw] max-h-[90vh] w-auto h-auto object-contain rounded-lg"
                    />
                )}
                <img
                    src={image.url}
                    alt=""
                    onLoad={() => setOriginalLoaded(true)}
                    onError={() => setOriginalFailed(true)}
                    className={`max-w-[95vw] max-h-[90vh] w-auto h-auto object-contain rounded-lg ${
                        showPreview ? 'hidden' : ''
                    }`}
                />
                {!originalLoaded && !originalFailed && (
                    <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-2 rounded-full bg-black/60 px-3 py-1 text-xs text-white">
                        <span className="h-3 w-3 rounded-full border-2 border-white/40 border-t-white animate-spin" />
                        Original wird geladen…
                    </div>
                )}
                {originalFailed && (
                    <div className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-red-600/80 px-3 py-1 text-xs text-white">
                        Original konnte nicht geladen werden
                    </div>
                )}
            </div>
        </div>,
        document.body,
    );
}
