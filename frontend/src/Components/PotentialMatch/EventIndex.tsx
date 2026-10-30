//import Person from "../../Models/Person";
import { Person } from "../../Models/Person"
import {
  EventTypesIndex,
  EventTypesIndexElement,
} from "../../Models/EventTypesIndex";
// import compareTwoStrings from "sanitizedType-comparator";
import { HighlightType } from "../../Models/HighlightType"
import { getDateHighlight, getPlaceHighlight } from "../../Services/highlightScoring";

/**
 * @prop {number} selectedCandidateIndex - Sets the tree candidate to record Candidate if tree candidate DNE.
 * @prop {Person} recordCandidate - The person that is on the current record - Left side of table.
 * @prop {Person} treeCandidates - The potential match of the current record - Right side of table.
 **/

/**
 * Gets sorted event types for comparison between record and tree candidates.
 * @param {Person} recordCandidate - The person that is on the current record - Left side of table.
 * @param {Person[]} treeCandidates - The potential matches of the current record - Right side of table.
 * @param {number} [selectedCandidateIndex] - Sets the tree candidate to record Candidate if tree candidate DNE.
 * @returns {[string, number, number][]} Array of event types with their date and place highlight types.
 */
export default function getSortedEventTypes(
  recordCandidate: Person,
  treeCandidates: Person[],
  selectedCandidateIndex: number | undefined
): [string, number, number][] {
  if (selectedCandidateIndex === undefined) return [];
  
  const treeCandidate =
    selectedCandidateIndex === -1
      ? recordCandidate
      : treeCandidates[selectedCandidateIndex];

  const eventsTypeIndex = getEventsIndexedByType(
    recordCandidate,
    treeCandidate
  );
  const sortedEventTypes = sortEventTypes(eventsTypeIndex);
  const matchedEventTypes = matchEventTypes(
    sortedEventTypes,
    recordCandidate,
    treeCandidate
  );
  return matchedEventTypes;
}

/**
 * Gets events indexed by their type for both record and tree candidates.
 * @param {Person} recordCandidate - The record candidate person.
 * @param {Person} [treeCandidate] - The tree candidate person.
 * @returns {EventTypesIndex} Object containing events indexed by their type.
 */
function getEventsIndexedByType(
  recordCandidate: Person,
  treeCandidate: Person
) {
  const eventsIndex: EventTypesIndex = {};

  if (!recordCandidate.personEvents || !treeCandidate.personEvents) { 
    //console.log("EventTypeIndex is empty"); 
    return eventsIndex;
  };
  
  for (const event of recordCandidate.personEvents) {
    if (!eventsIndex[event.sanitizedType])
      eventsIndex[event.sanitizedType] = new EventTypesIndexElement();
    if (
      !eventsIndex[event.sanitizedType].recordEvent ||
      (new Date(eventsIndex[event.sanitizedType].recordEvent?.date?.toString() ?? "")).getTime() >
        (new Date(event.date?.toString() ?? "")).getTime()
    )
      eventsIndex[event.sanitizedType].recordEvent = event;
  }

  for (const event of treeCandidate.personEvents) {
    if (!eventsIndex[event.sanitizedType])
      eventsIndex[event.sanitizedType] = new EventTypesIndexElement();
    if (
      eventsIndex[event.sanitizedType].treeEvent?.date === undefined ||
      (new Date(eventsIndex[event.sanitizedType].treeEvent?.date?.toString() ?? "")).getTime() >
        (new Date(event.date?.toString() ?? "")).getTime()
    )
      eventsIndex[event.sanitizedType].treeEvent = event;
  }
  return eventsIndex;
}

/**
 * Sorts event types based on their presence and dates.
 * @param {EventTypesIndex} eventTypesIndex - The indexed event types.
 * @returns {string[]} Sorted array of event type names.
 */
function sortEventTypes(eventTypesIndex: EventTypesIndex) {
  return Object.keys(eventTypesIndex).sort((key1, key2) => {
    const value1 = eventTypesIndex[key1];
    const value2 = eventTypesIndex[key2];

    const value1HasBoth = Boolean(value1.recordEvent && value1.treeEvent);
    const value2HasBoth = Boolean(value2.recordEvent && value2.treeEvent);
    // They must have at least one
    if (value1HasBoth !== value2HasBoth)
      return Number(value2HasBoth) - Number(value1HasBoth);

    const date1 = value1.lowestDate;
    const date2 = value2.lowestDate;

    // If either date is undefined, sort them to the end
    if (!date1 && !date2) return 0;
    if (!date1) return 1;
    if (!date2) return -1;

    // Compare the dates
    if (date1 < date2) return -1;
    if (date1 > date2) return 1;
    return 0;
  });
}

/**
 * Matches event types between record and tree candidates and determines highlight types.
 * @param {string[]} eventTypeList - List of event types to match.
 * @param {Person} recordCandidate - The record candidate person.
 * @param {Person} [treeCandidate] - The tree candidate person.
 * @returns {[string, number, number][]} Array of event types with their date and place highlight types.
 */
function matchEventTypes(
  eventTypeList: string[],
  recordCandidate: Person,
  treeCandidate?: Person
): [string, number, number][] {
  return eventTypeList.map((eventType) => {
    if (!treeCandidate) return [eventType, HighlightType.None, HighlightType.None] as [string, number, number];

    // if (!recordCandidate.personEvents) { 
    //   recordCandidate.personEvents = [];
    //   console.log("Record candidate events is null or undefined"); 
    // }
    // if (!treeCandidate.personEvents) { 
    //   treeCandidate.personEvents = [];
    //   console.log("Record candidate events is null or undefined"); 
    // }

    const recordEventsOfType = recordCandidate.personEvents.filter(
      (event) => event.sanitizedType === eventType
    );
    const treeEventsOfType = treeCandidate.personEvents.filter(
      (event) => event.sanitizedType === eventType
    );

    const recordDate = recordEventsOfType[0]?.date?.toString() ?? "";
    const treeDate = treeEventsOfType[0]?.date?.toString() ?? "";
    const highlightType = getDateHighlight(recordDate, treeDate);
    const placeHighlightType = getPlaceHighlight(recordEventsOfType[0]?.location, treeEventsOfType[0]?.location);

    return [eventType, highlightType, placeHighlightType] as [string, number, number];
  });
}
