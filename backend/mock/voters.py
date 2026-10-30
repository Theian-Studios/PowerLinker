"""Anonymous voter IDs kept in a signed, long-lived cookie."""
import hashlib
import hmac
from os import environ
from uuid import uuid4

COOKIE_NAME = "pl_voter"
# Chrome caps cookie lifetimes at 400 days; the cookie is renewed on every request
COOKIE_MAX_AGE = 400 * 24 * 60 * 60

# Mock only. A real deployment would read this from Parameter Store / Secrets Manager.
SECRET = environ.get("MOCK_COOKIE_SECRET", "powerlinker-mock-secret").encode()

# New voters start with prior "correct" and "answered" counts so they begin at low trust
# and earn weight by answering dummy hints correctly: (correct + 1) / (answered + 2).
PRIOR_CORRECT = 1
PRIOR_ANSWERED = 2

# Lab members enter this on the profile screen to mark their votes as VIP. It's checked here, not in the
# browser, so it isn't in the frontend's code. Exact match: all capitals, no space.
VIP_CODE = environ.get("MOCK_VIP_CODE", "RLL2026")


def _signature(voter_id: str) -> str:
    """Gets the HMAC signature for a voter ID.

    Args:
        voter_id (str): the voter ID to sign

    Returns:
        str: the hex signature
    """
    return hmac.new(SECRET, voter_id.encode(), hashlib.sha256).hexdigest()


def new_cookie_value() -> tuple[str, str]:
    """Creates a new voter ID and its signed cookie value.

    Returns:
        tuple[str, str]: the voter ID and the cookie value
    """
    voter_id = str(uuid4())
    return voter_id, f"{voter_id}.{_signature(voter_id)}"


def read_cookie_value(value: str | None) -> str | None:
    """Gets the voter ID from a cookie value if its signature is valid.

    Args:
        value (str | None): the cookie value

    Returns:
        str | None: the voter ID, or None if the cookie is missing or tampered with
    """
    if not value or "." not in value:
        return None
    voter_id, signature = value.rsplit(".", 1)
    if not hmac.compare_digest(signature, _signature(voter_id)):
        return None
    return voter_id


def is_vip_code(code: str) -> bool:
    """Checks a profile code against the VIP code.

    Args:
        code (str): the code as entered; spaces around it are ignored

    Returns:
        bool: whether it's the VIP code
    """
    return hmac.compare_digest(code.strip().encode(), VIP_CODE.encode())


def trust(correct: int, answered: int) -> float:
    """Gets how much a voter's votes count, from their dummy hint record.

    Args:
        correct (int): dummy hints the voter answered correctly
        answered (int): dummy hints the voter answered

    Returns:
        float: a weight between 0 and 1
    """
    return (correct + PRIOR_CORRECT) / (answered + PRIOR_ANSWERED)
