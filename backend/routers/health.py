"""Full system health check endpoint."""

import asyncio
from fastapi import APIRouter, Request
from routers.config import load_app_config

router = APIRouter(prefix="/api/health", tags=["health"])


_IMAP_TIMEOUT = 8  # seconds — fails fast when network is down


def _imap_ping(host: str, port: int, username: str, password: str) -> str:
    """
    Quick IMAP login test — returns 'ok' or an error string.
    Sets socket.setdefaulttimeout as a hard cap so both the TCP connect
    and the SSL handshake are bounded (the timeout= kwarg alone doesn't
    cover the SSL phase on all platforms).
    """
    import imaplib
    import socket
    if not host:
        return "No IMAP host configured"
    old = socket.getdefaulttimeout()
    socket.setdefaulttimeout(_IMAP_TIMEOUT)
    try:
        mail = imaplib.IMAP4_SSL(host, port, timeout=_IMAP_TIMEOUT)
        mail.login(username, password)
        mail.logout()
        return "ok"
    except (TimeoutError, socket.timeout):
        return "Connection timed out — no network or server unreachable"
    except imaplib.IMAP4.error as e:
        return f"Auth failed: {e}"
    except OSError as e:
        return f"Connection failed: {e}"
    except Exception as e:
        return f"{type(e).__name__}: {e}"
    finally:
        socket.setdefaulttimeout(old)


@router.get("/full")
async def full_health(request: Request, check_imap: bool = True):
    """
    Returns health of all subsystems.
    IMAP is tested by default (8-second timeout). Pass ?check_imap=false to skip.
    """
    from pathlib import Path

    rag = getattr(request.app.state, "rag", None)
    cache = getattr(request.app.state, "cache", None)

    # ── RAG ──────────────────────────────────────────────────────────────────
    rag_health: dict = {"status": "error", "indexed_emails": 0, "total_chunks": 0}
    if rag:
        try:
            stats = rag.stats()
            rag_health = {
                "status": "ok",
                "indexed_emails": rag.count_unique_emails(),
                "total_chunks": stats.get("total_chunks", 0),
            }
        except Exception as e:
            rag_health["error"] = str(e)

    # ── Database ─────────────────────────────────────────────────────────────
    db_health: dict = {"status": "error"}
    if cache:
        try:
            cached = cache.count()
            da_dir = Path.home() / ".director-assistant"
            db_bytes = sum(f.stat().st_size for f in da_dir.rglob("*") if f.is_file()) if da_dir.exists() else 0
            db_health = {
                "status": "ok",
                "cached_emails": cached,
                "size_mb": round(db_bytes / 1024 / 1024, 2),
            }
        except Exception as e:
            db_health["error"] = str(e)

    # ── AI providers ─────────────────────────────────────────────────────────
    cfg = load_app_config()
    ant_key = cfg.get("anthropic_api_key", "")
    oai_key = cfg.get("openai_api_key", "")
    budget_mode = cfg.get("budget_mode", False)

    ai_health = {
        "anthropic": {
            "status": "configured" if ant_key else "not_configured",
            "has_key": bool(ant_key),
            "key_preview": f"{ant_key[:8]}…" if ant_key else "",
            "model": "claude-haiku-4-5-20251001" if budget_mode else "claude-sonnet-4-6 / claude-haiku",
        },
        "openai": {
            "status": "configured" if oai_key else "not_configured",
            "has_key": bool(oai_key),
            "key_preview": f"{oai_key[:8]}…" if oai_key else "",
            "model": "gpt-4o-mini" if budget_mode else "gpt-4o-mini / gpt-4o",
            "role": "backup — auto-used when Claude hits usage limit",
        },
        "budget_mode": budget_mode,
    }

    # ── Poll status ───────────────────────────────────────────────────────────
    from main import _last_poll_time, _last_poll_new, _last_poll_error
    poll_health = {
        "status": "error" if _last_poll_error else ("ok" if _last_poll_time else "waiting"),
        "last_checked": _last_poll_time,
        "last_new": _last_poll_new,
        "last_error": _last_poll_error,
    }

    # ── Accounts / IMAP ───────────────────────────────────────────────────────
    accounts_health = []
    if cache:
        loop = asyncio.get_event_loop()
        accounts = cache.list_accounts()
        for acc in accounts:
            entry: dict = {
                "id": acc.id,
                "username": acc.username,
                "provider": acc.provider if isinstance(acc.provider, str) else acc.provider.value,
                "imap_status": "not_tested",
            }
            if check_imap and acc.provider not in ("office365",):
                try:
                    host = acc.imap_host or _imap_host_for(entry["provider"])
                    port = acc.imap_port or 993
                    result = await loop.run_in_executor(
                        None, _imap_ping, host, port, acc.username, acc.password or ""
                    )
                    entry["imap_status"] = result
                except Exception as e:
                    entry["imap_status"] = f"error: {e}"
            accounts_health.append(entry)

    # ── Overall status ────────────────────────────────────────────────────────
    has_ai = bool(ant_key or oai_key)
    has_accounts = len(accounts_health) > 0
    # Any tested IMAP that came back non-ok counts as degraded
    imap_failed = any(
        a["imap_status"] not in ("ok", "not_tested")
        for a in accounts_health
    )
    core_ok = (rag_health["status"] == "ok" and db_health["status"] == "ok"
               and has_ai and has_accounts)
    if not core_ok:
        overall = "degraded"
    elif imap_failed:
        overall = "error"   # IMAP down is a hard error — emails can't be fetched
    else:
        overall = "ok"

    return {
        "overall": overall,
        "backend": {"status": "ok"},
        "rag": rag_health,
        "database": db_health,
        "ai": ai_health,
        "poll": poll_health,
        "accounts": accounts_health,
    }


def _imap_host_for(provider: str) -> str:
    return {
        "yahoo_imap": "imap.mail.yahoo.com",
        "gmail": "imap.gmail.com",
        "hotmail": "outlook.office365.com",
        "generic_imap": "",
    }.get(provider, "")
