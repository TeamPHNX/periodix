import type { FC } from 'react';

interface SubstitutionNoteIconProps {
    className?: string;
}

// Clipboard: substitution notes are mostly assignments ("Arbeitsauftrag")
const SubstitutionNoteIcon: FC<SubstitutionNoteIconProps> = ({
    className = 'w-2 h-2 text-white',
}) => {
    return (
        <svg
            className={className}
            fill="currentColor"
            viewBox="0 0 20 20"
            xmlns="http://www.w3.org/2000/svg"
        >
            {/* Clip */}
            <rect x="7" y="1" width="6" height="3.5" rx="1.25" />
            {/* Board with two text lines cut out */}
            <path
                fillRule="evenodd"
                clipRule="evenodd"
                d="M5 3h1v1a1.5 1.5 0 0 0 1.5 1.5h5A1.5 1.5 0 0 0 14 4V3h1a2 2 0 0 1 2 2v11.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm2 6.25a1 1 0 0 0 0 2h6a1 1 0 1 0 0-2H7Zm0 4a1 1 0 1 0 0 2h4a1 1 0 1 0 0-2H7Z"
            />
        </svg>
    );
};

export default SubstitutionNoteIcon;
