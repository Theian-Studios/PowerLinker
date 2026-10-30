from ast import literal_eval
from json import loads as json_loads
import os
import urllib.parse
import urllib.request

from boto3 import client as boto3_client
from boto3 import resource as boto3_resource

GS_HINT_TABLE_NAME = "GrowthSpurtHints"


class GSService:
    """Service for interacting with the GrowthSpurt API."""

    @staticmethod
    def get_gs_auth_token() -> str:
        """Gets the authentication token for the GrowthSpurt API.
        
        Returns:
            the authentication token for the GrowthSpurt API.
        """
        client = boto3_client("secretsmanager", region_name="us-west-2")
        response = client.get_secret_value(SecretId="GrowthSpurtAPI/auth/powerlinker")
        secret = json_loads(response["SecretString"])
        return secret["apiKey"]

    @staticmethod
    def get_base_gs_url() -> str:
        """Gets the base URL for the GrowthSpurt API.
        
        Returns:
            the base URL for the GrowthSpurt API.
        """
        match os.getenv("ENV"):
            case "dev":
                return "http://localhost:8000"
            case "stg":
                return "https://gs.rll-dev.byu.edu"
            case "prd":
                return "https://gs.rll.byu.edu"
            case _:
                raise Exception(f"Invalid environment: {os.getenv('ENV')}")

    CHECKOUT_FALLBACK = [
        {"OQH": "true", "TEH": "true"},
        {"OQH": "false", "TEH": "true"},
        {"OQH": "false", "TEH": "false"},
    ]

    @staticmethod
    def checkout_hint(hint_type: str="record_attachment") -> dict:
        """Checks out a hint from the GrowthSpurtHints table.
        
        Args:
            hint_type: the type of hint to checkout.

        Returns:
            the hint
        """
        try:
            auth_token = GSService.get_gs_auth_token()
        except Exception as error:
            raise Exception(f"Failed to get GrowthSpurt auth token {error}")

        for flags in GSService.CHECKOUT_FALLBACK:
            params = urllib.parse.urlencode({
                "count": 1,
                "hintType": hint_type,
                "project": "Powerlinker",
                "powerlinkerAllowed": "true",
                **flags,
            })

            checkout_req = urllib.request.Request(
                f"{GSService.get_base_gs_url()}/hints/checkout?{params}",
                data=b"",
                method="POST",
                headers={"X-App-Token": auth_token},
            )

            try:
                with urllib.request.urlopen(checkout_req) as response:
                    hints = json_loads(response.read())
            except Exception as error:
                raise Exception(f"Failed to get new hint from GrowthSpurtHints table {error}")

            if hints:
                return hints[0]

        raise Exception("Failed to get new hint from GrowthSpurtHints table: no hints available for Powerlinker")

    @staticmethod
    def normalize_links(links: object) -> dict[str, str]:
        """Normalizes the links of a hint into a dict.

        Args:
            links: the raw links value read from the hint item.

        Returns:
            the links as a dict, or an empty dict if absent or unparseable.
        """
        if not links:
            return {}
        if isinstance(links, dict):
            return links

        try:
            parsed = literal_eval(links)
        except (ValueError, SyntaxError):
            return {}

        return parsed if isinstance(parsed, dict) else {}

    @staticmethod
    def get_links_for_hint(url: str) -> dict[str, str]:
        """Gets the record persona to tree pid links for a hint.

        Args:
            url: the url of the hint to get links for

        Returns:
            the links for the hint, or an empty dict if it has none
        """
        gs_hint_table = boto3_resource("dynamodb", region_name="us-west-2").Table(GS_HINT_TABLE_NAME)
        gs_hint = gs_hint_table.get_item(Key={"url": url}).get("Item", {})
        return GSService.normalize_links(gs_hint.get("links"))
