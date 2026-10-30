# save as backend/scripts/drain_vote_queue.py (or run inline)
import json
import os
from boto3 import client as boto3_client
from backend.src.main import process_hint_vote_handler

REGION = "us-west-2"
QUEUE_NAME = "PowerLinkerVoteQueue"  # terraform name; see note below

sqs = boto3_client("sqs", region_name=REGION)
queue_url = sqs.get_queue_url(QueueName=QUEUE_NAME)["QueueUrl"]
queue_arn = sqs.get_queue_attributes(
    QueueUrl=queue_url, AttributeNames=["QueueArn"]
)["Attributes"]["QueueArn"]

os.environ["ALLOWED_ARNS"] = json.dumps([queue_arn])

while True:
    resp = sqs.receive_message(
        QueueUrl=queue_url,
        MaxNumberOfMessages=10,
        WaitTimeSeconds=2,
    )
    messages = resp.get("Messages", [])
    if not messages:
        break

    event = {
        "Records": [
            {
                "body": m["Body"],
                "eventSourceARN": queue_arn,
            }
            for m in messages
        ]
    }
    result = process_hint_vote_handler(event, {})
    print(result)

    # # Lambda would auto-delete on success; locally you must do it yourself
    for m in messages:
        sqs.delete_message(QueueUrl=queue_url, ReceiptHandle=m["ReceiptHandle"])