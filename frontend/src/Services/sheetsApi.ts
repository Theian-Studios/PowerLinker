// The public site's backend: a Google Apps Script web app on the lab's results Sheet (see sheets/README.md).
// When VITE_SHEETS_URL is set at build time, the app gets hints from it and sends every answer to it;
// otherwise it uses the lab's AWS API or the local mock, as before.

import { v4 } from "uuid";

/** The Apps Script web app address, if this build uses the Sheet. */
export const SHEETS_URL: string | undefined = import.meta.env.VITE_SHEETS_URL || undefined;

/** Whether this build stores results in the Google Sheet. */
export const usingSheets = Boolean(SHEETS_URL);

const VOTER_KEY = "powerlinker.voter";

/**
 * Gets this browser's anonymous voter ID, making one the first time. Apps Script can't set cookies
 * for the app, so it's kept in local storage instead; it ties each person's answers together in the Sheet.
 * @returns {string} A random ID that stays the same in this browser.
 */
export function voterId(): string {
  try {
    const saved = localStorage.getItem(VOTER_KEY);
    if (saved) return saved;
    const id = v4();
    localStorage.setItem(VOTER_KEY, id);
    return id;
  } catch {
    // Private browsing can block storage; answers still count, just not tied together across visits
    return "no-storage";
  }
}

/**
 * Sends a request to the Sheet's script. It's sent as plain text so the browser skips the CORS
 * preflight, which Apps Script can't answer; the script reads it as JSON.
 * @param {Record<string, unknown>} body - The action and its data; the voter ID is added.
 * @returns {Promise<unknown>} The script's JSON answer.
 */
export async function sheetsPost(body: Record<string, unknown>): Promise<unknown> {
  if (!SHEETS_URL) throw new Error("No Sheets URL configured");
  const response = await fetch(SHEETS_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ ...body, voter: voterId() }),
  });
  if (!response.ok) throw new Error(`Sheets request failed: ${response.status}`);
  return response.json();
}
