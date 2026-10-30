import gzip
import json
from decimal import Decimal
from unittest.mock import MagicMock

import boto3
import pytest
from moto import mock_aws

from backend.src.services.DynamoDBService import DynamoDBService
from backend.tests.services.services_test_utils import (
    GSI_NAME,
    create_powerlinker_table,
    hint_json_bytes,
    make_hint_dict,
    make_hint_url,
    seed_powerlinker_item,
)


class TestQueryTable:
    def setup_method(self):
        self.mock = mock_aws()
        self.mock.start()
        dynamodb = boto3.resource("dynamodb", region_name="us-west-2")
        self.table = create_powerlinker_table(dynamodb, "test_table")
        hint1 = make_hint_dict(id1="ABCD-123", id2="EFGH-456", url=make_hint_url("ABCD-123", "EFGH-456"))
        hint2 = make_hint_dict(id1="IJKL-789", id2="MNOP-012", url=make_hint_url("IJKL-789", "MNOP-012"))
        seed_powerlinker_item(self.table, url=hint1["url"], insert_time=1, hint_dict=hint1)
        seed_powerlinker_item(self.table, url=hint2["url"], insert_time=2, hint_dict=hint2)

    def teardown_method(self):
        try:
            self.mock.stop()
        except RuntimeError:
            pass

    def test_returns_decompressed_hints_with_insert_time_and_url(self):
        result = DynamoDBService.query_table(2, 0, "record_attachment", "test_table", GSI_NAME)
        assert len(result) == 2
        assert result[0] == {
            "id1": "ABCD-123",
            "id2": "EFGH-456",
            "recordType": "record_attachment",
            "insert-time": 1,
            "url": make_hint_url("ABCD-123", "EFGH-456"),
        }
        assert result[1]["insert-time"] == 2
        assert result[1]["url"] == make_hint_url("IJKL-789", "MNOP-012")

    def test_starts_looking_at_insert_time(self):
        result = DynamoDBService.query_table(2, 1, "record_attachment", "test_table", GSI_NAME)
        assert len(result) == 2
        assert result[0]["insert-time"] == 2
        assert result[1]["insert-time"] == 1

    def test_respects_count_limit(self):
        result = DynamoDBService.query_table(1, 0, "record_attachment", "test_table", GSI_NAME)
        assert len(result) == 1

    def test_raises_when_no_hints_found(self):
        with pytest.raises(Exception, match="No hints found for the provided parameters."):
            DynamoDBService.query_table(1, 3, "bad_hint_or_record_type", "test_table", GSI_NAME)

    def test_raises_on_invalid_table(self):
        with pytest.raises(Exception):
            DynamoDBService.query_table(1, 0, "record_attachment", "non_existent_table", GSI_NAME)


class TestUpdateTable:
    def setup_method(self):
        self.mock = mock_aws()
        self.mock.start()
        dynamodb = boto3.resource("dynamodb", region_name="us-west-2")
        self.table = create_powerlinker_table(dynamodb, "test_table")
        self.url = make_hint_url()
        seed_powerlinker_item(self.table, url=self.url, insert_time=1, votes=[])

    def teardown_method(self):
        try:
            self.mock.stop()
        except RuntimeError:
            pass

    def test_updates_votes_on_existing_item(self):
        new_votes = [{"sid": "user-1", "vote": 1}]
        DynamoDBService.update_table(self.table, 1, new_votes, self.url)
        item = self.table.get_item(Key={"url": self.url, "insert-time": 1})["Item"]
        assert item["votes"] == new_votes

    def test_raises_when_update_fails(self):
        table = MagicMock()
        table.update_item.return_value = {"ResponseMetadata": {"HTTPStatusCode": 500}}
        with pytest.raises(Exception, match="Vote update failed"):
            DynamoDBService.update_table(table, 1, [], self.url)


class TestRemoveHintFromTable:
    def setup_method(self):
        self.mock = mock_aws()
        self.mock.start()
        dynamodb = boto3.resource("dynamodb", region_name="us-west-2")
        self.table = create_powerlinker_table(dynamodb, "test_table")
        self.url = make_hint_url()
        seed_powerlinker_item(self.table, url=self.url, insert_time=1)

    def teardown_method(self):
        try:
            self.mock.stop()
        except RuntimeError:
            pass

    def test_deletes_item_and_returns_true(self):
        result = DynamoDBService.remove_hint_from_table(self.table, self.url, 1)
        assert result is True
        assert "Item" not in self.table.get_item(Key={"url": self.url, "insert-time": 1})

    def test_raises_when_delete_fails(self):
        table = MagicMock()
        table.delete_item.return_value = {"ResponseMetadata": {"HTTPStatusCode": 500}}
        with pytest.raises(Exception, match="Hint removal failed"):
            DynamoDBService.remove_hint_from_table(table, self.url, 1)


class TestPutHintIntoTable:
    def setup_method(self):
        self.mock = mock_aws()
        self.mock.start()
        dynamodb = boto3.resource("dynamodb", region_name="us-west-2")
        self.table = create_powerlinker_table(dynamodb, "test_table")

    def teardown_method(self):
        try:
            self.mock.stop()
        except RuntimeError:
            pass

    def test_inserts_item_with_expected_schema(self):
        url = make_hint_url()
        hint_dict = make_hint_dict(url=url)
        hint_bytes = hint_json_bytes(hint_dict)
        DynamoDBService.put_hint_into_table(self.table, url, hint_bytes)
        items = self.table.scan()["Items"]
        assert len(items) == 1
        item = items[0]
        assert item["url"] == url
        assert item["hint-type"] == "record_attachment"
        assert item["votes"] == []
        assert isinstance(item["insert-time"], Decimal)
        decompressed = json.loads(gzip.decompress(bytes(item["hint-json"])).decode("utf-8"))
        assert decompressed == hint_dict

    def test_raises_when_put_fails(self):
        table = MagicMock()
        table.put_item.return_value = {"ResponseMetadata": {"HTTPStatusCode": 500}}
        with pytest.raises(Exception, match="Failed to put new hint into PowerLinkerAuto table"):
            DynamoDBService.put_hint_into_table(table, make_hint_url(), b"bytes")
