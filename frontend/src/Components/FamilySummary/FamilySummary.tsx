import "./FamilySummary.css";
import { Fragment, ReactElement, useEffect, useState } from "react";
import { CompareFact } from "../CompareTable/CompareTable";
import { CompareRow } from "../CompareTable/compareRows";

export interface FamilyMember {
  /** Relationship to the main person, e.g. "Son". */
  heading: string;
  /** First name on the record, used in the note about matching family. */
  name: string;
  /** First name and surname, shown in the summary lines. */
  fullName?: string;
  rows: CompareRow[];
  notOnTree: boolean;
  /** Listed only on the tree side: Person 2's family on a possible duplicate. */
  onlyOnTree?: boolean;
}

type Worst = "bad" | "close" | "ok" | "none";

interface Entry {
  /** The relative's name, or their relationship when there's no name. */
  who: string;
  /** Relationship, shown after the name, e.g. "son". */
  relation?: string;
  worst: Worst;
  onlyOnTree?: boolean;
  /** Conflicts first, then variations. */
  issues: CompareRow[];
  /** What matches, e.g. "same name, birth year and birthplace". */
  matches?: string;
}

/** Differences listed per person; the rest are counted in the link to the full tables. */
const MAX_PER_PERSON = 2;

const ORDER: Record<Worst, number> = { bad: 0, close: 1, none: 2, ok: 3 };
const ICON: Record<Worst, string> = { bad: "✕", close: "!", ok: "✓", none: "" };

/** Events with a date row and a place row, and the word each goes by in a list. */
const EVENTS: [string, string, string][] = [
  ["Born", "Birthplace", "birth"],
  ["Died", "Death place", "death"],
  ["Married", "Marriage place", "marriage"],
  ["Buried", "Burial place", "burial"],
];

/**
 * Joins words into a list: "a", "a and b", "a, b and c".
 * @param words - At least one word or phrase.
 * @returns One phrase joined with commas and "and".
 */
function joinList(words: string[]): string {
  return words.length === 1 ? words[0] : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/**
 * Says which facts match, like "matching name, birth and death". An event whose date and place both
 * match is one word, so the line stays short.
 * @param rows - One family member's comparison rows.
 * @returns The phrase, or undefined when nothing was compared.
 */
function describeMatches(rows: CompareRow[]): string | undefined {
  /**
   * Finds a matching row.
   * @param label - The row's label, e.g. "Born".
   * @returns The row if it's green.
   */
  const ok = (label: string): CompareRow | undefined => rows.find((row) => row.label === label && row.status === "ok");
  const same: string[] = [];
  if (ok("Name")) same.push("name");
  for (const [dateLabel, placeLabel, word] of EVENTS) {
    const date = ok(dateLabel);
    const place = ok(placeLabel);
    if (date && place) same.push(word);
    else if (date) same.push(`${word} ${/\d{1,2} \S+ \d{4}/.test(date.record ?? "") ? "date" : "year"}`);
    else if (place) same.push(placeLabel.toLowerCase());
  }
  if (ok("Residence")) same.push("town");
  if (same.length === 0) return undefined;
  return `matching ${joinList(same)}`;
}

/**
 * Sums up each family member: their worst status and what differs, people with problems first.
 * @param family - The family members after the main person.
 * @returns One entry per family member.
 */
function summarize(family: FamilyMember[]): Entry[] {
  return family
    .map((member) => {
      const issues = member.rows
        .filter((row) => row.status === "bad" || row.status === "close")
        .sort((a, b) => ORDER[a.status as Worst] - ORDER[b.status as Worst]);
      const worst: Worst = issues.length ? (issues[0].status as Worst) : member.notOnTree || member.onlyOnTree ? "none" : "ok";
      // Name first, so the relationship reads as a label rather than part of the name
      const who = member.fullName || member.name;
      const relation = (member.heading === "Other" ? "relative" : member.heading).toLowerCase();
      return { who: who || member.heading, relation: who ? relation : undefined, worst, issues, onlyOnTree: member.onlyOnTree, matches: describeMatches(member.rows) };
    })
    .sort((a, b) => ORDER[a.worst] - ORDER[b.worst]);
}

/**
 * FamilySummary Component - The family under the main person, condensed to only what's different.
 * Every fact is one click away, in one side-by-side table that fills the card.
 * @param props - Component props.
 * @param props.family - The family members after the main person.
 * @param props.sides - Column headings; "Person 1" and "Person 2" when comparing two people on the tree.
 * @returns {ReactElement | null} The summary list, or nothing when two people share no relatives to compare.
 */
export default function FamilySummary({ family, sides }: { family: FamilyMember[]; sides?: [string, string] }): ReactElement | null {
  const [showAll, setShowAll] = useState<boolean>(false);
  // Each new hint starts with the short summary again
  useEffect(() => setShowAll(false), [family]);

  // Comparing two people, a relative listed for only one of them can't be checked against anything, unless
  // their dates rule something out, like a child born when the other person was 8
  const compared = sides
    ? family.filter((member) => (!member.notOnTree && !member.onlyOnTree) || member.rows.some((row) => row.status === "bad"))
    : family;
  if (compared.length === 0) return null;

  const entries = summarize(compared);
  // Differences left out of the summary; the one link at the bottom opens them with everything else
  const hidden = entries.reduce((sum, entry) => sum + Math.max(0, entry.issues.length - MAX_PER_PERSON), 0);

  const columns: [string, string] = sides ?? ["Record", "Tree"];
  const title = sides ? "Family" : "Family on the record";

  return (
    <section className="family" aria-label={sides ? `Family of ${sides[0]}` : "Family on the record"}>
      {showAll ? (
        <div className="family-table" role="table" aria-label={`${title}: ${columns[0]} compared with ${columns[1]}`}>
          {/* The card's gray header doubles as the column headings, so there's one header, not two */}
          <div className="compare-row compare-row--head family-head" role="row">
            <span role="columnheader" className="compare-label family-head-title">{title}</span>
            <span role="columnheader">{columns[0]}</span>
            <span role="columnheader">{columns[1]}</span>
            <span role="columnheader" className="compare-status" aria-label="Match"></span>
          </div>
          {compared.map((member, i) => (
            <Fragment key={i}>
              <div className="family-group" role="row">
                <span role="rowheader">{member.heading}</span>
              </div>
              {member.rows.filter((row) => row.record || row.tree).map((row, j) => (
                <CompareFact key={row.label + j} row={row} first={j === 0} notOnTree={member.notOnTree} sides={columns} />
              ))}
            </Fragment>
          ))}
        </div>
      ) : (
        <>
          {/* Gray header row, like the comparison tables */}
          <h3 className="family-title">{title}</h3>
          <ul className="family-lines">
            {entries.map((entry, i) => (
              <li key={i} className={`family-line family-line--${entry.worst}`}>
                <span className={`status-icon status-icon--${entry.worst}`} aria-hidden="true">{ICON[entry.worst]}</span>
                <span className="family-text">
                  <span>
                    <b>{entry.who}</b>
                    {entry.relation && <span className="family-relation"> · {entry.relation}</span>}
                    {entry.worst === "ok" && <span className="family-note"> · {entry.matches ?? "no differences"}</span>}
                    {/* Both people are on the tree when comparing two of them, so it's the other one's family that lacks them */}
                    {entry.worst === "none" && <span className="family-note"> · {sides ? `not listed for ${entry.onlyOnTree ? sides[0] : sides[1]}` : "isn’t on the tree"}</span>}
                  </span>
                  {entry.issues.slice(0, MAX_PER_PERSON).map((row, j) => (
                    <span key={j} className="family-detail">
                      {row.label} ·{" "}
                      {row.reason && <span className={`family-reason family-reason--${row.status}`}>{row.reason} · </span>}
                      <span className="family-values">{row.record} <span className="family-vs">vs</span> {row.tree}</span>
                    </span>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="family-footer">
        <button type="button" className="family-toggle" onClick={() => setShowAll(!showAll)} aria-expanded={showAll}>
          {showAll
            ? "Show only differences ▴"
            : hidden > 0
              ? `See all family facts (+${hidden} more ${hidden === 1 ? "difference" : "differences"}) ▾`
              : "See all family facts ▾"}
        </button>
      </div>
    </section>
  );
}
