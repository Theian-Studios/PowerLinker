import { Person } from './Person';

/**
 * Contains information about a hint, including the focus person and related persons.
 */
export class HintInfo {
  id?: string
  focusPerson: Person
  persons?: Array<Person>

  /**
   * Creates a new HintInfo instance.
   * @param focusPerson - The main person this hint is about.
   * @param persons - Array of related persons.
   */
  constructor(focusPerson: Person, persons: Array<Person>) {
    this.focusPerson = focusPerson;
    this.persons = persons;
  }
}

/**
 * Represents a hint with its type and associated information.
 */
export interface Hint {
  type: string
  origin: string
  recordInfo: HintInfo
  treeData: HintInfo
  insertTime: number
  url?: string
  /** The Sheet's ID for the hint; two hints can share a person (a check hint built from a real pair). */
  hintId?: string
  complete: boolean
  dummy?: { expected: number } // only used on dummy hints, has expected vote value
  graded?: boolean // a check hint already answered once, so going back and re-answering can't add more strikes
  counted?: boolean // whether this answer added to the count, so going back undoes exactly that
  vote?: -1 | 0 | 1 // the answer given, once answered: 1 same person, -1 different, 0 not sure
  answered?: boolean // already counted in the all-time total, so re-answering after Back doesn't count it again
  raw?: unknown // the hint as the backend sent it, saved so a returning volunteer sees one before the next page loads
}