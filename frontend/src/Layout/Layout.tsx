import { useContext, useEffect, useRef, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { CONTEXT, ContextState, STREAK_GOAL, STREAK_POINTS } from "../Models/Context";
import { haptic } from "../Services/haptics";
import ProfileButton from "../Components/ProfileButton/ProfileButton";
import "./Layout.css";

/* Layout Component - implements all features that remain from page to page; header, navbar, footer */

/**
 * Layout component that implements features persistent across pages, such as header and main content.
 * @returns {JSX.Element} The layout with header and injected content.
 */
export function Layout() {
    const { context, setContext } = useContext(CONTEXT) as ContextState;
    const onHintPage = useLocation().pathname === "/";
    const progress = Math.min(1, context.streak / STREAK_GOAL);

    // The count animates each time an answer adds to it
    const [glow, setGlow] = useState(false);
    const lastStreak = useRef(context.streak);
    useEffect(() => {
        // Loading the saved count isn't an answer, so only glow once something has been reviewed
        const grew = (context.streak > lastStreak.current || Boolean(context.justRewarded)) && context.reviewedHints.length > 0;
        lastStreak.current = context.streak;
        if (!grew) return;
        setGlow(true);
        const timer = setTimeout(() => setGlow(false), 700);
        return () => clearTimeout(timer);
    }, [context.streak, context.justRewarded, context.reviewedHints.length]);

    // The celebration stays until "Keep going"; the reset message closes itself after a few seconds
    useEffect(() => {
        if (context.justRewarded) haptic("success");
    }, [context.justRewarded]);
    useEffect(() => {
        if (!context.streakLost) return;
        haptic("error");
        const timer = setTimeout(() => setContext((prev) => ({ ...prev, streakLost: undefined })), 3500);
        return () => clearTimeout(timer);
    }, [context.streakLost, setContext]);

    return (
        <div className="layout-container">
            {/* Header */}
            <header className="site-header">
                <ProfileButton />
                {/* Phones: title centered. Desktop: logo and title on the left. */}
                <div className="header-content">
                    <div className="brand">
                        <img className="brand-icon" src={`${import.meta.env.BASE_URL}RLL_Logo.png`} alt="Record Linking Lab logo" />
                        <div className="brand-text">
                            <h1 className="site-title">PowerLinker</h1>
                            <span className="brand-lab">Record Linking Lab</span>
                        </div>
                    </div>
                </div>
                {/* Points first on the left; how many more in a row earn the next bonus on the right, above the bar */}
                {onHintPage && (
                    <div className="progress-row">
                        <div className="progress-labels">
                            <span className="points-count"><b>{context.points}</b> points</span>
                            <span className="progress-count">
                                {/* A new key on each change replays the slide-up */}
                                <span key={context.streak} className={`count-num${glow ? " is-new" : ""}`}>{STREAK_GOAL - context.streak}</span> more for +{STREAK_POINTS}
                            </span>
                        </div>
                        <div
                            className="progress-track"
                            role="progressbar"
                            aria-label={`Answers in a row toward ${STREAK_POINTS} points`}
                            aria-valuemin={0}
                            aria-valuemax={STREAK_GOAL}
                            aria-valuenow={context.streak}
                        >
                            <div className="progress-fill" style={{ width: `${progress * 100}%` }} />
                        </div>
                    </div>
                )}
            </header>
            {/* Celebration at 25 in a row, in the middle of the screen */}
            {context.justRewarded && (
                <div className="streak-lost-overlay" role="alertdialog" aria-labelledby="reward-title">
                    <div className="streak-lost streak-reward">
                        <div className="reward-burst" aria-hidden="true">🎉</div>
                        <div className="reward-title" id="reward-title">+{STREAK_POINTS} points!</div>
                        <p>{STREAK_GOAL} in a row. Thank you for the careful work.</p>
                        <button type="button" className="reward-continue" autoFocus
                            onClick={() => setContext((prev) => ({ ...prev, justRewarded: false }))}>
                            Keep going
                        </button>
                    </div>
                </div>
            )}
            {/* A popup in the middle of the screen; tap anywhere to close it early */}
            {context.streakLost && (
                <div className="streak-lost-overlay" role="alertdialog" aria-labelledby="streak-lost-title"
                    onClick={() => setContext((prev) => ({ ...prev, streakLost: undefined }))}>
                    <div className="streak-lost">
                        <div className="streak-lost-title" id="streak-lost-title">Back to 0</div>
                        <p>
                            {context.streakLost === "check"
                                ? "That was a check hint, and its answer was different."
                                : "Too many of their own facts conflicted for this to be the same person."}
                        </p>
                    </div>
                </div>
            )}

            {/* Main Content */}
            <main className="main-content">
                <Outlet />
            </main>
        </div>
    );
}
