"""
Re-exports from imap_provider, o365_provider, and graph_provider.
Routes accounts to the correct provider based on credentials present.
"""

from services.imap_provider import IMAPProvider  # noqa: F401
from services.o365_provider import Office365Provider  # noqa: F401
from services.graph_provider import GraphMailProvider  # noqa: F401
from models import ConnectionConfig, EmailProviderType


def build_provider(config: ConnectionConfig):
    if config.provider == EmailProviderType.OFFICE365:
        return Office365Provider(config)
    # Microsoft OAuth accounts: access_token present but no IMAP password/host
    if config.access_token and not config.password and not config.imap_host:
        return GraphMailProvider(config)
    return IMAPProvider(config)
