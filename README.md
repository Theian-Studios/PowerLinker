![PowerLinker](powerlinker-logo.png)

# PowerLinker

PowerLinker lets volunteers help the Record Linking Lab tidy up the FamilySearch tree without a FamilySearch
account. Each hint shows two people already on the tree, one from the 1930 census and one from the 1940 census,
side by side with their families, and asks one question: **are they the same person?** The volunteer answers
**Same person**, **Different**, or **Not sure** (with a reason). The lab uses the answers to decide which pairs to
merge.

The hints are possible duplicates from Joe Price's Census Tree data. The public site is
https://theian-studios.github.io/PowerLinker/, and every answer goes to a Google Sheet the lab can read.

## How it fits together

```
GitHub Pages (the app)  ──GET hints / POST answers──▶  Apps Script (sheets/Code.gs)  ──▶  Google Sheet
```

There is no server of our own. The app is a static site; a Google Apps Script web app attached to the results
Sheet hands out hints and writes each answer as a row. [sheets/README.md](sheets/README.md) covers the Sheet's tabs,
loading hints, setting up and updating the script, and its limits.

### How hints are handed out

Every request for hints gets the next ones from one shared position in the Hints tab, so each hint is handed out
once before any hint is handed out again. Batches go in order: batch 1's hints go round three times
(`PASSES_PER_BATCH` in `Code.gs`) before batch 2's start, then batch 2's go round three times, and after that all
the hints go round together. Run `logNextHint` in the Apps Script editor to see how far the volunteers have got.

### What volunteers see

- **A first-visit intro**: six short cards on why the work matters, how it works and what the colors mean, ending
  with a request for their name, which goes with each answer. The **?** button opens the cards again.
- **The comparison**: name, birth, death and both census homes for the two people, each marked green (matches),
  yellow (close: a nickname, an initial, a year or two off) or red (conflicts), with a short reason. Family members
  are paired up underneath. On a computer, a sidebar sums up the evidence and gives tips.
- **Notes above the table** for things that are easy to miss: facts on one side that can't all be true, matching
  family, and a missing birth date or birthplace, with a link to each person's tree page.
- **Check hints**: about one in each page of hints is a pair whose answer the lab already knows. Missing one shows
  the right answer and the facts that show it.
- **Points**: 25 answers in a row earn 100 points. Missing a check hint, or answering "Same person" when two or
  more of the main person's facts conflict and their families don't match, starts the count over. **Not sure**
  never does. At 25, a screen under the header shows how many people they helped back to their families and
  their names: the main person of each "Same person" answer in that streak, leaving out check hints.
- **Bad connections**: answers wait on the phone until the Sheet confirms them, through offline spells and busy
  moments, and the next hints are saved for the next visit.

## The code

| Folder | What's in it |
|---|---|
| `frontend/` | The app: Vite, React and TypeScript |
| `frontend/src/Components/DocumentMatcher` | The hint screen: the question, notes, comparison, answer buttons |
| `frontend/src/Components/CompareTable` | Builds and shows the comparison rows (`compareRows.ts`) |
| `frontend/src/Services/highlightScoring.ts` | Scores names, dates and places green, yellow or red |
| `frontend/src/Services/nicknames.ts` | Given names that stand for each other: Sallie and Sarah, Wm and William, Giuseppe and Joseph |
| `frontend/src/Hooks/useQueue.ts` | Sends answers in batches and keeps them until the Sheet has them |
| `frontend/src/Services/sheetsApi.ts` | Talks to the Sheet's script, and what the browser remembers between visits |
| `sheets/` | `Code.gs`, the Sheet's script, and `export_hints.py`, which makes the hint files from the lab's data |
| `backend/` | The lab's original AWS backend, and a local mock of it (below). The public site doesn't use it |
| `terraform/`, `docker/` | Infrastructure for the AWS backend |
| `.github/workflows/pages.yml` | Builds the app and publishes it to GitHub Pages |

## Running it locally

Install once:

```bash
npm --prefix frontend install
```

Against the Sheet: put `VITE_SHEETS_URL=<the script's /exec URL>` in `frontend/.env.sheets.local`, then

```bash
npm --prefix frontend run dev -- --mode sheets
```

Point it at the deployed script only to look around: every answer you give is saved to the real Sheet.

Before publishing, check that it builds and lints:

```bash
npm --prefix frontend run build
```

```bash
npm --prefix frontend run lint
```

## Publishing

- **The app**: `pages.yml` builds and publishes the site when its branch is pushed, using the `SHEETS_URL`
  repository variable for the script's address.
- **The script**: paste `sheets/Code.gs` into the Apps Script editor, save, then Deploy → Manage deployments → edit
  → Version: New version, so the URL stays the same. See [sheets/README.md](sheets/README.md).

Real people's records stay in the Sheet. The hint files `sheets/*.local.csv` are gitignored and must never be
committed.

## The lab's AWS backend

PowerLinker started inside the lab with record-attachment hints (a census record and a person on the tree),
served by a Python Lambda (built from `docker/`), with hints in DynamoDB, votes through an SQS queue, and FamilySearch
data through TreeTapper. That code is still here in `backend/src`, with its Terraform and Docker setup, and the app
still works with it when `VITE_SHEETS_URL` isn't set: it shows a hint-type menu, sends answers to the lab's API,
and drops a session's unsent votes after a missed check hint instead of keeping them.

### Running against a mock of it

Without AWS credentials or the private TreeTapper and Boto4GS packages, run the app against the local mock in
`backend/mock`. It serves the same routes (`GET /hints`, `PUT /hints`, `POST /session-invalidate`) on port 8000 of
the host the app is opened on.

- Hints come from `backend/public/dummy/hints.json` and are kept in memory.
- Votes count right away, with the same thresholds as `VoteService`. Settled hints leave the pool, labelled
  `ATTACH_ME`, `REJECTED` or `EXPERT`.
- Each visitor gets a signed, anonymous `pl_voter` cookie. Check hints are graded on the server, and each voter's
  weight is `(correct + 1) / (answered + 2)`, so new voters start at 0.5 and earn trust. The +3 / -3 thresholds use
  weighted votes; the 5-vote and 3-skip limits count people. One vote per voter per hint.
- `GET /mock/state` shows the pool, votes, settled hints, voters and ended sessions. `POST /mock/reset` puts every
  sample hint back.

Set up once:

```bash
python3.13 -m venv .venv
```

```bash
.venv/bin/pip install -r backend/mock/requirements.txt
```

Run the mock, then the app with `npm --prefix frontend run dev`, and open http://localhost:5173:

```bash
npm --prefix frontend run mock-backend
```

Test it:

```bash
.venv/bin/python -m pytest backend/tests/mock
```
