import getLambdaURL, { getLambdaCredentials } from "../Services/getLambdaURL";
import { State, useFetch } from "./useFetch";
import newDummyData from "../Models/NewDummyData.json";
import { sheetsPost, usingSheets } from "../Services/sheetsApi";

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
    // On the public site, a volunteer with no saved place starts at a random hint the Sheet picks
    ...(usingSheets && lastInsertTime < 0 ? { start: "random" } : {}),
  });
  const response = await fetch(getLambdaURL(path), {
    method: "GET",
    credentials: getLambdaCredentials(),
    signal: timeoutSignal(HINTS_TIMEOUT_MS),
  });

  if (!response.ok) {
    return { error: new Error("Failed to fetch hints") };
  }

  const data = await response.json();

  // No real hints left: don't pad the response with a lone dummy hint
  if (Array.isArray(data) && data.length === 0) return { data: [] as T };

  // TODO: add ?correct=true/false if we want a specific true/false dummy hint
  const response2 = await fetch(getLambdaURL(hintsUrl({ dummy: true, record_type: recordType })), {
    method: "GET",
    credentials: getLambdaCredentials(),
    signal: timeoutSignal(HINTS_TIMEOUT_MS),
  });

  if (!response2.ok) {
    return { error: new Error("Failed to fetch dummy hint") };
  }

  const data2 = await response2.json();
  // The check hint goes at a random spot in the page, so it isn't always every 11th hint
  const hints = Array.isArray(data) ? [...data] : [data];
  hints.splice(Math.floor(Math.random() * (hints.length + 1)), 0, data2);
  return { data: hints as T };
}

/**
 * Gets a signal that aborts a request after a while. AbortSignal.timeout is missing on older phones
 * (Safari before iOS 16), so this falls back to a timer.
 * @param {number} ms - How long to wait before giving up.
 * @returns {AbortSignal} A signal for fetch that fires after that long.
 */
function timeoutSignal(ms: number): AbortSignal {
  if (typeof AbortSignal.timeout === "function") return AbortSignal.timeout(ms);
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
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
      const data = await sheetsPost({ action: "code", code }) as { accepted?: boolean };
      return Boolean(data?.accepted);
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
const HINTS_TIMEOUT_MS = 15000;

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
