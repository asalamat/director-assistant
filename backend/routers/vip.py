"""VIP Contact Manager — track and prioritise key contacts."""
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from typing import Optional

router = APIRouter(prefix="/api/vip", tags=["vip"])


class VIPIn(BaseModel):
    email_addr: str
    name: str = ""
    note: str = ""


@router.get("")
async def list_vips(request: Request):
    cache = request.app.state.cache
    with cache._conn() as conn:
        rows = conn.execute(
            "SELECT * FROM vip_contacts ORDER BY name, email_addr"
        ).fetchall()
    vips = [dict(r) for r in rows]
    if not vips:
        return {"vips": vips}

    # Enrich with recent activity — single query per stat table using a
    # CASE-based aggregation so we avoid N separate round-trips.
    email_addrs = [v["email_addr"].lower() for v in vips]
    placeholders = ",".join("?" * len(email_addrs))

    with cache._conn() as conn:
        # Received stats: one row per vip_addr matched via LIKE
        recv_rows = conn.execute(
            f"""SELECT vc.email_addr AS vip_addr,
                       COUNT(e.id)                                      AS emails_received,
                       MAX(e.date)                                       AS last_received,
                       SUM(CASE WHEN e.is_read=0 THEN 1 ELSE 0 END)    AS unread
                FROM vip_contacts vc
                LEFT JOIN emails e
                       ON LOWER(e.sender) LIKE '%' || vc.email_addr || '%'
                WHERE LOWER(vc.email_addr) IN ({placeholders})
                GROUP BY vc.email_addr""",
            email_addrs,
        ).fetchall()

        sent_rows = conn.execute(
            f"""SELECT vc.email_addr AS vip_addr,
                       COUNT(e.id)   AS emails_sent_to,
                       MAX(e.date)   AS last_sent_to
                FROM vip_contacts vc
                LEFT JOIN emails e
                       ON LOWER(e.folder) LIKE '%sent%'
                      AND LOWER(e.recipients) LIKE '%' || vc.email_addr || '%'
                WHERE LOWER(vc.email_addr) IN ({placeholders})
                GROUP BY vc.email_addr""",
            email_addrs,
        ).fetchall()

    recv_map = {r["vip_addr"]: r for r in recv_rows}
    sent_map = {r["vip_addr"]: r for r in sent_rows}

    for v in vips:
        addr = v["email_addr"].lower()
        recv = recv_map.get(addr)
        sent = sent_map.get(addr)
        v["emails_received"] = recv["emails_received"] if recv else 0
        v["last_received"]   = recv["last_received"]   if recv else None
        v["unread"]          = recv["unread"]           if recv else 0
        v["emails_sent_to"]  = sent["emails_sent_to"]  if sent else 0
        v["last_sent_to"]    = sent["last_sent_to"]    if sent else None

        # Check if awaiting reply — we sent to them and haven't heard back
        if v["last_sent_to"] and v["last_received"]:
            v["awaiting_reply"] = v["last_sent_to"] > v["last_received"]
        else:
            v["awaiting_reply"] = False

    return {"vips": vips}


@router.post("")
async def add_vip(body: VIPIn, request: Request):
    cache = request.app.state.cache
    with cache._conn() as conn:
        try:
            conn.execute(
                "INSERT INTO vip_contacts (email_addr, name, note) VALUES (?,?,?)",
                (body.email_addr.lower().strip(), body.name.strip(), body.note.strip())
            )
        except Exception:
            raise HTTPException(409, "Contact already in VIP list")
    return {"added": body.email_addr}


@router.patch("/{vip_id}")
async def update_vip(vip_id: int, body: VIPIn, request: Request):
    cache = request.app.state.cache
    with cache._conn() as conn:
        conn.execute(
            "UPDATE vip_contacts SET name=?, note=? WHERE id=?",
            (body.name.strip(), body.note.strip(), vip_id)
        )
    return {"updated": vip_id}


@router.delete("/{vip_id}")
async def remove_vip(vip_id: int, request: Request):
    cache = request.app.state.cache
    with cache._conn() as conn:
        conn.execute("DELETE FROM vip_contacts WHERE id=?", (vip_id,))
    return {"removed": vip_id}


@router.get("/emails/{email_addr}")
async def vip_email_history(email_addr: str, request: Request, limit: int = 20):
    """Return recent emails from/to this VIP contact."""
    cache = request.app.state.cache
    addr = email_addr.lower()
    with cache._conn() as conn:
        rows = conn.execute(
            """SELECT id, subject, sender, date, folder, is_read, body
               FROM emails
               WHERE LOWER(sender) LIKE ? OR LOWER(recipients) LIKE ?
               ORDER BY date DESC LIMIT ?""",
            (f"%{addr}%", f"%{addr}%", limit)
        ).fetchall()
    return {"emails": [dict(r) for r in rows]}
