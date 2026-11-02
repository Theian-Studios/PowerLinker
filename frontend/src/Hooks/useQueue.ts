import { useEffect, useRef, useReducer, useContext } from "react";
import { State } from "./useFetch";
import { Hint } from "../Models/Hint";
import { CONTEXT, ContextState } from "../Models/Context";
import getLambdaURL, { getLambdaCredentials } from "../Services/getLambdaURL";
import { sheetsBeacon, sheetsPost, usingSheets } from "../Services/sheetsApi";

/** One answer waiting to be sent. Its ID lets the backend recognize the same answer sent twice. */
export interface QueuedVote {
    id: string;
    hint: Hint;
    vote: -1 | 0 | 1;
    /** Seconds spent on the hint before answering. */
    seconds?: number;
    /** When the answer was given, as an ISO date; a retry can reach the backend much later. */
    answeredAt?: string;
    /** Why the answer was "Not sure". */
    unsure?: UnsureReason;
}

/** Why a volunteer chose "Not sure". */
export type UnsureReason = "not_enough_info" | "facts_disagree" | "other";

/** Most answers sent in one request; the Sheet's script takes up to 100. */
const MAX_PER_REQUEST = 50;

/**
 * Item to send to the queue.
 */
export interface QueueItem {
    hint: {
        id1: string;
        id2: string;
        recordType: string;
        origin: string;
        url?: string;
    },
    vote: {
        sid: string;
        vote: number;
    },
    /** The Sheet's ID for the hint, which tells apart hints that share a person. */
    hint_id?: string;
    /** For a check hint, the answer it should get. */
    expected?: number;
    /** Seconds spent on the hint before answering. */
    seconds?: number;
    /** This answer's ID, so the Sheet records it once even if it's sent again. */
    vote_id?: string;
    /** When the answer was given. */
    answered_at?: string;
    /** Why the answer was "Not sure". */
    unsure_reason?: UnsureReason;
}

/**
 * Union type representing possible actions in the queue reducer.
 */
type Action =
  | { type: "loading" }
  | { type: "success" }
  | { type: "error"; payload: Error };

/**
 * Sends answers to the backend. Each answer is sent once; one that fails stays queued and is sent again on
 * the next answer or the next retry. Only the answers a request carried are removed when it succeeds, so
 * answers given while it was in flight aren't lost.
 * @param votes - The answers waiting to be sent.
 * @param retryTick - Changes on a timer while answers are waiting, so failed ones are retried.
 * @param onSent - Called with the IDs of answers the backend has received.
 * @returns {State<boolean>} Whether the last send worked.
 */
export default function useQueue(
    votes: QueuedVote[],
    retryTick: number,
    onSent: (ids: string[]) => void
): State<boolean> {
    // Answers on their way or already received, so they're never sent twice; a failed send forgets its answers
    const handled = useRef<Set<string>>(new Set());
    const mounted = useRef<boolean>(true);
    // The latest queue, for sending what's left when the page closes
    const latestVotes = useRef<QueuedVote[]>(votes);
    latestVotes.current = votes;
    const initialState: State<boolean> = {
        error: undefined,
        data: undefined,
    };
    const { context } = useContext(CONTEXT) as ContextState;
    const sid = context.sid;

    /**
     * Gets the QueueItems to be sent to the queue.
     * @param pending - The answers to send.
     * @returns {QueueItem[]} An array of QueueItems to be sent to the queue.
     */
    const getQueueItems = (pending: QueuedVote[]): QueueItem[] => pending.map((vote) => ({
        hint: {
            id1: vote.hint.recordInfo.id!,
            id2: vote.hint.treeData.id ?? vote.hint.treeData.focusPerson.pid!,
            recordType: vote.hint.type,
            origin: vote.hint.origin,
            ...(vote.hint.url ? { url: vote.hint.url } : {}),
        },
        vote: {
            sid: sid,
            vote: vote.vote as number,
        },
        ...(vote.hint.hintId ? { hint_id: vote.hint.hintId } : {}),
        ...(vote.hint.dummy ? { expected: vote.hint.dummy.expected } : {}),
        ...(vote.seconds !== undefined ? { seconds: vote.seconds } : {}),
        ...(usingSheets ? { vote_id: vote.id } : {}),
        ...(usingSheets && vote.answeredAt ? { answered_at: vote.answeredAt } : {}),
        // Only the Sheet records why; the lab's API doesn't take these fields
        ...(usingSheets && vote.unsure ? { unsure_reason: vote.unsure } : {}),
    }));

    /**
     * Reducer function to manage queue state transitions.
     * @param state - The current state.
     * @param action - The action to perform.
     * @returns {State<boolean>} The updated state after applying the action.
     */
    const queueReducer = (state: State<boolean>, action: Action): State<boolean> => {
        switch (action.type) {
            case "loading":
                return { ...state, data: undefined, error: undefined };
            case "success":
                return { ...state, data: true };
            case "error":
                return { ...state, data: false, error: action.payload } as State<boolean>;
            default:
                return state;
        }
    }

    const [state, dispatch] = useReducer(queueReducer, initialState);

    /**
     * Sends answers to the submit-votes endpoint, or to the Sheet on the public site.
     * @param items - The QueueItems to be sent.
     */
    const queueData = async (items: QueueItem[]) => {
        if (usingSheets) {
            await sheetsPost({ action: "votes", items });
            return;
        }
        const response = await fetch(getLambdaURL("/hints"), {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(items),
            credentials: getLambdaCredentials(),
        });
        if (!response.ok) throw new Error(`submit-votes failed: ${response.status}`);
    }

    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
        };
    }, []);

    useEffect(() => {
        const pending = votes.filter((vote) => !handled.current.has(vote.id)).slice(0, MAX_PER_REQUEST);
        if (pending.length === 0) return;
        const ids = pending.map((vote) => vote.id);
        ids.forEach((id) => handled.current.add(id));
        dispatch({ type: "loading" });

        queueData(getQueueItems(pending))
            .then(() => {
                if (!mounted.current) return;
                onSent(ids);
                dispatch({ type: "success" });
            })
            .catch((error: Error) => {
                // Not sent: forget them so the next answer or the next retry sends them again
                ids.forEach((id) => handled.current.delete(id));
                if (mounted.current) dispatch({ type: "error", payload: error });
            });
    }, [votes, retryTick]);

    // The latest version, which has the session ID; the first render's still has the blank placeholder
    const latestQueueItems = useRef(getQueueItems);
    latestQueueItems.current = getQueueItems;

    // On the public site, answers still waiting when the page closes are sent with a beacon, which the
    // browser finishes after the page is gone. The Sheet ignores any it already has.
    useEffect(() => {
        if (!usingSheets) return;
        /**
         * Sends whatever answers are still waiting as the page closes.
         */
        const flush = () => {
            if (latestVotes.current.length === 0) return;
            sheetsBeacon({ action: "votes", items: latestQueueItems.current(latestVotes.current) });
        };
        window.addEventListener("pagehide", flush);
        return () => window.removeEventListener("pagehide", flush);
    }, []);

    return state;
}
