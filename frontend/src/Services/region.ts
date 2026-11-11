// Which version of the site this is. The Chilean site (built with VITE_REGION=cl, served at /chile/) is in Spanish,
// gets its hints from the Sheet's Chile tabs, and compares names and places the Chilean way: two surnames, Spanish
// nicknames, regions and communes. Everything else is the same app.

/** True on the Chilean site. Outside Vite (scripts that test the scoring), set globalThis.VITE_REGION first. */
export const CHILE = (import.meta.env?.VITE_REGION ?? (globalThis as { VITE_REGION?: string }).VITE_REGION) === "cl";

/**
 * Picks the text for this site: the English, or on the Chilean site the Spanish. Volunteers are addressed as tú.
 * @param english - The text on the English site.
 * @param spanish - The same text in Spanish.
 * @returns The one this site shows.
 */
export function tr(english: string, spanish: string): string {
  return CHILE ? spanish : english;
}


/**
 * Opens FamilySearch in this site's language: on the Chilean site its pages (tree pages, records, the attach tool)
 * open in Spanish. Links anywhere else are left as they are.
 * @param url - A link, which may be to FamilySearch.
 * @returns The link to open.
 */
export function inSiteLanguage(url: string | undefined): string | undefined {
  if (!CHILE || !url || !/^https:\/\/(www\.)?familysearch\.org\//.test(url)) return url;
  const link = new URL(url);
  link.searchParams.set("lang", "es");
  return link.toString();
}
