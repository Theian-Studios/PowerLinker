import { useContext, useEffect, useMemo } from "react";
import StreakReward from "../Components/StreakReward/StreakReward";
import { Outlet, useLocation } from "react-router-dom";
import { CONTEXT, ContextState, STREAK_GOAL, STREAK_POINTS } from "../Models/Context";
import { haptic } from "../Services/haptics";
import useStreakGlow from "../Hooks/useStreakGlow";
import useOtherTab from "../Hooks/useOtherTab";
import HelpButton from "../Components/HelpButton/HelpButton";
import ProfileButton from "../Components/ProfileButton/ProfileButton";
import { streakNames } from "./rewardNames";
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

    // The bar glows at its tip and the count rolls over each time an answer adds to it
    const { glow, rollFrom } = useStreakGlow();
    const left = STREAK_GOAL - context.streak;
    const otherTab = useOtherTab();

    // The people this streak helped back to their families, listed on the celebration
    const rewardNames = useMemo(
        () => (context.justRewarded ? streakNames(context.reviewedHints) : []),
        // Only when the celebration opens, so answering behind it can't change the names
        // eslint-disable-next-line reactHooks/exhaustive-deps
        [context.justRewarded]
    );

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
                <HelpButton />
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
                                {/* The last count rolls up out of sight as the new one rolls in, like an odometer; a new key replays it */}
                                {glow && rollFrom !== undefined && rollFrom !== left
                                    ? <span key={context.streak} className="count-roll" aria-label={String(left)}><span className="count-roll-inner is-new"><span aria-hidden="true">{rollFrom}</span><span aria-hidden="true">{left}</span></span></span>
                                    : <span className="count-num">{left}</span>} more for +{STREAK_POINTS}
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
                            <div className={`progress-fill${glow ? " is-growing" : ""}`} style={{ width: `${progress * 100}%` }} />
                        </div>
                    </div>
                )}
            </header>
            {/* A popup in the middle of the screen; tap anywhere to close it early */}
            {context.streakLost && (
                <div className="streak-lost-overlay" role="alertdialog" aria-labelledby="streak-lost-title"
                    onClick={() => setContext((prev) => ({ ...prev, streakLost: undefined }))}>
                    <div className="streak-lost">
                        <div className="streak-lost-title" id="streak-lost-title">Back to 0</div>
                        <p>Too many of their own facts conflicted for this to be the same person.</p>
                    </div>
                </div>
            )}

            {/* Opened again in another tab: that one carries on, and this one waits, so the two don't show the same
                hints. Answers given here are still sent. */}
            {otherTab && (
                <div className="streak-lost-overlay" role="alertdialog" aria-labelledby="other-tab-title">
                    <div className="streak-lost">
                        <div className="reward-title" id="other-tab-title">Open in another tab</div>
                        <p>PowerLinker is open in another tab, so this one has paused. Your answers here are saved.</p>
                        <button type="button" className="reward-continue" autoFocus onClick={() => window.location.reload()}>
                            Use this tab
                        </button>
                    </div>
                </div>
            )}

            {/* Main Content */}
            <main className="main-content">
                <Outlet />
                {/* Celebration at 25 in a row, over the page but under the header, so the new points show there */}
                {context.justRewarded && (
                    <StreakReward names={rewardNames} onClose={() => setContext((prev) => ({ ...prev, justRewarded: false }))} />
                )}
            </main>
        </div>
    );
}
