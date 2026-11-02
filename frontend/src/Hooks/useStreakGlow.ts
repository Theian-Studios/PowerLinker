import { useContext, useEffect, useRef, useState } from "react";
import { CONTEXT, ContextState, STREAK_GOAL } from "../Models/Context";

/** How long the bar's tip glows and the count rolls after an answer that counts. */
const GLOW_MS = 700;

/**
 * Watches the streak for answers that add to it, so the progress bars can glow at the tip and the number of
 * answers left can roll over from its last value.
 * @returns {{ glow: boolean, rollFrom: number | undefined }} Whether to glow now, and the count to roll from.
 */
export default function useStreakGlow(): { glow: boolean; rollFrom: number | undefined } {
  const { context } = useContext(CONTEXT) as ContextState;
  const [glow, setGlow] = useState(false);
  const [rollFrom, setRollFrom] = useState<number | undefined>();
  const lastStreak = useRef(context.streak);
  useEffect(() => {
    // Loading the saved count isn't an answer, so only glow once something has been reviewed
    const grew = (context.streak > lastStreak.current || Boolean(context.justRewarded)) && context.reviewedHints.length > 0;
    const before = STREAK_GOAL - lastStreak.current;
    lastStreak.current = context.streak;
    if (!grew) return;
    setRollFrom(before);
    setGlow(true);
    const timer = setTimeout(() => setGlow(false), GLOW_MS);
    return () => clearTimeout(timer);
  }, [context.streak, context.justRewarded, context.reviewedHints.length]);
  return { glow, rollFrom };
}
