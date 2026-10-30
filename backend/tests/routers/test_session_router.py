import datetime
from decimal import Decimal
from unittest.mock import Mock, patch

import pytest
from fastapi import HTTPException

from backend.src.routers.session_router import invalidate_session


class TestInvalidateSession:
    def mock_put_item(self, TableName, Item):
        time = datetime.datetime.now()
        assert Item['expiry'] <= Decimal((time + datetime.timedelta(hours=48)).timestamp() * 1000)
        assert Item['sid'] == "test-sid"
        assert TableName == 'PowerLinkerInvalidSid'
        return {
            "ResponseMetadata": {
                "HTTPStatusCode": 200
            }
        }

    @pytest.mark.asyncio
    async def test_put_fail(self):
        with patch("backend.src.routers.session_router.boto3_resource") as boto3_mock:
            mocked_dynamodb = Mock()
            boto3_mock.return_value = mocked_dynamodb

            mocked_invalid_table = Mock()
            mocked_dynamodb.Table.return_value = mocked_invalid_table
            mocked_invalid_table.put_item.return_value = {
                "ResponseMetadata": {
                    "HTTPStatusCode": 500
                }
            }

            with pytest.raises(HTTPException) as exc_info:
                await invalidate_session("test-sid")

            assert exc_info.value.status_code == 500
            assert "Failed to put test-sid" in exc_info.value.detail

    @pytest.mark.asyncio
    async def test_invalidate_session_success(self):
        with patch("backend.src.routers.session_router.boto3_resource") as boto3_mock:
            mocked_dynamodb = Mock()
            boto3_mock.return_value = mocked_dynamodb

            mocked_invalid_table = Mock()
            mocked_dynamodb.Table.return_value = mocked_invalid_table
            mocked_invalid_table.put_item = self.mock_put_item

            response = await invalidate_session("test-sid")

            assert response["message"].startswith("Session invalidated. Timestamp set to ")
