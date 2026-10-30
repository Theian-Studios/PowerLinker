import FlexibleDate from "flexibledatets";

export interface IEvent {
  name: string;
  date?: string;
  place?: string;
}

// TODO: transform from IEvent to Event

/** Words before a date that make it approximate: "abt 1850", "Before 1850", "aft. 1850". */
export type DateQualifier = "about" | "before" | "after";

const QUALIFIERS: [DateQualifier, RegExp][] = [
  ["about", /^(~|(abt|about|approx(imately)?|around|circa|ca|c|est(imated)?|calc(ulated)?)\b\.?)/],
  ["before", /^(bef|before)\b/],
  ["after", /^(aft|after)\b/],
];

/** Years either side of an "about" date that still agree with it. */
const ABOUT_YEARS = 2;

/**
 * Represents a life event with its type, location, and date information.
 * This class stores details about significant events in a person's life,
 * such as birth, death, marriages, or relocations.
 */
export class Event {
  type?: string;
  location?: string;
  date?: FlexibleDate;
  /** The date as written, since parsing drops "about", "before", "after" and the end of a range. */
  rawDate?: string;

  /**
   * Creates a new Event instance with the provided details.
   * @param type - The category or type of event (e.g., birth, marriage, death).
   * @param location - The geographical location where the event occurred.
   * @param day - The day of the month when the event occurred.
   * @param month - The month when the event occurred.
   * @param year - The year when the event occurred.
   */
  constructor(data: IEvent) {
    this.type = data.name;
    this.location = data.place;

    if (!data.date) return;
    this.rawDate = String(data.date).trim();
    
    try {
      const fd = new FlexibleDate(null);
      this.date = fd.createFlexibleDate((data.date).toString());
    } catch (e) {
      console.error("Error parsing date: ", data.date, e);
    }
  }

  /**
   * Gets the word that makes the date approximate, if the date was written with one.
   * @returns "about", "before" or "after", or undefined for a plain date.
   */
  get qualifier(): DateQualifier | undefined {
    const raw = this.rawDate?.toLowerCase() ?? "";
    return QUALIFIERS.find(([, pattern]) => pattern.test(raw))?.[0];
  }

  /**
   * Gets the last year of a date written as a range, like "1848-1852" or "between 1848 and 1852".
   * @returns The range's last year, or undefined when the date isn't a range.
   */
  get endYear(): number | undefined {
    const range = this.rawDate?.match(/(\d{4})\s*(?:-|–|—|to|and)\s*(\d{4})/i);
    return range && Number(range[2]) > Number(range[1]) ? Number(range[2]) : undefined;
  }

  /**
   * Gets whether the date is approximate or a range rather than a single known date.
   * @returns True for "about", "before", "after" and ranges.
   */
  get isApproximate(): boolean {
    return Boolean(this.qualifier || this.endYear);
  }

  /**
   * Gets the date for display, keeping "About", "Before", "After" and ranges that parsing drops.
   * @returns For example "About 1850" or "1848–1852", or undefined when there's no date.
   */
  get dateText(): string | undefined {
    const parsed = this.date?.toString();
    // A date the parser couldn't read is still worth showing as written
    if (!parsed) return this.rawDate || undefined;
    if (this.endYear) return `${parsed}–${this.endYear}`;
    const qualifier = this.qualifier;
    return qualifier ? `${qualifier.charAt(0).toUpperCase()}${qualifier.slice(1)} ${parsed}` : parsed;
  }

  /**
   * Gets the years the date could fall in: "about 1850" is 1848 to 1852, "before 1850" any year up to 1850.
   * @param loose - Whether "about" widens to a few years either side; without it, "about 1850" is just 1850.
   * @returns The first and last possible years (open ends are infinite), or undefined without a year.
   */
  yearRange(loose: boolean = true): [number, number] | undefined {
    const year = this.date?.likelyYear;
    if (year === undefined || year === null) return undefined;
    if (this.endYear) return [year, this.endYear];
    switch (this.qualifier) {
      case "about":
        return loose ? [year - ABOUT_YEARS, year + ABOUT_YEARS] : [year, year];
      case "before":
        return [-Infinity, year];
      case "after":
        return [year, Infinity];
      default:
        return [year, year];
    }
  }

  /**
   * Gets a sanitized version of the event type.
   * @returns The event type, lowercased, with brackets and parentheses removed.
   */
  get sanitizedType() {
    return this.type?.replace(/[[\]()]/g, "").trim().toLowerCase() || "undefined";
  }
}
