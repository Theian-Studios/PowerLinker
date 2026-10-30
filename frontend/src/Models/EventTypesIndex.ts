import FlexibleDate from "flexibledatets";
import { Event } from "./Event";

/**
 * Type guard to check if a value is a FlexibleDate instance.
 * @param date - The value to check.
 * @returns True if the value is a FlexibleDate instance.
 */
function isFlexibleDate(date: unknown): date is FlexibleDate {
  return date instanceof FlexibleDate;
}

/**
 * Represents an element in the event types index, containing record and tree events.
 */
export class EventTypesIndexElement {
  recordEvent?: Event;
  treeEvent?: Event;

  /**
   * Gets the lowest date between record and tree events.
   * @returns The lowest date if available, undefined otherwise.
   */
  get lowestDate() {
    if (this.recordEvent && this.treeEvent) {
      const recordDate = isFlexibleDate(this.recordEvent.date) ? this.recordEvent.date : undefined;
      const treeDate = isFlexibleDate(this.treeEvent.date) ? this.treeEvent.date : undefined;
      
      if (!recordDate && !treeDate) {
        return undefined;
      }
      
      if (recordDate && treeDate && recordDate < treeDate)
        return recordDate;
      else if (treeDate && recordDate)
        return treeDate;
      else if (recordDate)
        return recordDate;
      else if (treeDate)
        return treeDate;
    } else if (this.recordEvent && isFlexibleDate(this.recordEvent.date)) {
      return this.recordEvent.date;
    } else if (this.treeEvent && isFlexibleDate(this.treeEvent.date)) {
      return this.treeEvent.date;
    }
    
    return undefined;
  }
}

/**
 * Index of event types, mapping event type names to their corresponding elements.
 */
export interface EventTypesIndex {
  [key: string]: EventTypesIndexElement;
}
