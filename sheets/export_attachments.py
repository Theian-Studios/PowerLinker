"""Turns Joe Price's record hints (a 1930 census record and the Family Tree person it may belong to) into rows for
the PowerLinker Google Sheet's Attachments and AttachChecks tabs.

Each row of Joe's file (hints_data_ian.tsv) is one hint: the FamilySearch linker link, then the 1930 census
record's facts (columns ending in 1930) and the tree person's (columns ending in 1920: their birth from the tree and
where they lived in 1920). Both sides list the person's parents as "father; mother". The outputs:

- attachments.local.csv: the hints, in a fixed shuffled order so one state's hints don't all come first
- attach_checks.local.csv, with the answer each should get:
  - the same person: hints where the name, birth year, birthplace and both parents' first names all agree. These
    are taken out of the hints.
  - different people: one hint's record beside another hint's tree person with the same surname and nothing
    shown that could make them the same person

Usage, from the repo root:

    python -m sheets.export_attachments ~/Downloads/hints_data_ian.tsv

Both outputs hold real people's records and are kept out of git.
"""
from argparse import ArgumentParser
from collections import defaultdict
from csv import DictReader
from os import path as os_path
from random import Random
from re import search, sub

from backend.mock.import_duplicates import readable_date
from sheets.export_hints import PLACEHOLDER_FIRST_NAMES, one_edit_apart, write_rows

HINTS_PATH = os_path.join(os_path.dirname(__file__), "attachments.local.csv")
CHECKS_PATH = os_path.join(os_path.dirname(__file__), "attach_checks.local.csv")
BATCH = "a1"


def parents(text: str, surname: str) -> list[dict]:
    """Builds the father and mother from a "father; mother" cell.

    Args:
        text (str): the cell, like "Henry; Mary" or "George S Washington ; Mary B Washington"
        surname (str): the main person's surname, taken off a parent's name when the cell includes it

    Returns:
        list[dict]: the parents named, in the app's hint format
    """
    result = []
    for name, relationship, sex in zip(text.split(";"), ("father", "mother"), ("male", "female")):
        words = name.split()
        if not words:
            continue
        last = ""
        if len(words) > 1 and surname and words[-1].lower() == surname.lower():
            last = words.pop()
        result.append({"firstName": " ".join(words), "lastName": last, "sex": sex, "relationship": relationship, "events": []})
    return result


def person(row: dict, year: str, readable: bool) -> dict:
    """Builds one side's main person.

    Args:
        row (dict): the hint's row
        year (str): "1930" for the record's columns, "1920" for the tree person's
        readable (bool): whether the birth date is in the tree's "+1916-11-23" form

    Returns:
        dict: the person, without an ID
    """
    birth = {"name": "birth"}
    date = readable_date(row[f"birthdate{year}"]) if readable else row[f"birthdate{year}"].strip()
    if date:
        birth["date"] = date
    if row[f"birthplace{year}"].strip():
        birth["place"] = row[f"birthplace{year}"].strip()
    events = [birth] if len(birth) > 1 else []
    if row[f"place{year}"].strip():
        events.append({"name": "residence", "date": year, "place": row[f"place{year}"].strip()})
    return {"firstName": row[f"given_name{year}"].strip(), "lastName": row[f"surname{year}"].strip(), "relationship": "self", "events": events}


def ids(row: dict) -> tuple[str, str]:
    """Reads the record's ark and the tree person's ID from the linker link.

    Args:
        row (dict): the hint's row

    Returns:
        tuple[str, str]: the record ark, like "XMRZ-TPK", and the tree person, like "LKNY-GD5"
    """
    return search(r"1:1:([^&]+)", row["hint_url"]).group(1), search(r"[?&]id=([^&]+)", row["hint_url"]).group(1)


def hint(record_row: dict, tree_row: dict) -> dict:
    """Builds a record-attachment hint: one row's record beside a tree person, usually from the same row.

    Args:
        record_row (dict): the row whose 1930 record is shown
        tree_row (dict): the row whose tree person is shown

    Returns:
        dict: the hint in the app's format
    """
    ark, _ = ids(record_row)
    _, pid = ids(tree_row)
    record = {**person(record_row, "1930", False), "ark": ark, "matchpid": pid}
    tree = {**person(tree_row, "1920", True), "pid": pid}
    url = record_row["hint_url"] if record_row is tree_row else f"https://www.familysearch.org/ark:/61903/1:1:{ark}"
    return {
        "hintType": "record_attachment",
        "origin": "1930 census record hints",
        "url": url,
        "recordInfo": {"ark": ark, "persons": [record, *parents(record_row["parents1930"], record["lastName"])]},
        "treeInfo": {"persons": [tree, *parents(tree_row["parents1920"], tree["lastName"])]},
    }


def plain(text: str) -> str:
    """Lowercases a name or place and drops its punctuation, for comparing.

    Args:
        text (str): the text

    Returns:
        str: the text, compared the same however it was written
    """
    return " ".join(sub(r"[^\w ]", " ", text.lower()).split())


def first(text: str) -> str:
    """Gets a name's first word, compared the same however it was written.

    Args:
        text (str): the name

    Returns:
        str: its first word, or "" for none
    """
    words = plain(text).split()
    return words[0] if words else ""


def year(text: str) -> int | None:
    """Gets the year from a date.

    Args:
        text (str): the date, like "1915" or "+1916-11-23"

    Returns:
        int | None: the year, if there is one
    """
    found = search(r"\d{4}", text or "")
    return int(found.group()) if found else None


def state(text: str) -> str:
    """Gets a birthplace's state or country, so "Mississippi" and "Tylertown, Mississippi, United States" agree.

    Args:
        text (str): the place

    Returns:
        str: the part that says which state or country
    """
    parts = [plain(part) for part in text.split(",") if plain(part)]
    if parts and parts[-1] == "united states":
        parts.pop()
    return parts[-1] if parts else ""


def clearly_same(row: dict) -> bool:
    """Checks whether a hint is plainly the same person, to use as a same-person check hint.

    Args:
        row (dict): the hint's row

    Returns:
        bool: True when the whole name, birth year, birthplace and both parents' first names agree
    """
    def parent_names(text: str) -> list[str]:
        return [first(name) for name in text.split(";")]

    record_parents, tree_parents = parent_names(row["parents1930"]), parent_names(row["parents1920"])
    return (
        bool(first(row["given_name1930"])) and first(row["given_name1930"]) == first(row["given_name1920"])
        and bool(plain(row["surname1930"])) and plain(row["surname1930"]) == plain(row["surname1920"])
        and year(row["birthdate1930"]) is not None and year(row["birthdate1930"]) == year(row["birthdate1920"])
        and bool(state(row["birthplace1930"])) and state(row["birthplace1930"]) == state(row["birthplace1920"])
        and len(record_parents) == 2 and all(record_parents) and record_parents == tree_parents
    )


def could_be_same_person(record_row: dict, tree_row: dict) -> bool:
    """Checks whether one hint's record and another hint's tree person might still be the same person, so they
    aren't used as a "different people" check.

    Args:
        record_row (dict): the row whose record is shown
        tree_row (dict): the row whose tree person is shown

    Returns:
        bool: True when nothing shown would tell them apart
    """
    a, b = first(record_row["given_name1930"]), first(tree_row["given_name1920"])
    if a and b and a not in PLACEHOLDER_FIRST_NAMES and b not in PLACEHOLDER_FIRST_NAMES and not one_edit_apart(a, b):
        return False
    ya, yb = year(record_row["birthdate1930"]), year(tree_row["birthdate1920"])
    places = state(record_row["birthplace1930"]), state(tree_row["birthplace1920"])
    return not (ya and yb and abs(ya - yb) >= 5) and not (all(places) and places[0] != places[1])


def different_people(rows: list[dict], count: int, rng: Random) -> list[tuple[dict, dict]]:
    """Pairs records with other hints' tree people who look alike at a glance: the same surname.

    Args:
        rows (list[dict]): the hints' rows
        count (int): how many to pick
        rng (Random): the random source

    Returns:
        list[tuple[dict, dict]]: a row whose record is shown, and a different row whose tree person is shown
    """
    by_surname: dict[str, list[dict]] = defaultdict(list)
    for row in rows:
        if plain(row["surname1920"]):
            by_surname[plain(row["surname1920"])].append(row)
    result = []
    for row in rng.sample(rows, len(rows)):
        others = [other for other in by_surname.get(plain(row["surname1930"]), [])
                  if other is not row and not could_be_same_person(row, other)]
        if others:
            result.append((row, rng.choice(others)))
        if len(result) == count:
            break
    return result


def main() -> None:
    """Reads Joe's record hints and writes the Attachments and AttachChecks tabs as CSVs."""
    parser = ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("tsv_path", help="hints_data_ian.tsv from the lab")
    parser.add_argument("--same", type=int, default=150, help="same-person check hints to make")
    parser.add_argument("--different", type=int, default=150, help="different-person check hints to make")
    parser.add_argument("--seed", type=int, default=1930, help="random seed, so the output is repeatable")
    args = parser.parse_args()

    with open(os_path.expanduser(args.tsv_path), encoding="utf-8", newline="") as file:
        rows = [row for row in DictReader(file, delimiter="\t") if row.get("hint_url")]

    rng = Random(args.seed)
    numbered = list(enumerate(rows, start=1))
    plainly = [n for n, row in numbered if clearly_same(row)]
    same = set(rng.sample(plainly, min(args.same, len(plainly))))
    hints = [[f"{BATCH}-{n}", hint(row, row)] for n, row in numbered if n not in same]
    rng.shuffle(hints)
    checks = [[f"{BATCH}-{n}", 1, hint(row, row)] for n, row in numbered if n in same]
    for n, (record_row, tree_row) in enumerate(different_people(rows, args.different, rng), start=1):
        checks.append([f"{BATCH}-diff-{n}", -1, hint(record_row, tree_row)])

    write_rows(HINTS_PATH, ["hint_id", "hint"], hints)
    write_rows(CHECKS_PATH, ["hint_id", "expected", "hint"], checks)
    print(f"{len(rows)} record hints: {len(hints)} hints, {len(same)} same-person and "
          f"{len(checks) - len(same)} different-person checks")


if __name__ == "__main__":
    main()
