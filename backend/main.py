import os
import signal
import threading
import asyncio
from contextlib import asynccontextmanager

# Must be set before any ML library imports to prevent segfaults on Python 3.13 + hnswlib
for _k in ("TOKENIZERS_PARALLELISM", "OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS",
           "MKL_NUM_THREADS", "VECLIB_MAXIMUM_THREADS", "NUMEXPR_NUM_THREADS"):
    os.environ.setdefault(_k, "1" if _k != "TOKENIZERS_PARALLELISM" else "false")
from datetime import datetime, timedelta, timezone
from pathlib import Path
from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response as StarletteResponse
from services.rag_engine import RAGEngine
from services.ai_advisor import AIAdvisor
from services.email_cache import EmailCache
from services.digest import DigestService
from services.classifier import ClassifierService
from routers import connection
from routers import email_list as email_list_router
from routers import email_ai as email_ai_router
from routers import email_ai_compose as email_ai_compose_router
from routers import email_ai_analyze as email_ai_analyze_router
from routers import email_actions as email_actions_router
from routers import digest, actions, followups, templates, analytics, sender, accounts as accounts_router
from routers import config as config_router
from routers import health as health_router
from routers import oauth as oauth_router
from routers import ask as ask_router
from routers import ask_extras as ask_extras_router
from routers import documents as documents_router
from routers import intelligence as intelligence_router
from routers import snooze as snooze_router
from routers import saved_searches as saved_searches_router
from routers import drafts as drafts_router
from routers import email_send as email_send_router
from routers import update as update_router
from routers import dashboard as dashboard_router
from routers import triage as triage_router
from routers import triage_rules as triage_rules_router
from routers import proactive as proactive_router
from routers import scheduled_send as scheduled_send_router
from routers import pst_import as pst_import_router
from routers import weekly_brief as weekly_brief_router
from routers import db_maintenance as db_maintenance_router
from routers import autopilot as autopilot_router
from routers import vip as vip_router
from routers import projects as projects_router
from routers import contacts as contacts_router
from routers import meeting as meeting_router
from routers import crm as crm_router
from routers import tracking as tracking_router
from routers import notify as notify_router
from routers import backup as backup_router
from routers import tasks_export as tasks_export_router
from routers import webhooks as webhooks_router
from routers import report_schedule as report_schedule_router
from routers import delegations as delegations_router
from routers import overnight as overnight_router
from routers import email_rules as email_rules_router
from routers import voice as voice_router
from routers import signatures as signatures_router
from routers import snippets as snippets_router
from routers import rag as rag_router
from routers import knowledge_graph as knowledge_graph_router
from routers import jobs as jobs_router
from routers import social as social_router
from routers import instagram as instagram_router
from routers.instagram_victims import router as instagram_victims_router
from routers import card_studio as card_studio_router
from routers import nl_commands as nl_commands_router
from routers import commitments as commitments_router
from routers import social_inbox as social_inbox_router
from routers import weather as weather_router
from routers import news as news_router
from routers.contact_health import router as contact_health_router
from routers.morning_brief import router as morning_brief_router
from routers.morning_plan import router as morning_plan_router
from routers.calendar import router as calendar_router
from routers import streak as streak_router
from routers.proactive import push_alert
from services.intelligence_service import IntelligenceService
from workers.background_tasks import (
    _auto_recommend, _auto_deadline_extract, _auto_cluster_alert,
    _auto_sentiment_escalation, _auto_autopilot, _commitment_scan_loop,
    _relationship_health_loop, _auto_label_loop, _scheduled_send_loop,
    _rules_loop, _followup_reminder_loop, daily_focus_task, _autopilot_startup_recovery,
)
from workers.reports_worker import _scheduled_report_loop, _overnight_triage_loop
from workers.social_workers import (
    _linkedin_scheduler_loop, _linkedin_autopilot_loop, _instagram_autopilot_loop,
)
from routers.config import get_effective_api_key, load_app_config
from services.ai_client import AIClient

load_dotenv()

_sentry_dsn = os.getenv("SENTRY_DSN", "")
if _sentry_dsn:
    import sentry_sdk
    sentry_sdk.init(dsn=_sentry_dsn, traces_sample_rate=0.1)

MAX_BODY_BYTES = 50 * 1024 * 1024  # 50 MB


class BodySizeLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        cl = request.headers.get("content-length")
        if cl and int(cl) > MAX_BODY_BYTES:
            return StarletteResponse("Request body too large", status_code=413)
        return await call_next(request)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        response = await call_next(request)
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "script-src 'self' 'unsafe-inline'; "
            "style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data: https:; "
            "connect-src 'self'; "
            "frame-ancestors 'none'; "
            "object-src 'none'"
        )
        return response


# Polling infrastructure lives in routers/poll.py. Import the module (not the
# names) so the reassigned poll-status globals are read via attribute access.
import routers.poll as poll
from routers.poll import NEW_EMAIL_POLL_SECONDS, _do_poll_cycle, _poll_new_emails, _restart_poll


# _daily_brief_scheduler, _send_scheduled_digest, _digest_scheduler live in workers/reports_worker.py
from workers.reports_worker import _daily_brief_scheduler, _send_scheduled_digest, _digest_scheduler  # noqa: F401,E402


async def _db_maintenance_loop(app: FastAPI):
    """Run VACUUM + ANALYZE weekly (Sunday 03:00 local)."""
    from datetime import datetime as _dt
    import sqlite3
    from routers.config import load_app_config, save_app_config
    await asyncio.sleep(60)
    while True:
        await asyncio.sleep(300)  # check every 5 min
        try:
            now = _dt.now()
            if now.weekday() != 6 or now.hour != 3:  # Sunday 3am — whole hour, dedup prevents double-run
                continue
            cfg = load_app_config()
            today_str = now.strftime("%Y-%m-%d")
            if cfg.get("db_maintenance_last_run") == today_str:
                continue
            path = app.state.cache.db_path
            conn = sqlite3.connect(path, timeout=60, isolation_level=None)
            try:
                conn.execute("VACUUM"); conn.execute("ANALYZE")
            finally:
                conn.close()
            cfg["db_last_vacuum"] = _dt.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            cfg["db_maintenance_last_run"] = today_str
            save_app_config(cfg)
            print("[db-maintenance] weekly VACUUM+ANALYZE complete")
        except Exception as e:
            print(f"[db-maintenance] error: {e}")



@asynccontextmanager
async def lifespan(app: FastAPI):
    # Orphaned RAG worker cleanup is handled by rag_proxy._kill_old_worker() via pidfile.

    try:
        import torch
        torch.set_num_threads(1)
        torch.set_num_interop_threads(1)
    except Exception:
        pass

    cfg = load_app_config()
    anthropic_key = cfg.get("anthropic_api_key") or os.getenv("ANTHROPIC_API_KEY", "")
    openai_key = cfg.get("openai_api_key") or os.getenv("OPENAI_API_KEY", "")
    budget_mode = cfg.get("budget_mode", False)
    ai_providers = cfg.get("ai_providers")  # multi-provider list (new)
    client = AIClient(
        anthropic_key=anthropic_key,
        openai_key=openai_key,
        budget_mode=budget_mode,
        providers=ai_providers,  # None = use legacy two-key mode
    )
    app.state.cache = EmailCache()
    try:
        from routers.snooze import _ensure_schema
        _ensure_schema(app.state.cache)
    except Exception:
        pass
    app.state.rag = RAGEngine(client, app.state.cache)
    app.state.advisor = AIAdvisor(client, rag=app.state.rag)
    app.state.digest = DigestService(client)
    app.state.classifier = ClassifierService(client)
    app.state.intelligence = IntelligenceService(client, app.state.cache, app.state.rag)

    # Index contact notes into RAG so Ask tab can search them
    try:
        app.state.rag.ingest_contacts(app.state.cache)
    except Exception:
        pass

    app.state.proactive_alerts = []   # in-memory proactive alert feed
    app.state.poll_task = asyncio.create_task(
        _poll_new_emails(app.state.rag, app.state.cache, app)
    )
    app.state.digest_task = asyncio.create_task(_digest_scheduler(app))
    app.state.db_maintenance_task = asyncio.create_task(_db_maintenance_loop(app))
    app.state.morning_brief_task = asyncio.create_task(_daily_brief_scheduler(app))
    app.state.commitment_task = asyncio.create_task(_commitment_scan_loop(app))
    app.state.relationship_task = asyncio.create_task(_relationship_health_loop(app))
    app.state.scheduled_send_task = asyncio.create_task(_scheduled_send_loop(app))
    app.state.report_task = asyncio.create_task(_scheduled_report_loop(app))
    app.state.auto_label_task = asyncio.create_task(_auto_label_loop(app))
    app.state.overnight_task = asyncio.create_task(_overnight_triage_loop(app))
    app.state.rules_task = asyncio.create_task(_rules_loop(app))
    app.state.followup_reminder_task = asyncio.create_task(_followup_reminder_loop(app))
    app.state.daily_focus_task = asyncio.create_task(daily_focus_task(app))
    app.state.linkedin_scheduler_task = asyncio.create_task(_linkedin_scheduler_loop(app))
    app.state.linkedin_autopilot_task = asyncio.create_task(_linkedin_autopilot_loop(app))
    app.state.instagram_autopilot_task = asyncio.create_task(_instagram_autopilot_loop(app))
    app.state.autopilot_recovery_task = asyncio.create_task(_autopilot_startup_recovery(app))
    app.state.restart_poll = lambda: asyncio.create_task(_restart_poll(app))
    yield
    for task_name in ("digest_task", "morning_brief_task", "poll_task", "commitment_task", "relationship_task",
                      "scheduled_send_task", "auto_label_task", "report_task", "overnight_task",
                      "rules_task", "followup_reminder_task", "daily_focus_task",
                      "linkedin_scheduler_task", "linkedin_autopilot_task",
                      "instagram_autopilot_task", "db_maintenance_task",
                      "autopilot_recovery_task"):
        task = getattr(app.state, task_name, None)
        if task:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass


app = FastAPI(title="Cortex Executive Inbox API", lifespan=lifespan)


@app.exception_handler(RuntimeError)
async def ai_runtime_error_handler(request: Request, exc: RuntimeError):
    """Convert AI provider failures to user-friendly HTTP errors instead of 500s."""
    from fastapi.responses import JSONResponse
    msg = str(exc).lower()
    if "credit balance" in msg or "billing" in msg or "purchase credits" in msg:
        return JSONResponse(
            status_code=402,
            content={"detail": "AI credits exhausted — please top up your Anthropic account at console.anthropic.com/settings/billing"},
        )
    if "all ai providers failed" in msg or "no ai provider" in msg or "no streaming-capable provider" in msg:
        return JSONResponse(
            status_code=503,
            content={"detail": "AI service unavailable — check your API keys in Settings → AI Providers"},
        )
    raise exc


app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173", "http://localhost:8000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.add_middleware(BodySizeLimitMiddleware)
app.add_middleware(SecurityHeadersMiddleware)

app.include_router(connection.router)
app.include_router(email_list_router.router)
app.include_router(email_ai_router.router)
app.include_router(email_ai_compose_router.router)
app.include_router(email_ai_analyze_router.router)
app.include_router(email_actions_router.router)
app.include_router(digest.router)
app.include_router(actions.router)
app.include_router(followups.router)
app.include_router(templates.router)
app.include_router(analytics.router)
app.include_router(sender.router)
app.include_router(accounts_router.router)
app.include_router(config_router.router)
app.include_router(health_router.router)
app.include_router(oauth_router.router)
app.include_router(ask_router.router)
app.include_router(ask_extras_router.router)
app.include_router(documents_router.router)
app.include_router(intelligence_router.router)
app.include_router(snooze_router.router)
app.include_router(saved_searches_router.router)
app.include_router(drafts_router.router)
app.include_router(email_send_router.router)
app.include_router(update_router.router)
app.include_router(dashboard_router.router)
app.include_router(triage_router.router)
app.include_router(triage_rules_router.router)
app.include_router(proactive_router.router)
app.include_router(scheduled_send_router.router)
app.include_router(pst_import_router.router)
app.include_router(weekly_brief_router.router)
app.include_router(db_maintenance_router.router)
app.include_router(autopilot_router.router)
app.include_router(vip_router.router)
app.include_router(contacts_router.router)
app.include_router(projects_router.router)
app.include_router(meeting_router.router)
app.include_router(crm_router.router)
app.include_router(tracking_router.router)
app.include_router(tasks_export_router.router)
app.include_router(webhooks_router.router)
app.include_router(report_schedule_router.router)
app.include_router(notify_router.router)
app.include_router(backup_router.router)
app.include_router(delegations_router.router)
app.include_router(overnight_router.router)
app.include_router(email_rules_router.router)
app.include_router(voice_router.router)
app.include_router(signatures_router.router)
app.include_router(snippets_router.router)
app.include_router(rag_router.router)
app.include_router(knowledge_graph_router.router)
app.include_router(jobs_router.router)
app.include_router(social_router.router)
app.include_router(instagram_router.router)
app.include_router(instagram_victims_router)
app.include_router(card_studio_router.router)
app.include_router(nl_commands_router.router)
app.include_router(commitments_router.router)
app.include_router(social_inbox_router.router)
app.include_router(weather_router.router)
app.include_router(news_router.router)
app.include_router(contact_health_router)
app.include_router(morning_brief_router)
app.include_router(morning_plan_router)
app.include_router(calendar_router)
app.include_router(streak_router.router)


@app.get("/health")
async def health(request: Request):
    rag_stats = request.app.state.rag.stats()
    return {"status": "ok", **rag_stats}


@app.get("/api/stats")
async def stats(request: Request):
    rag: RAGEngine = request.app.state.rag
    cache = request.app.state.cache
    rag_stats = rag.stats()

    da_dir = Path.home() / ".director-assistant"
    db_bytes = sum(f.stat().st_size for f in da_dir.rglob("*") if f.is_file()) if da_dir.exists() else 0

    from routers.connection import _progress
    accounts = cache.list_accounts()
    cfg = load_app_config()
    return {
        "rag": {
            "total_chunks": rag_stats["total_chunks"],
            "unique_emails_indexed": rag.count_unique_emails(),
            "cached_emails": cache.count(),
            "db_size_mb": round(db_bytes / 1024 / 1024, 2),
        },
        "ingest": {
            "status": _progress.status,
            "processed": _progress.processed,
            "total": _progress.total,
            "message": _progress.message,
        },
        "poll": {
            "interval_seconds": cfg.get("poll_interval_seconds", NEW_EMAIL_POLL_SECONDS),
            "last_checked": poll._last_poll_time,
            "last_new": poll._last_poll_new,
            "last_error": poll._last_poll_error,
        },
        "accounts": [
            {"id": a.id, "username": a.username, "provider": a.provider,
             "last_ingested": a.last_ingested}
            for a in accounts
        ],
    }


@app.post("/api/poll/now")
async def poll_now(request: Request):
    """Manually trigger a poll cycle (used by Refresh button).

    Waits up to 15 s for any in-progress background poll to finish so the
    fresh cycle can see emails that arrived after the background cycle started.
    """
    rag: RAGEngine = request.app.state.rag
    cache = request.app.state.cache
    # Wait for any running poll to finish (up to 15 s) before starting a fresh one.
    for _ in range(30):
        if not poll._poll_lock.locked():
            break
        await asyncio.sleep(0.5)
    new_count, _ = await _do_poll_cycle(rag, cache)
    return {"status": "done", "new_count": new_count}


@app.post("/api/shutdown")
async def shutdown():
    """Gracefully terminate the application process."""
    threading.Timer(0.3, lambda: os.kill(os.getpid(), signal.SIGTERM)).start()
    return {"status": "shutting_down"}


@app.post("/api/badge/{count}")
async def set_dock_badge(count: int):
    """Set the macOS dock badge to the given unread count."""
    try:
        from AppKit import NSApplication  # type: ignore
        ns_app = NSApplication.sharedApplication()
        label = str(count) if count > 0 else ""
        ns_app.dockTile().setBadgeLabel_(label)
    except Exception:
        pass
    return {"ok": True}


# Serve built frontend from backend/static/ (production mode)
_static_dir = Path(__file__).parent / "static"
if _static_dir.exists():
    app.mount("/", StaticFiles(directory=str(_static_dir), html=True), name="static")
