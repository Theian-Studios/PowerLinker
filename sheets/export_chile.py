"""Turns Joe Price's Chilean possible duplicates into rows for the PowerLinker Google Sheet's ChileHints and
ChileChecks tabs, for the Chilean site (/chile/).

Joe's three files:

- pl_dups.csv: pid1, pid2, two people on the Family Tree who may be the same person
- pl_pids_info_relatives.csv: each of those people (rel_type_to_focus_person "self") and their relatives' IDs.
  Its name and date columns repeat the main person's own facts on every row, so a relative's facts come from:
- relative_info.csv: each relative's own facts

The outputs:

- chile_hints.local.csv: the pairs, in a fixed shuffled order
- chile_checks.local.csv, with the answer each should get:
  - the same person: pairs with the same whole name and the same exact birth date, or the same birth year and the
    same family. These are taken out of the hints.
  - different people: one pair's first person beside another pair's second person with the same first surname
    and sex, and a clearly different given name or birth years far apart

Usage, from the repo root:

    python -m sheets.export_chile ~/Downloads/powerlinker

Both outputs hold real people's records and are kept out of git.
"""
from argparse import ArgumentParser
from collections import defaultdict
from csv import DictReader
from os import path as os_path
from random import Random
from re import search
from unicodedata import combining, normalize

from backend.mock.import_duplicates import readable_date
from sheets.export_hints import one_edit_apart, write_rows

HINTS_PATH = os_path.join(os_path.dirname(__file__), "chile_hints.local.csv")
CHECKS_PATH = os_path.join(os_path.dirname(__file__), "chile_checks.local.csv")
BATCH = "cl1"


def read(folder: str, name: str) -> list[dict]:
    """Reads one of Joe's CSV files.

    Args:
        folder (str): the folder holding the files
        name (str): the file name

    Returns:
        list[dict]: its rows
    """
    with open(os_path.join(os_path.expanduser(folder), name), encoding="utf-8", newline="") as file:
        return list(DictReader(file))


def events(row: dict) -> list[dict]:
    """Builds a person's birth, christening and death events.

    Args:
        row (dict): the person's row

    Returns:
        list[dict]: the events that have a date or a place
    """
    result = []
    for name in ("birth", "christening", "death"):
        event = {"name": name}
        date = readable_date(row[f"{name}_date"])
        if date:
            event["date"] = date
        if row[f"{name}_place"].strip():
            event["place"] = row[f"{name}_place"].strip()
        if len(event) > 1:
            result.append(event)
    return result


def person(row: dict, relationship: str, pid: str) -> dict:
    """Builds a person in the app's hint format.

    Args:
        row (dict): the person's facts
        relationship (str): "self", "parent", "spouse", "child" or "sibling"
        pid (str): their Family Tree ID

    Returns:
        dict: the person
    """
    return {
        "firstName": row["given_name"].strip(),
        "lastName": row["surname"].strip(),
        "sex": row["gender"],
        "relationship": relationship,
        "pid": pid,
        "events": events(row),
    }


class People:
    """Joe's files, read once: each main person's facts and relatives, and each relative's facts."""

    def __init__(self, folder: str):
        """Reads the files.

        Args:
            folder (str): the folder holding Joe's three files
        """
        self.main: dict[str, dict] = {}
        self.relatives: dict[str, list[tuple[str, str]]] = defaultdict(list)
        for row in read(folder, "pl_pids_info_relatives.csv"):
            if row["rel_type_to_focus_person"] == "self":
                self.main[row["focus_pid"]] = row
            else:
                self.relatives[row["focus_pid"]].append((row["pid"], row["rel_type_to_focus_person"]))
        self.facts = {row["pid"]: row for row in read(folder, "relative_info.csv")}

    def side(self, pid: str, other: str | None = None) -> list[dict]:
        """Builds one side of a hint: the main person and their relatives.

        Args:
            pid (str): the main person
            other (str | None): the other side's main person, on the first side only, so the app pairs the two and
                any relative both list

        Returns:
            list[dict]: the persons
        """
        main = person(self.main[pid], "self", pid)
        shared = set()
        if other:
            main["matchpid"] = other
            shared = {relative for relative, _ in self.relatives[other]}
        result = [main]
        for relative, relationship in self.relatives[pid]:
            if relative in self.facts:
                entry = person(self.facts[relative], relationship, relative)
                if relative in shared:
                    entry["matchpid"] = relative
                result.append(entry)
        return result

    def hint(self, first: str, second: str) -> dict:
        """Builds a possible-duplicate hint for two people on the tree.

        Args:
            first (str): one person's ID
            second (str): the other's

        Returns:
            dict: the hint in the app's format
        """
        return {
            "hintType": "possible_duplicate",
            "origin": "Chile tree duplicates",
            "url": f"https://www.familysearch.org/tree/person/details/{first}",
            "recordInfo": {"ark": first, "persons": self.side(first, second)},
            "treeInfo": {"persons": self.side(second)},
        }


def plain(text: str) -> str:
    """Lowercases a name or place and drops accents and extra spaces, for comparing.

    Args:
        text (str): the text

    Returns:
        str: the text, compared the same however it was written
    """
    letters = normalize("NFD", text.lower())
    return " ".join("".join(c for c in letters if not combining(c)).split())


def year(text: str) -> int | None:
    """Gets the year from a date like "+1901-03-04".

    Args:
        text (str): the date

    Returns:
        int | None: the year, if there is one
    """
    found = search(r"\d{4}", text or "")
    return int(found.group()) if found else None


def clearly_same(people: People, first: str, second: str) -> bool:
    """Checks whether a pair is plainly one person, to use as a same-person check hint.

    Args:
        people (People): Joe's files
        first (str): one person's ID
        second (str): the other's

    Returns:
        bool: True for the same whole name with the same exact birth date, or with the same birth year and the same
            family: a relative both list, or both parents' given names alike
    """
    a, b = people.main[first], people.main[second]
    same_name = bool(plain(a["given_name"])) and plain(a["given_name"]) == plain(b["given_name"]) \
        and bool(plain(a["surname"])) and plain(a["surname"]) == plain(b["surname"])
    if not same_name:
        return False
    if len(a["birth_date"]) >= 11 and a["birth_date"] == b["birth_date"]:
        return True
    if year(a["birth_date"]) is None or year(a["birth_date"]) != year(b["birth_date"]):
        return False

    def parents(pid: str) -> list[str]:
        return sorted(plain(people.facts[r]["given_name"]) for r, kind in people.relatives[pid]
                      if kind == "parent" and r in people.facts)

    shared = {r for r, _ in people.relatives[first]} & {r for r, _ in people.relatives[second]}
    return bool(shared) or (len(parents(first)) >= 2 and parents(first) == parents(second))


def clearly_different(a: dict, b: dict) -> bool:
    """Checks whether two people with the same first surname are plainly not one person.

    Args:
        a (dict): one person's facts
        b (dict): the other's

    Returns:
        bool: True when their first given names differ by more than a letter, or their births are 10 or more years
            apart
    """
    fa, fb = (plain(a["given_name"]).split() or [""])[0], (plain(b["given_name"]).split() or [""])[0]
    if fa in ("maria", "jose") or fb in ("maria", "jose"):
        # Many go by their second name ("María Luisa" as Luisa), so compare those too
        fa, fb = plain(a["given_name"]), plain(b["given_name"])
    names_differ = bool(fa and fb) and not one_edit_apart(fa, fb) and not fa.startswith(fb) and not fb.startswith(fa)
    ya, yb = year(a["birth_date"]), year(b["birth_date"])
    return names_differ or bool(ya and yb and abs(ya - yb) >= 10)


def different_people(people: People, pairs: list[tuple[str, str]], count: int, rng: Random) -> list[tuple[str, str]]:
    """Pairs one pair's first person with another pair's second person who looks alike at a glance.

    Args:
        people (People): Joe's files
        pairs (list[tuple[str, str]]): the pairs
        count (int): how many to pick
        rng (Random): the random source

    Returns:
        list[tuple[str, str]]: two people who aren't the same person
    """
    def key(pid: str) -> tuple[str, str]:
        row = people.main[pid]
        return (plain(row["surname"]).split() or [""])[0], row["gender"]

    by_key: dict[tuple[str, str], list[str]] = defaultdict(list)
    for _, second in pairs:
        if key(second)[0]:
            by_key[key(second)].append(second)
    result = []
    for first, second in rng.sample(pairs, len(pairs)):
        others = [other for other in by_key.get(key(first), [])
                  if other != second and clearly_different(people.main[first], people.main[other])]
        if others:
            result.append((first, rng.choice(others)))
        if len(result) == count:
            break
    return result


def main() -> None:
    """Reads Joe's Chile files and writes the ChileHints and ChileChecks tabs as CSVs."""
    parser = ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("folder", help="the folder holding pl_dups.csv, pl_pids_info_relatives.csv, relative_info.csv")
    parser.add_argument("--same", type=int, default=100, help="most same-person check hints to make")
    parser.add_argument("--different", type=int, default=100, help="different-person check hints to make")
    parser.add_argument("--seed", type=int, default=1810, help="random seed, so the output is repeatable")
    args = parser.parse_args()

    people = People(args.folder)
    pairs = [(row["pid1"], row["pid2"]) for row in read(args.folder, "pl_dups.csv")
             if row["pid1"] in people.main and row["pid2"] in people.main]
    rng = Random(args.seed)
    numbered = list(enumerate(pairs, start=1))
    plainly = [n for n, (a, b) in numbered if clearly_same(people, a, b)]
    same = set(rng.sample(plainly, min(args.same, len(plainly))))
    hints = [[f"{BATCH}-{n}", people.hint(a, b)] for n, (a, b) in numbered if n not in same]
    rng.shuffle(hints)
    checks = [[f"{BATCH}-{n}", 1, people.hint(a, b)] for n, (a, b) in numbered if n in same]
    for n, (a, b) in enumerate(different_people(people, pairs, args.different, rng), start=1):
        checks.append([f"{BATCH}-diff-{n}", -1, people.hint(a, b)])

    write_rows(HINTS_PATH, ["hint_id", "hint"], hints)
    write_rows(CHECKS_PATH, ["hint_id", "expected", "hint"], checks)
    print(f"{len(pairs)} pairs: {len(hints)} hints, {len(same)} same-person and {len(checks) - len(same)} "
          f"different-person checks ({len(plainly)} pairs were plainly the same person)")


if __name__ == "__main__":
    main()
