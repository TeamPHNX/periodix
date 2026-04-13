import { useState, useEffect, useRef, useCallback } from 'react';
import type { CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import {
    LESSON_MODAL_STEPS,
    ONBOARDING_STEPS,
    SETTINGS_MODAL_STEPS,
    type OnboardingStep,
} from './onboarding/onboardingSteps';

// Extend the Window interface for our global functions
declare global {
    interface Window {
        onboardingLessonModalStateChange?: (isOpen: boolean) => void;
        resetOnboarding?: () => void;
    }
}

export default function OnboardingModal({
    isOpen,
    onClose,
    onComplete,
    isSettingsModalOpen,
    onOpenSettings,
    onLessonModalStateChange,
    isLessonModalOpen,
}: {
    isOpen: boolean;
    onClose: () => void;
    onComplete: () => void;
    isSettingsModalOpen?: boolean;
    onOpenSettings?: () => void;
    onLessonModalStateChange?: (isOpen: boolean) => void;
    isLessonModalOpen?: boolean;
}) {
    const [showModal, setShowModal] = useState(false);
    const [isVisible, setIsVisible] = useState(false);
    const [currentStep, setCurrentStep] = useState(0);
    const [highlightedElement, setHighlightedElement] =
        useState<Element | null>(null);
    const [waitingForInteraction, setWaitingForInteraction] = useState(false);
    const [hasInteracted, setHasInteracted] = useState(false);
    const [shouldAdvanceStep, setShouldAdvanceStep] = useState(false);
    const [inModalOnboarding, setInModalOnboarding] = useState(false);
    const [modalOnboardingSteps, setModalOnboardingSteps] = useState<
        OnboardingStep[]
    >([]);
    const [modalStepIndex, setModalStepIndex] = useState(0);
    const spotlightRef = useRef<HTMLDivElement>(null);
    const pointerRef = useRef<HTMLDivElement>(null);

    const ANIM_MS = 200;

    const lessonModalSteps = LESSON_MODAL_STEPS;
    const settingsModalSteps = SETTINGS_MODAL_STEPS;
    const steps = ONBOARDING_STEPS;

    useEffect(() => {
        let t: number | undefined;
        let raf1: number | undefined;
        let raf2: number | undefined;

        if (isOpen) {
            if (!showModal) setShowModal(true);
            setIsVisible(false);
            // Use double rAF to guarantee initial styles are committed before transition
            raf1 = requestAnimationFrame(() => {
                raf2 = requestAnimationFrame(() => setIsVisible(true));
            });
        } else if (showModal) {
            setIsVisible(false);
            setHighlightedElement(null);
            t = window.setTimeout(() => {
                setShowModal(false);
                // Reset to first step when modal closes
                setCurrentStep(0);
            }, ANIM_MS);
        }

        return () => {
            if (t) window.clearTimeout(t);
            if (raf1) cancelAnimationFrame(raf1);
            if (raf2) cancelAnimationFrame(raf2);
        };
    }, [isOpen, showModal]);

    const currentStepData = inModalOnboarding
        ? modalOnboardingSteps[modalStepIndex]
        : steps[currentStep];

    // Handle step advancement
    useEffect(() => {
        if (shouldAdvanceStep) {
            setShouldAdvanceStep(false);
            // Add a small delay before advancing to avoid instant skipping
            setTimeout(() => {
                if (currentStep < steps.length - 1) {
                    setCurrentStep(currentStep + 1);
                } else {
                    // On the last step, don't auto-advance - let user click "Get Started!"
                    return;
                }
            }, 500);
        }
    }, [shouldAdvanceStep, currentStep, steps.length]);

    // Handle settings modal interaction
    useEffect(() => {
        if (
            !waitingForInteraction ||
            currentStepData.demoType !== 'interactive-settings'
        )
            return;

        if (isSettingsModalOpen && !hasInteracted) {
            setHasInteracted(true);
        }

        // When settings modal closes after being opened, mark interaction as complete
        if (!isSettingsModalOpen && hasInteracted) {
            setWaitingForInteraction(false);
            setHasInteracted(false);
            // Check if this is the last step
            if (currentStep === steps.length - 1) {
                // Don't auto-advance on the last step - wait for user action
                return;
            }
            setShouldAdvanceStep(true);
        }
    }, [
        isSettingsModalOpen,
        waitingForInteraction,
        hasInteracted,
        currentStepData,
        currentStep,
        steps.length,
    ]);

    // Handle lesson modal interaction (via callback from Timetable component)
    useEffect(() => {
        if (onLessonModalStateChange) {
            onLessonModalStateChange(
                waitingForInteraction &&
                    currentStepData.demoType === 'interactive-lesson',
            );
        }
    }, [waitingForInteraction, currentStepData, onLessonModalStateChange]);

    // Handle lesson modal opening for onboarding
    useEffect(() => {
        if (
            isLessonModalOpen &&
            currentStepData.demoType === 'interactive-lesson' &&
            hasInteracted &&
            !inModalOnboarding
        ) {
            // Start lesson modal onboarding
            setInModalOnboarding(true);
            setModalOnboardingSteps(lessonModalSteps);
            setModalStepIndex(0);
        } else if (
            !isLessonModalOpen &&
            inModalOnboarding &&
            modalOnboardingSteps === lessonModalSteps
        ) {
            // End lesson modal onboarding and continue with main tour
            setInModalOnboarding(false);
            setModalOnboardingSteps([]);
            setModalStepIndex(0);
            setWaitingForInteraction(false);
            setHasInteracted(false);

            // Continue with main onboarding after a short delay to ensure state is cleaned up
            setTimeout(() => {
                if (currentStep < steps.length - 1) {
                    setCurrentStep(currentStep + 1);
                } else {
                    // Don't auto-advance on the last step - wait for user action
                    return;
                }
            }, 200); // Increased delay to ensure proper cleanup
        }
    }, [
        isLessonModalOpen,
        currentStepData,
        hasInteracted,
        inModalOnboarding,
        modalOnboardingSteps,
        lessonModalSteps,
        currentStep,
        steps.length,
    ]);

    // Handle settings modal opening for onboarding
    useEffect(() => {
        if (
            isSettingsModalOpen &&
            currentStepData.demoType === 'interactive-settings' &&
            hasInteracted &&
            !inModalOnboarding
        ) {
            // Start settings modal onboarding
            setInModalOnboarding(true);
            setModalOnboardingSteps(settingsModalSteps);
            setModalStepIndex(0);
        } else if (
            !isSettingsModalOpen &&
            inModalOnboarding &&
            modalOnboardingSteps === settingsModalSteps
        ) {
            // End settings modal onboarding and continue with main tour
            setInModalOnboarding(false);
            setModalOnboardingSteps([]);
            setModalStepIndex(0);
            setWaitingForInteraction(false);
            setHasInteracted(false);

            // Continue with main onboarding after a short delay to ensure state is cleaned up
            setTimeout(() => {
                if (currentStep < steps.length - 1) {
                    setCurrentStep(currentStep + 1);
                } else {
                    // Don't auto-advance on the last step - wait for user action
                    return;
                }
            }, 200); // Increased delay to ensure proper cleanup
        }
    }, [
        isSettingsModalOpen,
        currentStepData,
        hasInteracted,
        inModalOnboarding,
        modalOnboardingSteps,
        settingsModalSteps,
        currentStep,
        steps.length,
    ]);

    // Method for external components to report lesson modal state changes
    const handleLessonModalStateChange = useCallback(
        (isLessonModalOpen: boolean) => {
            if (
                !waitingForInteraction ||
                currentStepData.demoType !== 'interactive-lesson'
            )
                return;

            if (isLessonModalOpen && !hasInteracted) {
                setHasInteracted(true);
            }

            // When lesson modal closes after being opened during interactive step, advance
            if (!isLessonModalOpen && hasInteracted && !inModalOnboarding) {
                setWaitingForInteraction(false);
                setHasInteracted(false);
                // Check if this is the last step
                if (currentStep === steps.length - 1) {
                    // Don't auto-advance on the last step - wait for user action
                    return;
                }
                setShouldAdvanceStep(true);
            }
        },
        [
            waitingForInteraction,
            hasInteracted,
            currentStepData,
            currentStep,
            steps.length,
            inModalOnboarding,
        ],
    );

    // Expose the handler via a global method that can be called by Timetable
    useEffect(() => {
        if (
            isOpen &&
            waitingForInteraction &&
            currentStepData.demoType === 'interactive-lesson'
        ) {
            window.onboardingLessonModalStateChange =
                handleLessonModalStateChange;
        }

        return () => {
            delete window.onboardingLessonModalStateChange;
        };
    }, [
        isOpen,
        waitingForInteraction,
        currentStepData,
        handleLessonModalStateChange,
    ]);

    // Update highlighted element when step changes
    useEffect(() => {
        if (!isOpen || !isVisible) return;

        // Handle interactive steps
        if (currentStepData.requiresInteraction) {
            setWaitingForInteraction(true);
            setHasInteracted(false);
        } else {
            setWaitingForInteraction(false);
            setHasInteracted(false);
        }

        if (currentStepData.target) {
            const findElement = () => {
                let element: Element | null = null;

                // For lesson highlighting (both interactive and regular), try multiple strategies
                if (
                    currentStepData.demoType === 'interactive-lesson' ||
                    (currentStepData.target === '.timetable-lesson' &&
                        currentStepData.demoType === 'highlight')
                ) {
                    // Try to find any visible lesson that's not too small or clipped
                    const lessons = Array.from(
                        document.querySelectorAll('.timetable-lesson'),
                    );
                    for (const lesson of lessons) {
                        const rect = lesson.getBoundingClientRect();
                        // Check if lesson is visible and has reasonable size
                        if (
                            rect.width > 50 &&
                            rect.height > 30 &&
                            rect.top >= 0 &&
                            rect.left >= 0 &&
                            rect.bottom <= window.innerHeight &&
                            rect.right <= window.innerWidth
                        ) {
                            element = lesson;
                            break;
                        }
                    }

                    // Fallback: try first visible lesson even if partially clipped
                    if (!element && lessons.length > 0) {
                        for (const lesson of lessons) {
                            const rect = lesson.getBoundingClientRect();
                            if (rect.width > 30 && rect.height > 20) {
                                element = lesson;
                                break;
                            }
                        }
                    }
                } else {
                    // For other elements, use normal querySelector
                    if (currentStepData.target) {
                        element = document.querySelector(
                            currentStepData.target,
                        );
                    }
                }

                return element;
            };

            const element = findElement();
            if (element) {
                setHighlightedElement(element);
                // Scroll element into view if needed
                element.scrollIntoView({
                    behavior: 'smooth',
                    block: 'center',
                    inline: 'center',
                });
            } else {
                setHighlightedElement(null);

                // For lessons, retry after a short delay in case they haven't rendered yet
                if (
                    currentStepData.demoType === 'interactive-lesson' ||
                    (currentStepData.target === '.timetable-lesson' &&
                        currentStepData.demoType === 'highlight')
                ) {
                    const retryTimeout = setTimeout(() => {
                        const retryElement = findElement();
                        if (retryElement) {
                            setHighlightedElement(retryElement);
                            retryElement.scrollIntoView({
                                behavior: 'smooth',
                                block: 'center',
                                inline: 'center',
                            });
                        }
                    }, 1000); // Retry after 1 second

                    return () => clearTimeout(retryTimeout);
                }
            }
        } else {
            setHighlightedElement(null);
        }
    }, [
        currentStep,
        isOpen,
        isVisible,
        currentStepData.requiresInteraction,
        currentStepData.target,
        currentStepData.demoType,
    ]);

    // Update spotlight position
    useEffect(() => {
        if (!highlightedElement || !spotlightRef.current) return;

        const updateSpotlight = () => {
            const rect = highlightedElement.getBoundingClientRect();
            const spotlight = spotlightRef.current;
            if (!spotlight) return;

            // Add some padding around the element
            const padding = 8;
            spotlight.style.left = `${rect.left - padding}px`;
            spotlight.style.top = `${rect.top - padding}px`;
            spotlight.style.width = `${rect.width + padding * 2}px`;
            spotlight.style.height = `${rect.height + padding * 2}px`;
        };

        updateSpotlight();

        // Update on resize and scroll
        const handleUpdate = () => requestAnimationFrame(updateSpotlight);
        window.addEventListener('resize', handleUpdate);
        window.addEventListener('scroll', handleUpdate, true);

        return () => {
            window.removeEventListener('resize', handleUpdate);
            window.removeEventListener('scroll', handleUpdate, true);
        };
    }, [highlightedElement]);

    // Calculate modal position based on highlighted element
    const getModalPosition = () => {
        const viewport = {
            width: window.innerWidth,
            height: window.innerHeight,
        };

        // Mobile viewport detection (768px is typical tablet breakpoint)
        const isMobile = viewport.width < 768;

        if (!highlightedElement) {
            return isMobile
                ? { useMobileBottom: true }
                : { position: 'center' };
        }

        const currentStepData = inModalOnboarding
            ? modalOnboardingSteps[modalStepIndex]
            : steps[currentStep];
        const rect = highlightedElement.getBoundingClientRect();

        // On mobile, always use bottom sheet positioning to avoid overlaps
        if (isMobile) {
            // Ensure highlighted element is visible above the modal
            // Calculate minimum space needed for the modal (approximately 400px)
            const modalHeight = 400;
            const topSpaceNeeded = viewport.height - modalHeight - 40; // 40px padding

            // If highlighted element is in the bottom half of screen, scroll it up
            if (rect.bottom > topSpaceNeeded) {
                // For search bars at top, we still use bottom positioning
                // For lessons that might be lower, scroll them up first
                if (
                    currentStepData.target === '.timetable-lesson' ||
                    currentStepData.demoType === 'interactive-lesson'
                ) {
                    highlightedElement.scrollIntoView({
                        behavior: 'smooth',
                        block: 'start', // Position at top of viewport
                    });
                }
            }

            return { useMobileBottom: true };
        }

        // Desktop positioning logic (unchanged)
        switch (currentStepData.position) {
            case 'right':
                if (rect.right + 400 < viewport.width) {
                    return {
                        position: 'fixed' as const,
                        left: rect.right + 20,
                        top: Math.max(20, rect.top - 100),
                    };
                }
                break;
            case 'left':
                if (rect.left - 400 > 0) {
                    return {
                        position: 'fixed' as const,
                        right: viewport.width - rect.left + 20,
                        top: Math.max(20, rect.top - 100),
                    };
                }
                break;
            case 'bottom':
                if (rect.bottom + 300 < viewport.height) {
                    return {
                        position: 'fixed' as const,
                        left: Math.max(20, rect.left - 100),
                        top: rect.bottom + 20,
                    };
                }
                break;
            case 'top':
                if (rect.top - 300 > 0) {
                    return {
                        position: 'fixed' as const,
                        left: Math.max(20, rect.left - 100),
                        bottom: viewport.height - rect.top + 20,
                    };
                }
                break;
        }

        // Fallback to center for desktop, mobile bottom for mobile
        return isMobile ? { useMobileBottom: true } : { useCenter: true };
    };

    const handleNext = () => {
        if (inModalOnboarding) {
            // Handle modal onboarding navigation
            if (modalStepIndex < modalOnboardingSteps.length - 1) {
                setModalStepIndex(modalStepIndex + 1);
            } else {
                // End modal onboarding and return to main tour
                // Force immediate transition back to main tour
                setInModalOnboarding(false);
                setModalOnboardingSteps([]);
                setModalStepIndex(0);

                // The modal should remain open and the next step should be the main tour continuation
                // Don't rely on modal close events - directly handle the transition
                if (currentStep < steps.length - 1) {
                    setCurrentStep(currentStep + 1);
                } else {
                    handleComplete();
                }
            }
            return;
        }

        // For interactive steps, trigger the appropriate action instead of proceeding
        if (currentStepData.requiresInteraction && !waitingForInteraction) {
            if (
                currentStepData.demoType === 'interactive-settings' &&
                onOpenSettings
            ) {
                onOpenSettings();
                setWaitingForInteraction(true);
                setHasInteracted(false);
                return;
            } else if (currentStepData.demoType === 'interactive-lesson') {
                setWaitingForInteraction(true);
                setHasInteracted(false);
                return;
            }
        }

        // If already waiting for interaction, don't proceed until interaction is complete
        if (waitingForInteraction) {
            return;
        }

        if (currentStep < steps.length - 1) {
            setCurrentStep(currentStep + 1);
        } else {
            handleComplete();
        }
    };

    const handlePrevious = () => {
        if (inModalOnboarding) {
            // Handle modal onboarding navigation
            if (modalStepIndex > 0) {
                setModalStepIndex(modalStepIndex - 1);
            }
            return;
        }

        if (currentStep > 0) {
            setCurrentStep(currentStep - 1);
        }
    };

    const handleComplete = () => {
        onComplete();
        onClose();
    };

    const handleSkip = () => {
        onComplete();
        onClose();
    };

    const handleSkipStep = () => {
        // Skip the current interactive step
        if (currentStepData.requiresInteraction && waitingForInteraction) {
            setWaitingForInteraction(false);
            setHasInteracted(false);
            if (currentStep < steps.length - 1) {
                setCurrentStep(currentStep + 1);
            } else {
                handleComplete();
            }
        }
    };

    if (!showModal) return null;

    const isFirstStep = inModalOnboarding
        ? modalStepIndex === 0
        : currentStep === 0;
    const isLastStep = inModalOnboarding
        ? modalStepIndex === modalOnboardingSteps.length - 1
        : currentStep === steps.length - 1;
    const modalPosition = getModalPosition();

    return createPortal(
        <div
            className={`fixed inset-0 ${
                inModalOnboarding ? 'z-[10000]' : 'z-50'
            } transition-opacity duration-200 ${
                isVisible ? 'opacity-100' : 'opacity-0'
            } ${
                waitingForInteraction &&
                (currentStepData.demoType === 'interactive-lesson' ||
                    currentStepData.demoType === 'interactive-settings')
                    ? 'pointer-events-none' // Allow clicks to pass through during interactive steps
                    : ''
            }`}
            onMouseDown={(e) => {
                // Only block mouse events for modal onboarding, not for interactive steps
                if (inModalOnboarding) {
                    e.preventDefault();
                    e.stopPropagation();
                }
            }}
        >
            {/* Backdrop with cutout for highlighted element */}
            <div
                className={`absolute inset-0 ${
                    waitingForInteraction &&
                    (currentStepData.demoType === 'interactive-lesson' ||
                        currentStepData.demoType === 'interactive-settings')
                        ? 'bg-black/20 pointer-events-none' // Make backdrop non-interactive during interactive steps
                        : 'backdrop-blur-sm bg-black/60'
                }`}
                onClick={(e) => {
                    // Prevent all backdrop clicks to avoid accidentally closing the onboarding
                    // But only if not waiting for interaction on interactive elements
                    if (
                        !(
                            waitingForInteraction &&
                            (currentStepData.demoType ===
                                'interactive-lesson' ||
                                currentStepData.demoType ===
                                    'interactive-settings')
                        )
                    ) {
                        e.preventDefault();
                        e.stopPropagation();
                    }
                }}
                style={{
                    maskImage: highlightedElement
                        ? `radial-gradient(ellipse at center, transparent 0%, transparent 40%, black 70%)`
                        : undefined,
                    WebkitMaskImage: highlightedElement
                        ? `radial-gradient(ellipse at center, transparent 0%, transparent 40%, black 70%)`
                        : undefined,
                }}
            />

            {/* Spotlight highlight */}
            {highlightedElement && (
                <div
                    ref={spotlightRef}
                    className="absolute pointer-events-none rounded-lg border-2 border-sky-400 shadow-[0_0_0_9999px_rgba(0,0,0,0.4)] transition-all duration-500 ease-out"
                    style={{
                        boxShadow: `
                            0 0 0 2px rgb(56 189 248),
                            0 0 0 9999px rgba(0, 0, 0, 0.4),
                            inset 0 0 0 2px rgba(56, 189, 248, 0.3)
                        `,
                        animation:
                            currentStepData.demoType === 'click' ||
                            currentStepData.demoType?.startsWith('interactive')
                                ? 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite'
                                : 'glow 3s ease-in-out infinite alternate',
                    }}
                />
            )}

            {/* Enhanced pointer for interactive demonstrations */}
            {highlightedElement &&
                (currentStepData.demoType === 'click' ||
                    currentStepData.demoType === 'interactive-lesson') && (
                    <div
                        ref={pointerRef}
                        className="absolute pointer-events-none z-10"
                        style={{
                            left: `${
                                highlightedElement.getBoundingClientRect()
                                    .left +
                                highlightedElement.getBoundingClientRect()
                                    .width /
                                    2
                            }px`,
                            top: `${
                                highlightedElement.getBoundingClientRect().top +
                                highlightedElement.getBoundingClientRect()
                                    .height /
                                    2
                            }px`,
                            transform: 'translate(-50%, -50%)',
                        }}
                    >
                        <div className="relative">
                            <div
                                className={`w-8 h-8 bg-sky-500 rounded-full flex items-center justify-center text-white ${
                                    currentStepData.demoType ===
                                        'interactive-lesson' &&
                                    waitingForInteraction
                                        ? 'animate-bounce'
                                        : 'animate-ping'
                                }`}
                            >
                                <svg
                                    className="w-4 h-4"
                                    fill="currentColor"
                                    viewBox="0 0 20 20"
                                >
                                    <path
                                        fillRule="evenodd"
                                        d="M6.672 1.911a1 1 0 10-1.932.518l.259.966a1 1 0 001.932-.518l-.26-.966zM2.429 4.74a1 1 0 10-.517 1.932l.966.259a1 1 0 00.517-1.932l-.966-.26zm8.814-.569a1 1 0 00-1.415-1.414l-.707.707a1 1 0 101.415 1.414l.707-.707zm-7.071 7.072l.707-.707A1 1 0 003.465 9.12l-.708.707a1 1 0 001.415 1.415zm3.2-5.171a1 1 0 00-1.3 1.3l4 10a1 1 0 001.823.075l1.38-2.759 3.018 3.02a1 1 0 001.414-1.415l-3.019-3.02 2.76-1.379a1 1 0 00-.076-1.822l-10-4z"
                                        clipRule="evenodd"
                                    />
                                </svg>
                            </div>
                            <div className="absolute inset-0 w-8 h-8 bg-sky-500 rounded-full animate-pulse opacity-75"></div>
                            {/* Interactive hint text */}
                            {currentStepData.demoType ===
                                'interactive-lesson' &&
                                waitingForInteraction &&
                                !hasInteracted && (
                                    <div className="absolute top-10 left-1/2 transform -translate-x-1/2 bg-sky-500 text-white px-3 py-1 rounded-lg text-sm font-medium whitespace-nowrap animate-pulse">
                                        Click me!
                                    </div>
                                )}
                        </div>
                    </div>
                )}

            {/* Enhanced arrow pointer for settings */}
            {highlightedElement &&
                currentStepData.demoType === 'interactive-settings' && (
                    <div
                        className="absolute pointer-events-none z-10"
                        style={{
                            left: `${
                                highlightedElement.getBoundingClientRect()
                                    .right + 20
                            }px`,
                            top: `${
                                highlightedElement.getBoundingClientRect().top +
                                highlightedElement.getBoundingClientRect()
                                    .height /
                                    2
                            }px`,
                            transform: 'translateY(-50%)',
                        }}
                    >
                        <div className="flex items-center">
                            <svg
                                className={`w-8 h-8 text-sky-500 ${
                                    waitingForInteraction
                                        ? 'animate-bounce'
                                        : 'animate-pulse'
                                }`}
                                fill="currentColor"
                                viewBox="0 0 20 20"
                            >
                                <path
                                    fillRule="evenodd"
                                    d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z"
                                    clipRule="evenodd"
                                />
                            </svg>
                            {/* Interactive hint text */}
                            {waitingForInteraction && !hasInteracted && (
                                <div className="ml-3 bg-sky-500 text-white px-3 py-1 rounded-lg text-sm font-medium whitespace-nowrap animate-pulse">
                                    Click me!
                                </div>
                            )}
                        </div>
                    </div>
                )}

            {/* Typing animation for search demo - removed as per feedback */}

            {/* Modal positioned based on highlighted element */}
            <div
                className={`${
                    'useMobileBottom' in modalPosition
                        ? 'fixed inset-x-0 bottom-0 flex items-end'
                        : 'useCenter' in modalPosition
                          ? 'grid place-items-center inset-0'
                          : 'absolute'
                } ${
                    waitingForInteraction &&
                    currentStepData.demoType === 'interactive-lesson' &&
                    !hasInteracted
                        ? 'opacity-90'
                        : waitingForInteraction &&
                            currentStepData.demoType === 'interactive-lesson' &&
                            hasInteracted
                          ? 'opacity-95'
                          : waitingForInteraction &&
                              currentStepData.demoType ===
                                  'interactive-settings' &&
                              !hasInteracted
                            ? 'opacity-90'
                            : waitingForInteraction &&
                                currentStepData.demoType ===
                                    'interactive-settings' &&
                                hasInteracted
                              ? 'opacity-95'
                              : 'opacity-100'
                } ${
                    waitingForInteraction &&
                    (currentStepData.demoType === 'interactive-lesson' ||
                        currentStepData.demoType === 'interactive-settings')
                        ? 'pointer-events-none' // Make modal container non-interactive during interactive steps
                        : ''
                }`}
                style={
                    !('useCenter' in modalPosition) &&
                    !('useMobileBottom' in modalPosition)
                        ? (modalPosition as CSSProperties)
                        : {}
                }
            >
                <div
                    className={`relative w-full ${
                        'useMobileBottom' in modalPosition
                            ? 'max-w-none mx-0 rounded-t-2xl rounded-b-none' // Mobile bottom sheet style
                            : 'max-w-md rounded-2xl'
                    } ${
                        'useCenter' in modalPosition ||
                        'useMobileBottom' in modalPosition
                            ? 'mx-4'
                            : ''
                    } max-h-[85vh] overflow-y-auto shadow-2xl ring-1 ring-black/10 dark:ring-white/10 bg-white/98 dark:bg-slate-900/98 backdrop-blur-md transition-all duration-200 ease-out will-change-transform will-change-opacity ${
                        waitingForInteraction &&
                        (currentStepData.demoType === 'interactive-lesson' ||
                            currentStepData.demoType === 'interactive-settings')
                            ? 'pointer-events-auto' // Ensure modal content remains clickable during interactive steps
                            : ''
                    } ${
                        isVisible
                            ? 'opacity-100 translate-y-0 scale-100'
                            : 'opacity-0 translate-y-2 scale-95'
                    }`}
                    onClick={(e) => e.stopPropagation()}
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="onboarding-title"
                >
                    <div className="p-6">
                        {/* Header with progress */}
                        <div className="flex items-center justify-between mb-6">
                            <div className="text-sm text-slate-500 dark:text-slate-400">
                                {inModalOnboarding
                                    ? `Modal Step ${modalStepIndex + 1} of ${
                                          modalOnboardingSteps.length
                                      }`
                                    : `Step ${currentStep + 1} of ${
                                          steps.length
                                      }`}
                            </div>
                            <button
                                onClick={handleSkip}
                                className="text-sm text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 transition-colors"
                            >
                                {inModalOnboarding
                                    ? 'Exit modal tour'
                                    : 'Skip tour'}
                            </button>
                        </div>

                        {/* Progress bar */}
                        <div className="mb-8">
                            <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2">
                                <div
                                    className="bg-gradient-to-r from-sky-500 to-indigo-500 h-2 rounded-full transition-all duration-300 ease-out"
                                    style={{
                                        width: inModalOnboarding
                                            ? `${
                                                  ((modalStepIndex + 1) /
                                                      modalOnboardingSteps.length) *
                                                  100
                                              }%`
                                            : `${
                                                  ((currentStep + 1) /
                                                      steps.length) *
                                                  100
                                              }%`,
                                    }}
                                />
                            </div>
                        </div>

                        {/* Step content */}
                        <div className="text-center mb-8">
                            <div className="flex justify-center mb-4">
                                <div className="w-20 h-20 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                                    {currentStepData.icon}
                                </div>
                            </div>

                            <h2
                                id="onboarding-title"
                                className="text-xl font-semibold text-slate-900 dark:text-slate-100 mb-3"
                            >
                                {currentStepData.title}
                            </h2>

                            <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
                                {currentStepData.description}
                            </p>
                        </div>

                        {/* Navigation buttons */}
                        <div className="flex gap-3">
                            <button
                                onClick={handlePrevious}
                                disabled={isFirstStep}
                                className={`flex-1 py-2.5 px-4 rounded-lg font-medium transition-all duration-200 ${
                                    isFirstStep
                                        ? 'bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 cursor-not-allowed'
                                        : 'bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200'
                                }`}
                            >
                                Previous
                            </button>

                            {/* Show skip step button during interactive steps */}
                            {waitingForInteraction &&
                                currentStepData.requiresInteraction && (
                                    <button
                                        onClick={handleSkipStep}
                                        className="py-2.5 px-4 rounded-lg font-medium transition-all duration-200 bg-amber-100 hover:bg-amber-200 dark:bg-amber-900/30 dark:hover:bg-amber-900/50 text-amber-800 dark:text-amber-200 border border-amber-300 dark:border-amber-700"
                                    >
                                        Skip step
                                    </button>
                                )}

                            <button
                                onClick={handleNext}
                                disabled={
                                    waitingForInteraction && !inModalOnboarding
                                }
                                className={`flex-1 py-2.5 px-4 rounded-lg font-medium transition-all duration-200 shadow-lg hover:shadow-xl ${
                                    waitingForInteraction && !inModalOnboarding
                                        ? 'bg-slate-300 dark:bg-slate-600 text-slate-500 dark:text-slate-400 cursor-not-allowed'
                                        : 'bg-gradient-to-r from-sky-500 to-indigo-500 hover:from-sky-600 hover:to-indigo-600 text-white'
                                }`}
                            >
                                {inModalOnboarding
                                    ? isLastStep
                                        ? 'Continue main tour'
                                        : 'Next'
                                    : waitingForInteraction
                                      ? currentStepData.demoType ===
                                        'interactive-settings'
                                          ? hasInteracted
                                              ? 'Waiting for you to close settings...'
                                              : 'Click the settings icon above!'
                                          : hasInteracted
                                            ? 'Waiting for you to close the lesson...'
                                            : 'Click on a lesson above!'
                                      : isLastStep
                                        ? 'Get Started!'
                                        : 'Next'}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>,
        document.body,
    );
}
