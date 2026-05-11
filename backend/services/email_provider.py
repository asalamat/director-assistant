"""
Re-exports from imap_provider and o365_provider so callers don't need to change.
"""

from services.imap_provider import IMAPProvider  # noqa: F401
from services.o365_provider import Office365Provider  # noqa: F401
from models import ConnectionConfig, EmailProviderType


def build_provider(config: ConnectionConfig):
    if config.provider == EmailProviderType.OFFICE365:
        return Office365Provider(config)
    return IMAPProvider(config)
