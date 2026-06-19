# Director Assistant

> **Your AI-powered executive email intelligence platform.** Connects to Gmail, Microsoft 365, Yahoo, or any IMAP mailbox and uses Claude AI to help you triage faster, never miss a commitment, and stay on top of every relationship that matters.

**Current version: 3.40.0** · [Releases](https://github.com/asalamat/director-assistant/releases) · MIT License

---

## What it does

Director Assistant sits alongside your email client and turns raw email volume into structured intelligence — surfacing what needs your attention, drafting replies in your voice, tracking commitments automatically, and giving you a weekly executive brief that would otherwise take hours to compile.

Everything runs **locally on your machine**. Your emails never leave your device except for AI queries (which are sent to Anthropic or OpenAI over encrypted connections).

---

## Navigation

| Tab | Description |
|-----|-------------|
| **Inbox** | Browse, search, and action your emails with AI-powered priority labels, thread view, smart sort, unread filter, and bulk operations |
| **Focus** | Smart Daily Triage — AI scores all unread emails by 7 urgency signals and surfaces your top priority items with score badges and reason tags |
| **Ask** | Natural-language Q&A over your entire email, document, and **contact notes** history using hybrid semantic + full-text search — results show source badges (Email / Document / Contact) |
| **Actions** | AI-extracted commitments and follow-ups with overdue tracking, **Delegations** tab for forwarded-to-colleague tracking, and **Overnight** tab for morning review of AI-drafted replies |
| **VIP** | Track your most important contacts with live stats: last contact, unread count, awaiting-reply flag, and full email history |
| **Brief** | Daily AI digest of your most important recent emails, configurable date range |
| **Health** | Live system status — IMAP connection, AI provider, RAG database, polling loop |
| **Knowledge** | Hub with left sidebar navigation containing 10 sub-sections across two groups: |
| ↳ Intelligence | Role Briefing · People Graph · Open Loops · AI Clusters · Topic Timeline |
| ↳ Tools | Weekly Brief · Chase Queue · Projects Tracker · **🎙 Meetings** · **💼 CRM** · **📋 Board Report** · **🎯 Coaching** · Analytics · Templates · PST/OLM Import |
| **Dashboard** | Full-screen executive brief at `/api/dashboard` — 7 KPI tiles, VIP alerts, Chase Queue, Projects, calendar, actions, and live action buttons |

---

## Feature Highlights

### Inbox & Email Management
- **Unread filter** — click the "N unread" badge to see all unread emails across all folders instantly; click again to return
- **Hover AI preview** — hover over any email for 600ms to see a 1-sentence AI summary without opening it
- **Priority auto-labels** — emails automatically tagged `urgent`, `action`, or `finance` based on subject and preview
- **Smart sort** — sort by date, sender, subject (asc/desc) or switch to AI urgency score ranking
- **Thread depth indicator** — reply-chain depth shown on each email row
- **Pinned searches** — save any search query as a persistent smart folder
- **Bulk operations** — select multiple emails to delete, snooze, or generate AI draft replies for all at once
- **Read-time estimator** — each email shows an estimated read time (e.g. ~3m) so you triage by effort
- **"New" badge** — emails received in the last 4 hours show a green pill for instant visibility
- **Auto-poll** — new emails checked every 60 seconds in the background

### AI Reply & Drafting
- **Smart Draft Composer** — one click writes a complete, ready-to-send reply using the full thread history, related documents, and your own sent-mail writing style as a reference
- **Quick Replies** — generates Short, Detailed, and Formal reply options; click any to pre-fill the compose window
- **Tone Adjuster** — rewrite any compose text as formal / casual / shorter / friendlier / direct with one click
- **Commitment detection** — after Smart Draft, detected commitments appear as pills you can add directly to the Actions board
- **Bulk Draft Generation** — select multiple emails, generate AI drafts for all simultaneously
- **Save to Drafts** — save any AI reply directly to your IMAP Drafts folder, ready to review in your mail client
- **Smart Follow-up Drafts (Chase)** — AI writes a polite follow-up for any email awaiting a reply, one click to compose
- **Pre-send AI Review** — click "🔍 Review" in the compose window before sending; AI checks tone (good/warning/issue), flags unanswered questions from the original email, lists commitments you're making, and gives up to 3 improvement suggestions; Send button turns green when the draft passes review

### Send-Time Optimizer
- When composing a reply, a green hint appears: **"Best time to send: Tuesday at 9:00 AM"** — derived from the recipient's historical email activity patterns to maximize response rates

### VIP Contact Manager
- Star up to any number of contacts as VIPs
- Live stats: emails received/sent, last contact date, unread count, **awaiting reply** flag
- Browse all emails from/to that contact in one scrollable timeline
- Alerts surface automatically when a VIP hasn't heard from you in a while

### Email-to-Project Tracker
- Create named projects (deals, initiatives, hires, partnerships)
- Link any email to a project directly from the email viewer with one click
- Browse all linked emails in a project timeline
- Status cycling: Active → Paused → Resolved
- Filter projects by status with live counts

### Weekly Executive Brief
- One-click AI summary of the past 7 days: key decisions made, commitments, who you're waiting on, relationships to nurture, upcoming deadlines, wins, and top action items
- Each item shows **source email chips** — click any chip to open the exact email it came from
- Hover any item and click 🔍 to **find related emails** via semantic search
- Sections are collapsible; stats bar shows total received, sent, actions, and linked emails
- Generated using Claude Sonnet for depth; cached for 1 hour; force-refresh any time

### Executive Dashboard (`/api/dashboard`)
- Full-screen dark-theme dashboard with **7 live KPI tiles**: Open Actions, Unread Emails, Chase Queue, VIP Alerts, Meetings Tomorrow, Active Projects, VIP Contacts — **each tile is clickable** and scrolls directly to its section
- **4 new sections**: Chase Queue with urgency color-coding, VIP Contact Status with last-contact stats, Your Projects tracker, VIP Alert row with pulse animation
- **Click any item** → opens a detail modal with the full content plus context-specific action buttons:
  - **↗ Open in App** — navigates directly to the email in Director Assistant (deep-link via `/?email=ID`)
  - **✉ Reply by Email** — opens your mail client pre-addressed to the sender
  - **✓ Mark Done** — marks action items complete live without leaving the dashboard
  - **✎ Generate Follow-up Draft** — AI writes a chase email; shows editable textarea + Copy + Send via App
  - **▶ Join Meeting** — opens Teams/Zoom link for online calendar events
- Auto-refreshes every 30 minutes; accessible at `http://localhost:8000/api/dashboard`

### Smart Triage (Focus Tab)
- Scores all unread emails from the last 14 days using 7 signals: urgency keywords, open action items, VIP senders, recency, question detection, relationship health, deadline proximity
- Top 7 emails shown with score badges (`!` / `!!` / `!!!`) and reason tags
- Click any item to jump directly to the email; refreshes every 5 minutes

### Knowledge & Intelligence
- **People Graph** — all contacts with interaction stats; sortable by relevance, volume, or recency
  - **★ / ☆ VIP star** — filled star = VIP (amber highlight), outline star = not VIP; click to toggle without leaving the tab
  - **Phone numbers** — auto-populated from email signatures, Microsoft 365 Contacts, and indexed documents (clickable `tel:` chips)
  - **📥 File** — import contacts from `.vcf` or `.csv` (Yahoo exports CSV; Google/Apple/Outlook export vCard); duplicates auto-skipped
  - **☁️ Sync** — one-click sync from Microsoft 365 contacts via Graph API
  - **📤 Export** — download all contacts + phones as `.vcf`
  - **✏️ Edit button** on each card — opens an inline form to edit name, add/remove phone numbers, and write a note (e.g. "key client, best reached by text"); saves for any contact, even email-history-only ones
  - **🔍 Dupes** → **⚡ Merge N dupes** — scan for same-name contacts across sources, merge phone numbers, remove duplicates
  - **✕ button** on each card — hides that contact from the list; "N hidden — show" toggle lets you restore them with ↩
- **Consolidate duplicate accounts** — if the same email address was added twice (e.g., IMAP + OAuth), a **⚡ Consolidate duplicates** button appears in Settings → Email Accounts to merge them and re-attribute all emails to the surviving account
- **Open Loops** — AI detects unresolved commitments, awaited responses, and deadlines; filterable by type with live counts including dismissed items
- **Project Clusters** — AI groups emails into ongoing project topics with status and keywords
- **Topic Timeline** — search any topic to see all related emails in chronological order
- **Executive Briefing** — AI narrative of role state, key relationships, and recommended first-week actions
- **Contact Relationship Tracker** — click any sender for an AI relationship summary, response-time stats, and unreplied count
- **🎙 Live Meeting Intelligence** — open Knowledge → Meetings, hit Record, speak, hit Stop. Whisper transcribes it, Claude extracts action items (save to action board in one click) and drafts the follow-up email. Requires OpenAI API key.
- **💼 Email-native CRM** — open Knowledge → CRM for a 5-column Kanban pipeline (Prospect → Active → Negotiating → Won → Lost). **✨ AI Extract Deals** scans recent emails and suggests deal entries. Create deals manually or move them between stages with one click.
- **🧠 Second Brain Search** — the Ask tab now searches contact notes alongside emails and documents. Ask "What did I note about Acme?" and get answers from all three sources, each with a source badge (Email / Document / Contact).

### Actions & Follow-ups
- AI extracts action items from every email automatically
- Overdue items show a badge on the Actions tab
- **Waiting for Reply** — surfaces sent emails 3+ days old with no response
- **Chase Queue** — dedicated tab for follow-up drafts with urgency color-coding (3d / 7d / 14d+)
- **Auto follow-up reminders** — a background task runs hourly, finds sent emails with no reply after the threshold (default 3 days), and automatically adds them to the Chase Queue as follow-up reminders — deduplicated, so nothing is added twice. Tunable via `followup_reminder_days`; disable with `followup_reminder_enabled`
- **Proactive Alerts** — background engine runs every 90 seconds detecting: deadline mentions, topic clusters, VIP sentiment escalation, commitment gaps, and relationship health

### Translations & Accessibility
- **Email Translation** — translate any email inline with automatic language detection; 20 languages supported; preferred language set in App Settings
- **Thread Summarization** — click **✦ Summarize thread** in the email viewer to distill any email chain into a structured result: a summary, key bullet points, the next-step outcome, and the participant list. Results are cached per thread, so re-opening is instant
- **Contact card** — LinkedIn profile search, per-sender monthly volume chart, relationship AI summary, unreplied count, average response time

### Calendar & Scheduling
- **Calendar Event Creator** — pre-filled event form on any email; creates directly in Microsoft Calendar via Graph API
- **Meeting Prep Brief** — click any calendar event in the Dashboard for an AI-generated agenda, talking points, and prior email context from all attendees
- **Scheduled Send** — compose now, schedule delivery for any future date and time

### New Features (v3.39–v3.40 — 2026-06-18)
- **Action Items inbox scan** — AI scans received emails and surfaces requests others are making of you (complements the existing sent-mail commitment scan)
- **Draft Reply from Action Item** — click the pencil icon on any action item to generate an AI reply draft pre-filled in compose
- **Send Brief to Inbox** — "Send to inbox" button in Weekly Brief emails you a formatted HTML digest of your brief
- **Smart Contact Groups** — AI auto-clusters your top contacts into groups (Clients, Team, Vendors, etc.); new Groups tab in the sidebar; click Search on any member to filter emails
- **Client Interaction Timeline** — Timeline tab in every contact card shows your full chronological email history with that person (↓ received / ↑ sent)

### Bug Fixes & Polish (v3.38.x — 2026-06-17)
- **Windows installer — Python 3.14 blocked** — `install.bat` now detects Python 3.14+ and exits with a clear message (use Python 3.12); pre-built wheels (`--prefer-binary`) used for all packages to prevent Cython/Meson compile errors
- **Windows installer — System32 redirect** — running `install.bat` from `C:\Windows\System32` caused 32-to-64-bit path redirection that broke venv and pip; installer now detects system paths and redirects to `%USERPROFILE%\DirectorAssistant`
- **Delete / snooze closes viewer** — email viewer now closes immediately after deleting or snoozing an email; bulk delete/archive also clears the viewer if the open email is in the selection
- **Actions tab "done" sync** — marking an action item done removes it from the list instantly and re-syncs the tab badge count in the background
- **HTML email readability (final)** — scoped CSS safety block prevents dark email backgrounds from leaking into app UI; background shorthand with URL-first token (e.g. `url(img) #000`) now correctly stripped; threshold raised to include `#333333`
- **Auto-refresh after actions** — inbox list now updates automatically after sending a reply, sending a new email, creating a rule, deleting, or snoozing; no more manual page refresh required
- **Date sort fixed** — emails stored with mixed timezone offsets (e.g. `+00:00` vs `-04:00`) now sort correctly by actual UTC time instead of lexicographic string order
- **Email Map retry** — Email Map now waits up to 60 s for the RAG worker to finish loading on startup before returning an error; a **Retry** button appears if it still isn't ready

### Code Quality & Reliability (v3.16)
- **Poll concurrency fixed** — `_poll_lock` now correctly serializes concurrent refresh cycles; no more duplicate email ingestion on manual refresh
- **Escape key** — press Escape in Inbox to deselect the current email
- **Prop drilling eliminated** — `VIPPanel`, `TriagePanel`, `WeeklyBriefPanel`, `ProjectsPanel`, `IntelligencePanel` all use React Context directly; no more callback threading
- **`Tab` type unified** — single source of truth in `UIContext`; prevents tab-name mismatch bugs
- **IntelligencePanel refactored** — 777 → 94 lines; all 6 intelligence sub-tabs extracted to `IntelligenceTabs.tsx`
- **95 backend tests** — 25 new router-level tests added (VIP, followups, projects, actions filter, triage)
- **Startup safety** — removed `pgrep multiprocessing.spawn` orphan kill that could SIGKILL unrelated processes; PID-file approach handles this correctly

### Architecture & Performance (v3.15)
- **App.tsx migrated to React Context** — `EmailContext` and `UIContext` reduce prop drilling; `useEmails()` + `useEmailDetail()` removed from App root
- **EmailViewer decomposed** — 702 → 154 lines; sub-components: `EmailHeader`, `EmailCompose`, `EmailTools`
- **70 backend tests** — router tests for email_list, email_ai, AI providers, EmailCache, workers
- **Memory leak fixed** — 73 zombie RAG subprocess workers (~78 GB) cleaned up on startup; PID tracking prevents future leaks
- **Contact** — Built by Ali Salamat · ali.salamat@firstpc.ca

### Multi-Provider AI with Priority Control (v3.14)
- **7 AI providers supported**: Anthropic Claude, OpenAI GPT, Groq (Llama/Mixtral), Google Gemini, Kimi (Moonshot AI), Ollama (local), and any OpenAI-compatible API
- **Priority ordering**: set any provider as primary; if it hits a rate limit or quota error, the app automatically falls back to the next enabled provider
- **▲▼ reorder**: drag providers up/down in Settings → App Settings → AI Providers to change who is primary and who is fallback
- **Per-provider settings**: API key, custom base URL (for self-hosted or custom endpoints), default model override
- **Test connection**: verify each provider works before saving with one click
- **Kimi support**: Moonshot AI's Kimi models (`moonshot-v1-8k/32k/128k`) via OpenAI-compatible API at `api.moonshot.cn`
- **Groq**: ultra-fast inference for Llama 3.3 70B, Mixtral, Gemma; great as a cost-effective fallback
- **Ollama**: run local models (Llama 3.2, Mistral, Phi-3, Qwen) with zero API costs — no key required
- **Auto model mapping**: when Claude models are requested but a non-Anthropic provider is active, models are automatically mapped (e.g. `claude-sonnet-4-6` → `llama-3.3-70b-versatile` on Groq)

### PST & OLM Email Archive Import
- **Import PST files** (Outlook for Windows) — drag and drop to import; uses `readpst` (`brew install libpst`)
- **Import OLM files** (Outlook for Mac) — built-in parser, zero external dependencies
- Real-time progress with email count, streaming via Server-Sent Events
- Stable deduplication — re-importing the same file skips emails already in the database
- Access via **Knowledge → 📦 Import PST** in the left sidebar

### Design System (v3.13)
- Consistent UI primitives across all components: `Button`, `Badge`, `Avatar`, `Card`, `Input`, `EmptyState`, `Spinner`
- Gradient initials avatars, color-coded badges, loading overlays
- Dark sidebar navigation with active left-border indicator and hover tooltips
- Redesigned Knowledge tab with left mini-sidebar (all 10 sections visible at once)

### Integrations (Settings → 🔗 Integrations)
- **Slack / Teams** — configure incoming webhook URLs; VIP emails auto-post as rich cards; manual "Share →" button in the email viewer; toggle auto-post for VIP and urgent emails separately
- **Webhooks / Zapier** — add up to 3 URLs (Zapier, Make, n8n, any endpoint); app POSTs `{event, timestamp, data}` JSON on `new_email`, `vip_alert`, `action_created`, `weekly_brief_ready`; built-in test-fire button
- **Task Export** — push action items directly to **Notion** (creates a page), **Jira** (creates a Task issue), or **Todoist** (creates a task with optional due date); "📤 Export" button on every action item once configured
- **Scheduled Report Email** — configure a day/time (e.g. Monday 7:00 AM) and destination address; app generates and emails the weekly brief automatically; "Send now" button for instant test

### Platform & Integration
- **Multiple accounts** — Gmail (OAuth2 or App Password), Microsoft 365 / Hotmail (OAuth2), Yahoo, Office 365, or any IMAP server; all searched together in one view
- **Gmail OAuth2** — sign in with Google in one click; no App Password required
- **Microsoft Graph integration** — email, calendar, OneDrive, and Teams chat access with full OAuth2 flow and auto-setup via Azure CLI
- **Dual AI with auto-fallback** — Claude primary; automatically falls back to OpenAI on rate limits or errors
- **Document Q&A** — index local PDFs, Word docs, and spreadsheets; searchable alongside emails in the Ask tab
- **Dashboard** — live KPIs, calendar, OneDrive recent files, Teams chats, email volume charts; each item opens an AI action panel
- **Auto-update** — checks GitHub for new releases every 60 minutes; one-click update applies in ~30 seconds
- **Budget Mode** — use Claude Haiku for routine tasks to reduce API costs
- **macOS Dock badge** — unread count updated automatically
- **Desktop notifications** — new email alerts with sender name and 1-sentence AI summary
- **Docker support** — one-command server or team deployment

---

## Requirements

| Requirement | Details |
|------------|---------|
| **OS** | macOS 12+ or Windows 10+ |
| **Python** | 3.11–3.13 (3.12 recommended) — Python 3.14 not yet supported on Windows |
| **Node.js** | 18 or higher |
| **AI API key** | Anthropic Claude (recommended) or OpenAI — get one at [console.anthropic.com](https://console.anthropic.com) |
| **Email account** | Gmail, Yahoo, Hotmail, Office 365, or any IMAP-enabled mailbox |

---

## Install — macOS

### One-line install (recommended)

```bash
curl -sSL https://raw.githubusercontent.com/asalamat/director-assistant/main/scripts/install-mac.sh | bash
```

That's it — the script checks prerequisites, installs dependencies, builds the frontend, and starts the app.

### Manual install (from ZIP)

```bash
# 1. Download the latest release
curl -sSL https://api.github.com/repos/asalamat/director-assistant/releases/latest \
  | python3 -c "import sys,json; print([a['browser_download_url'] for a in json.load(sys.stdin).get('assets',[]) if 'mac' in a['name']][0])" \
  | xargs curl -L -o director-assistant-mac.zip

# 2. Extract and install
unzip director-assistant-mac.zip
cd DirectorAssistant
bash scripts/install-mac.sh
```

The installer will:
- Check and install Python 3.11+ and Node.js 18+ via Homebrew if missing
- Create a Python virtual environment and install all dependencies
- Build the frontend and embed it in the backend
- Create `~/Applications/Director Assistant.app`
- Install a LaunchAgent so the app auto-starts on login

### 3. Open

```
http://localhost:8000
```

Or double-click **Director Assistant.app** in `~/Applications`.

### 4. First-time setup

1. Go to **Settings → App Settings** → enter your Anthropic (or OpenAI) API key
2. Go to **Settings → Email Accounts → Add Account** → connect your mailbox
3. Click **Ingest** to download and index your emails

### Stop / Start manually

```bash
# Stop
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.director-assistant.app.plist

# Start
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.director-assistant.app.plist
```

---

## Install — Windows 10/11

> **All-in-one installer** — `install.bat` automatically downloads **Python 3.12** and **Node.js 20 LTS** if they are not already installed. No admin rights required.

### Option A — From GitHub (recommended)

```bat
git clone https://github.com/asalamat/director-assistant.git
cd director-assistant
install.bat
```

Requires [Git for Windows](https://git-scm.com/download/win). Python and Node.js are downloaded automatically.

### Option B — From ZIP (no Git needed)

1. Go to [github.com/asalamat/director-assistant](https://github.com/asalamat/director-assistant) → **Code → Download ZIP**
2. Extract the ZIP anywhere (e.g. Desktop)
3. Double-click **`install.bat`** inside the extracted folder

`install.bat` automatically:
- Downloads **Python 3.12.9** (~25 MB) if Python is not installed
- Downloads **Node.js 20 LTS** (~30 MB, portable ZIP) if Node.js is not installed
- Creates a Python virtual environment and installs all backend packages
- Builds the frontend (React/TypeScript → static files)
- Copies everything to `%USERPROFILE%\DirectorAssistant`
- Creates a **"Director Assistant.bat"** shortcut on your Desktop

> ⚠️ Python **3.14+** is not supported — scipy and chromadb have no Windows wheels yet.
> The installer blocks 3.14+ with a clear message and links to 3.12.

### Manual install (without Git)

If you prefer not to use Git, or `install.bat` fails, follow these steps manually.

**1. Download & extract**

Go to [github.com/asalamat/director-assistant](https://github.com/asalamat/director-assistant) → **Code → Download ZIP**.  
Extract to a folder — e.g. `C:\Users\YourName\DirectorAssistant`.

**2. Open Command Prompt in that folder**

Shift+Right-click the extracted folder → *Open in Terminal* (or *Open Command Prompt here*).

**3. Install Python virtual environment + backend**

```bat
cd backend
python -m venv .venv
call .venv\Scripts\activate.bat
pip install -r requirements.txt --prefer-binary
```

> If pip fails, check `python --version` — must be **3.11–3.13** (not 3.14+).

**4. Build the frontend**

```bat
cd ..\frontend
npm install
npm run build
```

**5. Copy built frontend into backend**

```bat
if not exist ..\backend\static mkdir ..\backend\static
xcopy /s /e /y dist\* ..\backend\static\
```

**6. Start the app**

```bat
cd ..\backend
python -m uvicorn main:app --host 0.0.0.0 --port 8000
```

Open `http://localhost:8000` in your browser.

> **To start the app in future**, open Command Prompt in the project root and run `start.bat`.  
> **To update**, download a new ZIP, re-run steps 3–5, then `start.bat` again.

---

### Daily use
Double-click **"Director Assistant.bat"** on your Desktop — opens at `http://localhost:8000`

Or from the project folder:
```bat
start.bat          ← production mode
start.bat dev      ← dev mode with hot-reload
```

---

## Install — Docker

```bash
docker compose up -d
# App runs at http://localhost:8000
```

Email data persists in the `director_data` Docker volume across restarts.

---

## Install — From Source

```bash
git clone https://github.com/asalamat/director-assistant.git
cd director-assistant

# Backend
cd backend
python3 -m venv .venv
source .venv/bin/activate       # Windows: .venv\Scripts\activate
pip install -r requirements.txt

# Frontend
cd ../frontend
npm install && npm run build
cp -r dist/. ../backend/static/

# Run
cd ../backend
python3 -m uvicorn main:app --host 0.0.0.0 --port 8000
```

Open `http://localhost:8000`.

---

## Build Distribution Packages

```bash
bash scripts/package.sh
```

Outputs `dist/DirectorAssistant-mac-3.15.3.zip` and `dist/DirectorAssistant-win-3.15.3.zip`.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Backend** | FastAPI, Python 3.11+, SQLite (FTS5), sentence-transformers |
| **Frontend** | React 18, TypeScript, Vite, Tailwind CSS |
| **AI** | Anthropic Claude Haiku / Sonnet with automatic OpenAI fallback |
| **Storage** | SQLite for emails and metadata; ChromaDB (optional) for vector search |
| **Email** | IMAP, Gmail API, Microsoft Graph API |

---

### Email Composition (v3.25)
- **CC/BCC** — click "CC/BCC" toggle in the compose window to add CC and BCC recipients
- **Forward** — "↪ Forward" button in the email header; pre-fills compose with quoted original
- **Voice dictation** — "Dictate" button in compose toolbar; speak your reply, Whisper transcribes it

### Delegation Tracking (v3.25)
- Forward an email to a colleague → create a delegation in **Actions → Delegations**
- **Auto-check** cross-references pending delegations with received emails to auto-resolve
- Accountability layer: see all outstanding "passed to X" items in one place

### AI Productivity (v3.25)
- **Overnight Triage** — at a configured hour (default 11 PM), AI scans unread emails, generates draft replies, queues them for your morning approval in **Actions → Overnight**. Enable in Settings → Integrations.
- **Meeting Prep** — click "Meeting Prep" in Knowledge → Briefing; enter subject + attendee emails → AI generates a 4-section brief (background, open items, talking points, watch-outs)
- **Board Report** — Knowledge → 📋 Board Report → one-click monthly executive status report from email activity, suitable for board briefings
- **Email Coaching** — Knowledge → 🎯 Coaching → AI analyzes your last 30 days of sent emails, surfaces strengths and 3-5 actionable communication tips
- **Contract/Invoice Extraction** — email viewer → 💰 Extract → AI pulls amounts, dates, vendors, parties from financial emails; one-click CSV download

### Slack & Teams Integration (v3.25)
- **Share → button** in every email toolbar — push any email to Slack or Teams with one click
- **Settings → 🔗 Integrations → Slack & Teams** — paste incoming webhook URL, set VIP/urgent auto-post, send test message

### Email Productivity (v3.26)
- **📎 Attachment names** — filenames detected in email bodies shown as chips below the email text
- **⏳ Undo Send** — 5-second countdown with "Undo" button after clicking Send; cancels before SMTP delivery
- **💾 Draft auto-save** — compose drafts saved to localStorage every 30s; restored when you re-open the compose window
- **✍️ Email signatures** — signature manager in the compose window; create/delete named signatures, auto-insert default; access via "+ Add signature" in compose
- **🔊 Read aloud** — email viewer toolbar → 🔊 Read streams ElevenLabs TTS audio; add API key in Settings → App Settings → ElevenLabs
- **📋 Email rules/filters** — Settings → 🛡️ Rules & Filters; auto-label/archive/mark-read/**delete** by sender, subject, or body; applied on arrival + run manually with ▶ Run Now
- **🗄️ ChromaDB backup** — the backup zip now includes the RAG vector database, not just SQLite
- **🔍 Smart folders** — pinned searches appear as clickable folder tabs in the inbox folder bar
- **Overnight triage config** — Settings → 🔗 Integrations → Overnight Triage Agent: enable + hour picker
- **Delegation on forward** — amber banner appears after forwarding an email, prompting you to track the delegation
- **Template merge fields** — Templates now support `{{name}}`, `{{email}}`, `{{company}}`, `{{subject}}`, `{{date}}` — substituted from the email context when inserting
- **Spell check** — compose textarea has browser spell check enabled (red underlines + right-click to correct)
- **✦ Improve my draft** — type your own reply (even disagreeing with AI), click "✦ Improve my draft" → AI fixes grammar and clarity **without changing your opinion or intent**; prominently placed above tone adjusters in compose

### Rich Text, Thread View & Windows CI (v3.27)
- **📝 Rich text compose** — formatting toolbar in the Reply window: Bold · Italic · Underline · Bullet list · Numbered list · Insert link · Clear formatting; emails send as HTML with plain-text fallback
- **💬 Thread view** — all earlier messages in the same email thread appear as collapsed chips above the body; click any to expand and read the full message inline
- **Smart Draft/Quick Replies populate rich text editor** — fixed so AI-generated drafts correctly appear in the new HTML compose area
- **Windows CI** — GitHub Actions workflow tests the full install on `windows-latest` on every push; dependency conflict fixed (`httpx>=0.27.2`)
- **From-account selector** — when multiple email accounts are connected, a "From" dropdown appears at the top of the compose window

### Full Project Management Suite (v3.34–v3.36)

**Project creation wizard:** Name → 5-field brief (Goal, Timeline, Stakeholders, Deliverables, Risks) → "✦ Create & Generate Plan" auto-builds a full AI plan using your brief + linked emails + RAG search across all indexed content

**AI Project Plan:**
- Structured plan: summary, objectives, phased task breakdown, risks with mitigations
- ↺ Regenerate anytime · 📄 Export PDF · 📊 MS Project (.xml) · 📊 Client Report (executive stakeholder version)
- Linked documents persist (Settings → Documents to index files first)

**Task Management (Kanban board):**
- 4 columns: Not Started / In Progress / Done / Blocked
- ⚡ Load from Plan populates board automatically from AI plan
- Per-task: assignee, priority, **progress % slider (0–100)**, hourly rate, dependencies, comments
- Mini progress bar visible on collapsed task cards; Gantt bars fill proportionally
- Comments trigger AI suggestions for next steps
- Email assignment: assign a task → draft assignment email in one click

**Project tracking:**
- 📊 Dashboard: % complete ring, task breakdown, days remaining, health indicator
- 🎯 Milestones: date-tracked with countdown/overdue alerts, click to mark done
- 💰 Budget: estimated cost per task (rate × days), variance vs budget total
- 📉 Burndown chart: ideal vs actual work-remaining lines
- 📝 Progress notes + AI health review: GREEN/AMBER/RED status, on-track/at-risk/recommendations
- 📅 Weekly update: AI 150-word digest ready to send to stakeholders

**Templates & exports:**
- 💾 Save project as template; start new projects from saved templates
- 📄 Internal plan PDF · 📊 MS Project XML · 📊 Client PDF status report

### AI Project Planning (v3.34)
- **✦ Generate AI Plan** — open any project → click "✦ Generate Plan": AI reads all linked emails + description and produces a full project plan: summary, objectives, phased task breakdown (with days/assignee/priority), risks with mitigation
- **↺ Regenerate** — refresh the plan anytime (e.g. after linking more emails)
- **📄 Export PDF** — opens a print-ready A4 document in a new tab → Print → Save as PDF
- **📊 MS Project (.xml)** — downloads MSPDI-format XML that opens directly in Microsoft Project; phases become summary tasks, individual tasks become children with duration in hours

### UX & Productivity (v3.36)
- **Command palette** — `Cmd+K` / `Ctrl+K` opens a quick-jump overlay; type any section name and press Enter to navigate instantly
- **Keyboard shortcut overlay** — press `?` anywhere (outside a text field) to see all keyboard shortcuts in a floating card
- **Hover email preview** — hover any email row to see a tooltip with sender, date, and body preview; no click needed
- **Unread count in tab title** — browser tab shows `Director (N)` while unread emails exist; clears when the tab is focused
- **Saved searches** — click 📌 while searching to pin the query with a name; pinned searches appear as clickable chips in the search panel
- **Bulk actions (Action Board)** — checkbox on each action item; select multiple then bulk mark done or bulk delete
- **Score explanation tooltip** — priority score badge (e.g. `8`) in Focus/Triage now shows a hover tooltip listing all scoring reasons
- **Ask AI export** — Copy or download any AI answer from the Ask tab as a Markdown `.md` file
- **Weekly Brief export** — "📋 Copy" and "↓ .md" buttons export the full weekly brief as Markdown
- **Analytics week-over-week** — delta % badges (↑ green / ↓ red) on Total and Avg/day cards in Analytics showing change vs the previous period

### UX Polish (v3.33)
- **✦ Thread summary** — when an email is part of a thread, a "✦ Summarize thread" button appears; AI reads all messages and returns summary + key points + outcome in a dismissible card
- **Keyboard shortcuts** — `r` to reply, `f` to forward (added to existing: `j`/`k` navigate list, `a` analyze, `e` archive, `Esc` deselect, `⌘N` compose)
- **Tab unread count** — browser tab shows `Director (12)` when there are unread emails; resets when tab is focused
- **Email aging badge** — unread emails in inbox older than 7 days show a `7d` / `14d` / `30d+` amber/red badge
- **Resizable split pane** — drag the divider between email list and viewer to resize (220–520px); preference saved across sessions

### Productivity Features (v3.32)
- **Bulk email actions** — hover any email to see a checkbox; select multiple then use the toolbar: **Archive all**, **Mark Read**, **Delete**, or **Snooze**; "Select all N" link available
- **Advanced search filters** — click **⚡ Filters** beside the search bar to expand: from/to date pickers, sender filter, category dropdown, has attachment, unread only; active filters shown as removable chips
- **AI email preview** — 1-sentence AI summary auto-loads below each email subject (lazy, via IntersectionObserver); cached in SQLite so each email is only summarized once
- **📬 Forgot to Reply** — Intelligence → Loops → **Forgot** tab: emails you opened but never replied to (last 30 days); Reply button opens compose, Dismiss suppresses permanently
- **Contact heatmap** — Intelligence → People → click any contact to expand a 90-day GitHub-style activity grid (13 weeks × 7 days, green scale)
- **Email mood timeline** — Intelligence → Analytics → "Urgency Timeline": SVG line chart of daily urgency score (green/amber/red), hover crosshair shows date/score/count

### RAG Visualization (v3.30–v3.31)
- **Email Map zoom + pan** — Intelligence → Email Map: mouse-wheel to zoom (0.3×–8×), drag to pan, reset button, zoom % indicator
- **✦ Explain cluster** — Shift+click dots to multi-select → "✦ Explain N selected" streams AI explanation of what those emails have in common
- **Knowledge Graph** — refresh button, nodes sized by email count, 600-iteration physics, edges colored by type (person↔person=blue, person↔topic=gray)
- **AI Clusters generate** — Intelligence → 🗂 AI Clusters → "✦ Generate Clusters" button (no briefing required); ↺ Regenerate to refresh

### RAG Visualization (v3.30)
- **📊 RAG Stats** — Settings → 🔧 Data & Backup shows live index stats: emails indexed, docs indexed, vector chunks, ChromaDB size, embedding model (BAAI/bge-large-en-v1.5)
- **🔍 Ask Transparency** — Ask panel now shows collapsible "Sources used (N)" under each answer; each source displays a relevance % progress bar + 2-line snippet; click a source to search for that email
- **📍 Email Cluster Map** — Intelligence → Email Map: PCA-projected 2D scatter plot of all indexed emails (up to 1500); colored by AI-assigned category (newsletter/action/proposal/invoice/meeting); hover tooltip; click to search; **🏷 Classify emails** button bulk-classifies up to 300 random emails per click to populate colors; no external chart library (pure SVG)
- **🕸 Knowledge Graph** — Intelligence → Knowledge Graph: force-directed SVG graph of people (top senders), topics (subject keywords), and projects; edges show co-occurrence relationships; click a person node to search their emails; pure React/SVG physics simulation (no D3 dependency)

### Email Rules & Filtering (v3.28.6–v3.40.0)
- **🚫 Quick-rule from email** — click "🚫 Rule" in the email toolbar to instantly create a rule pre-filled with that email's sender or subject; choose delete / archive / mark read and save in one step
- **Delete action** — Email Rules now support `delete` — matching emails are removed from SQLite + ChromaDB on arrival (no more marketing, carrier notifications, no-reply spam in your inbox)
- **▶ Run Now** — apply all enabled rules to your existing inbox in one click (up to 2000 emails); shows stats: deleted / labeled / archived / marked read; also removes deleted emails from the RAG vector index
- **🔍 Dry-run Preview** — click **Preview** in the create-rule form to see exactly how many emails a rule *would* affect (with up to 3 sample subjects) before you save it — no action is taken, so you can tune the field / condition / value safely
- **Last-run status** — each rule panel shows **"Last run: X ago — labeled N, archived N, marked read N, deleted N"**, updated after every manual Run Now and every automatic background pass, so you always know when rules last fired and what they did
- Email Rules moved to dedicated **Settings → 🛡️ Rules & Filters** section

### Settings Redesign (v3.29.0)
- **Two-column layout** — left sidebar nav replaces 3 cramped horizontal tabs; wider `max-w-3xl` card
- **6 focused sections**: 📧 Accounts · 📁 Documents · ⚙️ App Settings · 🛡️ Rules & Filters · 🔗 Integrations · 🔧 Data & Backup
- Each section does one thing; Danger Zone and Updates moved to dedicated Data section
- Settings.tsx: 1026 → 436 lines (AddAccountForm extracted to own file)

### Compose UX Fixes (v3.29.1–v3.29.2)
- **Floating compose panel** — reply compose now overlays the email body (Gmail-style absolute positioning) instead of pushing it up; email remains fully scrollable while composing
- **Send button always visible** — compose has sticky header (Reply/Cancel) + scrollable fields + sticky footer (🔍 Review + Send); Send can never be clipped off-screen

### Polish & UX (v3.28.0–v3.28.5)
- **📦 Archive email** — Archive button in toolbar; press `e` key shortcut; moves to Archive folder
- **💬 Canned responses/snippets** — pre-saved text blocks insertable from compose; manage in Settings → App Settings → Canned Responses
- **ElevenLabs voice picker** — voice ID is now editable in Settings (with popular voice list); was read-only
- **From-account selector** — when multiple accounts connected, a "From" dropdown appears at top of compose
- **Compact email toolbar** — primary actions (Reply/Fwd/AI) + icon-only group for secondary (Translate/Archive/Share/Print/Ask)
- **Auto-refresh after actions** — email list refreshes within 1 second of open/delete/snooze/archive; emails marked as read on open
- **Executive Summary readability** — Role Briefing summary now shows dark text on white (was blue-on-blue, hard to read)
- **Overdue follow-ups** — white background with red left border accent; all text in standard dark gray on white

### Completeness Update (v3.27.4)
- **🎙 2-hour meeting support** — recordings now split into 10-minute chunks server-side (uses pydub+ffmpeg when installed); frontend limit raised from 45 to 90 minutes; falls back gracefully without ffmpeg
- **🖨 Print email** — print button (🖨) in the email toolbar calls `window.print()`
- **ElevenLabs voice selection** — Settings → App Settings shows the current voice ID with a list of popular free voices to choose from
- **Bundle code splitting** — React vendor chunk split separately; main bundle reduced from 588 kB to 448 kB (no more build warning)

---

## Gmail Setup

### Option A — OAuth2 (Recommended)

1. Go to **App Settings → Google / Gmail Integration**
2. Create OAuth credentials at [Google Cloud Console](https://console.cloud.google.com/apis/credentials) → OAuth 2.0 Client IDs → Web application
3. Add `http://localhost:8000/api/oauth/google/callback` as an authorized redirect URI
4. Enable the **Gmail API** and **Google Calendar API** in your project
5. Enter your Client ID and Secret in App Settings
6. Go to **Email Accounts → Add Account → Gmail → Sign in with Google**

### Option B — App Password (IMAP)

Enable IMAP in Gmail settings:
- **Host:** `imap.gmail.com` | **Port:** `993`
- **Username:** your Gmail address
- **Password:** an [App Password](https://myaccount.google.com/apppasswords) (requires 2FA)

---

## Microsoft / Outlook Setup

### Option A — OAuth2 (Recommended)

1. Go to **App Settings → Microsoft Integration** → click **Auto-Setup Microsoft App** (uses Azure CLI — `brew install azure-cli` if not installed)
2. Go to **Email Accounts → Add Account → Hotmail / Outlook.com → Sign in with Microsoft**

### Option B — Manual Azure Registration

1. Create an app at [portal.azure.com](https://portal.azure.com) → App registrations
2. Add `http://localhost:8000/api/oauth/microsoft/callback` as a redirect URI
3. Copy the Application (client) ID into **App Settings → Microsoft App Client ID**
4. Use the OAuth2 sign-in flow above

---

## License

MIT — use freely, modify freely, attribution appreciated.

---

## Contact

Built by **Ali Salamat** · [ali.salamat@firstpc.ca](mailto:ali.salamat@firstpc.ca)

Questions, feedback, or collaboration? Feel free to reach out.
