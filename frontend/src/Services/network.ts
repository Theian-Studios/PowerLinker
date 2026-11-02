// Helpers for requests on slow or unreliable connections.

/** How long to wait for the backend before giving up, so a hung request can't hold anything up for minutes. */
export const REQUEST_TIMEOUT_MS = 15000;
/**
 * How long to wait for a save. Longer, since saves take turns on the Sheet and with 60 people one can wait in
 * line for over 10 seconds; a phone that gives up too soon sends answers the Sheet has in fact saved, and those
 * can be saved twice.
 */
export const SAVE_TIMEOUT_MS = 30000;

/**
 * Gets a signal that aborts a request after a while. AbortSignal.timeout is missing on older phones
 * (Safari before iOS 16), so this falls back to a timer.
 * @param {number} ms - How long to wait before giving up.
 * @returns {AbortSignal} A signal for fetch that fires after that long.
 */
export function timeoutSignal(ms: number): AbortSignal {
  if (typeof AbortSignal.timeout === "function") return AbortSignal.timeout(ms);
  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

/**
 * Whether the browser thinks it's online. It can be wrong in the hopeful direction (connected to Wi-Fi with no
 * internet), so a true here still needs the request to work; a false is reliable.
 * @returns {boolean} False only when the browser knows it's offline.
 */
export function isOnline(): boolean {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

/**
 * How long to wait before trying a failed request again: longer after each failure in a row, up to about a
 * minute, and never exactly the same, so a room of volunteers who failed together don't all try again together.
 * @param {number} failures - Failures in a row so far, 1 for the first.
 * @returns {number} Milliseconds to wait.
 */
export function retryDelay(failures: number): number {
  const base = Math.min(60000, 5000 * 2 ** (Math.max(1, failures) - 1));
  return base * (0.5 + Math.random());
}

/**
 * Waits a while.
 * @param {number} ms - How long.
 * @returns {Promise<void>} Resolves after that long.
 */
export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
