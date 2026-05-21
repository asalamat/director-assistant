# Director Assistant

An AI-powered email intelligence app that helps you understand your inbox, track commitments, and take action faster. Connects to any IMAP mailbox and uses Claude AI to surface what matters.

---

## Features

| Tab | What it does |
|-----|-------------|
| **Inbox** | Browse, search, and filter emails. AI-powered reply recommendations. |
| **Ask** | Ask natural-language questions over your entire email history (RAG). |
| **Actions** | AI-generated action board — things you need to do, reply to, or follow up on. |
| **Brief** | Daily digest summarising your most important emails. |
| **Analytics** | Volume trends, top senders, and response-time insights. |
| **Templates** | Save and reuse reply templates with `{name}`, `{date}` variables. |
| **Health** | Backend status, IMAP connection health, and AI availability. |
| **Knowledge** | Role-transition intelligence — people graph, open commitments, active projects, topic timeline, and an AI-written executive briefing. |

---

## Requirements

- **macOS 12+** (or Windows 10+)
- **Python 3.11+**
- **Node.js 18+**
- An **Anthropic API key** — get one at [console.anthropic.com](https://console.anthropic.com)
- An IMAP-enabled email account (Gmail, Outlook, iCloud, or any IMAP server)

---

## macOS — Install from ZIP

### 1. Download the latest release

Go to the [Releases page](https://github.com/asalamat/director-assistant/releases) and download:

```
DirectorAssistant-mac-2.5.0.zip
```

### 2. Extract and run the installer

```bash
unzip DirectorAssistant-mac-2.5.0.zip
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
2. Go to **Settings → App Settings** — enter your Anthropic API key
3. Go to **Settings → Email Accounts → Add Account** — connect your mailbox

### Stop / Start manually

```bash
# Stop
launchctl unload ~/Library/LaunchAgents/com.director-assistant.app.plist

# Start
launchctl load ~/Library/LaunchAgents/com.director-assistant.app.plist
```

---

## Windows — Install from ZIP

Download `DirectorAssistant-win-2.5.0.zip` from [Releases](https://github.com/asalamat/director-assistant/releases), extract it, then double-click:

```
DirectorAssistant\scripts\install-windows.bat
```

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

Outputs `dist/DirectorAssistant-mac-2.5.0.zip` and `dist/DirectorAssistant-win-2.5.0.zip`.

---

## Tech stack

- **Backend** — FastAPI, Anthropic Claude API, SQLite (FTS5), sentence-transformers
- **Frontend** — React 18, TypeScript, Vite, Tailwind CSS
- **AI** — Claude Haiku (fast analysis), Claude Sonnet (summaries and Q&A)

---

## Gmail setup

Enable IMAP in Gmail settings, then use:
- **Host**: `imap.gmail.com` | **Port**: `993`
- **Username**: your Gmail address
- **Password**: an [App Password](https://myaccount.google.com/apppasswords) (not your regular password — requires 2FA enabled)

---

## License

MIT
