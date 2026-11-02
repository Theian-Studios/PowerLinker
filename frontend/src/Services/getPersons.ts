import { Hint, HintInfo } from "../Models/Hint";
import { IPerson, Person } from "../Models/Person";
import { Relationship } from "../Models/Relationship";

interface IHintResponse {
  "hintType": string;
  "recordInfo": {
    "persons": IPerson[];
    "ark": string;
  };
  "treeInfo": {
    "persons": IPerson[];
  };
  "origin": string;
  "expected"?: number;
  "insert-time"?: number;
  "url"?: string;
  "hint_id"?: string;
}

/**
 * Parses the response from the hints API into a list of Hint objects.
 * @param hintsResponse - Response from useHintList.
 * @returns List of parsed hints.
 */
export function getPersons(hintsResponse: { error?: Error; data?: unknown }): Hint[] {
  if (hintsResponse.error) console.error("Error in list hints lambda: ", hintsResponse.error);
  if (!hintsResponse.data) return [];
  let data = hintsResponse.data as IHintResponse[];

  let hintList = []
  for (const hint of data) {
    if (!hint.recordInfo || !hint.treeInfo) {
      console.error("Skipping malformed hint (missing recordInfo or treeInfo):", hint);
      continue;
    }
    let arkPersons: Person[] = [];
    let pidPersons: Person[] = [];
    for (const person of hint.recordInfo.persons) {
      arkPersons.push(new Person(person));
    }
    for (const person of hint.treeInfo.persons) {
      pidPersons.push(new Person(person));
    }

    setUniqueNames(arkPersons);
    setUniqueNames(pidPersons);

    let arkFocusPerson: Person = arkPersons.find((p) => p.relationship === Relationship.FocusPerson)!;
    let pidFocusPerson: Person = pidPersons.find((p) => p.relationship === Relationship.FocusPerson)!;

    if (!arkFocusPerson || !pidFocusPerson) {
      console.error("Focus person not found in hint: ", hint);
      continue;
    }

    let recordInfo: HintInfo = new HintInfo(arkFocusPerson, arkPersons);
    recordInfo.id = hint.recordInfo.ark;
    let treeInfo: HintInfo = new HintInfo(pidFocusPerson, pidPersons);
    treeInfo.id = pidFocusPerson.pid;

    const dummy = hint.expected !== undefined ? { expected: hint.expected } : undefined;

    hintList.push({
      type: hint.hintType,
      origin: hint.origin,
      recordInfo: recordInfo,
      treeData: treeInfo,
      insertTime: hint["insert-time"] ?? -1,
      url: hint.url,
      hintId: hint.hint_id,
      complete: false,
      dummy: dummy,
      raw: hint
    } as Hint);
  }

  return hintList;
}

/**
 * This function checks if there are identical names, then sets uniqueName values for persons in a list.
 * NOTE: Unique name values are one indexed to differentiate from the default 0 value (there are no others with the same name).
 * @param persons Array of Person objects to set unique names for.
 */
function setUniqueNames(persons: Person[]) {
  let uniqueNames = new Set<string>();
  let namesToAdd = new Set<string>();
  persons.forEach((person) => {
    if (person.firstName) {
      let unique = !uniqueNames.has(person.firstName);
      if (unique) {
        uniqueNames.add(person.firstName);
      } else {
        namesToAdd.add(person.firstName);
      }
    }

    for (const name in namesToAdd) {
      let people = persons.filter(p => p.firstName === name || p.lastName === name);
      for (let i = 0; i < people.length; i++) {
        people[i].uniqueNames = [i + 1, undefined];
      }
    }

    if (person.lastName) {
      let unique = !uniqueNames.has(person.lastName);
      if (unique) {
        uniqueNames.add(person.lastName);
      } else {
        namesToAdd.add(person.lastName);
      }
    }

    for (const name in namesToAdd) {
      let people = persons.filter(p => p.firstName === name || p.lastName === name);
      for (let i = 0; i < people.length; i++) {
        people[i].uniqueNames = [undefined, i + 1];
      }
    }
  });
}