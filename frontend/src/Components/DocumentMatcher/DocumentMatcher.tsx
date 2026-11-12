import "./DocumentMatcher.css";
import { usingSheets } from "../../Services/sheetsApi";
import { MouseEvent, useEffect, useLayoutEffect, useMemo, useRef, useState, useContext } from "react";
import CompareTable from "../CompareTable/CompareTable";
import FamilySummary, { FamilyMember } from "../FamilySummary/FamilySummary";
import { buildRows, familyTimelineRows, selfConflicts } from "../CompareTable/compareRows";
import HintSidebar, { PersonRows } from "../HintSidebar/HintSidebar";
import Match from "../../Models/Match";
import { Loading } from "../Loading/Loading";
import { HintInfo } from "../../Models/Hint.ts";
import { CONTEXT, ContextState, saveProgress } from "../../Models/Context.ts";
import { Relationship } from "../../Models/Relationship.ts";
import { IPerson, Person } from "../../Models/Person.ts";
import { sameGivenName } from "../../Services/highlightScoring.ts";
import useSlowDownNudge from "../../Hooks/useSlowDownNudge.ts";
import { haptic } from "../../Services/haptics.ts";
import { animate, prefersReducedMotion } from "../../Services/motion.ts";
import { UnsureReason } from "../../Hooks/useQueue.ts";
import CheckReview, { CheckReviewData, reviewFacts } from "../CheckReview/CheckReview";
import { CHILE, inSiteLanguage, tr } from "../../Services/region";
import { useLookups } from "../../Services/lookups";
import { say } from "../../Services/spanish.ts";

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

/**
 * Gets a person's birth year, if their birth has a date.
 * @param person - A record or tree person.
 * @returns The year, or undefined.
 */
function birthYear(person: Person): number | undefined {
  return person.birth?.date?.likelyYear ?? undefined;
}

/**
 * Checks whether a tree relative could be a record relative: compatible kinds (parent and father) and the
 * same first name or a form of it (Benjamin and Benny, Willie and William).
 * @param recordPerson - A relative on the record (Person 1's family on a possible duplicate).
 * @param treePerson - A relative on the tree side.
 * @returns True when they could be the same relative.
 */
function couldBeSameRelative(recordPerson: Person, treePerson: Person): boolean {
  const kinds = RELATIVE_KINDS[recordPerson.relationship as Relationship] ?? [recordPerson.relationship];
  if (!kinds.includes(treePerson.relationship as Relationship)) return false;
  const first = (recordPerson.firstName ?? "").trim().split(/\s+/)[0]?.toLowerCase();
  const treeFirst = (treePerson.firstName ?? "").trim().split(/\s+/)[0]?.toLowerCase();
  if (!first || !treeFirst) return false;
  return (treePerson.firstName ?? "").toLowerCase().split(/\s+/).includes(first) || sameGivenName(first, treeFirst);
}

/**
 * Checks whether two people's birth years are no more than two apart, or unknown on either side.
 * @param a - One person.
 * @param b - The other.
 * @returns True when the years don't rule them out.
 */
function birthYearsAgree(a: Person, b: Person): boolean {
  const ya = birthYear(a), yb = birthYear(b);
  return ya === undefined || yb === undefined || Math.abs(ya - yb) <= 2;
}

/**
 * Makes a blank stand-in for the record side of a relative only the tree side lists, so the relative can be
 * shown with "–" on the other side.
 * @param treePerson - The relative on the tree side.
 * @returns A person with the same relationship and nothing else.
 */
function blankFor(treePerson: Person): Person {
  const blank = new Person({} as IPerson);
  blank.relationship = treePerson.relationship;
  blank.relationshipGroup = treePerson.relationshipGroup;
  return blank;
}

/**
 * Gives an answer button a ripple from where it was pressed and draws its mark again, so the press is felt
 * even before the next hint appears.
 * @param event - The click on the button.
 */
function pressFeedback(event: MouseEvent<HTMLButtonElement>) {
  if (prefersReducedMotion()) return;
  const button = event.currentTarget;
  const layer = button.querySelector(".vote-ripples");
  const rect = button.getBoundingClientRect();
  // A keyboard press has no pointer position, so it ripples from the middle
  const x = event.detail === 0 ? rect.width / 2 : event.clientX - rect.left;
  const y = event.detail === 0 ? rect.height / 2 : event.clientY - rect.top;
  const size = Math.hypot(rect.width, rect.height) * 2;
  if (layer) {
    const ripple = document.createElement("span");
    ripple.className = "vote-ripple";
    Object.assign(ripple.style, { left: `${x - size / 2}px`, top: `${y - size / 2}px`, width: `${size}px`, height: `${size}px` });
    layer.appendChild(ripple);
    animate(ripple, [{ transform: "scale(0)", opacity: 0.3 }, { transform: "scale(1)", opacity: 0 }], { duration: 500, easing: "ease-out" })
      .then(() => ripple.remove());
  }
  button.querySelectorAll(".vote-mark path").forEach((path) =>
    animate(path, [{ strokeDashoffset: 20 }, { strokeDashoffset: 0 }], { duration: 240, easing: "ease-out" }));
}

/** Time between the pieces of a new hint appearing, top to bottom, and how many steps before the rest come together. */
const ROW_STAGGER_MS = 20;
const ROW_STAGGER_STEPS = 6;

/** How long the answer buttons pause when a new hint appears. */
const NEXT_HINT_PAUSE_MS = 350;

/** Conflicting facts at which "Same person" counts as a wrong answer: one can be a typo, several rarely are. */
const STRONG_CONFLICTS = 2;

/** Headings of a person's parents in the family list. */
const PARENT_HEADINGS: string[] = [Relationship.Father, Relationship.Mother, Relationship.Parent];

/**
 * Joins names into a sentence: "spouse Anna and son Anthony", or the first two and how many more.
 * @param names - The names, lowercase relationship first.
 * @returns The joined names.
 */
function listNames(names: string[]): string {
  const shown = names.length > 3 ? [...names.slice(0, 2), tr(`${names.length - 2} others`, `${names.length - 2} más`)] : names;
  return shown.length > 1 ? `${shown.slice(0, -1).join(", ")} ${tr("and", "y")} ${shown[shown.length - 1]}` : shown[0] ?? "";
}

/**
 * Builds the address of a person's page on the FamilySearch tree.
 * @param pid - Their tree person ID, like "LBY6-HSX".
 * @returns The page address, or undefined without an ID.
 */
function treePageUrl(pid?: string): string | undefined {
  return pid ? `https://www.familysearch.org/tree/person/details/${encodeURIComponent(pid)}` : undefined;
}

/**
 * A person's first given name and surname, without middle names.
 * @param person - A person on the record or the tree.
 * @returns The name, e.g. "Bertha Holcomb".
 */
function shortName(person: IPerson): string {
  return [(person.firstName ?? "").trim().split(/\s+/)[0], (person.lastName ?? "").trim()].filter(Boolean).join(" ");
}

/**
 * Names the vital facts a hint leaves out, in Spanish with their articles, for the Chilean site's note.
 * @param facts - The facts in English, "birth date" and "birthplace".
 * @returns For example "la fecha de nacimiento ni el lugar de nacimiento".
 */
function spanishFacts(facts: readonly string[]): string {
  return facts.length > 1 ? "la fecha y el lugar de nacimiento" : facts[0] === "birth date" ? "la fecha de nacimiento" : "el lugar de nacimiento";
}

/**
 * Puts the Spanish article before each relative and joins them: "madre Celia" and "padre" become "la madre Celia y el
 * padre".
 * @param relatives - Relatives as shown, each starting with the relationship, such as "madre Celia".
 * @returns The list with articles.
 */
function withArticle(relatives: string[]): string {
  const words = relatives.map((relative) => `${/^(madre|esposa|hija|hermana)\b/.test(relative) ? "la" : "el"} ${relative}`);
  return words.length > 1 ? `${words.slice(0, -1).join(", ")} y ${words[words.length - 1]}` : words[0] ?? "";
}

/**
 * Starts a sentence with a capital letter.
 * @param text - The sentence.
 * @returns It with its first letter capitalized.
 */
function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Relationships that have a man's and a woman's word, which read better in Spanish than "cónyuge" or "hijo o hija". */
const GENDERED_KIN: Partial<Record<Relationship, [string, string]>> = {
  [Relationship.Spouse]: ["Husband", "Wife"],
  [Relationship.Child]: ["Son", "Daughter"],
  [Relationship.Sibling]: ["Brother", "Sister"],
  [Relationship.Parent]: ["Father", "Mother"],
};

/**
 * Names a relative's relationship. On the Chilean site it says husband or wife, son or daughter, when the person's
 * sex is known; the English site keeps the relationship as the data gives it.
 * @param person - The relative.
 * @returns The relationship to show.
 */
function kinWord(person: Person): string {
  const words = CHILE ? GENDERED_KIN[person.relationship as Relationship] : undefined;
  if (words && person.sex === "male") return words[0];
  if (words && person.sex === "female") return words[1];
  return person.relationship;
}

/**
 * DocumentMatcher Component - Main component contains the table and buttons for matching records and tree people.
 * @param {Object} props - Component props.
 * @param {(submit: -1 | 0 | 1, likelyWrong?: boolean, unsure?: UnsureReason) => void} props.submit - Function to call when submitting a match decision (-1 = not a match, 0 = skip, 1 = attach all); likelyWrong marks "Same person" despite strong conflicts, and unsure says why the answer was "Not sure".
 * @param {boolean} props.loading - Indicates if the component is in a loading state.
 * @param {(loading: boolean) => void} props.setLoading - Function to set the loading state.
 * @param {boolean} props.loadError - Whether the last attempt to load hints failed.
 * @param {() => void} props.onRetry - Tries loading hints again.
 * @param {boolean} props.offline - Whether the browser knows it's offline.
 * @param {string} [props.connectionNote] - What the volunteer should know about the connection, if anything.
 * @returns {JSX.Element} The DocumentMatcher Section.
 */
export default function DocumentMatcher({ submit, loading, setLoading, hintType, setHintType, loadError, onRetry, offline, connectionNote }: {
  submit: (submit: -1 | 0 | 1, likelyWrong?: boolean, unsure?: UnsureReason) => void;
  loading: boolean;
  setLoading: (loading: boolean) => void;
  hintType: string;
  setHintType: (hintType: string) => void;
  loadError: boolean;
  onRetry: () => void;
  offline: boolean;
  connectionNote?: string;
}) {
  const [matches, setMatches] = useState<Match[]>([]);
  const [buttonsEnabled, setButtonsEnabled] = useState<boolean>(false);
  // const [attachEnabled, setAttachEnabled] = useState<boolean>(false);
  const [tree, setTree] = useState<HintInfo | null>(null);
  const [record, setRecord] = useState<HintInfo | null>(null);
  const buttonsEnablingTimeout = useRef<ReturnType<typeof setTimeout>>();
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  // Set by an answer, so the next hint builds itself in; Back just swaps
  const answered = useRef<boolean>(false);
  const shownOnce = useRef<boolean>(false);
  const BUTTONS_ENABLING_TIMEOUT_DURATION_MS = 700;
  // A missed check hint's answer and the facts that show it, until "Got it"
  const [checkReview, setCheckReview] = useState<(CheckReviewData & { sides: [string, string] }) | null>(null);
  // "Not sure" asks why, and offers the original record unless they've already opened it for this hint
  const [askReason, setAskReason] = useState<boolean>(false);
  const [sourceOpened, setSourceOpened] = useState<boolean>(false);

  const { context, setContext } = useContext(CONTEXT) as ContextState;
  const { showNudge, recordVote, dismissNudge } = useSlowDownNudge(context.hintQue[0]);

  /**
   * Records how quickly the vote was made, then submits it.
   * @param value - The vote (-1 = not a match, 0 = skip, 1 = attach all).
   * @param unsure - Why the answer was "Not sure".
   */
  function vote(value: -1 | 0 | 1, unsure?: UnsureReason) {
    haptic("tap");
    // The next hint builds itself in, top to bottom, once it's on screen
    answered.current = true;
    recordVote(value);
    // A check hint is graded on its first answer; a miss is explained with the facts that show the right one
    const check = context.hintQue[0];
    if (check?.dummy && !check.graded && value !== 0 && check.dummy.expected === -value) {
      haptic("error");
      const expected = check.dummy.expected === 1 ? 1 : -1;
      setCheckReview({
        expected,
        facts: reviewFacts(expected, people),
        sameFamily: familyAgreement.length > 0 ? listNames(familyNames) : undefined,
        conflicts: conflictCount,
        streakLost: context.streak > 0,
        sides: isDuplicate ? ["Person 1", "Person 2"] : ["Record", "Tree"],
      });
    }
    // "Same person" on a hint with several conflicting facts is treated as a wrong answer for the streak. Not when
    // the family matches, which outweighs a few conflicting facts, or when one side's own facts can't all be true:
    // the page tells them not to count that against a match, so it doesn't cost them their streak.
    submit(value, value === 1 && conflictCount + parentConflicts.length >= STRONG_CONFLICTS && !familyAgrees && ownConflicts.length === 0, unsure);
  }

  /**
   * Answers "Not sure" with the reason the volunteer picked.
   * @param reason - Why they're not sure.
   */
  function voteUnsure(reason: UnsureReason) {
    setAskReason(false);
    vote(0, reason);
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
    // Nothing to pair until the first hint arrives; getPersons already reports malformed hints
    if (!tree?.persons || !record?.persons) return;

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

    // Each tree person pairs with one record person at most
    const used = new Set<Person>();
    let _matches: Match[] | undefined = sortedRecordPeople?.map((recordPerson) => {
      let matchingTreePeople = sortedTreePeople.filter(
        (treePerson) => Boolean(recordPerson.matchpid) && treePerson.pid === recordPerson.matchpid
      );
      // The hint pairs the record's focus person with the tree's focus person, even when the record's
      // match ID points somewhere else (seen on live hints, e.g. after tree people were merged)
      if (matchingTreePeople.length === 0 && recordPerson.relationship === Relationship.FocusPerson && tree.focusPerson) {
        matchingTreePeople = [tree.focusPerson];
      }
      // A relative whose match ID points elsewhere can still be paired by kind and first name: the record's
      // "parent Hipolito" is the tree's "father Hipolito", and "son Benjamin" is "son Benny". When several could
      // be, the one born within two years wins; otherwise the first, so differences show side by side.
      if (matchingTreePeople.length === 0 && recordPerson.relationship !== Relationship.FocusPerson) {
        const candidates = sortedTreePeople.filter((treePerson) => !used.has(treePerson) && couldBeSameRelative(recordPerson, treePerson));
        const byName = candidates.find((treePerson) => birthYearsAgree(recordPerson, treePerson)) ?? candidates[0];
        if (byName) matchingTreePeople = [byName];
      }
      // A person has one father and one mother: when each side lists just one, they're shown side by side even with
      // different names, so a record's father Henry against the tree's father Hollis shows as a difference
      if (matchingTreePeople.length === 0 && [Relationship.Father, Relationship.Mother].includes(recordPerson.relationship)) {
        const treeParents = sortedTreePeople.filter((p) => p.relationship === recordPerson.relationship);
        const recordParents = (sortedRecordPeople ?? []).filter((p) => p.relationship === recordPerson.relationship);
        if (recordParents.length === 1 && treeParents.length === 1 && !used.has(treeParents[0])) {
          matchingTreePeople = treeParents;
        }
      }
      matchingTreePeople.forEach((person) => used.add(person));

      return {
        recordPerson,
        matchingTreePeople: matchingTreePeople,
        selectedCandidateIndex: matchingTreePeople.length >= 1 ? 0 : undefined,
      };
    });

    // Two people on the tree are compared on a possible duplicate, so relatives only Person 2 has are shown too
    if (context.hintQue[0]?.type === "possible_duplicate") {
      const onlyOnTree = sortedTreePeople.filter((person) => person.relationship !== Relationship.FocusPerson && !used.has(person));
      _matches = [...(_matches ?? []), ...onlyOnTree.map((treePerson) => ({
        recordPerson: blankFor(treePerson),
        matchingTreePeople: [treePerson],
        selectedCandidateIndex: 0,
        onlyOnTree: true,
      }))];
    }

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

  // After an answer, the next hint starts from the top and builds itself top to bottom: the question, the notes,
  // each row of the table, then the family, so the eye follows the facts in order. The first hint does the same
  // over the loading shapes. Run before paint, once the new hint's rows are in, so the old ones never flash.
  useLayoutEffect(() => {
    const scroll = scrollContainerRef.current;
    const main = scroll?.querySelector<HTMLElement>(".matcher-main");
    if (!scroll || !main || matches.length === 0) return;
    const fromAnswer = answered.current;
    answered.current = false;
    if (fromAnswer) scroll.scrollTop = 0;
    if (!fromAnswer && shownOnce.current) return;
    shownOnce.current = true;
    if (prefersReducedMotion()) {
      animate(main, [{ opacity: 0 }, { opacity: 1 }], { duration: 150, fill: "backwards" });
      return;
    }
    const pieces = main.querySelectorAll<HTMLElement>(".question, .hint-meta, .source-tip, .compare-table > .compare-row, .family");
    pieces.forEach((piece, i) => animate(piece, [{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }],
      // 20 ms apart, with the later rows sharing the last step so a long hint isn't slow to finish
      { duration: 120, delay: Math.min(i, ROW_STAGGER_STEPS) * ROW_STAGGER_MS, easing: "cubic-bezier(0, 0, 0.2, 1)", fill: "backwards" }));
  }, [matches]);

  // With no hint on screen (load failed or none left), show a message instead of the last hint
  const noHint = !loading && context.hintQue.length === 0;
  // The first hints are on their way: gray shapes stand in for the question and table
  const waiting = loading && context.hintQue.length === 0;

  // Voting pauses while the slow-down message or a missed check hint's explanation is up, until "Got it"
  const votingBlocked = !buttonsEnabled || showNudge || noHint || checkReview !== null;
  // Going back to the last hint still works when there are no new ones, but not before anything's been answered
  const previousBlocked = !buttonsEnabled || showNudge || checkReview !== null || context.reviewedHints.length === 0;

  // Shown above the vote buttons
  const nudge = showNudge && !loading ? (
    <div className="slow-down-nudge" role="alert">
      <span>{tr("Slow down a little. Check the dates and places before deciding.", "Tómate tu tiempo. Revisa las fechas y los lugares antes de decidir.")}</span>
      <button type="button" className="dismiss-nudge" onClick={dismissNudge} autoFocus>
        {tr("Got it", "Entendido")}
      </button>
    </div>
  ) : null;

  const hint = context.hintQue[0];
  // Family members get their own headings when a hint shows more than one person
  const isFamily = !noHint && matches.length > 1;

  // One set of comparisons feeds both the tables and the desktop evidence summary
  const lookups = useLookups();
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
      // A relative only Person 2 lists is checked against Person 1's lifetime instead, with the columns swapped
      if (match.onlyOnTree && treePerson) {
        return {
          name: (treePerson.firstName ?? "").trim().split(/\s+/)[0],
          fullName: shortName(treePerson),
          heading: kinWord(treePerson),
          rows: [...buildRows(match.recordPerson, treePerson, false), ...familyTimelineRows(treePerson, matches[0]?.recordPerson, true)],
          notOnTree: false,
          onlyOnTree: true,
        };
      }
      return {
        name: (match.recordPerson.firstName ?? "").trim().split(/\s+/)[0],
        fullName: shortName(match.recordPerson),
        // The main person is shown by first name only (no middle names); family members keep their relationship
        heading: match.recordPerson.relationship === Relationship.FocusPerson
          ? (match.recordPerson.firstName ?? "").trim().split(/\s+/)[0] || "Main person"
          : kinWord(match.recordPerson),
        rows: i === 0
          ? buildRows(match.recordPerson, treePerson, matches.length === 1, spouseSurnames)
          : [...buildRows(match.recordPerson, treePerson, false), ...familyTimelineRows(match.recordPerson, treeFocus)],
        notOnTree: !treePerson,
      };
    });
    // Rebuilt when name and place lookups arrive, which add notes like "Rare surname" and "about 12 mi apart"
    // eslint-disable-next-line reactHooks/exhaustive-deps
  }, [matches, lookups]);
  // The main person is sorted first; everyone after them is family
  const family = useMemo(() => people.slice(1), [people]);

  // Conflicting facts on the main person, used to grade "Same person" for the streak. Relatives aren't counted:
  // they're paired by first name only, so their conflicts are often a misread surname or a different relative.
  const conflictCount = useMemo(() => (people[0]?.rows ?? []).filter((row) => row.status === "bad").length, [people]);
  // Each new hint starts without the Not sure prompt
  useEffect(() => {
    setAskReason(false);
    setSourceOpened(false);
  }, [hint]);

  // The tree person's name for the question, falling back to the name on the record
  const matchName = people[0]?.rows[0]?.tree ?? people[0]?.rows[0]?.record;
  // Possible duplicates compare two people already on the tree, not a record with the tree
  const isDuplicate = hint?.type === "possible_duplicate";
  // Where to check the facts: a record's source, or for two people on the tree, each one's own page
  const sources: { label: string; url?: string }[] = isDuplicate
    ? [
        { label: "Person 1", url: treePageUrl(matches[0]?.recordPerson.pid) ?? hint?.url },
        { label: "Person 2", url: treePageUrl(matches[0]?.matchingTreePeople[matches[0].selectedCandidateIndex ?? 0]?.pid) },
      ].filter((source) => source.url)
    : hint?.url ? [{ label: "Check source", url: hint.url }] : [];
  const firstName = people[0]?.rows[0]?.record;

  // Relatives listed for both people whose facts agree. The same family is strong evidence of the same
  // person, even when a birth year is off, and easy to miss below the main table.
  const familyAgreement = useMemo(() => {
    if (!isDuplicate) return [];
    return matches.slice(1).flatMap((match, i) => {
      const person = people[i + 1];
      const treePerson = match.matchingTreePeople[match.selectedCandidateIndex ?? 0];
      if (!person || person.notOnTree || person.onlyOnTree || !treePerson) return [];
      if (person.rows.some((row) => row.status === "bad")) return [];
      // The same person on the tree attached to both, not just someone with the same name
      const linked = Boolean(match.recordPerson.matchpid) && match.recordPerson.matchpid === treePerson.pid;
      const parent = PARENT_HEADINGS.includes(person.heading);
      return [{ who: `${say(person.heading.toLowerCase())} ${person.name}`.trim(), linked, parent }];
    });
  }, [isDuplicate, matches, people]);
  // In Chile most places say only "Chile", so parents tell people apart best: one matching parent is enough
  // The same relative listed twice on the tree ("esposo Marcelino y esposo Marcelino") is named once
  const familyNames = [...new Set(familyAgreement.map((relative) => relative.who))];
  const familyAgrees = familyAgreement.length >= 2 || familyAgreement.some((relative) => relative.linked || (CHILE && relative.parent));
  // Parents both sides name, with names that don't match. On the Chilean site they're shown above the table and
  // count as conflicts, since there the family decides more than dates and places.
  const parentConflicts = useMemo(() => (CHILE && isDuplicate ? people.slice(1) : []).filter((person) =>
    PARENT_HEADINGS.includes(person.heading) && !person.notOnTree && !person.onlyOnTree && person.rows[0]?.status === "bad"),
  [isDuplicate, people]);
  const mainDiffers = (people[0]?.rows ?? []).some((row) => row.status === "bad" || row.status === "close");
  // Two copies of one person on the tree often differ only because one has someone else's death attached.
  // When the deaths are the only conflict and the same family says it's one person, say so. A matching birth
  // alone isn't enough: two people with one name can be born the same year, and then the deaths tell them apart.
  const onlyDeathsDiffer = useMemo(() => {
    const conflicts = (people[0]?.rows ?? []).filter((row) => row.status === "bad");
    const deathOnly = conflicts.length > 0 && conflicts.every((row) => ["Died", "Death place", "Buried", "Burial place"].includes(row.label));
    return isDuplicate && deathOnly && familyAgrees;
  }, [people, isDuplicate, familyAgrees]);

  // A person whose own facts can't all be true, like a census after their own death: one of those facts is
  // wrong, so a conflict it causes isn't evidence of two different people
  const ownConflicts = useMemo(() => {
    const sides = isDuplicate ? ["Person 1", "Person 2"] : ["The record", "The tree person"];
    const persons = [matches[0]?.recordPerson, matches[0]?.matchingTreePeople[matches[0].selectedCandidateIndex ?? 0]];
    return persons.flatMap((person, i) => selfConflicts(person).map((problem) => ({ who: sides[i], problem })));
  }, [isDuplicate, matches]);

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

  // The facts both people lack, when they lack the same ones, so the two notes can be one
  const sameMissing = missingVitals.length === 2 && missingVitals.every((missing) => missing.who)
    && missingVitals[0].facts.join() === missingVitals[1].facts.join() ? missingVitals[0].facts : undefined;

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

  // Above the question, and on the empty and error screens too, so switching kinds can always be undone. Two words
  // like tabs, the chosen one underlined: two people on the tree (duplicates), or a record beside a tree person
  // (records). What each means shows on hover and to screen readers.
  const hintTypeSelect = CHILE ? null : (
    <div className="hint-kind" role="radiogroup" aria-label={tr("Kind of hint", "Tipo de sugerencia")}>
      {([
        ["possible_duplicate", usingSheets ? tr("Duplicates", "Duplicados") : tr("Possible duplicates", "Posibles duplicados"), tr("Two people on the tree", "Dos personas del árbol")],
        ["record_attachment", usingSheets ? tr("Records", "Registros") : tr("Record attachments", "Registros para adjuntar"), tr("Record and tree person", "Registro y persona del árbol")],
      ] as const).map(([value, label, detail]) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={hintType === value}
          className={`hint-kind-option${hintType === value ? " is-chosen" : ""}`}
          title={detail}
          aria-description={detail}
          onClick={() => { if (hintType !== value) setHintType(value); }}
        >
          {label}
        </button>
      ))}
    </div>
  );

  return (
    <form className="document-matcher" onSubmit={(e) => e.preventDefault()}>
      <div className="matcher-scroll">
      <div className="matcher-content" ref={scrollContainerRef}>
        <div className="matcher-inner">
          {connectionNote && <p className="connection-note" role="status">{connectionNote}</p>}
          {noHint ? (
            <>
            {hintTypeSelect}
            <div className="hint-status" role="status">
              {loadError && offline ? (
                <>
                  <h3>{tr("You’re offline", "Estás sin conexión")}</h3>
                  <p>{tr("Hints will load as soon as you’re back online.", "Las sugerencias se cargarán apenas vuelvas a tener conexión.")}</p>
                </>
              ) : loadError ? (
                <>
                  <h3>{tr("Couldn’t load hints", "No se pudieron cargar las sugerencias")}</h3>
                  <p>{tr("Trying again every so often. Check your connection, or try now.", "Lo seguiremos intentando cada cierto tiempo. Revisa tu conexión o inténtalo ahora.")}</p>
                  <button type="button" className="hint-status-action" onClick={onRetry}>
                    {tr("Try again", "Reintentar")}
                  </button>
                </>
              ) : (
                <>
                  <h3>{tr("You’re all caught up", "Estás al día")}</h3>
                  <p>
                    {hintType === "record_attachment" || usingSheets
                      ? tr("You’ve reviewed every hint available right now. Thank you for helping!", "Revisaste todas las sugerencias disponibles por ahora. ¡Gracias por ayudar!")
                      : tr("There are no hints of this type right now.", "Por ahora no hay sugerencias de este tipo.")}
                  </p>
                  {hintType === "record_attachment" || usingSheets ? (
                    <button type="button" className="hint-status-action" onClick={onRetry}>
                      {tr("Check for more hints", "Buscar más sugerencias")}
                    </button>
                  ) : (
                    <button type="button" className="hint-status-action" onClick={() => setHintType("record_attachment")}>
                      {tr("Back to record attachments", "Volver a los registros")}
                    </button>
                  )}
                </>
              )}
            </div>
            </>
          ) : waiting ? (
            <div className="matcher-layout">
              <div className="matcher-main hint-skeleton" role="status" aria-label={tr("Loading hints", "Cargando sugerencias")}>
                <div className="skeleton skeleton--title" />
                <div className="skeleton skeleton--title skeleton--short" />
                <p className="skeleton-caption">{tr("Loading hints…", "Cargando sugerencias…")}</p>
                <div className="skeleton skeleton--note" />
                <div className="skeleton skeleton--table" />
              </div>
              <HintSidebar people={[]} />
            </div>
          ) : (
            <div className="matcher-layout">
            <div className="matcher-main">
              {hintTypeSelect}
              {/* Names the tree person this record would be attached to, like FamilySearch's review screen */}
              <h2 className="question">
                {CHILE
                  ? isDuplicate && firstName && matchName
                    ? <>¿<span className="question-name">{firstName}</span> {/^h?[ií](?![aeiouáéíóú])/i.test(matchName) ? "e" : "y"} <span className="question-name">{matchName}</span> son la misma persona?</>
                    : matchName ? <>¿Este registro corresponde a <span className="question-name">{matchName}</span>?</> : "¿Es la misma persona?"
                  : isDuplicate && firstName && matchName
                    ? <>Are <span className="question-name">{firstName}</span> and <span className="question-name">{matchName}</span> the same person?</>
                    : matchName ? <>Is this record a match for <span className="question-name">{matchName}</span>?</> : "Is this the same person?"}
              </h2>
              <div className="hint-meta">
                {sources.length > 0 && (
                  <span className="source-links">
                    {sources.map(({ label, url }) => (
                      <a key={label} className="check-source" href={inSiteLanguage(url)} target="_blank" rel="noopener noreferrer" onClick={() => setSourceOpened(true)}>
                        {say(label)} ↗
                      </a>
                    ))}
                  </span>
                )}
              </div>
              {/* Both people missing the same facts: one note with a link to each page */}
              {sameMissing ? (
                <p className="source-tip" role="note">
                  <span className="source-tip-icon" aria-hidden="true">i</span>
                  <span>
                    {CHILE
                      ? <>{sameMissing.length > 1 ? "Faltan" : "Falta"} {spanishFacts(sameMissing)} de las dos personas.{" "}</>
                      : <>No {sameMissing.join(" or ")} for either person here.{" "}</>}
                    {missingVitals.map(({ who, url }, i) => (
                      <span key={who}>
                        {i > 0 && " · "}
                        <a className="source-tip-link" href={inSiteLanguage(url)} target="_blank" rel="noopener noreferrer" onClick={() => setSourceOpened(true)}>
                          {say(who ?? "")} ↗
                        </a>
                      </span>
                    ))}
                  </span>
                </p>
              ) : missingVitals.map(({ who, url, facts }) => (
                <p className="source-tip" role="note" key={who ?? "record"}>
                  <span className="source-tip-icon" aria-hidden="true">i</span>
                  <span>
                    {CHILE
                      ? who
                        ? <>{facts.length > 1 ? "Faltan" : "Falta"} {spanishFacts(facts)} de {say(who)}.{" "}</>
                        : <>{facts.length > 1 ? "Faltan" : "Falta"} {spanishFacts(facts)}; puede estar en el registro original.{" "}</>
                      : who
                        ? <>No {facts.join(" or ")} for {who} here. Their tree page may have {facts.length > 1 ? "them" : "it"}.{" "}</>
                        : <>No {facts.join(" or ")} shown here. The original record may have {facts.length > 1 ? "them" : "it"}.{" "}</>}
                    <a className="source-tip-link" href={inSiteLanguage(url)} target="_blank" rel="noopener noreferrer" onClick={() => setSourceOpened(true)}>
                      {who ? tr("Open page ↗", "Abrir página ↗") : tr("Check source ↗", "Ver fuente ↗")}
                    </a>
                  </span>
                </p>
              ))}
              {onlyDeathsDiffer && ownConflicts.length === 0 && (
                <p className="source-tip self-conflict" role="note">
                  <span className="source-tip-icon self-conflict-icon" aria-hidden="true">!</span>
                  {CHILE
                    ? <span><b>Solo las defunciones no coinciden.</b> Todo lo demás indica que es una sola persona, así que probablemente una de las dos tiene adjunta la defunción de otra persona.</span>
                    : <span><b>Only the deaths disagree.</b> Everything else points to one person, so one of them probably has someone else’s death attached.</span>}
                </p>
              )}
              {ownConflicts.map(({ who, problem }) => (
                <p className="source-tip self-conflict" role="note" key={who + problem}>
                  <span className="source-tip-icon self-conflict-icon" aria-hidden="true">!</span>
                  {CHILE
                    ? <span><b>Los datos {who === "The record" ? "del registro" : who === "The tree person" ? "de la persona del árbol" : `de ${say(who)}`} se contradicen entre sí:</b> {say(problem)}. Probablemente uno de ellos está mal, así que no lo cuentes en contra de que sean la misma persona.</span>
                    : <span><b>{who === "The record" ? "The record’s" : `${who}’s`} own facts disagree:</b> {problem}. One of those is probably wrong, so don’t count it against a match.</span>}
                </p>
              ))}
              {/* Chilean site: one family line. Parents who don't match, and in the same line any relative who does. */}
              {parentConflicts.length > 0 && (
                <p className="source-tip self-conflict" role="note">
                  <span className="source-tip-icon self-conflict-icon" aria-hidden="true">!</span>
                  <span>
                    <b>
                      {familyAgreement.length > 0 && `${capitalize(withArticle(familyNames))} ${familyNames.length > 1 ? "coinciden" : "coincide"}, pero `}
                      {(() => {
                        const who = withArticle(parentConflicts.map((person) => say(person.heading.toLowerCase())));
                        const verb = parentConflicts.length > 1 ? "no coinciden" : "no coincide";
                        return familyAgreement.length > 0 ? `${who} no:` : `${capitalize(who)} ${verb}:`;
                      })()}
                    </b>
                    {" "}{parentConflicts.map((person) => `${person.rows[0].record ?? ""} · ${person.rows[0].tree ?? ""}`).join("; ")}.
                  </span>
                </p>
              )}
              {/* Matching family sits below the main table, so it's called out up here; the other clues show in the table */}
              {familyAgrees && parentConflicts.length === 0 && (
                <div className="source-tip clue-note" role="note">
                  <span className="source-tip-icon clue-note-icon" aria-hidden="true">✓</span>
                  <div>
                    <b>{tr("Same family:", "Misma familia:")}</b> {listNames(familyNames)}
                    {mainDiffers && !onlyDeathsDiffer && !CHILE && (
                      <p className="clue-weight">{tr("Stronger evidence than a date or place that’s off.", "Esto pesa más que una fecha o un lugar que no coincida.")}</p>
                    )}
                  </div>
                </div>
              )}
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
          {tr(
            `↓ ${conflictsBelow.length} more ${conflictsBelow.length === 1 ? "conflict" : "conflicts"} below`,
            `↓ ${conflictsBelow.length} ${conflictsBelow.length === 1 ? "conflicto más" : "conflictos más"} abajo`,
          )}
        </button>
      )}
      </div>

      <div className="vote-bar" role="toolbar" aria-label={tr("Your answer", "Tu respuesta")}>
        <div className="vote-inner">
          {nudge}
          {askReason ? (
            <div className="confirm-same unsure-prompt" role="alertdialog" aria-labelledby="unsure-text">
              <p id="unsure-text"><span className="ask-source-lead">{tr("Not sure?", "¿Tienes dudas?")}</span> {tr("What made it hard to tell?", "¿Qué te hizo dudar?")}</p>
              <div className="unsure-reasons">
                <button type="button" className="vote-btn unsure-reason" onClick={() => voteUnsure("not_enough_info")} autoFocus>
                  {tr("Not enough info", "Falta información")}
                </button>
                <button type="button" className="vote-btn unsure-reason" onClick={() => voteUnsure("facts_disagree")}>
                  {tr("Facts disagree", "Los datos no coinciden")}
                </button>
                <button type="button" className="vote-btn unsure-reason" onClick={() => voteUnsure("other")}>
                  {tr("Other", "Otro motivo")}
                </button>
              </div>
              <div className="unsure-footer">
                <button type="button" className="vote-link" onClick={() => setAskReason(false)}>
                  {tr("‹ Back to answers", "‹ Volver a las respuestas")}
                </button>
                {/* The original record may settle it, unless they've already looked */}
                {sources.length > 0 && !sourceOpened && (
                  <span className="source-links">
                    {sources.map(({ label, url }) => (
                      <a
                        key={label}
                        className="vote-link unsure-source"
                        href={inSiteLanguage(url)}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => {
                          setSourceOpened(true);
                          setAskReason(false);
                        }}
                      >
                        {say(label)} ↗
                      </a>
                    ))}
                  </span>
                )}
              </div>
            </div>
          ) : (
            /* Phones: answers on top, Back and Not sure underneath. Desktop: all on one row. */
            <div className="vote-row">
              <button type="button" className="vote-link vote-link--back" onClick={goBack} disabled={previousBlocked}>
                {tr("‹ Back", "‹ Atrás")}
              </button>
              <div className="vote-answers">
                <button type="button" className="vote-btn vote-btn--no" onClick={(event) => { pressFeedback(event); vote(-1); }} disabled={votingBlocked}>
                  <span className="vote-ripples" aria-hidden="true" />
                  <svg className="vote-mark" viewBox="0 0 16 16" aria-hidden="true"><path pathLength={20} d="M4 4l8 8M12 4l-8 8" /></svg> {tr("Different", "Otra persona")}
                </button>
                <button type="button" className="vote-btn vote-btn--yes" onClick={(event) => { pressFeedback(event); vote(1); }} disabled={votingBlocked}>
                  <span className="vote-ripples" aria-hidden="true" />
                  <svg className="vote-mark" viewBox="0 0 16 16" aria-hidden="true"><path pathLength={20} d="M2.5 8.5l3.5 3.5 7.5-8" /></svg> {tr("Same person", "Misma persona")}
                </button>
              </div>
              <button type="button" className="vote-link vote-link--unsure" onClick={() => { haptic("tap"); setAskReason(true); }} disabled={votingBlocked}>
                {tr("Not sure", "No sé")}
              </button>
            </div>
          )}
        </div>
      </div>
      {checkReview && <CheckReview review={checkReview} sides={checkReview.sides} onClose={() => setCheckReview(null)} />}
      {/* The shapes show while the first hints load; this is for a reload with a hint already on screen */}
      {loading && !waiting && <Loading className="fixed" message={tr("Loading hints…", "Cargando sugerencias…")} />}
    </form>
  );
}
