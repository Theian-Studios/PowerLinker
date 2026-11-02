import "./CompareTable.css";
import { ReactElement } from "react";
import { CompareRow, Status } from "./compareRows";

const STATUS_ICON: Record<Status, { symbol: string; label: string }> = {
  ok: { symbol: "✓", label: "Matches" },
  close: { symbol: "!", label: "Close, but not exact" },
  bad: { symbol: "✕", label: "Doesn't match" },
  // Rows with only one side get no mark at all
  none: { symbol: "", label: "Nothing to compare" },
};

/**
 * CompareTable Component - Compares one person on the record with their match on the tree, fact by fact.
 * @param props - Component props.
 * @param props.rows - The comparison rows, from buildRows.
 * @param props.heading - Optional heading, such as "Spouse", shown when a hint has several people.
 * @param props.notOnTree - True when this person has no match on the tree.
 * @param props.sides - Column headings; "Person 1" and "Person 2" when comparing two people on the tree.
 * @returns {ReactElement} The comparison table.
 */
export default function CompareTable({ rows, heading, notOnTree, sides = ["Record", "Tree"] }: {
  rows: CompareRow[];
  heading?: string;
  notOnTree: boolean;
  sides?: [string, string];
}): ReactElement {
  // A missing value shows a plain dash; a person with no tree match still says so
  return (
    <section className="compare">
      {heading && <h3 className="compare-heading">{heading}</h3>}
      <div className="compare-table" role="table" aria-label={`${heading ? `${heading}: ` : ""}${sides[0]} compared with ${sides[1]}`}>
        <div className="compare-row compare-row--head" role="row">
          {/* On desktop the heading moves into this row, so it sticks along with it */}
          <span role="columnheader" className="compare-label" aria-label="Detail">
            {heading && <span className="compare-head-person">{heading}</span>}
          </span>
          <span role="columnheader">{sides[0]}</span>
          <span role="columnheader">{sides[1]}</span>
          <span role="columnheader" className="compare-status" aria-label="Match"></span>
        </div>
        {rows.map((row, i) => <CompareFact key={row.label + i} row={row} first={i === 0} notOnTree={notOnTree} sides={sides} />)}
      </div>
    </section>
  );
}

/**
 * CompareFact Component - One fact compared side by side, with its mark and the reason for it.
 * @param props - Component props.
 * @param props.row - The comparison row.
 * @param props.first - True for a person's first row, their name.
 * @param props.notOnTree - True when this person has no match on the other side.
 * @param props.sides - Column headings, which decide how a missing match is worded.
 * @returns {ReactElement} The row.
 */
export function CompareFact({ row, first, notOnTree, sides }: {
  row: CompareRow;
  first: boolean;
  notOnTree: boolean;
  sides: [string, string];
}): ReactElement {
  return (
    <div className={`compare-row compare-row--${row.status}${first ? " compare-row--name" : ""}`} role="row">
      <span className="compare-label" role="rowheader">{row.label}</span>
      {/* A shortened place shows in full on hover */}
      <span className="compare-value" role="cell" title={row.recordFull}>
        {row.record ? row.record : <span className="compare-missing" aria-label="Not given">–</span>}
      </span>
      <span className="compare-value" role="cell" title={row.treeFull}>
        {row.tree ? row.tree : (first && notOnTree
          ? <span className="compare-missing">{sides[1] === "Tree" ? "not on tree" : "not listed"}</span>
          : <span className="compare-missing" aria-label="Not given">–</span>)}
      </span>
      {/* Why a close or conflicting row is marked, right under the values: "1 year apart", "Different states" */}
      {row.reason && (row.status === "close" || row.status === "bad" || row.showReason) && (
        <span className={`compare-reason compare-reason--${row.status}${row.reasonSide ? ` compare-reason--${row.reasonSide}` : ""}`}>{row.reason}</span>
      )}
      <span className="compare-status" role="cell">
        <span
          className={`status-icon status-icon--${row.status}`}
          title={row.reason ? `${STATUS_ICON[row.status].label}: ${row.reason}` : STATUS_ICON[row.status].label}
          aria-label={row.reason ? `${STATUS_ICON[row.status].label}: ${row.reason}` : STATUS_ICON[row.status].label}
        >
          {STATUS_ICON[row.status].symbol}
        </span>
      </span>
    </div>
  );
}
