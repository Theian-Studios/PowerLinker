import "./FamilySummary.css";
import { ReactElement, useEffect, useState } from "react";
import CompareTable from "../CompareTable/CompareTable";
import { CompareRow } from "../CompareTable/compareRows";

export interface FamilyMember {
  /** Relationship to the main person, e.g. "Son". */
  heading: string;
  /** First name on the record, used in the summary lines. */
  name: string;
  rows: CompareRow[];
  notOnTree: boolean;
  /** Listed only on the tree side: Person 2's family on a possible duplicate. */
  onlyOnTree?: boolean;
}

type Worst = "bad" | "close" | "ok" | "none";

interface Entry {
  who: string;
  worst: Worst;
  onlyOnTree?: boolean;
  /** Conflicts first, then variations. */
  issues: CompareRow[];
}

/** Differences listed per person; the rest are counted in the link to the full tables. */
const MAX_PER_PERSON = 2;

const ORDER: Record<Worst, number> = { bad: 0, close: 1, none: 2, ok: 3 };
const ICON: Record<Worst, string> = { bad: "✕", close: "!", ok: "✓", none: "" };

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
      return { who: `${member.heading} ${member.name}`.trim(), worst, issues, onlyOnTree: member.onlyOnTree };
    })
    .sort((a, b) => ORDER[a.worst] - ORDER[b.worst]);
}

/**
 * FamilySummary Component - The family under the main person, condensed to only what's different.
 * The full tables are one click away.
 * @param props - Component props.
 * @param props.family - The family members after the main person.
 * @param props.sides - Column headings; "Person 1" and "Person 2" when comparing two people on the tree.
 * @returns {ReactElement} The summary list, or the full family tables when expanded.
 */
export default function FamilySummary({ family, sides }: { family: FamilyMember[]; sides?: [string, string] }): ReactElement {
  const [showAll, setShowAll] = useState<boolean>(false);
  // Each new hint starts with the short summary again
  useEffect(() => setShowAll(false), [family]);

  const entries = summarize(family);
  // Differences left out of the summary; the one link at the bottom opens them with everything else
  const hidden = entries.reduce((sum, entry) => sum + Math.max(0, entry.issues.length - MAX_PER_PERSON), 0);

  return (
    <section className="family" aria-label={sides ? `Family of ${sides[0]}` : "Family on the record"}>
      {/* Gray header row, like the comparison tables */}
      <h3 className="family-title">{sides ? "Family" : "Family on the record"}</h3>
      <div className="family-body">
      {showAll ? (
        family.map((member, i) => (
          <CompareTable key={i} rows={member.rows} heading={member.heading} notOnTree={member.notOnTree} sides={sides} />
        ))
      ) : (
        <ul className="family-lines">
          {entries.map((entry, i) => (
            <li key={i} className={`family-line family-line--${entry.worst}`}>
              <span className={`status-icon status-icon--${entry.worst}`} aria-hidden="true">{ICON[entry.worst]}</span>
              <span className="family-text">
                <span>
                  <b>{entry.who}</b>
                  {entry.worst === "ok" && <span className="family-note"> · no differences</span>}
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
      )}
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
