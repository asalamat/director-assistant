"""
Renders the executive dashboard as a self-contained HTML string.
No external libraries — pure CSS charts, JS modal, auto-refresh.
"""

from __future__ import annotations

import html as _html
from datetime import date, timedelta

from services.dashboard_ai import (  # noqa: E402
    AI_CSS, AI_JS, AI_MODAL_HTML,
    _onedrive_html, _teams_html,
)

_REFRESH_MS = 30 * 60 * 1000  # 30 minutes

_CSS = """
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
     background:#0d1117;color:#e6edf3;font-size:14px;line-height:1.6}
a{color:#79c0ff;text-decoration:none}a:hover{text-decoration:underline}
h2{font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;
   color:#8b949e;margin-bottom:10px;padding-bottom:6px;border-bottom:1px solid #21262d}
.wrap{max-width:1280px;margin:0 auto;padding:20px 24px}
.hdr{display:flex;justify-content:space-between;align-items:flex-end;
     margin-bottom:24px;padding-bottom:16px;border-bottom:1px solid #21262d}
.hdr-left h1{font-size:22px;font-weight:700;color:#f0f6fc}
.hdr-left .sub{color:#8b949e;font-size:13px;margin-top:3px}
.hdr-right{text-align:right;font-size:12px;color:#6e7681}
.hint{margin-top:4px;font-size:11px;color:#484f58}
.kpi{display:grid;grid-template-columns:repeat(6,1fr);gap:12px;margin-bottom:20px}
@media(max-width:900px){.kpi{grid-template-columns:repeat(3,1fr)}}
.kpi-tile{background:#161b22;border:1px solid #21262d;border-radius:8px;
          padding:14px 16px;cursor:default;transition:border-color .15s}
.kpi-tile:hover{border-color:#58a6ff}
.kpi-tile .val{font-size:28px;font-weight:700;line-height:1}
.kpi-tile .lbl{font-size:11px;color:#8b949e;margin-top:5px}
.red .val{color:#f85149}.yellow .val{color:#d29922}
.green .val{color:#3fb950}.blue .val{color:#58a6ff}
.purple .val{color:#bc8cff}.teal .val{color:#39d353}
.urgent{background:#1a0d0d;border:1px solid #6e1a1a;border-radius:8px;
        padding:14px 18px;margin-bottom:20px}
.urgent h2{color:#f85149;border-color:#6e1a1a}
.urgent-items{display:flex;flex-wrap:wrap;gap:8px}
.u-tag{background:#2d1111;border:1px solid #8b1a1a;border-radius:5px;
       padding:4px 10px;font-size:12px;color:#ff7b72;cursor:pointer;transition:background .15s}
.u-tag:hover{background:#3d1515}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px}
@media(max-width:800px){.grid2{grid-template-columns:1fr}}
.card{background:#161b22;border:1px solid #21262d;border-radius:8px;padding:16px}
.item-list{list-style:none}
.item-list li{padding:7px 0;border-bottom:1px solid #21262d;font-size:13px;
              cursor:pointer;transition:background .12s;border-radius:4px;padding-left:4px}
.item-list li:last-child{border:none}
.item-list li:hover{background:#1c2128}
.badge{display:inline-block;padding:1px 7px;border-radius:4px;font-size:11px;font-weight:600;margin-left:6px}
.bdg-red{background:#2d1111;color:#ff7b72}.bdg-yellow{background:#2d2207;color:#d29922}
.bdg-green{background:#0d2a0d;color:#3fb950}.bdg-blue{background:#0a1929;color:#58a6ff}
.meta{font-size:11px;color:#6e7681;margin-top:2px}
.bar-chart{margin-top:6px}
.bar-row{display:flex;align-items:center;gap:8px;margin-bottom:6px}
.bar-lbl{width:72px;font-size:11px;color:#8b949e;text-align:right;flex-shrink:0;
         overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bar-track{flex:1;background:#21262d;border-radius:3px;height:18px;overflow:hidden}
.bar-fill{height:100%;border-radius:3px;background:linear-gradient(90deg,#1f6feb,#58a6ff);transition:width .3s}
.bar-val{width:28px;font-size:11px;color:#8b949e;flex-shrink:0}
.donut-wrap{display:flex;align-items:center;gap:24px;margin-top:8px}
.donut{width:120px;height:120px;border-radius:50%;flex-shrink:0;position:relative}
.donut::after{content:'';position:absolute;top:25%;left:25%;width:50%;height:50%;
              background:#161b22;border-radius:50%}
.donut-legend{flex:1}
.legend-row{display:flex;align-items:center;gap:8px;margin-bottom:5px;font-size:12px}
.legend-dot{width:10px;height:10px;border-radius:50%;flex-shrink:0}
.proj-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px}
.proj-card{background:#0d1117;border:1px solid #21262d;border-radius:6px;padding:12px;
           cursor:pointer;transition:border-color .15s}
.proj-card:hover{border-color:#58a6ff}
.proj-card .pname{font-weight:600;font-size:13px;color:#e6edf3;margin-bottom:4px;
                  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.proj-card .pnext{font-size:12px;color:#8b949e}
.evt{padding:8px 0;border-bottom:1px solid #21262d;cursor:pointer;border-radius:4px;
     padding-left:4px;transition:background .12s}
.evt:last-child{border:none}
.evt:hover{background:#1c2128}
.evt-time{font-size:11px;color:#6e7681;min-width:48px;display:inline-block}
.evt-title{font-weight:500}
.evt-org{font-size:11px;color:#8b949e;margin-top:2px}
.footer{margin-top:32px;padding-top:16px;border-top:1px solid #21262d;
        font-size:11px;color:#484f58;text-align:center}
/* Modal */
.modal-bg{display:none;position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:1000;
          align-items:center;justify-content:center;padding:20px}
.modal-bg.open{display:flex}
.modal{background:#161b22;border:1px solid #30363d;border-radius:12px;max-width:640px;
       width:100%;max-height:80vh;overflow-y:auto;padding:24px;position:relative}
.modal h3{font-size:16px;font-weight:600;color:#f0f6fc;margin-bottom:12px;padding-right:24px}
.modal .detail-row{margin-bottom:8px;font-size:13px}
.modal .detail-label{color:#8b949e;font-size:11px;text-transform:uppercase;
                     letter-spacing:.06em;margin-bottom:2px}
.modal .detail-body{color:#e6edf3;white-space:pre-wrap;word-break:break-word;
                    max-height:300px;overflow-y:auto;background:#0d1117;
                    border-radius:6px;padding:10px;font-size:12px;line-height:1.7}
.modal-close{position:absolute;top:16px;right:16px;background:none;border:none;
             color:#8b949e;font-size:20px;cursor:pointer;line-height:1}
.modal-close:hover{color:#f0f6fc}
"""

_CSS += AI_CSS

_JS = f"""
let currentCtx='';
const bg=document.getElementById('modal-bg');
const mTitle=document.getElementById('modal-title');
const mBody=document.getElementById('modal-body');
function showModal(title,rows){{
  mTitle.textContent=title;
  mBody.innerHTML=rows.map(([lbl,val])=>
    '<div class="detail-row"><div class="detail-label">'+lbl+'</div>'+
    '<div class="detail-body">'+val+'</div></div>').join('');
  currentCtx=title+'\\n'+rows.map(([l,v])=>l+': '+v).join('\\n');
  const o=document.getElementById('ai-out'),i=document.getElementById('ai-input');
  const sd=document.getElementById('save-draft-btn');
  const mp=document.getElementById('meeting-prep-chip');
  if(o){{o.textContent='';o.classList.remove('active');}}
  if(i)i.value='';
  if(sd){{sd.style.display='none';sd.disabled=false;sd.textContent='Save to Drafts';}}
  if(mp)mp.style.display=/^Attendees: [^—]/m.test(currentCtx)?'inline-block':'none';
  bg.classList.add('open');
}}
function closeModal(){{bg.classList.remove('open');}}
bg.addEventListener('click',e=>{{if(e.target===bg)closeModal();}});
document.addEventListener('keydown',e=>{{if(e.key==='Escape')closeModal();}});
document.querySelectorAll('[data-modal]').forEach(el=>{{
  el.addEventListener('click',()=>{{const d=JSON.parse(el.dataset.modal);showModal(d.title,d.rows);}});
}});
const countdown=document.getElementById('countdown');
let remaining={_REFRESH_MS}/1000;
setInterval(()=>{{
  remaining--;if(remaining<=0){{window.location.reload();return;}}
  const m=Math.floor(remaining/60),s=remaining%60;
  if(countdown)countdown.textContent=m+'m '+s+'s';
}},1000);
{AI_JS}
"""


# ── Helpers ───────────────────────────────────────────────────────────────────

def _e(s: str) -> str:
    """HTML-escape a string for use in data-modal JSON."""
    return _html.escape(str(s), quote=True)


def _modal_attr(title: str, rows: list[tuple[str, str]]) -> str:
    import json
    payload = json.dumps({"title": title, "rows": rows})
    return f' data-modal=\'{_html.escape(payload, quote=True)}\''


def _kpi_tile(val: str | int, label: str, cls: str = "") -> str:
    return (f'<div class="kpi-tile {cls}">'
            f'<div class="val">{val}</div>'
            f'<div class="lbl">{label}</div></div>')


def _section(title: str, body: str, extra_class: str = "") -> str:
    return f'<div class="card {extra_class}"><h2>{title}</h2>{body}</div>'


def _urgent_banner(actions: list[dict], follow_ups: list[dict]) -> str:
    overdue = [a for a in actions if a.get("text")][:6]
    due_fup = [f for f in follow_ups if f.get("due_date", "9999") <= date.today().isoformat()][:4]
    if not overdue and not due_fup:
        return ""
    tags = "".join(
        f'<span class="u-tag"{_modal_attr(a["text"][:80], [("Action", a["text"]), ("Email", a.get("email_subject",""))])}>{_e(a["text"][:80])}</span>'
        for a in overdue
    )
    tags += "".join(
        f'<span class="u-tag"{_modal_attr("Follow-up: "+f.get("subject","")[:60], [("Subject", f.get("subject","")), ("Sender", f.get("sender","")), ("Due", f.get("due_date",""))])}>'
        f'Follow-up: {_e(f.get("subject","")[:60])}</span>'
        for f in due_fup
    )
    return (f'<div class="urgent"><h2>Needs Attention Today</h2>'
            f'<div class="urgent-items">{tags}</div></div>')


def _schedule_section(events: list[dict]) -> str:
    if not events:
        return "<p style='color:#6e7681;font-size:13px'>No calendar connected or no events tomorrow.</p>"
    rows = []
    for e in events:
        start_raw = (e.get("start") or {}).get("dateTime", "")
        try:
            from datetime import datetime as dt
            t = dt.fromisoformat(start_raw.replace("Z", "+00:00")).strftime("%H:%M")
        except Exception:
            t = "--:--"
        subj = e.get("subject", "(no title)")[:70]
        org  = (e.get("organizer") or {}).get("emailAddress", {}).get("name", "")
        resp = ((e.get("responseStatus") or {}).get("response") or "").lower()
        badge = ""
        if resp == "declined":   badge = '<span class="badge bdg-red">Declined</span>'
        elif resp == "tentativelyaccepted": badge = '<span class="badge bdg-yellow">Tentative</span>'
        elif resp == "accepted":  badge = '<span class="badge bdg-green">Accepted</span>'
        attendee_list = e.get("attendees") or []
        attendees_str = ", ".join(
            a.get("emailAddress", {}).get("address", "")
            for a in attendee_list
            if a.get("emailAddress", {}).get("address")
        )[:500]
        modal = _modal_attr(subj, [
            ("Time", t), ("Organizer", org), ("Response", resp or "—"),
            ("Online", "Yes" if e.get("isOnlineMeeting") else "No"),
            ("Attendees", attendees_str or "—"),
        ])
        rows.append(
            f'<div class="evt"{modal}><span class="evt-time">{t}</span>'
            f'<span class="evt-title">{_e(subj)}</span>{badge}'
            f'{"<div class=evt-org>"+_e(org)+"</div>" if org else ""}</div>'
        )
    return "".join(rows)


def _bar_chart(data: list[dict], label_key: str, value_key: str) -> str:
    if not data:
        return "<p style='color:#6e7681;font-size:12px'>No data</p>"
    max_val = max((d[value_key] for d in data), default=1) or 1
    rows = []
    for d in data:
        lbl = str(d[label_key])
        val = d[value_key]
        pct = int(val / max_val * 100)
        rows.append(
            f'<div class="bar-row">'
            f'<span class="bar-lbl" title="{_e(lbl)}">{_e(lbl[-22:])}</span>'
            f'<div class="bar-track"><div class="bar-fill" style="width:{pct}%"></div></div>'
            f'<span class="bar-val">{val}</span></div>'
        )
    return f'<div class="bar-chart">{"".join(rows)}</div>'


def _week_bar_chart(week_events: list[dict]) -> str:
    today = date.today()
    days = {(today + timedelta(days=i)).isoformat(): 0 for i in range(7)}
    for e in week_events:
        raw = (e.get("start") or {}).get("dateTime", e.get("date", ""))
        key = raw[:10]
        if key in days:
            days[key] += 1
    data = [{"day": d[-5:], "count": c} for d, c in days.items()]
    return _bar_chart(data, "day", "count")


def _doughnut(categories: list[tuple[str, int, str]]) -> str:
    total = sum(p for _, p, _ in categories) or 1
    normalized = [(lbl, round(p / total * 100), col) for lbl, p, col in categories]
    stops, pos = [], 0
    for _, pct, col in normalized:
        stops.append(f"{col} {pos}% {pos + pct}%")
        pos += pct
    legend = "".join(
        f'<div class="legend-row"><div class="legend-dot" style="background:{col}"></div>'
        f'<span>{_e(lbl)} <b>{pct}%</b></span></div>'
        for lbl, pct, col in normalized
    )
    return (f'<div class="donut-wrap">'
            f'<div class="donut" style="background:conic-gradient({", ".join(stops)})"></div>'
            f'<div class="donut-legend">{legend}</div></div>')


def _email_list(emails: list[dict]) -> str:
    if not emails:
        return "<p style='color:#6e7681;font-size:13px'>Inbox zero!</p>"
    items = []
    for e in emails[:10]:
        subj   = (e.get("subject") or "(no subject)")[:72]
        sender = e.get("sender", "")
        d      = (e.get("date") or "")[:10]
        body   = (e.get("body") or "").replace("\n", " ")
        modal  = _modal_attr(subj, [("From", sender), ("Date", d), ("Preview", body[:600] or "—")])
        items.append(
            f'<li{modal}><b>{_e(subj)}</b>'
            f'<div class="meta">{_e(sender[:40])} · {d}</div></li>'
        )
    return f'<ul class="item-list">{"".join(items)}</ul>'


def _action_list(actions: list[dict]) -> str:
    if not actions:
        return "<p style='color:#3fb950;font-size:13px'>No open actions.</p>"
    items = []
    for a in actions[:15]:
        text = (a.get("text") or "")
        subj = (a.get("email_subject") or "")
        created = (a.get("created_at") or "")[:10]
        modal = _modal_attr(text[:80], [("Action", text), ("Email", subj), ("Added", created)])
        items.append(
            f'<li{modal}>{_e(text[:90])}'
            f'{"<div class=meta>"+_e(subj[:50])+"</div>" if subj else ""}</li>'
        )
    return f'<ul class="item-list">{"".join(items)}</ul>'


def _follow_up_list(follow_ups: list[dict]) -> str:
    if not follow_ups:
        return "<p style='color:#6e7681;font-size:13px'>No pending follow-ups.</p>"
    items = []
    for f in follow_ups[:10]:
        subj   = (f.get("subject") or "")
        sender = f.get("sender", "")
        due    = f.get("due_date", "")
        note   = f.get("note", "")
        modal  = _modal_attr(subj[:60] or "Follow-up",
                             [("Subject", subj), ("From", sender), ("Due", due or "—"), ("Note", note or "—")])
        mail = f'<a href="mailto:{_e(sender)}">{_e(sender[:40])}</a>' if "@" in (sender or "") else _e(sender)
        items.append(
            f'<li{modal}>{_e(subj[:60])}'
            f'<div class="meta">{mail}{"  ·  Due "+due if due else ""}</div></li>'
        )
    return f'<ul class="item-list">{"".join(items)}</ul>'


def _projects_html(projects: list[dict]) -> str:
    if not projects:
        return "<p style='color:#6e7681;font-size:13px'>No project signals detected.</p>"
    cards = "".join(
        f'<div class="proj-card"{_modal_attr(p["name"], [("Topic", p["name"]), ("Signals", str(p.get("count",""))), ("Next", p.get("next","—"))])}>'
        f'<div class="pname" title="{_e(p["name"])}">{_e(p["name"][:40])}</div>'
        f'<div class="pnext">Next: {_e(p.get("next","—"))}</div></div>'
        for p in projects
    )
    return f'<div class="proj-grid">{cards}</div>'


def _training_list(items: list[dict]) -> str:
    if not items:
        return "<p style='color:#6e7681;font-size:13px'>No training emails found.</p>"
    rows = []
    for i in items:
        subj   = (i.get("subject") or "")
        sender = i.get("sender", "")
        d      = (i.get("date") or "")[:10]
        modal  = _modal_attr(subj[:70] or "Training", [("Subject", subj), ("From", sender), ("Date", d)])
        rows.append(
            f'<li{modal}>{_e(subj[:70])}'
            f'<div class="meta">{_e(sender[:40])} · {d}</div></li>'
        )
    return f'<ul class="item-list">{"".join(rows)}</ul>'


# ── Main renderer ─────────────────────────────────────────────────────────────

def render_dashboard(d: dict) -> str:
    actions    = d.get("actions", [])
    follow_ups = d.get("follow_ups", [])
    unread     = d.get("unread_count", 0)
    emails     = d.get("unread_emails", [])
    projects   = d.get("projects", [])
    training   = d.get("training", [])
    cal_today  = d.get("calendar_today", [])
    wk_cal     = d.get("week_calendar", [])
    senders    = d.get("top_senders", [])
    vol        = d.get("email_volume", [])
    gen_at     = d.get("generated_at", "")
    onedrive   = d.get("onedrive", [])
    teams      = d.get("teams", [])

    overdue_count = len(actions)
    mtgs_tomorrow = len(cal_today)

    cat_counts: dict[str, int] = {"Customer-facing": 0, "Internal sync": 0,
                                   "Focus": 0, "Training": 0, "Admin": 0}
    for ev in wk_cal:
        cats = ev.get("categories") or []
        matched = False
        for c in cats:
            cl = c.lower()
            if "customer" in cl or "client" in cl or "demo" in cl:
                cat_counts["Customer-facing"] += 1; matched = True; break
            if "training" in cl or "learn" in cl:
                cat_counts["Training"] += 1; matched = True; break
            if "focus" in cl or "block" in cl:
                cat_counts["Focus"] += 1; matched = True; break
            if "admin" in cl or "1:1" in cl:
                cat_counts["Admin"] += 1; matched = True; break
        if not matched and cats:
            cat_counts["Internal sync"] += 1
    if not any(cat_counts.values()):
        cat_counts = {"Customer-facing": 30, "Internal sync": 25,
                      "Focus": 25, "Training": 10, "Admin": 10}

    palette = ["#1f6feb", "#f78166", "#3fb950", "#bc8cff", "#d29922"]
    alloc_cats = [(lbl, pct, palette[i % len(palette)])
                  for i, (lbl, pct) in enumerate(cat_counts.items())]

    urgent_html = _urgent_banner(actions, follow_ups)

    sender_bars = _bar_chart(
        [{"label": s["sender"], "count": s["count"]} for s in senders[:7]],
        "label", "count"
    )

    body = f"""
<div class="wrap">
  <div class="hdr">
    <div class="hdr-left">
      <h1>Director Assistant — Executive Brief</h1>
      <div class="sub">{_e(gen_at)}</div>
      <div class="hint">Click any item for details · Auto-refreshes in <span id="countdown">30m 0s</span></div>
    </div>
    <div class="hdr-right">
      <div>Last refreshed: {_e(gen_at)}</div>
      <div class="hint"><a href="/api/dashboard">Refresh now</a> · <a href="/">← Back to App</a></div>
    </div>
  </div>

  <div class="kpi">
    {_kpi_tile(overdue_count, "Overdue Actions", "red" if overdue_count else "green")}
    {_kpi_tile(unread, "Unread Emails", "yellow" if unread > 20 else "green")}
    {_kpi_tile(mtgs_tomorrow, "Meetings Tomorrow", "blue")}
    {_kpi_tile("—", "Teams Unread", "purple")}
    {_kpi_tile(len(projects), "Active Projects", "teal")}
    {_kpi_tile("—", "OOF This Week", "blue")}
  </div>

  {urgent_html}

  <div class="grid2">
    {_section("Tomorrow's Schedule", _schedule_section(cal_today))}
    {_section("People to Follow Up With", _follow_up_list(follow_ups))}
  </div>

  {_section("Top Active Projects", _projects_html(projects))}

  <div class="grid2" style="margin-top:16px">
    {_section("Week Calendar Load", _week_bar_chart(wk_cal) if wk_cal else _bar_chart(vol[-7:] if vol else [], "date", "count"))}
    {_section("Time Allocation This Week", _doughnut(alloc_cats))}
  </div>

  <div class="grid2" style="margin-top:16px">
    {_section("Emails Needing a Reply", _email_list(emails))}
    {_section("Long-Term Action Items", _action_list(actions))}
  </div>

  <div class="grid2" style="margin-top:16px">
    {_section("Training & Learning", _training_list(training))}
    {_section("Top Senders This Week", sender_bars)}
  </div>

  <div class="grid2" style="margin-top:16px">
    {_section("OneDrive — Recent Files", _onedrive_html(onedrive))}
    {_section("Teams — Recent Chats", _teams_html(teams))}
  </div>

  {_section("Email Volume — Last 7 Days", _bar_chart(vol[-7:] if vol else [], "date", "count"))}

  <div class="footer">
    Director Assistant · <a href="/api/dashboard">Refresh</a> ·
    Auto-refreshes every 30 min · Next in <span id="countdown2"></span>
    <script>
      document.getElementById('countdown2').textContent =
        document.getElementById('countdown').textContent;
      setInterval(()=>{{
        document.getElementById('countdown2').textContent =
          document.getElementById('countdown').textContent;
      }},1000);
    </script>
  </div>
</div>

<!-- Detail Modal -->
<div class="modal-bg" id="modal-bg">
  <div class="modal">
    <button class="modal-close" onclick="closeModal()">×</button>
    <h3 id="modal-title"></h3>
    <div id="modal-body"></div>
    {AI_MODAL_HTML}
  </div>
</div>
"""

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Director Assistant — Dashboard</title>
<style>{_CSS}</style>
</head>
<body>{body}<script>{_JS}</script></body>
</html>"""
