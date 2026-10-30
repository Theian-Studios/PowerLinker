import { Person } from "./Person";

/**
 * Interface for a match between a record person and a tree person.
 * 
 * @property {Person} recordPerson - The person from the record.
 * @property {Person[]} matchingTreePeople - A list of possible matches from the tree people.
 * @property {boolean} [attached] - Whether the match is attached.
 * @property {number} [selectedCandidateIndex] - The index of the person in matchingTreePeople to treat as "the" matching person. Defaults to 0. If new person, -1.
 */
export default interface Match {
  recordPerson: Person;
  matchingTreePeople: Person[];
  attached?: boolean;
  selectedCandidateIndex?: number;
  /** A relative only the tree side lists (Person 2 on a possible duplicate); recordPerson is then a blank stand-in. */
  onlyOnTree?: boolean;
}
