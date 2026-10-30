import { useMemo, useState, useEffect } from "react";
import Collapsible from "../Collapsible/Collapsible";
import RecordSVG from "../svg/RecordSVG";
import getSortedEventTypes from "../PotentialMatch/EventIndex";
import { HighlightType } from "../../Models/HighlightType";
import { getNameHighlight, highlightClass } from "../../Services/highlightScoring";
import { Person } from "../../Models/Person"
import LinkAnimation from "../LinkAnimation/LinkAnimation.tsx";
import { Relationship } from "../../Models/Relationship.ts";
import { Event } from "../../Models/Event.ts";
import FlexibleDate from "flexibledatets";

/**
 * Year-only labels for narrow headers; breakpoint must match
 * `DocumentMatcher.css` `@media (max-width: 600px)` (mobile button bar).
 * @throws {TypeError} When `date` is defined but not a FlexibleDate instance.
 */
function lifespanYearLabel(date: FlexibleDate | undefined): string {
  if (date == null) return "?";
  if (date.likelyYear != null) return String(date.likelyYear);
  const y = date.toString().match(/\d{4}/);
  return y ? y[0] : "?";
}

/**
 * MatchTable Component - Contains the Match details and match header components to create the whole table.
 * @prop {boolean} isBroken - Checks to see if the link animation is attached.
 * @prop {number} selectedCandidateIndex - Sets the tree candidate to record Candidate if tree candidate DNE.
 * @prop {Person} recordCandidate - The person that is on the current record - Left side of table.
 * @prop {Person} treeCandidates - The potential match of the current record - Right side of table.
 * @prop {Function} createPerson - If there is not a match set selected candidate to -1 for that person.
 * @prop {Function} setAttached - Sets the attached status.
 * @returns {Component} The complete MatchTable Component.
 */
interface MatchTableProps {
  isBroken: boolean;
  selectedCandidateIndex: number | undefined;
  recordCandidate: Person;
  treeCandidates: Person[];
  createPerson: () => void;
  setAttached: (value: boolean) => void;
}

type CandidateSide = "record" | "tree";

/**
 * Renders a table comparing a record candidate with potential tree candidates.
 * @param {MatchTableProps} props - The props for the component.
 * @returns {JSX.Element} The rendered match table component.
 */
export default function MatchTable({
  isBroken,
  selectedCandidateIndex,
  recordCandidate,
  treeCandidates,
  createPerson,
  setAttached,
}: MatchTableProps) {
  const [showDetails, setShowDetails] = useState<boolean>(false);
  const [isOpen, setOpenState] = useState(false);
  
  const treeCandidate = useMemo(() => {
    if (selectedCandidateIndex === -1) {
      return recordCandidate;
    }
    if (selectedCandidateIndex !== undefined) {
      return treeCandidates[selectedCandidateIndex];
    } else {
      return undefined;
    }
  }, [recordCandidate, treeCandidates, selectedCandidateIndex]);
  
  const eventTypes = useMemo(
    () =>
      getSortedEventTypes(recordCandidate, treeCandidates, selectedCandidateIndex),
    [recordCandidate, treeCandidates, selectedCandidateIndex]
  );

  /**
   * Checks if a given event type is only present on the tree candidate.
   * @param {string} type - The event type to check.
   * @returns {boolean} True if the event type is only present on the tree candidate, false otherwise.
   */
  function getIsOneSidedTreeFact(type: string) {
    return !recordCandidate.personEvents.some(
      (event) => event.sanitizedType === type
    ) && treeCandidate?.personEvents.some(
      (e) => e.sanitizedType === type
    );
  }

  /**
   * Checks if a given event type is only present on the record candidate.
   * @param {string} type - The event type to check.
   * @returns {boolean} True if the event type is only present on the record candidate, false otherwise.
   */
  function getIsOneSidedRecordFact(type: string) {
    return recordCandidate.personEvents.some(
      (event) => event.sanitizedType === type
    ) && !treeCandidate?.personEvents.some(
      (e) => e.sanitizedType === type
    );
  }
  
  const detailsToShow = useMemo(() => {
    if (selectedCandidateIndex === undefined) return false;
    return (
      eventTypes.length > 0
    );
  }, [selectedCandidateIndex, eventTypes]);

  const highlightType = useMemo(() => {
    return getNameHighlight(recordCandidate.firstName ?? "", recordCandidate.lastName ?? "", treeCandidate?.firstName ?? "", treeCandidate?.lastName ?? "", treeCandidate?.sex ?? "");
  }, [
    recordCandidate.firstName,
    recordCandidate.lastName,
    treeCandidate?.firstName,
    treeCandidate?.lastName,
    treeCandidate?.sex
  ]);

  useEffect(() => {
    {/*OpenState Function - automatically open any persons details if there contains a red or yellow highlight*/}
    if (!isOpen) { 
      const hasGreenHighlight = eventTypes.some(
        ([, dateHighlight, placeHighlight]) =>
          dateHighlight !== HighlightType.Green || placeHighlight === HighlightType.Red
      );
      if (hasGreenHighlight) {
        setShowDetails(true); 
      } else {
        setShowDetails(false);
      }
    }
  }, [eventTypes, isOpen]);
  
  /**
   * Toggles the visibility of the details section and sets the open state.
   */
  const openState = () => {
    setShowDetails((prev: boolean) => !prev);
    setOpenState(true); 
  };


  return (
    <div
        // if the record person is the focus person, use a css style that displays it wider than the rest of the people
      className={recordCandidate.relationship === Relationship.FocusPerson ? "potential-match-table-wide" : "potential-match-table"}>
      <div className="potential-match-header-and-link">
        <button
          type="button"
          className="header-button reset"
          onClick={() => {
            if (selectedCandidateIndex !== undefined) openState();
          }}
        >
          <MatchHeader
            candidate={recordCandidate}
            fromRecord={true}
            highlightType={highlightType}
          />
        </button>
        {treeCandidate ? (
          <button
            type="button"
            className="header-button reset"
            onClick={openState}
          >
            <MatchHeader
              candidate={treeCandidate}
              fromRecord={false}
              highlightType={highlightType}
            />
          </button>
        ) : (
          <button
            className="header-button create-new-person"
            onClick={() => {
              createPerson();
              setAttached(true);
            }}
          >
            Create New
          </button>
        )}
      <LinkAnimation isBroken={isBroken} className="link-animation"/>
      </div>

      {detailsToShow && (
        <div className="details-wrapper">
          <Collapsible open={showDetails}>
            <div
              className="details-grid"
              style={{
                gridTemplateRows:
                  eventTypes
                    .map(([eventType]) => `[${eventType}] auto`)
                    .join(" "),
              }}
            >
              <MatchDetails candidate={recordCandidate} side="record" />
              {/* Family tree person table half:
                If there is only one link option, display that option.
                If there is multiple link options, display the selected option
                If there is not a selected option, display a "Create New" box/button. */}
              {selectedCandidateIndex !== undefined && selectedCandidateIndex !== -1 ? (
                <MatchDetails candidate={treeCandidates[selectedCandidateIndex]} side="tree" />
              ) : (
                <></>
              )}
            </div>
          </Collapsible>
          <button
            className="toggle-details reset"
            onClick={() => {
              if (selectedCandidateIndex !== undefined) setShowDetails(!showDetails);
            }}
            type="button"
          >
            {showDetails ? "Hide details ▴" : "Show details ▾"}
          </button>
        </div>
      )}
    </div>
  );

  /**
   * MatchDetails Component - Component that contains all the tree data on the candidate.
   * @param {Object} props - Component props.
   * @param {Person} props.candidate - The selected candidate of the table.
   * @returns {JSX.Element} The MatchDetails component.
   */
  function MatchDetails({ candidate, side }: { candidate: Person; side: CandidateSide }) {

    return (
      <div className="potential-match-details">
        {eventTypes?.map(([eventType, highlightType, placeHighlightType]) => {
          const events: Event[] = [candidate.birth, candidate.death, ...(candidate.residences ?? []), ...(candidate.otherInfo ?? [])]
            .filter((e) => e !== undefined);
          const eventsOfType = events.filter(
            (event) => event.type === eventType
          ) ?? [];
          // A fact only one side has: show its real values there, and "Not on …" on the other side
          const isOneSided = getIsOneSidedTreeFact(eventType) || getIsOneSidedRecordFact(eventType);
          const isMissingHere = eventsOfType.length === 0;
          const missingMessage = side === "tree" ? "Not on tree" : "Not on record";
          // Nothing to compare for one-sided facts, so they get no color
          const dateHighlight = isOneSided ? HighlightType.None : highlightType;
          const placeHighlight = isOneSided ? HighlightType.None : placeHighlightType;

          return (
            <div
              className={
                "event-type-wrapper" +
                (isOneSided && isMissingHere ? " event-type-wrapper--one-sided-only" : "")
              }
              style={{ gridRowStart: eventType }}
              key={eventType}
            >
              {isMissingHere && isOneSided && (
                <div className="detail unmatched-detail">
                  <h6>{eventType}</h6>
                  <div className="unmatched-text">{missingMessage}</div>
                </div>
              )}
              {eventsOfType.map((event, j) => (
                  <div className="detail" key={eventType + j}>
                    <h6>{event.type}</h6>

                    <div className={`date ${highlightClass(dateHighlight)}`}>
                      {" "}
                      {event.date?.toString()}
                    </div>

                    <div className={`location ${highlightClass(placeHighlight)}`}>
                      {" "}
                      {event.location}
                    </div>
                  </div>
                ))}
            </div>
          );
        })}
      </div>
    );
  }
}

/**
 * MatchHeader Component - Component that contains Persons name, image, and life span.
 * @prop {Person} candidate - The selected candidate of the table.
 * @prop {boolean} fromRecord - Checks if the candidate is in the record data.
 * @prop {number} highlightType - Gets the Highlight Type from NameComparator and getHighlightType.
 * @returns {Component} The MatchHeader Section.
 **/
export function MatchHeader({
  candidate,
  fromRecord,
  highlightType
}: {
  candidate: Person;
  fromRecord: boolean;
  highlightType : number;
}) {
  let imageUrl, imageColor;
  if (candidate.sex === "male") {
    imageUrl = "/images/male.svg";
    imageColor = "var(--color-sex-male)";
  } else if (candidate.sex === "female") {
    imageUrl = "/images/female.svg";
    imageColor = "var(--color-sex-female)";
  } else {
    imageUrl = "images/undetermined_sex.svg";
    imageColor = "var(--color-sex-undetermined)";
  }

  return (
    <div className={"potential-match-header"}>


      <h5 className={highlightClass(highlightType)}>
        <span>
          {candidate.firstName} {candidate.lastName}
        </span>
      </h5>

      <span className="lifespan">
        <span className="lifespan-text lifespan-text--full">
          {candidate.birth?.date?.toString() || "?"} - {candidate.death?.date?.toString() || "?"}
        </span>
        <span className="lifespan-text lifespan-text--year">
          {lifespanYearLabel(candidate.birth?.date)} - {lifespanYearLabel(candidate.death?.date)}
        </span>
      </span>
      
      <span className="pid">{candidate.pid}</span>
      {fromRecord ? (
        <RecordSVG alt={candidate.sex} style={{ color: imageColor }} />
      ) : (
        <img src={imageUrl} alt={candidate.sex} className="person-icon" />
      )}
    </div>
  );
}
