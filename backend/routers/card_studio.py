"""Card Studio — brand post card generator for LinkedIn/Instagram (Pillow + AI caption + publish)."""

import io
import base64

import httpx
from fastapi import APIRouter, Request, HTTPException
from pydantic import BaseModel
from typing import Optional, List

try:
    from PIL import Image, ImageDraw, ImageFont
    PIL_AVAILABLE = True
except ImportError:
    PIL_AVAILABLE = False

from routers.social import _publish_to_linkedin, _get_linkedin_settings, _ai_complete
from routers.instagram import _get_instagram_settings, _publish_to_instagram

router = APIRouter(prefix="/api/social/card", tags=["card-studio"])

CANVAS = 1080
DEFAULT_RGB = (30, 58, 95)

_FONT_PATHS = [
    "/System/Library/Fonts/Helvetica.ttc",
    "/Library/Fonts/Arial.ttf",
    "/System/Library/Fonts/Arial.ttf",
    "C:/Windows/Fonts/arial.ttf",
    "C:/Windows/Fonts/calibri.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
]


def _ensure_tables(cache):
    with cache._conn() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS brand_kit (
                id INTEGER PRIMARY KEY DEFAULT 1,
                primary_color TEXT DEFAULT '#1e3a5f',
                accent_color TEXT DEFAULT '#e8b84b',
                text_color TEXT DEFAULT '#ffffff',
                bg_style TEXT DEFAULT 'gradient',
                logo_url TEXT DEFAULT '',
                author_name TEXT DEFAULT '',
                tagline TEXT DEFAULT ''
            )
        """)


# ---------------------------------------------------------------- Pillow helpers

def _load_font(size: int, bold: bool = False):
    for path in _FONT_PATHS:
        try:
            return ImageFont.truetype(path, size)
        except Exception:
            continue
    return ImageFont.load_default()


def _hex_rgb(hex_str: str):
    try:
        s = (hex_str or "").lstrip("#")
        if len(s) != 6:
            return DEFAULT_RGB
        return (int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16))
    except Exception:
        return DEFAULT_RGB


def _darken(rgb, factor=0.6):
    return tuple(max(0, min(255, int(c * factor))) for c in rgb)


def _rgba(rgb, alpha):
    return (rgb[0], rgb[1], rgb[2], int(alpha * 255))


def _draw_gradient(img, top_rgb, bottom_rgb):
    base = Image.new("RGB", (1, CANVAS))
    for y in range(CANVAS):
        t = y / (CANVAS - 1)
        base.putpixel((0, y), tuple(int(top_rgb[i] + (bottom_rgb[i] - top_rgb[i]) * t) for i in range(3)))
    grad = base.resize((CANVAS, CANVAS))
    img.paste(grad, (0, 0))


def _wrap_text(draw, text, font, max_width):
    words = (text or "").split()
    lines, line = [], ""
    for w in words:
        trial = f"{line} {w}".strip()
        if draw.textlength(trial, font=font) <= max_width or not line:
            line = trial
        else:
            lines.append(line)
            line = w
    if line:
        lines.append(line)
    return lines


def _draw_centered(draw, text, font, y, canvas_w, color):
    w = draw.textlength(text, font=font)
    draw.text(((canvas_w - w) / 2, y), text, font=font, fill=color)


def _draw_multiline_centered(draw, lines, font, start_y, canvas_w, color, line_spacing=1.3):
    asc, desc = font.getmetrics() if hasattr(font, "getmetrics") else (font.size, 0)
    line_h = int((asc + desc) * line_spacing) if (asc + desc) else int(font.size * line_spacing)
    y = start_y
    for ln in lines:
        _draw_centered(draw, ln, font, y, canvas_w, color)
        y += line_h
    return y


def _paste_logo(img, logo_url):
    if not logo_url:
        return
    try:
        r = httpx.get(logo_url, timeout=10.0, follow_redirects=True)
        r.raise_for_status()
        logo = Image.open(io.BytesIO(r.content)).convert("RGBA").resize((80, 80))
        img.paste(logo, (900, 30), logo)
    except Exception:
        pass


def _generate_card(card_type: str, content: dict, brand: dict) -> bytes:
    primary = _hex_rgb(brand.get("primary_color", "#1e3a5f"))
    accent = _hex_rgb(brand.get("accent_color", "#e8b84b"))
    text_rgb = _hex_rgb(brand.get("text_color", "#ffffff"))
    text_color = text_rgb
    bg_style = brand.get("bg_style", "gradient")
    tagline = (brand.get("tagline") or "").strip()
    author = (brand.get("author_name") or "").strip()

    img = Image.new("RGB", (CANVAS, CANVAS), primary)
    if bg_style == "gradient":
        _draw_gradient(img, primary, _darken(primary))
    img = img.convert("RGBA")
    draw = ImageDraw.Draw(img)

    def tagline_bottom():
        if tagline:
            f = _load_font(28)
            overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
            od = ImageDraw.Draw(overlay)
            w = od.textlength(tagline, font=f)
            od.text(((CANVAS - w) / 2, CANVAS - 70), tagline, font=f, fill=_rgba(text_rgb, 0.6))
            img.alpha_composite(overlay)

    if card_type == "quote":
        draw.text((60, 40), "“", font=_load_font(180, bold=True), fill=accent)
        quote = content.get("body") or content.get("headline") or ""
        qf = _load_font(52)
        lines = _wrap_text(draw, quote, qf, 900)
        _draw_multiline_centered(draw, lines, qf, 200, CANVAS, text_color)
        if author:
            draw.text((60, CANVAS - 160), author, font=_load_font(36), fill=accent)
        tagline_bottom()

    elif card_type == "tip":
        title = content.get("headline") or "Tips"
        _draw_centered(draw, title, _load_font(64, bold=True), 80, CANVAS, text_color)
        draw.line([(80, 170), (1000, 170)], fill=accent, width=4)
        items = (content.get("items") or [])[:5]
        item_f = _load_font(40)
        num_f = _load_font(36, bold=True)
        y = 200
        for i, item in enumerate(items, 1):
            cx, cy = 110, y + 20
            draw.ellipse([cx - 35, cy - 35, cx + 35, cy + 35], fill=accent)
            nw = draw.textlength(str(i), font=num_f)
            draw.text((cx - nw / 2, cy - 22), str(i), font=num_f, fill=primary)
            for j, ln in enumerate(_wrap_text(draw, str(item), item_f, 800)):
                draw.text((170, y + j * 50), ln, font=item_f, fill=text_color)
            y += 140
        tagline_bottom()

    elif card_type == "stat":
        number = content.get("stat_number") or content.get("headline") or ""
        _draw_centered(draw, str(number), _load_font(220, bold=True), 180, CANVAS, accent)
        label = content.get("stat_label") or content.get("body") or ""
        lf = _load_font(48)
        _draw_multiline_centered(draw, _wrap_text(draw, label, lf, 900), lf, 440, CANVAS, text_color)
        head = content.get("headline") or ""
        if head and head != number:
            overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
            od = ImageDraw.Draw(overlay)
            hf = _load_font(36)
            _draw_multiline_centered(od, _wrap_text(od, head, hf, 900), hf, 700, CANVAS, _rgba(text_rgb, 0.7))
            img.alpha_composite(overlay)
        tagline_bottom()

    elif card_type == "announcement":
        _draw_centered(draw, "ANNOUNCING", _load_font(28, bold=True), 120, CANVAS, accent)
        head = content.get("headline") or ""
        hf = _load_font(72, bold=True)
        end_y = _draw_multiline_centered(draw, _wrap_text(draw, head, hf, 920), hf, 180, CANVAS, text_color)
        draw.line([(340, 380), (740, 380)], fill=accent, width=3)
        body = content.get("body") or ""
        overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
        od = ImageDraw.Draw(overlay)
        bf = _load_font(40)
        _draw_multiline_centered(od, _wrap_text(od, body, bf, 900), bf, 420, CANVAS, _rgba(text_rgb, 0.8))
        img.alpha_composite(overlay)
        tagline_bottom()

    else:
        head = content.get("headline") or content.get("body") or ""
        hf = _load_font(64, bold=True)
        _draw_multiline_centered(draw, _wrap_text(draw, head, hf, 920), hf, 300, CANVAS, text_color)
        tagline_bottom()

    # Accent bar at bottom
    final_draw = ImageDraw.Draw(img)
    final_draw.rectangle([0, CANVAS - 12, CANVAS, CANVAS], fill=accent)

    _paste_logo(img, brand.get("logo_url", ""))

    out = io.BytesIO()
    img.convert("RGB").save(out, format="PNG")
    return out.getvalue()


# ---------------------------------------------------------------- models

class BrandKitBody(BaseModel):
    primary_color: Optional[str] = None
    accent_color: Optional[str] = None
    text_color: Optional[str] = None
    bg_style: Optional[str] = None
    logo_url: Optional[str] = None
    author_name: Optional[str] = None
    tagline: Optional[str] = None


class GenerateBody(BaseModel):
    card_type: str = "quote"
    content: dict = {}
    brand: dict = {}


class CaptionBody(BaseModel):
    card_type: str = "quote"
    content: dict = {}
    platform: str = "linkedin"
    tone: str = "professional"


class PostBody(BaseModel):
    image_b64: str
    caption: str = ""
    hashtags: List[str] = []
    platforms: List[str] = ["linkedin"]


# ---------------------------------------------------------------- brand kit

_KIT_FIELDS = ["primary_color", "accent_color", "text_color", "bg_style", "logo_url", "author_name", "tagline"]


@router.get("/brand-kit")
async def get_brand_kit(request: Request):
    cache = request.app.state.cache
    _ensure_tables(cache)
    with cache._conn() as conn:
        row = conn.execute("SELECT * FROM brand_kit WHERE id = 1").fetchone()
        if not row:
            conn.execute("INSERT INTO brand_kit (id) VALUES (1)")
            row = conn.execute("SELECT * FROM brand_kit WHERE id = 1").fetchone()
    return {k: row[k] for k in row.keys()}


@router.post("/brand-kit")
async def save_brand_kit(body: BrandKitBody, request: Request):
    cache = request.app.state.cache
    _ensure_tables(cache)
    data = {k: v for k, v in body.dict().items() if v is not None}
    with cache._conn() as conn:
        conn.execute("INSERT OR IGNORE INTO brand_kit (id) VALUES (1)")
        if data:
            sets = ", ".join(f"{k} = ?" for k in data)
            conn.execute(f"UPDATE brand_kit SET {sets} WHERE id = 1", list(data.values()))
        row = conn.execute("SELECT * FROM brand_kit WHERE id = 1").fetchone()
    return {k: row[k] for k in row.keys()}


# ---------------------------------------------------------------- generate

@router.post("/generate")
async def generate(body: GenerateBody, request: Request):
    if not PIL_AVAILABLE:
        raise HTTPException(400, "Pillow not installed on this server")
    try:
        png = _generate_card(body.card_type, body.content or {}, body.brand or {})
    except Exception as e:
        raise HTTPException(502, str(e))
    b64 = base64.b64encode(png).decode("ascii")
    return {"image_b64": f"data:image/png;base64,{b64}"}


# ---------------------------------------------------------------- caption

@router.post("/generate-caption")
async def generate_caption(body: CaptionBody, request: Request):
    c = body.content or {}
    parts = [c.get("headline", ""), c.get("body", ""),
             c.get("stat_number", ""), c.get("stat_label", "")]
    items = c.get("items") or []
    if items:
        parts.append("; ".join(str(i) for i in items))
    summary = " — ".join(p for p in parts if p).strip() or body.card_type

    system = (
        f"You write {body.tone} social media captions for {body.platform}. "
        "Return only the caption text — no hashtags, no quotes, no preamble."
    )
    cap_prompt = (
        f"Write a {body.tone} {body.platform} caption for a {body.card_type} brand card.\n"
        f"Card content: {summary}\n"
        "Keep it concise and engaging."
    )
    try:
        caption = (await _ai_complete(request, cap_prompt, max_tokens=400, system=system)).strip()
    except Exception as e:
        raise HTTPException(502, f"AI caption failed: {e}")

    ht_prompt = (
        f"Suggest 6 relevant {body.platform} hashtags for this post: {summary}\n"
        "Return only the hashtags separated by spaces, each starting with #."
    )
    hashtags: List[str] = []
    try:
        raw = await _ai_complete(request, ht_prompt, max_tokens=100,
                                 system="Return only hashtags, space-separated.")
        hashtags = [w for w in raw.replace("\n", " ").split() if w.startswith("#")][:10]
    except Exception:
        hashtags = []
    return {"caption": caption, "hashtags": hashtags}


# ---------------------------------------------------------------- post

@router.post("/post")
async def post_card(body: PostBody, request: Request):
    full_caption = body.caption or ""
    if body.hashtags:
        full_caption = f"{full_caption}\n\n{' '.join(body.hashtags)}".strip()

    results = []
    for platform in body.platforms:
        if platform == "linkedin":
            settings = _get_linkedin_settings()
            if not settings.get("access_token"):
                results.append({"platform": "linkedin", "status": "error",
                                "error": "LinkedIn not configured — go to Settings → LinkedIn"})
                continue
            try:
                res = await _publish_to_linkedin(full_caption, settings, body.image_b64, "image+text")
                if res.get("error"):
                    results.append({"platform": "linkedin", "status": "error", "error": res["error"]})
                else:
                    results.append({"platform": "linkedin", "status": "posted"})
            except Exception as e:
                results.append({"platform": "linkedin", "status": "error", "error": str(e)})

        elif platform == "instagram":
            settings = _get_instagram_settings()
            try:
                res = await _publish_to_instagram(settings, body.image_b64, full_caption)
                if res.get("error"):
                    results.append({"platform": "instagram", "status": "error", "error": res["error"]})
                else:
                    results.append({"platform": "instagram", "status": "posted"})
            except Exception as e:
                results.append({"platform": "instagram", "status": "error", "error": str(e)})
        else:
            results.append({"platform": platform, "status": "error", "error": "Unknown platform"})

    return {"results": results}
