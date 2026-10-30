from typing import Any
from boto3 import resource as boto3_resource
from boto3.dynamodb.conditions import Key
from decimal import Decimal
from datetime import datetime, timezone
from random import choice
from json import loads as json_loads
import gzip
from os import path as os_path
from sys import path as sys_path
sys_path.append(os_path.abspath(os_path.join(os_path.dirname(__file__), '..', '..'))) 

class DynamoDBService:
    """Service class for interacting with DynamoDB tables."""

    @staticmethod
    def query_table(
        count: int, 
        last_insert_time: int = -1, 
        hint_type: str = "record_attachment", 
        table_name: str = "PowerLinkerAuto", 
        gsi_name: str = "hint-type-insert-time-index"
    ) -> list[dict[str, Any]]:
        """Queries a DynamoDB table using a Global Secondary Index (GSI) and retrieves hints.

        Args:
            count (int): The number of items to retrieve.
            last_insert_time (int): Iterate through items, starting with an insert-time 
                greater than this value.
            hint_type (str): The hint type to query.
            table_name (str): The name of the table.
            gsi_name (str): The name of the global secondary index.

        Returns:
            List[Dict[str, Any]]: Hint payloads, each including the table's insert-time field.
        """
        dynamodb = boto3_resource('dynamodb', 'us-west-2')
        table = dynamodb.Table(table_name)

        if last_insert_time == -1:
            last_insert_time = DynamoDBService.determine_starting_point_on_table(table, gsi_name, hint_type)

        try:
            initial_response = table.query(
                IndexName=gsi_name,
                KeyConditionExpression=Key('hint-type').eq(hint_type) & Key('insert-time').gt(last_insert_time),
                Limit=count
            )
        except Exception as e:
            raise Exception(f"{str(e)}")

        initial_items = initial_response.get('Items', [])

        # If we get less items that desired, we want to loop to use items that are smaller than
        # the last insert time, since we had a randomized starting point
        if len(initial_items) < count:
            try:
                last_insert_time = 0
                looped_response = table.query(
                    IndexName=gsi_name,
                    KeyConditionExpression=Key('hint-type').eq(hint_type) & Key('insert-time').gt(last_insert_time),
                    Limit=(count - len(initial_items))
                )
            except Exception as e:
                raise Exception(f"{str(e)}")

            looped_items = looped_response.get('Items', [])

        else:
            looped_items = []

        all_items = initial_items + looped_items

        if not all_items:
            raise Exception("No hints found for the provided parameters.")

        hints = []
        for item in all_items:
            hint = json_loads(gzip.decompress(bytes(item['hint-json'])).decode('utf-8'))
            hint['insert-time'] = int(item['insert-time'])
            if url := item.get('url'):
                hint['url'] = url
            hints.append(hint)
        return hints


    @staticmethod
    def update_table(table: Any, insert_time: int, votes: list, hint_url: str) -> None:
        """
        Updates a DynamoDB table with new votes and updates the record type if applicable.
        
        Args:
            table (Any): The DynamoDB table object.
            insert_time (int): The insert time of the record to update.
            votes (list): The list of votes to set.
            hint_url (str): The URL of the hint to update.
        """

        update_expression = "SET votes = :votes"
        expression_values = {
            ':votes': votes
        }

        # Update the item
        response = table.update_item(
            Key={
                'url': hint_url,
                'insert-time': insert_time
            },
            UpdateExpression=update_expression,
            ExpressionAttributeValues=expression_values,
        )

        if (response["ResponseMetadata"]["HTTPStatusCode"] != 200):
            raise Exception(f"Vote update failed {hint_url}")

    @staticmethod
    def remove_hint_from_table(table: Any, hint_url: str, insert_time: int) -> bool:
        """Removes a hint from a DynamoDB table.
        
        Args:
            table: the DynamoDB table object.
            hint_url: the URL of the hint to remove.
            insert_time: the insert time of the hint to remove.

        Returns:
            bool: True if the hint was removed successfully, False otherwise.
        """
        try:
            response = table.delete_item(Key={'url': hint_url, 'insert-time': insert_time})
        except Exception as e:
            raise Exception(f"{str(e)}")

        if (response["ResponseMetadata"]["HTTPStatusCode"] != 200):
            raise Exception(f"Hint removal failed {hint_url} {insert_time}")

        return True

    @staticmethod
    def put_hint_into_table(table: Any, hint_url: str, hint_bytes: bytes, hint_type: str="record_attachment") -> None:
        """Puts a hint into a DynamoDB table.
        
        Args:
            table: the DynamoDB table object.
            hint_url: the URL of the hint to put into the table.
            hint_bytes: the bytes of the hint to put into the table.
            hint_type: the type of hint to put into the table.
        """
        response = table.put_item(Item={
            "url": hint_url,
            "hint-type": hint_type,
            "hint-json": hint_bytes,
            "insert-time": Decimal(int(datetime.now(timezone.utc).timestamp()) * 1000),
            "votes": []
        })

        if response["ResponseMetadata"]["HTTPStatusCode"] != 200:
            raise Exception(f"Failed to put new hint into PowerLinkerAuto table {hint_url}")

    @staticmethod
    def determine_starting_point_on_table(table: Any, gsi_name: str, hint_type: str="record_attachment") -> int:
        """Gets a randomzied starting point in the table for the
        first query a user makes and sets up the necessary variables
        for effective iteration.
        
        Args:
            table: The DynamoDB table object to be looked through
            gsi_name: The name of the global secondary index used in
                this function
            hint_type: The hint type to query
            
        Returns:
            The insert time of the hint randomly selected as the
            starting point on the table
        """
        try:
            insert_time_response = table.query(
                IndexName = gsi_name,
                KeyConditionExpression=Key('hint-type').eq(hint_type),
                ProjectionExpression = '#insertTime',
                ExpressionAttributeNames = {'#insertTime': 'insert-time'},
                ScanIndexForward = True,
            )

            random_start_point = choice(list(insert_time_response['Items']))
            random_start_point_insert_time = int(random_start_point['insert-time'])

        except Exception as e:
            raise Exception(f"{str(e)}")

        return random_start_point_insert_time
