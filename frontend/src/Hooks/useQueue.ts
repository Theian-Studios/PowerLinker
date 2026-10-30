import { useEffect, useRef, useReducer, useContext } from "react";
import { State } from "./useFetch";
import { Hint } from "../Models/Hint";
import { CONTEXT, ContextState } from "../Models/Context";
import getLambdaURL, { getLambdaCredentials } from "../Services/getLambdaURL";
import { sheetsPost, usingSheets } from "../Services/sheetsApi";

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
}

/**
 * Union type representing possible actions in the queue reducer.
 */
type Action =
  | { type: "loading" }
  | { type: "success" }
  | { type: "error"; payload: Error };

/**
 * Compiles a vote item and sends it to the queue.
 * @param pids - The PIDs of the people to vote on.
 * @param arks - The ARKs of the records to vote on.
 * @param votes - The vote values (1 for upvote, 0 for skip, -1 for downvote).
 * @param sid - The session ID of the user making the vote.
 * @param recordTypes - The types of records being voted on (default is "record_attachment").
 */
export default function useQueue(
    votes: { hint: Hint; vote: -1 | 0 | 1; seconds?: number }[],
    activate: boolean
): State<boolean> {
    const cancelRequest = useRef<boolean>(false);
    const initialState: State<boolean> = {
        error: undefined,
        data: undefined,
    };
    const { context } = useContext(CONTEXT) as ContextState;
    const sid = context.sid;

    /**
     * Gets the QueueItems to be sent to the queue.
     * @param pids - The PIDs of the people to vote on.
     * @param arks - The ARKs of the records to vote on.
     * @param votes - The vote values (1 for upvote, 0 for skip, -1 for downvote).
     * @param sid - The session ID of the user making the vote.
     * @param recordTypes - The types of records being voted on (default is "record_attachment").
     * @returns {QueueItem[]} An array of QueueItems to be sent to the queue.
     * @throws {Error} If the input arrays do not have the same length.
     */
    const getQueueItems = (
        votes: { hint: Hint; vote: -1 | 0 | 1; seconds?: number }[]
    ): QueueItem[] => {
        let queueItems: QueueItem[] = [];

        for (const vote of votes) {
            const item: QueueItem = {
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
            };
            queueItems.push(item);
        }

        return queueItems;
    }

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
     * Asynchronously sends the QueueItems to the submit-votes endpoint.
     * @param items - The QueueItems to be sent.
     */
    const queueData = async (items: QueueItem[]) => {
        try {
            if (usingSheets) {
                await sheetsPost({ action: "votes", items });
                if (cancelRequest.current) return;
                dispatch({ type: "success" });
                return;
            }
            const response = await fetch(getLambdaURL("/hints"), {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(items),
                credentials: getLambdaCredentials(),
            });
            if (!response.ok) throw new Error(`submit-votes failed: ${response.status}`);
            if (cancelRequest.current) return;
            dispatch({ type: "success" });
        } catch (error) {
            if (cancelRequest.current) return;
            dispatch({ type: "error", payload: error as Error });
        }
    }

    useEffect(() => {
        cancelRequest.current = false;
        dispatch({ type: "loading" });
        
        if (votes.length > 0) {
            const items = getQueueItems(votes);

            queueData(items);
        }

        return () => {
            cancelRequest.current = true;
        };
    }, [votes, activate]);

    return state;
}


