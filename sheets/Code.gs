/**
 * PowerLinker backend on a Google Sheet. Paste this into the Sheet's Extensions → Apps Script and
 * deploy it as a web app (Execute as: Me, Who has access: Anyone). See sheets/README.md.
 *
 * Tabs:
 *   Hints   hint_id | hint (JSON)             pairs to vote on; each volunteer starts at a random row and
 *                                             goes on from there, wrapping back to the top at the end
 *   Checks  hint_id | expected | hint (JSON)  check hints with known answers (1 same, -1 different)
 *   Votes   one row per answer, added by this script, with the name the volunteer gave
 *   Voters  one row per person who entered the VIP code
 *   Sessions  sessions ended after three missed check hints, with the voter and their name
 *
 * Hints and check hints are kept in the script's cache, 20 rows at a time, so most requests don't open the
 * Sheet at all; that, and not the script itself, is most of a request's time. Run installKeepWarm once from the
 * editor to add a timer that keeps the script and its cache from going cold between volunteers.
 *
 * The VIP code lives in Project Settings → Script properties as VIP_CODE, never in this file,
 * since this file is public on GitHub. A standalone script also needs SHEET_ID there: the ID from
 * the Sheet's address. A script made from the Sheet's Extensions menu finds its Sheet without it.
 */

const VOTE_HEADERS = ["time", "voter", "session", "hint_id", "check", "expected", "correct", "vote", "answer", "seconds", "vip", "person_1", "person_2", "vote_id", "answered_at", "unsure_reason", "name"];
// How long a vote's ID is remembered so a resent copy isn't recorded twice (Apps Script's cache maximum)
const SEEN_VOTE_SECONDS = 21600;
const ANSWERS = { "1": "same", "-1": "different", "0": "not sure" };
// Why a volunteer chose "Not sure"; anything else the app sends is left blank
const UNSURE_REASONS = { not_enough_info: "not enough info", facts_disagree: "facts disagree", other: "other" };
const MAX_NAME_LENGTH = 80;
// Rows added at a time when a tab fills up
const ROWS_TO_ADD = 5000;
const MAX_COUNT = 25;
// Rows kept together in the cache: 20 hints are about 50 KB, under the cache's 100 KB a value
const CACHE_ROWS = 20;
// How long cached rows are kept (Apps Script's cache maximum); rebuilding the hints starts a new set
const CACHE_SECONDS = 21600;

/**
 * Answers GET requests: a page of hints, or one random check hint.
 * @param {GoogleAppsScript.Events.DoGet} e - The request.
 * @returns {GoogleAppsScript.Content.TextOutput} JSON.
 */
function doGet(e) {
  const params = e.parameter || {};
  if (params.dummy === "true") return json(checkHint());
  // A new volunteer starts at a random row, so answers spread across all the hints
  const after = params.start === "random" ? randomPosition() : Math.max(0, Number(params.last_insert_time) || 0);
  const count = Math.min(MAX_COUNT, Math.max(1, Number(params.count) || 10));
  const hints = hintsAfter(after, count);
  // The app asks for the check hint in the same request, so a visit starts the script once, not twice
  return json(params.with_check === "true" ? { hints, check: checkHint() } : hints);
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
      appendRows("Sessions", ["time", "session", "voter", "name"],
        [[new Date(), String(body.sid || ""), String(body.voter || "").slice(0, 64), plainText(body.name, MAX_NAME_LENGTH)]]);
      return json({ ok: true });
    default:
      return json({ error: "Unknown action" });
  }
}

/**
 * Picks a random position among the hints, for a volunteer's first page. It's at most the number of hints,
 * so adding a batch later doesn't move anyone: positions up to the old last row still point to the same rows.
 * @returns {number} A position from 0 to the number of hints minus 1.
 */
function randomPosition() {
  const total = rowCount("Hints");
  return total > 0 ? Math.floor(Math.random() * total) : 0;
}

/**
 * Gets the hints after a position, in the app's hint format. Positions wrap around the Hints tab, so
 * each volunteer can start at a random position and keep going past the last row back to the first:
 * position 1 is row 2, and with 100 hints, position 101 is row 2 again.
 * @param {number} after - The position of the last hint the app already has.
 * @param {number} count - How many to return.
 * @returns {Object[]} The hints, each with its position as "insert-time".
 */
function hintsAfter(after, count) {
  const total = rowCount("Hints");
  if (total < 1) return [];
  const wanted = Math.min(count, total);
  const rows = cachedRows("Hints", 2, total, Array.from({ length: wanted }, (_, i) => (after + i) % total));
  return rows.map(([id, data], i) => ({
    ...JSON.parse(data),
    hint_id: String(id),
    "insert-time": after + i + 1,
  }));
}

/**
 * Counts a tab's rows below its header, through the cache.
 * @param {string} name - "Hints" or "Checks".
 * @returns {number} The number of rows.
 */
function rowCount(name) {
  const cache = CacheService.getScriptCache();
  const key = `${cachePrefix()}:${name}:count`;
  const hit = cache.get(key);
  if (hit !== null) return Number(hit);
  const total = Math.max(0, tab(name).getLastRow() - 1);
  cache.put(key, String(total), CACHE_SECONDS);
  return total;
}

/**
 * Reads rows of a tab through the cache, CACHE_ROWS rows at a time, opening the Sheet only for rows that
 * aren't cached yet.
 * @param {string} name - "Hints" or "Checks".
 * @param {number} width - How many columns each row has.
 * @param {number} total - The tab's row count.
 * @param {number[]} indexes - The rows wanted, 0 for the first row under the header.
 * @returns {Array[]} The rows, in the order asked for.
 */
function cachedRows(name, width, total, indexes) {
  const cache = CacheService.getScriptCache();
  const prefix = `${cachePrefix()}:${name}`;
  const groups = [...new Set(indexes.map((i) => Math.floor(i / CACHE_ROWS)))];
  const hits = cache.getAll(groups.map((g) => `${prefix}:${g}`));
  const rowsByGroup = {};
  const fresh = {};
  for (const group of groups) {
    const key = `${prefix}:${group}`;
    if (hits[key]) {
      rowsByGroup[group] = JSON.parse(hits[key]);
      continue;
    }
    const first = group * CACHE_ROWS;
    rowsByGroup[group] = tab(name).getRange(first + 2, 1, Math.min(CACHE_ROWS, total - first), width).getValues()
      .map((row) => row.map((value) => (typeof value === "number" ? value : String(value))));
    const text = JSON.stringify(rowsByGroup[group]);
    // A group of unusually large hints is read from the Sheet each time rather than not at all
    if (text.length < 90000) fresh[key] = text;
  }
  if (Object.keys(fresh).length) cache.putAll(fresh, CACHE_SECONDS);
  return indexes.map((i) => rowsByGroup[Math.floor(i / CACHE_ROWS)][i % CACHE_ROWS]);
}

/**
 * Starts the cache keys for the current hints, so rebuilding or adding hints uses new keys.
 * @returns {string} The prefix.
 */
function cachePrefix() {
  return `rows:${cachedProperty("HINTS_VERSION") || "0"}`;
}

/**
 * Moves the cache on to new keys after the Hints or Checks tab changes.
 */
function clearHintCache() {
  PropertiesService.getScriptProperties().setProperty("HINTS_VERSION", String(Date.now()));
  CacheService.getScriptCache().remove("prop:HINTS_VERSION");
}

/**
 * Keeps the script and its cache warm: reads a page of hints and a check hint, as a volunteer's first visit
 * would. installKeepWarm runs it every 5 minutes.
 */
function keepWarm() {
  hintsAfter(randomPosition(), MAX_COUNT);
  checkHint();
}

/**
 * Adds the timer that runs keepWarm every 5 minutes, replacing any from before. Run it once from the editor;
 * it asks for permission to manage the script's triggers.
 */
function installKeepWarm() {
  ScriptApp.getProjectTriggers().filter((t) => t.getHandlerFunction() === "keepWarm").forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("keepWarm").timeBased().everyMinutes(5).create();
}

/**
 * Picks a random check hint and includes its answer, as the app grades it.
 * @returns {Object} The check hint.
 */
function checkHint() {
  const rows = rowCount("Checks");
  if (rows < 1) return {};
  const [[id, expected, data]] = cachedRows("Checks", 3, rows, [Math.floor(Math.random() * rows)]);
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
  const vip = Boolean(voter) && cachedProperty(`vip:${voter}`) === "1";
  // The name the volunteer gave, so the lab knows who did which records
  const name = plainText(body.name, MAX_NAME_LENGTH);
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
      // "Not sure" on a check hint is neither right nor wrong, as in the app
      isCheck && vote !== 0 ? vote === item.expected : "",
      vote,
      ANSWERS[String(vote)] || "",
      typeof item.seconds === "number" ? Math.round(item.seconds) : "",
      vip,
      String((item.hint && item.hint.id1) || ""),
      String((item.hint && item.hint.id2) || ""),
      String(item.vote_id || "").slice(0, 64),
      // When the volunteer answered; "time" is when the Sheet received it, which can be later after a retry
      answeredAt(item.answered_at),
      vote === 0 ? UNSURE_REASONS[String(item.unsure_reason)] || "" : "",
      name,
    ];
  });
  // The app may send an answer again when it didn't hear back in time; each answer's ID is recorded once
  return withLock(() => {
    const cache = CacheService.getScriptCache();
    const keys = rows.map((row) => row[13]).filter(Boolean).map((id) => `vote:${id}`);
    const seen = keys.length ? cache.getAll(keys) : {};
    const fresh = rows.filter((row) => !row[13] || !seen[`vote:${row[13]}`]);
    writeRows("Votes", VOTE_HEADERS, fresh);
    const remember = {};
    fresh.forEach((row) => { if (row[13]) remember[`vote:${row[13]}`] = "1"; });
    if (Object.keys(remember).length) cache.putAll(remember, SEEN_VOTE_SECONDS);
    return { added: fresh.length, skipped: rows.length - fresh.length };
  });
}

/**
 * Makes text a volunteer typed safe to write: trimmed, capped, and never read as a formula.
 * @param {*} value - The text from the app.
 * @param {number} maxLength - The most characters kept.
 * @returns {string} Plain text, or blank.
 */
function plainText(value, maxLength) {
  const text = typeof value === "string" ? value.trim().slice(0, maxLength) : "";
  // The Sheet treats text starting with these as a formula or number; a leading ' keeps it as text
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}

/**
 * Reads the time the app says an answer was given.
 * @param {*} value - An ISO date string from the app.
 * @returns {Date|string} The time, or blank when it's missing or not a date.
 */
function answeredAt(value) {
  const date = typeof value === "string" ? new Date(value.slice(0, 40)) : null;
  return date && !isNaN(date.getTime()) ? date : "";
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
  CacheService.getScriptCache().put(`prop:vip:${voter}`, "1", SEEN_VOTE_SECONDS);
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
  withLock(() => writeRows(name, headers, rows));
}

/**
 * Adds rows after a tab's last row. Call it while holding the script lock.
 * @param {string} name - The tab name.
 * @param {string[]} headers - Its column headers, for a new tab.
 * @param {Array[]} rows - The rows to add.
 */
function writeRows(name, headers, rows) {
  if (rows.length === 0) return;
  const sheet = tab(name, headers);
  const width = rows[0].length;
  // A tab made before a column was added is too narrow, and its header row is missing the new names
  if (sheet.getMaxColumns() < width) sheet.insertColumnsAfter(sheet.getMaxColumns(), width - sheet.getMaxColumns());
  if (headers && sheet.getLastColumn() < headers.length) sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  // getRange can't reach past the tab's last row, so a full tab gets more rows first
  const first = sheet.getLastRow() + 1;
  const missing = first + rows.length - 1 - sheet.getMaxRows();
  if (missing > 0) sheet.insertRowsAfter(sheet.getMaxRows(), missing + ROWS_TO_ADD);
  sheet.getRange(first, 1, rows.length, width).setValues(rows);
}

/**
 * Runs a function while holding the script lock, so two requests can't write over each other.
 * @param {Function} fn - What to run.
 * @returns {*} What it returns.
 */
function withLock(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const result = fn();
    // Write buffered changes before letting the next request in, or it can read a stale last row and
    // write over this one
    SpreadsheetApp.flush();
    return result;
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
  const book = spreadsheet();
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

let openedSpreadsheet = null;

/**
 * Opens the results Sheet once per request: by SHEET_ID for a standalone script, or the Sheet the
 * script is attached to.
 * @returns {GoogleAppsScript.Spreadsheet.Spreadsheet} The Sheet.
 */
function spreadsheet() {
  if (!openedSpreadsheet) {
    const id = cachedProperty("SHEET_ID");
    openedSpreadsheet = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
  }
  return openedSpreadsheet;
}

/**
 * Reads a script property through the cache, since Apps Script limits property reads per day.
 * @param {string} key - The property name.
 * @returns {string|null} Its value, or null when it isn't set.
 */
function cachedProperty(key) {
  const cache = CacheService.getScriptCache();
  const hit = cache.get(`prop:${key}`);
  if (hit !== null) return hit === NOT_SET ? null : hit;
  const value = PropertiesService.getScriptProperties().getProperty(key);
  cache.put(`prop:${key}`, value === null ? NOT_SET : value, SEEN_VOTE_SECONDS);
  return value;
}

/** Stands for "no such property" in the cache, which can't store null. */
const NOT_SET = "\u0000";

// ---- Building the Hints and Checks tabs from Joe Price's files ----
//
// Import the pairs file into a tab named RawPairs and the family file into RawFamily (File → Import,
// "Insert new sheet", with "Convert text to numbers, dates, and formulas" turned off, so "+1919-08-26"
// stays a date and isn't read as a formula). Then run buildHints from the Apps Script editor.
// It does the same as sheets/export_hints.py.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DIFFERENT_CHECKS = 150;

/**
 * Rebuilds the Hints and Checks tabs from the RawPairs and RawFamily tabs.
 */
function buildHints() {
  const pairsByid = {};
  for (const row of inputRows("RawPairs")) (pairsByid[row.id] = pairsByid[row.id] || []).push(row);
  const pairs = Object.values(pairsByid)
    .filter((rows) => rows.length === 2)
    .map((rows) => rows.sort((a, b) => String(a.year).localeCompare(String(b.year))))
    .sort((a, b) => Number(a[0].id) - Number(b[0].id));

  const family = {};
  for (const row of inputRows("RawFamily")) (family[row.focus_pid] = family[row.focus_pid] || []).push(row);

  const random = seededRandom(1930);
  const hints = [];
  const checks = [];
  for (const [earlier, later] of pairs) {
    const data = JSON.stringify(pairHint(earlier, later, family));
    if (String(earlier.automate) === "1") checks.push([`b1-${earlier.id}`, 1, data]);
    else hints.push([`b1-${earlier.id}`, data]);
  }
  shuffle(hints, random);
  differentPeople(pairs, DIFFERENT_CHECKS, random).forEach(([earlier, later], i) => {
    checks.push([`b1-diff-${i + 1}`, -1, JSON.stringify(pairHint(earlier, later, family))]);
  });

  writeTab("Hints", ["hint_id", "hint"], hints);
  writeTab("Checks", ["hint_id", "expected", "hint"], checks);
  clearHintCache();
  Logger.log(`${pairs.length} pairs: ${hints.length} hints, ${checks.length} checks`);
}

/**
 * Adds Joe's second batch, imported into a tab named RawPairs2, after the hints already there.
 */
function addBatch2() {
  addBatch("RawPairs2", "b2", DIFFERENT_CHECKS, "RawFamily");
}

/**
 * Appends a batch of pairs to the Hints and Checks tabs, leaving the rows already there in place so
 * people part way through keep their place. Pairs already added are skipped, so it's safe to run again.
 * @param {string} rawTab - The tab holding the batch's pairs file.
 * @param {string} prefix - Starts each hint ID, like "b2", so batches don't collide.
 * @param {number} differentCount - How many different-person check hints to make from the batch.
 * @param {string} [familyTab] - The tab holding the batch's family file, if there is one; Joe's family files
 *   can share one tab, since rows are looked up by person.
 */
function addBatch(rawTab, prefix, differentCount, familyTab) {
  const pairsByid = {};
  for (const row of inputRows(rawTab)) (pairsByid[row.id] = pairsByid[row.id] || []).push(row);
  const pairs = Object.values(pairsByid)
    .filter((rows) => rows.length === 2)
    .map((rows) => rows.sort((a, b) => String(a.year).localeCompare(String(b.year))))
    .sort((a, b) => Number(a[0].id) - Number(b[0].id));

  const family = {};
  const familyRows = familyTab && spreadsheet().getSheetByName(familyTab) ? inputRows(familyTab) : [];
  for (const row of familyRows) (family[row.focus_pid] = family[row.focus_pid] || []).push(row);

  const existing = new Set([...existingIds("Hints"), ...existingIds("Checks")]);
  const random = seededRandom(1940);
  const hints = [];
  const checks = [];
  for (const [earlier, later] of pairs) {
    const id = `${prefix}-${earlier.id}`;
    if (existing.has(id)) continue;
    const data = JSON.stringify(pairHint(earlier, later, family));
    if (String(earlier.automate) === "1") checks.push([id, 1, data]);
    else hints.push([id, data]);
  }
  shuffle(hints, random);
  differentPeople(pairs, differentCount, random).forEach(([earlier, later], i) => {
    const id = `${prefix}-diff-${i + 1}`;
    if (!existing.has(id)) checks.push([id, -1, JSON.stringify(pairHint(earlier, later, family))]);
  });

  appendInChunks("Hints", hints);
  appendInChunks("Checks", checks);
  clearHintCache();
  Logger.log(`${pairs.length} pairs in ${rawTab}: added ${hints.length} hints and ${checks.length} checks`);
}

/**
 * Gets the hint IDs already in a tab.
 * @param {string} name - The tab name.
 * @returns {string[]} The IDs in its first column.
 */
function existingIds(name) {
  const sheet = tab(name);
  const rows = sheet.getLastRow() - 1;
  return rows < 1 ? [] : sheet.getRange(2, 1, rows, 1).getValues().map(([id]) => String(id));
}

/**
 * Adds rows after a tab's last row, a few thousand at a time so big batches don't stall.
 * @param {string} name - The tab name.
 * @param {Array[]} rows - The rows to add.
 */
function appendInChunks(name, rows) {
  const sheet = tab(name);
  for (let start = 0; start < rows.length; start += 3000) {
    const chunk = rows.slice(start, start + 3000);
    sheet.getRange(sheet.getLastRow() + 1, 1, chunk.length, chunk[0].length).setValues(chunk);
  }
}

/**
 * Reads an imported file's tab, which must exist and have data: running a build against a missing or
 * misnamed tab would otherwise create it empty and wipe the hints.
 * @param {string} name - The tab name.
 * @returns {Object[]} One object per row.
 */
function inputRows(name) {
  const sheet = spreadsheet().getSheetByName(name);
  if (!sheet || sheet.getLastRow() < 2) throw new Error(`No data in a tab named ${name}. Import the file into it first.`);
  return rowsAsObjects(sheet);
}

/**
 * Reads a tab as objects keyed by its header row, with every value as text.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet - The tab.
 * @returns {Object[]} One object per row.
 */
function rowsAsObjects(sheet) {
  const [headers, ...rows] = sheet.getDataRange().getDisplayValues();
  return rows.map((row) => Object.fromEntries(headers.map((header, i) => [header, row[i]])));
}

/**
 * Replaces a tab's contents with a header row and rows.
 * @param {string} name - The tab name.
 * @param {string[]} headers - Its column headers.
 * @param {Array[]} rows - The rows.
 */
function writeTab(name, headers, rows) {
  if (rows.length === 0) throw new Error(`Nothing to write to ${name}; it was left as it was.`);
  const sheet = tab(name, headers);
  sheet.clearContents();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  if (rows.length) sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
}

/**
 * Turns a CSV date into one the app reads: "+1919-08-26" to "26 Aug 1919", "A+1912" to "abt 1912",
 * and the ranges "+1883/+1891", "+1930/" and "/+1950" to "1883-1891", "after 1930" and "before 1950".
 * @param {string} value - The date from the CSV.
 * @returns {string|null} The date, or null when there is none.
 */
function readableDate(value) {
  if (!value) return null;
  if (value.includes("/")) {
    const at = value.indexOf("/");
    const first = plainDate(value.slice(0, at).replace(/^A+/, ""));
    const last = plainDate(value.slice(at + 1));
    if (first && last) {
      const years = [first.split(" ").pop(), last.split(" ").pop()];
      return years[0] === years[1] ? years[0] : years.join("-");
    }
    if (first) return `after ${first}`;
    return last ? `before ${last}` : null;
  }
  const date = plainDate(value.replace(/^A+/, ""));
  return date && value.startsWith("A") ? `abt ${date}` : date;
}

/**
 * Turns "+1919-08-26", "+1959-05" or "+1919" into "26 Aug 1919", "May 1959" or "1919".
 * @param {string} value - One date, without "A" or a range.
 * @returns {string|null} The date, or null when there is none.
 */
function plainDate(value) {
  const parts = value ? value.replace(/^\+/, "").split("-") : [];
  if (!parts.length || !parts[0]) return null;
  const month = parts[1] ? MONTHS[Number(parts[1]) - 1] : null;
  const day = parts[2] ? String(Number(parts[2])) : null;
  return [day, month, parts[0]].filter(Boolean).join(" ");
}

/**
 * Builds a person's birth, census residence and death events.
 * @param {Object} row - The person's row.
 * @param {string} [year] - The census year, for the main person only.
 * @param {string} [place] - Where the census found them.
 * @returns {Object[]} The events that have a date or a place.
 */
function personEvents(row, year, place) {
  return [
    ["birth", readableDate(row.birth_date), row.birth_place],
    ["residence", year, place],
    ["death", readableDate(row.death_date), row.death_place],
  ]
    .map(([name, date, where]) => ({ name, ...(date ? { date } : {}), ...(where ? { place: where } : {}) }))
    .filter((event) => Object.keys(event).length > 1);
}

/**
 * Builds a possible-duplicate hint for two people, the 1930 one first, with their families.
 * @param {Object} first - The 1930 person's row.
 * @param {Object} second - The 1940 person's row.
 * @param {Object} family - Family rows by main person.
 * @returns {Object} The hint in the app's format.
 */
function pairHint(first, second, family) {
  const main = (row, other) => ({
    firstName: row.given_name, lastName: row.surname, sex: row.gender, relationship: "self", pid: row.pid,
    events: personEvents(row, row.year, row.event_place), ...(other ? { matchpid: other } : {}),
  });
  const secondFamily = new Set((family[second.pid] || []).map((row) => row.pid));
  const relatives = (pid, shared) => (family[pid] || [])
    .filter((row) => row.rel_type_to_focus_person !== "self")
    .map((row) => ({
      firstName: row.given_name, lastName: row.surname, sex: row.gender, relationship: row.rel_type_to_focus_person,
      pid: row.pid, events: personEvents(row), ...(shared && shared.has(row.pid) ? { matchpid: row.pid } : {}),
    }));
  return {
    hintType: "possible_duplicate",
    origin: "Census Tree duplicates",
    url: `https://www.familysearch.org/tree/person/details/${first.pid}`,
    recordInfo: { ark: first.pid, persons: [main(first, second.pid), ...relatives(first.pid, secondFamily)] },
    treeInfo: { persons: [main(second), ...relatives(second.pid)] },
  };
}

/**
 * Picks people from different pairs who look alike at a glance: same surname and sex.
 * @param {Array[]} pairs - The pairs, 1930 person first.
 * @param {number} count - How many to pick.
 * @param {Function} random - A seeded random number source.
 * @returns {Array[]} Pairs of a 1930 person and a different 1940 person.
 */
function differentPeople(pairs, count, random) {
  const bySurname = {};
  for (const [, later] of pairs) {
    if (!later.surname) continue;
    const key = `${later.surname.toLowerCase()}|${later.gender}`;
    (bySurname[key] = bySurname[key] || []).push(later);
  }
  const result = [];
  for (const [earlier, later] of shuffle(pairs.slice(), random)) {
    const others = (bySurname[`${earlier.surname.toLowerCase()}|${earlier.gender}`] || [])
      .filter((row) => row.pid !== later.pid && !couldBeSamePerson(earlier, row));
    if (others.length) result.push([earlier, others[Math.floor(random() * others.length)]]);
    if (result.length === count) break;
  }
  return result;
}

/** First names that can stand for anyone, so they can't show two people are different. */
const PLACEHOLDER_FIRST_NAMES = new Set(["junior", "jr", "sonny", "sonnie", "bud", "buddy", "baby", "infant", "son", "daughter", "sister", "brother", "mrs", "miss", "mr"]);

/**
 * Checks whether two people from different pairs might still be the same person, so they're not used as a
 * "different people" check: first names that are the same, one letter apart (Ida and Ada) or a stand-in
 * like "Junior", with no birth years 5 or more apart and no different birthplaces to tell them apart.
 * @param {Object} a - One person's row.
 * @param {Object} b - The other's.
 * @returns {boolean} True when nothing shown would tell them apart.
 */
function couldBeSamePerson(a, b) {
  const first = (row) => String(row.given_name || "").trim().toLowerCase().replace(/[.,]/g, "").split(/\s+/)[0];
  const fa = first(a), fb = first(b);
  const similar = !fa || !fb || PLACEHOLDER_FIRST_NAMES.has(fa) || PLACEHOLDER_FIRST_NAMES.has(fb) || oneEditApart(fa, fb);
  if (!similar) return false;
  const yearOf = (row) => Number((String(row.birth_date || "").match(/\d{4}/) || [])[0]) || null;
  const placeOf = (row) => String(row.birth_place || "").split(",").map((part) => part.trim().toLowerCase()).filter(Boolean).slice(-2).join(",");
  const yearsApart = yearOf(a) && yearOf(b) ? Math.abs(yearOf(a) - yearOf(b)) >= 5 : false;
  const placesDiffer = placeOf(a) && placeOf(b) ? placeOf(a) !== placeOf(b) : false;
  return !yearsApart && !placesDiffer;
}

/**
 * Checks whether two words are equal or one letter added, dropped or changed apart.
 * @param {string} a - One word.
 * @param {string} b - The other.
 * @returns {boolean} True for "ida" and "ada", or "jon" and "john".
 */
function oneEditApart(a, b) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1);
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}

/**
 * Shuffles a list in place.
 * @param {Array} list - The list.
 * @param {Function} random - A seeded random number source.
 * @returns {Array} The same list.
 */
function shuffle(list, random) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

/**
 * Makes a repeatable random number source, so rebuilding gives the same order.
 * @param {number} seed - The starting value.
 * @returns {Function} A function returning numbers from 0 to 1.
 */
function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Wraps a value as a JSON response.
 * @param {*} value - What to send.
 * @returns {GoogleAppsScript.Content.TextOutput} The response.
 */
function json(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}
