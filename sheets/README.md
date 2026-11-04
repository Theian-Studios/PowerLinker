# PowerLinker on a Google Sheet

The public site runs on GitHub Pages. It has no server of its own: a Google Apps Script web app,
attached to the results Sheet, hands out hints and writes every answer to the Sheet.

```
GitHub Pages (the app)  ──GET hints / POST answers──▶  Apps Script (Code.gs)  ──▶  Google Sheet
```

## The Sheet

| Tab | What's in it |
|---|---|
| Summary | Live counts in four sections: progress through the hints, answers (with Not sure reasons), volunteers, and check hints (accuracy leaves out Not sure) |
| Volunteers | One row per voter ID, most answers first: their latest name, answers, last answer, check hints right and accuracy, and Not sure count. All formulas over Votes |
| Votes | One row per answer: time received, anonymous voter ID, session, hint ID, whether it was a check hint and if it was right ("Not sure" is left blank), the answer, seconds spent, VIP, both people's tree IDs, the answer's ID, when it was given, for "Not sure" why (not enough info, facts disagree, or other), and the name the volunteer gave, if any |
| Hints | The pairs to vote on, handed out in order from one shared position (see below). Each row is a hint ID, starting with its batch ("b1-", "b2-"), and the hint as JSON |
| Checks | Check hints with known answers: 1 is the same person, -1 is different people |
| Voters | People who entered the VIP code |
| Sessions | Sessions ended after three missed check hints, with the voter ID and name |

Answers are only ever added. If someone goes back and changes an answer after it was sent, both rows are
kept; the later one is their final answer. Each answer carries a `vote_id`, and the script records each
`vote_id` once, so an answer the app sends again (after a timeout, or as the page closes) isn't counted twice.
When analyzing, keep one row per `vote_id`, then the latest row per voter and hint by `answered_at`
(`time` is when the Sheet received it, which can be later after a retry). A check hint is graded on its first
answer only: going Back and re-answering one isn't sent.

A tab made before a column existed gets the column and its header on the next write, and a full tab gets
more rows, so answers never fail for lack of room.
Names are what volunteers typed, kept in their browser and sent with each answer; one person can show up
under slightly different spellings, so the voter ID is the reliable way to group a person's answers.

The Votes tab has room for 50,000 answers, with `time` and `answered_at` formatted as date and time. Rows
the script adds past that may show only the date; select columns A and O and choose Format → Number →
Date time.

## How hints are handed out

Every request for hints gets the next ones from one shared position, whatever the app asks for, so each hint is
handed out once before any is handed out again. Batches go in the order they were added: batch 1's hints go round
`PASSES_PER_BATCH` times (3) before batch 2's start, then batch 2's go round 3 times, and after every batch has had
its turns, all the hints go round together. A hint handed out isn't always answered (a volunteer can stop partway
through a page), so after its turns a hint has up to 3 answers.

To see how far the volunteers have got, run `logNextHint` in the editor: it logs the next row, its batch and turn,
and how many hints have been handed out. The position is kept in the script's cache, and `keepWarm` copies it to
the script property `NEXT_HINT` every 5 minutes in case the cache drops it. To move it, edit that property in
Project Settings to the row and turn to hand out next, like `{"row":2765,"pass":0}` for row 2,767 of the Hints tab
(`row` 0 is the first row under the header, and `pass` 3 means all the hints going round together), then run
`useSavedNextHint` straight away. `buildHints` starts it from the top itself. A batch added after every batch has had its turns
just joins the round of all the hints.

## Making the hints

Hints come from Joe Price's Census Tree files. They hold real people's records, so the output files are
gitignored and must never be committed.

```bash
python -m sheets.export_hints ~/Downloads/dup_data_1930_1940.csv ~/Downloads/powerlinker-data-2026-10-29/family_info_b1.csv
```

This writes `sheets/hints.local.csv` and `sheets/checks.local.csv`. Load them into the Sheet:

1. Open the **Hints** tab, then File → Import → Upload, choose `hints.local.csv`, and pick
   **Replace current sheet**.
2. Do the same on the **Checks** tab with `checks.local.csv`.

Same-person check hints are pairs the lab marked `automate = 1`. Different-person check hints pair the
1930 person of one pair with the 1940 person of another who has the same surname and sex; the low
duplicate scores aren't used, since many low-scoring pairs turned out to be the same person.

Once volunteers have started, don't run `buildHints` again: it rewrites the Hints and Checks tabs, which
changes what each position and check-hint ID points to. Add new data with `addBatch` instead.

Different-person check hints skip pairs a careful volunteer couldn't tell apart: similar first names (the
same, one letter apart, or a stand-in like "Junior") with no birth years 5 or more apart and no different
birthplaces.

### Adding a batch

Batch 2 (`dup_data_1930_1940_v2.csv`) goes in after batch 1 so people already partway through keep
their place. Import it into a tab named **RawPairs2** the same way (Insert new sheet, conversion off), then
run `addBatch2` in the Apps Script editor. It appends new hints after the existing ones, adds same-person
checks (`automate = 1`) and 150 different-person checks, and skips pairs it already added.

Family is looked up by person in the **RawFamily** tab, so a family file for a new batch can be imported
into that tab with "Append to current sheet". `addBatch` and `buildHints` stop with an error if a tab they
read is missing or empty, rather than writing empty Hints or Checks tabs.

## Setting up the script (once)

1. In the Sheet, open Extensions → Apps Script. Replace the starter code with `sheets/Code.gs`, and save.
2. Project Settings (gear icon) → Script properties → Add script property: `VIP_CODE` = the VIP code.
   It isn't in `Code.gs` because this repo is public.
3. Deploy → New deployment → Select type: Web app. Execute as: **Me**. Who has access: **Anyone**.
   Deploy, allow the permissions Google asks for, and copy the web app URL (it ends in `/exec`).
4. In the GitHub repo: Settings → Secrets and variables → Actions → Variables → New repository variable:
   `SHEETS_URL` = that URL. Then rerun the Pages workflow (Actions → Pages → Run workflow).

After changing `Code.gs`, use Deploy → Manage deployments → edit → Version: New version, so the URL stays
the same.

5. Run `installTimers` once in the editor (pick it in the function menu, then Run) and allow the
   permission to manage triggers. It adds a timer that runs `keepWarm` every 5 minutes, which reads a page
   of hints and a check hint so the script and its cache don't go cold between volunteers, and one that
   runs `removeDuplicateVotes` at 3 every morning. A phone that gives up waiting on a busy Sheet can send
   answers again that were in fact saved; about 1 in 100 got through twice when 60 people answered every
   2 seconds, and this removes them, keeping each answer's first row. Running `installTimers` again
   replaces the timers rather than adding more; Triggers (clock icon) shows them. Run
   `removeDuplicateVotes` by hand any time; saves wait while it works.

## The cache

Requests for hints and check hints read them through the script's cache, 10 rows at a time, so most don't
open the Sheet, which is most of a request's time. Each time `keepWarm` runs it reads the hints coming up after
the shared position: three times as many as were handed out in the last 5 minutes, between 600 and 3,000, so
pages come from the cache even when a room of volunteers starts at once. Cached rows last 6 hours. `buildHints` and `addBatch`
start a fresh cache themselves. After editing the Hints or Checks tab by hand, run `clearHintCache` in the
editor, or volunteers can get the old rows for up to 6 hours.

## Testing locally

`npm run dev -- --mode sheets` reads `frontend/.env.sheets.local`, which sets `VITE_SHEETS_URL`. Point it
at the deployed script, or at a local stand-in that runs `Code.gs` against the CSVs.

## Limits to know about

- Anyone with the site link can add rows. Each row has an anonymous voter ID, so junk can be filtered out.
- Apps Script handles about 30 requests at once and has daily quotas. Saves take turns (a lock keeps two
  from writing the same row) and each takes about a second, so the app sends answers 25 at a time or every
  minute or two, and a save that waits more than 5 seconds for its turn answers "busy" instead of holding
  one of the 30. The app
  keeps answers on the device until the Sheet has them, and tries again after a longer wait each time, so
  a busy script delays answers but doesn't lose them. That's enough for about 50 volunteers at once.
- Each request takes about a second, and up to 10 when the script has been idle (the keep-warm timer is
  for that). The app asks for a page of hints and a check hint in one request. Answers are sent in the
  background, so people don't wait on them.
- A spreadsheet holds at most 10 million cells. Each answer is a row of 17, and in November 2026 about 3.6
  million cells were in use (half of them in the raw import tabs), so there's room for a few hundred
  thousand more answers.
