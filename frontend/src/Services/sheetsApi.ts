// The public site's backend: a Google Apps Script web app on the lab's results Sheet (see sheets/README.md).
// When VITE_SHEETS_URL is set at build time, the app gets hints from it and sends every answer to it;
// otherwise it uses the lab's AWS API or the local mock, as before.

import { v4 } from "uuid";

/** The Apps Script web app address, if this build uses the Sheet. */
export const SHEETS_URL: string | undefined = import.meta.env.VITE_SHEETS_URL || undefined;

/** Whether this build stores results in the Google Sheet. */
export const usingSheets = Boolean(SHEETS_URL);

const VOTER_KEY = "powerlinker.voter";

/** This visit's voter ID when the browser won't store one, so storage-less visitors don't share an ID. */
let visitVoterId: string | undefined;

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
    visitVoterId ??= v4();
    return visitVoterId;
  }
}

const NAME_KEY = "powerlinker.name";
const NAME_ASKED_KEY = "powerlinker.nameAsked";
/** Longest name kept; the Sheet's script cuts it to the same length. */
export const MAX_NAME_LENGTH = 80;

/**
 * Gets the name this volunteer gave, which goes with each answer so the lab knows who did which records.
 * @returns {string} The name, or "" when they haven't given one.
 */
export function volunteerName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

/**
 * Saves the volunteer's name, or clears it when blank, and stops the first-visit prompt from coming back.
 * @param {string} name - The name they typed.
 */
export function saveVolunteerName(name: string): void {
  try {
    const trimmed = name.trim().slice(0, MAX_NAME_LENGTH);
    if (trimmed) localStorage.setItem(NAME_KEY, trimmed);
    else localStorage.removeItem(NAME_KEY);
    localStorage.setItem(NAME_ASKED_KEY, "1");
  } catch {
    // Without storage the name can't be kept; answers still count without it
  }
}

/**
 * Whether to ask for a name on this visit: only on the public site, and only until they give one or skip.
 * @returns {boolean} True the first time.
 */
export function shouldAskName(): boolean {
  if (!usingSheets) return false;
  try {
    return !localStorage.getItem(NAME_KEY) && !localStorage.getItem(NAME_ASKED_KEY);
  } catch {
    // Storage is blocked, so a name couldn't be kept anyway
    return false;
  }
}

/**
 * Sends a request to the Sheet's script. It's sent as plain text so the browser skips the CORS
 * preflight, which Apps Script can't answer; the script reads it as JSON.
 * @param {Record<string, unknown>} body - The action and its data; the voter ID and name are added.
 * @returns {Promise<unknown>} The script's JSON answer.
 */
export async function sheetsPost(body: Record<string, unknown>): Promise<unknown> {
  if (!SHEETS_URL) throw new Error("No Sheets URL configured");
  const response = await fetch(SHEETS_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ ...body, voter: voterId(), name: volunteerName() }),
  });
  if (!response.ok) throw new Error(`Sheets request failed: ${response.status}`);
  return response.json();
}

/**
 * Sends a request to the Sheet's script as the page closes. The browser finishes a beacon after the page
 * is gone, though nothing can read the answer.
 * @param {Record<string, unknown>} body - The action and its data; the voter ID and name are added.
 * @returns {boolean} Whether the browser accepted it for sending.
 */
export function sheetsBeacon(body: Record<string, unknown>): boolean {
  if (!SHEETS_URL || typeof navigator === "undefined" || typeof navigator.sendBeacon !== "function") return false;
  try {
    const data = new Blob([JSON.stringify({ ...body, voter: voterId(), name: volunteerName() })], { type: "text/plain;charset=utf-8" });
    return navigator.sendBeacon(SHEETS_URL, data);
  } catch {
    return false;
  }
}

const CURSOR_KEY = "powerlinker.cursor";

/**
 * Gets how far this browser has answered, so a returning volunteer picks up where they stopped. A new
 * volunteer has no place yet; the Sheet then starts them at a random hint (see asyncUseHintList).
 * @returns {number} The position of the furthest hint answered, or -1 for none.
 */
export function savedCursor(): number {
  if (!usingSheets) return -1;
  try {
    const value = Number(localStorage.getItem(CURSOR_KEY));
    return Number.isFinite(value) && value > 0 ? value : -1;
  } catch {
    return -1;
  }
}

/**
 * Remembers an answered hint's place, if it's further than any answered before.
 * @param {number} insertTime - The answered hint's insert-time.
 */
export function saveCursor(insertTime: number): void {
  if (!usingSheets || insertTime <= savedCursor()) return;
  try {
    localStorage.setItem(CURSOR_KEY, String(insertTime));
  } catch {
    // Without storage the next visit starts from the beginning, as before
  }
}

const UPCOMING_KEY = "powerlinker.upcoming";
/** Hints saved for the next visit; a few are enough to fill the wait for the next page. */
const UPCOMING_COUNT = 8;

/**
 * Saves the next hints in the queue, as the Sheet sent them, so a returning volunteer sees one the moment the
 * page opens instead of waiting on the Sheet. Check hints aren't saved: they carry their answer.
 * @param {unknown[]} hints - The hints waiting in the queue, in order.
 */
export function saveUpcoming(hints: unknown[]): void {
  if (!usingSheets) return;
  try {
    localStorage.setItem(UPCOMING_KEY, JSON.stringify(hints.slice(0, UPCOMING_COUNT)));
  } catch {
    // Too big for storage, or storage blocked: the next visit waits on the Sheet, as before
  }
}

/**
 * Gets the hints saved on the last visit that come after the furthest one answered.
 * @returns {unknown[]} The saved hints still to answer, in order.
 */
export function savedUpcoming(): unknown[] {
  if (!usingSheets) return [];
  try {
    const saved = JSON.parse(localStorage.getItem(UPCOMING_KEY) ?? "[]");
    const cursor = savedCursor();
    return Array.isArray(saved) ? saved.filter((hint) => Number(hint?.["insert-time"]) > cursor) : [];
  } catch {
    return [];
  }
}
