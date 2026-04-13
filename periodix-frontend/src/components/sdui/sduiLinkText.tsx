import React from 'react';

const LINK_REGEX = /(https?:\/\/[^\s<>'"\]]+|www\.[^\s<>'"\]]+)/gi;

function toAbsoluteLink(url: string): string {
    if (/^https?:\/\//i.test(url)) return url;
    return `https://${url}`;
}

function splitTrailingLinkPunctuation(rawLink: string): {
    link: string;
    trailing: string;
} {
    const trailingMatch = rawLink.match(/[),.;!?]+$/);
    if (!trailingMatch || trailingMatch.index == null) {
        return { link: rawLink, trailing: '' };
    }

    return {
        link: rawLink.slice(0, trailingMatch.index),
        trailing: rawLink.slice(trailingMatch.index),
    };
}

export function renderTextWithLinks(
    text: string,
    linkClassName: string,
): React.ReactNode {
    if (!text) return text;

    const parts: React.ReactNode[] = [];
    const regex = new RegExp(LINK_REGEX.source, 'gi');
    let lastIndex = 0;
    let linkIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(text)) !== null) {
        const rawMatch = match[0];
        const matchIndex = match.index;

        if (matchIndex > lastIndex) {
            parts.push(text.slice(lastIndex, matchIndex));
        }

        const { link, trailing } = splitTrailingLinkPunctuation(rawMatch);
        if (link) {
            parts.push(
                <a
                    key={`link-${matchIndex}-${linkIndex}`}
                    href={toAbsoluteLink(link)}
                    target="_blank"
                    rel="noreferrer noopener"
                    className={linkClassName}
                >
                    {link}
                </a>,
            );
            linkIndex += 1;
        }

        if (trailing) {
            parts.push(trailing);
        }

        lastIndex = matchIndex + rawMatch.length;
    }

    if (lastIndex < text.length) {
        parts.push(text.slice(lastIndex));
    }

    return parts;
}
