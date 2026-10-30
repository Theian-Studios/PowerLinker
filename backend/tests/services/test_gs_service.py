import json
from unittest.mock import MagicMock, patch

import boto3
import pytest
from moto import mock_aws

from backend.src.services.GSService import GSService


class TestGetBaseGsUrl:
    def test_returns_dev_url(self, monkeypatch):
        monkeypatch.setenv("ENV", "dev")
        assert GSService.get_base_gs_url() == "http://localhost:8000"

    def test_returns_stg_url(self, monkeypatch):
        monkeypatch.setenv("ENV", "stg")
        assert GSService.get_base_gs_url() == "https://gs.rll-dev.byu.edu"

    def test_returns_prd_url(self, monkeypatch):
        monkeypatch.setenv("ENV", "prd")
        assert GSService.get_base_gs_url() == "https://gs.rll.byu.edu"

    def test_raises_for_invalid_environment(self, monkeypatch):
        monkeypatch.setenv("ENV", "testing")
        with pytest.raises(Exception, match="Invalid environment: testing"):
            GSService.get_base_gs_url()


class TestGetGsAuthToken:
    def setup_method(self):
        self.mock = mock_aws()
        self.mock.start()
        client = boto3.client("secretsmanager", region_name="us-west-2")
        client.create_secret(
            Name="GrowthSpurtAPI/auth/powerlinker",
            SecretString=json.dumps({"apiKey": "test-api-key"}),
        )

    def teardown_method(self):
        try:
            self.mock.stop()
        except RuntimeError:
            pass

    def test_returns_api_key_from_secrets_manager(self):
        assert GSService.get_gs_auth_token() == "test-api-key"


class TestCheckoutHint:
    def test_returns_first_hint_from_checkout_response(self, monkeypatch):
        monkeypatch.setenv("ENV", "dev")
        hint = {"url": "https://example.com/hint", "links": {"a": "b"}}
        response = MagicMock()
        response.read.return_value = json.dumps([hint]).encode("utf-8")
        response.__enter__ = MagicMock(return_value=response)
        response.__exit__ = MagicMock(return_value=False)

        with patch("backend.src.services.GSService.GSService.get_gs_auth_token", return_value="token"), \
             patch("urllib.request.urlopen", return_value=response):
            result = GSService.checkout_hint()

        assert result == hint

    def test_builds_checkout_request_with_expected_params(self, monkeypatch):
        monkeypatch.setenv("ENV", "dev")
        hint = {"url": "https://example.com/hint"}
        response = MagicMock()
        response.read.return_value = json.dumps([hint]).encode("utf-8")
        response.__enter__ = MagicMock(return_value=response)
        response.__exit__ = MagicMock(return_value=False)
        captured = {}

        def fake_urlopen(req):
            captured["url"] = req.full_url
            captured["method"] = req.method
            captured["headers"] = dict(req.header_items())
            return response

        with patch("backend.src.services.GSService.GSService.get_gs_auth_token", return_value="my-token"), \
             patch("urllib.request.urlopen", side_effect=fake_urlopen):
            GSService.checkout_hint("record_attachment")

        assert "count=1" in captured["url"]
        assert "hintType=record_attachment" in captured["url"]
        assert "project=Powerlinker" in captured["url"]
        assert "powerlinkerAllowed=true" in captured["url"]
        assert captured["method"] == "POST"
        assert captured["headers"]["X-app-token"] == "my-token" or captured["headers"].get("X-App-Token") == "my-token"

    def test_wraps_network_errors(self, monkeypatch):
        monkeypatch.setenv("ENV", "dev")
        with patch("backend.src.services.GSService.GSService.get_gs_auth_token", return_value="token"), \
             patch("urllib.request.urlopen", side_effect=OSError("network down")):
            with pytest.raises(Exception, match="Failed to get new hint from GrowthSpurtHints table"):
                GSService.checkout_hint()

    def test_falls_back_through_oqh_teh_combinations_in_order(self, monkeypatch):
        monkeypatch.setenv("ENV", "dev")
        hint = {"url": "https://example.com/hint"}
        empty_response = MagicMock()
        empty_response.read.return_value = json.dumps([]).encode("utf-8")
        empty_response.__enter__ = MagicMock(return_value=empty_response)
        empty_response.__exit__ = MagicMock(return_value=False)
        hit_response = MagicMock()
        hit_response.read.return_value = json.dumps([hint]).encode("utf-8")
        hit_response.__enter__ = MagicMock(return_value=hit_response)
        hit_response.__exit__ = MagicMock(return_value=False)

        captured_urls = []

        def fake_urlopen(req):
            captured_urls.append(req.full_url)
            if len(captured_urls) < 3:
                return empty_response
            return hit_response

        with patch("backend.src.services.GSService.GSService.get_gs_auth_token", return_value="token"), \
             patch("urllib.request.urlopen", side_effect=fake_urlopen):
            result = GSService.checkout_hint()

        assert result == hint
        assert len(captured_urls) == 3
        assert "OQH=true" in captured_urls[0] and "TEH=true" in captured_urls[0]
        assert "OQH=false" in captured_urls[1] and "TEH=true" in captured_urls[1]
        assert "OQH=false" in captured_urls[2] and "TEH=false" in captured_urls[2]
        assert all("powerlinkerAllowed=true" in url for url in captured_urls)

    def test_raises_when_all_combinations_return_no_hints(self, monkeypatch):
        monkeypatch.setenv("ENV", "dev")
        empty_response = MagicMock()
        empty_response.read.return_value = json.dumps([]).encode("utf-8")
        empty_response.__enter__ = MagicMock(return_value=empty_response)
        empty_response.__exit__ = MagicMock(return_value=False)

        with patch("backend.src.services.GSService.GSService.get_gs_auth_token", return_value="token"), \
             patch("urllib.request.urlopen", return_value=empty_response):
            with pytest.raises(Exception, match="no hints available for Powerlinker"):
                GSService.checkout_hint()
