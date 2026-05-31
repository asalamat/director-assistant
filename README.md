# Director Assistant

An AI-powered email intelligence app that helps you understand your inbox, track commitments, and take action faster. Connects to Gmail, Microsoft 365, Yahoo, or any IMAP mailbox and uses Claude AI (or OpenAI) to surface what matters.

**Current version: 3.1.0**

---

## Features

| Tab | What it does |
|-----|-------------|
| **Inbox** | Browse, search, and filter emails. Priority labels (urgent / action / finance), thread depth, smart sort, snooze, and pin-search smart folders. |
| **Focus** ⚠ | **Smart Daily Triage** — AI scores all unread emails from the last 14 days by urgency, open action items, VIP senders, recency, and question detection. Shows your top 7 highest-priority emails with score badges (`!` / `!!` / `!!!`) and reason tags. Click any item to jump straight to it. Refreshes every 5 minutes. |
| **Thread View** | Read full email threads inline with collapsible messages and AI-suggested replies. |
| **Compose** | Write new emails or reply with AI-generated draft suggestions saved directly to your Drafts folder. |
| **Ask** | Ask natural-language questions over your entire email history using semantic (vector) + full-text search, with full ask history. |
| **Actions** | AI-generated action board — commitments, follow-ups, and deadlines extracted automatically. CSV export. |
| **Brief** | Daily AI digest summarising your most important emails. Configurable date range. |
| **Analytics** | Activity heatmap, volume trend, top senders, folder breakdown. CSV export. |
| **Templates** | Save and reuse reply templates with `{name}`, `{date}`, `{subject}`, `{sender}` variables. |
| **Health** | Backend status, IMAP connection health, AI availability, and polling loop state. |
| **Knowledge** | Role-transition intelligence — people graph, open commitments, active projects, topic timeline, and an AI-written executive briefing. |
| **Dashboard** | One-click executive brief — live KPIs, tomorrow's schedule, top projects, OneDrive recent files, Teams chats, email volume charts, follow-ups, and training items. Click any item to open an AI panel. **Meeting Prep** chip appears on calendar events — generates agenda, talking points, and prior email context from attendees. Auto-refreshes every 30 min. |

### Highlights

- **Multiple accounts** — Gmail (OAuth or App Password), Microsoft 365/Hotmail (OAuth), Yahoo, Office 365, or any IMAP server
- **Gmail OAuth2** — sign in with Google in one click; no App Password required. Requires a Google Cloud OAuth client (see [Gmail OAuth setup](#gmail-oauth-setup))
- **Microsoft OAuth2** — sign in with Microsoft via popup or Azure CLI auto-setup; full Graph API integration for email, calendar, OneDrive, and Teams
- **Dual AI with auto-fallback** — Anthropic Claude primary; automatically falls back to OpenAI on rate limits, quota exhaustion, or billing errors
- **Smart Daily Triage** — "Focus" tab surfaces your top priority unread emails using 7 urgency signals; score badges and reason tags explain why each email was flagged
- **Meeting Prep Brief** — click a calendar event in the dashboard and tap "Meeting Prep" to get an AI-generated agenda, talking points, and prior email context from all attendees
- **Auto-update** — checks GitHub for new versions and applies updates in-place with a one-click popup
- **Dashboard AI panel** — click any email, action item, calendar event, or project in the dashboard to open an AI panel: Resolve, Schedule Meeting, Draft Reply, Summarize, Meeting Prep
- **Save to Drafts** — "Draft Reply" generates an AI email draft and saves it directly to your Drafts folder with one click
- **OneDrive integration** — dashboard shows recently modified OneDrive files (requires Files.Read scope)
- **Teams integration** — dashboard shows recent Teams chats and message previews (requires Chat.Read scope)
- **Follow-up reminders** — AI detects emails needing a reply and surfaces them as reminders
- **Desktop notifications** — browser notifications for new email and refresh results
- **Ask history** — all previous Ask queries saved and browsable
- **Contact cards** — click any sender to see full history and stats
- **Dock badge** — macOS unread count badge updated automatically
- **Budget mode** — use a cheaper model for routine tasks to reduce API costs
- **Docker** — one-command server deployment via `docker compose up`

---

## Requirements

- **macOS 12+** (or Windows 10+)
- **Python 3.11+**
- **Node.js 18+**
- An **Anthropic API key** (or OpenAI key) — get one at [console.anthropic.com](https://console.anthropic.com)
- An IMAP-enabled email account (Gmail, Yahoo, Hotmail, Office 365, or any IMAP server)

---

## macOS — Install from ZIP

### 1. Download the latest release

Go to the [Releases page](https://github.com/asalamat/director-assistant/releases) and download:

```
DirectorAssistant-mac-3.1.0.zip
```

### 2. Extract and run the installer

```bash
unzip DirectorAssistant-mac-3.1.0.zip
cd DirectorAssistant
bash scripts/install-mac.sh
```

The installer will:
- Check/install Python 3.11+ and Node.js 18+ (via Homebrew if needed)
- Create a Python virtual environment and install dependencies
- Build the frontend and embed it in the backend
- Create `~/Applications/Director Assistant.app`
- Install a LaunchAgent so the app auto-starts on login

### 3. Open the app

```
http://localhost:8000
```

Or double-click **Director Assistant.app** in `~/Applications`.

### 4. First-time setup

1. Open `http://localhost:8000`
2. Go to **Settings → App Settings** — enter your Anthropic (or OpenAI) API key
3. Go to **Settings → Email Accounts → Add Account** — connect your mailbox

### Stop / Start manually

```bash
# Stop
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.director-assistant.app.plist

# Start
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.director-assistant.app.plist
```

---

## Windows — Install from ZIP

Download `DirectorAssistant-win-3.1.0.zip` from [Releases](https://github.com/asalamat/director-assistant/releases), extract it, then double-click:

```
DirectorAssistant\scripts\install-windows.bat
```

---

## Docker

```bash
docker compose up -d
# App runs at http://localhost:8000
```

Email data persists in the `director_data` Docker volume across restarts.

---

## Install from source

```bash
git clone https://github.com/asalamat/director-assistant.git
cd director-assistant

# Backend
cd backend
python3 -m venv .venv
source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -r requirements.txt

# Frontend
cd ../frontend
npm install
npm run build
cp -r dist/. ../backend/static/

# Run
cd ../backend
uvicorn main:app --host 0.0.0.0 --port 8000
```

Open `http://localhost:8000`.

---

## Build distribution packages

```bash
bash scripts/package.sh
```

Outputs `dist/DirectorAssistant-mac-3.1.0.zip` and `dist/DirectorAssistant-win-3.1.0.zip`.

---

## Tech stack

- **Backend** — FastAPI, Anthropic Claude API, OpenAI API, SQLite (FTS5), sentence-transformers
- **Frontend** — React 18, TypeScript, Vite, Tailwind CSS
- **AI** — Claude Haiku / Sonnet with automatic OpenAI fallback (configurable)

---

## Gmail setup

### Option A — OAuth2 (recommended, no App Password needed)

1. Go to **App Settings → Google / Gmail Integration** and enter your Google Cloud OAuth credentials
2. Create credentials at [Google Cloud Console](https://console.cloud.google.com/apis/credentials) → OAuth 2.0 Client IDs → Web application
3. Add `http://localhost:8000/api/oauth/google/callback` as an authorized redirect URI
4. Enable the **Gmail API** and **Google Calendar API** in your Google Cloud project
5. Go to **Email Accounts → Add Account → Gmail → Sign in with Google (OAuth2)**
6. Click **Sign in with Google** — a popup opens; sign in and approve permissions

### Option B — App Password (IMAP)

Enable IMAP in Gmail settings, then use:
- **Host**: `imap.gmail.com` | **Port**: `993`
- **Username**: your Gmail address
- **Password**: an [App Password](https://myaccount.google.com/apppasswords) (not your regular password — requires 2FA enabled)

---

## Microsoft / Outlook setup

### Option A — OAuth2 (recommended)

1. Go to **App Settings → Microsoft Integration** and click **Auto-Setup Microsoft App** (uses Azure CLI — `brew install azure-cli` if not installed)
2. Once configured, go to **Email Accounts → Add Account → Hotmail / Outlook.com → Sign in with Microsoft (OAuth2)**
3. A popup opens — sign in and approve permissions. Email, calendar, and OneDrive data sync automatically.

### Option B — Manual Azure app registration

1. Create an app at [portal.azure.com](https://portal.azure.com) → App registrations
2. Add `http://localhost:8000/api/oauth/microsoft/callback` as a redirect URI
3. Copy the Application (client) ID into **App Settings → Microsoft App Client ID**
4. Then use the OAuth2 sign-in flow above

---

## License

MIT
