from boto3 import resource as boto3_resource
from Boto4GS import create_key_condition_expression
from typing import Any

from backend.src.services.DynamoDBService import DynamoDBService
from backend.src.services.GSService import GS_HINT_TABLE_NAME

PL_HINT_TABLE_NAME = "PowerLinkerAuto"
GS_PROJECT = "Powerlinker"
SKIP_QUICK_SEARCHES = {"ATTACH_ME", "REJECTED"}


def purge_hint_table(table_name: str) -> None:
    """Deletes every item from a hint table.

    Args:
        table_name: the name of the table to purge
    """
    table = boto3_resource("dynamodb", region_name="us-west-2").Table(table_name)
    scan_kwargs = {
        "ProjectionExpression": "#u, #t",
        "ExpressionAttributeNames": {"#u": "url", "#t": "insert-time"},
    }
    deleted = 0

    while True:
        response = table.scan(**scan_kwargs)
        for item in response.get("Items", []):
            DynamoDBService.remove_hint_from_table(table, item["url"], item["insert-time"])
            deleted += 1

        last_key = response.get("LastEvaluatedKey")
        if last_key is None:
            break
        scan_kwargs["ExclusiveStartKey"] = last_key

    print(f"Deleted {deleted} items from {table_name}")


def uncheckout_gs_hints(project: str = GS_PROJECT) -> None:
    """Releases every checked-out GrowthSpurtHints item for a project.

    Skips hints whose quick-search is ATTACH_ME or REJECTED.

    Args:
        project: the GrowthSpurt project to release hints for
    """
    table = boto3_resource("dynamodb", region_name="us-west-2").Table(GS_HINT_TABLE_NAME)
    query_kwargs = create_key_condition_expression(project=project, score=1)
    checked_out_items: list[dict] = []

    while True:
        response = table.query(**query_kwargs)
        checked_out_items.extend(response.get("Items", []))
        last_key = response.get("LastEvaluatedKey")
        if last_key is None:
            break
        query_kwargs["ExclusiveStartKey"] = last_key

    released = 0
    for item in checked_out_items:
        if _release_checked_out_hint(table, item):
            released += 1

    print(f"Released {released} checked-out hints in project {project}")


def _release_checked_out_hint(table: Any, item: dict) -> bool:
    """Sets a checked-out GS hint back to unassigned status.

    Args:
        table: the GrowthSpurtHints DynamoDB table
        item: the hint item to release

    Returns:
        True if the hint was released, False if it was skipped
    """
    quick_search = item.get("quick-search")
    if not quick_search or quick_search in SKIP_QUICK_SEARCHES:
        return False

    new_quick_search = f"0#{'#'.join(quick_search.split('#')[1:])}"
    response = table.update_item(
        Key={"url": item["url"]},
        UpdateExpression=(
            "SET #quick_search = :quick_search "
            "REMOVE #assigned_to, #timestamp_assigned"
        ),
        ExpressionAttributeNames={
            "#quick_search": "quick-search",
            "#assigned_to": "assigned-to",
            "#timestamp_assigned": "timestamp-assigned",
        },
        ExpressionAttributeValues={":quick_search": new_quick_search},
    )

    if response["ResponseMetadata"]["HTTPStatusCode"] != 200:
        raise Exception(f"Failed to uncheckout GrowthSpurtHints item {item['url']}")

    return True


if __name__ == "__main__":
    purge_hint_table(PL_HINT_TABLE_NAME)
    uncheckout_gs_hints()
