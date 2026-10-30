/**
 * Enum representing possible relationships to the focus person.
 * These relationships define how individuals are connected in the family tree.
 */
export enum Relationship {
  FocusPerson = "Focus",
  Spouse = "Spouse",
  Mother = "Mother",
  Father = "Father",
  Parent = "Parent",
  Sister = "Sister",
  Brother = "Brother",
  Sibling = "Sibling",
  Daughter = "Daughter",
  Son = "Son",
  Child = "Child",
  Other = "Other"
}

/**
 * Enum representing relationship groups for organizing family members.
 * These groups help categorize and structure the family tree hierarchy.
 */
export enum RelationshipGroup {
  FocusPerson,
  Parents,
  Siblings,
  Children,
  Other
}

