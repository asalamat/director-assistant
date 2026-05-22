import { useState } from 'react'

interface Props {
  onClose: () => void
}

type Section = 'start' | 'features' | 'ai' | 'knowledge' | 'tips'

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'start',     label: 'Getting Started' },
  { id: 'features',  label: 'Features' },
  { id: 'ai',        label: 'AI Features' },
  { id: 'knowledge', label: 'Knowledge Base' },
  { id: 'tips',      label: 'Tips & Tricks' },
]

function H3({ children }: { children: React.ReactNode }) {
  return <h3 className="text-sm font-semibold text-gray-800 mt-5 mb-2 first:mt-0">{children}</h3>
}
function P({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-gray-600 leading-relaxed mb-2">{children}</p>
}
function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 mb-3">
      <span className="flex-shrink-0 w-6 h-6 rounded-full bg-accent text-white text-xs font-bold flex items-center justify-center">{n}</span>
      <span className="text-sm text-gray-600 leading-relaxed">{children}</span>
    </div>
  )
}
function Badge({ children, color = 'blue' }: { children: React.ReactNode; color?: string }) {
  const cls = color === 'blue'   ? 'bg-blue-100 text-blue-700'
            : color === 'green'  ? 'bg-green-100 text-green-700'
            : color === 'purple' ? 'bg-purple-100 text-purple-700'
            :                      'bg-gray-100 text-gray-700'
  return <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded ${cls}`}>{children}</span>
}
function Note({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-800 mb-3">
      {children}
    </div>
  )
}

function GettingStarted() {
  return (
    <div>
      <H3>1. Add your email account</H3>
      <Step n={1}>Go to <strong>Settings</strong> (top-right gear icon) → <strong>Email Accounts</strong>.</Step>
      <Step n={2}>Choose your provider: Gmail, Yahoo, Hotmail, or Office 365.</Step>
      <Step n={3}>Enter your email address and an <strong>App Password</strong> (not your regular password).</Step>
      <Step n={4}>Click <strong>Connect</strong>. The app will verify the connection.</Step>

      <Note>
        <strong>App Passwords are required</strong> for Gmail, Yahoo, and Hotmail because those providers block
        regular passwords for third-party apps. Enable 2-factor authentication first, then generate an App Password
        from your account's Security settings.
      </Note>

      <H3>2. Ingest your emails</H3>
      <Step n={1}>After connecting, click <strong>Ingest</strong> next to your account.</Step>
      <Step n={2}>The app downloads and indexes your emails (INBOX, Sent, Bulk/Spam).</Step>
      <Step n={3}>Large mailboxes may take a few minutes. Progress is shown on-screen.</Step>
      <P>Emails are stored locally — nothing is sent to the cloud except AI queries.</P>

      <H3>3. Add your AI API key</H3>
      <Step n={1}>Go to <strong>Settings → App Settings</strong>.</Step>
      <Step n={2}>Paste your <strong>Anthropic</strong> or <strong>OpenAI</strong> API key.</Step>
      <Step n={3}>Save. AI features (analysis, Brief, recommendations) will now work.</Step>
      <P>API keys are stored locally on your device and never shared.</P>
    </div>
  )
}

function Features() {
  return (
    <div>
      <H3>Inbox <Badge color="blue">Main view</Badge></H3>
      <P>Browse all your ingested emails. Click any email to read it in the right panel.</P>
      <ul className="text-sm text-gray-600 space-y-1 mb-3 pl-4 list-disc">
        <li><strong>Search:</strong> type in the search box — uses AI semantic search + full-text</li>
        <li><strong>Pin search (📌):</strong> save any search query as a reusable smart folder</li>
        <li><strong>Priority labels:</strong> emails tagged <em>urgent</em>, <em>action</em>, or <em>finance</em> automatically</li>
        <li><strong>Thread indicator (↩):</strong> shows reply depth on threaded emails</li>
        <li><strong>Sort:</strong> sort by date, sender, or subject</li>
        <li><strong>Refresh:</strong> pulls new emails from the server without a full re-ingest</li>
        <li><strong>Import:</strong> find a specific email by pasting its subject line</li>
        <li><strong>Delete / Snooze:</strong> delete removes from local cache; snooze hides until a chosen date</li>
      </ul>

      <H3>Email Viewer</H3>
      <ul className="text-sm text-gray-600 space-y-1 mb-3 pl-4 list-disc">
        <li><strong>AI Analysis:</strong> get reply suggestions, action items, key points, and urgency</li>
        <li><strong>Ask:</strong> jump to Ask tab with context pre-filled about this email</li>
        <li><strong>Snooze:</strong> hide until a date you choose; reappears on next refresh</li>
        <li><strong>Sender name:</strong> click to open a contact card with history and stats</li>
        <li><strong>Reply suggestions → Draft:</strong> save a reply directly to your IMAP Drafts folder</li>
      </ul>

      <H3>Brief <Badge color="green">AI digest</Badge></H3>
      <P>
        Generates an AI summary of your most important recent emails. Auto-runs once per day on first visit.
        Click <strong>Generate Brief</strong> to refresh. Results are cached for 10 minutes.
      </P>

      <H3>Actions</H3>
      <P>
        Tracks to-do items extracted from your emails. Action items are saved automatically when AI analyzes
        an email. Mark done as you complete them. Use the <strong>CSV</strong> button to export to a spreadsheet.
      </P>

      <H3>Analytics</H3>
      <P>
        Charts and statistics: <strong>activity heatmap</strong> (GitHub-style calendar), volume trend line,
        top senders, and folder breakdown. The overdue badge on the Actions tab counts follow-ups past their
        due date. Use <strong>CSV</strong> to download the data.
      </P>

      <H3>Templates</H3>
      <P>
        Save frequently-used reply templates. Use variables: <code className="bg-gray-100 px-1 rounded text-xs">{'{subject}'}</code>,{' '}
        <code className="bg-gray-100 px-1 rounded text-xs">{'{sender}'}</code>,{' '}
        <code className="bg-gray-100 px-1 rounded text-xs">{'{name}'}</code>,{' '}
        <code className="bg-gray-100 px-1 rounded text-xs">{'{date}'}</code> to auto-fill content.
      </P>

      <H3>Health <Badge color="purple">Status</Badge></H3>
      <P>
        Shows the connection status of all components: IMAP server, AI provider, database, and the background
        polling loop. The colored dot in the tab indicates overall system health.
      </P>
    </div>
  )
}

function AIFeatures() {
  return (
    <div>
      <H3>Email Analysis</H3>
      <P>Select any email and click the <strong>Analyze</strong> button in the email viewer.</P>
      <P>The AI will:</P>
      <ul className="text-sm text-gray-600 space-y-1 mb-3 pl-4 list-disc">
        <li>Summarize the email in plain language</li>
        <li>Identify the tone and urgency level</li>
        <li>Suggest 2–3 reply options you can copy and adapt</li>
        <li>Extract action items you need to follow up on</li>
        <li>Show similar past emails from your inbox for context</li>
      </ul>
      <Note>Analysis results are cached for 60 seconds. Re-clicking Analyze on the same email within that window returns the cached result instantly.</Note>

      <H3>Daily Brief</H3>
      <P>
        Switch to the <strong>Brief</strong> tab and click <strong>Generate Brief</strong>. The AI reads your
        most recent emails and produces a 1-page executive summary. Configure the date range and number of
        emails to include in App Settings.
      </P>

      <H3>Semantic Search</H3>
      <P>
        The search box uses <strong>vector similarity search</strong> — you don't need exact keywords.
        Searching "invoice overdue" will also find emails about "payment late" or "unpaid bill".
        Full-text fallback is used when no semantic matches are found.
      </P>

      <H3>Auto-classification</H3>
      <P>
        The app automatically assigns categories to emails (Work, Personal, Newsletter, Finance, etc.).
        Categories appear in Analytics and can be used to filter the inbox.
      </P>

      <H3>Budget Mode</H3>
      <P>
        Enable <strong>Budget Mode</strong> in App Settings to use a smaller, cheaper AI model for routine
        tasks. This reduces API costs while keeping full AI capabilities for complex analysis.
      </P>
    </div>
  )
}

function KnowledgeBase() {
  return (
    <div>
      <H3>Knowledge Base <Badge color="purple">New</Badge></H3>
      <P>
        The <strong>Knowledge</strong> tab turns your email corpus into a structured knowledge base.
        It is designed for role transitions — when you join a new company and inherit someone's mailbox.
      </P>

      <H3>Role Briefing</H3>
      <P>Click <strong>"Brief me on this role"</strong> to generate an AI-powered executive briefing covering:</P>
      <ul className="text-sm text-gray-600 space-y-1 mb-3 pl-4 list-disc">
        <li><strong>Active projects</strong> — auto-detected ongoing topics and threads</li>
        <li><strong>Key relationships</strong> — who your predecessor communicated with most</li>
        <li><strong>Open commitments</strong> — unresolved promises, awaited responses, deadlines</li>
        <li><strong>Executive summary</strong> — AI narrative covering state of affairs and first-week actions</li>
      </ul>
      <Note>Briefing analysis scans up to 300 recent emails and takes 30–60 seconds the first time. Results are cached for 10 minutes.</Note>

      <H3>People Graph</H3>
      <P>
        Shows all contacts extracted from your email corpus with interaction stats: emails received from,
        sent to, last contact date, and recent subjects. Toggle between <strong>list</strong> and
        <strong>network graph</strong> views (☰/◎ buttons). Sort by relevance, volume, or recency.
        Use this to identify who to reach out to first when joining a new team.
      </P>

      <H3>Open Loops</H3>
      <P>
        AI scans recent emails for three types of open items:
      </P>
      <ul className="text-sm text-gray-600 space-y-1 mb-3 pl-4 list-disc">
        <li><strong>Commitments</strong> — "I will send", "I'll follow up", "we will…"</li>
        <li><strong>Awaiting</strong> — "please let me know", "waiting for your response"</li>
        <li><strong>Deadlines</strong> — time-sensitive items and mentioned dates</li>
      </ul>
      <P>Items are scored by urgency (high/medium/low) and filterable by type.</P>

      <H3>Projects</H3>
      <P>
        AI groups your emails into 6–12 topic clusters representing ongoing projects or recurring threads.
        Each cluster shows status (active / dormant / resolved), email count, and keywords.
        Click a project to jump to its Timeline view.
      </P>

      <H3>Timeline</H3>
      <P>
        Search any topic or keyword to see all related emails in chronological order — oldest to newest.
        Perfect for understanding how a situation evolved: "what happened with the contract renewal?" or
        "how did the hiring process unfold?". You can navigate here directly from a Projects cluster.
      </P>
    </div>
  )
}

function Tips() {
  return (
    <div>
      <H3>Keyboard shortcuts</H3>
      <ul className="text-sm text-gray-600 space-y-1 mb-3 pl-4 list-disc">
        <li><strong>j / k</strong> — navigate to the next / previous email</li>
        <li><strong>a</strong> — run AI Analysis on the selected email</li>
        <li><strong>Esc</strong> — deselect / close the current email</li>
      </ul>

      <H3>Snooze an email</H3>
      <P>
        Click the <strong>Snooze</strong> (clock) button in the email viewer to hide an email until a chosen date.
        It will reappear automatically when you refresh on or after that date.
      </P>

      <H3>Ask about a specific email</H3>
      <P>
        While reading an email, click the <strong>Ask</strong> (chat) button to jump to the Ask tab with a
        pre-filled question about that email. Great for quickly getting context or drafting a reply strategy.
      </P>

      <H3>Priority labels in the inbox</H3>
      <P>
        Emails are automatically tagged <strong>urgent</strong>, <strong>action</strong>, or <strong>finance</strong>
        based on keywords in the subject and preview — no configuration needed.
      </P>

      <H3>Keep emails fresh</H3>
      <ul className="text-sm text-gray-600 space-y-2 mb-3 pl-4 list-disc">
        <li>The app polls for new emails every 60 seconds automatically.</li>
        <li>Click <strong>Refresh</strong> in the toolbar for an immediate check. A green toast appears when new emails arrive.</li>
        <li>Use <strong>Import by subject</strong> to pull in a specific thread you know exists.</li>
        <li>The <strong>stats ribbon</strong> below the toolbar shows email count, unread, and overdue at a glance.</li>
      </ul>

      <H3>Configure the sync window</H3>
      <P>
        By default the app syncs emails from the last 7 days. Change <strong>Sync Window (days)</strong> in
        App Settings to go further back — useful if you want to search older email history.
        Re-run Ingest after changing this.
      </P>

      <H3>Multiple email accounts</H3>
      <P>
        You can connect multiple accounts (Gmail + Yahoo + work Office 365, for example). All accounts are
        searched together and appear in the same inbox view, prefixed by account.
      </P>

      <H3>Deleted emails</H3>
      <P>
        Deleting an email in Director Assistant only removes it from the <em>local cache</em> — it is not
        deleted from your mail server. If you re-ingest, it will come back.
      </P>

      <H3>Passwords are stored securely</H3>
      <P>
        App Passwords are stored in your operating system keychain (macOS Keychain / Windows Credential
        Manager), not in the app database.
      </P>

      <H3>Contact card</H3>
      <P>
        Click any sender name in the email viewer to open a contact card — total emails, first and last contact
        date, and recent subjects. Use the "Search all emails from this sender" link to filter the inbox instantly.
      </P>

      <H3>Save draft to mailbox</H3>
      <P>
        After AI Analysis, use the <strong>Draft</strong> button on any reply suggestion to save it directly to
        your IMAP Drafts folder. It appears in your mail client ready to review and send.
        Requires Gmail, Yahoo, or Office 365 — generic IMAP servers may not support APPEND.
      </P>

      <H3>Export data</H3>
      <P>
        Use the <strong>CSV</strong> button in Actions and Analytics to download your data as a spreadsheet.
        Import into Excel, Google Sheets, or any BI tool.
      </P>

      <H3>macOS dock badge</H3>
      <P>
        The app automatically updates the dock icon badge with your unread email count so you can monitor
        inbox activity without switching windows.
      </P>

      <H3>Running as a Docker container</H3>
      <P>
        For server or team deployments, use the included <code className="bg-gray-100 px-1 rounded text-xs">docker-compose.yml</code>:
      </P>
      <pre className="bg-gray-50 border border-gray-200 rounded-lg text-xs p-3 overflow-x-auto mb-3">
{`docker compose up -d
# App runs at http://localhost:8000`}
      </pre>
      <P>Email data persists in the <code className="bg-gray-100 px-1 rounded text-xs">director_data</code> Docker volume across restarts.</P>
    </div>
  )
}

const CONTENT: Record<Section, React.ReactNode> = {
  start:     <GettingStarted />,
  features:  <Features />,
  ai:        <AIFeatures />,
  knowledge: <KnowledgeBase />,
  tips:      <Tips />,
}

export function HelpModal({ onClose }: Props) {
  const [section, setSection] = useState<Section>('start')

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 flex-shrink-0">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Director Assistant — Help</h2>
            <p className="text-xs text-gray-500">Your AI-powered email assistant</p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd"/>
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar nav */}
          <nav className="w-44 flex-shrink-0 border-r border-gray-100 bg-gray-50 p-3 space-y-1">
            {SECTIONS.map(s => (
              <button
                key={s.id}
                onClick={() => setSection(s.id)}
                className={`w-full text-left text-sm px-3 py-2 rounded-lg transition-colors ${
                  section === s.id
                    ? 'bg-accent text-white font-medium'
                    : 'text-gray-600 hover:bg-gray-200'
                }`}
              >
                {s.label}
              </button>
            ))}
          </nav>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6">
            {CONTENT[section]}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-gray-100 bg-gray-50 flex items-center justify-between flex-shrink-0">
          <div>
            <span className="text-xs text-gray-400">Director Assistant v2.9.1</span>
            <span className="text-xs text-gray-300 mx-2">·</span>
            <a href="mailto:ali.salamat@cortexhq.ai" className="text-xs text-gray-400 hover:text-accent transition-colors">
              Ali Salamat
            </a>
          </div>
          <button
            onClick={onClose}
            className="text-xs bg-accent text-white px-4 py-1.5 rounded-lg hover:bg-blue-700 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
