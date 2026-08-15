"""Tests for the SMS channel (backend/routers/sms.py) and its social_inbox integration."""

from services import config_secrets


def test_sms_is_a_protected_json_key():
    assert "sms" in config_secrets._JSON_KEYS
