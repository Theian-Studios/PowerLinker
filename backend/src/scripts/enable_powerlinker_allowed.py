from boto3 import resource as boto3_resource
from boto3.dynamodb.conditions import Key
from typing import Any

from backend.src.services.GSService import GS_HINT_TABLE_NAME

GS_PROJECT = "Powerlinker"
SKIP_QUICK_SEARCHES = {"ATTACH_ME", "REJECTED"}
PROJECT_INDEX = "quick-search_project_index"


def enable_powerlinker_allowed(project: str = GS_PROJECT) -> None:
    """Sets powerlinker-allowed to true for every valid hint in a project.

    Skips hints whose quick-search is ATTACH_ME or REJECTED.

    Args:
        project: the GrowthSpurt project to update hints for
    """
    table = boto3_resource("dynamodb", region_name="us-west-2").Table(GS_HINT_TABLE_NAME)
    query_kwargs = {
        "IndexName": PROJECT_INDEX,
        "KeyConditionExpression": Key("project").eq(project),
    }
    items: list[dict] = []

    while True:
        response = table.query(**query_kwargs)
        items.extend(response.get("Items", []))
        last_key = response.get("LastEvaluatedKey")
        if last_key is None:
            break
        query_kwargs["ExclusiveStartKey"] = last_key

    updated = 0
    for item in items:
        if _set_powerlinker_allowed(table, item):
            updated += 1

    print(f"Set powerlinker-allowed=true on {updated} hints in project {project}")


def _set_powerlinker_allowed(table: Any, item: dict) -> bool:
    """Sets powerlinker-allowed to true for a single hint.

    Args:
        table: the GrowthSpurtHints DynamoDB table
        item: the hint item to update

    Returns:
        True if the hint was updated, False if it was skipped
    """
    quick_search = item.get("quick-search")
    if not quick_search or quick_search in SKIP_QUICK_SEARCHES:
        return False

    response = table.update_item(
        Key={"url": item["url"]},
        UpdateExpression="SET #powerlinker_allowed = :powerlinker_allowed",
        ExpressionAttributeNames={"#powerlinker_allowed": "powerlinker-allowed"},
        ExpressionAttributeValues={":powerlinker_allowed": True},
    )

    if response["ResponseMetadata"]["HTTPStatusCode"] != 200:
        raise Exception(f"Failed to update GrowthSpurtHints item {item['url']}")

    return True


if __name__ == "__main__":
    enable_powerlinker_allowed()
