import "./Home.css";
import DocumentMatcher from "../../Components/DocumentMatcher/DocumentMatcher";
import { ReactElement, useCallback, useContext, useEffect, useRef, useState } from "react";
import newDummyData from "../../Models/ParentDummyData.json";
import { CONTEXT, ContextState, /* Context, getInitialContext */ } from "../../Models/Context.ts";
import { invalidateSession } from "../../Hooks/useLambdaFetch.ts";
import { savedCursor, usingSheets } from "../../Services/sheetsApi.ts";
import { State } from "../../Hooks/useFetch.ts";
import useQueue, { QueuedVote } from "../../Hooks/useQueue.ts";
import { useHomeHandlers } from "./utils.ts";

const MAX_HINTS_IN_QUEUE = 20;

/**
 * Home Page Component - Displays document match table and button bar.
 * @returns {ReactElement} The home page component with document matching functionality.
 */
export default function Home(): ReactElement {
  const contextState = useContext(CONTEXT) as ContextState;
  const { context, setContext } = contextState;
  const hintsDone: number = context.reviewedHints.length;

  const [attachQueue, setAttachQueue] = useState<QueuedVote[]>([]);
  // Changes every 30 seconds while answers are waiting, so ones that failed to send are retried
  const [retryTick, setRetryTick] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  // The public site only has the lab's possible duplicates
  const [hintType, setHintType] = useState<string>(usingSheets ? "possible_duplicate" : "record_attachment");
  const [loadError, setLoadError] = useState<boolean>(false);
  const awaitingHints = useRef<boolean>(false);
  // Answers waiting to be sent; each leaves the queue once the backend has it
  const removeSent = useCallback((ids: string[]) => {
    setAttachQueue((queue) => queue.filter((item) => !ids.includes(item.id)));
  }, []);
  const sendVotes: State<boolean> = useQueue(attachQueue, retryTick, removeSent);

  const { fetchHints, submit } = useHomeHandlers({
    awaitingHints,
    setLoading,
    setContext,
    context,
    attachQueue,
    setAttachQueue,
    invalidateSession,
    hintType,
    setLoadError,
  });

  const answersWaiting = attachQueue.length > 0;
  useEffect(() => {
    if (!answersWaiting) return;
    const interval = setInterval(() => setRetryTick((tick) => tick + 1), 30000);
    return () => clearInterval(interval);
  }, [answersWaiting]);

  useEffect(() => {
    if (sendVotes.error) {
      console.error("Error sending votes, will try again: ", sendVotes.error);
    }
  }, [sendVotes.error]);

  useEffect(() => {
    setContext((prev) => ({ ...prev, hintQue: [], reviewedHints: [] }));
    // Start the new type's fetch even if the old type's is still in flight; its late answer is ignored
    awaitingHints.current = false;
    fetchHints(savedCursor(), false);
    // eslint-disable-next-line
  }, [hintType]);

  useEffect(() => {
    if (context.hintQue.length < MAX_HINTS_IN_QUEUE) {
      const silent = context.hintQue.length > 0;
      let newTime = savedCursor();
      [...context.hintQue, ...context.reviewedHints].forEach(hint => {
        if (hint.insertTime > newTime) newTime = hint.insertTime;
      });
      fetchHints(newTime, silent);
    }
    // eslint-disable-next-line
  }, [context.hintQue.length]);

  // A div, since the layout's <main> already wraps every page
  return (
    <div className="page-home">
      {typeof newDummyData === "string" ? (
        <div>
          <div className="hint-message">{"Hint message"}</div>
          {hintsDone > 0 ? (
            <h3 className="counter">{"You completed " + hintsDone + " hints."}</h3>
          ) : (
            <div/>
          )}
        </div>
      ) : newDummyData instanceof Error ? (
        <div>
          <div className="hint-message">{"Hint message"}</div>
          {hintsDone > 0 ? (
            <h3 className="counter">{"You completed " + hintsDone + " hints."}</h3>
          ) : (
            <div/>
          )}
        </div>
      ) : (
        <DocumentMatcher
          submit={submit}
          loading={loading}
          setLoading={setLoading}
          hintType={hintType}
          setHintType={setHintType}
          loadError={loadError}
          onRetry={() => fetchHints(savedCursor(), false)}
        />
      )}
    </div>
  );
}
