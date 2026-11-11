import FlexibleDate from "flexibledatets";
import { CHILE } from "./region";
import { CHILE_COMMUNE_REGION } from "./chileCommunes";
// Only the lab name comparator's list of name variants is used; its pronunciation and frequency data, with the
// libraries it needs, were most of the app's download
import nameVariants from "namecomparator-ts/dist/data/nicknames/nameVariants.json";
import { HighlightType } from "../Models/HighlightType";
import { fixLabVariants, nameSex, NICKNAMES } from "./nicknames";

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

/** Each name in the lab's variant lists and the app's own (Tim and Timothy, Abe and Abraham), with the lists it's in. */
let variantGroups: Map<string, number[]> | undefined;

/**
 * Gets the variant lists by name, building them the first time.
 * @returns Each name with the numbers of the lists it's in.
 */
function variantsByName(): Map<string, number[]> {
  if (variantGroups) return variantGroups;
  const groups = [...fixLabVariants(Object.values(nameVariants as Record<string, string[]>)), ...NICKNAMES];
  variantGroups = new Map();
  groups.forEach((names, group) => {
    for (const name of names) variantGroups!.set(name, [...(variantGroups!.get(name) ?? []), group]);
  });
  return variantGroups;
}

/** Spelling score at which a man's and a woman's name could be one name misspelled: Francis and Frances. */
const NEAR_SPELLING = 85;

/**
 * Endings that make a woman's name of a man's, for names the lists don't know: Robert and Roberta, Gerald and
 * Geraldine. Not "e" or "ie", which also end men's names and their misspellings (Wille for Willie).
 */
const FEMININE_ENDING = /^(a|ina|ine|ette|etta|elle)$/;

/**
 * Checks whether two given names are a man's and a woman's: Louis and Louise, John and Jane. Names used for both,
 * like Jean, Marion or Pat, never count, and a name the lists don't know counts only as a man's name with a
 * woman's ending (Roberta).
 * @param a - One name, lowercase.
 * @param b - The other.
 * @returns True when one is a man's name and the other a woman's.
 */
export function differentSex(a: string, b: string): boolean {
  [a, b] = [a, b].map((name) => nameWords(name).join(""));
  const sa = nameSex(a);
  const sb = nameSex(b);
  if (sa && sb) return sa !== sb;
  /**
   * Checks whether a name is a man's with a woman's ending added: Robert and Roberta.
   * @param man - The shorter name.
   * @param other - The longer one.
   * @returns True when it is.
   */
  const feminine = (man: string, other: string) => nameSex(man) === "male" && nameSex(other) === undefined
    && other.startsWith(man) && FEMININE_ENDING.test(other.slice(man.length));
  /**
   * Checks whether two names are a Spanish man's and woman's pair, differing only in the last letter: Francisco and
   * Francisca, Mario and María, Julio and Julia.
   * @param man - A name ending in "o".
   * @param other - The other name.
   * @returns True for such a pair.
   */
  const spanishPair = (man: string, other: string) => man.length >= 4 && man.endsWith("o") && other === `${man.slice(0, -1)}a`;
  // Only on the Chilean site: elsewhere it would split Italian surnames like Romano and Romana
  return feminine(a, b) || feminine(b, a) || (CHILE && (spanishPair(a, b) || spanishPair(b, a)));
}

/** Score for two words that are the same in Spanish speech, only spelled differently: Gonzales and González. */
const SPANISH_SPELLING_SCORE = 92;

/**
 * Writes a word as it sounds in Spanish, so spellings of one sound come out the same: a silent h dropped, v as b,
 * z and soft c as s, ll as y, soft g and x as j, qu and hard c as k, and doubled letters once. Henríquez and
 * Enrriques both become "enrikes".
 * @param word - One word of a name, lowercase, without accents.
 * @returns How it sounds.
 */
export function spanishSound(word: string): string {
  return word
    .replace(/ch/g, "#").replace(/^h/, "").replace(/h/g, "")
    .replace(/qu/g, "k").replace(/c([eiy])/g, "s$1").replace(/c/g, "k").replace(/z/g, "s")
    .replace(/v/g, "b").replace(/w/g, "gu").replace(/ll/g, "y").replace(/g([ei])/g, "j$1").replace(/x/g, "j")
    .replace(/^y([^aeiou])/, "i$1").replace(/y$/, "i")
    .replace(/(.)\1+/g, "$1").replace(/#/g, "ch");
}

/** Score for two words that sound alike by their sound codes but are spelled further apart. */
const SOUNDS_ALIKE_SCORE = 80;

/** Letters that don't split into a plain letter and an accent. */
const PLAIN_LETTERS: Record<string, string> = { "ı": "i", "ł": "l", "ø": "o", "ß": "ss", "æ": "ae", "œ": "oe", "đ": "d" };

/**
 * Splits a name into plain lowercase words: accents and apostrophes dropped ("O'Keefe" is "okeefe"), and
 * hyphens and other marks between words.
 * @param name - The name as written.
 * @returns Its words.
 */
function nameWords(name: string): string[] {
  return name.toLowerCase().replace(/[ıłøßæœđ]/g, (letter) => PLAIN_LETTERS[letter]).normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").replace(/['\u2019\u2018`]/g, "").replace(/[^a-z]+/g, " ").split(" ").filter(Boolean);
}

/**
 * Scores how much of two words' spelling they share, in order: twice the longest common subsequence over
 * their total length, so "isidore" and "isadore" score 86.
 * @param a - One word.
 * @param b - The other.
 * @returns 0 to 100.
 */
function spellingRatio(a: string, b: string): number {
  if (!a.length || !b.length) return 0;
  let previous = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const row = [0];
    for (let j = 1; j <= b.length; j++) {
      row[j] = a[i - 1] === b[j - 1] ? previous[j - 1] + 1 : Math.max(previous[j], row[j - 1]);
    }
    previous = row;
  }
  return (200 * previous[b.length]) / (a.length + b.length);
}

/**
 * Reduces a word to its consonants, with each run of vowels as one "*": "silberstein" to "s*lb*rst*n".
 * Census takers wrote vowels by ear, so names often differ only there.
 * @param word - One word of a name.
 * @returns Its consonant outline.
 */
function consonantOutline(word: string): string {
  return word.replace(/[aeiouy]+/g, "*").replace(/(.)\1+/g, "$1");
}

/**
 * Scores two words of a name: the same or known variants of each other (Abe and Abraham) score 100, an
 * initial that fits 80, and otherwise their spelling and consonants, raised for names that sound alike.
 * @param a - A word from one name.
 * @param b - A word from the other.
 * @returns 0 to 100.
 */
function wordSimilarity(a: string, b: string): number {
  if (a === b) return 100;
  // A man's and a woman's name are never variants of each other; only a near spelling (Francis and Frances) is close
  if (differentSex(a, b)) {
    const spelling = spellingRatio(a, b);
    return spelling >= NEAR_SPELLING ? spelling : Math.min(spelling, 40);
  }
  const groups = variantsByName().get(a);
  if (groups && variantsByName().get(b)?.some((group) => groups.includes(group))) return 100;
  if (a.length === 1 || b.length === 1) return a[0] === b[0] ? 80 : 0;
  // In Chile, letters that sound the same were written either way: González and Gonzales, Vargas and Bargas
  if (CHILE && spanishSound(a) === spanishSound(b)) return SPANISH_SPELLING_SCORE;
  const score = 0.6 * spellingRatio(a, b) + 0.4 * spellingRatio(consonantOutline(a), consonantOutline(b));
  const sound = soundCode(a);
  return sound && sound === soundCode(b) ? Math.max(score, SOUNDS_ALIKE_SCORE) : score;
}

/**
 * Compares two names and returns a confidence score. Each word is paired with its best match in the other
 * name, and a name is only as close as its weakest pair: Meyer and Ralph Abramowitz share a surname but not a
 * given name. Extra words, like a middle name only one side has, don't count against it. A name written as
 * one word on one side is also compared joined up, so "Von Stein" can match "Fonstein".
 * @param nameOne - First name to compare.
 * @param nameTwo - Second name to compare.
 * @returns Confidence score from 0 to 100, or 0 when either is blank.
 */
function getNameComparisonConfidence(nameOne: string, nameTwo: string): number {
  const one = nameWords(nameOne);
  const two = nameWords(nameTwo);
  if (one.length === 0 || two.length === 0) return 0;
  const pairs = one.flatMap((a, i) => two.map((b, j) => ({ i, j, score: wordSimilarity(a, b) })))
    .sort((x, y) => y.score - x.score);
  const usedOne = new Set<number>();
  const usedTwo = new Set<number>();
  let weakest = 100;
  for (const { i, j, score } of pairs) {
    if (usedOne.has(i) || usedTwo.has(j)) continue;
    usedOne.add(i);
    usedTwo.add(j);
    weakest = Math.min(weakest, score);
  }
  const joined = one.length !== two.length && Math.min(one.length, two.length) === 1
    ? wordSimilarity(one.join(""), two.join(""))
    : 0;
  return Math.max(weakest, joined);
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
  "czechia": "czechoslovakia",
  "türkiye": "turkey",
  "turkiye": "turkey",
  "irish free state": "ireland",
  "eire": "ireland",
  "éire": "ireland",
  "republic of ireland": "ireland",
  "british north america": "canada",
  "dominion of canada": "canada",
  "kingdom of the two sicilies": "italy",
  "two sicilies": "italy",
  // The Republic of Texas became the state, so "Austin, Republic of Texas" is in Texas
  "republic of texas": "texas",
  // FamilySearch's name for the colonies before 1776, which it sometimes gives births long after
  "british colonial america": "united states",
};

/**
 * Countries whose borders moved around this period, so someone's birthplace can be written as either:
 * a person born in Warsaw in 1890 was born in the Russian Empire and in Poland.
 */
const BORDER_GROUPS: string[][] = [
  // Galicia was Austrian, but many who left it gave Russia or Poland, as the border moved over their lives
  ["russia", "poland", "lithuania", "latvia", "estonia", "finland", "ukraine", "belarus", "bessarabia", "romania", "galicia"],
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
  // In Chile accents are often left off (Concepción, Concepcion), and regions written several ways
  if (CHILE) place = place.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/['\u2019]/g, "");
  const parts = place
    .toLowerCase()
    .replace(/[.]/g, "")
    .replace(/\([^)]*\)/g, "")
    .split(",")
    .map((part) => part.trim())
    // "Lucas County" and "Lucas" are the same county
    .map((part) => part.replace(/\s+(county|co|parish)$/, ""))
    // Census wards, districts and precincts name a part of town, not a different place
    .filter((part) => /\p{L}/u.test(part) && !CENSUS_SUBDIVISION.test(part))
    // "Massachusetts Bay Colony" and "Connecticut Colony" are the states
    .map((part) => part.replace(/(\s+bay)?\s+colony$/, ""))
    .map(withoutTownSuffix)
    .map((part) => (CHILE ? chileRegionName(part) : part))
    .map((part) => PLACE_ALIASES[part] ?? part);
  const last = parts[parts.length - 1] ?? "";
  // "Talca, Maule" and a lone "Curicó" are in Chile even when the country isn't written
  if (CHILE && last !== "chile" && (CHILE_REGION_OF[last] || CHILE_COMMUNE_REGION[last]) && !COUNTRIES.has(last)) return [...parts, "chile"];
  // "Buffalo, New York" is in the United States even when the country isn't written, and "Glasgow, Scotland" in the United Kingdom
  if (US_STATES.has(last)) return [...parts, "united states"];
  if (UK_NATIONS.has(last)) return [...parts, "united kingdom"];
  return parts;
}

/**
 * Writes a Chilean region one way: "Región del Maule" and "Maule" are "maule", "Región Metropolitana de Santiago" is
 * "metropolitana", "Bío-Bío" is "biobio". Only whole region names change; a commune or province named like a region
 * (Santiago, Valparaíso) stays as it is.
 * @param part - One cleaned place part, without accents.
 * @returns The part, with a region in its one spelling.
 */
function chileRegionName(part: string): string {
  const bare = part.replace(/^(xv|xiv|xiii|xii|xi|x|ix|viii|vii|vi|v|iv|iii|ii|i|\d+)\s+region\s+/, "")
    .replace(/^region\s+(de\s+la\s+|de\s+los\s+|del\s+|de\s+)?/, "").replace(/-/g, " ");
  return CHILE_REGION_SPELLINGS[bare] ?? (bare !== part ? bare : part);
}

/** Region names written more than one way, in their one spelling. */
const CHILE_REGION_SPELLINGS: Record<string, string> = {
  "metropolitana de santiago": "metropolitana", "santiago metropolitan": "metropolitana", "rm": "metropolitana",
  "bio bio": "biobio", "bio-bio": "biobio", "del biobio": "biobio",
  "libertador general bernardo ohiggins": "ohiggins", "libertador bernardo ohiggins": "ohiggins", "o higgins": "ohiggins",
  "la araucania": "araucania", "aysen del general carlos ibanez del campo": "aysen", "aisen": "aysen",
  "aisen del general carlos ibanez del campo": "aysen", "magallanes y de la antartica chilena": "magallanes",
  "magallanes y antartica chilena": "magallanes", "republica de chile": "chile",
};

/**
 * The region each Chilean region, and each province of the old (before 1974) and new maps, is in. Records name the
 * old provinces (Ñuble, Cautín, Colchagua), the tree the regions of today.
 */
const CHILE_REGION_OF: Record<string, string> = Object.fromEntries(Object.entries({
  "arica y parinacota": ["arica y parinacota", "arica", "parinacota"],
  tarapaca: ["tarapaca", "iquique", "tamarugal"],
  antofagasta: ["antofagasta", "tocopilla", "el loa", "loa"],
  atacama: ["atacama", "copiapo", "chanaral", "huasco"],
  coquimbo: ["coquimbo", "elqui", "limari", "choapa"],
  valparaiso: ["valparaiso", "aconcagua", "los andes", "san felipe de aconcagua", "quillota", "petorca", "san antonio", "marga marga", "isla de pascua"],
  metropolitana: ["metropolitana", "santiago", "cordillera", "chacabuco", "maipo", "talagante", "melipilla"],
  ohiggins: ["ohiggins", "cachapoal", "colchagua", "cardenal caro"],
  maule: ["maule", "talca", "curico", "linares", "cauquenes"],
  nuble: ["nuble", "diguillin", "itata", "punilla"],
  biobio: ["biobio", "concepcion", "arauco"],
  araucania: ["araucania", "cautin", "malleco"],
  "los rios": ["los rios", "valdivia", "ranco"],
  "los lagos": ["los lagos", "llanquihue", "osorno", "chiloe", "palena"],
  aysen: ["aysen", "coyhaique", "capitan prat", "general carrera"],
  magallanes: ["magallanes", "ultima esperanza", "tierra del fuego", "antartica chilena"],
}).flatMap(([region, names]) => names.map((name) => [name, region])));

/** How each region is written for people. */
const CHILE_REGION_DISPLAY: Record<string, string> = {
  "arica y parinacota": "Arica y Parinacota", tarapaca: "Tarapacá", antofagasta: "Antofagasta", atacama: "Atacama",
  coquimbo: "Coquimbo", valparaiso: "Valparaíso", metropolitana: "Región Metropolitana", ohiggins: "O’Higgins",
  maule: "Maule", nuble: "Ñuble", biobio: "Biobío", araucania: "La Araucanía", "los rios": "Los Ríos",
  "los lagos": "Los Lagos", aysen: "Aysén", magallanes: "Magallanes",
};

/**
 * Regions made from part of another in living memory: Ñuble from Biobío (2018), Los Ríos from Los Lagos and Arica y
 * Parinacota from Tarapacá (2007). The same town can be written in either.
 */
const CHILE_SPLIT_REGIONS = [["nuble", "biobio"], ["los rios", "los lagos"], ["arica y parinacota", "tarapaca"]];

/**
 * Finds a Chilean place's region and commune: the region from the largest part that names one, the commune from
 * the smallest part when there's more than a region.
 * @param parts - The place's cleaned parts, ending in "chile".
 * @returns The region and commune, when the place names them.
 */
function chilePlace(parts: string[]): { region?: string; commune?: string } {
  const inside = parts.slice(0, -1);
  let region: string | undefined;
  for (let i = inside.length - 1; i >= 0 && !region; i--) region = CHILE_REGION_OF[inside[i]];
  // A place naming only a commune ("Curicó, Chile") is in the commune's region
  for (let i = 0; i < inside.length && !region; i++) region = CHILE_COMMUNE_REGION[inside[i].replace(/-/g, " ")];
  // A lone part is a commune unless it names a region: "Curicó, Chile" is the commune, "Maule, Chile" the region
  const commune = inside.length >= 2 || (inside.length === 1 && !CHILE_REGION_DISPLAY[inside[0]]) ? inside[0] : undefined;
  return { region, commune };
}

/**
 * Compares two places in Chile that aren't the same and where neither only adds detail to the other: a different
 * region is a conflict, unless the region was split from the other; a different commune in one region is worth a
 * look, at the same time.
 * @param a - Parts of one place, ending in "chile".
 * @param b - Parts of the other.
 * @param sameTime - Whether both are from the same time; a move between years isn't a conflict.
 * @returns The highlight and why.
 */
function scoreChilePlace(a: string[], b: string[], sameTime: boolean): Scored {
  const pa = chilePlace(a);
  const pb = chilePlace(b);
  if (pa.region && pb.region && pa.region !== pb.region) {
    if (CHILE_SPLIT_REGIONS.some((pair) => pair.includes(pa.region!) && pair.includes(pb.region!))) {
      return { highlight: HighlightType.Yellow, reason: "Border changed" };
    }
    return sameTime ? { highlight: HighlightType.Red, reason: "Different regions" } : { highlight: HighlightType.None };
  }
  const region = pa.region ?? pb.region;
  if (pa.commune && pb.commune && pa.commune !== pb.commune) {
    if (!sameTime) return { highlight: HighlightType.None };
    return { highlight: HighlightType.Yellow, reason: pa.region && pb.region ? "Same region" : "Different places" };
  }
  return region ? { highlight: HighlightType.Green, reason: `Both in ${CHILE_REGION_DISPLAY[region]}` } : { highlight: HighlightType.Yellow, reason: "Same country" };
}

/** Names whose "City" is part of the name, not a census label: Salt Lake City isn't Salt Lake County. */
const CITY_NAMES = new Set(["salt lake"]);

/**
 * Census labels for a town, written out or shortened as census takers did: "Salem Twp", "Media Boro", "Fort
 * Plain Vil", and Maine's plantations.
 */
export const TOWN_LABEL = "city|town|township|twp|twsp|twnshp|tshp|tp|borough|boro|bor|village|vill|vil|vlg|plantation|plt";
const LABEL_FIRST = new RegExp(`^(${TOWN_LABEL})\\s+of\\s+(.+)$`);
const LABEL_LAST = new RegExp(`\\s+(${TOWN_LABEL})$`);

/**
 * Drops a census label from a town, so "Toledo City", "Medford Township", "Salem Twp", "Town of Salem" and
 * "Middleport Borough" match "Toledo", "Medford", "Salem" and "Middleport". "New York City" and "Kansas City"
 * keep it, or they'd become states.
 * @param part - One cleaned place part.
 * @returns The part without its label.
 */
export function withoutTownSuffix(part: string): string {
  // "Town of Salem" is "Salem Town"
  const labelLast = part.replace(LABEL_FIRST, "$2 $1");
  const bare = labelLast.replace(LABEL_LAST, "");
  return bare !== labelLast && /city$/.test(labelLast) && (US_STATES.has(bare) || CITY_NAMES.has(bare)) ? labelLast : bare;
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
  const shorter = all.filter((part) => part !== "united states" && part !== "united kingdom" && !(CHILE && part === "chile"));
  if (CHILE && shorter.length === 0) return "Both in Chile";
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
  if (CHILE && countryA === "chile" && countryB === "chile") return scoreChilePlace(a, b, true);
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

  if (CHILE && a[a.length - 1] === "chile" && b[b.length - 1] === "chile") return scoreChilePlace(a, b, sameTime);
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
  if (CHILE) {
    // Both surnames together narrow it down; one alone doesn't
    const { own } = chileSurname(surname);
    return parts.length === 1 && COMMON_GIVEN_CL.has(nameWords(parts[0]).join("")) && own.length === 1 && COMMON_SURNAMES_CL.has(own[0]);
  }
  return parts.length === 1 && COMMON_GIVEN.has(parts[0]) && COMMON_SURNAMES.has(surname.trim().toLowerCase());
}

/** Very common given names in Chile's records, without accents. */
const COMMON_GIVEN_CL = new Set([
  "juan", "jose", "luis", "carlos", "manuel", "pedro", "francisco", "jorge", "mario", "sergio", "segundo", "miguel",
  "antonio", "pablo", "hector", "raul", "ramon", "victor", "domingo", "alberto",
  "maria", "rosa", "ana", "carmen", "juana", "teresa", "luisa", "elena", "margarita", "laura", "mercedes", "olga",
]);

/** Common Spanish surnames of Mexico and the US Southwest, beyond Chile's, without accents. */
const SPANISH_SURNAMES = new Set([
  "garcia", "hernandez", "martinez", "lopez", "gonzalez", "rodriguez", "perez", "sanchez", "ramirez", "torres",
  "flores", "rivera", "gomez", "diaz", "cruz", "morales", "reyes", "gutierrez", "ortiz", "chavez", "ruiz", "jimenez",
  "mendoza", "alvarez", "castillo", "romero", "moreno", "vasquez", "vazquez", "herrera", "medina", "aguilar",
  "vargas", "garza", "castro", "guzman", "salazar", "ramos", "delgado", "trevino", "villarreal", "cantu", "salinas",
  "padilla", "montoya", "baca", "lucero", "sandoval", "archuleta", "maestas", "trujillo", "gallegos", "chacon",
  "valdez", "dominguez", "espinoza", "soto", "contreras", "rojas", "silva", "munoz", "fuentes", "navarro", "luna",
  "acosta", "molina", "rios", "mejia", "estrada", "cortez", "cortes", "guerrero", "ochoa", "zamora", "zuniga",
]);

/**
 * Checks whether a surname looks Spanish, so Spanish naming rules apply to it outside Chile too: two surnames,
 * and spellings of one sound (Rodriquez and Rodríguez).
 * @param surname - A surname as written.
 * @returns True when one of its words is a common Spanish surname or ends in "ez".
 */
function looksSpanish(surname: string): boolean {
  return nameWords(surname).some((word) => SPANISH_SURNAMES.has(word) || COMMON_SURNAMES_CL.has(word) || (word.length >= 5 && word.endsWith("ez")));
}

/** The most common surnames in Chile, without accents. */
const COMMON_SURNAMES_CL = new Set([
  "gonzalez", "munoz", "rojas", "diaz", "perez", "soto", "contreras", "silva", "martinez", "sepulveda", "morales",
  "rodriguez", "lopez", "fuentes", "hernandez", "torres", "araya", "flores", "espinoza", "valenzuela", "castillo",
  "tapia", "reyes", "gutierrez", "castro", "pizarro", "alvarez", "vasquez", "sanchez", "fernandez", "ramirez",
  "carrasco", "gomez", "cortes", "herrera", "nunez", "jara", "vergara", "rivera", "figueroa", "riquelme", "garcia",
  "miranda", "bravo", "vera", "molina", "vega", "campos", "sandoval", "orellana", "zuniga", "olivares", "alarcon",
  "gallardo", "ortiz", "garrido", "salazar", "guzman", "henriquez", "saavedra", "navarro", "aguilera", "parra",
  "romero", "aravena", "vargas",
]);

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

/**
 * Surname similarity at which two spellings count as the same surname, set so about the same spellings count
 * as with the lab's name comparator this replaced.
 */
const SAME_SURNAME_SCORE = 81;

/**
 * Splits a given name into lowercase parts, e.g. "Roy W." to ["roy", "w"].
 * @param name - The given names.
 * @returns The parts, without punctuation.
 */
function givenParts(name: string): string[] {
  const parts = name.toLowerCase().replace(/[.,]/g, " ").split(/\s+/).filter(Boolean);
  // "María del Carmen" and "Juan de Dios" are two names, with "del" and "de" only joining them
  return CHILE ? parts.filter((part) => !NAME_PARTICLES.has(part)) : parts;
}

/** Words that join Spanish names and surnames without being one: María del Carmen, Pérez y Soto, de la Fuente. */
const NAME_PARTICLES = new Set(["de", "del", "la", "las", "los", "y", "e"]);

/** A Chilean surname: the person's own (the father's, then the mother's), and a husband's, if written after "de". */
interface ChileSurname {
  own: string[];
  husband?: string;
}

/**
 * Reads a Chilean surname. Chileans carry two: the father's first, then the mother's ("González Pérez"). A married
 * woman was often written with "de" and her husband's ("Pérez de Soto"), or as a widow "viuda de Soto".
 * "De la Fuente" and "del Río" are surnames of their own.
 * @param surname - The surname as written.
 * @param female - Whether the person may be a woman, and so written with a husband's surname.
 * @returns Her or his own surnames, and a husband's surname if one is written.
 */
function chileSurname(surname: string, female: boolean = true): ChileSurname {
  // "i" joins surnames as "y" does: "Pizarro i Cisternas"
  const words = nameWords(surname).filter((word, i, all) => !(word === "i" && i > 0 && i < all.length - 1));
  const own: string[] = [];
  let husband: string | undefined;
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const next = words[i + 1];
    // "viuda de Soto", "vda de Soto"
    if ((word === "viuda" || word === "vda" || word === "vda.") && next === "de") {
      husband = words.slice(i + 2).filter((w) => !NAME_PARTICLES.has(w))[0];
      break;
    }
    // "Pérez de Soto": "de" after her own surname, not "de la"/"del", names the husband. A man's "Pérez de Arce" is
    // one surname.
    if (female && word === "de" && own.length > 0 && next && !["la", "las", "los"].includes(next)) {
      husband = words.slice(i + 1).filter((w) => !NAME_PARTICLES.has(w))[0];
      break;
    }
    if (!NAME_PARTICLES.has(word)) own.push(word);
  }
  return { own, husband };
}

/** How two Chilean surnames compare, worked out part by part. */
interface ChileSurnameMatch {
  /** Both name the same family: the same father's surname, and the same mother's surname where both give one. */
  same: boolean;
  /** Close enough to look at: spelled alike, or only partly the same. */
  close: boolean;
  /** Why they're only partly the same: shown in yellow. */
  partly?: string;
  /** A note under a match, like a second surname written on only one side. */
  note?: string;
  /** The side a note is about. */
  side?: "record" | "tree";
}

/**
 * Checks whether two surname words are one surname: the same, spelled the way it sounds (Gonzales and González), or
 * nearly the same spelling.
 * @param a - One surname word.
 * @param b - The other.
 * @returns True when they're one surname.
 */
function sameSurnameWord(a: string, b: string): boolean {
  return a === b || spanishSound(a) === spanishSound(b) || getNameComparisonConfidence(a, b) >= SAME_SURNAME_SCORE;
}

/**
 * Compares two Chilean surnames: the father's surnames first, then the mother's. One side often gives only the
 * father's surname, which is no conflict. The same father's surname with a different mother's is worth a look, as
 * are surnames in the other order, the mother's surname alone, or a married name.
 * @param recordLast - The surname on one side.
 * @param treeLast - The surname on the other side.
 * @param male - Whether the person is a man, who is never written with a wife's surname.
 * @returns How they compare.
 */
function compareChileSurnames(recordLast: string, treeLast: string, male: boolean): ChileSurnameMatch {
  const a = chileSurname(recordLast, !male);
  const b = chileSurname(treeLast, !male);
  const [a1, a2] = a.own;
  const [b1, b2] = b.own;
  const plainlyEqual = a.own.join(" ") === b.own.join(" ");
  if (a1 && b1 && sameSurnameWord(a1, b1)) {
    if (a2 && b2 && !sameSurnameWord(a2, b2)) return { same: false, close: true, partly: "Different second surname" };
    if (Boolean(a.husband) !== Boolean(b.husband)) return { same: true, close: true, note: "Married name added", side: a.husband ? "record" : "tree" };
    if (Boolean(a2) !== Boolean(b2)) return { same: true, close: true, note: "Second surname on one side only", side: a2 ? "tree" : "record" };
    return { same: true, close: true, note: plainlyEqual ? undefined : "Spelled differently" };
  }
  if (a1 && b1 && a2 && b2 && sameSurnameWord(a1, b2) && sameSurnameWord(a2, b1)) {
    return { same: false, close: true, partly: "Surnames in a different order" };
  }
  // One side gives only the mother's surname
  if ((a2 && b1 && !b2 && sameSurnameWord(a2, b1)) || (b2 && a1 && !a2 && sameSurnameWord(b2, a1))) {
    return { same: false, close: true, partly: "Only the mother’s surname" };
  }
  // Her own surname on one side, her husband's on the other
  if ((a.husband && b1 && sameSurnameWord(a.husband, b1)) || (b.husband && a1 && sameSurnameWord(b.husband, a1))) {
    return { same: false, close: true, partly: "Married name" };
  }
  const score = a1 && b1 ? getNameComparisonConfidence(a1, b1) : 0;
  return { same: false, close: score >= 60 || (Boolean(a1 && b1) && soundCode(a1) !== "" && soundCode(a1) === soundCode(b1)) };
}

/** Each name in the app's nickname lists, with the numbers of the lists it's in. */
let nicknameGroups: Map<string, number[]> | undefined;

/**
 * Checks whether one of the nickname lists holds both names: Sallie and Sarah, Wm and William, Giuseppe and
 * Joseph. Accents don't count, so José is Jose.
 * @param a - One given name, lowercase.
 * @param b - The other.
 * @returns True when they're forms of one name.
 */
function nicknamesMatch(a: string, b: string): boolean {
  if (!nicknameGroups) {
    nicknameGroups = new Map();
    NICKNAMES.forEach((names, group) => {
      for (const name of names) nicknameGroups!.set(name, [...(nicknameGroups!.get(name) ?? []), group]);
    });
  }
  const groups = nicknameGroups.get(nameWords(a).join(""));
  return Boolean(groups && nicknameGroups.get(nameWords(b).join(""))?.some((group) => groups.includes(group)));
}

/**
 * Checks whether two given names are the same name: equal, one a short form of the other
 * (Sam and Samuel), a known nickname or translation (Frank and Francesco), or very close in spelling.
 * @param a - One given name.
 * @param b - The other.
 * @returns True if they name the same person.
 */
export function sameGivenName(a: string, b: string): boolean {
  if (a === b) return true;
  if (differentSex(a, b)) return false;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length >= 3 && long.startsWith(short)) return true;
  if (nicknamesMatch(a, b)) return true;
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
  // Capitals, periods, accents and curly apostrophes don't make names differ: "D'Avanzo" and "D’Avanzo"
  if (nameWords(recordName).join(" ") === nameWords(treeName).join(" ")) {
    return { highlight: HighlightType.Green };
  }

  const [firstA, ...middleA] = givenParts(recordFirst);
  const [firstB, ...middleB] = givenParts(treeFirst);
  const firstSame = Boolean(firstA && firstB) && sameGivenName(firstA, firstB);
  // A lone initial can only agree, not prove a match
  const firstInitial = Boolean(firstA && firstB) && (firstA.length === 1 || firstB.length === 1) && firstA[0] === firstB[0];
  const middleSame = middlesAgree(middleA, middleB);

  const surnameScore = isBlank(recordLast) || isBlank(treeLast) ? 100 : getNameComparisonConfidence(recordLast, treeLast);
  // In Chile, and for Spanish surnames anywhere, each side may give one or two surnames, the father's and the
  // mother's, compared one by one. Outside Chile "de" is read as part of a surname (De León), not a husband's.
  const spanish = !isBlank(recordLast) && !isBlank(treeLast) && (CHILE || looksSpanish(recordLast) || looksSpanish(treeLast));
  const chile = spanish ? compareChileSurnames(recordLast, treeLast, !CHILE || gender.toLowerCase() === "male") : undefined;
  // Very close spellings ("Silberstein" and "Silverstein") are the same surname written differently
  const surnameSame = chile ? chile.same : surnameScore >= SAME_SURNAME_SCORE;
  // Surnames that sound alike ("Lio" and "Leo") are close even when the spelling score is low
  const soundsAlike = !isBlank(recordLast) && !isBlank(treeLast) && soundCode(recordLast) !== "" && soundCode(recordLast) === soundCode(treeLast);
  const surnameClose = chile ? chile.close : surnameScore >= 60 || soundsAlike;
  const female = gender.toLowerCase() === "female";

  if (firstSame || firstInitial) {
    // A matching first name with no surname on one side can't confirm the person
    if (isBlank(recordLast) !== isBlank(treeLast)) {
      return { highlight: HighlightType.Yellow, reason: "Surname missing", side: isBlank(recordLast) ? "record" : "tree" };
    }
    // Partly the same Chilean surnames: the father's but not the mother's, swapped, or a married name
    if (chile?.partly) return { highlight: HighlightType.Yellow, reason: chile.partly };
    if (surnameSame) {
      if (!middleSame) return { highlight: HighlightType.Yellow, reason: "Different middle name" };
      if (firstInitial) return { highlight: HighlightType.Yellow, reason: "Only an initial" };
      // Said under the name, so a green check beside two spellings doesn't look like a mistake
      if (firstA !== firstB) return { highlight: HighlightType.Green, reason: "Same name, written differently" };
      if (chile) return chile.note ? { highlight: HighlightType.Green, reason: chile.note, side: chile.side } : { highlight: HighlightType.Green };
      return nameWords(recordLast).join("") !== nameWords(treeLast).join("")
        ? { highlight: HighlightType.Green, reason: "Spelled differently" }
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
  /**
   * Checks whether two given names could be one: the same name, or an initial and a name it starts.
   * @param x - A given name or initial on one side.
   * @param y - One on the other side.
   * @returns True when they fit.
   */
  const fits = (x: string, y: string) => (x.length === 1 || y.length === 1 ? x[0] === y[0] : sameGivenName(x, y));
  // First and middle names swapped, written out or as initials: "Caroline G" and "Gail C"
  const swapped = middleA.length > 0 && middleB.length > 0
    && middleB.some((y) => fits(firstA, y)) && middleA.some((x) => fits(x, firstB));
  if ((goesByMiddle || swapped) && (surnameClose || female)) return { highlight: HighlightType.Yellow, reason: "Possibly goes by middle name" };

  // A man's first name and a woman's (John and Jane, Louis and Louise) name different people. Spelled so alike that
  // one may be a slip for the other (Francis and Frances, Jesse and Jessie), with the same surname, it's worth a look.
  if (differentSex(firstA, firstB)) {
    return spellingRatio(firstA, firstB) >= NEAR_SPELLING && (surnameClose || female)
      ? { highlight: HighlightType.Yellow, reason: "Man’s and woman’s spellings" }
      : { highlight: HighlightType.Red, reason: "Man’s and woman’s names" };
  }

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