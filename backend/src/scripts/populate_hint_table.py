import json
import gzip
import os
import ast
from dotenv import load_dotenv
from boto3 import resource as boto3_resource
import asyncio
from TreeTapper import TreeTapperClient, make_powerlinker_hint


from backend.src.services.DynamoDBService import DynamoDBService
from backend.src.services.GSService import GSService

PL_HINT_TABLE_NAME = "PowerLinkerAuto"

FS_SESSION_ID = "p0-63KMJESgNFK.6AYN4fQ2C0n"

load_dotenv()

client_id = os.getenv('CLIENT_ID') or ''
username_to_password:dict[str, str] = ast.literal_eval(os.getenv('USERNAME_TO_PASSWORD') or '{}')
username_to_password_on_request:dict[str, str] = ast.literal_eval(os.getenv('WRITING_USERNAME_TO_PASSWORD') or '{}')

tt_client = TreeTapperClient(
    client_id=client_id,
    username_to_password=username_to_password,
    username_to_password_on_request=username_to_password_on_request
)

async def build_pl_hint_bytes(url: str, hint_type: str="record_attachment", links: dict[str, str] | None = None) -> bytes:
    """Builds a Power Linker hint from a URL.
    
    Args:
        url: the URL to build a hint from
        hint_type: the type of hint to build
        links: the links to use

    Returns:
        the built hint
    """
    pl_hint = await make_powerlinker_hint(tt_client, url, hint_type, links)
    hint_json = json.dumps(pl_hint).encode('utf-8')
    hint_bytes = gzip.compress(hint_json)
    return hint_bytes

async def populate_hint_table(table_name: str, hint_count: int=500) -> None:
    """Populates a hint table with hints.
    
    Args:
        table_name: the name of the table to populate
        hint_count: the number of hints to populate
    """
    table = boto3_resource("dynamodb", region_name="us-west-2").Table(table_name)

    for _ in range(hint_count):
        new_hint = GSService.checkout_hint()
        links = GSService.get_links_for_hint(new_hint["url"])
        hint_bytes = await build_pl_hint_bytes(new_hint["url"], hint_type="record_attachment", links=links)
        DynamoDBService.put_hint_into_table(table, new_hint["url"], hint_bytes)

if __name__ == "__main__":
    asyncio.run(populate_hint_table(PL_HINT_TABLE_NAME))