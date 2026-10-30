/**
 * PowerLinker backend on a Google Sheet. Paste this into the Sheet's Extensions → Apps Script and
 * deploy it as a web app (Execute as: Me, Who has access: Anyone). See sheets/README.md.
 *
 * Tabs:
 *   Hints   hint_id | hint (JSON)             pairs to vote on, served in row order
 *   Checks  hint_id | expected | hint (JSON)  check hints with known answers (1 same, -1 different)
 *   Votes   one row per answer, added by this script
 *   Voters  one row per person who entered the VIP code
 *   Sessions  sessions ended after three missed check hints
 *
 * The VIP code lives in Project Settings → Script properties as VIP_CODE, never in this file,
 * since this file is public on GitHub.
 */

const VOTE_HEADERS = ["time", "voter", "session", "hint_id", "check", "expected", "correct", "vote", "answer", "seconds", "vip", "person_1", "person_2"];
const ANSWERS = { "1": "same", "-1": "different", "0": "not sure" };
const MAX_COUNT = 25;

/**
 * Answers GET requests: a page of hints, or one random check hint.
 * @param {GoogleAppsScript.Events.DoGet} e - The request.
 * @returns {GoogleAppsScript.Content.TextOutput} JSON.
 */
function doGet(e) {
  const params = e.parameter || {};
  if (params.dummy === "true") return json(checkHint());
  const after = Math.max(0, Number(params.last_insert_time) || 0);
  const count = Math.min(MAX_COUNT, Math.max(1, Number(params.count) || 10));
  return json(hintsAfter(after, count));
}

/**
 * Answers POST requests. The app sends text/plain JSON so browsers skip the CORS preflight,
 * which Apps Script can't answer.
 * @param {GoogleAppsScript.Events.DoPost} e - The request.
 * @returns {GoogleAppsScript.Content.TextOutput} JSON.
 */
function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (error) {
    return json({ error: "Not JSON" });
  }
  switch (body.action) {
    case "votes":
      return json(addVotes(body));
    case "code":
      return json(checkCode(body));
    case "invalidate":
      appendRows("Sessions", ["time", "session"], [[new Date(), String(body.sid || "")]]);
      return json({ ok: true });
    default:
      return json({ error: "Unknown action" });
  }
}

/**
 * Gets the hints after a row, in the app's hint format. Row 2 is insert-time 1, and so on.
 * @param {number} after - The insert-time of the last hint the app already has.
 * @param {number} count - How many to return.
 * @returns {Object[]} The hints.
 */
function hintsAfter(after, count) {
  const sheet = tab("Hints");
  const first = after + 2;
  const last = Math.min(sheet.getLastRow(), first + count - 1);
  if (last < first) return [];
  return sheet.getRange(first, 1, last - first + 1, 2).getValues().map(([id, data], i) => ({
    ...JSON.parse(data),
    hint_id: String(id),
    "insert-time": after + i + 1,
  }));
}

/**
 * Picks a random check hint and includes its answer, as the app grades it.
 * @returns {Object} The check hint.
 */
function checkHint() {
  const sheet = tab("Checks");
  const rows = sheet.getLastRow() - 1;
  if (rows < 1) return {};
  const row = 2 + Math.floor(Math.random() * rows);
  const [id, expected, data] = sheet.getRange(row, 1, 1, 3).getValues()[0];
  return { ...JSON.parse(data), hint_id: String(id), expected: Number(expected) };
}

/**
 * Records answers, one row each.
 * @param {Object} body - { voter, items: [{ hint, vote, hint_id, expected, seconds }] }.
 * @returns {Object} How many rows were added.
 */
function addVotes(body) {
  const voter = String(body.voter || "").slice(0, 64);
  const items = Array.isArray(body.items) ? body.items.slice(0, 100) : [];
  const vip = voter && PropertiesService.getScriptProperties().getProperty(`vip:${voter}`) === "1";
  const rows = items.map((item) => {
    const vote = Number(item.vote && item.vote.vote);
    const isCheck = item.expected === 1 || item.expected === -1;
    return [
      new Date(),
      voter,
      String((item.vote && item.vote.sid) || ""),
      String(item.hint_id || ""),
      isCheck,
      isCheck ? item.expected : "",
      isCheck ? vote === item.expected : "",
      vote,
      ANSWERS[String(vote)] || "",
      typeof item.seconds === "number" ? Math.round(item.seconds) : "",
      vip,
      String((item.hint && item.hint.id1) || ""),
      String((item.hint && item.hint.id2) || ""),
    ];
  });
  appendRows("Votes", VOTE_HEADERS, rows);
  return { added: rows.length };
}

/**
 * Checks a profile code against VIP_CODE and marks the voter as VIP when it matches.
 * Exact match: capitals count, and only spaces around the code are ignored.
 * @param {Object} body - { voter, code }.
 * @returns {Object} { accepted }.
 */
function checkCode(body) {
  const expected = PropertiesService.getScriptProperties().getProperty("VIP_CODE");
  const voter = String(body.voter || "").slice(0, 64);
  if (!expected || !voter || String(body.code || "").trim() !== expected) return { accepted: false };
  PropertiesService.getScriptProperties().setProperty(`vip:${voter}`, "1");
  appendRows("Voters", ["time", "voter", "vip"], [[new Date(), voter, true]]);
  return { accepted: true };
}

/**
 * Adds rows to a tab, creating it with headers the first time. A lock keeps two answers arriving
 * at once from writing over each other.
 * @param {string} name - The tab name.
 * @param {string[]} headers - Its column headers.
 * @param {Array[]} rows - The rows to add.
 */
function appendRows(name, headers, rows) {
  if (rows.length === 0) return;
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = tab(name, headers);
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
  } finally {
    lock.releaseLock();
  }
}

/**
 * Gets a tab by name, creating it with headers if it's missing.
 * @param {string} name - The tab name.
 * @param {string[]} [headers] - Headers for a new tab.
 * @returns {GoogleAppsScript.Spreadsheet.Sheet} The tab.
 */
function tab(name, headers) {
  const book = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = book.getSheetByName(name);
  if (!sheet) {
    sheet = book.insertSheet(name);
    if (headers) {
      sheet.appendRow(headers);
      sheet.setFrozenRows(1);
    }
  }
  return sheet;
}

/**
 * Wraps a value as a JSON response.
 * @param {*} value - What to send.
 * @returns {GoogleAppsScript.Content.TextOutput} The response.
 */
function json(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}
