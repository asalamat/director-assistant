"""Post rich messages to Slack (Blocks API) and Microsoft Teams (Adaptive Cards)."""

import httpx


async def post_to_slack(
    webhook_url: str,
    title: str,
    sender: str,
    subject: str,
    date: str,
    body_preview: str,
    email_id: str = "",
) -> dict:
    """POST a Blocks API message to a Slack incoming webhook.
    Returns {"ok": bool, "error": str|None}.
    """
    blocks = [
        {"type": "header", "text": {"type": "plain_text", "text": title[:150], "emoji": True}},
        {
            "type": "context",
            "elements": [
                {"type": "mrkdwn", "text": f"*From:* {sender}  |  *Date:* {date}"},
                {"type": "mrkdwn", "text": f"*Subject:* {subject[:120]}"},
            ],
        },
        {
            "type": "section",
            "text": {"type": "mrkdwn", "text": body_preview[:500] or "_No preview available_"},
        },
        {"type": "divider"},
    ]
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            r = await client.post(webhook_url, json={"blocks": blocks})
        if r.status_code == 200:
            return {"ok": True, "error": None}
        return {"ok": False, "error": f"HTTP {r.status_code}: {r.text[:200]}"}
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def post_to_teams(
    webhook_url: str,
    title: str,
    sender: str,
    subject: str,
    date: str,
    body_preview: str,
) -> dict:
    """POST an Adaptive Card to a Microsoft Teams incoming webhook.
    Returns {"ok": bool, "error": str|None}.
    """
    card = {
        "type": "message",
        "attachments": [
            {
                "contentType": "application/vnd.microsoft.card.adaptive",
                "content": {
                    "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
                    "type": "AdaptiveCard",
                    "version": "1.4",
                    "body": [
                        {
                            "type": "TextBlock",
                            "size": "Medium",
                            "weight": "Bolder",
                            "text": title[:150],
                            "wrap": True,
                        },
                        {
                            "type": "FactSet",
                            "facts": [
                                {"title": "From", "value": sender[:100]},
                                {"title": "Subject", "value": subject[:120]},
                                {"title": "Date", "value": date[:30]},
                            ],
                        },
                        {
                            "type": "TextBlock",
                            "wrap": True,
                            "text": body_preview[:500] or "No preview available",
                            "isSubtle": True,
                        },
                    ],
                },
            }
        ],
    }
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            r = await client.post(webhook_url, json=card)
        if r.status_code in (200, 202):
            return {"ok": True, "error": None}
        return {"ok": False, "error": f"HTTP {r.status_code}: {r.text[:200]}"}
    except Exception as e:
        return {"ok": False, "error": str(e)}
