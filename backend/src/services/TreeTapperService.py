from functools import lru_cache
from Boto4GS.src.models.services.parameter_service import ParameterService
from TreeTapper import TreeTapperClient, make_powerlinker_hint


class TreeTapperService:
    """Service for interacting with the TreeTapper API.
    
    Attributes:
        tt_client: the TreeTapper client
    """
    tt_client: TreeTapperClient

    def __init__(self) -> None:
        """Initialize the TreeTapper service."""
        parameter_service = ParameterService()
        tt_credentials = parameter_service.get_tt_credentials()

        self.tt_client = TreeTapperClient(
            client_id=tt_credentials["client_id"],
            username_to_password=tt_credentials["username_to_password"],
            username_to_password_on_request=tt_credentials["username_to_password_on_request"],
            max_conns=100,
            beta=False,
        )

    async def make_powerlinker_hint(self, url: str, hint_type: str="record_attachment", links: dict[str, str] | None = None) -> dict:
        """Make a Power Linker hint from a URL.
        
        Args:
            url: the URL to make a hint from
            hint_type: the type of hint to make
            links: the links to use

        Returns:
            the Power Linker hint
        """
        return await make_powerlinker_hint(self.tt_client, url, hint_type, links)

@lru_cache
def get_tt_service() -> TreeTapperService:
    """Get the TreeTapper service.
    
    Returns:
        the TreeTapper service
    """
    return TreeTapperService()