import "./PotentialMatch.css";
import NewWindowLink from "../NewWindowLink/NewWindowLink.tsx";
//import Person, { Relationship } from "../../Models/Person";
import { Person } from "../../Models/Person"
import MatchTable from "../MatchTable/MatchTable";
import { ReactElement } from "react";

/**
 * Potential Match Component - Defines comparison table component which has two iterations:
 * 1.) One person is being compared to one other (yes/no question).
 * 2.) One person has multiple possible options (matching question, can also add an entirely new person).
 * 
 * @param {Object} props - Component props.
 * @param {boolean} props.isBroken - Boolean to check if the link animation is true or false.
 * @param {Person} props.recordCandidate - The person that is on the current record - Left side of table.
 * @param {Person[]} props.treeCandidates - The potential match of the current record - Right side of table.
 * @param {boolean} [props.attached] - Sets the true or false state of attached persons.
 * @param {(value: boolean) => void} props.setAttached - Sets the attached status.
 * @param {number} [props.selectedCandidate] - Sets the tree candidate to record Candidate if tree candidate DNE.
 * @param {(selectedCandidate: number) => void} props.setSelectedCandidate - Matches the index for The tree and record people.
 * @param {() => void} props.createPerson - If there is not a match set selected candidate to -1 for that person.
 * @returns {ReactElement} The potential match comparison table component.
 */

interface PotentialMatchProps {
  isBroken: boolean;
  recordCandidate: Person;
  treeCandidates: Person[];
  attached?: boolean;
  setAttached: (value: boolean) => void;
  selectedCandidateIndex?: number;
  setSelectedCandidateIndex: (selectedCandidateIndex: number) => void;
  createPerson: () => void;
  personUrl?: string;
}

/**
 * Renders a comparison table for potential matches between a record candidate and tree candidates.
 * @param {PotentialMatchProps} props - The props for the component.
 * @returns {ReactElement} The potential match comparison table component.
 */
export function PotentialMatch({
  isBroken,
  recordCandidate,
  treeCandidates,
  setAttached,
  selectedCandidateIndex,
  createPerson,
  personUrl,
}: PotentialMatchProps): ReactElement {

  let recordCandidateRelationship = recordCandidate.relationship ?? "";
  let selectedCandidateRelationship = "Other";

  // Collect the selectedCandidate's relationship based on their index in the treeCandidates
  if (selectedCandidateIndex !== undefined){
    selectedCandidateRelationship = treeCandidates[selectedCandidateIndex].relationship;
  } else {
    console.error("Selected candidate relationship cannot be found due to an undefined index position");
    console.log(`Current relationship data: \n recordCandidate: ${recordCandidate} \n treeCandidates: ${treeCandidates} selectedCandidateIndex: undefined`);
  };
  if (!recordCandidateRelationship) { 
    console.error("Record candidate relationship cannot be found"); 
  };

  // We need to figure out which relationsip to actually display, preferring a non 'Other' relationship status if it exists
  let displayRelationship = recordCandidateRelationship.charAt(0).toUpperCase() + recordCandidateRelationship.slice(1);
  if (displayRelationship === "Other") {
    displayRelationship = selectedCandidateRelationship.charAt(0).toUpperCase() + selectedCandidateRelationship.slice(1);
  }
  // Now we also just want to check for gendered versions of things like 'Child', 'Parent', or 'Sibling' if they're available
  // and prefer those instead
  else if (displayRelationship === "Child"){
    if (selectedCandidateRelationship === "Son" || selectedCandidateRelationship === "Daughter"){
      displayRelationship = selectedCandidateRelationship;
    };
  } 
  else if (displayRelationship === "Parent"){
    if (selectedCandidateRelationship === "Father" || selectedCandidateRelationship === "Mother"){
      displayRelationship = selectedCandidateRelationship;
    };
  }
  else if (displayRelationship === "Sibling"){
    if (selectedCandidateRelationship === "Brother" || selectedCandidateRelationship === "Sister"){
      displayRelationship = selectedCandidateRelationship;
    };
  };

  
  return (
    <div className="potential-match">
      <h4>
        <div className="relationship-label">
          {displayRelationship}
        </div>
        <div className="source-linker-button">
          {displayRelationship === "Focus" ? (
            <NewWindowLink
              url={personUrl ? personUrl : ""}
              linkName="Check Source"
            />
          ) : null}
        </div>
      </h4>
      <div className="flex-row">
        <MatchTable
          isBroken={isBroken}
          selectedCandidateIndex={selectedCandidateIndex}
          recordCandidate={recordCandidate}
          treeCandidates={treeCandidates}
          createPerson={createPerson}
          setAttached={setAttached}
        />
      </div>
    </div>
  );
}
