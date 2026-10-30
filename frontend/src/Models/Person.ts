import { IEvent, Event } from "./Event";
import { Relationship, RelationshipGroup } from "./Relationship";

/**
 * Capitalizes a name written all in lowercase or all in capitals, so "harold craver" and "HAROLD CRAVER"
 * show as "Harold Craver". Names with their own mix of capitals, like "McDonald" or "de la Cruz", are left alone.
 * @param name - The name as given.
 * @returns The name, capitalized when it needed it.
 */
export function capitalizeName(name?: string): string | undefined {
  if (!name || (name !== name.toLowerCase() && name !== name.toUpperCase())) return name;
  return name.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (_, before: string, letter: string) => before + letter.toUpperCase());
}

export interface IPerson {
  pid?: string;
  ark?: string;
  matchpid?: string;
  firstName?: string;
  lastName?: string;
  sex?: string;
  relationship: Relationship | string;
  events?: Array<IEvent>;
};

/**
 * Represents a person with their personal information, relationships, and life events.
 * This class stores all relevant data about an individual including their name, relationships,
 * and chronological life events.
 */
export class Person {
  /** Main personal information. */
  firstName?: string;
  firstNameUnique?: number;
  lastName?: string;
  lastNameUnique?: number;
  sex?: string;
  pid?: string;
  ark?: string;
  matchpid?: string;

  /** Relationship to focus person. */
  relationship: Relationship;
  relationshipGroup?: RelationshipGroup;

  /** Life events. */
  birth?: Event;
  residences?: Array<Event>;
  otherInfo?: Array<Event>;
  death?: Event;

  /**
   * Creates a Person from an IPerson interface containing firstName, lastName, sex, relationship, and any events we have.
   * NOTE: To create a Person directly from the data, use casting or convert to an IPerson first. TS only allows one constructor.
   * @param person The IPerson interface containing the person's details.
   */
  constructor(person: IPerson) {
    this.pid = person.pid;
    this.ark = person.ark;
    this.matchpid = person.matchpid;
    this.firstName = capitalizeName(person.firstName);
    this.lastName = capitalizeName(person.lastName);
    this.sex = person.sex;

    if (typeof person.relationship === "string") {
      switch (person.relationship) {
        case "focus":
        case "self":
          this.relationship = Relationship.FocusPerson;
          break;
        case "father":
          this.relationship = Relationship.Father;
          break;
        case "mother":
          this.relationship = Relationship.Mother;
          break;
        case "parent":
          if (this.sex === "male"){
            this.relationship = Relationship.Father;
          } else if (this.sex === "female"){
            this.relationship = Relationship.Mother;
          } else {
            this.relationship = Relationship.Parent;
          };
          break;
        case "spouse":
        case "husband":
        case "wife":
          this.relationship = Relationship.Spouse;
          break;
        case "son":
          this.relationship = Relationship.Son;
          break;
        case "daughter":
          this.relationship = Relationship.Daughter;
          break;
        case "sister":
          this.relationship = Relationship.Sister;
          break;
        case "brother":
          this.relationship = Relationship.Brother;
          break;
        case "child":
          if (this.sex === "male"){
            this.relationship = Relationship.Son;
          } else if (this.sex === "female"){
            this.relationship = Relationship.Daughter;
          } else {
            this.relationship = Relationship.Child;
          };
          break;
        case "sibling":
          if (this.sex === "male"){
            this.relationship = Relationship.Brother;
          } else if (this.sex === "female"){
            this.relationship = Relationship.Sister;
          } else {
            this.relationship = Relationship.Sibling;
          };
          break;
        default:
          this.relationship = Relationship.Other;
          break;
      };
    } else {
      this.relationship = person.relationship || Relationship.Other;
    };

    this.relationshipGroup = this.getRelationshipGroup(this.relationship);

    // default to 0, we can't detect a duplicate in the class
    this.firstNameUnique = 0;
    this.lastNameUnique = 0;

    let events = this.getEvents(person.events);
    this.birth = events[0];
    this.death = events[1];
    this.residences = events[2];
    this.otherInfo = events[3];
  };

  /**
   * Gets the RelationshipGroup from the Relationship.
   * @param relationship Relationship to categorize the person.
   * @returns The relationship group this person belongs to based on their relationship.
   */
  private getRelationshipGroup(relationship?: Relationship): RelationshipGroup {
    switch (relationship) {
      case Relationship.FocusPerson:
        return RelationshipGroup.FocusPerson;
      case Relationship.Mother:
      case Relationship.Father:
      case Relationship.Parent:
        return RelationshipGroup.Parents;
      case Relationship.Sister:
      case Relationship.Brother:
      case Relationship.Sibling:
        return RelationshipGroup.Siblings;
      case Relationship.Daughter:
      case Relationship.Son:
      case Relationship.Child:
        return RelationshipGroup.Children;
      default:
        return RelationshipGroup.Other;
    };
  };

  /**
   * Gets the birth, death, residence, and other life events from the provided events array.
   * @param events Array of events to categorize.
   * @returns An array containing the birth event, death event, residence events, and other life events in that order.
   */
  private getEvents(events: Array<IEvent> | undefined): [Event?, Event?, Array<Event>?, Array<Event>?] {
    if (!events) {
      return [undefined, undefined, undefined, undefined];
    };
    let result: [Event?, Event?, Array<Event>?, Array<Event>?] = [undefined, undefined, [], []];
    for (const event of events) {
      // convert IEvent to Event
      const eventObj = new Event(event);
      switch (eventObj.sanitizedType) {
        // Some people list more than one birth or death; keep the first one that has a date
        case "birth":
          if (!result[0]?.date) result[0] = eventObj;
          break;
        case "death":
          if (!result[1]?.date) result[1] = eventObj;
          break;
        case "previous residence":
        case "residence":
          result[2]?.push(eventObj);
          break;
        default:
          result[3]?.push(eventObj);
          break;
      };
    };

    if (result[2]?.length === 0) {
      result[2] = undefined; // No residences found
    };
    if (result[3]?.length === 0) {
      result[3] = undefined; // No other events found
    };

    return result;
  };

  /**
   * Gets all events associated with this person in chronological order.
   * Combines birth, residence, other life events, and death events into a single timeline.
   * @returns Array of all events sorted chronologically.
   */
  get personEvents(): Array<Event> {
    let events = [];
    if (this.birth) events.push(this.birth);
    if (this.residences) events = events.concat(this.residences);
    if (this.otherInfo) events = events.concat(this.otherInfo);
    if (this.death) events.push(this.death);
    return events;
  };

  /**
   * Sets the unique names for this person.
   */
  set uniqueNames([first, last]: [number | undefined, number | undefined]) {
    this.firstNameUnique = first ?? this.firstNameUnique;
    this.lastNameUnique = last ?? this.lastNameUnique;
  };

  /**
 * Overrides the default toString() function for better understanding
 * and usability in strings.
 */ 
  toString(): string {
    return `Person - First Name: ${this.firstName} Last Name: ${this.lastName} Sex: ${this.sex} Birth: ${this.birth} Death: ${this.death} 
      Relationship to Focus Person: ${this.relationship} Relationship Group Relative to Focus Person: ${this.relationshipGroup} 
      Person Events: ${this.personEvents} Residence(s): ${this.residences} Other Info: ${this.otherInfo} Ark: ${this.ark} Pid: ${this.pid} 
      Matchpid: ${this.matchpid} First Name Unique: ${this.firstNameUnique} Last Name Unique: ${this.lastNameUnique} Unique Names: ${this.uniqueNames}`;
  };
};

export const EMPTY_PERSON = new Person({
  firstName: "",
  lastName: "",
  pid: "",
  ark: "",
  sex: "",
  relationship: Relationship.Other,
  events: []
});

