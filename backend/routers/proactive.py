"""Proactive alert feed — background tasks push alerts; frontend polls and shows toasts."""

import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, Request

router = APIRouter(prefix="/api/proactive-alerts", tags=["proactive"])


def push_alert(app, type_: str, message: str, action: str | None = None) -> None:
    """Push a proactive alert to the in-memory feed. Called from background tasks."""
    alerts: list = app.state.proactive_alerts
    alert = {
        "id": str(uuid.uuid4())[:8],
        "type": type_,      # "commitment" | "deadline" | "cluster" | "relationship" | "sentiment"
        "message": message,
        "action": action,   # optional frontend route hint e.g. "actions"
        "ts": datetime.now(timezone.utc).isoformat(timespec="seconds") + "Z",
        "seen": False,
    }
    alerts.append(alert)
    # Keep at most 50 alerts
    if len(alerts) > 50:
        app.state.proactive_alerts = alerts[-50:]
    print(f"[proactive] {type_}: {message}")


@router.get("")
async def list_alerts(request: Request):
    alerts = request.app.state.proactive_alerts
    unseen = [a for a in alerts if not a["seen"]]
    # Mark all as seen
    for a in alerts:
        a["seen"] = True
    return {"alerts": unseen}


@router.delete("/{alert_id}")
async def dismiss_alert(alert_id: str, request: Request):
    request.app.state.proactive_alerts = [
        a for a in request.app.state.proactive_alerts if a["id"] != alert_id
    ]
    return {"ok": True}
