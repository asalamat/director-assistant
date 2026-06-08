from fastapi import APIRouter, Request
from urllib.parse import unquote

router = APIRouter(prefix="/api/sender", tags=["sender"])


@router.get("/{sender:path}/relationship")
async def get_contact_relationship(sender: str, request: Request):
    """Rich relationship stats + AI summary for a contact."""
    decoded = unquote(sender)
    cache = request.app.state.cache
    advisor = request.app.state.advisor

    stats = cache.contact_relationship(decoded)

    # AI-written relationship summary
    unreplied = stats["unreplied_count"]
    last_recv = stats["last_received"] or "unknown"
    last_sent = stats["last_sent_to"] or "never"
    avg_h = stats["avg_response_hours"]
    avg_str = f"{avg_h}h" if avg_h else "unknown"
    subjects_str = ", ".join(f'"{s}"' for s in (stats["recent_subjects"] or [])[:3])

    prompt = f"""Summarize the email relationship with {decoded} in 2 sentences.
Facts: {stats['total_received']} emails received from them.
Last email from them: {last_recv}. Last email you sent them: {last_sent}.
{unreplied} emails from them have no reply yet. Average reply time: {avg_str}.
Recent topics: {subjects_str or 'none'}.
Be direct and actionable. Start with the most important observation."""

    try:
        resp = await advisor.ai.messages.create(
            model="claude-haiku-4-5-20251001", max_tokens=150,
            messages=[{"role": "user", "content": prompt}],
        )
        stats["ai_summary"] = resp.content[0].text.strip()
    except Exception:
        stats["ai_summary"] = None

    return stats


@router.get("/{sender:path}/monthly")
async def sender_monthly(sender: str, request: Request):
    """Return email volume per month for a sender (last 12 months)."""
    decoded = unquote(sender)
    months = request.app.state.cache.sender_monthly_volume(decoded)
    return {"months": months}


@router.get("/{sender:path}")
async def get_sender_stats(sender: str, request: Request):
    decoded = unquote(sender)
    return request.app.state.cache.sender_stats(decoded)
