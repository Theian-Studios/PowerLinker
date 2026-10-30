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
 * since this file is public on GitHub. A standalone script also needs SHEET_ID there: the ID from
 * the Sheet's address. A script made from the Sheet's Extensions menu finds its Sheet without it.
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
  const id = PropertiesService.getScriptProperties().getProperty("SHEET_ID");
  const book = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
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
  for (const row of rowsAsObjects(tab("RawPairs"))) (pairsByid[row.id] = pairsByid[row.id] || []).push(row);
  const pairs = Object.values(pairsByid)
    .filter((rows) => rows.length === 2)
    .map((rows) => rows.sort((a, b) => String(a.year).localeCompare(String(b.year))))
    .sort((a, b) => Number(a[0].id) - Number(b[0].id));

  const family = {};
  for (const row of rowsAsObjects(tab("RawFamily"))) (family[row.focus_pid] = family[row.focus_pid] || []).push(row);

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
  Logger.log(`${pairs.length} pairs: ${hints.length} hints, ${checks.length} checks`);
}

/**
 * Adds Joe's second batch, imported into a tab named RawPairs2, after the hints already there.
 */
function addBatch2() {
  addBatch("RawPairs2", "b2", DIFFERENT_CHECKS);
}

/**
 * Appends a batch of pairs to the Hints and Checks tabs, leaving the rows already there in place so
 * people part way through keep their place. Pairs already added are skipped, so it's safe to run again.
 * @param {string} rawTab - The tab holding the batch's pairs file.
 * @param {string} prefix - Starts each hint ID, like "b2", so batches don't collide.
 * @param {number} differentCount - How many different-person check hints to make from the batch.
 */
function addBatch(rawTab, prefix, differentCount) {
  const pairsByid = {};
  for (const row of rowsAsObjects(tab(rawTab))) (pairsByid[row.id] = pairsByid[row.id] || []).push(row);
  const pairs = Object.values(pairsByid)
    .filter((rows) => rows.length === 2)
    .map((rows) => rows.sort((a, b) => String(a.year).localeCompare(String(b.year))))
    .sort((a, b) => Number(a[0].id) - Number(b[0].id));

  const family = {};
  for (const row of rowsAsObjects(tab("RawFamily"))) (family[row.focus_pid] = family[row.focus_pid] || []).push(row);

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
    const others = (bySurname[`${earlier.surname.toLowerCase()}|${earlier.gender}`] || []).filter((row) => row.pid !== later.pid);
    if (others.length) result.push([earlier, others[Math.floor(random() * others.length)]]);
    if (result.length === count) break;
  }
  return result;
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
