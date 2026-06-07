"""Tests for background_tasks.py workers and caching improvements."""
import pytest
from unittest.mock import MagicMock, AsyncMock, patch
from cachetools import TTLCache


class TestTTLCacheReplace:
    """Verify the module-level _rec_cache and _cache are TTLCache instances."""

    def test_emails_rec_cache_is_ttlcache(self):
        from routers.email_list import _rec_cache  # moved to email_list.py
        assert isinstance(_rec_cache, TTLCache)
        assert _rec_cache.maxsize == 500

    def test_weekly_brief_cache_is_ttlcache(self):
        from routers.weekly_brief import _cache
        assert isinstance(_cache, TTLCache)
        assert _cache.maxsize == 1
        assert _cache.ttl == 3600

    def test_rec_cache_stores_and_retrieves(self):
        from routers.email_list import _rec_cache
        from unittest.mock import MagicMock
        fake_rec = MagicMock()
        _rec_cache["test_email_id"] = (1000.0, fake_rec)
        assert "test_email_id" in _rec_cache
        ts, rec = _rec_cache["test_email_id"]
        assert rec is fake_rec
        # Cleanup
        del _rec_cache["test_email_id"]


class TestBackgroundTasksImport:
    """Verify all 7 worker functions are importable from workers.background_tasks."""

    def test_all_functions_importable(self):
        from workers.background_tasks import (
            _auto_recommend,
            _auto_deadline_extract,
            _auto_cluster_alert,
            _auto_sentiment_escalation,
            _commitment_scan_loop,
            _relationship_health_loop,
            _auto_label_loop,
        )
        import asyncio
        for fn in [_auto_recommend, _auto_deadline_extract, _auto_cluster_alert,
                   _auto_sentiment_escalation, _commitment_scan_loop,
                   _relationship_health_loop, _auto_label_loop]:
            assert asyncio.iscoroutinefunction(fn), f"{fn.__name__} should be async"

    def test_main_does_not_define_moved_functions(self):
        """Functions should no longer be defined in main.py — only imported."""
        import inspect
        import main
        import workers.background_tasks as bt

        for fn_name in ["_auto_recommend", "_commitment_scan_loop", "_auto_label_loop"]:
            main_fn = getattr(main, fn_name, None)
            bt_fn = getattr(bt, fn_name, None)
            assert main_fn is not None, f"{fn_name} must be accessible via main"
            assert bt_fn is not None, f"{fn_name} must exist in background_tasks"
            # They should be the same object (imported, not re-defined)
            assert main_fn is bt_fn, (
                f"{fn_name} in main should be the same object as in background_tasks "
                "(imported, not re-defined)"
            )


class TestVIPEndpointPerformance:
    """Verify VIP list no longer does N+1 queries."""

    def test_vip_query_structure(self, tmp_path):
        """The VIP handler should use JOIN queries, not a per-VIP loop."""
        import inspect
        from routers import vip
        source = inspect.getsource(vip.list_vips)
        # Should have GROUP BY (single aggregation query)
        assert "GROUP BY" in source, "Expected GROUP BY aggregation, not N+1"
        # Should NOT have a per-VIP SELECT inside a for loop that queries emails
        # (The fix uses two batch queries, not N queries)
        lines = source.split("\n")
        in_loop = False
        loop_selects = 0
        for line in lines:
            stripped = line.strip()
            if stripped.startswith("for ") and "vip" in stripped.lower():
                in_loop = True
            if in_loop and "conn.execute" in stripped and "SELECT" in stripped:
                loop_selects += 1
        assert loop_selects == 0, "Found SELECT inside VIP for-loop — N+1 not fixed"
