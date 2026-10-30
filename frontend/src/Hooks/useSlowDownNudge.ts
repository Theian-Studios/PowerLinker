import { useCallback, useEffect, useRef, useState } from "react";
import { Hint } from "../Models/Hint";

/** Minimum seconds to look at any hint before a Match / Not a Match vote counts as careful. */
const BASE_SECONDS = 1;
/** Extra seconds per person shown, since bigger households take longer to check. */
const SECONDS_PER_PERSON = 0.25;
/** Fast votes in a row before the nudge appears. */
const FAST_VOTES_BEFORE_NUDGE = 5;

/**
 * Gets how long a careful look at a hint should take, based on how many people it shows.
 * @param hint - The hint being voted on.
 * @returns The minimum number of milliseconds.
 */
function minimumLookMs(hint: Hint): number {
  const people = (hint.recordInfo.persons?.length ?? 1) + (hint.treeData.persons?.length ?? 1);
  return (BASE_SECONDS + SECONDS_PER_PERSON * people) * 1000;
}

/**
 * Watches for several very fast votes in a row and shows a "slow down" message.
 * Voting pauses until the message is dismissed; it never changes how votes count.
 * @param hint - The hint currently on screen.
 * @returns Whether to show the nudge, a function to record a vote, and a function to dismiss the nudge.
 */
export default function useSlowDownNudge(hint: Hint | undefined) {
  const [showNudge, setShowNudge] = useState<boolean>(false);
  const shownAt = useRef<number>(Date.now());
  const fastVotesInARow = useRef<number>(0);

  // Restart the clock whenever a new hint appears
  useEffect(() => {
    shownAt.current = Date.now();
  }, [hint]);

  const recordVote = useCallback(
    (vote: -1 | 0 | 1) => {
      // Skipping is an honest answer, so only Match / Not a Match count
      if (!hint || vote === 0) return;

      if (Date.now() - shownAt.current < minimumLookMs(hint)) {
        fastVotesInARow.current += 1;
      } else {
        fastVotesInARow.current = 0;
      }

      if (fastVotesInARow.current >= FAST_VOTES_BEFORE_NUDGE) {
        fastVotesInARow.current = 0;
        setShowNudge(true);
      }
    },
    [hint]
  );

  const dismissNudge = useCallback(() => setShowNudge(false), []);

  return { showNudge, recordVote, dismissNudge };
}
