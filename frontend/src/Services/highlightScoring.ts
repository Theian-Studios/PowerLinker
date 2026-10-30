import FlexibleDate from "flexibledatets";
import { compareTwoNames } from "namecomparator-ts/dist/NameComparatorTS/nameComparator.js";
import { HighlightType } from "../Models/HighlightType";

/**
 * Returns whether a string is empty or contains only whitespace.
 * @param value - The string to check.
 * @returns True if the value is blank.
 */
function isBlank(value: string): boolean {
  return value.replace(/\s+/g, "") === "";
}

/**
 * Maps a comparison score to a highlight color using shared thresholds.
 * @param score - Similarity score from 0 to 100.
 * @param recordValue - Value from the record side of the comparison.
 * @param treeValue - Value from the tree side of the comparison.
 * @returns Green, yellow, or red highlight type.
 */
export function highlightFromScore(
  score: number,
  recordValue: string,
  treeValue: string
): HighlightType {
  if (isBlank(recordValue) || isBlank(treeValue)) {
    return HighlightType.None;
  }
  if (score >= 95) {
    return HighlightType.Green;
  };
  if (score >= 60) {
    return HighlightType.Yellow;
  };
  return HighlightType.Red;
}

/**
 * Compares two names and returns a confidence score.
 * @param nameOne - First name to compare.
 * @param nameTwo - Second name to compare.
 * @returns Confidence score from 0 to 100, or 0 on failure.
 */
function getNameComparisonConfidence(nameOne: string, nameTwo: string): number {
  try {
    const result = compareTwoNames(nameOne, nameTwo);
    return result.mostRecentAttemptScore;
  } catch {
    return 0;
  }
}

/**
 * Determines the highlight color for a record vs tree name pair.
 * @param recordCandidateFirstName - The first name of the person on record.
 * @param recordCandidateSurname - The surname of the person on the record.
 * @param treePersonFirstName - The first name of the person on the Family Search tree.
 * @param treePersonSurname - The surname of the person on the Family Search tree.
 * @param personGender - The gender of the person whose higlight is being gathered, if available.
 * @returns Green, yellow, or red highlight type.
 */
export function getNameHighlight(
  recordCandidateFirstName: string = "",
  recordCandidateSurname: string = "",
  treePersonFirstName: string = "",
  treePersonSurname: string = "",
  personGender: string = ""
): HighlightType {
  return scoreName(recordCandidateFirstName, recordCandidateSurname, treePersonFirstName, treePersonSurname, personGender).highlight;
}

/** Years apart two dates can be and still show yellow; anything further apart is red. */
export const MAX_YELLOW_YEAR_GAP = 5;

/** Spellings of the same country treated as equal when comparing places. */
const PLACE_ALIASES: Record<string, string> = {
  "usa": "united states",
  "dc": "district of columbia",
  "us": "united states",
  "united states of america": "united states",
  "uk": "united kingdom",
  "great britain": "united kingdom",
  "russian empire": "russia",
  "russian federation": "russia",
  "soviet union": "russia",
  "ussr": "russia",
  "german empire": "germany",
  "deutschland": "germany",
  "austria-hungary": "austria",
  "austrian empire": "austria",
  "kingdom of italy": "italy",
  "ottoman empire": "turkey",
  "bohemia": "czechoslovakia",
  "czech republic": "czechoslovakia",
};

/**
 * Countries whose borders moved around this period, so someone's birthplace can be written as either:
 * a person born in Warsaw in 1890 was born in the Russian Empire and in Poland.
 */
const BORDER_GROUPS: string[][] = [
  ["russia", "poland", "lithuania", "latvia", "estonia", "finland", "ukraine", "belarus", "bessarabia", "romania"],
  ["germany", "prussia", "poland", "austria", "alsace", "lorraine", "france", "denmark"],
  ["austria", "hungary", "czechoslovakia", "poland", "galicia", "yugoslavia", "croatia", "slovenia", "romania", "italy", "ukraine", "slovakia"],
  ["united kingdom", "ireland"],
  ["turkey", "greece", "syria", "lebanon", "armenia"],
];

/**
 * Splits a place into normalized parts, e.g. "Farnworth, Lancashire, England" -> ["farnworth", "lancashire", "england"].
 * @param place - The place string to split.
 * @returns Lowercased, trimmed place parts with aliases applied.
 */
function placeParts(place: string): string[] {
  if (PLACEHOLDER_PLACES.test(place.trim())) return [];
  const parts = place
    .toLowerCase()
    .replace(/[.]/g, "")
    .replace(/\([^)]*\)/g, "")
    .split(",")
    .map((part) => part.trim())
    // "Lucas County" and "Lucas" are the same county
    .map((part) => part.replace(/\s+(county|co|parish)$/, ""))
    // Census wards, districts and precincts name a part of town, not a different place
    .filter((part) => part !== "" && !CENSUS_SUBDIVISION.test(part))
    .map(withoutTownSuffix)
    .map((part) => PLACE_ALIASES[part] ?? part);
  const last = parts[parts.length - 1] ?? "";
  // "Buffalo, New York" is in the United States even when the country isn't written, and "Glasgow, Scotland" in the United Kingdom
  if (US_STATES.has(last)) return [...parts, "united states"];
  if (UK_NATIONS.has(last)) return [...parts, "united kingdom"];
  return parts;
}

/** Names whose "City" is part of the name, not a census label: Salt Lake City isn't Salt Lake County. */
const CITY_NAMES = new Set(["salt lake"]);

/**
 * Drops a census label from a town, so "Toledo City", "Medford Township" and "Middleport Borough" match
 * "Toledo", "Medford" and "Middleport". "New York City" and "Kansas City" keep it, or they'd become states.
 * @param part - One cleaned place part.
 * @returns The part without its label.
 */
function withoutTownSuffix(part: string): string {
  const bare = part.replace(/\s+(city|town|township|borough|village)$/, "");
  return bare !== part && /city$/.test(part) && (US_STATES.has(bare) || CITY_NAMES.has(bare)) ? part : bare;
}

/** The nations of the United Kingdom, which act like US states: Glasgow and Manchester are in different ones. */
const UK_NATIONS = new Set(["england", "scotland", "wales", "northern ireland"]);

/** Countries known well enough that a one-part place naming one is a country, not a town. */
const COUNTRIES = new Set([
  ...Object.values(PLACE_ALIASES), ...BORDER_GROUPS.flat(),
  "canada", "mexico", "ireland", "sweden", "norway", "denmark", "netherlands", "belgium", "switzerland", "spain",
  "portugal", "greece", "china", "japan", "philippines", "cuba", "puerto rico", "australia", "new zealand", "india",
  "iceland", "luxembourg", "serbia", "bulgaria", "lebanon", "syria", "south africa", "brazil", "argentina", "chile",
]);

const US_STATES = new Set([
  "alabama", "alaska", "arizona", "arkansas", "california", "colorado", "connecticut", "delaware",
  "district of columbia", "florida", "georgia", "hawaii", "idaho", "illinois", "indiana", "iowa", "kansas",
  "kentucky", "louisiana", "maine", "maryland", "massachusetts", "michigan", "minnesota", "mississippi",
  "missouri", "montana", "nebraska", "nevada", "new hampshire", "new jersey", "new mexico", "new york",
  "north carolina", "north dakota", "ohio", "oklahoma", "oregon", "pennsylvania", "rhode island",
  "south carolina", "south dakota", "tennessee", "texas", "utah", "vermont", "virginia", "washington",
  "west virginia", "wisconsin", "wyoming",
]);

/** Census answers that point back to an earlier line rather than naming a place. */
const PLACEHOLDER_PLACES = /^(same place|same house|same city|same county|same state|same)$/i;

/**
 * Checks whether a place is a census placeholder like "Same Place" rather than a real place.
 * @param place - The place as written.
 * @returns True for placeholders.
 */
export function isPlaceholderPlace(place: string = ""): boolean {
  return PLACEHOLDER_PLACES.test(place.trim());
}

/** Parts of a census place that subdivide a town, like "Ward 12" or "Assembly District 2". */
// They always name which one ("Ward 12"), so the town of Ward and the District of Columbia aren't caught
const CENSUS_SUBDIVISION = /^(ward|assembly district|election precinct|justice precinct|precinct|beat|district|enumeration district|militia district|supervisor'?s district|tract)\s+(?!of columbia$)\S/;

/**
 * Gets the state (or UK nation) a place names, if it names a known one.
 * @param parts - The place's cleaned parts, ending in the country.
 * @returns The state, or undefined.
 */
function knownState(parts: string[]): string | undefined {
  const state = parts[parts.length - 2];
  return state !== undefined && (US_STATES.has(state) || UK_NATIONS.has(state)) ? state : undefined;
}

/**
 * Checks whether one place only adds detail to the other: the shorter one is within the longer one.
 * @param a - Parts of one place, most specific first.
 * @param b - Parts of the other place.
 * @returns True for pairs like ["ireland"] and ["cork", "ireland"].
 */
function isMoreSpecific(a: string[], b: string[]): boolean {
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  if (shorter.length >= 2) {
    // Both must end in the same country, and name the same state when both name one:
    // "Kansas City, Missouri" isn't within "Kansas", nor "Washington, Pennsylvania" within "Washington"
    if (shorter[shorter.length - 1] !== longer[longer.length - 1]) return false;
    const stateA = knownState(shorter);
    const stateB = knownState(longer);
    if (stateA && stateB && stateA !== stateB) return false;
  }
  // Every part of the shorter place appears in the longer one, in order: "Dalmeny, United Kingdom"
  // is within "Dalmeny, Linlithgowshire, Scotland, United Kingdom"
  let at = 0;
  for (const part of shorter) {
    at = longer.indexOf(part, at);
    if (at === -1) return false;
    at += 1;
  }
  return true;
}

/**
 * Determines the highlight color for a record vs tree place pair.
 * Green when the places are the same or one only adds detail to the other (like "England" vs
 * "Farnworth, Lancashire, England"), yellow when they share a part but disagree on the details
 * (like "Cork, Ireland" vs "Dublin, Ireland"), red when they have nothing in common or two
 * detailed places share only the country.
 * @param recordPlace - Place from the record candidate.
 * @param treePlace - Place from the tree candidate.
 * @returns Green, yellow, red, or no highlight type.
 */
export function getPlaceHighlight(recordPlace: string = "", treePlace: string = ""): HighlightType {
  return scorePlace(recordPlace, treePlace).highlight;
}

/**
 * Capitalizes a cleaned place part for display, e.g. "new york" to "New York".
 * @param part - A lowercase place part.
 * @returns The part in title case.
 */
function titleCase(part: string = ""): string {
  return part.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/**
 * Names the area two places share when one only adds detail, e.g. "Both in Suffolk, Massachusetts".
 * @param a - Parts of one place.
 * @param b - Parts of the other.
 * @returns A short note naming the shared area.
 */
function sharedArea(a: string[], b: string[]): string {
  const all = a.length <= b.length ? a : b;
  const shorter = all.filter((part) => part !== "united states" && part !== "united kingdom");
  if (shorter.length === 0) return `Both in the ${titleCase(all[all.length - 1])}`;
  return `Both in ${shorter.slice(-2).map(titleCase).join(", ")}`;
}

/**
 * Compares two places, such as birthplaces, and says how they differ.
 * In the US, a different state is a conflict and a different town in the same state is worth a look.
 * Elsewhere, a different country is a conflict unless the border moved between them in this period.
 * @param recordPlace - Place from one side.
 * @param treePlace - Place from the other side.
 * @returns The highlight and why.
 */
export function scorePlace(recordPlace: string = "", treePlace: string = ""): Scored {
  const a = placeParts(recordPlace);
  const b = placeParts(treePlace);
  if (a.length === 0 || b.length === 0) return { highlight: HighlightType.None };
  if (a.join(",") === b.join(",")) return { highlight: HighlightType.Green };
  if (isMoreSpecific(a, b)) return { highlight: HighlightType.Green, reason: sharedArea(a, b) };

  const countryA = a[a.length - 1];
  const countryB = b[b.length - 1];
  // A lone "Springfield" could be in any country, so it can't conflict with one
  const unknownA = a.length === 1 && !COUNTRIES.has(countryA);
  const unknownB = b.length === 1 && !COUNTRIES.has(countryB);
  if (unknownA || unknownB) return { highlight: HighlightType.Yellow, reason: "Different places" };
  if (countryA === countryB && (countryA === "united states" || countryA === "united kingdom")) {
    const ra = region(a);
    const rb = region(b);
    // "Louisiana, United States" has a state; "United States" alone doesn't
    if (a.length >= 2 && b.length >= 2 && ra.state !== rb.state) {
      return { highlight: HighlightType.Red, reason: countryA === "united states" ? "Different states" : "Different countries" };
    }
    if (ra.county && rb.county && ra.county === rb.county) {
      return { highlight: HighlightType.Yellow, reason: "Same county" };
    }
    return { highlight: HighlightType.Yellow, reason: countryA === "united states" ? "Same state" : "Same country" };
  }
  if (countryA === countryB) return { highlight: HighlightType.Yellow, reason: "Same country" };
  if (BORDER_GROUPS.some((group) => group.includes(countryA) && group.includes(countryB))) {
    return { highlight: HighlightType.Yellow, reason: "Border changed" };
  }
  return { highlight: HighlightType.Red, reason: "Different countries" };
}

/** A highlight with a short reason, for comparisons that can explain themselves. */
export interface Scored {
  highlight: HighlightType;
  reason?: string;
  /** The side the reason is about, like the one missing a given name; unset when it's about both. */
  side?: "record" | "tree";
}

/**
 * Finds the state and county in a place, which is written smallest to largest: town, county, state, country.
 * @param parts - The place's cleaned parts.
 * @returns The state (or country, outside the US) and the county, when present.
 */
function region(parts: string[]): { state?: string; county?: string } {
  const country = parts[parts.length - 1];
  const withoutCountry = country === "united states" || country === "united kingdom" ? parts.slice(0, -1) : parts;
  return { state: withoutCountry[withoutCountry.length - 1], county: withoutCountry[withoutCountry.length - 2] };
}

/**
 * Compares two residences at the county and state level. Residences are often written as census wards
 * or districts, and people move, so street-level detail isn't a useful match signal.
 * @param recordPlace - Residence from one side.
 * @param treePlace - Residence from the other side.
 * @param sameTime - Whether both residences are from the same year; a move between years isn't a conflict.
 * @returns The highlight and why.
 */
export function scoreResidence(recordPlace: string = "", treePlace: string = "", sameTime: boolean = true): Scored {
  const a = placeParts(recordPlace);
  const b = placeParts(treePlace);
  if (a.length === 0 || b.length === 0) return { highlight: HighlightType.None };
  if (a.join(",") === b.join(",")) return { highlight: HighlightType.Green };
  if (isMoreSpecific(a, b)) return { highlight: HighlightType.Green, reason: sharedArea(a, b) };

  // A lone "Springfield" has no state to compare
  if ((a.length === 1 && !COUNTRIES.has(a[0])) || (b.length === 1 && !COUNTRIES.has(b[0]))) {
    return sameTime ? { highlight: HighlightType.Yellow, reason: "Different places" } : { highlight: HighlightType.None };
  }
  const ra = region(a);
  const rb = region(b);
  if (ra.state && ra.state === rb.state) {
    // A county named on one side may be further down the other ("Manhattan, New York, New York"), but not as the state
    const localA = a.slice(0, a.lastIndexOf(ra.state));
    const localB = b.slice(0, b.lastIndexOf(rb.state));
    const county = ra.county && rb.county && ra.county === rb.county ? ra.county : localA.includes(rb.county ?? "") ? rb.county : localB.includes(ra.county ?? "") ? ra.county : undefined;
    if (county) return { highlight: HighlightType.Green, reason: `Both in ${titleCase(county)}, ${titleCase(ra.state)}` };
    if (!ra.county || !rb.county) return { highlight: HighlightType.Green, reason: `Both in ${titleCase(ra.state)}` };
    return sameTime
      ? { highlight: HighlightType.Yellow, reason: a[a.length - 1] === "united states" ? "Same state" : "Same country" }
      : { highlight: HighlightType.None };
  }
  // People move, so residences years apart that differ say nothing either way; at the same time they conflict
  return sameTime
    ? { highlight: HighlightType.Red, reason: "Different places" }
    : { highlight: HighlightType.None };
}

/** Very common given names of people born about 1850 to 1930 in the US. */
const COMMON_GIVEN = new Set([
  "john", "william", "james", "george", "charles", "joseph", "frank", "robert", "edward", "henry", "thomas", "harry",
  "walter", "arthur", "fred", "albert", "samuel", "louis", "david", "willie", "clarence", "roy", "paul", "harold",
  "raymond", "richard", "carl", "earl", "joe", "ernest", "howard", "sam", "jack", "morris", "michael", "peter", "max",
  "mary", "anna", "margaret", "helen", "elizabeth", "ruth", "dorothy", "marie", "florence", "mildred", "alice", "ethel",
  "lillian", "rose", "annie", "frances", "emma", "edna", "bertha", "clara", "grace", "sarah", "martha", "minnie",
  "ida", "bessie", "hazel", "gladys", "irene", "louise", "catherine", "julia", "esther", "jennie", "lena", "fannie",
]);

/** Very common US surnames of the period, plus ones frequent in big-city census data. */
const COMMON_SURNAMES = new Set([
  "smith", "johnson", "williams", "brown", "jones", "miller", "davis", "wilson", "anderson", "taylor", "thomas",
  "moore", "martin", "jackson", "thompson", "white", "harris", "clark", "lewis", "robinson", "walker", "hall", "young",
  "allen", "wright", "king", "scott", "green", "baker", "adams", "nelson", "hill", "campbell", "mitchell", "roberts",
  "carter", "phillips", "evans", "turner", "parker", "collins", "edwards", "stewart", "morris", "murphy", "cook",
  "rogers", "morgan", "cooper", "peterson", "reed", "bailey", "bell", "kelly", "howard", "ward", "cox", "wood",
  "watson", "brooks", "gray", "james", "hughes", "price", "myers", "long", "ross", "foster", "johnston", "kennedy",
  "sullivan", "murray", "ryan", "washington", "cohen", "levine", "levy", "schwartz", "greenberg", "friedman",
  "shapiro", "goldberg", "weiss", "rosen", "fisher", "meyer", "schmidt", "schneider", "wagner", "becker", "hoffman",
]);

/**
 * Checks whether a name is so common that a match on it alone proves little ("John Smith" in New York),
 * unless a middle name or initial on both sides narrows it down.
 * @param given - Given names.
 * @param surname - The family name to look up.
 * @returns True for common first-and-last-name pairs with no middle name.
 */
function isCommonName(given: string, surname: string): boolean {
  const parts = givenParts(given);
  return parts.length === 1 && COMMON_GIVEN.has(parts[0]) && COMMON_SURNAMES.has(surname.trim().toLowerCase());
}

/**
 * Daitch–Mokotoff Soundex rules, simplified to one code per rule: [letters, at the start, before a vowel, anywhere else].
 * "" means the letters add no sound. Built for Eastern European and Jewish surnames, which census takers spelled by ear.
 */
const DM_RULES: [string, string, string, string][] = [
  ["schtsch", "2", "4", "4"], ["schtsh", "2", "4", "4"], ["schtch", "2", "4", "4"], ["shtch", "2", "4", "4"],
  ["shtsh", "2", "4", "4"], ["shch", "2", "4", "4"], ["stsch", "2", "4", "4"], ["sztch", "2", "4", "4"],
  ["zdzh", "2", "4", "4"], ["zhdzh", "2", "4", "4"], ["ttsch", "4", "4", "4"], ["schd", "2", "43", "43"],
  ["scht", "2", "43", "43"], ["strz", "2", "4", "4"], ["strs", "2", "4", "4"], ["stch", "2", "4", "4"],
  ["stsh", "2", "4", "4"], ["szcz", "2", "4", "4"], ["szcs", "2", "4", "4"], ["tsch", "4", "4", "4"],
  ["ttch", "4", "4", "4"], ["ttsz", "4", "4", "4"], ["zsch", "4", "4", "4"], ["chs", "5", "54", "54"],
  ["csz", "4", "4", "4"], ["czs", "4", "4", "4"], ["drz", "4", "4", "4"], ["drs", "4", "4", "4"],
  ["dsh", "4", "4", "4"], ["dsz", "4", "4", "4"], ["dzh", "4", "4", "4"], ["dzs", "4", "4", "4"],
  ["sch", "4", "4", "4"], ["sht", "2", "43", "43"], ["szt", "2", "43", "43"], ["shd", "2", "43", "43"],
  ["szd", "2", "43", "43"], ["tch", "4", "4", "4"], ["trz", "4", "4", "4"], ["trs", "4", "4", "4"],
  ["tsh", "4", "4", "4"], ["tts", "4", "4", "4"], ["ttz", "4", "4", "4"], ["tzs", "4", "4", "4"],
  ["tsz", "4", "4", "4"], ["zdz", "2", "4", "4"], ["zhd", "2", "43", "43"], ["zsh", "4", "4", "4"],
  ["ai", "0", "1", ""], ["aj", "0", "1", ""], ["ay", "0", "1", ""], ["au", "0", "7", ""], ["ch", "5", "5", "5"],
  ["ck", "5", "5", "5"], ["cz", "4", "4", "4"], ["cs", "4", "4", "4"], ["ds", "4", "4", "4"], ["dz", "4", "4", "4"],
  ["dt", "3", "3", "3"], ["ei", "0", "1", ""], ["ej", "0", "1", ""], ["ey", "0", "1", ""], ["eu", "1", "1", ""],
  ["fb", "7", "7", "7"], ["ia", "1", "", ""], ["ie", "1", "", ""], ["io", "1", "", ""], ["iu", "1", "", ""],
  ["ks", "5", "54", "54"], ["kh", "5", "5", "5"], ["mn", "66", "66", "66"], ["nm", "66", "66", "66"],
  ["oi", "0", "1", ""], ["oj", "0", "1", ""], ["oy", "0", "1", ""], ["pf", "7", "7", "7"], ["ph", "7", "7", "7"],
  ["rz", "94", "94", "94"], ["rs", "94", "94", "94"], ["sh", "4", "4", "4"], ["st", "2", "43", "43"],
  ["sc", "2", "4", "4"], ["sz", "4", "4", "4"], ["sd", "2", "43", "43"], ["th", "3", "3", "3"], ["ts", "4", "4", "4"],
  ["tc", "4", "4", "4"], ["tz", "4", "4", "4"], ["ui", "0", "1", ""], ["uj", "0", "1", ""], ["uy", "0", "1", ""],
  ["ue", "0", "", ""], ["zh", "4", "4", "4"], ["zs", "4", "4", "4"], ["zd", "2", "43", "43"],
  ["a", "0", "", ""], ["b", "7", "7", "7"], ["c", "5", "5", "5"], ["d", "3", "3", "3"], ["e", "0", "", ""],
  ["f", "7", "7", "7"], ["g", "5", "5", "5"], ["h", "5", "5", ""], ["i", "0", "", ""], ["j", "1", "1", "1"],
  ["k", "5", "5", "5"], ["l", "8", "8", "8"], ["m", "6", "6", "6"], ["n", "6", "6", "6"], ["o", "0", "", ""],
  ["p", "7", "7", "7"], ["q", "5", "5", "5"], ["r", "9", "9", "9"], ["s", "4", "4", "4"], ["t", "3", "3", "3"],
  ["u", "0", "", ""], ["v", "7", "7", "7"], ["w", "7", "7", "7"], ["x", "5", "54", "54"], ["y", "1", "", ""],
  ["z", "4", "4", "4"],
];

/**
 * Codes a surname by how it sounds, so "Lio" and "Leo" or "Silberstein" and "Silverstein" get the same code.
 * @param name - A surname.
 * @returns A six-digit sound code, or "" when the name has no consonants.
 */
export function soundCode(name: string): string {
  const letters = name.toLowerCase().normalize("NFD").replace(/[^a-z]/g, "");
  let code = "";
  let last = "";
  let i = 0;
  while (i < letters.length && code.length < 6) {
    const rule = DM_RULES.find(([pattern]) => letters.startsWith(pattern, i)) ?? [letters[i], "", "", ""];
    const next = letters[i + rule[0].length] ?? "";
    const digits = i === 0 ? rule[1] : "aeiou".includes(next) && next ? rule[2] : rule[3];
    // A sound repeated by neighboring letters ("ll", "sz s") counts once
    if (digits && digits !== last) code += digits;
    last = digits || last;
    i += rule[0].length;
  }
  // Names of only vowels ("Ai", "Eo") have no sounds to compare
  return /[1-9]/.test(code) ? code.padEnd(6, "0").slice(0, 6) : "";
}

/** Surname similarity at which two spellings count as the same surname. */
const SAME_SURNAME_SCORE = 80;

/** Common short forms and spellings of given names, each listed with the forms it matches. */
const NICKNAMES: string[][] = [
  ["william", "bill", "billy", "will", "willie", "wm"],
  ["robert", "bob", "bobby", "rob", "bert"],
  ["james", "jim", "jimmy", "jas", "jamie"],
  ["john", "jack", "johnny", "jno", "giovanni", "johann", "juan", "jean"],
  ["joseph", "joe", "jos", "giuseppe", "jose", "josef"],
  ["charles", "charlie", "chas", "chuck", "carl", "karl", "carlo", "carlos"],
  ["thomas", "tom", "tommy", "thos"],
  ["richard", "dick", "rick", "rich"],
  ["edward", "ed", "eddie", "ned", "ted", "edw"],
  ["henry", "harry", "hank", "heinrich", "enrico"],
  ["francis", "frank", "francesco", "franz", "francisco", "fran"],
  ["frances", "fannie", "fanny", "francesca", "frankie"],
  ["anthony", "tony", "antonio", "anton"],
  ["samuel", "sam", "sammy", "salvatore"],
  ["michael", "mike", "mick", "michele", "miguel"],
  ["margaret", "maggie", "peggy", "meg", "margie", "marguerite", "margarethe"],
  ["elizabeth", "liz", "lizzie", "beth", "betty", "bessie", "eliza", "elisabeth", "elsie"],
  ["mary", "polly", "mae", "may", "mamie", "maria", "marie", "mollie", "molly"],
  ["catherine", "katherine", "kate", "katie", "kitty", "cathy", "katharina", "caterina"],
  ["sarah", "sally", "sadie", "sara"],
  ["ann", "anna", "anne", "annie", "nancy", "hannah"],
  ["helen", "nellie", "ellen", "elena", "helena"],
  ["dorothy", "dot", "dottie", "dora"],
  ["alexander", "alex", "sandy", "alessandro"],
  ["frederick", "fred", "freddie", "fritz", "federico"],
  ["louis", "lou", "louie", "luigi", "ludwig", "lewis"],
  ["peter", "pete", "pietro", "pedro"],
  ["isaac", "ike"], ["abraham", "abe"], ["jacob", "jake"], ["nathaniel", "nat"],
  ["theodore", "ted", "teddy"], ["lawrence", "larry", "laurence"], ["harold", "hal"],
  ["albert", "al", "bert"], ["benjamin", "ben", "benny"], ["patrick", "pat", "paddy"],
  ["daniel", "dan", "danny"], ["david", "dave"], ["george", "geo", "giorgio", "jorge"],
  ["johanna", "joanna", "joan", "jennie"], ["jane", "jennie", "jenny", "janie", "jean"], ["lucinda", "lula", "cindy", "lucy"], ["louisa", "lula", "lou", "louise"], ["emma", "emmy"], ["minnie", "wilhelmina", "mina"],
];

/**
 * Splits a given name into lowercase parts, e.g. "Roy W." to ["roy", "w"].
 * @param name - The given names.
 * @returns The parts, without punctuation.
 */
function givenParts(name: string): string[] {
  return name.toLowerCase().replace(/[.,]/g, " ").split(/\s+/).filter(Boolean);
}

/**
 * Checks whether two given names are the same name: equal, one a short form of the other
 * (Sam and Samuel), a known nickname or translation (Frank and Francesco), or very close in spelling.
 * @param a - One given name.
 * @param b - The other.
 * @returns True if they name the same person.
 */
function sameGivenName(a: string, b: string): boolean {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length >= 3 && long.startsWith(short)) return true;
  if (NICKNAMES.some((group) => group.includes(a) && group.includes(b))) return true;
  return getNameComparisonConfidence(a, b) >= 90;
}

/**
 * Checks whether two middle-name lists agree: missing, an initial of the other ("W" and "Ward"), or the same.
 * @param a - Middle names on one side.
 * @param b - Middle names on the other.
 * @returns True unless they clearly name different middle names.
 */
function middlesAgree(a: string[], b: string[]): boolean {
  if (a.length === 0 || b.length === 0) return true;
  return a.some((x) => b.some((y) => x === y || (x.length === 1 && y.startsWith(x)) || (y.length === 1 && x.startsWith(y)) || sameGivenName(x, y)));
}

/**
 * Compares two names part by part: first given name, middle names and surname. Census and tree names
 * often differ by an initial, a nickname, an anglicized spelling or, for women, a married surname.
 * @param recordFirst - Given names on one side.
 * @param recordLast - Surname on one side.
 * @param treeFirst - Given names on the other side.
 * @param treeLast - Surname on the other side.
 * @param gender - The person's gender, if known.
 * @returns The highlight and why.
 */
export function scoreName(
  recordFirst: string = "",
  recordLast: string = "",
  treeFirst: string = "",
  treeLast: string = "",
  gender: string = ""
): Scored {
  const recordName = `${recordFirst} ${recordLast}`.trim();
  const treeName = `${treeFirst} ${treeLast}`.trim();
  if (isBlank(recordName) || isBlank(treeName)) return { highlight: HighlightType.None };
  // A plain, very common name matching on both sides is weak evidence on its own
  if (isCommonName(recordFirst, recordLast) && isCommonName(treeFirst, treeLast)
    && givenParts(recordFirst)[0] === givenParts(treeFirst)[0] && recordLast.trim().toLowerCase() === treeLast.trim().toLowerCase()) {
    return { highlight: HighlightType.Yellow, reason: "Common name" };
  }
  if (recordName.toLowerCase().replace(/[.]/g, "") === treeName.toLowerCase().replace(/[.]/g, "")) {
    return { highlight: HighlightType.Green };
  }

  const [firstA, ...middleA] = givenParts(recordFirst);
  const [firstB, ...middleB] = givenParts(treeFirst);
  const firstSame = Boolean(firstA && firstB) && sameGivenName(firstA, firstB);
  // A lone initial can only agree, not prove a match
  const firstInitial = Boolean(firstA && firstB) && (firstA.length === 1 || firstB.length === 1) && firstA[0] === firstB[0];
  const middleSame = middlesAgree(middleA, middleB);

  const surnameScore = isBlank(recordLast) || isBlank(treeLast) ? 100 : getNameComparisonConfidence(recordLast, treeLast);
  // Very close spellings ("Silberstein" and "Silverstein") are the same surname written differently
  const surnameSame = surnameScore >= SAME_SURNAME_SCORE;
  // Surnames that sound alike ("Lio" and "Leo") are close even when the spelling score is low
  const soundsAlike = !isBlank(recordLast) && !isBlank(treeLast) && soundCode(recordLast) !== "" && soundCode(recordLast) === soundCode(treeLast);
  const surnameClose = surnameScore >= 60 || soundsAlike;
  const female = gender.toLowerCase() === "female";

  if (firstSame || firstInitial) {
    // A matching first name with no surname on one side can't confirm the person
    if (isBlank(recordLast) !== isBlank(treeLast)) {
      return { highlight: HighlightType.Yellow, reason: "Surname missing", side: isBlank(recordLast) ? "record" : "tree" };
    }
    if (surnameSame) {
      if (!middleSame) return { highlight: HighlightType.Yellow, reason: "Different middle name" };
      if (firstInitial) return { highlight: HighlightType.Yellow, reason: "Only an initial" };
      return firstA !== firstB || recordLast.toLowerCase() !== treeLast.toLowerCase()
        ? { highlight: HighlightType.Green, reason: "Same name, written differently" }
        : { highlight: HighlightType.Green };
    }
    if (surnameClose) return { highlight: HighlightType.Yellow, reason: surnameScore >= 60 ? "Similar spelling" : "Sounds alike" };
    if (female) return { highlight: HighlightType.Yellow, reason: "Maybe a married name" };
    return { highlight: HighlightType.Red, reason: "Different surnames" };
  }

  // One side has no given name, so only the surname can be compared
  if (!firstA || !firstB) {
    return surnameClose
      ? { highlight: HighlightType.Yellow, reason: "Given name missing", side: firstA ? "tree" : "record" }
      : { highlight: HighlightType.Red, reason: "Different surnames" };
  }

  // People often go by a middle name: "Harlan Hotchkiss" and "Robert Harlan Hotchkiss"
  const allA = [firstA, ...middleA];
  const allB = [firstB, ...middleB];
  const goesByMiddle = allA.some((x) => x.length > 1 && allB.some((y) => y.length > 1 && sameGivenName(x, y)));
  if (goesByMiddle && (surnameClose || female)) return { highlight: HighlightType.Yellow, reason: "Possibly goes by middle name" };

  const firstScore = getNameComparisonConfidence(firstA, firstB);
  if (firstScore >= 60 && (surnameClose || female)) return { highlight: HighlightType.Yellow, reason: "Similar names" };
  // Never stricter than the name comparator on the whole name
  if (getNameComparisonConfidence(recordName, treeName) >= 60) return { highlight: HighlightType.Yellow, reason: "Similar names" };
  return { highlight: HighlightType.Red, reason: "Different names" };
}

/**
 * Parses a date string into a FlexibleDate, if valid.
 * @param value - Date string to parse.
 * @returns Parsed FlexibleDate, or undefined if invalid.
 */
function parseFlexibleDate(value: string): FlexibleDate | undefined {
  try {
    const parsed = new FlexibleDate(value);
    return parsed.valueOf() ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Determines the highlight color for a record vs tree date pair.
 * @param recordDate - Date string from the record candidate.
 * @param treeDate - Date string from the tree candidate.
 * @returns Green, yellow, or red highlight type.
 */
export function getDateHighlight(recordDate: string, treeDate: string): HighlightType {
  const recordFlexible = parseFlexibleDate(recordDate);
  const treeFlexible = parseFlexibleDate(treeDate);
  if (!recordFlexible || !treeFlexible) {
    return HighlightType.None;
  }
  if (recordFlexible.likelyYear !== treeFlexible.likelyYear){
    // Small gaps are common (estimated ages, census rounding); large gaps point to a different person
    const gap = recordFlexible.likelyYear != null && treeFlexible.likelyYear != null
      ? Math.abs(recordFlexible.likelyYear - treeFlexible.likelyYear) : undefined;
    if (gap !== undefined && gap > MAX_YELLOW_YEAR_GAP) return HighlightType.Red;
    // Even a year off is worth a look, though census ages often are
    return HighlightType.Yellow;
  }
  // Same year, different day or month: worth a look, never a conflict
  const sameYear = highlightFromScore(recordFlexible.compareDates(treeFlexible), recordDate, treeDate);
  return sameYear === HighlightType.Red ? HighlightType.Yellow : sameYear;
}

/**
 * Maps a highlight type to its CSS class name.
 * @param highlightType - Green, yellow, or red highlight type.
 * @returns CSS class for the match table highlight styling.
 */
export function highlightClass(highlightType: HighlightType): string {
  switch (highlightType) {
    case HighlightType.None:
      return "data-has-no-comparison";
    case HighlightType.Green:
      return "data-matches";
    case HighlightType.Yellow:
      return "data-almost-matches";
    case HighlightType.Red:
      return "data-not-matches";
    default:
      return "";
  }
}