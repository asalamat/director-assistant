from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Request

router = APIRouter(prefix="/api", tags=["contact-health"])

_cache_result = None
_cache_time = None
_CACHE_TTL = timedelta(minutes=15)


def _days_since(date_str):
    if not date_str:
        return None
    try:
        d = datetime.fromisoformat(date_str[:10])
        return (datetime.now() - d).days
    except Exception:
        return None


def _compute_score(received_count, sent_count, last_received, last_sent_to, unread_count):
    last_contact = max(filter(None, [last_received, last_sent_to]), default=None)
    days = _days_since(last_contact)
    score = 50
    if days is None:
        score = 20
    elif days <= 7:
        score += 30
    elif days <= 14:
        score += 15
    elif days <= 30:
        score += 0
    elif days <= 60:
        score -= 15
    else:
        score -= 30
    awaiting = (last_sent_to and last_received and last_sent_to > last_received) or \
               (last_sent_to and not last_received)
    if awaiting:
        score -= 10
    if unread_count and unread_count > 0:
        score += 5
    return max(0, min(100, score))


def _status(score):
    if score >= 80:
        return "healthy"
    if score >= 60:
        return "good"
    if score >= 40:
        return "fading"
    if score >= 20:
        return "at_risk"
    return "cold"


@router.get("/contact-health")
async def contact_health(request: Request, force: bool = False):
    global _cache_result, _cache_time
    try:
        now = datetime.now(timezone.utc)
        if not force and _cache_result is not None and _cache_time is not None \
                and now - _cache_time < _CACHE_TTL:
            return _cache_result

        cache = request.app.state.cache
        with cache._conn() as conn:
            vips = conn.execute(
                "SELECT id, email_addr, name, note FROM vip_contacts ORDER BY name"
            ).fetchall()

            activity = conn.execute(
                """SELECT vc.id AS vip_id, vc.email_addr,
                    COUNT(e.id) AS total_emails,
                    MAX(CASE WHEN LOWER(e.sender) LIKE '%' || vc.email_addr || '%' THEN e.date END) AS last_received,
                    MAX(CASE WHEN LOWER(e.folder) LIKE '%sent%' AND LOWER(e.recipients) LIKE '%' || vc.email_addr || '%' THEN e.date END) AS last_sent_to,
                    SUM(CASE WHEN LOWER(e.sender) LIKE '%' || vc.email_addr || '%' THEN 1 ELSE 0 END) AS received_count,
                    SUM(CASE WHEN LOWER(e.folder) LIKE '%sent%' AND LOWER(e.recipients) LIKE '%' || vc.email_addr || '%' THEN 1 ELSE 0 END) AS sent_count,
                    SUM(CASE WHEN e.is_read = 0 AND LOWER(e.sender) LIKE '%' || vc.email_addr || '%' THEN 1 ELSE 0 END) AS unread_count
                FROM vip_contacts vc
                LEFT JOIN emails e
                    ON LOWER(e.sender) LIKE '%' || vc.email_addr || '%'
                    OR (LOWER(e.folder) LIKE '%sent%' AND LOWER(e.recipients) LIKE '%' || vc.email_addr || '%')
                GROUP BY vc.id, vc.email_addr"""
            ).fetchall()
            act_by_id = {r["vip_id"]: r for r in activity}

            now_naive = datetime.now()
            recent_start = (now_naive - timedelta(days=30)).strftime("%Y-%m-%d")
            older_start = (now_naive - timedelta(days=60)).strftime("%Y-%m-%d")
            trend_rows = conn.execute(
                """SELECT vc.id AS vip_id,
                    SUM(CASE WHEN e.date >= ? AND e.date < ? THEN 1 ELSE 0 END) AS older_half,
                    SUM(CASE WHEN e.date >= ? THEN 1 ELSE 0 END) AS recent_half
                FROM vip_contacts vc
                LEFT JOIN emails e ON (LOWER(e.sender) LIKE '%' || vc.email_addr || '%' OR LOWER(e.recipients) LIKE '%' || vc.email_addr || '%')
                    AND e.date >= ?
                GROUP BY vc.id""",
                (older_start, recent_start, recent_start, older_start),
            ).fetchall()
            trend_by_id = {r["vip_id"]: r for r in trend_rows}

            commitments = {}
            try:
                for r in conn.execute(
                    """SELECT LOWER(contact_email) AS email, COUNT(*) AS count
                    FROM commitments WHERE status != 'done'
                    GROUP BY LOWER(contact_email)"""
                ).fetchall():
                    commitments[r["email"]] = r["count"]
            except Exception:
                pass

            deals = {}
            try:
                for r in conn.execute(
                    """SELECT LOWER(contact_email) AS email, name, stage
                    FROM crm_deals WHERE stage NOT IN ('closed_won', 'closed_lost')
                    ORDER BY created_at DESC"""
                ).fetchall():
                    if r["email"] not in deals:
                        deals[r["email"]] = {"name": r["name"], "stage": r["stage"]}
            except Exception:
                pass

        contacts = []
        summary = {"total": 0, "healthy": 0, "good": 0, "fading": 0, "at_risk": 0, "cold": 0}
        for v in vips:
            vid = v["id"]
            email = (v["email_addr"] or "").lower()
            a = act_by_id.get(vid)
            received_count = a["received_count"] if a else 0
            sent_count = a["sent_count"] if a else 0
            last_received = a["last_received"] if a else None
            last_sent_to = a["last_sent_to"] if a else None
            unread_count = a["unread_count"] if a else 0

            score = _compute_score(received_count, sent_count, last_received, last_sent_to, unread_count)
            status = _status(score)
            last_contact = max(filter(None, [last_received, last_sent_to]), default=None)
            awaiting = bool((last_sent_to and last_received and last_sent_to > last_received) or
                            (last_sent_to and not last_received))

            t = trend_by_id.get(vid)
            older = (t["older_half"] or 0) if t else 0
            recent = (t["recent_half"] or 0) if t else 0
            if recent > older * 1.2:
                trend = "warming"
            elif recent < older * 0.8:
                trend = "cooling"
            else:
                trend = "stable"

            summary["total"] += 1
            summary[status] += 1
            contacts.append({
                "id": vid,
                "name": v["name"],
                "email": email,
                "note": v["note"],
                "score": score,
                "status": status,
                "trend": trend,
                "days_since_contact": _days_since(last_contact),
                "last_received": last_received[:10] if last_received else None,
                "last_sent_to": last_sent_to[:10] if last_sent_to else None,
                "received_count": received_count,
                "sent_count": sent_count,
                "unread_count": unread_count,
                "awaiting_reply": awaiting,
                "open_commitments": commitments.get(email, 0),
                "active_deal": deals.get(email),
            })

        contacts.sort(key=lambda c: c["score"])
        _cache_result = {"contacts": contacts, "summary": summary}
        _cache_time = now
        return _cache_result
    except Exception as e:
        return {"contacts": [], "summary": {"total": 0, "healthy": 0, "good": 0,
                "fading": 0, "at_risk": 0, "cold": 0}, "error": str(e)}
