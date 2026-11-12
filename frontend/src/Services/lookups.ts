// Facts about names and places that make a match stronger or weaker, loaded in the background from public/lookups
// (built by scripts/build-lookups.ts): where towns are, how many of our people lived in each, and which names are
// common. The US site loads one small file of names, and a file of towns for each state a hint names; the Chilean site
// one small file. Until a file arrives the app shows the hint without these notes, and adds them when it does.

import { useEffect, useState } from "react";
import { CHILE } from "./region";
import { chilePlace, nameWords, placeParts } from "./highlightScoring";

/**
 * A town: its center and how many of our people lived there, or only the count when its center isn't known. A place
 * that's really a whole county has a fourth number: how far from its center a home could be, in km.
 */
type Town = [number, number, number] | [number, number, number, number] | [number];

/**
 * Towns with this many of our hints or fewer are called small. Our US hints are about 1 in 1,200 people of the 1930
 * census, 1 in 1,400 of 1920 and 1 in 4,400 of 1940, so each hint in a town stands for about 550 residents: 9 hints is
 * roughly 5,000 people. Chile's count is of people born, christened or buried in a commune, from Joe's thinner files.
 */
const SMALL_TOWN_COUNT = CHILE ? 3 : 9;

let names: { surnames: Set<string>; given: Set<string> } | undefined;
let chileCommunes: Record<string, Town> | undefined;
const stateTowns = new Map<string, Record<string, Town> | null>();
const requested = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;

/**
 * Tells everything showing a hint that more lookups have arrived.
 */
function changed(): void {
  version++;
  listeners.forEach((listener) => listener());
}

/**
 * Loads one lookup file once, quietly: a file that can't be loaded just means no extra notes.
 * @param path - The file, under public/lookups.
 * @param use - What to do with its contents.
 */
function load<T>(path: string, use: (data: T | undefined) => void): void {
  if (requested.has(path) || typeof fetch === "undefined") return;
  requested.add(path);
  const base = import.meta.env?.BASE_URL ?? "/";
  fetch(`${base}lookups/${path}`)
    .then((response) => (response.ok ? response.json() : undefined))
    .catch(() => undefined)
    .then((data: T | undefined) => {
      use(data);
      changed();
    });
}

/**
 * Starts loading the names file (and on the Chilean site the communes too). The app calls it through useLookups;
 * scripts that check the scoring call it directly.
 */
export function loadNames(): void {
  if (CHILE) {
    load<{ surnames: string[]; given: string[]; communes: Record<string, Town> }>("cl.json", (data) => {
      if (!data) return;
      names = { surnames: new Set(data.surnames), given: new Set(data.given) };
      chileCommunes = data.communes;
    });
  } else {
    load<{ surnames: string[]; given: string[] }>("us-names.json", (data) => {
      if (data) names = { surnames: new Set(data.surnames), given: new Set(data.given) };
    });
  }
}

/**
 * Re-renders a component when lookups arrive, and starts loading the names.
 * @returns A number that changes each time more lookups arrive, for a hook's dependencies.
 */
export function useLookups(): number {
  const [seen, setSeen] = useState(version);
  useEffect(() => {
    /**
     * Picks up the latest lookups.
     */
    const update = () => setSeen(version);
    listeners.add(update);
    loadNames();
    return () => {
      listeners.delete(update);
    };
  }, []);
  return seen;
}

/** Where a place is and how many of our people lived there. */
export interface PlaceInfo {
  /** The town's key, the same for any spelling of one town. */
  key: string;
  lat?: number;
  lon?: number;
  /** How many of our people lived there. */
  count: number;
  /** For a whole county, how far from its center a home could be, in km. */
  radiusKm?: number;
}

/**
 * Looks a place up: in Chile by its commune, in the US by its town, county and state. A state's towns are loaded the
 * first time a hint names the state, so the first look can come back empty.
 * @param place - The place as written.
 * @returns What's known about it, if anything.
 */
export function placeInfo(place: string | undefined): PlaceInfo | undefined {
  if (!place) return undefined;
  const parts = placeParts(place);
  let town: Town | undefined;
  let key: string | undefined;
  if (CHILE) {
    key = chilePlace(parts).commune;
    town = key ? chileCommunes?.[key] : undefined;
  } else {
    if (parts.length < 3 || parts[parts.length - 1] !== "united states") return undefined;
    const state = parts[parts.length - 2];
    if (!stateTowns.has(state)) {
      stateTowns.set(state, null);
      load<Record<string, Town>>(`us/${state.replace(/\s+/g, "-")}.json`, (data) => stateTowns.set(state, data ?? null));
      return undefined;
    }
    key = parts.slice(0, -2).join("|");
    town = stateTowns.get(state)?.[key];
    key = `${key}|${state}`;
  }
  if (!town || !key) return undefined;
  if (town.length === 1) return { key, count: town[0] };
  return { key, lat: town[0], lon: town[1], count: town[2], ...(town.length === 4 ? { radiusKm: town[3] } : {}) };
}

/**
 * Checks whether a town is small: few of our hints had someone living there, so a match there means more.
 * @param info - The town, from placeInfo.
 * @returns True for a small town.
 */
export function isSmallTown(info: PlaceInfo | undefined): boolean {
  return Boolean(info && info.count > 0 && info.count <= SMALL_TOWN_COUNT);
}

/**
 * Measures the distance between two places' centers, along the earth's surface.
 * @param a - One place.
 * @param b - The other.
 * @returns Kilometers, or undefined when either center isn't known.
 */
export function distanceKm(a: PlaceInfo | undefined, b: PlaceInfo | undefined): number | undefined {
  if (a?.lat === undefined || a.lon === undefined || b?.lat === undefined || b.lon === undefined) return undefined;
  const radians = Math.PI / 180;
  const dLat = (b.lat - a.lat) * radians;
  const dLon = (b.lon - a.lon) * radians;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * radians) * Math.cos(b.lat * radians) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

/**
 * Says which parts of a name are rare: not among the given names and surnames common in our own records (the 1920 to
 * 1940 censuses in the US, Joe's files in Chile).
 * @param given - The given names.
 * @param surname - The surname; in Chile its first word, the father's surname, is the one checked.
 * @returns Which parts are rare, or undefined until the names have loaded.
 */
export function nameRarity(given: string, surname: string): { given: boolean; surname: boolean } | undefined {
  if (!names) return undefined;
  const first = nameWords(given)[0] ?? "";
  const surnameWords = nameWords(surname).filter((word) => !["de", "del", "la", "las", "los", "y", "e", "i"].includes(word));
  const last = CHILE ? surnameWords[0] ?? "" : surnameWords.join("");
  return {
    given: first.length > 1 && !names.given.has(first),
    surname: last.length > 1 && !names.surnames.has(last),
  };
}
