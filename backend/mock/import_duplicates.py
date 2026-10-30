"""Turns the lab's Census Tree duplicate pairs into possible-duplicate hints for the mock backend.

Each pair is two people on the Family Tree that the 1930-1940 Census Tree links think are the same
person. Pairs marked automate = 1 become check hints that are the same person, and pairs scoring very
low on all three duplicate measures become check hints that are different people. A random sample of
the rest become regular hints. The scores are used only to choose check hints; none are written out.

Usage, from the repo root:

    python -m backend.mock.import_duplicates ~/Downloads/dup_data_1930_1940.csv

The output, backend/mock/duplicate_hints.json, holds real people's records and is kept out of git.
"""
from argparse import ArgumentParser
from collections import defaultdict
from csv import DictReader
from json import dump
from os import path as os_path
from random import Random

OUTPUT_PATH = os_path.join(os_path.dirname(__file__), "duplicate_hints.json")

SCORES = ("match_score", "merge_analysis_score", "tree_tapper_merge_score")
# A pair counts as two different people when every score is at or below this
LOW_SCORE = 20
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def readable_date(value: str) -> str | None:
    """Converts a CSV date to one the frontend reads, keeping how sure it is.

    "+1919-08-26" becomes "26 Aug 1919", "A+1912" (about) becomes "abt 1912", and the ranges
    "+1883/+1891", "+1930/" and "/+1950" become "1883-1891", "after 1930" and "before 1950".

    Args:
        value (str): the date from the CSV

    Returns:
        str | None: the date the frontend can parse, or None when there is no date
    """
    if not value:
        return None
    if "/" in value:
        start, _, end = value.lstrip("A").partition("/")
        first, last = plain_date(start), plain_date(end)
        if first and last:
            # A range within one year ("+1926-03/+1926-09") is just that year
            years = first.split()[-1], last.split()[-1]
            return years[0] if years[0] == years[1] else "-".join(years)
        if first:
            return f"after {first}"
        return f"before {last}" if last else None
    date = plain_date(value.lstrip("A"))
    return f"abt {date}" if date and value.startswith("A") else date


def plain_date(value: str) -> str | None:
    """Converts a date like "+1919-08-26", "+1959-05" or "+1919" to "26 Aug 1919", "May 1959" or "1919".

    Args:
        value (str): one date from the CSV, without "A" or a range

    Returns:
        str | None: the readable date, or None when there is no date
    """
    parts = value.lstrip("+").split("-") if value else []
    if not parts or not parts[0]:
        return None
    year = parts[0]
    month = MONTHS[int(parts[1]) - 1] if len(parts) > 1 and parts[1] else None
    day = str(int(parts[2])) if len(parts) > 2 and parts[2] else None
    return " ".join(part for part in (day, month, year) if part)


def person(row: dict, other_pid: str | None) -> dict:
    """Builds one person in the backend's hint format.

    Args:
        row (dict): the person's CSV row
        other_pid (str | None): the other person in the pair, for the first person's match ID

    Returns:
        dict: the person with birth, death and census residence events
    """
    events = []
    for name, date, place in (
        ("birth", readable_date(row["birth_date"]), row["birth_place"]),
        ("residence", row["year"], row["event_place"]),
        ("death", readable_date(row["death_date"]), row["death_place"]),
    ):
        event = {"name": name}
        if date:
            event["date"] = date
        if place:
            event["place"] = place
        if len(event) > 1:
            events.append(event)

    result = {
        "firstName": row["given_name"],
        "lastName": row["surname"],
        "sex": row["gender"],
        "relationship": "self",
        "pid": row["pid"],
        "events": events,
    }
    if other_pid:
        result["matchpid"] = other_pid
    return result


def hint(pair: list[dict]) -> dict:
    """Builds a possible-duplicate hint from a pair, with the 1930 person first.

    Args:
        pair (list[dict]): the two CSV rows that share an id

    Returns:
        dict: the hint, without any scores
    """
    first, second = sorted(pair, key=lambda row: row["year"])
    return {
        "hintType": "possible_duplicate",
        "origin": "Census Tree duplicates",
        "url": f"https://www.familysearch.org/tree/person/details/{first['pid']}",
        "recordInfo": {"ark": first["pid"], "persons": [person(first, second["pid"])]},
        "treeInfo": {"persons": [person(second, None)]},
    }


def main() -> None:
    """Reads the CSV and writes the hints."""
    parser = ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("csv_path", help="dup_data_1930_1940.csv from the lab")
    parser.add_argument("--count", type=int, default=200, help="regular hints to keep")
    parser.add_argument("--checks", type=int, default=40, help="same-person check hints to keep")
    parser.add_argument("--seed", type=int, default=1930, help="random seed, so the sample is repeatable")
    args = parser.parse_args()

    by_id: dict[str, list[dict]] = defaultdict(list)
    with open(os_path.expanduser(args.csv_path), encoding="utf-8") as file:
        for row in DictReader(file):
            by_id[row["id"]].append(row)
    pairs = [rows for rows in by_id.values() if len(rows) == 2]

    rng = Random(args.seed)
    same = [pair for pair in pairs if pair[0]["automate"] == "1"]
    different = [pair for pair in pairs if all(float(pair[0][score] or 0) <= LOW_SCORE for score in SCORES)]
    checks_same = rng.sample(same, min(args.checks, len(same)))
    used = {id(pair) for pair in checks_same + different}
    regular = rng.sample([pair for pair in pairs if id(pair) not in used], args.count)

    output = {
        "regular": [hint(pair) for pair in regular],
        "correct": [hint(pair) for pair in checks_same],
        "incorrect": [hint(pair) for pair in different],
    }
    with open(OUTPUT_PATH, "w", encoding="utf-8") as file:
        dump(output, file, ensure_ascii=False)
    print(f"{len(pairs)} pairs: wrote {len(output['regular'])} hints, "
          f"{len(output['correct'])} same-person and {len(output['incorrect'])} different-person check hints")


if __name__ == "__main__":
    main()
