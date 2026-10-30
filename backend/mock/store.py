"""In-memory stand-in for the PowerLinkerAuto, GrowthSpurtHints and PowerLinkerInvalidSid tables."""
from copy import deepcopy
from json import load as json_load
from os import environ, path as os_path
from random import choice
from threading import Lock
from uuid import uuid4

from backend.mock.voters import trust

HINTS_PATH = os_path.join(os_path.dirname(__file__), "..", "public", "dummy", "hints.json")

# Real hints copied from the dev site, for testing with realistic data. Kept out of git because
# they hold real people's records. Set MOCK_LIVE_HINTS=0 to leave them out (the tests do).
LIVE_HINTS_PATH = os_path.join(os_path.dirname(__file__), "live_hints.json")
# Possible-duplicate hints built from the lab's Census Tree pairs by import_duplicates.py, also kept out of git
DUPLICATE_HINTS_PATH = os_path.join(os_path.dirname(__file__), "duplicate_hints.json")

# Mirrors the thresholds in backend/src/services/VoteService.py
MIN_SOLID_VOTES = 5
MAX_SKIPS = 3
POSITIVE_THRESHOLD = 3
NEGATIVE_THRESHOLD = -3

# Oldest unanswered dummy hints are forgotten past this many, so memory stays bounded
MAX_DUMMIES = 1000


def weighted_sum(votes: list[dict]) -> float:
    """Adds up votes, each scaled by the weight its voter had when casting it.

    Args:
        votes (list[dict]): the votes on the hint

    Returns:
        float: the weighted vote total
    """
    return sum(vote["vote"] * vote["weight"] for vote in votes)


def analyze_votes(votes: list[dict]) -> bool:
    """Determine if a hint has enough votes to be settled.

    The +3 / -3 thresholds use trust-weighted votes, so untrusted voters need more
    agreement. The vote and skip limits still count people, not weight.

    Args:
        votes (list[dict]): the votes on the hint

    Returns:
        bool: True if the hint should be removed from the pool
    """
    solid_votes = [vote for vote in votes if vote["vote"] != 0]
    sum_votes = weighted_sum(votes)

    return (
        sum_votes >= POSITIVE_THRESHOLD
        or sum_votes <= NEGATIVE_THRESHOLD
        or len(solid_votes) >= MIN_SOLID_VOTES
        or (len(votes) - len(solid_votes)) >= MAX_SKIPS
    )


def settle_outcome(votes: list[dict]) -> str:
    """Get the GrowthSpurtHints outcome a settled hint would be given.

    Args:
        votes (list[dict]): the votes on the settled hint

    Returns:
        str: "ATTACH_ME", "REJECTED", or "EXPERT" for hints sent on to other apps
    """
    final_vote = weighted_sum(votes)
    if final_vote >= POSITIVE_THRESHOLD:
        return "ATTACH_ME"
    if final_vote <= NEGATIVE_THRESHOLD:
        return "REJECTED"
    return "EXPERT"


class MockStore:
    """Holds hints, votes, voters and invalid sessions in memory."""

    def __init__(self) -> None:
        """Loads the sample hints into the pool."""
        self._lock = Lock()
        with open(HINTS_PATH, "r") as file:
            self._samples = json_load(file)
        self._live: list[dict] = []
        self._duplicates: dict[str, list[dict]] = {"regular": [], "correct": [], "incorrect": []}
        if environ.get("MOCK_LIVE_HINTS", "1") != "0":
            if os_path.exists(LIVE_HINTS_PATH):
                with open(LIVE_HINTS_PATH, "r") as file:
                    self._live = json_load(file)
            if os_path.exists(DUPLICATE_HINTS_PATH):
                with open(DUPLICATE_HINTS_PATH, "r", encoding="utf-8") as file:
                    self._duplicates = json_load(file)
        self.reset()

    def reset(self) -> None:
        """Puts every sample hint back in the pool and clears all votes."""
        with self._lock:
            self.pool: dict[str, dict] = {}
            self.settled: list[dict] = []
            self.invalid_sids: set[str] = set()
            # Dummy hints handed out, by URL: the vote that counts as correct and the voters already graded on it
            self.dummies: dict[str, dict] = {}
            # Per voter: dummy hints answered and answered correctly
            self.voters: dict[str, dict] = {}

            # Live hints first, keeping their real source links so "Check source" opens the actual record;
            # then possible duplicates, which only show under that hint type
            for insert_time, live in enumerate(self._live + self._duplicates["regular"], start=1):
                hint = deepcopy(live)
                hint["insert-time"] = insert_time
                hint["votes"] = []
                self.pool[hint["url"]] = hint

            samples = self._samples["correct"] + self._samples["incorrect"]
            for insert_time, sample in enumerate(samples, start=len(self._live) + len(self._duplicates["regular"]) + 1):
                hint = deepcopy(sample)
                hint.pop("expected", None)
                url = f"mock://hint/{insert_time}"
                hint["recordInfo"]["ark"] = f"MOCK-ARK-{insert_time}"
                hint["origin"] = "Mock"
                hint["url"] = url
                hint["insert-time"] = insert_time
                hint["votes"] = []
                self.pool[url] = hint

    def get_hints(self, record_type: str, last_insert_time: int, count: int) -> list[dict]:
        """Gets unsettled hints in insert-time order, like a query on the hint table's GSI.

        Args:
            record_type (str): the type of record to get hints for
            last_insert_time (int): only return hints with a greater insert-time
            count (int): the maximum number of hints to return

        Returns:
            list[dict]: the hints, without their votes
        """
        with self._lock:
            hints = sorted(
                (
                    hint for hint in self.pool.values()
                    if hint["hintType"] == record_type and hint["insert-time"] > last_insert_time
                ),
                key=lambda hint: hint["insert-time"],
            )
            return [
                {key: value for key, value in hint.items() if key != "votes"}
                for hint in hints[:count]
            ]

    def get_dummy_hint(self, correct: bool | None, record_type: str = "record_attachment") -> dict:
        """Builds a dummy hint with its expected vote, like the real backend, so the page can grade answers
        right away (a missed check hint resets the streak). Votes sent here are still graded too.

        Args:
            correct (bool | None): whether the hint should be a match; random if None
            record_type (str): the hint type being reviewed; possible duplicates use their own check hints

        Returns:
            dict: a dummy hint, with "expected" set to 1 (same person) or -1 (different)
        """
        if correct is None:
            correct = choice([True, False])
        source = self._duplicates if record_type == "possible_duplicate" and self._duplicates["correct"] else self._samples
        hint = deepcopy(choice(source["correct" if correct else "incorrect"]))
        hint["expected"] = 1 if correct else -1
        url = f"mock://dummy/{uuid4()}"
        hint["url"] = url
        with self._lock:
            self.dummies[url] = {"expected": 1 if correct else -1, "graded": set()}
            if len(self.dummies) > MAX_DUMMIES:
                del self.dummies[next(iter(self.dummies))]
        return hint

    def _weight(self, voter_id: str) -> float:
        """Gets a voter's current trust. Call with the lock held.

        Args:
            voter_id (str): the voter ID

        Returns:
            float: the voter's weight
        """
        record = self.voters.get(voter_id, {"answered": 0, "correct": 0})
        return trust(record["correct"], record["answered"])

    def add_vote(self, item: dict, voter_id: str) -> None:
        """Applies one vote the way the vote-processor Lambda does, or grades it if it's on a dummy hint.

        Args:
            item (dict): a queue item with "hint" and "vote" fields
            voter_id (str): the voter ID from the cookie, which replaces the session ID for counting

        Raises:
            ValueError: if the vote is malformed or its hint isn't in the pool
        """
        hint = item.get("hint")
        vote = item.get("vote")
        if not hint or not vote:
            raise ValueError(f"Invalid record data {item}")
        if not isinstance(vote, dict) or "sid" not in vote or "vote" not in vote:
            raise ValueError(f"Invalid vote format {vote}")
        if vote["vote"] not in [-1, 0, 1]:
            raise ValueError(f"Invalid vote value {vote['vote']}")

        url = hint.get("url")
        if not url:
            raise ValueError(f"Missing URL in hint {hint}")

        with self._lock:
            record = self.voters.setdefault(voter_id, {"answered": 0, "correct": 0})

            dummy = self.dummies.get(url)
            if dummy is not None:
                # Only a voter's first answer on each dummy hint is graded
                if voter_id not in dummy["graded"]:
                    dummy["graded"].add(voter_id)
                    record["answered"] += 1
                    if vote["vote"] == dummy["expected"]:
                        record["correct"] += 1
                return

            stored = self.pool.get(url)
            if stored is None:
                raise ValueError(f"Failed to find hint to vote on {url}")

            # One vote per voter per hint, latest wins
            votes = [existing for existing in stored["votes"] if existing["voter"] != voter_id]
            # The weight is fixed when the vote is cast, so later dummy answers don't change past votes
            votes.append({
                "voter": voter_id,
                "sid": vote["sid"],
                "vote": vote["vote"],
                "weight": self._weight(voter_id),
                # VIP voters see the same app; their votes are only marked, for the lab to use
                "vip": record.get("vip", False),
            })
            stored["votes"] = votes

            if analyze_votes(votes):
                del self.pool[url]
                self.settled.append({
                    "url": url,
                    "outcome": settle_outcome(votes),
                    "weighted_total": round(weighted_sum(votes), 2),
                    "votes": votes,
                })

    def mark_vip(self, voter_id: str) -> None:
        """Marks a voter as VIP, for votes they cast from now on.

        Args:
            voter_id (str): the voter ID from the cookie
        """
        with self._lock:
            self.voters.setdefault(voter_id, {"answered": 0, "correct": 0})["vip"] = True

    def invalidate_session(self, sid: str) -> None:
        """Records an invalid session. Like the real backend, its votes still count.

        Args:
            sid (str): the session ID to invalidate
        """
        with self._lock:
            self.invalid_sids.add(sid)

    def state(self) -> dict:
        """Summarizes the store for the /mock/state page.

        Returns:
            dict: pool, settled hints, voters and invalid sessions
        """
        with self._lock:
            return {
                "voters": {
                    voter_id: {**record, "weight": round(self._weight(voter_id), 2)}
                    for voter_id, record in self.voters.items()
                },
                "pool": [
                    {"url": hint["url"], "insert-time": hint["insert-time"], "votes": hint["votes"]}
                    for hint in sorted(self.pool.values(), key=lambda hint: hint["insert-time"])
                ],
                "settled": list(self.settled),
                "invalid_sids": sorted(self.invalid_sids),
            }
