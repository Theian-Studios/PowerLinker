import { createContext, Dispatch, SetStateAction } from "react";
import { v4 } from "uuid";
import { Hint } from "./Hint";

/**
 * Context interface for the application, containing session ID and hints. PRONE TO CHANGE.
 */
export interface Context {
  sid: string; // session id
  hintQue: Hint[];
  reviewedHints: Hint[];
  strikes: 0 | 1 | 2 | 3;
  /** Hints answered in a row without missing a check hint. */
  streak: number;
  /** Points earned, 100 for each completed streak; kept between visits. */
  points: number;
  /** Set when a streak was just completed, so the page can celebrate it. */
  justRewarded?: boolean;
  /** Whether the last answer added to the streak, so going back can undo exactly that. */
  lastCounted?: boolean;
  /** Set when the last answer ended a streak: a missed check hint, or "Same person" despite strong conflicts. */
  streakLost?: "check" | "conflicts";
}


export interface ContextState {
  context: Context;
  setContext: Dispatch<SetStateAction<Context>>;
}

export const CONTEXT = createContext<ContextState | undefined>(undefined);

// SEE App.tsx for ContextProvider component that uses the above

/**
 * Gets the initial context for the application.
 * @returns A Context object with a session ID and an empty hints array.
 */
export async function getInitialContext() {
  // Storage can be blocked (private mode, strict settings); a fresh ID still works for this visit
  let sid = v4();
  try {
    sid = sessionStorage.getItem("sid") ?? sid;
    sessionStorage.setItem("sid", sid);
  } catch {
    // Keep the fresh ID
  }

  return {
    sid: sid,
    hintQue: [],
    reviewedHints: [],
    // Strikes last for the session, so reloading the page doesn't clear them
    strikes: readStrikes(),
    streak: readStored(STREAK_KEY),
    points: readStored(POINTS_KEY),
  } as Context;
}

const STREAK_KEY = "powerlinker.streak";
const STRIKES_KEY = "powerlinker.strikes";

/**
 * Reads this session's missed check hints, kept in session storage alongside the session ID.
 * @returns {0 | 1 | 2 | 3} The strikes so far.
 */
function readStrikes(): 0 | 1 | 2 | 3 {
  try {
    const value = Number(sessionStorage.getItem(STRIKES_KEY));
    return value === 1 || value === 2 || value === 3 ? value : 0;
  } catch {
    return 0;
  }
}

/**
 * Saves this session's missed check hints so a reload keeps them.
 * @param strikes - The strikes so far.
 */
export function saveStrikes(strikes: 0 | 1 | 2 | 3) {
  try {
    sessionStorage.setItem(STRIKES_KEY, String(strikes));
  } catch {
    // Without storage, strikes last until the page is reloaded, as before
  }
}
const POINTS_KEY = "powerlinker.points";

/**
 * Reads a saved count from this browser.
 * @param key - The storage key.
 * @returns The saved count, or 0 when there is none.
 */
function readStored(key: string): number {
  try {
    const value = Number(localStorage.getItem(key));
    return Number.isFinite(value) && value > 0 ? value : 0;
  } catch {
    return 0;
  }
}

/**
 * Saves the streak and points so they survive a reload.
 * @param streak - Hints answered in a row.
 * @param points - Points earned so far.
 */
export function saveProgress(streak: number, points: number) {
  try {
    localStorage.setItem(STREAK_KEY, String(streak));
    localStorage.setItem(POINTS_KEY, String(points));
  } catch {
    // Remembering progress is only a convenience
  }
}


/** Hints in a row, without missing a check hint, that complete a streak. */
export const STREAK_GOAL = 25;

/** Points for each completed streak. */
export const STREAK_POINTS = 100;

/**
 * Works out the streak and points after one answer. A missed check hint resets the streak, "Not sure"
 * leaves it as it is, and reaching the goal adds the points and starts a new streak.
 * @param context - The app context before the answer.
 * @param missedCheck - True when the answer was wrong on a check hint.
 * @param unsure - True when the answer was "Not sure", which doesn't count toward the streak.
 * @returns The new streak and points, and whether a streak was just completed.
 */
export function nextProgress(context: Context, missedCheck: boolean, unsure: boolean = false): Pick<Context, "streak" | "points" | "justRewarded" | "lastCounted"> {
  if (missedCheck) return { streak: 0, points: context.points, justRewarded: false, lastCounted: false };
  if (unsure) return { streak: context.streak, points: context.points, justRewarded: false, lastCounted: false };
  const streak = context.streak + 1;
  // A completed streak is banked, so going back afterward doesn't take anything away
  if (streak >= STREAK_GOAL) return { streak: 0, points: context.points + STREAK_POINTS, justRewarded: true, lastCounted: false };
  return { streak, points: context.points, justRewarded: false, lastCounted: true };
}
