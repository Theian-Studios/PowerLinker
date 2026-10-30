"""Turns Joe Price's Census Tree duplicate pairs, with their family, into rows for the PowerLinker Google Sheet.

Each pair is two people on the Family Tree, one from the 1930 census and one from 1940, that the
Census Tree links think are the same person. The output is two CSVs, one for each of the Sheet's tabs:

- Hints (hints.local.csv): every pair the lab hasn't confirmed, in a fixed shuffled order so one
  city's pairs don't all come first
- Checks (checks.local.csv), with the answer each should get:
  - the same person: pairs marked automate = 1
  - different people: the 1930 person of one pair beside the 1940 person of another pair with the
    same surname and sex. Low duplicate scores aren't used for these, since many low-scoring pairs
    turned out to be the same person.

Usage, from the repo root:

    python -m sheets.export_hints ~/Downloads/dup_data_1930_1940.csv ~/Downloads/powerlinker-data-2026-10-29/family_info_b1.csv

Both outputs hold real people's records and are kept out of git.
"""
from argparse import ArgumentParser
from collections import defaultdict
from csv import DictReader, writer
from json import dumps
from os import path as os_path
from random import Random
from re import search

from backend.mock.import_duplicates import readable_date

HINTS_PATH = os_path.join(os_path.dirname(__file__), "hints.local.csv")
CHECKS_PATH = os_path.join(os_path.dirname(__file__), "checks.local.csv")
# Google Sheets cells hold at most 50,000 characters
MAX_CELL = 50_000


def events(row: dict, census_year: str | None = None, census_place: str | None = None) -> list[dict]:
    """Builds a person's birth, census residence and death events from a CSV row.

    Args:
        row (dict): the person's row
        census_year (str | None): the census year, for the main person only
        census_place (str | None): where the census found them

    Returns:
        list[dict]: the events that have a date or a place
    """
    result = []
    for name, date, place in (
        ("birth", readable_date(row["birth_date"]), row["birth_place"]),
        ("residence", census_year, census_place),
        ("death", readable_date(row["death_date"]), row["death_place"]),
    ):
        event = {"name": name}
        if date:
            event["date"] = date
        if place:
            event["place"] = place
        if len(event) > 1:
            result.append(event)
    return result


def main_person(row: dict, other_pid: str | None) -> dict:
    """Builds the main person of one side of a pair.

    Args:
        row (dict): their row in the pairs file
        other_pid (str | None): the other side's person, set on the first side so the app pairs them

    Returns:
        dict: the person in the app's hint format
    """
    result = {
        "firstName": row["given_name"],
        "lastName": row["surname"],
        "sex": row["gender"],
        "relationship": "self",
        "pid": row["pid"],
        "events": events(row, row["year"], row["event_place"]),
    }
    if other_pid:
        result["matchpid"] = other_pid
    return result


def relatives(pid: str, family: dict[str, list[dict]], other_family_pids: set[str] | None = None) -> list[dict]:
    """Builds a person's family members from the family file.

    Args:
        pid (str): the main person
        family (dict[str, list[dict]]): family rows by main person
        other_family_pids (set[str] | None): the other side's relatives, so one shared by both sides is paired

    Returns:
        list[dict]: their spouses, parents, children and siblings
    """
    result = []
    for row in family.get(pid, []):
        if row["rel_type_to_focus_person"] == "self":
            continue
        person = {
            "firstName": row["given_name"],
            "lastName": row["surname"],
            "sex": row["gender"],
            "relationship": row["rel_type_to_focus_person"],
            "pid": row["pid"],
            "events": events(row),
        }
        if other_family_pids and row["pid"] in other_family_pids:
            person["matchpid"] = row["pid"]
        result.append(person)
    return result


def hint(first: dict, second: dict, family: dict[str, list[dict]]) -> dict:
    """Builds a possible-duplicate hint for two people, the 1930 one first.

    Args:
        first (dict): the 1930 person's row
        second (dict): the 1940 person's row
        family (dict[str, list[dict]]): family rows by main person

    Returns:
        dict: the hint, without any scores
    """
    second_family = {row["pid"] for row in family.get(second["pid"], [])}
    return {
        "hintType": "possible_duplicate",
        "origin": "Census Tree duplicates",
        "url": f"https://www.familysearch.org/tree/person/details/{first['pid']}",
        "recordInfo": {
            "ark": first["pid"],
            "persons": [main_person(first, second["pid"]), *relatives(first["pid"], family, second_family)],
        },
        "treeInfo": {"persons": [main_person(second, None), *relatives(second["pid"], family)]},
    }


def different_people(pairs: list[list[dict]], count: int, rng: Random) -> list[tuple[dict, dict]]:
    """Picks people from different pairs who look alike at a glance: same surname and sex.

    Args:
        pairs (list[list[dict]]): the pairs, each sorted 1930 first
        count (int): how many to pick
        rng (Random): the random source

    Returns:
        list[tuple[dict, dict]]: a 1930 person and a 1940 person who aren't the same person
    """
    by_surname: dict[tuple[str, str], list[dict]] = defaultdict(list)
    for _, later in pairs:
        if later["surname"]:
            by_surname[(later["surname"].lower(), later["gender"])].append(later)
    result = []
    for earlier, later in rng.sample(pairs, len(pairs)):
        others = [row for row in by_surname.get((earlier["surname"].lower(), earlier["gender"]), [])
                  if row["pid"] != later["pid"] and not could_be_same_person(earlier, row)]
        if others:
            result.append((earlier, rng.choice(others)))
        if len(result) == count:
            break
    return result


# First names that can stand for anyone, so they can't show two people are different
PLACEHOLDER_FIRST_NAMES = {"junior", "jr", "sonny", "sonnie", "bud", "buddy", "baby", "infant", "son", "daughter", "sister", "brother", "mrs", "miss", "mr"}


def one_edit_apart(a: str, b: str) -> bool:
    """Checks whether two words are equal or one letter added, dropped or changed apart.

    Args:
        a (str): one word
        b (str): the other

    Returns:
        bool: True for "ida" and "ada", or "jon" and "john"
    """
    if a == b:
        return True
    if abs(len(a) - len(b)) > 1:
        return False
    i = 0
    while i < len(a) and i < len(b) and a[i] == b[i]:
        i += 1
    if len(a) == len(b):
        return a[i + 1:] == b[i + 1:]
    return a[i + 1:] == b[i:] if len(a) > len(b) else a[i:] == b[i + 1:]


def could_be_same_person(a: dict, b: dict) -> bool:
    """Checks whether two people from different pairs might still be the same person, so they aren't used
    as a "different people" check: similar first names with nothing shown to tell them apart.

    Args:
        a (dict): one person's row
        b (dict): the other's

    Returns:
        bool: True when nothing shown would tell them apart
    """
    def first(row: dict) -> str:
        words = row["given_name"].strip().lower().replace(".", " ").replace(",", " ").split()
        return words[0] if words else ""

    fa, fb = first(a), first(b)
    if fa and fb and fa not in PLACEHOLDER_FIRST_NAMES and fb not in PLACEHOLDER_FIRST_NAMES and not one_edit_apart(fa, fb):
        return False

    def year(row: dict) -> int | None:
        found = search(r"\d{4}", row["birth_date"] or "")
        return int(found.group()) if found else None

    ya, yb = year(a), year(b)
    years_apart = bool(ya and yb and abs(ya - yb) >= 5)
    pa = [p.strip().lower() for p in (a["birth_place"] or "").split(",") if p.strip()][-2:]
    pb = [p.strip().lower() for p in (b["birth_place"] or "").split(",") if p.strip()][-2:]
    places_differ = bool(pa and pb and pa != pb)
    return not years_apart and not places_differ


def main() -> None:
    """Reads Joe's pairs and family files and writes the Hints tab as a CSV."""
    parser = ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("pairs_path", help="dup_data_1930_1940.csv from the lab")
    parser.add_argument("family_path", help="family_info_b1.csv from the lab")
    parser.add_argument("--different", type=int, default=150, help="different-person check hints to make")
    parser.add_argument("--seed", type=int, default=1930, help="random seed, so the output is repeatable")
    parser.add_argument("--batch", default="b1", help="prefix for hint IDs, so batches don't collide")
    args = parser.parse_args()

    by_id: dict[str, list[dict]] = defaultdict(list)
    with open(os_path.expanduser(args.pairs_path), encoding="utf-8") as file:
        for row in DictReader(file):
            by_id[row["id"]].append(row)
    pairs = sorted(
        (sorted(rows, key=lambda row: row["year"]) for rows in by_id.values() if len(rows) == 2),
        key=lambda pair: int(pair[0]["id"]),
    )

    family: dict[str, list[dict]] = defaultdict(list)
    with open(os_path.expanduser(args.family_path), encoding="utf-8") as file:
        for row in DictReader(file):
            family[row["focus_pid"]].append(row)

    rng = Random(args.seed)
    hints, checks = [], []
    for earlier, later in pairs:
        row = [f"{args.batch}-{earlier['id']}", hint(earlier, later, family)]
        if earlier["automate"] == "1":
            checks.append([row[0], 1, row[1]])
        else:
            hints.append(row)
    rng.shuffle(hints)
    for n, (earlier, later) in enumerate(different_people(pairs, args.different, rng), start=1):
        checks.append([f"{args.batch}-diff-{n}", -1, hint(earlier, later, family)])

    write_rows(HINTS_PATH, ["hint_id", "hint"], hints)
    write_rows(CHECKS_PATH, ["hint_id", "expected", "hint"], checks)
    with_family = sum(1 for earlier, later in pairs if family.get(earlier["pid"]) or family.get(later["pid"]))
    same = sum(1 for check in checks if check[1] == 1)
    print(f"{len(pairs)} pairs, {with_family} with family: {len(hints)} hints, "
          f"{same} same-person and {len(checks) - same} different-person checks")


def write_rows(path: str, header: list[str], rows: list[list]) -> None:
    """Writes one tab's rows as a CSV, with each hint as compact JSON in its last column.

    Args:
        path (str): where to write
        header (list[str]): the column names
        rows (list[list]): the rows, each ending in a hint
    """
    with open(path, "w", encoding="utf-8", newline="") as file:
        out = writer(file)
        out.writerow(header)
        for *cells, data in rows:
            text = dumps(data, ensure_ascii=False, separators=(",", ":"))
            if len(text) > MAX_CELL:
                print(f"Skipping {cells[0]}: {len(text)} characters is too long for one cell")
                continue
            out.writerow([*cells, text])


if __name__ == "__main__":
    main()
