import gzip
import json
from json import dumps as json_dumps

import boto3
import pytest
from moto import mock_aws

GSI_NAME = "hint-type-insert-time-index"
PL_TABLE_NAME = "PowerLinkerAuto"
GS_TABLE_NAME = "GrowthSpurtHints"


def hint_json_bytes(hint_dict: dict) -> bytes:
    return gzip.compress(json.dumps(hint_dict).encode("utf-8"))


def make_hint_url(id1: str = "QL3F-BPF9", id2: str = "LB2W-SVH") -> str:
    return (
        "https://www.familysearch.org/search/linker?"
        f"pal=/ark:/61903/1:1:{id1}&id={id2}&cid=byurll"
    )


def make_hint_dict(**overrides) -> dict:
    hint = {
        "id1": "ABCD-123",
        "id2": "EFGH-456",
        "recordType": "record_attachment",
        "url": make_hint_url("ABCD-123", "EFGH-456"),
    }
    hint.update(overrides)
    return hint


def make_vote(sid: str = "user-1", value: int = 1) -> dict:
    return {"sid": sid, "vote": value}


def make_sqs_record(hint: dict, vote: dict) -> dict:
    return {"body": json_dumps({"hint": hint, "vote": vote})}


def create_powerlinker_table(dynamodb, table_name: str = PL_TABLE_NAME):
    return dynamodb.create_table(
        TableName=table_name,
        KeySchema=[
            {"AttributeName": "url", "KeyType": "HASH"},
            {"AttributeName": "insert-time", "KeyType": "RANGE"},
        ],
        AttributeDefinitions=[
            {"AttributeName": "url", "AttributeType": "S"},
            {"AttributeName": "insert-time", "AttributeType": "N"},
            {"AttributeName": "hint-type", "AttributeType": "S"},
        ],
        GlobalSecondaryIndexes=[
            {
                "IndexName": GSI_NAME,
                "KeySchema": [
                    {"AttributeName": "hint-type", "KeyType": "HASH"},
                    {"AttributeName": "insert-time", "KeyType": "RANGE"},
                ],
                "Projection": {"ProjectionType": "ALL"},
            }
        ],
        BillingMode="PAY_PER_REQUEST",
    )


def create_gs_hint_table(dynamodb, table_name: str = GS_TABLE_NAME):
    return dynamodb.create_table(
        TableName=table_name,
        KeySchema=[{"AttributeName": "url", "KeyType": "HASH"}],
        AttributeDefinitions=[{"AttributeName": "url", "AttributeType": "S"}],
        BillingMode="PAY_PER_REQUEST",
    )


def seed_powerlinker_item(
    table,
    url: str | None = None,
    insert_time: int = 1,
    hint_type: str = "record_attachment",
    votes: list | None = None,
    hint_dict: dict | None = None,
):
    hint = hint_dict or make_hint_dict(url=url or make_hint_url())
    url = url or hint["url"]
    table.put_item(
        Item={
            "url": url,
            "insert-time": insert_time,
            "hint-type": hint_type,
            "hint-json": hint_json_bytes(hint),
            "votes": votes if votes is not None else [],
        }
    )
    return {"url": url, "insert-time": insert_time, "hint": hint, "votes": votes or []}


def seed_gs_hint_item(
    table,
    url: str | None = None,
    quick_search: str = "1#some#path",
    assigned_to: str = "user-1",
):
    url = url or make_hint_url()
    table.put_item(
        Item={
            "url": url,
            "quick-search": quick_search,
            "assigned-to": assigned_to,
            "timestamp-assigned": 1234567890,
            "powerlinker-allowed": True,
        }
    )
    return url


def make_vote_service(pl_table, gs_table):
    from backend.src.services.VoteService import VoteService

    service = VoteService.__new__(VoteService)
    service.table = pl_table
    service.gs_hint_table = gs_table
    return service


@pytest.fixture
def mock_aws_tables():
    with mock_aws():
        dynamodb = boto3.resource("dynamodb", region_name="us-west-2")
        pl_table = create_powerlinker_table(dynamodb)
        gs_table = create_gs_hint_table(dynamodb)
        yield pl_table, gs_table
