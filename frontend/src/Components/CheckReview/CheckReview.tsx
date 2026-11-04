import { ReactElement } from "react";
import { CompareRow } from "../CompareTable/compareRows";
import "./CheckReview.css";

/** The most facts shown: enough to see why, short enough to read on a phone. */
const MAX_FACTS = 4;

/** Facts that tell people apart best come first. */
const FACT_ORDER = ["Name", "Born", "Birthplace", "Died", "Death place", "Sex"];

/** A fact shown in the review, with whose fact it is when it's a relative's. */
export interface ReviewFact extends CompareRow {
  who?: string;
}

/** What a missed check hint showed, kept when it's answered so it can be explained after. */
export interface CheckReviewData {
  /** The check hint's answer: 1 the same person, -1 different people. */
  expected: 1 | -1;
  facts: ReviewFact[];
  /** Relatives both people share, as "wife Anna and son John", when the answer is the same person. */
  sameFamily?: string;
  /** Facts that disagree although it's the same person. */
  conflicts: number;
  /** Whether the miss started the answers-in-a-row count over. */
  streakLost: boolean;
}

/**
 * Ranks a fact for the review: the ones that tell people apart best first.
 * @param row - A comparison row.
 * @returns Its place in FACT_ORDER, or after them.
 */
function rank(row: CompareRow): number {
  const i = FACT_ORDER.indexOf(row.label);
  return i < 0 ? FACT_ORDER.length : i;
}

/**
 * Checks whether a row has a value to show on either side.
 * @param row - A comparison row.
 * @returns True when it has one.
 */
function shown(row: CompareRow): boolean {
  return Boolean(row.record || row.tree);
}

/**
 * Picks the facts that show a check hint's answer: for different people, what disagrees, the main person's first
 * and then their family's; for the same person, what matches.
 * @param expected - The check hint's answer.
 * @param people - Each person's comparison rows: the main person first, then their family with their heading.
 * @returns The facts to show.
 */
export function reviewFacts(expected: 1 | -1, people: { heading: string; rows: CompareRow[] }[]): ReviewFact[] {
  const main = people[0]?.rows ?? [];
  if (expected === 1) {
    return main.filter((row) => row.status === "ok" && row.record && row.tree)
      .sort((a, b) => rank(a) - rank(b)).slice(0, MAX_FACTS);
  }
  // Conflicts before variations, then the facts that tell people apart best
  const differences = main.filter((row) => (row.status === "bad" || row.status === "close") && shown(row))
    .sort((a, b) => Number(a.status !== "bad") - Number(b.status !== "bad") || rank(a) - rank(b));
  const family = people.slice(1).flatMap((person) => person.rows
    .filter((row) => row.status === "bad" && shown(row))
    .map((row) => ({ ...row, who: person.heading })));
  return [...differences, ...family].slice(0, MAX_FACTS);
}

/**
 * CheckReview Component - After a missed check hint, says what its answer was and shows the facts that show it, so
 * the next one goes better. Answering waits until "Got it".
 * @param {Object} props - Component props.
 * @param {CheckReviewData} props.review - What the check hint showed.
 * @param {[string, string]} props.sides - The two columns' names, like "Person 1" and "Person 2".
 * @param {() => void} props.onClose - Closes the review.
 * @returns {ReactElement} The review, centered over the page.
 */
export default function CheckReview({ review, sides, onClose }: {
  review: CheckReviewData;
  sides: [string, string];
  onClose: () => void;
}): ReactElement {
  const same = review.expected === 1;
  return (
    <div className="streak-lost-overlay" role="alertdialog" aria-labelledby="check-review-title" aria-describedby="check-review-answer">
      <div className="streak-lost check-review">
        <div className="check-review-title" id="check-review-title">That was a check hint</div>
        <p className="check-review-answer" id="check-review-answer">
          {same ? <>These two are <b>the same person</b>.</> : <>These are <b>two different people</b>.</>}
        </p>
        {review.facts.length > 0 && (
          <>
            <div className="check-review-lead">{same ? "What matches:" : "What tells them apart:"}</div>
            <div className="check-review-table">
              <div className="check-review-row check-review-row--head" aria-hidden="true">
                <span />
                <span>{sides[0]}</span>
                <span>{sides[1]}</span>
                <span />
              </div>
              {review.facts.map((fact, i) => (
                <div key={i} className={`check-review-row check-review-row--${fact.status}`}>
                  <span className="check-review-label">{fact.who ? <>{fact.who}<br />{fact.label.toLowerCase()}</> : fact.label}</span>
                  <span>{fact.record || "–"}</span>
                  <span>{fact.tree || "–"}</span>
                  <span className={`check-review-icon check-review-icon--${fact.status}`}
                    aria-label={fact.status === "ok" ? "Matches" : fact.status === "close" ? "Close" : "Doesn’t match"}>
                    {fact.status === "ok" ? "✓" : fact.status === "close" ? "!" : "✕"}
                  </span>
                  {fact.reason && fact.status !== "ok" && <span className={`check-review-reason check-review-reason--${fact.status}`}>{fact.reason}</span>}
                </div>
              ))}
            </div>
          </>
        )}
        {same && review.sameFamily && <p className="check-review-note"><b>Same family:</b> {review.sameFamily}.</p>}
        {same && review.conflicts > 0 && (
          <p className="check-review-note">
            {review.conflicts === 1 ? "One fact disagrees" : `${review.conflicts} facts disagree`}, but more match: one side probably has a mistake.
          </p>
        )}
        <p className="check-review-care">
          {review.streakLost ? "Your count of answers in a row starts over. " : ""}
          Check hints help keep answers accurate, so please take a little more care.
        </p>
        <button type="button" className="reward-continue" autoFocus onClick={onClose}>
          Got it
        </button>
      </div>
    </div>
  );
}
