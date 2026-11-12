// Builds the lookup files the app loads to say more about a match (public/lookups/us.json and cl.json):
//   - where places are, so two different places can show how far apart they are
//   - how many people in our hints lived in each town, so a match in a small town can say so
//   - which given names and surnames are common, so a match on a rare name can say so
// They hold counts, coordinates and common names only: never a person's record. Built from the lab's files (kept out
// of git) and public lists:
//   - names: counted from our own people (the 1920, 1930 and 1940 censuses in the US, Joe's files in Chile), each
//     hint counting a name once however many times its people carry it
//   - US places: the Census Bureau's 2023 gazetteer of places and counties, after the coordinates in Joe's record hints
//   - Chile: sheets/chile_communes.csv (commune centers)
//
// Usage, from frontend/, once per site:
//   npx tsx scripts/build-lookups.ts --region us \
//     --gaz-places 2023_Gaz_place_national.txt --gaz-counties 2023_Gaz_counties_national.txt \
//     --records hints_data_ian.tsv --dups dup_data_1930_1940.csv --dups dup_data_1930_1940_v2.csv
//   npx tsx scripts/build-lookups.ts --region cl --chile-folder ~/Downloads/powerlinker --chile-communes ../sheets/chile_communes.csv

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";


/**
 * Names in this many of our hints or more are listed as common; rarer ones aren't listed. Our US hints are about one
 * person in 850 of the census, so a name in 3 hints or fewer belonged to roughly 2,500 people or fewer.
 */
const COMMON_NAME_COUNT = 4;
/** Chilean surnames seen this many times or more in Joe's files are listed as common. */
const COMMON_CHILE_SURNAME_COUNT = 4;

const args = process.argv.slice(2);
/**
 * Reads every value given for a command-line option.
 * @param name - The option, without its dashes.
 * @returns The values, in order.
 */
function option(name: string): string[] {
  return args.flatMap((arg, i) => (arg === `--${name}` && args[i + 1] ? [args[i + 1].replace(/^~/, process.env.HOME ?? "")] : []));
}

/**
 * Splits CSV or TSV text into rows of fields, handling quoted fields.
 * @param text - The file's text.
 * @param separator - "," or "\t".
 * @returns The rows, each a list of fields.
 */
function parseDelimited(text: string, separator: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"' && field === "") quoted = true;
    else if (c === separator) { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (c !== "\r") field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/**
 * Reads a CSV or TSV file as objects keyed by its header row.
 * @param path - The file.
 * @param separator - "," or "\t".
 * @returns One object per row.
 */
function readTable(path: string, separator = ","): Record<string, string>[] {
  const [header, ...rows] = parseDelimited(readFileSync(path, "utf8"), separator);
  const names = header.map((name) => name.trim());
  return rows.filter((row) => row.length > 1).map((row) => Object.fromEntries(names.map((name, i) => [name, (row[i] ?? "").trim()])));
}

// Which site's file to build: the scoring code reads places and names the Chilean way only when told before it loads
const region = option("region")[0] === "cl" ? "cl" : "us";
(globalThis as { VITE_REGION?: string }).VITE_REGION = region;
const { placeParts, nameWords, chilePlace } = await import("../src/Services/highlightScoring.ts");

/**
 * Gives a place's lookup key: its cleaned parts joined, so "Aquia, Stafford, Virginia" and "Aquia, Stafford,
 * Virginia, United States" share one.
 * @param place - The place as written.
 * @returns The key, or "" for a place with nothing to look up.
 */
function placeKey(place: string): string {
  return placeParts(place).join("|");
}

/**
 * Gives a given name's lookup key: its first word, plain.
 * @param given - The given names.
 * @returns The first given name, lowercase without accents.
 */
function givenKey(given: string): string {
  return nameWords(given)[0] ?? "";
}

/**
 * Rounds a coordinate to three decimals (about 100 m), enough for distances in miles or km.
 * @param value - Degrees.
 * @returns The rounded degrees.
 */
const round = (value: number) => Math.round(value * 1000) / 1000;

const STATE_NAMES: Record<string, string> = {
  AL: "alabama", AK: "alaska", AZ: "arizona", AR: "arkansas", CA: "california", CO: "colorado", CT: "connecticut",
  DE: "delaware", DC: "district of columbia", FL: "florida", GA: "georgia", HI: "hawaii", ID: "idaho", IL: "illinois",
  IN: "indiana", IA: "iowa", KS: "kansas", KY: "kentucky", LA: "louisiana", ME: "maine", MD: "maryland",
  MA: "massachusetts", MI: "michigan", MN: "minnesota", MS: "mississippi", MO: "missouri", MT: "montana",
  NE: "nebraska", NV: "nevada", NH: "new hampshire", NJ: "new jersey", NM: "new mexico", NY: "new york",
  NC: "north carolina", ND: "north dakota", OH: "ohio", OK: "oklahoma", OR: "oregon", PA: "pennsylvania",
  RI: "rhode island", SC: "south carolina", SD: "south dakota", TN: "tennessee", TX: "texas", UT: "utah",
  VT: "vermont", VA: "virginia", WA: "washington", WV: "west virginia", WI: "wisconsin", WY: "wyoming",
};

// ---- United States ----
if (region === "us" && option("records").length > 0) {
  // Coordinates: Joe's record hints first (they name census places exactly as the hints do), then the gazetteer
  const coords = new Map<string, [number, number]>();
  const townCounts = new Map<string, number>();
  const givenCounts = new Map<string, number>();
  const surnameCounts = new Map<string, number>();
  /**
   * Counts the names one hint's people carry, once each: the same person on both sides of a hint, or in two
   * censuses, shouldn't count twice.
   * @param givens - Given names in the hint.
   * @param surnames - Surnames in the hint.
   */
  const countNames = (givens: string[], surnames: string[]) => {
    for (const key of new Set(givens.map(givenKey).filter((key) => key.length > 1))) givenCounts.set(key, (givenCounts.get(key) ?? 0) + 1);
    for (const key of new Set(surnames.map((surname) => nameWords(surname).join("")).filter((key) => key.length > 1))) {
      surnameCounts.set(key, (surnameCounts.get(key) ?? 0) + 1);
    }
  };
  /**
   * Counts a person who lived somewhere, for town sizes.
   * @param place - Where they lived.
   */
  const countResidence = (place: string) => {
    const key = placeKey(place);
    if (key) townCounts.set(key, (townCounts.get(key) ?? 0) + 1);
  };

  for (const path of option("records")) {
    for (const row of readTable(path, "\t")) {
      const years = ["1930", "1920"];
      countNames(
        years.flatMap((year) => [row[`given_name${year}`] ?? "", ...(row[`parents${year}`] ?? "").split(";")]),
        years.map((year) => row[`surname${year}`] ?? ""),
      );
      for (const year of years) {
        const place = row[`place${year}`];
        const lat = Number(row[`lat${year}`]);
        const lon = Number(row[`lon${year}`]);
        const key = placeKey(place ?? "");
        if (key && Number.isFinite(lat) && Number.isFinite(lon) && lat !== 0 && !coords.has(key)) coords.set(key, [round(lat), round(lon)]);
        if (place) countResidence(place);
      }
    }
  }
  for (const path of option("dups")) {
    // A pair's two people (1930 and 1940) are one hint
    const pairs = new Map<string, Record<string, string>[]>();
    for (const row of readTable(path)) {
      if (row.event_place) countResidence(row.event_place);
      pairs.set(row.id, [...(pairs.get(row.id) ?? []), row]);
    }
    for (const rows of pairs.values()) countNames(rows.map((row) => row.given_name ?? ""), rows.map((row) => row.surname ?? ""));
  }

  // The gazetteer, by town and state ("aquia|virginia"), and counties by county and state
  const gazTowns = new Map<string, [number, number]>();
  for (const path of option("gaz-places")) {
    for (const row of readTable(path, "\t")) {
      const state = STATE_NAMES[row.USPS];
      const town = nameWords(row.NAME.replace(/\s+(city|town|village|borough|cdp|municipality|plantation|township)$/i, "")).join(" ");
      if (state && town) gazTowns.set(`${town}|${state}`, [round(Number(row.INTPTLAT)), round(Number(row.INTPTLONG))]);
    }
  }
  // Counties: the center, and how far a home could be from it (the radius of a circle of the county's area, in km)
  const gazCounties = new Map<string, [number, number, number]>();
  for (const path of option("gaz-counties")) {
    for (const row of readTable(path, "\t")) {
      const state = STATE_NAMES[row.USPS];
      const county = nameWords(row.NAME.replace(/\s+(county|parish|borough|census area|municipality|city and borough)$/i, "")).join(" ");
      const radiusKm = Math.round(Math.sqrt((Number(row.ALAND_SQMI) * 2.59) / Math.PI));
      if (state && county) gazCounties.set(`${county}|${state}`, [round(Number(row.INTPTLAT)), round(Number(row.INTPTLONG)), radiusKm]);
    }
  }

  // Every town people lived in, with where it is (when known), how many of our people lived there, and for a place
  // that's really a whole county (a record that names only "Scott, Kentucky", or a town we could only place by its
  // county) how far from that point a home could be
  const places: Record<string, [number, number, number] | [number, number, number, number] | [number]> = {};
  let located = 0;
  for (const [key, count] of townCounts) {
    const parts = key.split("|");
    const state = parts[parts.length - 2];
    const town = nameWords(parts[0]).join(" ");
    const county = parts.length >= 4 ? nameWords(parts[parts.length - 3]).join(" ") : undefined;
    const wholeCounty = parts.length === 3 && gazCounties.get(`${town}|${state}`) && !gazTowns.has(`${town}|${state}`);
    const exact = coords.get(key) ?? (wholeCounty ? undefined : gazTowns.get(`${town}|${state}`));
    const area = wholeCounty ? gazCounties.get(`${town}|${state}`) : !exact && county ? gazCounties.get(`${county}|${state}`) : undefined;
    const at = exact ?? area;
    if (at) located++;
    places[key] = !at ? [count] : area && area[2] > 0 ? [at[0], at[1], count, area[2]] : [at[0], at[1], count];
  }
  const commonGiven = [...givenCounts].filter(([, n]) => n >= COMMON_NAME_COUNT).map(([name]) => name);
  const commonSurnames = [...surnameCounts].filter(([, n]) => n >= COMMON_NAME_COUNT).map(([name]) => name);
  // Names in one small file; towns in one file per state, so a hint loads only the states it names. Within a state's
  // file each town's key leaves off the state and country ("aquia|stafford").
  const out = join(import.meta.dirname, "..", "public", "lookups");
  mkdirSync(join(out, "us"), { recursive: true });
  writeFileSync(join(out, "us-names.json"), JSON.stringify({ surnames: commonSurnames, given: commonGiven }));
  const byState: Record<string, Record<string, unknown>> = {};
  for (const [key, value] of Object.entries(places)) {
    const parts = key.split("|");
    if (parts[parts.length - 1] !== "united states" || parts.length < 3) continue;
    const state = parts[parts.length - 2];
    (byState[state] = byState[state] ?? {})[parts.slice(0, -2).join("|")] = value;
  }
  for (const [state, towns] of Object.entries(byState)) writeFileSync(join(out, "us", `${state.replace(/\s+/g, "-")}.json`), JSON.stringify(towns));
  console.log(`us-names.json: ${commonSurnames.length} common surnames, ${commonGiven.length} common given names; ${Object.keys(byState).length} state files, ${Object.keys(places).length} towns (${located} located)`);
}

// ---- Chile ----
const chileFolder = option("chile-folder")[0];
const chileCommunes = option("chile-communes")[0];
if (region === "cl" && chileFolder && chileCommunes && existsSync(chileCommunes)) {  const communes: Record<string, [number, number, number]> = {};
  for (const row of readTable(chileCommunes)) communes[row.key] = [round(Number(row.lat)), round(Number(row.lon)), 0];
  const surnameCounts = new Map<string, number>();
  const givenCounts = new Map<string, number>();
  const people = [
    ...readTable(join(chileFolder, "pl_pids_info_relatives.csv")).filter((row) => row.rel_type_to_focus_person === "self"),
    ...readTable(join(chileFolder, "relative_info.csv")),
  ];
  for (const person of people) {
    for (const place of [person.birth_place, person.death_place, person.christening_place]) {
      const commune = place ? chilePlace(placeParts(place)).commune : undefined;
      if (commune && communes[commune]) communes[commune][2]++;
    }
    for (const surname of nameWords(person.surname ?? "").filter((word) => !["de", "del", "la", "las", "los", "y", "e", "i"].includes(word))) {
      surnameCounts.set(surname, (surnameCounts.get(surname) ?? 0) + 1);
    }
    const given = givenKey(person.given_name ?? "");
    if (given.length > 1) givenCounts.set(given, (givenCounts.get(given) ?? 0) + 1);
  }
  const cl = {
    surnames: [...surnameCounts].filter(([, n]) => n >= COMMON_CHILE_SURNAME_COUNT).map(([name]) => name),
    given: [...givenCounts].filter(([, n]) => n >= COMMON_NAME_COUNT).map(([name]) => name),
    communes,
  };
  const out = join(import.meta.dirname, "..", "public", "lookups");
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "cl.json"), JSON.stringify(cl));
  console.log(`cl.json: ${cl.surnames.length} common surnames, ${cl.given.length} common given names, ${Object.keys(communes).length} communes`);
}
