import { useEffect, useRef, useReducer, useContext, useState } from "react";
import { State } from "./useFetch";
import { Hint } from "../Models/Hint";
import { CONTEXT, ContextState } from "../Models/Context";
import getLambdaURL, { getLambdaCredentials } from "../Services/getLambdaURL";
import { forgetAnswers, rememberAnswers, sheetsBeacon, sheetsPost, storedAnswers, usingSheets } from "../Services/sheetsApi";
import { retryDelay } from "../Services/network";

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
 * On the public site, answers are sent this many at a time, or once the oldest has waited about BATCH_WAIT_MS
 * (between two thirds and four thirds of it, varying from batch to batch, so a room of people who started
 * together don't all send together). The Sheet's script saves about one request a second, however many answers
 * it carries (measured on Google with 60 volunteers), so what matters is how often phones send: at one request
 * every minute and a half, 60 people send under one a second. Waiting answers are kept in storage, and sent at
 * once when the page is hidden, so waiting doesn't put them at risk.
 */
const BATCH_SIZE = 25;
const BATCH_WAIT_MS = 90000;
/** Longest wait before sending once the connection comes back. */
const ONLINE_SPREAD_MS = 10000;

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

/** An answer waiting to be sent, as it will be sent. */
interface Waiting {
    id: string;
    item: QueueItem;
    /** When it was given, in milliseconds, or NaN if unknown. */
    at: number;
    /** Left unsent by an earlier visit or another tab. */
    leftover: boolean;
}

/** How sending is going. */
export interface QueueState extends State<boolean> {
    /** Answers not yet received by the backend. */
    waiting: number;
    /** Whether the last try to send failed, so the answers are waiting to be tried again. */
    failing: boolean;
}

/**
 * Union type representing possible actions in the queue reducer.
 */
type Action =
  | { type: "loading" }
  | { type: "success" }
  | { type: "error"; payload: Error };

/**
 * Sends answers to the backend. Each answer is sent once; one that fails stays queued and is tried again after a
 * wait that grows with each failure in a row. Only the answers a request carried are removed when it succeeds, so
 * answers given while it was in flight aren't lost. On the public site, answers are also kept in storage until
 * the Sheet has them, sent in small batches, and sent at once when the page is hidden or the connection returns.
 * @param votes - The answers waiting to be sent.
 * @param onSent - Called with the IDs of answers the backend has received.
 * @returns {QueueState} Whether the last send worked, and how many answers are waiting.
 */
export default function useQueue(
    votes: QueuedVote[],
    onSent: (ids: string[]) => void
): QueueState {
    // Answers on their way or already received, so they're never sent twice; a failed send forgets its answers
    const handled = useRef<Set<string>>(new Set());
    // Answers the backend has, so a late update can't put them back in storage
    const received = useRef<Set<string>>(new Set());
    const mounted = useRef<boolean>(true);
    // Answers an earlier visit or another tab left unsent, as they were kept; sent before anything else
    const [leftovers, setLeftovers] = useState<QueueItem[]>(storedAnswers);
    // Failed sends in a row, and the earliest time to try again
    const failures = useRef<number>(0);
    const retryAt = useRef<number>(0);
    // Set after two failures in a row; one "busy" answer from a crowded script isn't worth telling anyone about
    const [failing, setFailing] = useState<boolean>(false);
    // Set when the connection comes back: send what's waiting now instead of waiting to fill a batch
    const sendNow = useRef<boolean>(false);
    // Changes to look at the queue again, from a timer or an event
    const [wake, setWake] = useState<number>(0);
    const timer = useRef<ReturnType<typeof setTimeout>>();
    const initialState: State<boolean> = {
        error: undefined,
        data: undefined,
    };
    const { context } = useContext(CONTEXT) as ContextState;
    const sid = context.sid;

    /**
     * Gets the QueueItem to be sent for an answer.
     * @param vote - The answer.
     * @returns {QueueItem} The answer as it's sent.
     */
    const toQueueItem = (vote: QueuedVote): QueueItem => ({
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
    });

    /**
     * Gets every answer not yet received: those left from before, then this visit's.
     * @returns {Waiting[]} The answers, as they'll be sent.
     */
    const allWaiting = (): Waiting[] => {
        const mine = new Set(votes.map((vote) => vote.id));
        return [
            ...leftovers
                .filter((item) => !mine.has(item.vote_id ?? ""))
                .map((item) => ({ id: item.vote_id ?? "", item, at: Date.parse(item.answered_at ?? ""), leftover: true })),
            ...votes.map((vote) => ({ id: vote.id, item: toQueueItem(vote), at: Date.parse(vote.answeredAt ?? ""), leftover: false })),
        ];
    };

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
     * @param keepalive - Lets the request finish after the page closes.
     */
    const queueData = async (items: QueueItem[], keepalive: boolean) => {
        if (usingSheets) {
            const answer = await sheetsPost({ action: "votes", items }, { keepalive }) as { added?: unknown } | null;
            // The script says how many it added; anything else (busy, or an error page) means try again later
            if (typeof answer?.added !== "number") throw new Error("The Sheet didn't save the answers");
            return;
        }
        const response = await fetch(getLambdaURL("/hints"), {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(items),
            credentials: getLambdaCredentials(),
            keepalive,
        });
        if (!response.ok) throw new Error(`submit-votes failed: ${response.status}`);
    }

    /**
     * Sends some waiting answers, and keeps track of how it went.
     * @param batch - The answers to send.
     * @param keepalive - Lets the request finish after the page closes.
     */
    const send = (batch: Waiting[], keepalive: boolean = false) => {
        const ids = batch.map((waiting) => waiting.id);
        ids.forEach((id) => handled.current.add(id));
        dispatch({ type: "loading" });

        queueData(batch.map((waiting) => waiting.item), keepalive)
            .then(() => {
                failures.current = 0;
                ids.forEach((id) => received.current.add(id));
                forgetAnswers(ids);
                if (!mounted.current) return;
                setFailing(false);
                setLeftovers((items) => items.filter((item) => !ids.includes(item.vote_id ?? "")));
                onSent(ids);
                dispatch({ type: "success" });
            })
            .catch((error: Error) => {
                // Not sent: forget them so they're sent again, after a wait that grows with each failure in a row
                ids.forEach((id) => handled.current.delete(id));
                failures.current += 1;
                retryAt.current = Date.now() + retryDelay(failures.current);
                if (!mounted.current) return;
                setFailing(failures.current >= 2);
                dispatch({ type: "error", payload: error });
                setWake((n) => n + 1);
            });
    };

    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
            clearTimeout(timer.current);
        };
    }, []);

    // Keep this visit's answers in storage until the Sheet has them. An answer that leaves the queue unsent was
    // replaced by a new answer to the same hint after Back; a sent one has already been forgotten.
    const kept = useRef<string[]>([]);
    useEffect(() => {
        if (!usingSheets) return;
        const ids = votes.map((vote) => vote.id);
        forgetAnswers(kept.current.filter((id) => !ids.includes(id)));
        rememberAnswers(votes.filter((vote) => !received.current.has(vote.id)).map(toQueueItem));
        kept.current = ids;
    }, [votes, sid]);

    useEffect(() => {
        clearTimeout(timer.current);
        const pending = allWaiting().filter((waiting) => !handled.current.has(waiting.id));
        if (pending.length === 0) return;
        const now = Date.now();
        /**
         * Looks at the queue again after a while.
         * @param ms - How long to wait.
         */
        const later = (ms: number) => {
            timer.current = setTimeout(() => setWake((n) => n + 1), ms);
        };
        if (now < retryAt.current) {
            later(retryAt.current - now);
            return;
        }
        // On the public site an answer waits for others to go with it, unless it's left from before. The wait is
        // set by the first answer's random ID, so it stays the same while the batch fills.
        const oldest = Math.min(...pending.map((waiting) => (Number.isNaN(waiting.at) ? now : waiting.at)));
        const spread = parseInt(pending[0].id.slice(0, 8), 16) / 0xffffffff;
        const batchWait = BATCH_WAIT_MS * (2 / 3 + (Number.isNaN(spread) ? 0.5 : spread) * 2 / 3);
        const batching = usingSheets && !sendNow.current && pending.length < BATCH_SIZE && !pending.some((waiting) => waiting.leftover);
        if (batching && now - oldest < batchWait) {
            later(oldest + batchWait - now);
            return;
        }
        sendNow.current = false;
        send(pending.slice(0, MAX_PER_REQUEST));
    }, [votes, leftovers, wake]);

    // The latest versions, for the page events below; the first render's have the blank session ID
    const latest = useRef({ allWaiting, send });
    latest.current = { allWaiting, send };

    useEffect(() => {
        /**
         * Gets the answers not on their way yet.
         * @returns {Waiting[]} Up to one request's worth.
         */
        const unsent = () => latest.current.allWaiting().filter((waiting) => !handled.current.has(waiting.id)).slice(0, MAX_PER_REQUEST);
        /**
         * Tries again now that the connection is back, without waiting to fill a batch: within a few seconds,
         * at a random moment, since a room's Wi-Fi comes back for everyone at once.
         */
        const online = () => {
            retryAt.current = Date.now() + Math.random() * ONLINE_SPREAD_MS;
            sendNow.current = true;
            setWake((n) => n + 1);
        };
        /**
         * Back on the page: look at the queue again, keeping any wait after a failure, so a room that looks back
         * at once doesn't send at once. Leaving it: a phone may close the tab at any time now, so send what's
         * waiting right away, in a request that finishes even if the page is closed.
         */
        const visibility = () => {
            if (document.visibilityState === "visible") {
                setWake((n) => n + 1);
                return;
            }
            const pending = unsent();
            if (pending.length > 0) latest.current.send(pending, true);
        };
        /**
         * As the page closes, sends anything still not on its way with a beacon, which the browser finishes after
         * the page is gone. The Sheet ignores any answer it already has.
         */
        const pagehide = () => {
            const pending = unsent();
            if (usingSheets && pending.length > 0) sheetsBeacon({ action: "votes", items: pending.map((waiting) => waiting.item) });
        };
        window.addEventListener("online", online);
        document.addEventListener("visibilitychange", visibility);
        window.addEventListener("pagehide", pagehide);
        return () => {
            window.removeEventListener("online", online);
            document.removeEventListener("visibilitychange", visibility);
            window.removeEventListener("pagehide", pagehide);
        };
    }, []);

    return { ...state, waiting: allWaiting().length, failing };
}
