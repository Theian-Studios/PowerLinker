import "./Home.css";
import DocumentMatcher from "../../Components/DocumentMatcher/DocumentMatcher";
import { ReactElement, useCallback, useContext, useEffect, useRef, useState } from "react";
import newDummyData from "../../Models/ParentDummyData.json";
import { CONTEXT, ContextState, /* Context, getInitialContext */ } from "../../Models/Context.ts";
import { invalidateSession } from "../../Hooks/useLambdaFetch.ts";
import { chooseHintType, saveUpcoming, savedCursor, savedHintType, savedUpcoming, usingSheets } from "../../Services/sheetsApi.ts";
import { getPersons } from "../../Services/getPersons.ts";
import useQueue, { QueuedVote } from "../../Hooks/useQueue.ts";
import useOnline from "../../Hooks/useOnline.ts";
import { isOnline } from "../../Services/network.ts";
import { useHomeHandlers } from "./utils.ts";
import { CHILE, tr } from "../../Services/region.ts";

const MAX_HINTS_IN_QUEUE = 20;
/** How often hints that couldn't load are asked for again. */
const HINTS_RETRY_MS = 30000;
/** Longest wait before asking again once the connection comes back. */
const ONLINE_SPREAD_MS = 5000;

/**
 * Says what's happening with the connection, when the volunteer needs to know.
 * @param online - Whether the browser is online.
 * @param waiting - Answers not yet received by the Sheet.
 * @param failing - Whether the last try to send them failed.
 * @param hintsShown - Whether there's a hint on screen to keep working on.
 * @returns The note, or undefined when all is well.
 */
function connectionNote(online: boolean, waiting: number, failing: boolean, hintsShown: boolean): string | undefined {
  const one = waiting === 1;
  const answers = CHILE ? `${waiting} ${one ? "respuesta" : "respuestas"}` : `${waiting} ${one ? "answer" : "answers"}`;
  if (!online) {
    if (waiting > 0) {
      return CHILE
        ? `Estás sin conexión. ${one ? "Tu respuesta se enviará" : `Tus ${answers} se enviarán`} cuando vuelvas a conectarte.`
        : `You’re offline. ${answers} will be sent when you’re back online.`;
    }
    return hintsShown ? tr("You’re offline. You can keep answering the hints already loaded.", "Estás sin conexión. Puedes seguir respondiendo las sugerencias que ya se cargaron.") : undefined;
  }
  if (failing && waiting > 0) {
    return CHILE
      ? `${one ? "1 respuesta aún no llega" : `${answers} aún no llegan`} al laboratorio. ${one ? "Está guardada" : "Están guardadas"} en este dispositivo y se ${one ? "enviará" : "enviarán"} de nuevo en breve.`
      : `${answers} haven’t reached the lab yet. They’re kept on this device and will be sent again shortly.`;
  }
  return undefined;
}

/**
 * Home Page Component - Displays document match table and button bar.
 * @returns {ReactElement} The home page component with document matching functionality.
 */
export default function Home(): ReactElement {
  const contextState = useContext(CONTEXT) as ContextState;
  const { context, setContext } = contextState;
  const hintsDone: number = context.reviewedHints.length;

  const [attachQueue, setAttachQueue] = useState<QueuedVote[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  // On the public site, the kind the volunteer chose last time
  // The Chilean site has only possible duplicates for now
  const [hintType, setHintTypeState] = useState<string>(CHILE ? "possible_duplicate" : usingSheets ? savedHintType() : "record_attachment");
  const setHintType = useCallback((type: string) => {
    // Switched before the queue reloads, so it loads the new kind's saved hints and place
    chooseHintType(type);
    setHintTypeState(type);
  }, []);
  const [loadError, setLoadError] = useState<boolean>(false);
  const awaitingHints = useRef<boolean>(false);
  // Answers waiting to be sent; each leaves the queue once the backend has it
  const removeSent = useCallback((ids: string[]) => {
    setAttachQueue((queue) => queue.filter((item) => !ids.includes(item.id)));
  }, []);
  const sendVotes = useQueue(attachQueue, removeSent);
  const online = useOnline();

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
    if (sendVotes.error) {
      console.error("Error sending votes, will try again: ", sendVotes.error);
    }
  }, [sendVotes.error]);

  useEffect(() => {
    // A returning volunteer starts on the hints saved last visit, while the next page loads behind them
    const saved = getPersons({ data: savedUpcoming() });
    setContext((prev) => ({ ...prev, hintQue: saved, reviewedHints: [] }));
    if (saved.length > 0) setLoading(false);
    // Start the new type's fetch even if the old type's is still in flight; its late answer is ignored
    awaitingHints.current = false;
    fetchHints(saved.reduce((max, hint) => Math.max(max, hint.insertTime), savedCursor()), saved.length > 0);
    // eslint-disable-next-line
  }, [hintType]);

  // Keep the next few hints saved for the next visit
  useEffect(() => {
    saveUpcoming(context.hintQue.filter((hint) => !hint.dummy && hint.raw).map((hint) => hint.raw));
  }, [context.hintQue]);

  /**
   * Asks for the hints after the furthest one queued, answered, or answered on an earlier visit; without the
   * loading screen if there are still hints to show.
   */
  const fetchMore = () => {
    let newTime = savedCursor();
    [...context.hintQue, ...context.reviewedHints].forEach(hint => {
      if (hint.insertTime > newTime) newTime = hint.insertTime;
    });
    fetchHints(newTime, context.hintQue.length > 0);
  };
  const latestFetchMore = useRef(fetchMore);
  latestFetchMore.current = fetchMore;

  useEffect(() => {
    if (context.hintQue.length < MAX_HINTS_IN_QUEUE) fetchMore();
    // eslint-disable-next-line
  }, [context.hintQue.length]);

  // Hints that couldn't load are asked for again without waiting for "Try again": when the connection comes
  // back, when the volunteer comes back to the tab, and every so often
  useEffect(() => {
    if (!loadError) return;
    /**
     * Tries again if there's a chance it works and someone's there to see it.
     */
    const retry = () => {
      if (isOnline() && document.visibilityState === "visible") latestFetchMore.current();
    };
    // A room's Wi-Fi comes back for everyone at once, so each waits a random few seconds
    let onlineTimer: ReturnType<typeof setTimeout> | undefined;
    /**
     * Tries again a moment after the connection comes back.
     */
    const online = () => {
      clearTimeout(onlineTimer);
      onlineTimer = setTimeout(retry, Math.random() * ONLINE_SPREAD_MS);
    };
    const interval = setInterval(retry, HINTS_RETRY_MS);
    window.addEventListener("online", online);
    document.addEventListener("visibilitychange", retry);
    return () => {
      clearInterval(interval);
      clearTimeout(onlineTimer);
      window.removeEventListener("online", online);
      document.removeEventListener("visibilitychange", retry);
    };
  }, [loadError]);

  // A div, since the layout's <main> already wraps every page
  return (
    <div className="page-home">
      {typeof newDummyData === "string" ? (
        <div>
          <div className="hint-message">{tr("Hint message", "Mensaje de sugerencia")}</div>
          {hintsDone > 0 ? (
            <h3 className="counter">{tr(`You completed ${hintsDone} hints.`, `Revisaste ${hintsDone} ${hintsDone === 1 ? "sugerencia" : "sugerencias"}.`)}</h3>
          ) : (
            <div/>
          )}
        </div>
      ) : newDummyData instanceof Error ? (
        <div>
          <div className="hint-message">{tr("Hint message", "Mensaje de sugerencia")}</div>
          {hintsDone > 0 ? (
            <h3 className="counter">{tr(`You completed ${hintsDone} hints.`, `Revisaste ${hintsDone} ${hintsDone === 1 ? "sugerencia" : "sugerencias"}.`)}</h3>
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
          offline={!online}
          connectionNote={connectionNote(online, sendVotes.waiting, sendVotes.failing, context.hintQue.length > 0)}
          onRetry={() => fetchHints(savedCursor(), false)}
        />
      )}
    </div>
  );
}
