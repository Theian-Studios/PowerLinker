from Boto4GS.src.models.services.parameter_service import ParameterService
import os

if os.environ.get("ENV") == "testing":
    bug_reporter_params = ("cred", "Powerlinker", "byuawsfhtl", True)
    tt_credentials: dict = None #type: ignore
else:
    params = ParameterService()
    bug_reporter_params = (
            params.get_github_credentials(), 
            "Powerlinker", 
            "byuawsfhtl", 
            os.environ.get("ENV") == "dev"
        )
    if os.environ.get("DISCORD_TOKEN") and os.environ.get("CHANNEL_ID"):
        bug_reporter_params += (
            True, os.environ.get("DISCORD_TOKEN", ""), 
            os.environ.get("CHANNEL_ID", "")
        ) #type: ignore
    tt_credentials = params.get_tt_credentials()

s3_suffix = "stg"
if os.environ.get("ENV") == "prd":
    s3_suffix = "prd"
