import gzip
import json
from json import loads as json_loads
from unittest.mock import AsyncMock, MagicMock, patch

import boto3
import pytest
from moto import mock_aws

from backend.src.services.VoteService import (
    MAX_SKIPS,
    MIN_SOLID_VOTES,
    NEGATIVE_THRESHOLD,
    POSITIVE_THRESHOLD,
    VoteService,
    get_vote_service,
)
from backend.tests.services.services_test_utils import (
    create_gs_hint_table,
    create_powerlinker_table,
    make_hint_dict,
    make_hint_url,
    make_sqs_record,
    make_vote,
    make_vote_service,
    seed_gs_hint_item,
    seed_powerlinker_item,
)


class TestAnalyzeVotes:
    def test_returns_true_when_sum_reaches_positive_threshold(self):
        votes = [make_vote(f"user-{i}", 1) for i in range(3)]
        assert VoteService.analyze_votes(votes) is True

    def test_returns_true_when_sum_reaches_negative_threshold(self):
        votes = [make_vote(f"user-{i}", -1) for i in range(3)]
        assert VoteService.analyze_votes(votes) is True

    def test_returns_true_when_solid_votes_reach_minimum(self):
        votes = [make_vote(f"user-{i}", 1) for i in range(MIN_SOLID_VOTES)]
        assert VoteService.analyze_votes(votes) is True

    def test_returns_true_when_total_votes_reach_max_skips(self):
        votes = [make_vote(f"user-{i}", 0) for i in range(MAX_SKIPS)]
        assert VoteService.analyze_votes(votes) is True

    def test_returns_false_below_all_thresholds(self):
        votes = [make_vote("user-1", 1), make_vote("user-2", 0)]
        assert VoteService.analyze_votes(votes) is False

    def test_skips_excluded_from_sum_and_solid_count(self):
        votes = [make_vote("user-1", 0), make_vote("user-2", 0), make_vote("user-3", 1)]
        assert VoteService.analyze_votes(votes) is False


class TestBuildNewVoteList:
    def test_appends_new_vote(self):
        existing = [make_vote("user-1", 1)]
        new_vote = make_vote("user-2", -1)
        result = VoteService._build_new_vote_list(existing, new_vote)
        assert result == [make_vote("user-1", 1), make_vote("user-2", -1)]

    def test_replaces_existing_sid(self):
        existing = [make_vote("user-1", 1), make_vote("user-2", -1)]
        new_vote = make_vote("user-1", -1)
        result = VoteService._build_new_vote_list(existing, new_vote)
        assert result == [make_vote("user-2", -1), make_vote("user-1", -1)]


class TestFormatBatchResult:
    def test_returns_summary_only_when_no_errors(self):
        result = VoteService._format_batch_result(2, 2, [])
        assert result == "Batch processing completed with 2/2 (100.0%) successful updates"

    def test_includes_errors_when_present(self):
        errors = ["Error processing record: bad data"]
        result = VoteService._format_batch_result(1, 2, errors)
        assert "Batch processing completed with 1/2 (50.0%) successful updates" in result
        assert "Errors:\nError processing record: bad data" in result


class TestModifyGsHint:
    def setup_method(self):
        self.service = VoteService.__new__(VoteService)

    def test_sets_attach_me_when_positive_count_reaches_threshold(self):
        gs_hint = {"quick-search": "1#a#b", "assigned-to": "user-1", "timestamp-assigned": 1}
        votes = [make_vote(f"user-{i}", 1) for i in range(POSITIVE_THRESHOLD)]
        self.service._modify_gs_hint(gs_hint, votes)
        assert gs_hint["quick-search"] == "ATTACH_ME"

    def test_preserves_quick_search_suffix_when_below_threshold(self):
        gs_hint = {"quick-search": "1#segment#path", "assigned-to": "user-1", "timestamp-assigned": 1}
        votes = [make_vote("user-1", 1), make_vote("user-2", -1)]
        self.service._modify_gs_hint(gs_hint, votes)
        assert gs_hint["quick-search"] == "0#segment#path"

    def test_does_not_set_rejected_for_negative_votes_only(self):
        gs_hint = {"quick-search": "1#segment#path", "assigned-to": "user-1", "timestamp-assigned": 1}
        votes = [make_vote(f"user-{i}", -1) for i in range(3)]
        self.service._modify_gs_hint(gs_hint, votes)
        assert gs_hint["quick-search"] == "REJECTED"

    def test_sets_powerlinker_allowed_false_when_skips_reach_max(self):
        gs_hint = {"quick-search": "1#a#b"}
        votes = [make_vote(f"user-{i}", 0) for i in range(MAX_SKIPS)]
        self.service._modify_gs_hint(gs_hint, votes)
        assert gs_hint["powerlinker-allowed"] is False

    def test_sets_powerlinker_allowed_false_when_vote_count_reaches_minimum(self):
        gs_hint = {"quick-search": "1#a#b"}
        votes = [make_vote(f"user-{i}", 1) for i in range(MIN_SOLID_VOTES)]
        self.service._modify_gs_hint(gs_hint, votes)
        assert gs_hint["powerlinker-allowed"] is False

    def test_removes_assignment_fields(self):
        gs_hint = {"quick-search": "1#a#b", "assigned-to": "user-1", "timestamp-assigned": 1}
        self.service._modify_gs_hint(gs_hint, [make_vote("user-1", 1)])
        assert "assigned-to" not in gs_hint
        assert "timestamp-assigned" not in gs_hint


class TestBuildGsUpdateExpression:
    def setup_method(self):
        self.service = VoteService.__new__(VoteService)

    def test_builds_set_and_remove_expression(self):
        gs_hint = {"quick-search": "ATTACH_ME"}
        expr, names, values = self.service._build_gs_update_expression(gs_hint)
        assert "#quick_search" in expr
        assert "#powerlinker_allowed" in expr
        assert "REMOVE #assigned_to, #timestamp_assigned" in expr
        assert names["#quick_search"] == "quick-search"
        assert names["#powerlinker_allowed"] == "powerlinker-allowed"
        assert values[":quick_search"] == "ATTACH_ME"
        assert values[":powerlinker_allowed"] is False


class TestBuildPlHintBytes:
    @pytest.mark.asyncio
    async def test_returns_gzip_of_json_hint(self):
        service = VoteService.__new__(VoteService)
        pl_hint = {"id1": "ABCD-123", "id2": "EFGH-456"}
        mock_tt = MagicMock()
        mock_tt.make_powerlinker_hint = AsyncMock(return_value=pl_hint)

        with patch("backend.src.services.VoteService.get_tt_service", return_value=mock_tt):
            result = await service.build_pl_hint_bytes(make_hint_url(), links={"a": "b"})

        assert json_loads(gzip.decompress(result).decode("utf-8")) == pl_hint
        mock_tt.make_powerlinker_hint.assert_awaited_once_with(
            make_hint_url(), "record_attachment", {"a": "b"}
        )


class TestProcessVoteRecord:
    def setup_method(self):
        self.mock = mock_aws()
        self.mock.start()
        dynamodb = boto3.resource("dynamodb", region_name="us-west-2")
        self.pl_table = create_powerlinker_table(dynamodb)
        self.gs_table = create_gs_hint_table(dynamodb)
        self.service = make_vote_service(self.pl_table, self.gs_table)

    def teardown_method(self):
        try:
            self.mock.stop()
        except RuntimeError:
            pass

    @pytest.mark.asyncio
    async def test_updates_votes_on_happy_path(self):
        url = make_hint_url()
        hint = make_hint_dict(url=url)
        seed_powerlinker_item(self.pl_table, url=url, insert_time=1, votes=[], hint_dict=hint)
        record = make_sqs_record(hint, make_vote("user-1", 1))

        ok, error = await self.service._process_vote_record(record)

        assert ok is True
        assert error is None
        item = self.pl_table.get_item(Key={"url": url, "insert-time": 1})["Item"]
        assert item["votes"] == [make_vote("user-1", 1)]

    @pytest.mark.asyncio
    async def test_returns_false_for_invalid_record_data(self):
        record = {"body": json.dumps({"hint": None, "vote": None})}
        ok, error = await self.service._process_vote_record(record)
        assert ok is False
        assert "Invalid record data" in error

    @pytest.mark.asyncio
    async def test_returns_false_for_invalid_vote_format(self):
        hint = make_hint_dict()
        record = make_sqs_record(hint, {"sid": "user-1"})
        ok, error = await self.service._process_vote_record(record)
        assert ok is False
        assert "Invalid vote format" in error

    @pytest.mark.asyncio
    async def test_returns_false_for_invalid_vote_value(self):
        hint = make_hint_dict()
        record = make_sqs_record(hint, {"sid": "user-1", "vote": 2})
        ok, error = await self.service._process_vote_record(record)
        assert ok is False
        assert "Invalid vote value" in error

    @pytest.mark.asyncio
    async def test_returns_false_when_url_missing(self):
        hint = {"id1": "ABCD-123", "id2": "EFGH-456"}
        record = make_sqs_record(hint, make_vote("user-1", 1))
        ok, error = await self.service._process_vote_record(record)
        assert ok is False
        assert "Missing URL in hint" in error

    @pytest.mark.asyncio
    async def test_returns_false_when_hint_not_found(self):
        hint = make_hint_dict(url=make_hint_url("MISS-ING", "NOTF-OUND"))
        record = make_sqs_record(hint, make_vote("user-1", 1))
        ok, error = await self.service._process_vote_record(record)
        assert ok is False
        assert "Failed to find hint to vote on" in error

    @pytest.mark.asyncio
    async def test_triggers_removal_when_votes_cross_threshold(self):
        url = make_hint_url()
        hint = make_hint_dict(url=url)
        existing_votes = [make_vote(f"user-{i}", 1) for i in range(POSITIVE_THRESHOLD - 1)]
        seed_powerlinker_item(self.pl_table, url=url, insert_time=1, votes=existing_votes, hint_dict=hint)
        seed_gs_hint_item(self.gs_table, url=url)
        record = make_sqs_record(hint, make_vote("user-final", 1))

        with patch.object(
            self.service, "_remove_and_replace_hint", new_callable=AsyncMock
        ) as mock_remove:
            ok, error = await self.service._process_vote_record(record)

        assert ok is True
        mock_remove.assert_awaited_once()


class TestProcessVoteBatch:
    def setup_method(self):
        self.mock = mock_aws()
        self.mock.start()
        dynamodb = boto3.resource("dynamodb", region_name="us-west-2")
        pl_table = create_powerlinker_table(dynamodb)
        gs_table = create_gs_hint_table(dynamodb)
        self.service = make_vote_service(pl_table, gs_table)

    def teardown_method(self):
        try:
            self.mock.stop()
        except RuntimeError:
            pass

    @pytest.mark.asyncio
    async def test_returns_empty_failures_for_empty_records(self):
        result = await self.service.process_vote_batch({"Records": []}, {})
        assert result == {"batchItemFailures": []}

    @pytest.mark.asyncio
    async def test_processes_mixed_valid_and_invalid_records(self):
        valid_hint = make_hint_dict()
        seed_powerlinker_item(self.service.table, url=valid_hint["url"], insert_time=1, hint_dict=valid_hint)
        event = {
            "Records": [
                make_sqs_record(valid_hint, make_vote("user-1", 1)),
                {"body": json.dumps({"hint": None, "vote": None})},
            ]
        }

        with patch.object(self.service, "_format_batch_result", return_value="summary") as mock_format:
            result = await self.service.process_vote_batch(event, {})

        assert result == {"batchItemFailures": []}
        mock_format.assert_called_once()
        assert mock_format.call_args[0][0] == 1
        assert mock_format.call_args[0][1] == 2
        assert len(mock_format.call_args[0][2]) == 1
        assert "Invalid record data" in mock_format.call_args[0][2][0]


class TestRemoveAndReplaceHint:
    def setup_method(self):
        self.mock = mock_aws()
        self.mock.start()
        dynamodb = boto3.resource("dynamodb", region_name="us-west-2")
        self.pl_table = create_powerlinker_table(dynamodb)
        self.gs_table = create_gs_hint_table(dynamodb)
        self.service = make_vote_service(self.pl_table, self.gs_table)

    def teardown_method(self):
        try:
            self.mock.stop()
        except RuntimeError:
            pass

    @pytest.mark.asyncio
    async def test_updates_gs_table_removes_pl_hint_and_fetches_new_hint(self):
        url = make_hint_url()
        seed_powerlinker_item(self.pl_table, url=url, insert_time=1)
        seed_gs_hint_item(self.gs_table, url=url)
        item = self.pl_table.get_item(Key={"url": url, "insert-time": 1})["Item"]
        item["votes"] = [make_vote(f"user-{i}", 1) for i in range(POSITIVE_THRESHOLD)]

        with patch.object(
            self.service, "_get_new_hint_from_gs_hint", new_callable=AsyncMock
        ) as mock_get_hint:
            await self.service._remove_and_replace_hint(item)

        gs_item = self.gs_table.get_item(Key={"url": url})["Item"]
        assert gs_item["quick-search"] == "ATTACH_ME"
        assert "assigned-to" not in gs_item
        assert "Item" not in self.pl_table.get_item(Key={"url": url, "insert-time": 1})
        mock_get_hint.assert_awaited_once()


class TestGetNewHintFromGsHint:
    @pytest.mark.asyncio
    async def test_checkouts_hint_builds_bytes_and_puts_into_table(self):
        service = VoteService.__new__(VoteService)
        service.table = MagicMock()
        new_hint = {"url": make_hint_url(), "links": {"x": "y"}}
        hint_bytes = b"compressed"

        with patch("backend.src.services.VoteService.GSService.checkout_hint", return_value=new_hint), \
             patch("backend.src.services.VoteService.GSService.get_links_for_hint", return_value={"x": "y"}) as mock_links, \
             patch.object(service, "build_pl_hint_bytes", new_callable=AsyncMock, return_value=hint_bytes) as mock_build, \
             patch("backend.src.services.VoteService.DynamoDBService.put_hint_into_table") as mock_put:
            await service._get_new_hint_from_gs_hint()

        mock_links.assert_called_once_with(new_hint["url"])
        mock_build.assert_awaited_once_with(
            new_hint["url"], hint_type="record_attachment", links={"x": "y"}
        )
        mock_put.assert_called_once_with(service.table, new_hint["url"], hint_bytes)


class TestGetVoteService:
    def test_returns_cached_instance(self):
        get_vote_service.cache_clear()
        with patch.object(VoteService, "__init__", lambda self: None):
            first = get_vote_service()
            second = get_vote_service()
        assert first is second
        get_vote_service.cache_clear()
