import { useState } from 'react';

// Natural aspect ratios of images seen this session, so a chat that is opened
// again lays its images out at their final size before they load. Keyed by
// the original URL: the preview and the original share the aspect ratio.
const aspectRatioCache = new Map<string, number>();
const DEFAULT_ASPECT_RATIO = 4 / 3;

interface SduiChatImageProps {
    /** The original image. */
    src: string;
    /** A smaller copy to show inline instead; falls back to `src` on error. */
    previewSrc?: string;
    alt: string;
    /**
     * 'contain': full width, height from the image's aspect ratio (4:3 until
     * known), capped at 28rem. 'cover': fixed-height tile for image grids.
     */
    fit: 'contain' | 'cover';
    /** Called when neither the preview nor the original could be loaded. */
    onError: () => void;
}

/**
 * Chat image that occupies its space before it has loaded, so images loading
 * while scrolling do not push the message list around. SDUI does not send
 * image dimensions, so the first load of an image may still resize its box
 * once; the chat's scroll anchoring keeps the visible messages in place.
 */
export function SduiChatImage({
    src,
    previewSrc,
    alt,
    fit,
    onError,
}: SduiChatImageProps) {
    const [aspectRatio, setAspectRatio] = useState(() =>
        aspectRatioCache.get(src),
    );
    const [usePreview, setUsePreview] = useState(Boolean(previewSrc));
    const [loaded, setLoaded] = useState(false);

    return (
        <img
            src={usePreview && previewSrc ? previewSrc : src}
            alt={alt}
            loading="lazy"
            decoding="async"
            onLoad={(event) => {
                const { naturalWidth, naturalHeight } = event.currentTarget;
                if (naturalWidth > 0 && naturalHeight > 0) {
                    const ratio = naturalWidth / naturalHeight;
                    aspectRatioCache.set(src, ratio);
                    setAspectRatio(ratio);
                }
                setLoaded(true);
            }}
            onError={() => {
                if (usePreview) {
                    // e.g. a fresh upload whose preview isn't generated yet
                    setUsePreview(false);
                    return;
                }
                onError();
            }}
            style={
                fit === 'contain'
                    ? { aspectRatio: aspectRatio ?? DEFAULT_ASPECT_RATIO }
                    : undefined
            }
            className={`block w-full bg-slate-100 dark:bg-slate-800 ${
                fit === 'contain'
                    ? 'max-h-112 object-contain'
                    : 'h-36 object-cover'
            } ${loaded ? '' : 'animate-pulse'}`}
        />
    );
}
