import "./DocumentMatcher.css";
import { usingSheets } from "../../Services/sheetsApi";
import { useEffect, useMemo, useRef, useState, useContext } from "react";
import CompareTable from "../CompareTable/CompareTable";
import FamilySummary, { FamilyMember } from "../FamilySummary/FamilySummary";
import { buildRows, familyTimelineRows } from "../CompareTable/compareRows";
import HintSidebar, { PersonRows } from "../HintSidebar/HintSidebar";
import Match from "../../Models/Match";
import { Loading } from "../Loading/Loading";
import { HintInfo } from "../../Models/Hint.ts";
import { CONTEXT, ContextState, saveProgress } from "../../Models/Context.ts";
import { Relationship } from "../../Models/Relationship.ts";
import useSlowDownNudge from "../../Hooks/useSlowDownNudge.ts";
import { haptic } from "../../Services/haptics.ts";

/** Tree relationships a record relationship can match, since records are often less specific ("parent"). */
const RELATIVE_KINDS: Partial<Record<Relationship, Relationship[]>> = {
  [Relationship.Parent]: [Relationship.Father, Relationship.Mother, Relationship.Parent],
  [Relationship.Father]: [Relationship.Father, Relationship.Parent],
  [Relationship.Mother]: [Relationship.Mother, Relationship.Parent],
  [Relationship.Child]: [Relationship.Son, Relationship.Daughter, Relationship.Child],
  [Relationship.Son]: [Relationship.Son, Relationship.Child],
  [Relationship.Daughter]: [Relationship.Daughter, Relationship.Child],
  [Relationship.Sibling]: [Relationship.Brother, Relationship.Sister, Relationship.Sibling],
  [Relationship.Brother]: [Relationship.Brother, Relationship.Sibling],
  [Relationship.Sister]: [Relationship.Sister, Relationship.Sibling],
};

/** How long the answer buttons pause when a new hint appears. */
const NEXT_HINT_PAUSE_MS = 350;

/** Conflicting facts at which "Same person" counts as a wrong answer: one can be a typo, several rarely are. */
const STRONG_CONFLICTS = 2;

/**
 * Builds the address of a person's page on the FamilySearch tree.
 * @param pid - Their tree person ID, like "LBY6-HSX".
 * @returns The page address, or undefined without an ID.
 */
function treePageUrl(pid?: string): string | undefined {
  return pid ? `https://www.familysearch.org/tree/person/details/${encodeURIComponent(pid)}` : undefined;
}

/**
 * DocumentMatcher Component - Main component contains the table and buttons for matching records and tree people.
 * @param {Object} props - Component props.
 * @param {(submit: -1 | 0 | 1, likelyWrong?: boolean) => void} props.submit - Function to call when submitting a match decision (-1 = not a match, 0 = skip, 1 = attach all); likelyWrong marks "Same person" despite strong conflicts.
 * @param {boolean} props.loading - Indicates if the component is in a loading state.
 * @param {(loading: boolean) => void} props.setLoading - Function to set the loading state.
 * @param {boolean} props.loadError - Whether the last attempt to load hints failed.
 * @param {() => void} props.onRetry - Tries loading hints again.
 * @returns {JSX.Element} The DocumentMatcher Section.
 */
export default function DocumentMatcher({ submit, loading, setLoading, hintType, setHintType, loadError, onRetry }: {
  submit: (submit: -1 | 0 | 1, likelyWrong?: boolean) => void;
  loading: boolean;
  setLoading: (loading: boolean) => void;
  hintType: string;
  setHintType: (hintType: string) => void;
  loadError: boolean;
  onRetry: () => void;
}) {
  const [matches, setMatches] = useState<Match[]>([]);
  const [buttonsEnabled, setButtonsEnabled] = useState<boolean>(false);
  // const [attachEnabled, setAttachEnabled] = useState<boolean>(false);
  const [tree, setTree] = useState<HintInfo | null>(null);
  const [record, setRecord] = useState<HintInfo | null>(null);
  const buttonsEnablingTimeout = useRef<ReturnType<typeof setTimeout>>();
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const BUTTONS_ENABLING_TIMEOUT_DURATION_MS = 700;
  const [warnUser, setWarnUser] = useState<boolean>(false);
  // "Not sure" first offers the original record, unless they've already opened it for this hint
  const [askSource, setAskSource] = useState<boolean>(false);
  const [sourceOpened, setSourceOpened] = useState<boolean>(false);

  const { context, setContext } = useContext(CONTEXT) as ContextState;
  const { showNudge, recordVote, dismissNudge } = useSlowDownNudge(context.hintQue[0]);

  /**
   * Records how quickly the vote was made, then submits it.
   * @param value - The vote (-1 = not a match, 0 = skip, 1 = attach all).
   */
  function vote(value: -1 | 0 | 1) {
    haptic("tap");
    recordVote(value);
    // "Same person" on a hint with several conflicting facts is treated as a wrong answer for the streak
    submit(value, value === 1 && conflictCount >= STRONG_CONFLICTS);
  }

  /**
   * Answers "Not sure", but first suggests the original record, which may have more details.
   */
  function voteUnsure() {
    if (context.hintQue[0]?.url && !sourceOpened && !askSource) {
      haptic("tap");
      setAskSource(true);
      return;
    }
    setAskSource(false);
    vote(0);
  }

  /**
   * Puts the last reviewed hint back on screen.
   */
  function goBack() {
    haptic("tap");
    setContext(prev => {
      if (prev.reviewedHints.length === 0) return prev;
      const previous = prev.reviewedHints[prev.reviewedHints.length - 1];
      const last = { ...previous, complete: false, counted: false };
      // Undo exactly what that answer added, so going back several times can't inflate the count
      const streak = Math.max(0, prev.streak - (previous.counted ? 1 : 0));
      saveProgress(streak, prev.points);
      return {
        ...prev,
        streak,
        lastCounted: false,
        hintQue: [last, ...prev.hintQue],
        reviewedHints: prev.reviewedHints.slice(0, -1)
      };
    });
  }

  useEffect(() => {
    // Nothing to show yet; Home handles loading, errors and running out of hints
    if (context.hintQue.length === 0) {
      return;
    }

    // Set the items for the current hint
    setTree(context.hintQue[0].treeData);
    setRecord(context.hintQue[0].recordInfo);
    setLoading(false);

    return () => {};

    // eslint-disable-next-line
  }, [context.hintQue[0]]);

  useEffect(() => {
      // if no warnings are given, we can skip this
      if (context.strikes === 0){
        return;
      }

      // Otherwise for the first and second warning we want to 
      // add a cautionary popup
      setWarnUser(true);

  }, [context.strikes]);

  useEffect(() => {
    if (!tree?.persons) return console.error("tree persons is null or undefined");
    if (!record?.persons) return console.error("record persons is null or undefined");

    const combinedRecordPeople = record.persons
    const combinedTreePeople = tree.persons
    const relationshipOrder = [
      Relationship.FocusPerson,
      Relationship.Father,
      Relationship.Mother,
      Relationship.Parent,
      Relationship.Spouse,
      Relationship.Son,
      Relationship.Daughter,
      Relationship.Child,
      Relationship.Brother,
      Relationship.Sister,
      Relationship.Sibling,
      Relationship.Other
    ];
    // Unlisted relationships go last; indexOf's -1 would otherwise sort them ahead of the focus person
    const ranks = new Map(relationshipOrder.map((relationship, i) => [relationship, i]));

    // Ensure focus person is in the list
    if (!combinedRecordPeople?.includes(record.focusPerson)) {
      combinedRecordPeople?.unshift(record.focusPerson)
    }
    if (!combinedTreePeople?.includes(tree.focusPerson)) {
      combinedTreePeople?.unshift(tree.focusPerson)
    }

    // Sort people by order of 1. focus person, 2. father, 3. mother, and so forth
    const sortedRecordPeople = combinedRecordPeople?.sort((a, b) => (ranks.get(a.relationship) ?? ranks.size) - (ranks.get(b.relationship) ?? ranks.size));
    const sortedTreePeople = combinedTreePeople.sort((a, b) => (ranks.get(a.relationship) ?? ranks.size) - (ranks.get(b.relationship) ?? ranks.size));

    let _matches = sortedRecordPeople?.map((recordPerson) => {
      let matchingTreePeople = sortedTreePeople.filter(
        (treePerson) => Boolean(recordPerson.matchpid) && treePerson.pid === recordPerson.matchpid
      );
      // The hint pairs the record's focus person with the tree's focus person, even when the record's
      // match ID points somewhere else (seen on live hints, e.g. after tree people were merged)
      if (matchingTreePeople.length === 0 && recordPerson.relationship === Relationship.FocusPerson && tree.focusPerson) {
        matchingTreePeople = [tree.focusPerson];
      }
      // A relative whose match ID points elsewhere can still be paired by kind and first name:
      // the record's "parent Hipolito" is the tree's "father Hipolito"
      if (matchingTreePeople.length === 0 && recordPerson.relationship !== Relationship.FocusPerson) {
        const kinds = RELATIVE_KINDS[recordPerson.relationship] ?? [recordPerson.relationship];
        const first = (recordPerson.firstName ?? "").trim().split(/\s+/)[0]?.toLowerCase();
        const byName = sortedTreePeople.find((treePerson) =>
          kinds.includes(treePerson.relationship) && first && (treePerson.firstName ?? "").toLowerCase().split(/\s+/).includes(first));
        if (byName) matchingTreePeople = [byName];
      }

      return {
        recordPerson,
        matchingTreePeople: matchingTreePeople,
        selectedCandidateIndex: matchingTreePeople.length >= 1 ? 0 : undefined,
      };
    });

    setMatches(_matches || []);
    if (record.focusPerson) setLoading(false);
    // eslint-disable-next-line
  }, [record, tree]);

  useEffect(() => {
    clearTimeout(buttonsEnablingTimeout.current);

    // if we're not loading, enable the buttons in one second
    if (!loading) {
      buttonsEnablingTimeout.current = setTimeout(
        () => setButtonsEnabled(true),
        BUTTONS_ENABLING_TIMEOUT_DURATION_MS
      );
    }
    // if we are loading, disable the buttons immediately
    else {
      setButtonsEnabled(false);
    }
  }, [loading]);

  // Pause the answers briefly each time a new hint appears, so a double tap can't answer one never seen
  const currentHint = context.hintQue[0];
  useEffect(() => {
    if (loading || !currentHint) return;
    setButtonsEnabled(false);
    const timer = setTimeout(() => setButtonsEnabled(true), NEXT_HINT_PAUSE_MS);
    return () => clearTimeout(timer);
  }, [currentHint, loading]);

  // With no hint on screen (load failed or none left), show a message instead of the last hint
  const noHint = !loading && context.hintQue.length === 0;

  // Voting pauses while the slow-down message is up, until the user clicks "Got it"
  const votingBlocked = !buttonsEnabled || showNudge || noHint;
  // Going back to the last hint still works when there are no new ones
  const previousBlocked = !buttonsEnabled || showNudge;

  // Shown above the vote buttons
  const nudge = showNudge && !loading ? (
    <div className="slow-down-nudge" role="alert">
      <span>Slow down a little. Check the dates and places before deciding.</span>
      <button type="button" className="dismiss-nudge" onClick={dismissNudge} autoFocus>
        Got it
      </button>
    </div>
  ) : null;

  const hint = context.hintQue[0];
  // Family members get their own headings when a hint shows more than one person
  const isFamily = !noHint && matches.length > 1;

  // One set of comparisons feeds both the tables and the desktop evidence summary
  const people: (PersonRows & FamilyMember)[] = useMemo(() => {
    // Spouses on each side, whose surnames can explain a woman's different surname
    const spouses = matches.filter((match) => match.recordPerson.relationship === Relationship.Spouse);
    const spouseSurnames = {
      record: spouses.map((match) => match.recordPerson.lastName ?? ""),
      tree: spouses.map((match) => match.matchingTreePeople[match.selectedCandidateIndex ?? 0]?.lastName ?? ""),
    };
    return matches.map((match, i) => {
      const treePerson = match.matchingTreePeople[match.selectedCandidateIndex ?? 0];
      // The tree person this record would be attached to; family on the record is checked against their lifetime
      const treeFocus = matches[0]?.matchingTreePeople[matches[0].selectedCandidateIndex ?? 0];
      return {
        name: (match.recordPerson.firstName ?? "").trim().split(/\s+/)[0],
        // The main person is shown by first name only (no middle names); family members keep their relationship
        heading: match.recordPerson.relationship === Relationship.FocusPerson
          ? (match.recordPerson.firstName ?? "").trim().split(/\s+/)[0] || "Main person"
          : match.recordPerson.relationship,
        rows: i === 0
          ? buildRows(match.recordPerson, treePerson, matches.length === 1, spouseSurnames)
          : [...buildRows(match.recordPerson, treePerson, false), ...familyTimelineRows(match.recordPerson, treeFocus)],
        notOnTree: !treePerson,
      };
    });
  }, [matches]);
  // The main person is sorted first; everyone after them is family
  const family = useMemo(() => people.slice(1), [people]);

  // Conflicting facts on the hint (main person and family), used to grade "Same person" for the streak
  const conflictCount = useMemo(() => people.reduce((sum, person) => sum + person.rows.filter((row) => row.status === "bad").length, 0), [people]);
  // Each new hint starts without the Not sure prompt
  useEffect(() => {
    setAskSource(false);
    setSourceOpened(false);
  }, [hint]);

  // The tree person's name for the question, falling back to the name on the record
  const matchName = people[0]?.rows[0]?.tree ?? people[0]?.rows[0]?.record;
  // Possible duplicates compare two people already on the tree, not a record with the tree
  const isDuplicate = hint?.type === "possible_duplicate";
  const firstName = people[0]?.rows[0]?.record;

  // Vital facts left out here, which the original source often has. For a record, the record; for two
  // people on the tree, each one's own tree page.
  const missingVitals = useMemo(() => {
    const rows = people[0]?.rows ?? [];
    const sides: { who?: string; side: "record" | "tree"; url?: string }[] = isDuplicate
      ? [
          { who: "Person 1", side: "record", url: hint?.url },
          { who: "Person 2", side: "tree", url: treePageUrl(matches[0]?.matchingTreePeople[matches[0].selectedCandidateIndex ?? 0]?.pid) },
        ]
      : [{ side: "record", url: hint?.url }];
    return sides.map(({ who, side, url }) => {
      const given = new Set(rows.filter((row) => row[side]).map((row) => row.label));
      const facts = ([["Born", "birth date"], ["Birthplace", "birthplace"]] as const).filter(([label]) => !given.has(label)).map(([, fact]) => fact);
      return { who, url, facts };
    }).filter((missing) => missing.facts.length > 0 && missing.url);
  }, [people, isDuplicate, hint?.url, matches]);

  // Conflicting rows that are below the visible area, for the "conflicts below" bubble
  const [conflictsBelow, setConflictsBelow] = useState<HTMLElement[]>([]);
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    /**
     * Finds the conflicting rows that start below the bottom of the scroll area.
     */
    function update() {
      const bottom = container!.getBoundingClientRect().bottom;
      const rows = [...container!.querySelectorAll<HTMLElement>(".compare-row--bad, .family-line--bad")];
      setConflictsBelow(rows.filter((row) => row.getBoundingClientRect().top > bottom - 8));
    }

    const frame = requestAnimationFrame(update);
    container.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    // Opening or closing the family tables changes the content without a scroll
    const resize = new ResizeObserver(update);
    if (container.firstElementChild) resize.observe(container.firstElementChild);
    return () => {
      resize.disconnect();
      cancelAnimationFrame(frame);
      container.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [people, noHint]);

  // Also shown on the empty and error screens, so switching hint type can always be undone. The public
  // site has only one type, so there's nothing to switch.
  const hintTypeSelect = usingSheets ? null : (
    <select
      className="hint-type-select"
      value={hintType}
      onChange={(e) => setHintType(e.target.value)}
      aria-label="Hint type"
    >
      <option value="record_attachment">Record attachment</option>
      <option value="possible_duplicate">Possible duplicate</option>
    </select>
  );

  return (
    <form className="document-matcher" onSubmit={(e) => e.preventDefault()}>
      <div className="matcher-scroll">
      <div className="matcher-content" ref={scrollContainerRef}>
        <div className="matcher-inner">
          {noHint ? (
            <>
            <div className="hint-meta">{hintTypeSelect}</div>
            <div className="hint-status" role="status">
              {loadError ? (
                <>
                  <h3>Couldn’t load hints</h3>
                  <p>Check your connection and try again.</p>
                  <button type="button" className="hint-status-action" onClick={onRetry}>
                    Try again
                  </button>
                </>
              ) : (
                <>
                  <h3>You’re all caught up</h3>
                  <p>
                    {hintType === "record_attachment" || usingSheets
                      ? "You’ve reviewed every hint available right now. Thank you for helping!"
                      : "There are no hints of this type right now."}
                  </p>
                  {hintType === "record_attachment" || usingSheets ? (
                    <button type="button" className="hint-status-action" onClick={onRetry}>
                      Check for more hints
                    </button>
                  ) : (
                    <button type="button" className="hint-status-action" onClick={() => setHintType("record_attachment")}>
                      Back to record attachments
                    </button>
                  )}
                </>
              )}
            </div>
            </>
          ) : (
            <div className="matcher-layout">
            <div className="matcher-main">
              {/* Names the tree person this record would be attached to, like FamilySearch's review screen */}
              <h2 className="question">
                {isDuplicate && firstName && matchName
                  ? <>Are <span className="question-name">{firstName}</span> and <span className="question-name">{matchName}</span> the same person?</>
                  : matchName ? <>Is this record a match for <span className="question-name">{matchName}</span>?</> : "Is this the same person?"}
              </h2>
              <div className="hint-meta">
                {hintTypeSelect}
                {hint?.url && (
                  <a className="check-source" href={hint.url} target="_blank" rel="noopener noreferrer" onClick={() => setSourceOpened(true)}>
                    Check source ↗
                  </a>
                )}
              </div>
              {missingVitals.map(({ who, url, facts }) => (
                <p className="source-tip" role="note" key={who ?? "record"}>
                  <span className="source-tip-icon" aria-hidden="true">i</span>
                  <span>
                    {who
                      ? <>No {facts.join(" or ")} for {who} here. Their tree page may have {facts.length > 1 ? "them" : "it"}.{" "}</>
                      : <>No {facts.join(" or ")} shown here. The original record may have {facts.length > 1 ? "them" : "it"}.{" "}</>}
                    <a className="source-tip-link" href={url} target="_blank" rel="noopener noreferrer" onClick={() => setSourceOpened(true)}>
                      {who ? "Open page ↗" : "Check source ↗"}
                    </a>
                  </span>
                </p>
              ))}
              {people.length > 0 && (
                <CompareTable
                  rows={people[0].rows}
                  notOnTree={people[0].notOnTree}
                  sides={isDuplicate ? ["Person 1", "Person 2"] : undefined}
                />
              )}
              {isFamily && <FamilySummary family={family} sides={isDuplicate ? ["Person 1", "Person 2"] : undefined} />}
            </div>
            {/* Desktop only: evidence summary and tips beside the comparison */}
            <HintSidebar people={people} />
            </div>
          )}
        </div>
      </div>
      {conflictsBelow.length > 0 && (
        <button
          type="button"
          className="conflicts-below"
          onClick={() => conflictsBelow[0].scrollIntoView({ behavior: "smooth", block: "center" })}
        >
          ↓ {conflictsBelow.length} more {conflictsBelow.length === 1 ? "conflict" : "conflicts"} below
        </button>
      )}
      </div>

      <div className="vote-bar" role="toolbar" aria-label="Your answer">
        <div className="vote-inner">
          {nudge}
          {askSource && hint?.url ? (
            <div className="confirm-same" role="alertdialog" aria-labelledby="ask-source-text">
              <p id="ask-source-text">
                <span className="ask-source-lead">Not sure?</span> {isDuplicate ? "Their pages on the tree" : "The original record"} may have more details that help you decide.
              </p>
              <div className="vote-answers">
                <button type="button" className="vote-btn vote-btn--no" onClick={voteUnsure}>
                  Still not sure
                </button>
                <a
                  className="vote-btn vote-btn--yes"
                  href={hint.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => {
                    setSourceOpened(true);
                    setAskSource(false);
                  }}
                  autoFocus
                >
                  Check source ↗
                </a>
              </div>
            </div>
          ) : warnUser ? (
            <div className="warning-popup" role="alert">
              <p>We use occasional check hints to make sure answers are accurate. It looks like you chose the wrong answer on one. Please take a little more care.</p>
              <button type="button" className="vote-btn vote-btn--yes" onClick={() => setWarnUser(false)}>
                I understand
              </button>
            </div>
          ) : (
            /* Phones: answers on top, Back and Not sure underneath. Desktop: all on one row. */
            <div className="vote-row">
              <button type="button" className="vote-link vote-link--back" onClick={goBack} disabled={previousBlocked}>
                ‹ Back
              </button>
              <div className="vote-answers">
                <button type="button" className="vote-btn vote-btn--no" onClick={() => vote(-1)} disabled={votingBlocked}>
                  <span className="vote-mark" aria-hidden="true">✕</span> Different
                </button>
                <button type="button" className="vote-btn vote-btn--yes" onClick={() => vote(1)} disabled={votingBlocked}>
                  <span className="vote-mark" aria-hidden="true">✓</span> Same person
                </button>
              </div>
              <button type="button" className="vote-link vote-link--unsure" onClick={voteUnsure} disabled={votingBlocked}>
                Not sure
              </button>
            </div>
          )}
        </div>
      </div>
      {loading && <Loading className="fixed" />}
    </form>
  );
}
