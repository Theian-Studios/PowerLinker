import os
import json
from typing import Any, Callable

from mangum import Mangum
import asyncio

from fastapi.exceptions import HTTPException
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.routing import APIRouter

from PyBugReporter.src.BugReporter import BugReporter
from backend.src import bug_reporter_params

from backend.src.routers.hints_router import get_hints_router, submit_votes_router
from backend.src.routers.session_router import session_router
from backend.src.services.VoteService import get_vote_service


BugReporter.setVars(*bug_reporter_params)

async def debug_middleware(request: Request, call_next: Callable) -> Any:
    """Calls the debug middleware.

    Args:
        request (Request): The incoming HTTP request.
        call_next (Callable): The next middleware or route handler to call.

    Returns:
        The response from the next middleware or route handler.
    """
    if request.url.path.startswith("/health"):
        return await call_next(request)
    print(f"{request.method} {request.url.path}")
    return await call_next(request)

allow_origins = [ 
    "https://powerlinker.rll.byu.edu", 
    "https://powerlinker.rll-dev.byu.edu",
    ] if os.environ.get("ENV") == "stg" or os.environ.get("ENV") == "prd" else ["http://localhost:5173", "http://localhost:8000", "http://localhost:1234"]

async def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
    """Handles HTTP exceptions.
    
    Args:
        request (Request): the incoming HTTP request
        exc (HTTPException): the HTTP exception to handle

    Returns:
        JSONResponse: the JSON response
    """
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail},
        headers=getattr(exc, "headers", None) or {},
    )

async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """Handles unhandled exceptions.
    
    Args:
        request (Request): the incoming HTTP request
        exc (Exception): the exception to handle

    Returns:
        JSONResponse: the JSON response
    """
    err_string = f'Error calling {request.url}: {str(exc)}'
    await BugReporter.manualBugReportAsync("Powerlinker", exc.__class__.__name__, err_string)

    return JSONResponse(
        status_code = 500,
        content = {"message": f"Server error calling {request.url}"}
    )

def build_app(routes: list[APIRouter]) -> FastAPI:
    """Builds a FastAPI app with the given routes.
    
    Args:
        routes (list[APIRouter]): a list of API routers to include in the app

    Returns:
        FastAPI: the built app
    """
    app = FastAPI()
    app.add_exception_handler(HTTPException, http_exception_handler) # type: ignore
    app.add_exception_handler(Exception, unhandled_exception_handler)
    app.add_middleware(
        CORSMiddleware,
        allow_origins = allow_origins,
        allow_credentials = True,
        allow_methods = ["*"],
        allow_headers = ["*"],
    )

    for router in routes:
        app.include_router(router)
    
    return app

get_hints_handler = Mangum(build_app([get_hints_router]))
submit_votes_handler = Mangum(build_app([submit_votes_router]))
session_handler = Mangum(build_app([session_router]))
_event_loop: asyncio.AbstractEventLoop | None = None


def process_hint_vote_handler(event: dict, context: dict) -> dict:
    """Process vote-queue messages and write votes to DynamoDB.
    
    Args:
        event (dict): the SQS event
        context (dict): the SQS context

    Returns:
        dict: SQS partial-batch response with failed message IDs
    """
    global _event_loop
    allowed_arns = json.loads(os.environ.get("ALLOWED_ARNS", "[]"))
    for record in event.get("Records", []):
        if record.get("eventSourceARN", "") not in allowed_arns:
            raise PermissionError("Unauthorized SQS trigger")
    if _event_loop is None or _event_loop.is_closed():
        _event_loop = asyncio.new_event_loop()
        asyncio.set_event_loop(_event_loop)
    return _event_loop.run_until_complete(
        get_vote_service().process_vote_batch(event, context)
    )


if __name__ == "__main__":
    import uvicorn
    app = build_app([get_hints_router, submit_votes_router, session_router])
    app.middleware("http")(debug_middleware)
    uvicorn.run(app, host="0.0.0.0", port=8000)
