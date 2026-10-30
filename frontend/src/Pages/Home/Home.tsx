import "./Home.css";
import DocumentMatcher from "../../Components/DocumentMatcher/DocumentMatcher";
import { ReactElement, useContext, useEffect, useRef, useState } from "react";
import newDummyData from "../../Models/ParentDummyData.json";
import { CONTEXT, ContextState, /* Context, getInitialContext */ } from "../../Models/Context.ts";
import { invalidateSession } from "../../Hooks/useLambdaFetch.ts";
import { usingSheets } from "../../Services/sheetsApi.ts";
import { State } from "../../Hooks/useFetch.ts";
import useQueue from "../../Hooks/useQueue.ts";
import { Hint } from "../../Models/Hint.ts";
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

  const [attachQueue, setAttachQueue] = useState<{ hint: Hint; vote: -1 | 0 | 1; seconds?: number }[]>([]);
  const [attach, setAttach] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  // The public site only has the lab's possible duplicates
  const [hintType, setHintType] = useState<string>(usingSheets ? "possible_duplicate" : "record_attachment");
  const [loadError, setLoadError] = useState<boolean>(false);
  const awaitingHints = useRef<boolean>(false);
  // Queue for attaching hints, when there are 10 we send them to the backend

  const sendVotes: State<boolean> = useQueue(attachQueue, attach);

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

  useEffect(() => {
    setAttach(false);
    const interval = setInterval(() => setAttach(true), 60000);
    return () => clearInterval(interval);
  }, [attachQueue]);

  useEffect(() => {
    if (sendVotes.error) {
      console.error("Error sending votes, will try again: ", sendVotes.error);
    }
    if (sendVotes.data) {
      setAttachQueue([]);
    }
  }, [sendVotes.data, sendVotes.error]);

  useEffect(() => {
    setContext((prev) => ({ ...prev, hintQue: [], reviewedHints: [] }));
    // Start the new type's fetch even if the old type's is still in flight; its late answer is ignored
    awaitingHints.current = false;
    fetchHints(-1, false);
    // eslint-disable-next-line
  }, [hintType]);

  useEffect(() => {
    if (context.hintQue.length < MAX_HINTS_IN_QUEUE) {
      const silent = context.hintQue.length > 0;
      let newTime = -1;
      [...context.hintQue, ...context.reviewedHints].forEach(hint => {
        if (hint.insertTime > newTime) newTime = hint.insertTime;
      });
      fetchHints(newTime, silent);
    }
    // eslint-disable-next-line
  }, [context.hintQue.length]);

  return (
    <main className="page-home">
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
          onRetry={() => fetchHints(-1, false)}
        />
      )}
    </main>
  );
}
