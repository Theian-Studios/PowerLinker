import getLambdaURL, { getLambdaCredentials } from "../Services/getLambdaURL";
import { State, useFetch } from "./useFetch";
import newDummyData from "../Models/NewDummyData.json";
import { sheetsPost, usingSheets } from "../Services/sheetsApi";
import { isOnline, REQUEST_TIMEOUT_MS, timeoutSignal, wait } from "../Services/network";

export const TESTING = false;

/**
 * Creates a URL with the given parameters.
 * @param {Record<string, string | number | boolean>} params - The parameters to add to the URL.
 * @returns {string} The URL with the parameters.
 */
function hintsUrl(params: Record<string, string | number | boolean>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    search.set(key, String(value));
  }
  return `/hints?${search.toString()}`;
}

/**
 * Custom hook that automatically calls a lambda based on the environment you're working in.
 * @template T - The type of data expected from the API response.
 * @param {string} [path] - The path of the API call, starting with a leading slash (ex. `/hint`).
 * @param {RequestInit} [options] - Options for the `fetch` call.
 * @returns {State<T>} A state object with optional data and error properties.
 */
export function useLambdaFetch<T = unknown>(
  path?: string,
  options?: RequestInit
): State<T> {
  options = options ? options : (options = { method: "POST" });
  options.method = options.method ? options.method : "POST";
  // Send the anonymous voter cookie when the backend uses it
  options.credentials = options.credentials ?? getLambdaCredentials();

  // docker uses one function to forward all requests so we can test entire backend with frontend locally
  if (getLambdaURL(path ?? "").includes("invocations")) {
    options.body = JSON.stringify({ path: path, event: options.body ?? undefined });
  }
  return useFetch(getLambdaURL(path ?? ""), options);
}

/**
 * Uses the hint list lambda in an asyncronous way.
 * @param count Number of hints to fetch (default is 10).
 * @param lastInsertTime Last insert-time of the fetched hints (default is -1).
 * @param recordType Type of record to fetch (default is "record_attachment").
 * @returns {T} List of hints or an error object.
 */
export async function asyncUseHintList<T = unknown>(
  count: number = 10,
  lastInsertTime: number = -1,
  recordType: string = "record_attachment"
): Promise<{ data?: T; error?: Error }> {
//console.log("in asyncUseHintList")
  if (TESTING) return { data: newDummyData as T };

  const path = hintsUrl({
    record_type: recordType,
    last_insert_time: lastInsertTime,
    count,
    // The Sheet hands out the next hints from one shared position and ignores this; it stays so the query matches
    // the page's early request (index.html)
    ...(usingSheets && lastInsertTime < 0 ? { start: "random" } : {}),
    // and the Sheet sends a check hint along with the page, so a visit starts its script once, not twice
    ...(usingSheets ? { with_check: true } : {}),
  });
  // The lab's API sends the check hint on its own, asked for at the same time as the page
  // TODO: add ?correct=true/false if we want a specific true/false dummy hint
  const [page, separateCheck] = await Promise.all([
    takeEarlyRequest(path) ?? loadPageWithRetries(path),
    usingSheets ? Promise.resolve(undefined) : fetchCheckHint(recordType),
  ]);

  if (!page.ok) {
    return { error: new Error("Failed to fetch hints") };
  }

  // The Sheet answers { hints, check }; a script from before that change, or the lab's API, a plain list
  const combined = isPageWithCheck(page.data) ? page.data : undefined;
  const data = combined ? combined.hints : page.data;

  // No real hints left: don't pad the response with a lone dummy hint
  if (Array.isArray(data) && data.length === 0) return { data: [] as T };

  const checkHint = combined ? combined.check : separateCheck ?? (usingSheets ? await fetchCheckHint(recordType) : undefined);
  // The check hint goes at a random spot in the page, so it isn't always every 11th hint. Without one, the
  // real hints still show; the next page brings another.
  const hints = Array.isArray(data) ? [...data] : [data];
  if (checkHint) hints.splice(Math.floor(Math.random() * (hints.length + 1)), 0, checkHint);
  return { data: hints as T };
}

/**
 * Checks whether the Sheet answered with a page of hints and a check hint together.
 * @param {unknown} data - The parsed answer.
 * @returns {boolean} True for { hints, check }.
 */
function isPageWithCheck(data: unknown): data is { hints: unknown[]; check?: unknown } {
  return typeof data === "object" && data !== null && !Array.isArray(data) && Array.isArray((data as { hints?: unknown }).hints);
}

/**
 * Gets a page of hints.
 * @param {string} path - The hints path with its query.
 * @returns {Promise<{ ok: boolean; data?: unknown }>} The parsed answer, or ok false when the server said no.
 */
async function loadPage(path: string): Promise<{ ok: boolean; data?: unknown }> {
  const response = await fetch(getLambdaURL(path), {
    method: "GET",
    credentials: getLambdaCredentials(),
    signal: timeoutSignal(HINTS_TIMEOUT_MS),
  });
  return response.ok ? { ok: true, data: await response.json() } : { ok: false };
}

/** Waits before asking again for a page that failed: Google's script now and then fails a request outright. */
const PAGE_RETRY_WAITS_MS = [2000, 5000];

/**
 * Gets a page of hints, asking again a couple of times if it fails, so a passing hiccup doesn't end in "Couldn't
 * load hints". The waits vary a little, so volunteers who failed together don't all ask again together. Offline,
 * it stops at once: the page asks again when the connection comes back.
 * @param {string} path - The hints path with its query.
 * @returns {Promise<{ ok: boolean; data?: unknown }>} The parsed answer, or ok false when every try failed.
 */
async function loadPageWithRetries(path: string): Promise<{ ok: boolean; data?: unknown }> {
  for (let attempt = 0; ; attempt++) {
    try {
      const page = await loadPage(path);
      if (page.ok) return page;
      if (attempt >= PAGE_RETRY_WAITS_MS.length || !isOnline()) return page;
    } catch (error) {
      if (attempt >= PAGE_RETRY_WAITS_MS.length || !isOnline()) throw error;
    }
    await wait(PAGE_RETRY_WAITS_MS[attempt] * (0.75 + Math.random() / 2));
  }
}

/** The first request for hints, started by index.html before the app's code had loaded. */
interface EarlyRequest {
  query: string;
  response: Promise<{ ok: boolean; data?: unknown } | null>;
}

/**
 * Takes over the request index.html started for this same page of hints, once. If it asked for something
 * else (the volunteer's place changed), failed, or hasn't answered within the app's usual time limit, the
 * page is asked for again as usual: Google has been seen holding a request for minutes, and index.html's
 * request has no limit of its own.
 * @param {string} path - The hints path with its query, as this app would ask for it.
 * @returns {Promise<{ ok: boolean; data?: unknown }> | undefined} Its answer, or undefined to ask normally.
 */
function takeEarlyRequest(path: string): Promise<{ ok: boolean; data?: unknown }> | undefined {
  const early = (window as { powerlinkerFirstHints?: EarlyRequest }).powerlinkerFirstHints;
  (window as { powerlinkerFirstHints?: EarlyRequest }).powerlinkerFirstHints = undefined;
  if (!usingSheets || !early || early.query !== path.slice(path.indexOf("?"))) return undefined;
  const timedOut = new Promise<null>((resolve) => setTimeout(() => resolve(null), HINTS_TIMEOUT_MS));
  return Promise.race([early.response, timedOut]).then((answer) => answer ?? loadPageWithRetries(path));
}

/**
 * Gets one check hint, whose answer is known.
 * @param {string} recordType - The type of hint to check with.
 * @returns {Promise<unknown>} The check hint, or undefined if it couldn't be loaded.
 */
async function fetchCheckHint(recordType: string): Promise<unknown> {
  try {
    const response = await fetch(getLambdaURL(hintsUrl({ dummy: true, record_type: recordType })), {
      method: "GET",
      credentials: getLambdaCredentials(),
      signal: timeoutSignal(HINTS_TIMEOUT_MS),
    });
    return response.ok ? await response.json() : undefined;
  } catch (error) {
    console.error("Error fetching a check hint:", error);
    return undefined;
  }
}

/**
 * Custom hook to fetch a list of hints from the API.
 * @param {string} recordType - The type of record to fetch hints for (default is "record_attachment").
 * @param {number} lastInsertTime - The insert-time of the last fetched hint (default is -1).
 * @param {number} count - The number of hints to fetch (default is 10).
 * @returns {State<T>} A state object with optional data and error properties.
 */
export function useHintList<T = unknown>(
  count: number = 10,
  lastInsertTime: number = -1,
  recordType: string = "record_attachment"
): State<T> {
  if (TESTING) {
    setTimeout(() => {}, 1000);
  //console.log("Returning test/dummy data");
    return {
      data: newDummyData,
      error: undefined
    } as State<T>;
  }

  const path = hintsUrl({
    record_type: recordType,
    last_insert_time: lastInsertTime,
    count,
  });
  return useLambdaFetch<T>(path, {
    method: "GET"
  });
}

/**
 * Invalidates a session after too many missed check hints. A plain request, so it can be called
 * from a click handler (the hook below can't be).
 * @param {string} sid - The session ID to invalidate.
 */
export async function invalidateSession(sid: string): Promise<void> {
  if (TESTING) return;
  try {
    if (usingSheets) {
      await sheetsPost({ action: "invalidate", sid });
      return;
    }
    await fetch(getLambdaURL("/session-invalidate"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sid }),
      credentials: getLambdaCredentials(),
    });
  } catch (error) {
    console.error("Error invalidating session:", error);
  }
}

/**
 * Sends a code entered on the profile screen. The backend checks it, so the code isn't in this app's code;
 * a VIP code only marks the voter's votes and changes nothing in the app.
 * @param code - The code as entered.
 * @returns Whether the code was accepted, or undefined if the backend couldn't be reached.
 */
export async function submitProfileCode(code: string): Promise<boolean | undefined> {
  try {
    if (usingSheets) {
      const data = await sheetsPost({ action: "code", code }) as { accepted?: unknown } | null;
      // A busy script answers without "accepted": that's "couldn't check", not "wrong code"
      return typeof data?.accepted === "boolean" ? data.accepted : undefined;
    }
    const response = await fetch(getLambdaURL("/profile/code"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
      credentials: getLambdaCredentials(),
    });
    if (!response.ok) return undefined;
    const data = await response.json();
    return Boolean(data?.accepted);
  } catch (error) {
    console.error("Error sending profile code:", error);
    return undefined;
  }
}

/** How long to wait for hints before giving up, so a hung request can't block loading forever. */
const HINTS_TIMEOUT_MS = REQUEST_TIMEOUT_MS;

/**
 * Custom hook to invalidate a session by its session ID.
 * @param {string} sid - The session ID to invalidate.
 * @returns {State<T>} A state object with optional data and error properties.
 */
export function useInvalidateSession<T = unknown>(
  sid: string
): State<T> {
  if (TESTING) return {
    data: "Session invalidated. Timestamp set to 0.",
    error: undefined
  } as State<T>;

  const path = `/session-invalidate`;
  return useLambdaFetch<T>(path, {
    body: JSON.stringify({ sid: sid }),
  });
}
