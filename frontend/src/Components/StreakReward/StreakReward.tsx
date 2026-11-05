import { ReactElement, useEffect, useRef, useState } from "react";
import { STREAK_GOAL, STREAK_POINTS } from "../../Models/Context";
import "./StreakReward.css";

/** Longer names than this would wrap onto a second line in a column, so they show as the given name alone. */
const LONGEST_NAME = 17;

/** From this many names, computers show four columns instead of two. */
const WIDE_LIST = 8;

/**
 * Shortens a name that wouldn't fit on one line in its column to the given name alone.
 * @param name - A name like "Bartholomew Kowalczyk".
 * @returns The name, or just "Bartholomew" when it's too long.
 */
function fitName(name: string): string {
    return name.length > LONGEST_NAME ? name.split(" ")[0] : name;
}

/**
 * StreakReward Component - The celebration at 25 answers in a row, covering the page under the header: the points,
 * how many people the volunteer helped back to their families, and their names in a card that scrolls on its own
 * when there are more than fit, fading at the bottom while there's more to see.
 * @param {Object} props - Component props.
 * @param {string[]} props.names - The people the streak said were the same person, from streakNames.
 * @param {() => void} props.onClose - Closes the celebration.
 * @returns {ReactElement} The celebration.
 */
export default function StreakReward({ names, onClose }: { names: string[]; onClose: () => void }): ReactElement {
    const people = names.length === 1 ? "person" : "people";
    const families = names.length === 1 ? "their family" : "their families";
    const list = useRef<HTMLUListElement>(null);
    const [moreBelow, setMoreBelow] = useState(false);

    /** Fades the bottom of the card while some names are still below it, and never when there's nothing to scroll. */
    function checkMore() {
        const el = list.current;
        if (el) setMoreBelow(el.scrollTop + el.clientHeight < el.scrollHeight - 2);
    }
    // Check again whenever the list changes size, like a window resized past the four-column width
    useEffect(() => {
        checkMore();
        const el = list.current;
        if (!el || typeof ResizeObserver === "undefined") return;
        const observer = new ResizeObserver(checkMore);
        observer.observe(el);
        return () => observer.disconnect();
    }, [names]);

    return (
        <div className="reward-screen" role="alertdialog" aria-labelledby="reward-count" aria-describedby="reward-points">
            <div className="reward-screen-body">
                <div className="reward-points" id="reward-points">+{STREAK_POINTS} points</div>
                {names.length > 0 ? (
                    <>
                        <div className="reward-count" id="reward-count">
                            <span className="reward-number">{names.length}</span>
                            <span className="reward-line">{people} helped back<br />to {families}</span>
                        </div>
                        <div className={`reward-card${moreBelow ? " reward-card--more" : ""}`}>
                            <div className="reward-card-label" id="reward-names-label">Their names</div>
                            <ul ref={list} className={`reward-list${names.length > 1 ? " reward-list--2" : ""}${names.length >= WIDE_LIST ? " reward-list--wide" : ""}`}
                                aria-labelledby="reward-names-label" tabIndex={moreBelow ? 0 : undefined} onScroll={checkMore}>
                                {names.map((name) => <li key={name} title={name}>{fitName(name)}</li>)}
                            </ul>
                        </div>
                    </>
                ) : (
                    <div className="reward-count" id="reward-count">
                        <span className="reward-number">{STREAK_GOAL}</span>
                        <span className="reward-line">careful answers<br />in a row</span>
                    </div>
                )}
            </div>
            <div className="reward-streak">
                {names.length > 0 ? `${STREAK_GOAL} careful answers in a row` : "Thank you for the careful work."}
            </div>
            <button type="button" className="reward-continue reward-screen-button" autoFocus onClick={onClose}>
                Keep going
            </button>
        </div>
    );
}
