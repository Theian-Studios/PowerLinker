from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.src.services.TreeTapperService import TreeTapperService, get_tt_service


class TestMakePowerlinkerHint:
    @pytest.mark.asyncio
    async def test_delegates_to_treetapper_helper(self):
        service = TreeTapperService.__new__(TreeTapperService)
        service.tt_client = MagicMock()
        expected = {"id1": "ABCD-123", "id2": "EFGH-456"}
        url = "https://www.familysearch.org/search/linker?pal=/ark:/61903/1:1:ABCD-123&id=EFGH-456&cid=byurll"
        links = {"link": "value"}

        with patch(
            "backend.src.services.TreeTapperService.make_powerlinker_hint",
            new_callable=AsyncMock,
            return_value=expected,
        ) as mock_make:
            result = await service.make_powerlinker_hint(url, "record_attachment", links)

        assert result == expected
        mock_make.assert_awaited_once_with(service.tt_client, url, "record_attachment", links)


class TestGetTtService:
    def test_returns_cached_instance(self):
        get_tt_service.cache_clear()
        mock_client = MagicMock()

        with patch("backend.src.services.TreeTapperService.ParameterService") as mock_params, \
             patch("backend.src.services.TreeTapperService.TreeTapperClient", return_value=mock_client):
            mock_params.return_value.get_tt_credentials.return_value = {
                "client_id": "cid",
                "username_to_password": {},
                "username_to_password_on_request": {},
            }
            first = get_tt_service()
            second = get_tt_service()

        assert first is second
        assert first.tt_client is mock_client
        get_tt_service.cache_clear()
