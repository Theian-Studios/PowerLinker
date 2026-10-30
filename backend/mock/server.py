"""Local mock of the PowerLinker API for frontend development without AWS or TreeTapper.

Serves the same routes as backend/src/main.py on port 8000, backed by the sample
hints in backend/public/dummy/hints.json. Run from the repo root:

    python -m backend.mock.server
"""
from random import shuffle
from typing import Any, Callable

from fastapi import Body, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware

from backend.mock.store import MockStore
from backend.mock.voters import COOKIE_MAX_AGE, COOKIE_NAME, is_vip_code, new_cookie_value, read_cookie_value

store = MockStore()

app = FastAPI(title="PowerLinker mock backend")
app.add_middleware(
    CORSMiddleware,
    # The dev server on this computer (any port, since Vite moves on when 5173 is busy), or opened
    # from a phone on the same Wi-Fi (see --lan below)
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1)(:\d+)?|http://(10\.\d+|192\.168|172\.(1[6-9]|2\d|3[01]))\.\d+\.\d+:5173|http://[a-z0-9-]+\.local:5173",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def voter_cookie(request: Request, call_next: Callable) -> Any:
    """Gives each visitor a signed anonymous voter ID and renews it on every request.

    Voters are only recorded once they vote, so requests that never vote don't create records.

    Args:
        request (Request): the incoming request
        call_next (Callable): the next handler

    Returns:
        Any: the response, with the voter cookie set
    """
    # Browsers never send cookies on CORS preflights, so don't hand out IDs on them
    if request.method == "OPTIONS":
        return await call_next(request)

    cookie_value = request.cookies.get(COOKIE_NAME)
    voter_id = read_cookie_value(cookie_value)
    if voter_id is None:
        voter_id, cookie_value = new_cookie_value()

    request.state.voter_id = voter_id

    response = await call_next(request)
    response.set_cookie(
        COOKIE_NAME,
        cookie_value,
        max_age=COOKIE_MAX_AGE,
        httponly=True,
        samesite="lax",
        secure=request.url.scheme == "https",
    )
    return response


@app.get("/hints")
async def get_hints(
    record_type: str = "record_attachment",
    last_insert_time: int = -1,
    count: int = 10,
    dummy: bool = False,
    correct: bool | None = None,
) -> list[dict] | dict:
    """Gets hints from the pool, or a dummy hint for testing.

    Args:
        record_type (str): the type of record to get hints for
        last_insert_time (int): only return hints with a greater insert-time
        count (int): the number of hints to get
        dummy (bool): when true, return a single dummy hint instead
        correct (bool|None): for dummy hints, force correct/incorrect; random if omitted

    Returns:
        list[dict] | dict: hint list or a single dummy hint
    """
    if dummy:
        return store.get_dummy_hint(correct, record_type)

    hints = store.get_hints(record_type, last_insert_time, count)
    shuffle(hints)
    return hints


@app.put("/hints")
async def submit_votes(request: Request, votes: list[dict]) -> None:
    """Applies votes right away, counted by voter cookie. The real backend queues them in SQS first.

    Args:
        request (Request): the request, carrying the voter ID
        votes (list[dict]): a list of votes to submit

    Returns:
        None
    """
    if not votes:
        raise HTTPException(status_code=400, detail="No votes to submit")

    for item in votes:
        try:
            store.add_vote(item, request.state.voter_id)
        except ValueError as error:
            # The real vote processor logs bad records and moves on
            print(f"Error processing record: {error}")


@app.post("/profile/code")
async def enter_profile_code(request: Request, code: str = Body(..., embed=True)) -> dict:
    """Marks the voter as VIP when they enter the VIP code. Nothing in the app changes for VIP voters.

    Args:
        request (Request): the request, carrying the voter ID
        code (str): the code they entered

    Returns:
        dict: whether the code was accepted
    """
    if not is_vip_code(code):
        return {"accepted": False}
    store.mark_vip(request.state.voter_id)
    return {"accepted": True}


@app.post("/session-invalidate")
async def invalidate_session(sid: str = Body(..., embed=True)) -> dict:
    """Marks a session as invalid.

    Args:
        sid (str): the session ID to invalidate

    Returns:
        dict: a message indicating the session was invalidated
    """
    store.invalidate_session(sid)
    return {"message": "Session invalidated (mock)."}


@app.get("/mock/state")
async def mock_state() -> dict:
    """Shows the hint pool, settled hints, voters and invalid sessions.

    Returns:
        dict: the current mock state
    """
    return store.state()


@app.post("/mock/reset")
async def mock_reset() -> dict:
    """Puts all sample hints back and clears votes.

    Returns:
        dict: a confirmation message
    """
    store.reset()
    return {"message": "Mock state reset."}


if __name__ == "__main__":
    import sys

    import uvicorn
    # --lan also listens on the Wi-Fi network, so a phone on the same network can use it
    uvicorn.run(app, host="0.0.0.0" if "--lan" in sys.argv else "127.0.0.1", port=8000)
