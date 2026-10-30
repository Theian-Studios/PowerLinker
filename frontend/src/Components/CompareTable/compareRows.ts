import { Person } from "../../Models/Person";
import { Event } from "../../Models/Event";
import { HighlightType } from "../../Models/HighlightType";
import { MAX_YELLOW_YEAR_GAP, Scored, getDateHighlight, isPlaceholderPlace, scoreName, scorePlace, scoreResidence } from "../../Services/highlightScoring";

export type Status = "ok" | "close" | "bad" | "none";

export interface CompareRow {
  label: string;
  kind: "name" | "date" | "place";
  record?: string;
  tree?: string;
  status: Status;
  /** Short explanation for close and conflicting rows, e.g. "7 years apart". */
  reason?: string;
  /** The column the reason sits under when it's about one side, like a missing given name. */
  reasonSide?: "record" | "tree";
}

/** Row labels for each event type: [date label, place label]. */
const EVENT_LABELS: Record<string, [string, string]> = {
  birth: ["Born", "Birthplace"],
  death: ["Died", "Death place"],
  residence: ["Lived", "Residence"],
  marriage: ["Married", "Marriage place"],
  christening: ["Christened", "Christening place"],
  burial: ["Buried", "Burial place"],
};

/** How well two residences agree, for picking the tree's residence closest to the record's. */
const RESIDENCE_RANK: Record<HighlightType, number> = {
  [HighlightType.Green]: 3,
  [HighlightType.Yellow]: 2,
  [HighlightType.None]: 1,
  [HighlightType.Red]: 0,
};

/** Events in the order of a life, so every hint lists them the same way. */
const LIFE_ORDER = ["birth", "christening", "residence", "marriage", "death", "burial"];

/**
 * Where an event type falls in a life; unknown types go after the known ones.
 * @param type - The event type, such as "birth".
 * @returns Its position in LIFE_ORDER, or the end of the list.
 */
function lifeOrder(type: string): number {
  const i = LIFE_ORDER.indexOf(type.toLowerCase());
  return i === -1 ? LIFE_ORDER.length : i;
}

/**
 * Converts a highlight type into a row status.
 * @param highlight - The highlight type from highlightScoring.
 * @returns The matching row status.
 */
function toStatus(highlight: HighlightType): Status {
  switch (highlight) {
    case HighlightType.Green:
      return "ok";
    case HighlightType.Yellow:
      return "close";
    case HighlightType.Red:
      return "bad";
    default:
      return "none";
  }
}

/**
 * Gets the date and place labels for an event type.
 * @param type - The event type, such as "birth".
 * @returns The date label and the place label.
 */
function labelsFor(type: string): [string, string] {
  const known = EVENT_LABELS[type.toLowerCase()];
  if (known) return known;
  const name = type.charAt(0).toUpperCase() + type.slice(1);
  return [name, `${name} place`];
}

/**
 * Gets a person's full name.
 * @param person - The person, if any.
 * @returns First and last name, or undefined when there is no person.
 */
function fullName(person?: Person): string | undefined {
  return person ? `${person.firstName ?? ""} ${person.lastName ?? ""}`.trim() : undefined;
}

/**
 * Gets the last four-digit year in a date string.
 * @param date - A date such as "22 Jul 1845".
 * @returns The year, or undefined if there isn't one.
 */
function yearOf(date: string): number | undefined {
  const years = date.match(/\d{4}/g);
  return years ? Number(years[years.length - 1]) : undefined;
}

/**
 * Gets the years a person was born and died, from their events, for rough ages.
 * @param person - The person, if any.
 * @returns The birth (or christening) and death (or burial) years, when known.
 */
function lifeYears(person?: Person): { born?: number; died?: number } {
  /**
   * Finds the year of the first event of a type that has one.
   * @param types - Event types to try, in order.
   * @returns That year, if any.
   */
  const year = (...types: string[]) => {
    for (const type of types) {
      const date = person?.personEvents.find((event) => event.sanitizedType === type)?.date?.toString();
      const found = date ? yearOf(date) : undefined;
      if (found !== undefined) return found;
    }
    return undefined;
  };
  return { born: year("birth", "christening"), died: year("death", "burial") };
}

/**
 * Gets the earliest a person could have been born and the latest they could have died.
 * A birth "before 1850" has no earliest year. Christenings aren't used, since they can come years after birth.
 * @param person - The person, if any.
 * @returns The bounds, when known.
 */
function lifeBounds(person?: Person): { born?: number; died?: number } {
  const birth = person?.personEvents.find((event) => event.sanitizedType === "birth" && event.yearRange());
  const end = person?.personEvents.find((event) => event.sanitizedType === "death" && event.yearRange())
    ?? person?.personEvents.find((event) => event.sanitizedType === "burial" && event.yearRange());
  const born = birth?.yearRange()?.[0];
  const died = end?.yearRange()?.[1];
  return {
    born: born !== undefined && Number.isFinite(born) ? born : undefined,
    died: died !== undefined && Number.isFinite(died) ? died : undefined,
  };
}

/** Years an event may fall outside a lifetime before it counts: birth and death years are often a year off. */
const LIFETIME_SLACK = 1;

/**
 * Checks whether an event falls outside someone's lifetime, even at the edges of approximate dates.
 * @param event - An event on one side, if any.
 * @param life - The other side's earliest birth and latest death years.
 * @param extraYears - Years more allowed after death, such as one for a burial.
 * @returns "After death" or "Before birth", or undefined when it fits or has no year.
 */
function outside(event: Event | undefined, life: { born?: number; died?: number }, extraYears: number = 0): string | undefined {
  const range = event?.yearRange();
  if (!range) return undefined;
  if (life.died !== undefined && range[0] > life.died + LIFETIME_SLACK + extraYears) return "After death";
  if (life.born !== undefined && range[1] < life.born - LIFETIME_SLACK) return "Before birth";
  return undefined;
}

/**
 * Scores two dates. Plain dates are compared day by day; when either is approximate ("About 1850",
 * "Before 1850", "1848–1852"), any overlap of the years they allow is a match.
 * @param a - The record's event.
 * @param b - The tree's event.
 * @returns The highlight, and for approximate dates that miss, how many years apart.
 */
function scoreDates(a: Event, b: Event): HighlightType | Scored {
  const textA = a.date?.toString();
  const textB = b.date?.toString();
  if (!textA || !textB) return HighlightType.None;
  if (!a.isApproximate && !b.isApproximate) return getDateHighlight(textA, textB);
  const loose = yearGap(a.yearRange(), b.yearRange());
  if (loose === undefined) return HighlightType.None;
  if (loose === 0) return HighlightType.Green;
  // "About 1850" and 1855 are 5 years apart, though "about" allows a couple of them
  const gap = yearGap(a.yearRange(false), b.yearRange(false)) ?? loose;
  return { highlight: loose > MAX_YELLOW_YEAR_GAP ? HighlightType.Red : HighlightType.Yellow, reason: `${gap} year${gap === 1 ? "" : "s"} apart` };
}

/**
 * Counts the years between two year ranges.
 * @param a - One range of possible years.
 * @param b - The other.
 * @returns 0 when they overlap, the years between them otherwise, or undefined if either is missing.
 */
function yearGap(a?: [number, number], b?: [number, number]): number | undefined {
  if (!a || !b) return undefined;
  return Math.max(0, a[0] - b[1], b[0] - a[1]);
}

/**
 * Picks the tree's residence to compare with the record's. One from the same year is the real test, since
 * people move; otherwise the closest match, then the nearest year.
 * @param recordEvent - The residence on the record, which the tree's are compared with.
 * @param treeEvents - Every residence the tree lists.
 * @returns The residence to show, if the tree has any.
 */
function pickResidence(recordEvent: Event | undefined, treeEvents: Event[]): Event | undefined {
  if (!recordEvent?.location || treeEvents.length <= 1) return treeEvents[0];
  const recordYear = recordEvent.date ? yearOf(recordEvent.date.toString()) : undefined;
  const sameYear = treeEvents.filter((event) => recordYear !== undefined && event.date && yearOf(event.date.toString()) === recordYear);
  const pool = sameYear.length > 0 ? sameYear : treeEvents;
  return pool.reduce((best, event) => (residenceFit(recordEvent, recordYear, event) > residenceFit(recordEvent, recordYear, best) ? event : best));
}

/**
 * Scores how well a tree residence fits the record's: agreement first, then closeness in years.
 * @param recordEvent - The residence on the record, which the tree's are compared with.
 * @param recordYear - Its year, if any.
 * @param event - One residence the tree lists.
 * @returns A larger number for a better fit.
 */
function residenceFit(recordEvent: Event, recordYear: number | undefined, event: Event): number {
  const rank = RESIDENCE_RANK[scoreResidence(recordEvent.location, event.location, false).highlight];
  const year = event.date ? yearOf(event.date.toString()) : undefined;
  const gap = recordYear !== undefined && year !== undefined ? Math.min(Math.abs(recordYear - year), 99) : 99;
  return rank * 100 - gap;
}

/**
 * Explains why a close or conflicting row was marked that way.
 * @param kind - Whether the row is a name, date or place.
 * @param status - The row status.
 * @param record - The record's value.
 * @param tree - The tree's value.
 * @returns A short reason, or undefined for exact matches and uncompared rows.
 */
function reasonFor(kind: CompareRow["kind"], status: Status, record: string, tree: string): string | undefined {
  // A place that only adds detail counts as a match, but the tooltip still says so
  if (status === "ok" && kind === "place" && record !== tree) return "Same place, written differently";
  if (status !== "close" && status !== "bad") return undefined;
  if (kind === "name") return status === "bad" ? "Different names" : "Similar names";
  if (kind === "date") {
    const a = yearOf(record);
    const b = yearOf(tree);
    if (a === undefined || b === undefined) return "Different dates";
    const gap = Math.abs(a - b);
    return gap === 0 ? "Different day" : `${gap} year${gap === 1 ? "" : "s"} apart`;
  }
  return status === "bad" ? "Different places" : "One place is more specific";
}

/**
 * Puts a residence's year in front of its place.
 * @param year - The residence year, if any.
 * @param place - The place, if any.
 * @returns For example "1930 · Fall River, Bristol, Massachusetts", or just the place.
 */
function withYear(year?: string, place?: string): string | undefined {
  return place && year ? `${year} · ${place}` : place;
}

/**
 * Checks whether a surname is among a list of surnames, ignoring case and spaces.
 * @param names - Surnames to look in.
 * @param surname - The surname to look for.
 * @returns True when it's there.
 */
function hasSurname(names: string[], surname?: string): boolean {
  const wanted = surname?.trim().toLowerCase();
  return Boolean(wanted) && names.some((name) => name.trim().toLowerCase() === wanted);
}

/**
 * Builds the comparison rows for one record person and their tree match.
 * @param recordPerson - The person on the record.
 * @param treePerson - Their match on the tree, if there is one.
 * @param flagCommonName - Whether a very common name may be flagged; only for a person with no family on the hint.
 * @param spouseSurnames - Surnames of the person's spouses on each side, which can explain a woman's different surname.
 * @returns One row for the name, then a date row and a place row for each event.
 */
export function buildRows(recordPerson: Person, treePerson: Person | undefined, flagCommonName: boolean = true, spouseSurnames: { record: string[]; tree: string[] } = { record: [], tree: [] }): CompareRow[] {
  /**
   * Builds one row, scoring it only when both sides have a value.
   * @param label - Text shown in the first column, e.g. "Born".
   * @param kind - Whether the row is a name, date or place.
   * @param record - The record's value.
   * @param tree - The tree's value.
   * @param highlight - The highlight type for the pair, or a highlight with its own reason.
   * @returns A scored row, or an unscored one if either side is missing.
   */
  function row(label: string, kind: CompareRow["kind"], record: string | undefined, tree: string | undefined, highlight: HighlightType | Scored): CompareRow {
    const scored = typeof highlight === "object" ? highlight : { highlight };
    if (!record || !tree || scored.highlight === HighlightType.None) return { label, kind, record, tree, status: "none" };
    // Check hints are scored like any other, so their colors don't give them away
    const status = toStatus(scored.highlight);
    // A comparison's own reason ("Different states: Kansas, Louisiana") beats the generic one
    const reason = scored.reason ?? reasonFor(kind, status, record, tree);
    return { label, kind, record, tree, status, reason, ...(scored.side ? { reasonSide: scored.side } : {}) };
  }

  const rows: CompareRow[] = [row(
    "Name",
    "name",
    fullName(recordPerson),
    fullName(treePerson),
    treePerson
      ? scoreName(recordPerson.firstName ?? "", recordPerson.lastName ?? "", treePerson.firstName ?? "", treePerson.lastName ?? "", treePerson.sex || recordPerson.sex || "")
      : HighlightType.None,
  )];

  // With no tree match there is nothing to score, so the record's events are listed on their own
  const eventTypes = [...new Set([...recordPerson.personEvents, ...(treePerson?.personEvents ?? [])].map((event) => event.sanitizedType))]
    .sort((a, b) => lifeOrder(a) - lifeOrder(b));

  // Lifetimes from birth, not christening: a residence the year before a christening is no conflict
  const recordLife = lifeBounds(recordPerson);
  const treeLife = lifeBounds(treePerson);

  for (const type of eventTypes) {
    // Census placeholders like "Same Place" aren't real residences, so the first real one is used
    const recordEvent = recordPerson.personEvents.find((event) => event.sanitizedType === type && !isPlaceholderPlace(event.location));
    const treeEvents = treePerson?.personEvents.filter((event) => event.sanitizedType === type && !isPlaceholderPlace(event.location)) ?? [];
    // People have several residences; compare the record's with the tree's from the same year, or else the closest
    const treeEvent = type === "residence" ? pickResidence(recordEvent, treeEvents) : treeEvents[0];
    const [dateLabel, placeLabel] = labelsFor(type);

    // Even when both sides have the event, each must fit the other's lifetime: a 1940 census entry
    // can't be the person the other side says died in 1935
    const lifeEvent = ["birth", "christening", "death", "burial"].includes(type);
    if (treePerson && recordEvent && treeEvent && !lifeEvent) {
      const reason = outside(recordEvent, treeLife) ?? outside(treeEvent, recordLife);
      if (reason) {
        rows.push({
          label: dateLabel,
          kind: "date",
          record: recordEvent.dateText,
          tree: treeEvent.dateText,
          status: "bad",
          reason,
        });
        if (recordEvent.location || treeEvent.location) {
          rows.push(row(placeLabel, "place", recordEvent.location, treeEvent.location, HighlightType.None));
        }
        continue;
      }
    }

    // An event only one side has is checked against the other side's lifetime
    if (treePerson && (!recordEvent || !treeEvent)) {
      const other = recordEvent ? treeLife : recordLife;
      // A burial can fall in the year after the death
      const reason = outside(recordEvent ?? treeEvent, other, type === "burial" ? 1 : 0);

      if (reason) {
        rows.push({
          label: dateLabel,
          kind: "date",
          record: recordEvent?.dateText,
          tree: treeEvent?.dateText,
          status: "bad",
          reason,
        });
        const place = (recordEvent ?? treeEvent)?.location;
        if (place) rows.push(row(placeLabel, "place", recordEvent?.location, treeEvent?.location, HighlightType.None));
        continue;
      }
      // A residence only one side has, inside the other's lifetime, tells them nothing
      if (type === "residence") continue;
    }

    // Shown as written, with "About", "Before", "After" and ranges
    const recordDate = recordEvent?.dateText;
    const treeDate = treeEvent?.dateText;
    // People live in places at different times, so residence years that differ (like the 1930 and 1940
    // censuses), or that can't be told apart because one has no year, aren't a conflict; only the places are compared
    const recordYear = recordEvent?.date?.likelyYear ?? undefined;
    const treeYear = treeEvent?.date?.likelyYear ?? undefined;
    const differentTimes = type === "residence" && (recordYear === undefined || treeYear === undefined || recordYear !== treeYear);
    // Scored on the pair shown, which for residences may not be either side's first
    const dateHighlight = recordEvent && treeEvent ? scoreDates(recordEvent, treeEvent) : HighlightType.None;

    const recordPlace = recordEvent?.location;
    const treePlace = treeEvent?.location;
    // Residences are compared by county and state, since census places name wards and districts
    const placeScore = type === "residence" ? scoreResidence(recordPlace, treePlace, !differentTimes) : scorePlace(recordPlace, treePlace);

    // Living somewhere else years apart is ordinary, so those residences tell them nothing; only shown when they agree
    if (differentTimes && (typeof placeScore === "object" ? placeScore.highlight : placeScore) === HighlightType.None) continue;

    // Residence years that differ can't be compared, so instead of a row of their own ("1930 | 1940") they
    // go in front of each place: "1930 · Fall River, Bristol, Massachusetts"
    if (differentTimes) {
      rows.push(row(placeLabel, "place", withYear(recordDate, recordPlace), withYear(treeDate, treePlace), placeScore));
      continue;
    }
    if (recordDate || treeDate) rows.push(row(dateLabel, "date", recordDate, treeDate, dateHighlight));
    if (recordPlace || treePlace) rows.push(row(placeLabel, "place", recordPlace, treePlace, placeScore));
  }

  // A spouse on one side with the surname the other side uses explains it: the tree's Fannie Hanovich
  // married a Silverman, so the record's Fannie Silverman fits. Her own side's spouse always shares her surname, so proves nothing.
  if (rows[0].reason === "Maybe a married name") {
    const married = hasSurname(spouseSurnames.tree, recordPerson.lastName) ? recordPerson.lastName
      : hasSurname(spouseSurnames.record, treePerson?.lastName) ? treePerson?.lastName : undefined;
    if (married) rows[0] = { ...rows[0], reason: `Married name: spouse is a ${married.trim()}` };
  }

  // A common name is only worth flagging when nothing else narrows it down: no family on the hint
  // (a whole matching family is strong evidence) and no exact birth date on both sides
  const name = rows[0];
  if (name.reason === "Common name") {
    const born = rows.find((row) => row.label === "Born");
    const exactBirth = Boolean(born?.record && born.record === born.tree && /^\d{1,2} /.test(born.record));
    if (!flagCommonName || exactBirth) rows[0] = { ...name, status: "ok", reason: undefined };
  }

  return rows;
}

/** Youngest and oldest ages at which someone is believably a parent. */
const MIN_PARENT_AGE = 13;
const MAX_FATHER_AGE = 75;
const MAX_MOTHER_AGE = 50;

/**
 * Checks a family member on the record against the tree person's lifetime. A son born when the
 * tree person was 8, or after they died, is a clue that doesn't show up fact by fact.
 * A relative only the tree side lists is checked against the record's person with swapSides set, so the
 * relative's facts go in the tree column and the person's in the record column.
 * @param member - The family member on the record.
 * @param treeFocus - The tree person the record would be attached to.
 * @param swapSides - Whether the member is a tree-side relative checked against the record's person.
 * @returns A "Timeline" row for each problem found; usually none.
 */
export function familyTimelineRows(member: Person, treeFocus: Person | undefined, swapSides: boolean = false): CompareRow[] {
  if (!treeFocus) return [];
  const memberBorn = lifeYears(member).born;
  const { born, died } = lifeYears(treeFocus);
  if (memberBorn === undefined) return [];

  const name = (treeFocus.firstName ?? "").trim().split(/\s+/)[0] || "the tree person";
  const relationship = String(member.relationship ?? "").toLowerCase();
  const problems: { tree: string; reason: string }[] = [];

  if (["son", "daughter", "child"].includes(relationship)) {
    if (born !== undefined) {
      const age = memberBorn - born;
      const maxAge = treeFocus.sex === "female" ? MAX_MOTHER_AGE : MAX_FATHER_AGE;
      if (age < MIN_PARENT_AGE) problems.push({ tree: `${name} born ${born}`, reason: age < 0 ? `Born before ${name}` : `Born when ${name} was ${age}` });
      else if (age > maxAge) problems.push({ tree: `${name} born ${born}`, reason: `Born when ${name} was ${age}` });
    }
    // A father can die before his child is born, but not by more than about a year
    const lastYear = died === undefined ? undefined : died + (treeFocus.sex === "female" ? 0 : 1);
    if (died !== undefined && lastYear !== undefined && memberBorn > lastYear) {
      const gap = memberBorn - died;
      problems.push({ tree: `${name} died ${died}`, reason: `Born ${gap} year${gap === 1 ? "" : "s"} after ${name} died` });
    }
  }

  if (["father", "mother", "parent"].includes(relationship) && born !== undefined && born - memberBorn < MIN_PARENT_AGE) {
    problems.push({
      tree: `${name} born ${born}`,
      reason: born - memberBorn <= 0 ? `Born after ${name}` : `Only ${born - memberBorn} years older than ${name}`,
    });
  }

  return problems.map(({ tree, reason }) => ({
    label: "Timeline",
    kind: "date",
    record: swapSides ? tree : `Born ${memberBorn}`,
    tree: swapSides ? `Born ${memberBorn}` : tree,
    status: "bad",
    reason,
  }));
}
