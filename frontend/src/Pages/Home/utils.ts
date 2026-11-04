import {
  useCallback,
  useEffect,
  useRef,
  Dispatch,
  SetStateAction,
  MutableRefObject,
} from "react";
import { v4 } from "uuid";
import { Hint } from "../../Models/Hint.ts";
import { QueuedVote, UnsureReason } from "../../Hooks/useQueue.ts";
import { Context, ContextState, nextProgress, saveAnswered, saveProgress, saveStrikes } from "../../Models/Context.ts";
import { asyncUseHintList } from "../../Hooks/useLambdaFetch.ts";
import { getPersons } from "../../Services/getPersons.ts";
import { answeredHintIds, rememberAnswered, saveCursor, usingSheets } from "../../Services/sheetsApi.ts";

export const HINTS_PER_REQUEST = 10;
/** Hints asked for when nothing is on screen yet: enough to fill the queue in one request instead of two. */
const FIRST_HINTS_PER_REQUEST = 20;

/**
 * Gets the key that tells hints apart. The Sheet's hint ID comes first, since a check hint can be
 * built from the same person as a real hint.
 * @param hint - A hint in the queue or already answered.
 * @returns The hint ID, record ID or address, whichever it has first.
 */
function hintKey(hint: Hint): string | undefined {
  return hint.hintId ?? hint.recordInfo.id ?? hint.url;
}

interface HomeHandlerDeps {
  awaitingHints: MutableRefObject<boolean>;
  setLoading: Dispatch<SetStateAction<boolean>>;
  setContext: ContextState["setContext"];
  context: Context;
  attachQueue: QueuedVote[];
  setAttachQueue: Dispatch<SetStateAction<QueuedVote[]>>;
  invalidateSession: (sid: string) => void;
  hintType: string;
  setLoadError: (loadError: boolean) => void;
}

/**
 * Custom hook encapsulating the fetchHints and submit handlers for the Home page.
 */
export function useHomeHandlers({
    awaitingHints,
    setLoading,
    setContext,
    context,
    attachQueue,
    setAttachQueue,
    invalidateSession,
    hintType,
    setLoadError,
}: HomeHandlerDeps) {
    // Ref holds the latest fetchHints so the recursive call is never stale.
    const fetchHintsRef =
        useRef<(lastInsertTime?: number, silent?: boolean) => Promise<void>>();
    // Each request gets a number; a response is ignored if a newer request (like a hint type switch) started since
    const requestId = useRef(0);
    // The first request on a page load asks for a full page, the same one index.html may have started already
    const firstRequest = useRef(true);
    // The hints already queued or answered as of the last render, to tell whether a page brought new ones
    const latestContext = useRef(context);
    latestContext.current = context;

    /**
     * Gets hints from the backend and appends them to the hint queue.
     * @param lastInsertTime Cursor for pagination - only fetch hints with a greater insert-time.
     * @param silent If true, suppresses the loading screen (used when hints are still available to show).
     */
    const fetchHints = useCallback(
        async (lastInsertTime: number = -1, silent: boolean = false) => {
        if (awaitingHints.current) return;
        if (!silent) setLoading(true);
        const thisRequest = ++requestId.current;

        try {
            awaitingHints.current = true;
            const count = silent && !firstRequest.current ? HINTS_PER_REQUEST : FIRST_HINTS_PER_REQUEST;
            firstRequest.current = false;
            const hintsResponse = await asyncUseHintList(
            count,
            lastInsertTime,
            hintType
            );
            // A newer request (a hint type switch) took over; its own response will fill the queue
            if (thisRequest !== requestId.current) return;

            if (hintsResponse.data) {
            setLoadError(false);
            const hints: Hint[] = getPersons(hintsResponse);
            // Hints answered on an earlier visit or in another tab count as seen too: after the hints are rebuilt
            // in a new order, or when two tabs were open, they can come round again
            const answeredBefore = answeredHintIds();
            // Counted here rather than in the update below, which React may run later: counted there, a page of
            // new hints could look like none and set off a second, full-screen load right after the first
            const alreadyHere = new Set([
                ...answeredBefore,
                ...latestContext.current.hintQue.map(hintKey),
                ...latestContext.current.reviewedHints.map(hintKey),
            ]);
            const realNew = hints.filter((h) => !h.dummy && !alreadyHere.has(hintKey(h))).length;
            setContext((prev) => {
                const seenIds = new Set([
                ...answeredBefore,
                ...prev.hintQue.map(hintKey),
                ...prev.reviewedHints.map(hintKey),
                ]);
                const unseen = hints.filter((h) => !h.dummy && !seenIds.has(hintKey(h)));
                // A check hint only comes along with new real hints, so a page of already-seen ones adds nothing.
                // The page's order is kept, so the check hint stays at the random spot it was given.
                const newHints = unseen.length > 0 ? hints.filter((h) => h.dummy || unseen.includes(h)) : [];
                return { ...prev, hintQue: [...prev.hintQue, ...newHints] };
            });
            setLoading(false);
            awaitingHints.current = false;
            if (realNew === 0 && hints.some((h) => !h.dummy)) {
                const nextInsertTime = hints.reduce(
                    (max, h) => (h.insertTime > max ? h.insertTime : max),
                    lastInsertTime
                );
                // Only keep paging if the cursor moved; otherwise this would refetch the same page forever
                if (nextInsertTime > lastInsertTime) {
                    fetchHintsRef.current?.(nextInsertTime, silent);
                }
            }
            } else if (hintsResponse.error) {
            console.error("Error fetching hints:", hintsResponse.error);
            setLoadError(true);
            setLoading(false);
            awaitingHints.current = false;
            }
        } catch (error) {
            console.error("Error in fetchHints:", error);
            setLoadError(true);
            setLoading(false);
            awaitingHints.current = false;
        }
        },
        [awaitingHints, setLoading, setContext, hintType, setLoadError]
    );

    fetchHintsRef.current = fetchHints;

    // When the current hint first showed, for how long someone spent on it
    const shownAt = useRef(Date.now());
    const currentKey = context.hintQue[0] ? hintKey(context.hintQue[0]) : undefined;
    useEffect(() => {
        shownAt.current = Date.now();
    }, [currentKey]);

    /**
     * Completes the current hint and moves it from the queue to the reviewed list.
     * @param {-1 | 0 | 1} vote - The vote for the current hint.
     * @param {boolean} likelyWrong - True for "Same person" despite strong conflicts, which resets the streak.
     * @param {UnsureReason} unsure - Why the answer was "Not sure".
     */
    const submit = useCallback(
        (vote: -1 | 0 | 1, likelyWrong: boolean = false, unsure?: UnsureReason) => {
        const hint = context.hintQue[0];
        if (!hint) {
            console.error("No hint in queue");
            return;
        }

        // Each check hint is graded once; going back and re-answering it can't add more strikes
        if (hint.dummy && !hint.graded && hint.dummy.expected === -vote) {
            const newStrikes = Math.min(3, context.strikes + 1) as 0 | 1 | 2 | 3;
            // The lab's API drops a struggling session's unsent votes; the public site keeps every answer,
            // and the Sheet's Sessions tab marks the session instead
            if (newStrikes < 3 && !usingSheets) setAttachQueue([]);
            // The third miss ends the session once; later misses don't report it again
            if (newStrikes === 3 && context.strikes < 3) invalidateSession(context.sid);
            saveStrikes(newStrikes);
            setContext((prev) => ({ ...prev, strikes: newStrikes }));
        }

        // The Sheet also records check hint answers, for each person's accuracy; the lab's API only takes real
        // hints. A check hint counts once: re-answering it after Back isn't sent, so a miss can't be undone.
        if (!hint.dummy || (usingSheets && !hint.graded)) {
            const answer = {
                id: v4(),
                hint,
                vote,
                seconds: (Date.now() - shownAt.current) / 1000,
                answeredAt: new Date().toISOString(),
                ...(vote === 0 && unsure ? { unsure } : {}),
            };
            // Re-answering after Back replaces the earlier vote if it hasn't been sent yet; once sent, both are
            // recorded and the later one is the final answer
            setAttachQueue((a) => {
                const existing = a.findIndex((item) => hintKey(item.hint) === hintKey(hint));
                return existing >= 0
                    ? a.map((item, i) => (i === existing ? answer : item))
                    : [...a, answer];
            });
        }

        const completed = { ...hint, complete: true, graded: hint.graded || Boolean(hint.dummy), answered: true };
        // A returning volunteer picks up after the furthest hint they've answered
        if (!hint.dummy) {
            saveCursor(hint.insertTime);
            rememberAnswered(hintKey(hint));
        }
        // Same person and Different extend the streak, Not sure doesn't, and a missed check hint resets it
        const missedCheck = Boolean(hint.dummy && hint.dummy.expected === -vote);
        setContext((prev) => {
            const progress = nextProgress(prev, missedCheck || likelyWrong, vote === 0);
            // Say why the streak was lost, if it was; a missed check hint has its own explanation instead
            const streakLost = prev.streak > 0 && progress.streak === 0 && !progress.justRewarded && !missedCheck
                ? "conflicts"
                : undefined;
            saveProgress(progress.streak, progress.points);
            // Each hint counts once toward the all-time total, even if it's answered again after Back
            const answered = prev.answered + (hint.answered ? 0 : 1);
            if (!hint.answered) saveAnswered(answered);
            return {
                ...prev,
                ...progress,
                answered,
                streakLost,
                hintQue: prev.hintQue.slice(1),
                reviewedHints: [...prev.reviewedHints, { ...completed, counted: Boolean(progress.lastCounted) }],
            };
        });
        },
        [attachQueue, setAttachQueue, context, setContext, invalidateSession]
    );

    return { fetchHints, submit };
}
