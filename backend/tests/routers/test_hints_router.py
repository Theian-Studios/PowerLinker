import json
from unittest.mock import Mock, patch

import pytest
from fastapi import HTTPException

from backend.src.routers.hints_router import get_hints, submit_votes


class TestHintList:
    def mock_query_table(self, count, last_insert_time, record_type):
        if record_type != "record_attachment" or count == 0:
            raise Exception("No hints found for the provided parameters.")

        return [
            {
                "id1": "pid1",
                "id2": "ark1",
                "recordType": "record_attachment"
            },
            {
                "id1": "pid2",
                "id2": "ark2",
                "recordType": "record_attachment"
            }
        ]

    def mock_query_table_empty(self, count, last_insert_time, record_type):
        raise Exception("No hints found for the provided parameters.")

    @pytest.mark.asyncio
    async def test_hint_list(self, monkeypatch):
        monkeypatch.setattr(
            "backend.src.routers.hints_router.DynamoDBService.query_table",
            self.mock_query_table
        )
        monkeypatch.setattr("backend.src.routers.hints_router.shuffle", lambda hints: hints)

        response = await get_hints("record_attachment", 123, 2)

        assert response == [
            {
                "id1": "pid1",
                "id2": "ark1",
                "recordType": "record_attachment"
            },
            {
                "id1": "pid2",
                "id2": "ark2",
                "recordType": "record_attachment"
            }
        ]

    @pytest.mark.asyncio
    async def test_invalid_record_type(self, monkeypatch):
        monkeypatch.setattr(
            "backend.src.routers.hints_router.DynamoDBService.query_table",
            self.mock_query_table
        )

        with pytest.raises(HTTPException) as exc_info:
            await get_hints("", 0, 10)

        assert exc_info.value.status_code == 500
        assert "Error querying table: No hints found for the provided parameters." in exc_info.value.detail

    @pytest.mark.asyncio
    async def test_no_hints_found(self, monkeypatch):
        monkeypatch.setattr(
            "backend.src.routers.hints_router.DynamoDBService.query_table",
            self.mock_query_table_empty
        )

        with pytest.raises(HTTPException) as exc_info:
            await get_hints("record_attachment", 123, 2)

        assert exc_info.value.status_code == 500
        assert "Error querying table: No hints found for the provided parameters." in exc_info.value.detail


class TestSubmitVotes:
    @pytest.mark.asyncio
    async def test_no_votes(self):
        with patch("backend.src.routers.hints_router.boto3_client") as boto3_mock:
            sqs = Mock()
            boto3_mock.return_value = sqs
            sqs.get_queue_url.return_value = {"QueueUrl": "https://sqs.test/vote-queue"}

            with pytest.raises(HTTPException) as exc_info:
                await submit_votes([])

        assert exc_info.value.status_code == 400
        assert exc_info.value.detail == "No votes to submit"
        sqs.send_message_batch.assert_not_called()

    @pytest.mark.asyncio
    async def test_queues_votes(self):
        votes = [
            {
                "hint": {"id1": "ABDC-123", "id2": "1234-ABC", "recordType": "record_attachment"},
                "vote": {"sid": "user-3", "vote": 1}
            },
            {
                "hint": {"id1": "EFGH-123", "id2": "5678-ABC", "recordType": "record_attachment"},
                "vote": {"sid": "user-3", "vote": -1}
            },
        ]

        with patch("backend.src.routers.hints_router.boto3_client") as boto3_mock:
            sqs = Mock()
            boto3_mock.return_value = sqs
            sqs.get_queue_url.return_value = {"QueueUrl": "https://sqs.test/vote-queue"}
            sqs.send_message_batch.return_value = {"Successful": [{"Id": "0"}, {"Id": "1"}]}

            result = await submit_votes(votes)

        assert result is None
        sqs.get_queue_url.assert_called_once_with(QueueName="PowerLinkerVoteQueue")
        sqs.send_message_batch.assert_called_once_with(
            QueueUrl="https://sqs.test/vote-queue",
            Entries=[
                {"Id": "0", "MessageBody": json.dumps(votes[0])},
                {"Id": "1", "MessageBody": json.dumps(votes[1])},
            ],
        )

    @pytest.mark.asyncio
    async def test_batches_large_payload(self):
        votes = [
            {
                "hint": {"id1": f"PID-{i}", "id2": f"ARK-{i}", "recordType": "record_attachment"},
                "vote": {"sid": "user-1", "vote": 1}
            }
            for i in range(11)
        ]

        with patch("backend.src.routers.hints_router.boto3_client") as boto3_mock:
            sqs = Mock()
            boto3_mock.return_value = sqs
            sqs.get_queue_url.return_value = {"QueueUrl": "https://sqs.test/vote-queue"}
            sqs.send_message_batch.return_value = {"Successful": []}

            result = await submit_votes(votes)

        assert result is None
        assert sqs.send_message_batch.call_count == 2
        first_batch = sqs.send_message_batch.call_args_list[0].kwargs["Entries"]
        second_batch = sqs.send_message_batch.call_args_list[1].kwargs["Entries"]
        assert len(first_batch) == 10
        assert len(second_batch) == 1
