from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/api/drafts", tags=["drafts"])


class DraftRequest(BaseModel):
    to: str
    subject: str
    body: str
    account_id: int = 0


@router.post("/save")
async def save_draft(req: DraftRequest, request: Request):
    cache = request.app.state.cache

    # Resolve provider
    from services.email_provider import build_provider
    if req.account_id:
        acc = cache.get_account(req.account_id)
        if not acc:
            raise HTTPException(404, "Account not found")
        cfg = acc.to_connection_config()
    else:
        from routers.connection import load_config
        cfg = load_config()
        if not cfg:
            raise HTTPException(400, "No account configured")

    try:
        provider = build_provider(cfg)
        ok = provider.save_draft(req.to, req.subject, req.body)
        if hasattr(provider, "disconnect"):
            try:
                provider.disconnect()
            except Exception:
                pass
        if not ok:
            raise HTTPException(500, "Failed to save draft")
        return {"status": "saved"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, str(e))
