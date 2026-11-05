import { Hint } from "../Models/Hint";
import { capitalizeName } from "../Models/Person";

/**
 * Gets the names of the people the volunteer said were the same person in the streak they just finished, newest
 * last, for the celebration. Check hints are left out: they're already known pairs, not people being reconnected.
 * Only this visit's answers are known, so a streak begun on an earlier visit gives fewer names.
 * @param reviewed - The hints answered this visit, oldest first; the last one finished the streak.
 * @returns Each person's first given name and surname, like "Polly Hart".
 */
export function streakNames(reviewed: Hint[]): string[] {
    const names: string[] = [];
    for (let i = reviewed.length - 1; i >= 0; i--) {
        const hint = reviewed[i];
        // The streak runs back to the last answer that didn't count: a reset or the previous streak's last.
        // "Not sure" doesn't count either but doesn't end it.
        if (i < reviewed.length - 1 && !hint.counted && hint.vote !== 0) break;
        if (hint.vote !== 1 || hint.dummy) continue;
        const person = hint.treeData.focusPerson;
        const given = capitalizeName(person.firstName?.trim().split(/\s+/)[0]);
        const name = [given, capitalizeName(person.lastName?.trim())].filter(Boolean).join(" ");
        if (name && !names.includes(name)) names.unshift(name);
    }
    return names;
}
