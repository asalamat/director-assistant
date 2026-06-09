# Director Assistant

> **Your AI-powered executive email intelligence platform.** Connects to Gmail, Microsoft 365, Yahoo, or any IMAP mailbox and uses Claude AI to help you triage faster, never miss a commitment, and stay on top of every relationship that matters.

**Current version: 3.21.0** · [Releases](https://github.com/asalamat/director-assistant/releases) · MIT License

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
| **Actions** | AI-extracted commitments, follow-ups, and deadlines with overdue tracking and CSV export |
| **VIP** | Track your most important contacts with live stats: last contact, unread count, awaiting-reply flag, and full email history |
| **Brief** | Daily AI digest of your most important recent emails, configurable date range |
| **Health** | Live system status — IMAP connection, AI provider, RAG database, polling loop |
| **Knowledge** | Hub with left sidebar navigation containing 10 sub-sections across two groups: |
| ↳ Intelligence | Role Briefing · People Graph · Open Loops · AI Clusters · Topic Timeline |
| ↳ Tools | Weekly Brief · Chase Queue · Projects Tracker · **🎙 Meetings** · **💼 CRM** · Analytics · Templates · PST/OLM Import |
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
- **Proactive Alerts** — background engine runs every 90 seconds detecting: deadline mentions, topic clusters, VIP sentiment escalation, commitment gaps, and relationship health

### Translations & Accessibility
- **Email Translation** — translate any email inline with automatic language detection; 20 languages supported; preferred language set in App Settings
- **Thread Summarization** — distill any email chain into a summary, key bullet points, and next-step outcome
- **Contact card** — LinkedIn profile search, per-sender monthly volume chart, relationship AI summary, unreplied count, average response time

### Calendar & Scheduling
- **Calendar Event Creator** — pre-filled event form on any email; creates directly in Microsoft Calendar via Graph API
- **Meeting Prep Brief** — click any calendar event in the Dashboard for an AI-generated agenda, talking points, and prior email context from all attendees
- **Scheduled Send** — compose now, schedule delivery for any future date and time

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
| **Python** | 3.11 or higher |
| **Node.js** | 18 or higher |
| **AI API key** | Anthropic Claude (recommended) or OpenAI — get one at [console.anthropic.com](https://console.anthropic.com) |
| **Email account** | Gmail, Yahoo, Hotmail, Office 365, or any IMAP-enabled mailbox |

---

## Install — macOS

### 1. Download

Go to the [Releases page](https://github.com/asalamat/director-assistant/releases) and download:

```
DirectorAssistant-mac-3.15.3.zip
```

### 2. Install

```bash
unzip DirectorAssistant-mac-3.15.3.zip
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

## Install — Windows

Download `DirectorAssistant-win-3.15.3.zip` from [Releases](https://github.com/asalamat/director-assistant/releases), extract it, then double-click:

```
DirectorAssistant\scripts\install-windows.bat
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
