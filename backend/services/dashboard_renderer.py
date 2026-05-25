"""
Renders the executive dashboard as a self-contained HTML string.
No external libraries — pure CSS charts (bars + conic-gradient doughnut).
"""

from __future__ import annotations

from datetime import date, timedelta


# ── Shared CSS ────────────────────────────────────────────────────────────────

_CSS = """
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
     background:#0d1117;color:#e6edf3;font-size:14px;line-height:1.6}
a{color:#79c0ff;text-decoration:none}a:hover{text-decoration:underline}
h2{font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;
   color:#8b949e;margin-bottom:10px;padding-bottom:6px;border-bottom:1px solid #21262d}
.wrap{max-width:1280px;margin:0 auto;padding:20px 24px}

/* Header */
.hdr{display:flex;justify-content:space-between;align-items:flex-end;
     margin-bottom:24px;padding-bottom:16px;border-bottom:1px solid #21262d}
.hdr-left h1{font-size:22px;font-weight:700;color:#f0f6fc}
.hdr-left .sub{color:#8b949e;font-size:13px;margin-top:3px}
.hdr-right{text-align:right;font-size:12px;color:#6e7681}
.hint{margin-top:4px;font-size:11px;color:#484f58}

/* KPI strip */
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

/* Urgent banner */
.urgent{background:#1a0d0d;border:1px solid #6e1a1a;border-radius:8px;
        padding:14px 18px;margin-bottom:20px}
.urgent h2{color:#f85149;border-color:#6e1a1a}
.urgent-items{display:flex;flex-wrap:wrap;gap:8px}
.u-tag{background:#2d1111;border:1px solid #8b1a1a;border-radius:5px;
       padding:4px 10px;font-size:12px;color:#ff7b72}

/* Two-column grid */
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px}
@media(max-width:800px){.grid2{grid-template-columns:1fr}}
.card{background:#161b22;border:1px solid #21262d;border-radius:8px;padding:16px}

/* Lists */
.item-list{list-style:none}
.item-list li{padding:7px 0;border-bottom:1px solid #21262d;font-size:13px}
.item-list li:last-child{border:none}
.badge{display:inline-block;padding:1px 7px;border-radius:4px;font-size:11px;
       font-weight:600;margin-left:6px}
.bdg-red{background:#2d1111;color:#ff7b72}
.bdg-yellow{background:#2d2207;color:#d29922}
.bdg-green{background:#0d2a0d;color:#3fb950}
.bdg-blue{background:#0a1929;color:#58a6ff}
.meta{font-size:11px;color:#6e7681;margin-top:2px}

/* CSS bar chart */
.bar-chart{margin-top:6px}
.bar-row{display:flex;align-items:center;gap:8px;margin-bottom:6px}
.bar-lbl{width:48px;font-size:11px;color:#8b949e;text-align:right;flex-shrink:0}
.bar-track{flex:1;background:#21262d;border-radius:3px;height:18px;overflow:hidden}
.bar-fill{height:100%;border-radius:3px;
          background:linear-gradient(90deg,#1f6feb,#58a6ff);
          transition:width .3s}
.bar-val{width:28px;font-size:11px;color:#8b949e;flex-shrink:0}

/* Doughnut */
.donut-wrap{display:flex;align-items:center;gap:24px;margin-top:8px}
.donut{width:120px;height:120px;border-radius:50%;flex-shrink:0;position:relative}
.donut::after{content:'';position:absolute;top:25%;left:25%;width:50%;height:50%;
              background:#161b22;border-radius:50%}
.donut-legend{flex:1}
.legend-row{display:flex;align-items:center;gap:8px;margin-bottom:5px;font-size:12px}
.legend-dot{width:10px;height:10px;border-radius:50%;flex-shrink:0}

/* Projects */
.proj-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px}
.proj-card{background:#0d1117;border:1px solid #21262d;border-radius:6px;padding:12px}
.proj-card .pname{font-weight:600;font-size:13px;color:#e6edf3;margin-bottom:4px;
                  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.proj-card .pnext{font-size:12px;color:#8b949e}

/* Schedule */
.evt{padding:8px 0;border-bottom:1px solid #21262d}
.evt:last-child{border:none}
.evt-time{font-size:11px;color:#6e7681;min-width:80px;display:inline-block}
.evt-title{font-weight:500}
.evt-org{font-size:11px;color:#8b949e;margin-top:2px}
.conflict{color:#f85149;font-size:11px;margin-left:6px}

/* Footer */
.footer{margin-top:32px;padding-top:16px;border-top:1px solid #21262d;
        font-size:11px;color:#484f58;text-align:center}
"""


# ── Section builders ──────────────────────────────────────────────────────────

def _kpi_tile(val: str | int, label: str, cls: str = "") -> str:
    return (f'<div class="kpi-tile {cls}">'
            f'<div class="val">{val}</div>'
            f'<div class="lbl">{label}</div></div>')


def _section(title: str, body: str, extra_class: str = "") -> str:
    return f'<div class="card {extra_class}"><h2>{title}</h2>{body}</div>'


def _urgent_banner(actions: list[dict], follow_ups: list[dict]) -> str:
    overdue = [a for a in actions if a.get("text")][:6]
    due_fup  = [f for f in follow_ups if f.get("due_date", "9999") <= date.today().isoformat()][:4]
    if not overdue and not due_fup:
        return ""
    tags = "".join(f'<span class="u-tag">{a["text"][:80]}</span>' for a in overdue)
    tags += "".join(
        f'<span class="u-tag">Follow-up: {f.get("subject","")[:60]}</span>' for f in due_fup
    )
    return (
        f'<div class="urgent"><h2>Needs Attention Today</h2>'
        f'<div class="urgent-items">{tags}</div></div>'
    )


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
        if resp == "declined":
            badge = '<span class="badge bdg-red">Declined</span>'
        elif resp == "tentativelyaccepted":
            badge = '<span class="badge bdg-yellow">Tentative</span>'
        elif resp == "accepted":
            badge = '<span class="badge bdg-green">Accepted</span>'
        rows.append(
            f'<div class="evt"><span class="evt-time">{t}</span>'
            f'<span class="evt-title">{subj}</span>{badge}'
            f'{"<div class=evt-org>"+org+"</div>" if org else ""}</div>'
        )
    return "".join(rows)


def _bar_chart(data: list[dict], label_key: str, value_key: str) -> str:
    if not data:
        return "<p style='color:#6e7681;font-size:12px'>No data</p>"
    max_val = max((d[value_key] for d in data), default=1) or 1
    rows = []
    for d in data:
        lbl = str(d[label_key])[-5:]
        val = d[value_key]
        pct = int(val / max_val * 100)
        rows.append(
            f'<div class="bar-row">'
            f'<span class="bar-lbl">{lbl}</span>'
            f'<div class="bar-track"><div class="bar-fill" style="width:{pct}%"></div></div>'
            f'<span class="bar-val">{val}</span></div>'
        )
    return f'<div class="bar-chart">{"".join(rows)}</div>'


def _week_bar_chart(week_events: list[dict]) -> str:
    """Build 7-day bar chart from calendar events or email volume."""
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
    """categories: list of (label, percent, color_hex)"""
    total = sum(p for _, p, _ in categories) or 1
    normalized = [(lbl, round(p / total * 100), col) for lbl, p, col in categories]
    # conic-gradient stops
    stops, pos = [], 0
    for _, pct, col in normalized:
        stops.append(f"{col} {pos}% {pos + pct}%")
        pos += pct
    gradient = ", ".join(stops)
    legend = "".join(
        f'<div class="legend-row">'
        f'<div class="legend-dot" style="background:{col}"></div>'
        f'<span>{lbl} <b>{pct}%</b></span></div>'
        for lbl, pct, col in normalized
    )
    return (
        f'<div class="donut-wrap">'
        f'<div class="donut" style="background:conic-gradient({gradient})"></div>'
        f'<div class="donut-legend">{legend}</div></div>'
    )


def _email_list(emails: list[dict]) -> str:
    if not emails:
        return "<p style='color:#6e7681;font-size:13px'>Inbox zero!</p>"
    items = []
    for e in emails[:10]:
        subj   = (e.get("subject") or "(no subject)")[:72]
        sender = e.get("sender", "")[:40]
        d      = (e.get("date") or "")[:10]
        body   = (e.get("body") or "")[:100].replace("\n", " ")
        items.append(
            f'<li><b>{subj}</b>'
            f'<div class="meta">{sender} · {d}</div>'
            f'{"<div class=meta>"+body+"</div>" if body else ""}</li>'
        )
    return f'<ul class="item-list">{"".join(items)}</ul>'


def _action_list(actions: list[dict]) -> str:
    if not actions:
        return "<p style='color:#3fb950;font-size:13px'>No open actions.</p>"
    items = []
    for a in actions[:15]:
        text = (a.get("text") or "")[:90]
        subj = (a.get("email_subject") or "")[:50]
        items.append(
            f'<li>{text}'
            f'{"<div class=meta>From: "+subj+"</div>" if subj else ""}</li>'
        )
    return f'<ul class="item-list">{"".join(items)}</ul>'


def _follow_up_list(follow_ups: list[dict]) -> str:
    if not follow_ups:
        return "<p style='color:#6e7681;font-size:13px'>No pending follow-ups.</p>"
    items = []
    for f in follow_ups[:10]:
        subj   = (f.get("subject") or "")[:60]
        sender = f.get("sender", "")
        due    = f.get("due_date", "")
        mail   = f'<a href="mailto:{sender}" title="Email">{sender}</a>' if "@" in (sender or "") else sender
        items.append(
            f'<li>{subj}'
            f'<div class="meta">{mail}'
            f'{"  ·  Due "+due if due else ""}</div></li>'
        )
    return f'<ul class="item-list">{"".join(items)}</ul>'


def _projects_html(projects: list[dict]) -> str:
    if not projects:
        return "<p style='color:#6e7681;font-size:13px'>No project signals detected.</p>"
    cards = "".join(
        f'<div class="proj-card">'
        f'<div class="pname" title="{p["name"]}">{p["name"][:40]}</div>'
        f'<div class="pnext">Next: {p.get("next","—")}</div></div>'
        for p in projects
    )
    return f'<div class="proj-grid">{cards}</div>'


def _training_list(items: list[dict]) -> str:
    if not items:
        return "<p style='color:#6e7681;font-size:13px'>No training emails found.</p>"
    rows = "".join(
        f'<li>{(i.get("subject") or "")[:70]}'
        f'<div class="meta">{i.get("sender","")[:40]} · {(i.get("date") or "")[:10]}</div></li>'
        for i in items
    )
    return f'<ul class="item-list">{rows}</ul>'


# ── Main renderer ─────────────────────────────────────────────────────────────

def render_dashboard(d: dict) -> str:
    actions   = d.get("actions", [])
    follow_ups = d.get("follow_ups", [])
    unread    = d.get("unread_count", 0)
    emails    = d.get("unread_emails", [])
    projects  = d.get("projects", [])
    training  = d.get("training", [])
    cal_today = d.get("calendar_today", [])
    wk_cal    = d.get("week_calendar", [])
    senders   = d.get("top_senders", [])
    vol       = d.get("email_volume", [])
    gen_at    = d.get("generated_at", "")

    overdue_count = len(actions)
    mtgs_tomorrow = len(cal_today)

    # Time allocation — derive from week_calendar categories or use placeholders
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

    body = f"""
<div class="wrap">
  <!-- Header -->
  <div class="hdr">
    <div class="hdr-left">
      <h1>Director Assistant — Executive Brief</h1>
      <div class="sub">{gen_at}</div>
      <div class="hint">Click any item to act · Refresh: <code>GET /api/dashboard</code></div>
    </div>
    <div class="hdr-right">
      <div>Last refreshed: {gen_at}</div>
      <div class="hint">Scroll down for all sections</div>
    </div>
  </div>

  <!-- KPI Strip -->
  <div class="kpi">
    {_kpi_tile(overdue_count, "Overdue Actions", "red" if overdue_count else "green")}
    {_kpi_tile(unread, "Unread Emails", "yellow" if unread > 20 else "green")}
    {_kpi_tile(mtgs_tomorrow, "Meetings Tomorrow", "blue")}
    {_kpi_tile("—", "Teams Unread", "purple")}
    {_kpi_tile(len(projects), "Active Projects", "teal")}
    {_kpi_tile("—", "OOF This Week", "blue")}
  </div>

  <!-- Urgent Banner -->
  {urgent_html}

  <!-- Row: Schedule + Prep Notes -->
  <div class="grid2">
    {_section("Tomorrow's Schedule", _schedule_section(cal_today))}
    {_section("People to Follow Up With", _follow_up_list(follow_ups))}
  </div>

  <!-- Top Projects -->
  {_section("Top Active Projects", _projects_html(projects))}

  <!-- Row: Week Load + Time Allocation -->
  <div class="grid2" style="margin-top:16px">
    {_section("Week Calendar Load", _week_bar_chart(wk_cal) if wk_cal else _bar_chart(vol[-7:] if vol else [], "date", "count"))}
    {_section("Time Allocation This Week", _doughnut(alloc_cats))}
  </div>

  <!-- Row: Emails + Actions -->
  <div class="grid2" style="margin-top:16px">
    {_section("Emails Needing a Reply", _email_list(emails))}
    {_section("Long-Term Action Items", _action_list(actions))}
  </div>

  <!-- Row: Training + OOF Radar -->
  <div class="grid2" style="margin-top:16px">
    {_section("Training & Learning", _training_list(training))}
    <div class="card">
      <h2>OOF Radar</h2>
      <p style="color:#6e7681;font-size:13px">
        Connect Microsoft 365 in Settings to see teammate out-of-office status.
      </p>
    </div>
  </div>

  <!-- Row: Teams + OneDrive -->
  <div class="grid2" style="margin-top:16px">
    <div class="card">
      <h2>Unread Teams Chats</h2>
      <p style="color:#6e7681;font-size:13px">
        Teams integration requires Microsoft Graph — connect in Settings.
      </p>
    </div>
    <div class="card">
      <h2>Recent Files in Flight</h2>
      <p style="color:#6e7681;font-size:13px">
        OneDrive file access requires Microsoft Graph — connect in Settings.
      </p>
    </div>
  </div>

  <!-- Email Volume (full width) -->
  {_section("Email Volume — Last 7 Days", _bar_chart(vol[-7:] if vol else [], "date", "count"))}

  <!-- Footer -->
  <div class="footer">
    Director Assistant · Dashboard refreshes each time you visit
    <code>/api/dashboard</code> · Output also saved to <code>output/dashboard.html</code>
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
<body>{body}</body>
</html>"""
