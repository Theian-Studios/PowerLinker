# PowerLinker on a Google Sheet

The public site runs on GitHub Pages. It has no server of its own: a Google Apps Script web app,
attached to the results Sheet, hands out hints and writes every answer to the Sheet.

```
GitHub Pages (the app)  ──GET hints / POST answers──▶  Apps Script (Code.gs)  ──▶  Google Sheet
```

## The Sheet

| Tab | What's in it |
|---|---|
| Summary | Live counts: answers, people, check hint accuracy, time per answer |
| Votes | One row per answer: time, anonymous voter ID, session, hint ID, whether it was a check hint and if it was right, the answer, seconds spent, VIP, both people's tree IDs |
| Hints | The pairs to vote on, served in row order. Each row is a hint ID and the hint as JSON |
| Checks | Check hints with known answers: 1 is the same person, -1 is different people |
| Voters | People who entered the VIP code |
| Sessions | Sessions ended after three missed check hints |

Answers are only ever added. If someone goes back and changes an answer, both rows are kept; the later
one is their final answer.

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

## Testing locally

`npm run dev -- --mode sheets` reads `frontend/.env.sheets.local`, which sets `VITE_SHEETS_URL`. Point it
at the deployed script, or at a local stand-in that runs `Code.gs` against the CSVs.

## Limits to know about

- Anyone with the site link can add rows. Each row has an anonymous voter ID, so junk can be filtered out.
- Apps Script handles about 30 requests at once and has daily quotas, which is enough for dozens of
  volunteers at a time.
- Each request takes about a second. Answers are sent in the background, so people don't wait on them.
