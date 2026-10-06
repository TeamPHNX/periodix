import type { ReactNode } from 'react';

export interface OnboardingStep {
    title: string;
    description: string;
    image?: string;
    icon: ReactNode;
    target?: string;
    position?: 'top' | 'bottom' | 'left' | 'right' | 'center';
    demoType?:
        | 'highlight'
        | 'click'
        | 'type'
        | 'point'
        | 'interactive-settings'
        | 'interactive-lesson'
        | 'modal-lesson'
        | 'modal-settings';
    requiresInteraction?: boolean;
    interactionCompleted?: boolean;
    modalStep?: boolean;
}

export const LESSON_MODAL_STEPS: OnboardingStep[] = [
    {
        title: 'Lesson Details',
        description:
            'Here you can see detailed information about this lesson, including teacher names, room locations, and any additional notes.',
        modalStep: true,
        demoType: 'modal-lesson',
        target: '.lesson-details, .lesson-info',
        position: 'center',
        icon: (
            <svg
                className="w-12 h-12 text-indigo-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
            >
                <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="1.5"
                    d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
            </svg>
        ),
    },
    {
        title: 'Customize Color',
        description:
            'Use the color picker below to customize the appearance of this lesson in your timetable. Choose from predefined colors or create your own custom color.',
        modalStep: true,
        demoType: 'modal-lesson',
        target: '.color-picker, [data-color-picker], .customize-color',
        position: 'center',
        icon: (
            <svg
                className="w-12 h-12 text-purple-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
            >
                <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="1.5"
                    d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zM21 5a2 2 0 00-2-2h-4a2 2 0 00-2 2v6a2 2 0 002 2h4a2 2 0 002-2V5z"
                />
            </svg>
        ),
    },
];

export const SETTINGS_MODAL_STEPS: OnboardingStep[] = [
    {
        title: 'Profile Settings',
        description:
            'Customize your display name, sharing preferences, and notification settings. These settings help you personalize your Periodix experience.',
        modalStep: true,
        demoType: 'modal-settings',
        target: '.settings-section, .profile-settings',
        position: 'center',
        icon: (
            <svg
                className="w-12 h-12 text-amber-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
            >
                <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="1.5"
                    d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                />
            </svg>
        ),
    },
    {
        title: 'Sharing & Privacy',
        description:
            'Control who can see your timetable and manage your privacy settings. You can share with specific users or enable global sharing.',
        modalStep: true,
        demoType: 'modal-settings',
        target: '.sharing-settings, .privacy-settings',
        position: 'center',
        icon: (
            <svg
                className="w-12 h-12 text-emerald-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
            >
                <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="1.5"
                    d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                />
            </svg>
        ),
    },
    {
        title: 'Notifications',
        description:
            'Configure your notification preferences to stay updated with important timetable changes and announcements.',
        modalStep: true,
        demoType: 'modal-settings',
        target: '.notification-settings, .notifications-section',
        position: 'center',
        icon: (
            <svg
                className="w-12 h-12 text-sky-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
            >
                <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="1.5"
                    d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
                />
            </svg>
        ),
    },
];

export const ONBOARDING_STEPS: OnboardingStep[] = [
    {
        title: 'Welcome to Periodix!',
        description:
            "Let's take a quick tour of the key features that will help you manage your timetable more effectively.",
        position: 'center',
        icon: (
            <svg
                className="w-12 h-12 text-sky-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
            >
                <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="1.5"
                    d="M12 3v18m9-9H3"
                />
            </svg>
        ),
    },
    {
        title: 'Explore Lessons & Customize Colors',
        description:
            'Click on any lesson in your timetable to see detailed information, including teacher names, room locations, and customize its color. Go ahead - try clicking on a lesson now!',
        target: '.timetable-lesson',
        position: 'right',
        demoType: 'interactive-lesson',
        requiresInteraction: true,
        icon: (
            <svg
                className="w-12 h-12 text-purple-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
            >
                <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="1.5"
                    d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zM21 5a2 2 0 00-2-2h-4a2 2 0 00-2 2v6a2 2 0 002 2h4a2 2 0 002-2V5z"
                />
            </svg>
        ),
    },
    {
        title: 'Share & View Timetables',
        description:
            "Use the search feature to find and view other students' timetables. Perfect for coordinating study groups or finding shared free periods. The search bar is located at the top of the page.",
        target: 'input[placeholder*="Student"], #mobile-search-input',
        position: 'bottom',
        demoType: 'highlight',
        icon: (
            <svg
                className="w-12 h-12 text-emerald-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
            >
                <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="1.5"
                    d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                />
            </svg>
        ),
    },
    {
        title: 'Personalize Your Profile',
        description:
            'Click the settings icon in the top right to explore your profile settings and customization options. Try opening the settings now!',
        target: 'button[title="Settings"], button[aria-label="Settings"]',
        position: 'bottom',
        demoType: 'interactive-settings',
        requiresInteraction: true,
        icon: (
            <svg
                className="w-12 h-12 text-amber-500"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
            >
                <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="1.5"
                    d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                />
            </svg>
        ),
    },
];
