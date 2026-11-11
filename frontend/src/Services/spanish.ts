// Spanish for text the app computes in English. Row labels ("Died"), reasons ("Same town: Salem") and relationships
// ("Son") are made in English by highlightScoring.ts and compareRows.ts and compared in English elsewhere, so they
// stay English in the data and are only put into Spanish here, where they're shown on the Chilean site.
import { CHILE } from "./region";

/** Computed English text and its Spanish, word for word as the app makes it. */
const EXACT: Record<string, string> = {
  // Row labels, from compareRows' EVENT_LABELS and the name and timeline rows
  "Name": "Nombre",
  "Born": "Nació",
  "Birthplace": "Lugar de nacimiento",
  "Died": "Falleció",
  "Death place": "Lugar de defunción",
  "Lived": "Residencia",
  "Residence": "Residencia",
  "Married": "Se casó",
  "Marriage place": "Lugar de matrimonio",
  "Christened": "Bautizo",
  "Christening place": "Lugar de bautizo",
  "Born / christened": "Nació / bautizo",
  "Christened before birth": "Bautizado antes de nacer",
  "Christened soon after birth": "Bautizado poco después de nacer",
  "Buried": "Sepultado",
  "Burial place": "Lugar de sepultura",
  "Timeline": "Línea de tiempo",

  // Other event types, for rows named after an event type compareRows doesn't list
  "Baptism": "Bautismo",
  "Birth": "Nacimiento",
  "Death": "Defunción",
  "Marriage": "Matrimonio",
  "Burial": "Sepultura",
  "Christening": "Bautizo",
  "Census": "Censo",
  "Divorce": "Divorcio",
  "Immigration": "Inmigración",
  "Emigration": "Emigración",
  "Naturalization": "Naturalización",
  "Military": "Servicio militar",
  "Occupation": "Ocupación",
  "Cremation": "Cremación",
  "Probate": "Sucesión",
  "Other": "Otro pariente",

  // Name reasons, from scoreName in highlightScoring and reasonFor in compareRows
  "Common name": "Nombre común",
  "Surname missing": "Falta el apellido",
  "Given name missing": "Falta el nombre",
  "Different middle name": "Segundo nombre distinto",
  "Only an initial": "Solo una inicial",
  "Same name, written differently": "Mismo nombre, escrito de otra forma",
  "Spelled differently": "Escrito de otra forma",
  "Similar spelling": "Escritura parecida",
  "Sounds alike": "Suena parecido",
  "Maybe a married name": "Quizás es el apellido de casada",
  "Different second surname": "Apellido materno distinto",
  "Second surname on one side only": "Solo un lado tiene el apellido materno",
  "Surnames in a different order": "Apellidos en otro orden",
  "Only the mother’s surname": "Solo el apellido materno",
  "Married name": "Apellido de casada",
  "Married name added": "Incluye el apellido de casada",
  "Same region": "Misma región",
  "Different regions": "Regiones distintas",
  "Both in Chile": "Ambos en Chile",
  "Different surnames": "Apellidos distintos",
  "Possibly goes by middle name": "Quizás usa su segundo nombre",
  "Man’s and woman’s spellings": "Forma masculina y femenina",
  "Man’s and woman’s names": "Nombre de hombre y de mujer",
  "Similar names": "Nombres parecidos",
  "Different names": "Nombres distintos",
  "Typo? Digits swapped": "¿Error de digitación? Números invertidos",

  // Place reasons, from scorePlace and scoreResidence in highlightScoring and reasonFor in compareRows
  "Different places": "Lugares distintos",
  "Different states": "Estados distintos",
  "Different countries": "Países distintos",
  "Same county": "Mismo condado",
  "Same state": "Mismo estado",
  "Same country": "Mismo país",
  "Border changed": "Cambiaron los límites",
  "Same place, written differently": "Mismo lugar, escrito de otra forma",
  "One place is more specific": "Un lugar es más específico",
  "Moved or a different person": "Se mudó o es otra persona",

  // Date reasons, from reasonFor and outside in compareRows
  "Different dates": "Fechas distintas",
  "Different day": "Día distinto",
  "Exact same date": "Exactamente la misma fecha",
  "After death": "Después de fallecer",
  "Before birth": "Antes de nacer",

  // Relationships, as the hint gives them and as headings
  "Focus": "Persona principal",
  "Main person": "Persona principal",
  "Spouse": "Cónyuge",
  "Husband": "Esposo",
  "Wife": "Esposa",
  "Father": "Padre",
  "Mother": "Madre",
  "Parent": "Padre o madre",
  "Son": "Hijo",
  "Daughter": "Hija",
  "Child": "Hijo o hija",
  "Brother": "Hermano",
  "Sister": "Hermana",
  "Sibling": "Hermano o hermana",
  "Relative": "Pariente",
  "Male": "Hombre",
  "Female": "Mujer",
  "Unknown": "Desconocido",

  // Sides and headings
  "Person 1": "Persona 1",
  "Person 2": "Persona 2",
  "Record": "Registro",
  "Tree": "Árbol",
  "The record": "El registro",
  "The tree person": "La persona del árbol",
  "the tree person": "la persona del árbol",
  "Family": "Familia",
  "Family on the record": "Familia en el registro",
  "Check source": "Ver fuente",
};

/** Countries a reason may name in English, for "Both in the United States". */
const COUNTRIES: Record<string, string> = {
  "United States": "Estados Unidos",
  "United Kingdom": "Reino Unido",
};

/**
 * Puts a name from a computed reason into Spanish when it's the stand-in for a missing name.
 * @param name - A first name, or "the tree person" when there is none.
 * @returns The name, or the stand-in in Spanish.
 */
function nameOf(name: string): string {
  return name === "the tree person" ? "la persona del árbol" : name;
}

/**
 * Words "1 year" or "3 years" in Spanish.
 * @param count - The number of years, as written.
 * @returns "1 año" or "3 años".
 */
function years(count: string): string {
  return `${count} ${count === "1" ? "año" : "años"}`;
}

/**
 * Says when something happened, with "el" before a full date and "en" before a year or month: "el 8 mar 1852",
 * "en 1852".
 * @param date - A date as the app shows it, such as "8 Mar 1852" or "About 1850".
 * @returns The date in Spanish with its preposition.
 */
function onDate(date: string): string {
  return `${/^\d{1,2} /.test(date) ? "el" : "en"} ${spanishDate(date)}`;
}

/** Computed English text with names, numbers or places in it, and how to say each in Spanish. */
const PATTERNS: [RegExp, (match: RegExpMatchArray) => string][] = [
  // Dates and timelines, from compareRows
  [/^(\d+) years? apart$/, (m) => `${years(m[1])} de diferencia`],
  [/^Christened (\d+) (days?|months?|years?) after birth$/, (m) => `Bautizado ${m[1]} ${{ day: "día", days: "días", month: "mes", months: "meses", year: "año", years: "años" }[m[2]]} después de nacer`],
  [/^Born (\d{4})$/, (m) => `Nació en ${m[1]}`],
  [/^(.+) born (\d{4})$/, (m) => `${nameOf(m[1])} nació en ${m[2]}`],
  [/^(.+) died (\d{4})$/, (m) => `${nameOf(m[1])} falleció en ${m[2]}`],
  [/^Born (\d+) years? after (.+) died$/, (m) => `Nació ${years(m[1])} después de que ${nameOf(m[2])} falleciera`],
  [/^Born when (.+) was (\d+)$/, (m) => `Nació cuando ${nameOf(m[1])} tenía ${m[2]}`],
  [/^Born before (.+)$/, (m) => `Nació antes que ${nameOf(m[1])}`],
  [/^Born after (.+)$/, (m) => `Nació después que ${nameOf(m[1])}`],
  [/^Only (\d+) years? older than (.+)$/, (m) => `Solo ${years(m[1])} mayor que ${nameOf(m[2])}`],
  // A person's own facts that can't all be true, from selfConflicts
  [/^died (.+), but in the (.+) census$/, (m) => `falleció ${onDate(m[1])}, pero aparece en el censo de ${m[2]}`],
  [/^born (.+), but in the (.+) census$/, (m) => `nació ${onDate(m[1])}, pero aparece en el censo de ${m[2]}`],
  [/^died (.+), before being born (.+)$/, (m) => `falleció ${onDate(m[1])}, antes de nacer ${onDate(m[2])}`],
  // Places, from highlightScoring and compareRows
  [/^Both in the (.+)$/, (m) => `Ambos en ${COUNTRIES[m[1]] ?? m[1]}`],
  [/^Both in (.+)$/, (m) => `Ambos en ${m[1]}`],
  [/^Same town: (.+)$/, (m) => `Misma localidad: ${m[1]}`],
  [/^(.+) is her married name$/, (m) => `${m[1]} es su apellido de casada`],
  // A row named after an event type compareRows doesn't list, such as "Immigration place"
  [/^(.+) place$/, (m) => `Lugar de ${(EXACT[m[1]] ?? m[1]).toLowerCase()}`],
  // A known reason with details after it, such as "Different states: Kansas, Louisiana"
  [/^([^:]+): (.+)$/, (m) => (EXACT[m[1]] ? `${EXACT[m[1]]}: ${m[2]}` : m[0])],
];

/**
 * Translates computed English text into Spanish, whatever site this is. Exported for the Chilean site's helpers;
 * the app calls say, which leaves the English site alone.
 * @param text - A label, reason or relationship as the app makes it.
 * @returns The Spanish, or the text unchanged when there's no translation for it.
 */
export function spanishFor(text: string): string {
  if (EXACT[text] !== undefined) return EXACT[text];
  // Relationships are also shown in lowercase ("son"), and stay lowercase
  const capitalized = text.charAt(0).toUpperCase() + text.slice(1);
  if (text !== capitalized && EXACT[capitalized] !== undefined) {
    const spanish = EXACT[capitalized];
    return spanish.charAt(0).toLowerCase() + spanish.slice(1);
  }
  for (const [pattern, spanish] of PATTERNS) {
    const match = text.match(pattern);
    if (match) return spanish(match);
  }
  return text;
}

/** Month names and abbreviations in English, each with its Spanish abbreviation. */
const MONTHS: Record<string, string> = {
  jan: "ene", january: "ene", feb: "feb", february: "feb", mar: "mar", march: "mar", apr: "abr", april: "abr",
  may: "may", jun: "jun", june: "jun", jul: "jul", july: "jul", aug: "ago", august: "ago", sep: "sep", sept: "sep",
  september: "sep", oct: "oct", october: "oct", nov: "nov", november: "nov", dec: "dic", december: "dic",
};

/**
 * Puts a date into Spanish, whatever site this is: Spanish months, "aprox." for "About", "antes de" and
 * "después de" for "Before" and "After".
 * @param date - A date as the app shows it, such as "8 Mar 1852", "About 1850" or "abt 1912".
 * @returns The same date as a Chilean reader would write it, like "8 mar 1852" or "aprox. 1850".
 */
export function spanishDate(date: string): string {
  return date
    .replace(/^(about|abt|approx(imately)?|around|circa|ca|c|est(imated)?|calc(ulated)?)\.?\s+/i, "aprox. ")
    .replace(/^~\s*/, "aprox. ")
    .replace(/^(before|bef)\.?\s+/i, "antes de ")
    .replace(/^(after|aft)\.?\s+/i, "después de ")
    .replace(/^between\s+(.+?)\s+and\s+(.+)$/i, "entre $1 y $2")
    .replace(/(\d{4})\s+(to|and)\s+(\d{4})/i, "$1 a $3")
    // Only a month written before a year ("8 Mar 1852", "Mar 1852"), so a person named June stays June
    .replace(/\b([A-Za-z]+)\b\.?(?=\s+\d{4})/g, (word, name: string) => MONTHS[name.toLowerCase()] ?? word);
}

/**
 * Shows a label, reason or relationship the app made in English in the site's language: Spanish on the Chilean
 * site, unchanged on the English one. Only for showing; the English stays in the data, where it's compared.
 * @param text - The English text, such as "Died", "Same town: Salem" or "Son".
 * @returns The text to show.
 */
export function say(text: string): string {
  return CHILE ? spanishFor(text) : text;
}

/**
 * Shows a date in the site's language: Spanish months and qualifiers on the Chilean site, unchanged on the
 * English one. Only for showing, never for a date that gets parsed.
 * @param date - A date as the app shows it, such as "8 Mar 1852".
 * @returns The date to show.
 */
export function sayDate(date: string): string {
  return CHILE ? spanishDate(date) : date;
}

/**
 * Shows one value of a comparison row in the site's language. Date rows have their dates and timeline notes
 * ("Born 1850") translated; names and places are shown as written.
 * @param kind - Whether the row is a name, date or place.
 * @param value - The value on one side, if any.
 * @returns The value to show.
 */
export function sayValue(kind: "name" | "date" | "place", value: string | undefined): string | undefined {
  if (!CHILE || !value || kind !== "date") return value;
  return spanishDate(spanishFor(value));
}
