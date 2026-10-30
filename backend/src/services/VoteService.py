from functools import lru_cache
from json import loads as json_loads, dumps as json_dumps
import gzip

from boto3 import resource as boto3_resource
from boto3.dynamodb.conditions import Key
from backend.src.services.DynamoDBService import DynamoDBService
from backend.src.services.TreeTapperService import get_tt_service
from backend.src.services.GSService import GSService

MIN_SOLID_VOTES = 5
MAX_SKIPS = 3
POSITIVE_THRESHOLD = 3
NEGATIVE_THRESHOLD = -3

class VoteService:
    """Service for processing votes."""

    def __init__(self) -> None:
        """Initialize the VoteService."""
        self.table = boto3_resource("dynamodb", region_name="us-west-2").Table("PowerLinkerAuto")
        self.gs_hint_table = boto3_resource("dynamodb", region_name="us-west-2").Table("GrowthSpurtHints")

    async def process_vote_batch(self, event: dict, context: dict) -> dict:
        """Process SQS vote messages and persist them to DynamoDB.
        
        Args:
            event: the SQS event
            context: the SQS context

        Returns:
            the SQS partial-batch response with failed message IDs
        """
        records = event.get("Records", [])
        if not records:
            return {"batchItemFailures": []}

        successful = 0
        error_messages: list = []
        batch_failures: list = []

        for record in records:
            ok, error = await self._process_vote_record(record)
            if ok:
                successful += 1
            elif error:
                error_messages.append(error)

        print(self._format_batch_result(successful, len(records), error_messages))
        return {"batchItemFailures": batch_failures}

    async def _process_vote_record(self, record: dict) -> tuple[bool, str | None]:
        """Process a vote record and update the DynamoDB table.
        
        Args:
            record: the vote record to process

        Returns:
            A tuple containing a boolean indicating success and an error message if applicable
        """
        try:
            body = json_loads(record["body"])
            hint = body.get("hint")
            vote = body.get("vote")

            if not hint or not vote:
                raise Exception(f"Invalid record data {body}")
            if not isinstance(vote, dict) or "sid" not in vote or "vote" not in vote:
                raise Exception(f"Invalid vote format {vote}")
            if vote["vote"] not in [-1, 0, 1]:
                raise Exception(f"Invalid vote value {vote['vote']}")

            partition_key = hint.get("url")
            if not partition_key:
                raise Exception(f"Missing URL in hint {hint}")

            response = self.table.query(
                KeyConditionExpression=Key("url").eq(partition_key)
            )

            items = response.get("Items", [])
            if not items:
                raise Exception(f"Failed to find hint to vote on {partition_key}")

            item = items[0]
            votes = item["votes"]
            new_vote_list = self._build_new_vote_list(votes, vote)
            hint_voted_for_removal = self.analyze_votes(new_vote_list)

            if hint_voted_for_removal:
                item["votes"] = new_vote_list
                await self._remove_and_replace_hint(item)
            else:
                DynamoDBService.update_table(
                    self.table,
                    item["insert-time"],
                    new_vote_list,
                    partition_key
                )

        except Exception as error:
            message = f"Error processing record: {str(error)}"
            print(message)
            return False, message

        return True, None

    @staticmethod
    def analyze_votes(votes: list[dict]) -> bool:
        """Determine if the hint is ready to be removed from the table.
        
        Args:
            votes: a list of votes to analyze

        Returns:
            True if the hint is ready for auditor processing, False otherwise
        """
        solid_votes = 0
        sum_votes = 0

        for vote in votes:
            score = vote["vote"]
            if score == 0:
                continue
            solid_votes += 1
            sum_votes += score

        print(f"Quick variable check for testing: \n sum_votes - {sum_votes} \n solid_votes - {solid_votes} \n number of votes - {len(votes)} \n Positive Threshold - {POSITIVE_THRESHOLD} \n Negative Threshold - {NEGATIVE_THRESHOLD} \n Minimum Solid Votes - {MIN_SOLID_VOTES} \n Max Skips - {MAX_SKIPS}")

        should_process = (
            sum_votes >= POSITIVE_THRESHOLD
            or sum_votes <= NEGATIVE_THRESHOLD
            or solid_votes >= MIN_SOLID_VOTES
            or (len(votes) - solid_votes) >= MAX_SKIPS
        )

        return should_process

    @staticmethod
    def _build_new_vote_list(existing_votes: list, new_vote: dict) -> list:
        """Build a new vote list with the new vote added.
        
        Args:
            existing_votes (list): a list of existing votes
            new_vote (dict): the new vote to add

        Returns:
            list: a new vote list with the new vote added
        """
        kept_votes = [vote for vote in existing_votes if vote["sid"] != new_vote["sid"]]
        kept_votes.append(new_vote)
        return kept_votes

    @staticmethod
    def _format_batch_result(successful: int, total: int, error_messages: list[str]) -> str:
        """Format the batch result.
        
        Args:
            successful (int): the number of successful votes
            total (int): the total number of votes
            error_messages (list[str]): a list of error messages

        Returns:
            str: the formatted batch result
        """
        summary = (
            f"Batch processing completed with {successful}/{total} "
            f"({round(float(successful) / total * 100, 1)}%) successful updates"
        )
        if not error_messages:
            return summary
        return f"{summary}\nErrors:\n" + "\n".join(error_messages)

    async def _remove_and_replace_hint(self, item: dict) -> None:
        """Removes a voted-on hint from the table and replaces it with a new hint.

        Args:
            item: the hint item to remove and replace
        """
        url = item["url"]
        gs_hint = self.gs_hint_table.get_item(Key={"url": url})["Item"]

        await self._get_new_hint_from_gs_hint()

        self._modify_gs_hint(gs_hint, item["votes"])
        update_expression, expression_attribute_names, expression_attribute_values = self._build_gs_update_expression(gs_hint)

        response = self.gs_hint_table.update_item(
            Key={"url": url},
            UpdateExpression=update_expression,
            ExpressionAttributeNames=expression_attribute_names,
            ExpressionAttributeValues=expression_attribute_values,
        )

        if response["ResponseMetadata"]["HTTPStatusCode"] != 200:
            raise Exception(f"Failed to update GrowthSpurtHints table {url}")

        if not DynamoDBService.remove_hint_from_table(self.table, url, item["insert-time"]):
            raise Exception(f"Failed to remove hint from PowerLinkerAuto table {url} {item['insert-time']}")

    def _modify_gs_hint(self, gs_hint: dict, votes: list) -> None:
        """Modifies a GrowthSpurtHints item based on the votes.
        
        Args:
            gs_hint: the GrowthSpurtHints item to modify
            votes: the list of votes to use

        Returns:
            None
        """
        old_quick_search = gs_hint.get("quick-search", None)

        final_vote = sum(vote["vote"] for vote in votes)
        skip_count = sum(1 for vote in votes if vote["vote"] == 0)
        vote_count = len(votes)

        if final_vote >= POSITIVE_THRESHOLD:
            gs_hint["quick-search"] = "ATTACH_ME"
        elif final_vote <= NEGATIVE_THRESHOLD:
            gs_hint["quick-search"] = "REJECTED"
        else:
            gs_hint["quick-search"] = f"0#{'#'.join(old_quick_search.split("#")[1:])}"
        
        if skip_count >= MAX_SKIPS or vote_count >= MIN_SOLID_VOTES:
            gs_hint["powerlinker-allowed"] = False

        gs_hint.pop("assigned-to", None)
        gs_hint.pop("timestamp-assigned", None)

    def _build_gs_update_expression(self, gs_hint: dict) -> tuple[str, dict, dict]:
        """Builds a GrowthSpurtHints update expression.
        
        Args:
            gs_hint: the GrowthSpurtHints item to build the update expression for

        Returns:
            the update expression, expression attribute names, and expression attribute values
        """
        update_expression = "SET #quick_search = :quick_search"
        expression_attribute_names = {"#quick_search": "quick-search"}
        expression_attribute_values = {":quick_search": gs_hint["quick-search"]}

        update_expression += ", #powerlinker_allowed = :powerlinker_allowed"
        expression_attribute_names["#powerlinker_allowed"] = "powerlinker-allowed"
        expression_attribute_values[":powerlinker_allowed"] = False

        update_expression += " REMOVE #assigned_to, #timestamp_assigned"
        expression_attribute_names["#assigned_to"] = "assigned-to"
        expression_attribute_names["#timestamp_assigned"] = "timestamp-assigned"

        return update_expression, expression_attribute_names, expression_attribute_values

    async def _get_new_hint_from_gs_hint(self) -> None:
        """Gets a new hint from the GrowthSpurtHints table."""
        new_hint = GSService.checkout_hint()
        links = GSService.get_links_for_hint(new_hint["url"])

        hint_bytes = await self.build_pl_hint_bytes(new_hint["url"], hint_type="record_attachment", links=links)
        DynamoDBService.put_hint_into_table(self.table, new_hint["url"], hint_bytes)

    async def build_pl_hint_bytes(self, url: str, hint_type: str="record_attachment", links: dict[str, str] | None = None) -> bytes:
        """Builds a Power Linker hint from a URL.
        
        Args:
            url: the URL to build a hint from
            hint_type: the type of hint to build
            links: the links to use

        Returns:
            the built hint
        """
        tt_service = get_tt_service()
        pl_hint = await tt_service.make_powerlinker_hint(url, hint_type, links)
        hint_json = json_dumps(pl_hint).encode('utf-8')
        hint_bytes = gzip.compress(hint_json)
        return hint_bytes

@lru_cache
def get_vote_service() -> VoteService:
    """Get the VoteService instance.
    
    Returns:
        the VoteService instance
    """
    return VoteService()