# Director Assistant v2.1 — Installation Guide

## macOS

### Requirements
- macOS 12 or later
- Python 3.10+ (install from [python.org](https://www.python.org/downloads/) if not present)
- Node.js is **not** required — the frontend is pre-built

### Steps

1. **Download** `DirectorAssistant-mac-2.1.zip` and double-click to extract it.

2. **Open Terminal** and run the installer:
   ```bash
   bash DirectorAssistant/scripts/install-mac.sh
   ```

3. The installer will:
   - Create a Python virtual environment and install all dependencies
   - Add a **✉ Director Assistant** icon to your menu bar
   - Register a **login item** so the app starts automatically on every boot
   - Open http://localhost:8000 in your browser

4. **First launch only** — if macOS blocks the script:
   - Go to **System Settings → Privacy & Security** and click **Allow Anyway**

### Starting / stopping

| Action | How |
|--------|-----|
| Open the app | Click **✉** in the menu bar → Open Director Assistant |
| Quit | Click **✉** → Quit |
| Restart manually | Run `~/Applications/DirectorAssistant/scripts/launch-mac.sh` in Terminal |

### Uninstall

```bash
launchctl unload ~/Library/LaunchAgents/com.director-assistant.plist
rm -f ~/Library/LaunchAgents/com.director-assistant.plist
rm -rf ~/Applications/DirectorAssistant
```

---

## Windows

### Requirements
- Windows 10 or later
- Python 3.10+ — download from [python.org](https://www.python.org/downloads/)
  - During install, tick **"Add Python to PATH"**
- Node.js is **not** required

### Steps

1. **Download** `DirectorAssistant-win-2.1.zip` and extract it (right-click → Extract All).

2. **Double-click** `DirectorAssistant\scripts\install-windows.bat`
   - If Windows Defender SmartScreen appears, click **More info → Run anyway**

3. The installer will:
   - Create a Python virtual environment and install all dependencies
   - Create `Start Director Assistant.bat` on your Desktop
   - Open http://localhost:8000 in your browser

4. **To start the app** on subsequent launches, double-click the shortcut on your Desktop.

### Starting / stopping

| Action | How |
|--------|-----|
| Start | Double-click **Start Director Assistant** on Desktop |
| Stop | Close the terminal window that opens, or press Ctrl+C in it |

### Auto-start on boot (optional)

Press **Win + R**, type `shell:startup`, press Enter, then copy the `Start Director Assistant.bat` shortcut into that folder.

---

## First-time setup (all platforms)

After opening http://localhost:8000:

1. Click the **gear icon** (Settings) in the top-right corner
2. Go to the **Config** tab and enter your **Anthropic API key** (from [console.anthropic.com](https://console.anthropic.com))
3. Go to the **Accounts** tab and add your email accounts:
   - **Gmail / Yahoo**: use an App Password (enable 2FA first, then generate one in account security settings)
   - **Hotmail / Outlook.com**: click **Sign in with Microsoft** — you will need an Azure app Client ID (see below)
   - **Office 365 (work)**: enter your Tenant ID, Client ID, and Client Secret
4. Click **Ingest** to import your emails

### Hotmail / Outlook.com — Azure App setup

To connect a personal Microsoft account you need a free Azure app registration:

1. Go to [portal.azure.com](https://portal.azure.com) → **App registrations → New registration**
2. Name: anything (e.g. "Director Assistant")
3. Supported account types: **Accounts in any organizational directory and personal Microsoft accounts**
4. Click **Register**
5. Copy the **Application (client) ID** — paste this into Director Assistant when adding the account
6. In the app's **Manifest**, set:
   ```json
   "isFallbackPublicClient": true,
   "requestedAccessTokenVersion": 2
   ```
7. In **Authentication**, enable **Allow public client flows**
8. In Outlook.com settings (outlook.com → gear → Mail → Sync email), turn **IMAP** on

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Port 8000 already in use | Change the port: edit `start.sh` (mac) or the `.bat` file and replace `8000` with `8001`, then open http://localhost:8001 |
| "Connection failed" on Gmail | Make sure 2FA is enabled and you are using an **App Password**, not your regular password |
| Hotmail shows "AUTHENTICATE failed" | Enable IMAP in outlook.com settings (gear → Mail → Sync email → IMAP on) |
| App won't start on macOS | Run `python3 --version` in Terminal — must be 3.10 or higher |
| No emails showing after ingest | Click **Refresh** (circular arrow) in the toolbar |
