from fastapi import APIRouter, HTTPException
from random import choice, shuffle
from json import load as json_load, dumps as json_dumps
from os import path as os_path
from boto3 import client as boto3_client

from backend.src.services.DynamoDBService import DynamoDBService

get_hints_router = APIRouter(prefix="/hints", tags=["hints"])
submit_votes_router = APIRouter(prefix="/hints", tags=["submit-votes"])

def _build_dummy_hint(record_type: str, correct: bool | None = None) -> dict:
    """
    Builds a dummy hint.

    Args:
        record_type: the type of record to build a dummy hint for
        correct: whether the hint should be correct or incorrect

    Returns:
        a dummy hint
    """
    if correct is None:
        correct = choice([True, False])

    hints_path = os_path.join(os_path.dirname(__file__), '..', '..', 'public', 'dummy', 'hints.json')
    with open(hints_path, 'r') as file:
        hints = json_load(file)

    if correct:
        hint = choice(hints['correct'])
        hint['expected'] = 1
    else:
        hint = choice(hints['incorrect'])
        hint['expected'] = -1

    return hint


@get_hints_router.get("")
async def get_hints(
    record_type: str = "record_attachment",
    last_insert_time: int = -1,
    count: int = 10,
    dummy: bool = False,
    correct: bool | None = None,
) -> list[dict] | dict:
    """Gets hints from the database or a dummy hint for testing.

    Args:
        record_type (str): the type of record to get hints for
        last_insert_time (int): Iterate through hints, starting with an insert-time 
                greater than this value
        count (int): the number of hints to get
        dummy (bool): when true, return a single dummy hint instead of querying DynamoDB
        correct (bool|None): for dummy hints, force correct/incorrect; random if omitted

    Returns:
        list[dict] | dict: hint list or a single dummy hint
    """
    if dummy:
        return _build_dummy_hint(record_type, correct)

    MAX_LOOPS = 3 # TODO: change later to 10 or something (right now because of bad data it makes it take a long time)

    loops = 0
    hints: list[dict] = []

    while True:
        try:
            hints = DynamoDBService.query_table(
                count - len(hints),
                hints[-1].get("insert-time", -1) if hints else last_insert_time,
                record_type
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Error querying table: {str(e)}")

        if hints or loops >= MAX_LOOPS:
            break

        loops += 1

    shuffle(hints)
    return hints

@submit_votes_router.put("")
async def submit_votes(votes: list[dict]) -> None:
    """Submits votes to the database.

    Args:
        votes (list[dict]): a list of votes to submit

    Returns:
        None
    """
    SQS = boto3_client('sqs', region_name='us-west-2')
    queue_url = SQS.get_queue_url(QueueName='PowerLinkerVoteQueue')['QueueUrl']

    if not votes:
        raise HTTPException(status_code=400, detail="No votes to submit")

    entries = [
        {'Id': str(i), 'MessageBody': json_dumps(item)}
        for i, item in enumerate(votes)
    ]

    for i in range(0, len(entries), 10):
        SQS.send_message_batch(QueueUrl=queue_url, Entries=entries[i:i + 10])
