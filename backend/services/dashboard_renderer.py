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
h2{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;
   color:#8b949e;margin-bottom:12px;padding-bottom:6px;border-bottom:1px solid #21262d;
   display:flex;align-items:center;gap:8px}
.wrap{max-width:1360px;margin:0 auto;padding:20px 24px}
.hdr{display:flex;justify-content:space-between;align-items:flex-end;
     margin-bottom:24px;padding-bottom:16px;border-bottom:1px solid #21262d}
.hdr-left h1{font-size:22px;font-weight:700;color:#f0f6fc}
.hdr-left .sub{color:#8b949e;font-size:13px;margin-top:3px}
.hdr-right{text-align:right;font-size:12px;color:#6e7681}
.hint{margin-top:4px;font-size:11px;color:#484f58}
/* KPI */
.kpi{display:grid;grid-template-columns:repeat(7,1fr);gap:10px;margin-bottom:20px}
@media(max-width:1100px){.kpi{grid-template-columns:repeat(4,1fr)}}
@media(max-width:700px){.kpi{grid-template-columns:repeat(2,1fr)}}
.kpi-tile{background:#161b22;border:1px solid #21262d;border-radius:10px;
          padding:14px 16px;cursor:default;transition:border-color .15s}
.kpi-tile:hover{border-color:#58a6ff}
.kpi-tile .val{font-size:30px;font-weight:800;line-height:1}
.kpi-tile .lbl{font-size:11px;color:#8b949e;margin-top:5px;font-weight:500}
.kpi-tile .sub-lbl{font-size:10px;color:#484f58;margin-top:2px}
.red .val{color:#f85149}.yellow .val{color:#d29922}
.green .val{color:#3fb950}.blue .val{color:#58a6ff}
.purple .val{color:#bc8cff}.teal .val{color:#39d353}.orange .val{color:#e8912d}
/* Urgent */
.urgent{background:#160d00;border:1px solid #5a3a00;border-radius:10px;
        padding:14px 18px;margin-bottom:20px}
.urgent h2{color:#e8912d;border-color:#5a3a00}
.urgent-items{display:flex;flex-wrap:wrap;gap:8px}
.u-tag{background:#1f1200;border:1px solid #6e4900;border-radius:6px;
       padding:5px 12px;font-size:12px;color:#e8912d;cursor:pointer;transition:background .15s}
.u-tag:hover{background:#2d1a00;border-color:#e8912d}
/* Alert */
.alert-row{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:20px}
.alert-card{background:#1a0a1a;border:1px solid #5a1a5a;border-radius:10px;
            padding:12px 16px;cursor:pointer;transition:border-color .15s;min-width:200px}
.alert-card:hover{border-color:#bc8cff}
.alert-card .a-label{font-size:11px;color:#bc8cff;font-weight:700;text-transform:uppercase;letter-spacing:.08em}
.alert-card .a-name{font-size:13px;font-weight:600;color:#e6edf3;margin-top:2px}
.alert-card .a-meta{font-size:11px;color:#8b949e;margin-top:2px}
.alert-dot{width:8px;height:8px;border-radius:50%;background:#bc8cff;display:inline-block;
           margin-right:6px;animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
/* Grid */
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px}
.grid3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-bottom:16px}
@media(max-width:900px){.grid2,.grid3{grid-template-columns:1fr}}
.card{background:#161b22;border:1px solid #21262d;border-radius:10px;padding:16px}
/* Lists */
.item-list{list-style:none}
.item-list li{padding:8px 6px;border-bottom:1px solid #21262d;font-size:13px;
              cursor:pointer;transition:all .12s;border-radius:6px}
.item-list li:last-child{border:none}
.item-list li:hover{background:#1c2128;padding-left:10px}
.badge{display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;margin-left:6px}
.bdg-red{background:#2d1111;color:#ff7b72}.bdg-yellow{background:#2d2207;color:#d29922}
.bdg-green{background:#0d2a0d;color:#3fb950}.bdg-blue{background:#0a1929;color:#58a6ff}
.bdg-orange{background:#2d1900;color:#e8912d}.bdg-purple{background:#1a0d2d;color:#bc8cff}
.meta{font-size:11px;color:#6e7681;margin-top:2px}
/* Charts */
.bar-chart{margin-top:6px}
.bar-row{display:flex;align-items:center;gap:8px;margin-bottom:6px}
.bar-lbl{width:80px;font-size:11px;color:#8b949e;text-align:right;flex-shrink:0;
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
/* Projects */
.proj-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px}
.proj-card{background:#0d1117;border:1px solid #21262d;border-radius:8px;padding:12px;
           cursor:pointer;transition:border-color .15s}
.proj-card:hover{border-color:#58a6ff}
.proj-card .pname{font-weight:600;font-size:13px;color:#e6edf3;margin-bottom:4px;
                  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.proj-card .pmeta{font-size:11px;color:#8b949e}
.proj-card .pstatus{font-size:10px;font-weight:700;text-transform:uppercase;
                    letter-spacing:.06em;margin-bottom:6px}
.status-active{color:#3fb950}.status-paused{color:#d29922}
/* Calendar */
.evt{padding:8px 6px;border-bottom:1px solid #21262d;cursor:pointer;border-radius:6px;
     transition:all .12s}
.evt:last-child{border:none}
.evt:hover{background:#1c2128;padding-left:10px}
.evt-time{font-size:11px;color:#6e7681;min-width:44px;display:inline-block}
.evt-title{font-weight:500}
.evt-org{font-size:11px;color:#8b949e;margin-top:2px}
/* Chase */
.chase-item{padding:8px 6px;border-bottom:1px solid #21262d;cursor:pointer;
            border-radius:6px;transition:all .12s}
.chase-item:hover{background:#1c2128;padding-left:10px}
.chase-item:last-child{border:none}
.chase-days-7{color:#d29922}.chase-days-14{color:#f85149}
/* VIP */
.vip-item{display:flex;align-items:center;gap:10px;padding:8px 6px;
          border-bottom:1px solid #21262d;cursor:pointer;border-radius:6px;
          transition:all .12s}
.vip-item:hover{background:#1c2128;padding-left:10px}
.vip-item:last-child{border:none}
.vip-avatar{width:32px;height:32px;border-radius:50%;background:#1f6feb;
            display:flex;align-items:center;justify-content:center;
            font-size:12px;font-weight:700;flex-shrink:0}
.vip-awaiting{background:#5a1a00}
/* Modal */
.modal-bg{display:none;position:fixed;inset:0;background:rgba(0,0,0,.8);z-index:1000;
          align-items:center;justify-content:center;padding:20px}
.modal-bg.open{display:flex}
.modal{background:#161b22;border:1px solid #30363d;border-radius:14px;max-width:700px;
       width:100%;max-height:85vh;overflow-y:auto;padding:28px;position:relative}
.modal h3{font-size:17px;font-weight:700;color:#f0f6fc;margin-bottom:16px;padding-right:32px}
.modal-actions{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px;
               padding-bottom:14px;border-bottom:1px solid #21262d}
.btn{padding:6px 14px;border-radius:6px;font-size:12px;font-weight:600;
     cursor:pointer;border:none;transition:opacity .15s}
.btn:hover{opacity:.85}
.btn-blue{background:#1f6feb;color:#fff}
.btn-gray{background:#21262d;color:#e6edf3}
.btn-green{background:#238636;color:#fff}
.modal .detail-row{margin-bottom:10px;font-size:13px}
.modal .detail-label{color:#8b949e;font-size:11px;text-transform:uppercase;
                     letter-spacing:.06em;margin-bottom:3px;font-weight:600}
.modal .detail-body{color:#e6edf3;white-space:pre-wrap;word-break:break-word;
                    max-height:320px;overflow-y:auto;background:#0d1117;
                    border-radius:8px;padding:12px;font-size:12px;line-height:1.7;
                    border:1px solid #21262d}
.modal-close{position:absolute;top:18px;right:18px;background:none;border:none;
             color:#8b949e;font-size:22px;cursor:pointer;line-height:1}
.modal-close:hover{color:#f0f6fc}
.footer{margin-top:32px;padding-top:16px;border-top:1px solid #21262d;
        font-size:11px;color:#484f58;text-align:center}
"""

_CSS += AI_CSS

_JS = f"""
let currentCtx='';
const bg=document.getElementById('modal-bg');
const mTitle=document.getElementById('modal-title');
const mBody=document.getElementById('modal-body');
const mActions=document.getElementById('modal-actions');

function showModal(title, rows, opts){{
  opts = opts || {{}};
  mTitle.textContent = title;
  mBody.innerHTML = rows.map(([lbl,val]) =>
    '<div class="detail-row"><div class="detail-label">' + lbl + '</div>' +
    '<div class="detail-body">' + val + '</div></div>'
  ).join('');
  currentCtx = title + '\\n' + rows.map(([l,v]) => l+': '+v).join('\\n');

  // Build action buttons
  let btns = '';
  if(opts.emailId) {{
    btns += '<a href="/" class="btn btn-blue" onclick="sessionStorage.setItem(\'openEmail\',\''+opts.emailId+'\');return false;" target="_self">Open in App</a>';
  }}
  if(opts.replyTo) {{
    btns += '<a href="mailto:'+opts.replyTo+'" class="btn btn-gray">Reply by Email</a>';
  }}
  if(opts.actionId) {{
    btns += '<button class="btn btn-green" onclick="markDone('+opts.actionId+',this)">✓ Mark Done</button>';
  }}
  mActions.innerHTML = btns;
  mActions.style.display = btns ? 'flex' : 'none';

  const o=document.getElementById('ai-out'), i=document.getElementById('ai-input');
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

function markDone(id, btn){{
  fetch('/api/actions/'+id, {{method:'PATCH',headers:{{'Content-Type':'application/json'}},body:JSON.stringify({{done:true}})}})
    .then(()=>{{btn.textContent='✓ Done!';btn.disabled=true;btn.style.opacity='.5';}})
    .catch(()=>{{btn.textContent='Failed';}});
}}

document.querySelectorAll('[data-modal]').forEach(el=>{{
  el.addEventListener('click',()=>{{
    const d=JSON.parse(el.dataset.modal);
    showModal(d.title, d.rows, d.opts||{{}});
  }});
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
    return _html.escape(str(s), quote=True)


def _modal_attr(title: str, rows: list[tuple[str, str]], opts: dict | None = None) -> str:
    import json
    payload = {"title": title, "rows": rows}
    if opts:
        payload["opts"] = opts
    return f' data-modal=\'{_html.escape(json.dumps(payload), quote=True)}\''


def _kpi_tile(val: str | int, label: str, cls: str = "", sub: str = "") -> str:
    sub_html = f'<div class="sub-lbl">{_e(sub)}</div>' if sub else ""
    return (f'<div class="kpi-tile {cls}">'
            f'<div class="val">{val}</div>'
            f'<div class="lbl">{label}</div>{sub_html}</div>')


def _section(title: str, body: str, extra_class: str = "") -> str:
    return f'<div class="card {extra_class}"><h2>{title}</h2>{body}</div>'


def _urgent_banner(actions: list[dict], follow_ups: list[dict]) -> str:
    overdue = [a for a in actions if a.get("text")][:6]
    due_fup = [f for f in follow_ups if f.get("due_date", "9999") <= date.today().isoformat()][:4]
    if not overdue and not due_fup:
        return ""
    tags = "".join(
        f'<span class="u-tag"{_modal_attr(a["text"][:80], [("Action", a["text"]), ("Email", a.get("email_subject",""))], {"actionId": a.get("id")})}>{_e(a["text"][:80])}</span>'
        for a in overdue
    )
    tags += "".join(
        f'<span class="u-tag"{_modal_attr("Follow-up: "+f.get("subject","")[:60], [("Subject", f.get("subject","")), ("Sender", f.get("sender","")), ("Due", f.get("due_date",""))], {"replyTo": f.get("sender","")})}>'
        f'Follow-up: {_e(f.get("subject","")[:60])}</span>'
        for f in due_fup
    )
    return (f'<div class="urgent"><h2>⚠ Needs Attention Today</h2>'
            f'<div class="urgent-items">{tags}</div></div>')


def _vip_alert_row(vips: list[dict]) -> str:
    at_risk = [v for v in vips if v.get("awaiting_reply") or v.get("unread", 0) > 0]
    if not at_risk:
        return ""
    cards = ""
    for v in at_risk[:6]:
        name = v.get("name") or v.get("email_addr", "")
        email = v.get("email_addr", "")
        initials = "".join(p[0].upper() for p in name.split()[:2]) or email[0].upper()
        status = "Awaiting your reply" if v.get("awaiting_reply") else f"{v.get('unread',0)} unread"
        last = v.get("last_received", "") or "—"
        modal = _modal_attr(name, [
            ("Email", email), ("Status", status),
            ("Last contact", last), ("Received", str(v.get("emails_received", 0))),
            ("Sent to", str(v.get("emails_sent_to", 0))), ("Note", v.get("note", "—")),
        ], {"replyTo": email})
        cards += (f'<div class="alert-card"{modal}>'
                  f'<div class="a-label"><span class="alert-dot"></span>VIP Alert</div>'
                  f'<div class="a-name">{_e(name[:30])}</div>'
                  f'<div class="a-meta">{_e(status)} · {_e(last)}</div></div>')
    if not cards:
        return ""
    return f'<div class="alert-row">{cards}</div>'


def _chase_list(chase: list[dict]) -> str:
    if not chase:
        return "<p style='color:#3fb950;font-size:13px'>No follow-ups pending.</p>"
    items = []
    for e in chase[:8]:
        subj = (e.get("subject") or "(no subject)")[:70]
        recipient = e.get("recipient") or e.get("sender", "")
        days = e.get("days_waiting", 0)
        badge_cls = "bdg-red" if days >= 14 else "bdg-yellow" if days >= 7 else "bdg-blue"
        modal = _modal_attr(subj, [
            ("To", recipient), ("Days waiting", str(days)),
            ("Sent", (e.get("date") or "")[:10]),
        ], {"replyTo": recipient, "emailId": e.get("id", "")})
        items.append(
            f'<div class="chase-item"{modal}>'
            f'<div><b>{_e(subj)}</b>'
            f'<span class="badge {badge_cls}">{days}d</span></div>'
            f'<div class="meta">To: {_e(recipient[:40])}</div></div>'
        )
    return "".join(items)


def _vip_list(vips: list[dict]) -> str:
    if not vips:
        return "<p style='color:#6e7681;font-size:13px'>No VIP contacts added yet. Add them in the VIP tab.</p>"
    items = []
    for v in vips[:8]:
        name = v.get("name") or v.get("email_addr", "")
        email = v.get("email_addr", "")
        initials = "".join(p[0].upper() for p in name.split()[:2]) or email[0].upper()
        awaiting = v.get("awaiting_reply", False)
        unread = v.get("unread", 0)
        last = v.get("last_received", "") or "—"
        avatar_style = "vip-awaiting" if awaiting else ""
        badge = f'<span class="badge bdg-orange">reply needed</span>' if awaiting else \
                f'<span class="badge bdg-blue">{unread} unread</span>' if unread > 0 else ""
        modal = _modal_attr(name, [
            ("Email", email), ("Last received", last), ("Emails received", str(v.get("emails_received", 0))),
            ("Emails sent to", str(v.get("emails_sent_to", 0))), ("Last sent to", v.get("last_sent_to", "—")),
            ("Note", v.get("note", "—")),
        ], {"replyTo": email})
        items.append(
            f'<div class="vip-item"{modal}>'
            f'<div class="vip-avatar {avatar_style}">{_e(initials)}</div>'
            f'<div style="flex:1;min-width:0">'
            f'<div><b>{_e(name[:30])}</b>{badge}</div>'
            f'<div class="meta">{_e(email[:40])} · {_e(last)}</div>'
            f'</div></div>'
        )
    return "".join(items)


def _user_projects_html(projects: list[dict]) -> str:
    if not projects:
        return "<p style='color:#6e7681;font-size:13px'>No projects yet. Create one in the Projects tab.</p>"
    cards = ""
    for p in projects[:9]:
        status = p.get("status", "active")
        status_cls = f"status-{status}"
        email_count = p.get("email_count", 0)
        desc = (p.get("description") or "")[:60]
        modal = _modal_attr(p["name"], [
            ("Status", status), ("Emails linked", str(email_count)),
            ("Description", desc or "—"), ("Created", (p.get("created_at") or "")[:10]),
        ])
        cards += (f'<div class="proj-card"{modal}>'
                  f'<div class="pstatus {status_cls}">{status}</div>'
                  f'<div class="pname" title="{_e(p["name"])}">{_e(p["name"][:35])}</div>'
                  f'<div class="pmeta">{email_count} email{"s" if email_count!=1 else ""}'
                  f'{" · "+_e(desc) if desc else ""}</div></div>')
    return f'<div class="proj-grid">{cards}</div>'


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
        attendees_str = ", ".join(
            a.get("emailAddress", {}).get("address", "")
            for a in (e.get("attendees") or [])
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
        return "<p style='color:#3fb950;font-size:13px'>Inbox zero! 🎉</p>"
    items = []
    for e in emails[:10]:
        subj   = (e.get("subject") or "(no subject)")[:72]
        sender = e.get("sender", "")
        d      = (e.get("date") or "")[:10]
        body   = (e.get("body") or "").replace("\n", " ")
        eid    = e.get("id", "")
        modal  = _modal_attr(subj, [
            ("From", sender), ("Date", d), ("Preview", body[:800] or "—")
        ], {"emailId": eid, "replyTo": sender})
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
        aid = a.get("id")
        modal = _modal_attr(text[:80], [
            ("Action", text), ("Email", subj), ("Added", created)
        ], {"actionId": aid})
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
                             [("Subject", subj), ("From", sender), ("Due", due or "—"), ("Note", note or "—")],
                             {"replyTo": sender})
        mail = f'<a href="mailto:{_e(sender)}">{_e(sender[:40])}</a>' if "@" in (sender or "") else _e(sender)
        items.append(
            f'<li{modal}>{_e(subj[:60])}'
            f'<div class="meta">{mail}{"  ·  Due "+due if due else ""}</div></li>'
        )
    return f'<ul class="item-list">{"".join(items)}</ul>'


def _training_list(items: list[dict]) -> str:
    if not items:
        return "<p style='color:#6e7681;font-size:13px'>No training emails found.</p>"
    rows = []
    for i in items:
        subj   = (i.get("subject") or "")
        sender = i.get("sender", "")
        d      = (i.get("date") or "")[:10]
        eid    = i.get("id", "")
        modal  = _modal_attr(subj[:70] or "Training", [("Subject", subj), ("From", sender), ("Date", d)], {"emailId": eid})
        rows.append(
            f'<li{modal}>{_e(subj[:70])}'
            f'<div class="meta">{_e(sender[:40])} · {d}</div></li>'
        )
    return f'<ul class="item-list">{"".join(rows)}</ul>'


# ── Main renderer ─────────────────────────────────────────────────────────────

def render_dashboard(d: dict) -> str:
    actions      = d.get("actions", [])
    follow_ups   = d.get("follow_ups", [])
    unread       = d.get("unread_count", 0)
    emails       = d.get("unread_emails", [])
    projects     = d.get("projects", [])
    user_projects= d.get("user_projects", [])
    vips         = d.get("vip_contacts", [])
    chase        = d.get("chase_queue", [])
    training     = d.get("training", [])
    cal_today    = d.get("calendar_today", [])
    wk_cal       = d.get("week_calendar", [])
    senders      = d.get("top_senders", [])
    vol          = d.get("email_volume", [])
    gen_at       = d.get("generated_at", "")
    onedrive     = d.get("onedrive", [])
    teams        = d.get("teams", [])

    overdue_count  = len(actions)
    mtgs_tomorrow  = len(cal_today)
    chase_count    = len(chase)
    vip_alert_count= len([v for v in vips if v.get("awaiting_reply") or v.get("unread", 0) > 0])
    proj_count     = len(user_projects)

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
    vip_alerts  = _vip_alert_row(vips)

    body = f"""
<div class="wrap">
  <div class="hdr">
    <div class="hdr-left">
      <h1>Director Assistant — Executive Brief</h1>
      <div class="sub">{_e(gen_at)}</div>
      <div class="hint">Click any item to see full detail · <a href="/">← Back to App</a></div>
    </div>
    <div class="hdr-right">
      <div style="font-size:13px">Auto-refreshes in <span id="countdown" style="color:#58a6ff">30m 0s</span></div>
      <div class="hint"><a href="/api/dashboard">Refresh now</a></div>
    </div>
  </div>

  <!-- KPI Tiles -->
  <div class="kpi">
    {_kpi_tile(overdue_count, "Open Actions", "red" if overdue_count else "green", "needs attention")}
    {_kpi_tile(unread, "Unread Emails", "yellow" if unread > 20 else "green", "in your inbox")}
    {_kpi_tile(chase_count, "Chase Queue", "orange" if chase_count else "green", "no reply received")}
    {_kpi_tile(vip_alert_count, "VIP Alerts", "purple" if vip_alert_count else "green", "need attention")}
    {_kpi_tile(mtgs_tomorrow, "Meetings Tomorrow", "blue", "on your calendar")}
    {_kpi_tile(proj_count, "Active Projects", "teal", "in project tracker")}
    {_kpi_tile(len(vips), "VIP Contacts", "purple", "being tracked")}
  </div>

  {urgent_html}
  {vip_alerts}

  <!-- Row 1: Schedule + Follow-ups -->
  <div class="grid2">
    {_section("📅 Tomorrow's Schedule", _schedule_section(cal_today))}
    {_section("📬 Follow-ups Due", _follow_up_list(follow_ups))}
  </div>

  <!-- Row 2: Chase Queue + VIP Contacts -->
  <div class="grid2">
    {_section("⏰ Chase Queue — No Reply", _chase_list(chase))}
    {_section("⭐ VIP Contact Status", _vip_list(vips))}
  </div>

  <!-- Row 3: User Projects -->
  {_section("📁 Your Projects", _user_projects_html(user_projects))}

  <!-- Row 4: Calendar + Time allocation -->
  <div class="grid2" style="margin-top:0">
    {_section("📊 Week Calendar Load", _week_bar_chart(wk_cal) if wk_cal else _bar_chart(vol[-7:] if vol else [], "date", "count"))}
    {_section("🕐 Time Allocation This Week", _doughnut(alloc_cats))}
  </div>

  <!-- Row 5: Unread emails + Actions -->
  <div class="grid2">
    {_section("📩 Unread Emails", _email_list(emails))}
    {_section("✅ Action Items", _action_list(actions))}
  </div>

  <!-- Row 6: Training + Senders -->
  <div class="grid2">
    {_section("🎓 Training & Learning", _training_list(training))}
    {_section("👤 Top Senders This Week", _bar_chart([dict(label=s["sender"],count=s["count"]) for s in senders[:7]], "label", "count"))}
  </div>

  <!-- Row 7: OneDrive + Teams -->
  <div class="grid2">
    {_section("📂 OneDrive — Recent Files", _onedrive_html(onedrive))}
    {_section("💬 Teams — Recent Chats", _teams_html(teams))}
  </div>

  {_section("📈 Email Volume — Last 7 Days", _bar_chart(vol[-7:] if vol else [], "date", "count"))}

  <div class="footer">
    Director Assistant · <a href="/api/dashboard">Refresh</a> ·
    Auto-refreshes every 30 min · Next in <span id="countdown2"></span>
    <script>
      document.getElementById('countdown2').textContent =
        document.getElementById('countdown').textContent;
      setInterval(()=>{{document.getElementById('countdown2').textContent=document.getElementById('countdown').textContent;}},1000);
    </script>
  </div>
</div>

<!-- Detail Modal -->
<div class="modal-bg" id="modal-bg">
  <div class="modal">
    <button class="modal-close" onclick="closeModal()">×</button>
    <h3 id="modal-title"></h3>
    <div class="modal-actions" id="modal-actions" style="display:none"></div>
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
