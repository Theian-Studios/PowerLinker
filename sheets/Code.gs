/**
 * PowerLinker backend on a Google Sheet. Paste this into the Sheet's Extensions → Apps Script and
 * deploy it as a web app (Execute as: Me, Who has access: Anyone). See sheets/README.md.
 *
 * Tabs:
 *   Hints   hint_id | hint (JSON)             pairs to vote on, handed out in order from one shared position:
 *                                             each batch's hints PASSES_PER_BATCH times, batch 1 first
 *   Checks  hint_id | expected | hint (JSON)  check hints with known answers (1 same, -1 different)
 *   Attachments, AttachChecks                 the same for record hints (a record and a tree person), for
 *                                             volunteers who choose records in the app; handed out from their own
 *                                             shared position
 *   ChileHints, ChileChecks                   the same for the Chilean site's possible duplicates (region=cl)
 *   Votes   one row per answer, added by this script, with the name the volunteer gave
 *   Voters  one row per person who entered the VIP code
 *   Sessions  sessions ended after three missed check hints, with the voter and their name
 *
 * Hints and check hints are kept in the script's cache, 10 rows at a time, so most requests don't open the
 * Sheet at all; that, and not the script itself, is most of a request's time. Run installTimers once from the
 * editor to add a timer that keeps the script and its cache from going cold between volunteers, and one that
 * removes answers saved twice once a day.
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
// Rows kept together in the cache: 10 hints are about 35 KB stored, safely under the cache's 100 KB a value
// even for big families (some 20-hint groups went over)
const CACHE_ROWS = 10;
// How long cached rows are kept (Apps Script's cache maximum); rebuilding the hints starts a new set
const CACHE_SECONDS = 21600;
// Every request for hints gets the next ones from one shared position, so each hint is handed out once before
// any is handed out again. Batch 1's hints go round this many times before batch 2's start, then batch 2's, and
// once every batch has had its turns, all the hints go round together.
const PASSES_PER_BATCH = 3;
// The two kinds of hint a volunteer can choose, each with its own tabs and its own shared position. The position is
// kept in the cache for speed, and copied to the script properties by keepWarm, since the cache can drop it.
const KINDS = {
  possible_duplicate: { hints: "Hints", checks: "Checks", next: "NEXT_HINT" },
  record_attachment: { hints: "Attachments", checks: "AttachChecks", next: "NEXT_ATTACH" },
};
// The Chilean site's hints, asked for with region=cl: possible duplicates on Chile's part of the tree
const CHILE = { hints: "ChileHints", checks: "ChileChecks", next: "NEXT_CHILE" };
const ALL_KINDS = [...Object.values(KINDS), CHILE];
const DUPLICATES = KINDS.possible_duplicate;
// Hints are numbered from here up as they're handed out, above any number the app saved before there was a
// shared position, so a returning volunteer's app always sees the new numbers as later
const FIRST_NUMBER = 1000000;
// Hints keepWarm reads ahead of the shared position, so pages come from the cache: three times what was handed out
// in the last 5 minutes, within these bounds
const MIN_AHEAD = 600;
const MAX_AHEAD = 3000;
// How long a save waits for another to finish before answering "busy". The app keeps its answers and sends them
// again a little later, which is better than holding the request: Google runs only so many requests at once, and
// requests waiting here would leave none for loading hints.
const SAVE_WAIT_MS = 5000;
const BUSY = "busy";
// How long the daily cleanup waits for saves to finish before taking its turn
const CLEANUP_WAIT_MS = 60000;

/**
 * Answers GET requests: a page of hints, or one random check hint.
 * @param {GoogleAppsScript.Events.DoGet} e - The request.
 * @returns {GoogleAppsScript.Content.TextOutput} JSON.
 */
function doGet(e) {
  const params = e.parameter || {};
  const kind = params.region === "cl" ? CHILE
    : Object.prototype.hasOwnProperty.call(KINDS, params.record_type) ? KINDS[params.record_type] : DUPLICATES;
  if (params.dummy === "true") return json(checkHint(kind));
  const count = Math.min(MAX_COUNT, Math.max(1, Number(params.count) || 10));
  // Every page is the next hints from the shared position, whatever the app says it last had (last_insert_time and
  // start=random are from before, and ignored), so no hint gets a second answer before every hint has a first
  const hints = handOut(count, kind);
  // The app asks for the check hint in the same request, so a visit starts the script once, not twice
  return json(params.with_check === "true" ? { hints, check: checkHint(kind) } : hints);
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
  try {
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
  } catch (error) {
    if (error.message === BUSY) return json({ error: BUSY });
    throw error;
  }
}

/**
 * Hands out the next hints of one kind from its shared position and moves it on past them.
 * @param {number} count - How many to hand out.
 * @param {Object} [kind] - Which kind, from KINDS.
 * @returns {Object[]} The hints, in the app's format, each numbered as "insert-time".
 */
function handOut(count, kind = DUPLICATES) {
  const total = rowCount(kind.hints);
  if (total < 1) return [];
  const cache = CacheService.getScriptCache();
  const start = readPosition(cache, kind);
  const { rows, position } = walk(start, count, hintBatches(total, kind.hints), total);
  // Moved on before the rows are read, so another request a moment later gets the hints after these. Two requests
  // within a few milliseconds of each other can still get the same page; their hints then get an answer early.
  cache.put(kind.next, JSON.stringify(position), CACHE_SECONDS);
  return cachedRows(kind.hints, 2, total, rows).map(([id, data], i) => ({
    ...JSON.parse(data),
    hint_id: String(id),
    "insert-time": start.n + i + 1,
  }));
}

/**
 * Reads the shared position: the row to hand out next, how many times its batch has gone round, and how many hints
 * have been handed out (from FIRST_NUMBER).
 * @param {GoogleAppsScript.Cache.Cache} cache - The script cache.
 * @param {Object} [kind] - Which kind of hint, from KINDS.
 * @returns {{row: number, pass: number, n: number}} The position.
 */
function readPosition(cache, kind = DUPLICATES) {
  const saved = cache.get(kind.next) || PropertiesService.getScriptProperties().getProperty(kind.next);
  return saved ? JSON.parse(saved) : { row: 0, pass: 0, n: FIRST_NUMBER };
}

/**
 * Lists the hints to hand out from a position on, and where the position ends up.
 * @param {{row: number, pass: number, n: number}} position - Where to start.
 * @param {number} count - How many hints.
 * @param {Object[]} batches - The batches, from hintBatches.
 * @param {number} total - The Hints tab's row count.
 * @returns {{rows: number[], position: Object}} The rows, 0 for the first under the header, and the next position.
 */
function walk(position, count, batches, total) {
  const wanted = Math.min(count, total);
  const rows = [];
  let { row, pass } = position;
  // A small batch going round again could repeat a hint within one page; the repeat is passed over
  for (let tries = 0; rows.length < wanted && tries < wanted + total; tries++) {
    if (!(row >= 0 && row < total)) row = 0;
    if (!rows.includes(row)) rows.push(row);
    ({ row, pass } = nextRow(row, pass, batches, total));
  }
  return { rows, position: { row, pass, n: position.n + rows.length } };
}

/**
 * Finds the row handed out after this one: the next in its batch; at the batch's end, the batch's first again until
 * it has gone round PASSES_PER_BATCH times, then the next batch; and after the last batch, round all the hints.
 * @param {number} row - A row, 0 for the first under the header.
 * @param {number} pass - How many times its batch has gone round before this time.
 * @param {Object[]} batches - The batches, from hintBatches.
 * @param {number} total - The Hints tab's row count.
 * @returns {{row: number, pass: number}} The next row and its pass.
 */
function nextRow(row, pass, batches, total) {
  if (pass >= PASSES_PER_BATCH) return { row: (row + 1) % total, pass };
  const batch = batches.find((b) => row >= b.start && row < b.end) || { start: 0, end: total };
  if (row + 1 < batch.end) return { row: row + 1, pass };
  if (pass + 1 < PASSES_PER_BATCH) return { row: batch.start, pass: pass + 1 };
  const next = batches.find((b) => b.start >= batch.end);
  return next ? { row: next.start, pass: 0 } : { row: 0, pass: PASSES_PER_BATCH };
}

/**
 * Finds the batches in a hints tab: runs of rows whose IDs start the same way ("b1-", "b2-"), in the order they
 * were added. Rows without a batch name in their ID are one batch.
 * @param {number} total - The tab's row count.
 * @param {string} [name] - The tab, "Hints" or "Attachments".
 * @returns {{name: string, start: number, end: number}[]} Each batch's first row and the row after its last.
 */
function hintBatches(total, name = "Hints") {
  const cache = CacheService.getScriptCache();
  const key = `${cachePrefix()}:batches:${name}:${total}`;
  const hit = cache.get(key);
  if (hit) return JSON.parse(hit);
  const batches = [];
  tab(name).getRange(2, 1, total, 1).getValues().forEach(([id], i) => {
    const batch = (String(id).match(/^([a-z]+\d*)-/i) || ["", ""])[1];
    const last = batches[batches.length - 1];
    if (last && last.name === batch) last.end = i + 1;
    else batches.push({ name: batch, start: i, end: i + 1 });
  });
  cache.put(key, JSON.stringify(batches), CACHE_SECONDS);
  return batches;
}

/**
 * Moves the shared position, keeping the hints' numbers going up so the app never sees an earlier one.
 * @param {number} row - The row to hand out next, 0 for the first under the header.
 * @param {number} pass - How many times its batch has gone round before (PASSES_PER_BATCH or more: all the hints
 *   go round together).
 * @param {Object} [kind] - Which kind of hint, from KINDS.
 */
function moveNextHint(row, pass, kind = DUPLICATES) {
  const cache = CacheService.getScriptCache();
  const position = JSON.stringify({ row, pass, n: readPosition(cache, kind).n });
  cache.put(kind.next, position, CACHE_SECONDS);
  PropertiesService.getScriptProperties().setProperty(kind.next, position);
}

/**
 * Moves the shared position to the row and pass typed into the NEXT_HINT script property: edit the property in
 * Project Settings, then run this from the editor straight away (keepWarm copies the cache's position over the
 * property every 5 minutes). For example {"row":2765,"pass":0} hands out row 2,767 of the Hints tab next.
 */
function useSavedNextHint() {
  const saved = JSON.parse(PropertiesService.getScriptProperties().getProperty(DUPLICATES.next) || "{}");
  moveNextHint(Math.max(0, Number(saved.row) || 0), Math.max(0, Number(saved.pass) || 0));
  logNextHint();
}

/**
 * Logs where each kind's shared position is: run it from the editor to see how far the volunteers have got.
 */
function logNextHint() {
  for (const kind of ALL_KINDS) {
    const total = rowCount(kind.hints);
    if (total < 1) continue;
    const position = readPosition(CacheService.getScriptCache(), kind);
    const batch = hintBatches(total, kind.hints).find((b) => position.row >= b.start && position.row < b.end) || { name: "?" };
    const turn = position.pass >= PASSES_PER_BATCH ? "all hints going round" : `turn ${position.pass + 1} of ${PASSES_PER_BATCH}`;
    Logger.log(`Next: row ${position.row + 2} of the ${kind.hints} tab (batch ${batch.name}, ${turn}); ${position.n - FIRST_NUMBER} hints handed out so far`);
  }
}

/**
 * Counts a tab's rows below its header, through the cache. A tab that isn't there yet has none.
 * @param {string} name - "Hints", "Checks", "Attachments" or "AttachChecks".
 * @returns {number} The number of rows.
 */
function rowCount(name) {
  const cache = CacheService.getScriptCache();
  const key = `${cachePrefix()}:${name}:count`;
  const hit = cache.get(key);
  if (hit !== null) return Number(hit);
  const sheet = spreadsheet().getSheetByName(name);
  const total = sheet ? Math.max(0, sheet.getLastRow() - 1) : 0;
  cache.put(key, String(total), CACHE_SECONDS);
  return total;
}

/**
 * Reads rows of a tab through the cache, CACHE_ROWS rows at a time, opening the Sheet only for rows that
 * aren't cached yet.
 * @param {string} name - The tab: "Hints", "Checks", "Attachments" or "AttachChecks".
 * @param {number} width - How many columns each row has.
 * @param {number} total - The tab's row count.
 * @param {number[]} indexes - The rows wanted, 0 for the first row under the header.
 * @returns {Array[]} The rows, in the order asked for.
 */
function cachedRows(name, width, total, indexes) {
  const groups = [...new Set(indexes.map((i) => Math.floor(i / CACHE_ROWS)))];
  const rowsByGroup = cachedGroups(name, groups);
  Object.assign(rowsByGroup, readGroups(name, width, total, groups.filter((group) => !rowsByGroup[group])));
  return indexes.map((i) => rowsByGroup[Math.floor(i / CACHE_ROWS)][i % CACHE_ROWS]);
}

/**
 * Gets the groups of rows that are in the cache.
 * @param {string} name - The tab: "Hints", "Checks", "Attachments" or "AttachChecks".
 * @param {number[]} groups - Group numbers: group 3 is rows 30 to 39 under the header.
 * @returns {Object} The rows of each group found, by group number.
 */
function cachedGroups(name, groups) {
  const cache = CacheService.getScriptCache();
  const prefix = `${cachePrefix()}:${name}`;
  const found = {};
  for (let i = 0; i < groups.length; i += 100) {
    const hits = cache.getAll(groups.slice(i, i + 100).map((group) => `${prefix}:${group}`));
    for (const group of groups.slice(i, i + 100)) {
      const hit = hits[`${prefix}:${group}`];
      if (hit) found[group] = JSON.parse(hit);
    }
  }
  return found;
}

/**
 * Reads groups of rows from the Sheet and caches them. Neighbouring groups are read together, which is much
 * quicker than one at a time.
 * @param {string} name - The tab: "Hints", "Checks", "Attachments" or "AttachChecks".
 * @param {number} width - How many columns each row has.
 * @param {number} total - The tab's row count.
 * @param {number[]} groups - Group numbers.
 * @returns {Object} The rows of each group, by group number.
 */
function readGroups(name, width, total, groups) {
  const sorted = [...groups].sort((a, b) => a - b);
  const read = {};
  for (let i = 0; i < sorted.length;) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1 && j - i < 49) j++;
    const first = sorted[i] * CACHE_ROWS;
    const values = tab(name).getRange(first + 2, 1, Math.min(total, (sorted[j] + 1) * CACHE_ROWS) - first, width).getValues()
      .map((row) => row.map((value) => (typeof value === "number" ? value : String(value))));
    const fresh = {};
    for (let group = sorted[i]; group <= sorted[j]; group++) {
      read[group] = values.slice(group * CACHE_ROWS - first, (group + 1) * CACHE_ROWS - first);
      const text = JSON.stringify(read[group]);
      // A group of unusually large hints is read from the Sheet each time rather than not at all
      if (text.length < 90000) fresh[`${cachePrefix()}:${name}:${group}`] = text;
    }
    if (Object.keys(fresh).length) CacheService.getScriptCache().putAll(fresh, CACHE_SECONDS);
    i = j + 1;
  }
  return read;
}

/**
 * Starts the cache keys for the current hints, so rebuilding or adding hints uses new keys. The group size is
 * in it too, so groups cached at another size are never read as this one.
 * @returns {string} The prefix.
 */
function cachePrefix() {
  return `rows:${cachedProperty("HINTS_VERSION") || "0"}:${CACHE_ROWS}`;
}

/**
 * Moves the cache on to new keys after the Hints or Checks tab changes.
 */
function clearHintCache() {
  PropertiesService.getScriptProperties().setProperty("HINTS_VERSION", String(Date.now()));
  CacheService.getScriptCache().remove("prop:HINTS_VERSION");
}

/**
 * Keeps the script and its cache warm: reads the hints coming up after the shared position, so pages come from the
 * cache, and a check hint. It also copies the shared position to the script properties, where it's safe if the
 * cache drops it. installTimers runs it every 5 minutes.
 */
function keepWarm() {
  for (const kind of ALL_KINDS) {
    const total = rowCount(kind.hints);
    if (total < 1) continue;
    const cache = CacheService.getScriptCache();
    const position = readPosition(cache, kind);
    const properties = PropertiesService.getScriptProperties();
    if (properties.getProperty(kind.next) !== JSON.stringify(position)) properties.setProperty(kind.next, JSON.stringify(position));
    // Far enough ahead for three times the last 5 minutes' pace
    const paceKey = `warm:${kind.next}`;
    const last = Number(cache.get(paceKey)) || position.n;
    cache.put(paceKey, String(position.n), CACHE_SECONDS);
    const ahead = Math.min(MAX_AHEAD, Math.max(MIN_AHEAD, 3 * (position.n - last)));
    const { rows } = walk(position, ahead, hintBatches(total, kind.hints), total);
    const groups = [...new Set(rows.map((i) => Math.floor(i / CACHE_ROWS)))];
    const cached = cachedGroups(kind.hints, groups);
    readGroups(kind.hints, 2, total, groups.filter((group) => !cached[group]));
    checkHint(kind);
  }
}

/**
 * Adds the timers: keepWarm every 5 minutes, and removeDuplicateVotes once a day at 3 in the morning (the
 * script's time zone), replacing any from before. Run it once from the editor; it asks for permission to manage
 * the script's triggers.
 */
function installTimers() {
  const timed = ["keepWarm", "removeDuplicateVotes"];
  ScriptApp.getProjectTriggers().filter((t) => timed.includes(t.getHandlerFunction())).forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("keepWarm").timeBased().everyMinutes(5).create();
  ScriptApp.newTrigger("removeDuplicateVotes").timeBased().everyDays(1).atHour(3).create();
}

/**
 * Removes answers saved twice, keeping each answer's first row. A phone that gives up waiting can send answers
 * again that the Sheet had in fact saved, and the cache that remembers answer IDs can lose a few when it's busy.
 * installTimers runs this once a day, when hardly anyone is answering: saves wait while it works.
 */
function removeDuplicateVotes() {
  const sheet = spreadsheet().getSheetByName("Votes");
  if (!sheet || sheet.getLastRow() < 3) return;
  const idColumn = VOTE_HEADERS.indexOf("vote_id") + 1;
  withLock(() => {
    const ids = sheet.getRange(2, idColumn, sheet.getLastRow() - 1, 1).getValues();
    const seen = new Set();
    const repeats = [];
    ids.forEach(([id], i) => {
      const key = String(id);
      if (!key) return;
      if (seen.has(key)) repeats.push(i + 2);
      else seen.add(key);
    });
    // From the bottom up, a run of neighbouring rows at a time, so the row numbers still to delete stay right
    for (let end = repeats.length - 1; end >= 0;) {
      let start = end;
      while (start > 0 && repeats[start - 1] === repeats[start] - 1) start--;
      sheet.deleteRows(repeats[start], end - start + 1);
      end = start - 1;
    }
    Logger.log(`Removed ${repeats.length} answers saved twice`);
  }, CLEANUP_WAIT_MS);
}

/**
 * Picks a random check hint of one kind and includes its answer, as the app grades it.
 * @param {Object} [kind] - Which kind, from KINDS.
 * @returns {Object} The check hint.
 */
function checkHint(kind = DUPLICATES) {
  const rows = rowCount(kind.checks);
  if (rows < 1) return {};
  const [[id, expected, data]] = cachedRows(kind.checks, 3, rows, [Math.floor(Math.random() * rows)]);
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
  // Found before taking the lock, so the lock is held only for the write itself
  const sheet = spreadsheet().getSheetByName("Votes");
  // The app may send an answer again when it didn't hear back in time; each answer's ID is recorded once
  return withLock(() => {
    const cache = CacheService.getScriptCache();
    const keys = rows.map((row) => row[13]).filter(Boolean).map((id) => `vote:${id}`);
    const seen = keys.length ? cache.getAll(keys) : {};
    const fresh = rows.filter((row) => !row[13] || !seen[`vote:${row[13]}`]);
    writeRows("Votes", VOTE_HEADERS, fresh, sheet);
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
  const sheet = spreadsheet().getSheetByName(name);
  withLock(() => writeRows(name, headers, rows, sheet));
}

/**
 * Adds rows after a tab's last row. Call it while holding the script lock.
 * @param {string} name - The tab name.
 * @param {string[]} headers - Its column headers, for a new tab.
 * @param {Array[]} rows - The rows to add.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} [found] - The tab, if it was already looked up.
 */
function writeRows(name, headers, rows, found) {
  if (rows.length === 0) return;
  const sheet = found || tab(name, headers);
  const width = rows[0].length;
  // A tab made before a column was added is too narrow, and its header row is missing the new names. Checked
  // once an hour rather than on every save, since each check is a trip to the Sheet while holding the lock.
  const cache = CacheService.getScriptCache();
  const shapeKey = `shape:${name}:${width}`;
  if (!cache.get(shapeKey)) {
    if (sheet.getMaxColumns() < width) sheet.insertColumnsAfter(sheet.getMaxColumns(), width - sheet.getMaxColumns());
    if (headers && sheet.getLastColumn() < headers.length) sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    cache.put(shapeKey, "1", 3600);
  }
  // getRange can't reach past the tab's last row, so a full tab gets more rows first
  const first = sheet.getLastRow() + 1;
  const missing = first + rows.length - 1 - sheet.getMaxRows();
  if (missing > 0) sheet.insertRowsAfter(sheet.getMaxRows(), missing + ROWS_TO_ADD);
  try {
    sheet.getRange(first, 1, rows.length, width).setValues(rows);
  } catch (error) {
    // Someone may have deleted columns by hand since the last check: check again on the next save
    cache.remove(shapeKey);
    throw error;
  }
}

/**
 * Runs a function while holding the script lock, so two requests can't write over each other.
 * @param {Function} fn - What to run.
 * @param {number} [wait] - How long to wait for the lock, in milliseconds.
 * @returns {*} What it returns.
 * @throws {Error} BUSY when another request held the lock for longer than that.
 */
function withLock(fn, wait = SAVE_WAIT_MS) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(wait)) throw new Error(BUSY);
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
  // The rows are new, so handing out starts again from the top
  moveNextHint(0, 0);
  Logger.log(`${pairs.length} pairs: ${hints.length} hints, ${checks.length} checks`);
}

/**
 * Adds Joe's second batch, imported into a tab named RawPairs2, after the hints already there.
 */
function addBatch2() {
  addBatch("RawPairs2", "b2", DIFFERENT_CHECKS, "RawFamily");
}

/**
 * Starts handing out the record hints after the Attachments and AttachChecks tabs are filled in: import
 * sheets/attachments.local.csv and sheets/attach_checks.local.csv (made by sheets/export_attachments.py) as new tabs
 * with "Convert text to numbers, dates, and formulas" off, rename them Attachments and AttachChecks, then run this.
 */
function useNewAttachments() {
  clearHintCache();
  moveNextHint(0, 0, KINDS.record_attachment);
  logNextHint();
}

/**
 * Starts handing out the Chilean site's hints after the ChileHints and ChileChecks tabs are filled in: import
 * sheets/chile_hints.local.csv and sheets/chile_checks.local.csv (made by sheets/export_chile.py) as new tabs with
 * "Convert text to numbers, dates, and formulas" off, rename them ChileHints and ChileChecks, then run this.
 */
function useNewChileHints() {
  clearHintCache();
  moveNextHint(0, 0, CHILE);
  logNextHint();
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
