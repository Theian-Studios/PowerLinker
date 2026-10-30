import {
  useCallback,
  useEffect,
  useRef,
  Dispatch,
  SetStateAction,
  MutableRefObject,
} from "react";
import { Hint } from "../../Models/Hint.ts";
import { Context, ContextState, nextProgress, saveProgress } from "../../Models/Context.ts";
import { asyncUseHintList } from "../../Hooks/useLambdaFetch.ts";
import { getPersons } from "../../Services/getPersons.ts";
import { usingSheets } from "../../Services/sheetsApi.ts";

export const HINTS_PER_REQUEST = 10;

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
  attachQueue: { hint: Hint; vote: -1 | 0 | 1; seconds?: number }[];
  setAttachQueue: Dispatch<SetStateAction<{ hint: Hint; vote: -1 | 0 | 1; seconds?: number }[]>>;
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
            const hintsResponse = await asyncUseHintList(
            HINTS_PER_REQUEST,
            lastInsertTime,
            hintType
            );
            // A newer request (a hint type switch) took over; its own response will fill the queue
            if (thisRequest !== requestId.current) return;

            if (hintsResponse.data) {
            setLoadError(false);
            const hints: Hint[] = getPersons(hintsResponse);
            let realNew = 0;
            setContext((prev) => {
                const seenIds = new Set([
                ...prev.hintQue.map(hintKey),
                ...prev.reviewedHints.map(hintKey),
                ]);
                const unseen = hints.filter((h) => !h.dummy && !seenIds.has(hintKey(h)));
                realNew = unseen.length;
                // A check hint only comes along with new real hints, so a page of already-seen ones adds nothing
                const newHints = unseen.length > 0 ? [...unseen, ...hints.filter((h) => h.dummy)] : [];
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
     */
    const submit = useCallback(
        (vote: -1 | 0 | 1, likelyWrong: boolean = false) => {
        const hint = context.hintQue[0];
        if (!hint) {
            console.error("No hint in queue");
            return;
        }

        // Each check hint is graded once; going back and re-answering it can't add more strikes
        if (hint.dummy && !hint.graded && hint.dummy.expected === -vote) {
            const newStrikes =
            context.strikes !== 3
                ? ((context.strikes + 1) as 0 | 1 | 2 | 3)
                : context.strikes;
            console.warn(`Strike ${newStrikes}!`);
            if (newStrikes === 1) {
                setAttachQueue([]);
                console.warn(`cleared votes in queue ${context.strikes}!`);
                context.strikes += 1;
            } else if (newStrikes === 2) {
                setAttachQueue([]);
                console.warn(`cleared votes in queue ${context.strikes}!`);
                console.warn(`final strike ${context.strikes}!`);
                context.strikes += 1;
            } else if (newStrikes === 3) {
                invalidateSession(context.sid);
                console.warn(`invalidated session ${context.strikes}!`);
            }
            setContext((prev) => ({ ...prev, strikes: newStrikes }));
        }

        // The Sheet also records check hint answers, for each person's accuracy; the lab's API only takes real hints
        if (!hint.dummy || usingSheets) {
            const seconds = (Date.now() - shownAt.current) / 1000;
            // Re-answering after Back replaces the earlier vote instead of sending both
            setAttachQueue((a) => {
                const existing = a.findIndex((item) => hintKey(item.hint) === hintKey(hint));
                return existing >= 0
                    ? a.map((item, i) => (i === existing ? { hint, vote, seconds } : item))
                    : [...a, { hint, vote, seconds }];
            });
        }

        const completed = { ...hint, complete: true, graded: hint.graded || Boolean(hint.dummy) };
        // Same person and Different extend the streak, Not sure doesn't, and a missed check hint resets it
        const missedCheck = Boolean(hint.dummy && hint.dummy.expected === -vote);
        setContext((prev) => {
            const progress = nextProgress(prev, missedCheck || likelyWrong, vote === 0);
            // Say why the streak was lost, if it was
            const streakLost = prev.streak > 0 && progress.streak === 0 && !progress.justRewarded
                ? (missedCheck ? "check" : "conflicts")
                : undefined;
            saveProgress(progress.streak, progress.points);
            return {
                ...prev,
                ...progress,
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
