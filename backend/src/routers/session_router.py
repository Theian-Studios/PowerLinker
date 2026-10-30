from fastapi import APIRouter, HTTPException, Body
import datetime
from decimal import Decimal
from boto3 import resource as boto3_resource


session_router = APIRouter(prefix="/session-invalidate", tags=["session-invalidate"])

@session_router.post("")
async def invalidate_session(sid: str = Body(..., embed=True)) -> dict:
    """Invalidates the session token by adding it to the invalid session database.

    Args:
        sid (str): the session ID to invalidate

    Returns:
        dict: a message indicating the session token was invalidated
    """
    DYNAMODB = boto3_resource('dynamodb', region_name='us-west-2')
    INVALID_SID_TABLE = DYNAMODB.Table('PowerLinkerInvalidSid')

    time = datetime.datetime.now()
    expiry = Decimal((time + datetime.timedelta(hours=48)).timestamp() * 1000)

    try:
        response = INVALID_SID_TABLE.put_item(
            TableName='PowerLinkerInvalidSid',
            Item={
                'sid': sid,
                'expiry': expiry
            }
        )
        if response["ResponseMetadata"]["HTTPStatusCode"] != 200:
            raise HTTPException(status_code=500, detail=f"Failed to put {sid}")
        return {"message": f"Session invalidated. Timestamp set to {expiry}"}

    except BaseException as e:
        raise HTTPException(status_code=500, detail=f"Error invalidating session: {str(e)}")