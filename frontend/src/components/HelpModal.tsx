import { useState } from 'react'
import pkgJson from '../../package.json'

interface Props { onClose: () => void }

type Section = 'start' | 'inbox' | 'ai' | 'executive' | 'contacts' | 'projects' | 'knowledge' | 'dashboard' | 'import' | 'providers' | 'tips'

const SECTIONS: { id: Section; icon: string; label: string }[] = [
  { id: 'start',     icon: '🚀', label: 'Getting Started' },
  { id: 'inbox',     icon: '📥', label: 'Inbox & Email' },
  { id: 'ai',        icon: '✦',  label: 'AI Features' },
  { id: 'executive', icon: '📊', label: 'Executive Tools' },
  { id: 'contacts',  icon: '⭐', label: 'VIP & Contacts' },
  { id: 'projects',  icon: '📁', label: 'Projects' },
  { id: 'knowledge', icon: '🧠', label: 'Knowledge Base' },
  { id: 'dashboard', icon: '🖥',  label: 'Dashboard' },
  { id: 'import',    icon: '📦', label: 'Import PST / OLM' },
  { id: 'providers', icon: '🔀', label: 'AI Providers' },
  { id: 'tips',      icon: '💡', label: 'Tips & Shortcuts' },
]

// ── Shared components ─────────────────────────────────────────────────────────

function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="text-base font-bold text-gray-900 mb-4 pb-2 border-b border-gray-100">{children}</h2>
}
function H3({ children }: { children: React.ReactNode }) {
  return <h3 className="text-sm font-semibold text-gray-800 mt-5 mb-2 first:mt-0">{children}</h3>
}
function P({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-gray-600 leading-relaxed mb-2">{children}</p>
}
function Li({ children }: { children: React.ReactNode }) {
  return <li className="text-sm text-gray-600 leading-relaxed">{children}</li>
}
function UL({ children }: { children: React.ReactNode }) {
  return <ul className="space-y-1.5 mb-3 pl-4 list-disc">{children}</ul>
}
function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 mb-3">
      <span className="flex-shrink-0 w-5 h-5 rounded-full bg-accent text-white text-[10px] font-bold flex items-center justify-center mt-0.5">{n}</span>
      <span className="text-sm text-gray-600 leading-relaxed">{children}</span>
    </div>
  )
}
function Note({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-800 mb-3 leading-relaxed">
      {children}
    </div>
  )
}
function Tip({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-xs text-blue-800 mb-3 leading-relaxed">
      {children}
    </div>
  )
}
function Tag({ children, color = 'blue' }: { children: React.ReactNode; color?: 'blue' | 'green' | 'purple' | 'orange' | 'gray' }) {
  const cls = {
    blue:   'bg-blue-100 text-blue-700',
    green:  'bg-green-100 text-green-700',
    purple: 'bg-purple-100 text-purple-700',
    orange: 'bg-orange-100 text-orange-700',
    gray:   'bg-gray-100 text-gray-600',
  }[color]
  return <span className={`inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wide ${cls} mr-1`}>{children}</span>
}
function KBD({ children }: { children: React.ReactNode }) {
  return <kbd className="px-1.5 py-0.5 bg-gray-100 border border-gray-300 rounded text-[11px] font-mono text-gray-700">{children}</kbd>
}
function FeatureRow({ label, desc }: { label: string; desc: string }) {
  return (
    <div className="flex gap-3 py-2 border-b border-gray-50 last:border-0">
      <span className="text-sm font-medium text-gray-800 w-40 flex-shrink-0">{label}</span>
      <span className="text-sm text-gray-600 leading-relaxed">{desc}</span>
    </div>
  )
}

// ── Section content ────────────────────────────────────────────────────────────

function GettingStarted() {
  return (
    <div>
      <H2>Getting Started</H2>
      <H3>Step 1 — Add your AI key</H3>
      <Step n={1}>Go to <strong>Settings → App Settings</strong> (gear icon, top right).</Step>
      <Step n={2}>Paste your <strong>Anthropic API key</strong> (get one free at <em>console.anthropic.com</em>) or an OpenAI key.</Step>
      <Step n={3}>Click <strong>Save</strong>. The key is stored locally on your device and never shared.</Step>
      <Tip>Use Anthropic Claude for best results. OpenAI is the automatic fallback if Claude is unavailable.</Tip>

      <H3>Step 2 — Connect your email account</H3>
      <Step n={1}>Go to <strong>Settings → Email Accounts → Add Account</strong>.</Step>
      <Step n={2}>Choose your provider: <strong>Gmail</strong>, <strong>Microsoft 365</strong>, <strong>Yahoo</strong>, or <strong>IMAP</strong>.</Step>
      <Step n={3}>For Gmail and Microsoft, click <strong>Sign in with Google / Microsoft</strong> (OAuth2 — no App Password needed).</Step>
      <Step n={4}>For Yahoo and other IMAP accounts, enter your email address and an <strong>App Password</strong>.</Step>
      <Note><strong>App Passwords</strong> are required for Yahoo and plain-IMAP accounts because those providers block regular passwords for third-party apps. Enable 2-step verification first, then generate an App Password from your account's Security settings.</Note>

      <H3>Step 3 — Ingest your emails</H3>
      <Step n={1}>After connecting, click <strong>Ingest</strong> next to your account in Settings.</Step>
      <Step n={2}>The app downloads and indexes your emails (Inbox, Sent, and Bulk/Spam). Large mailboxes may take a few minutes — progress is shown on-screen.</Step>
      <Step n={3}>Once complete, your emails appear in the <strong>Inbox</strong> tab. AI features are active immediately.</Step>
      <P>Your emails are stored locally in a SQLite database on your device. Nothing is uploaded to any server.</P>

      <H3>You're ready — here's where to start</H3>
      <UL>
        <Li><strong>Inbox</strong> — browse your emails; click any to read and action it</Li>
        <Li><strong>Focus</strong> — see your top 7 priority emails, AI-scored by urgency</Li>
        <Li><strong>Weekly</strong> — generate your first weekly executive brief</Li>
        <Li><strong>Ask</strong> — ask a natural-language question about your email history</Li>
      </UL>
    </div>
  )
}

function InboxEmail() {
  return (
    <div>
      <H2>Inbox & Email</H2>

      <H3>Inbox view</H3>
      <div className="mb-4">
        <FeatureRow label="Folder bar" desc="All IMAP folders shown at top — Inbox highlighted in indigo. Click any folder to switch." />
        <FeatureRow label="Unread filter" desc="Click the 'N unread' badge in the toolbar to show all unread emails across all folders. Click again to return." />
        <FeatureRow label="Priority labels" desc="Emails auto-tagged urgent, action, or finance based on keywords in subject and preview." />
        <FeatureRow label="Hover preview" desc="Hover over any email for 600ms to see a 1-sentence AI summary without opening it." />
        <FeatureRow label="New badge" desc="Green 'New' pill on emails received in the last 4 hours that are still unread." />
        <FeatureRow label="Read-time" desc="~Nm read-time estimate on each email so you can triage by effort." />
        <FeatureRow label="Thread depth" desc="↩ N indicator shows reply-chain depth on threaded emails." />
        <FeatureRow label="Smart sort" desc="Sort by date, sender, or subject (asc/desc), or switch to AI urgency ranking with the Priority button." />
        <FeatureRow label="Pinned searches" desc="Click 📌 while searching to save a query as a persistent smart folder." />
        <FeatureRow label="Bulk select" desc="Checkbox appears on hover — select multiple emails to bulk delete, snooze, or generate AI drafts for all." />
        <FeatureRow label="Auto-poll" desc="New emails checked every 60 seconds automatically. Click Refresh for an immediate check." />
      </div>

      <H3>Email viewer</H3>
      <div className="mb-4">
        <FeatureRow label="AI Analysis" desc="Click Analyze (✦) for key points, urgency score, action items, reply suggestions, and similar past emails." />
        <FeatureRow label="Smart Draft" desc="One click generates a full, ready-to-send reply using thread history, documents, and your writing style." />
        <FeatureRow label="Quick Replies" desc="Click '✦ Quick replies' to get Short, Detailed, and Formal options — click any to pre-fill the compose window." />
        <FeatureRow label="Tone Adjuster" desc="Rewrite your draft in a different tone: Formal / Casual / Shorter / Friendlier / Direct." />
        <FeatureRow label="Send-time hint" desc="When composing a reply, a green hint shows the best time to send based on the recipient's historical activity." />
        <FeatureRow label="Translate" desc="Translate the email body inline with automatic language detection. 20 languages supported." />
        <FeatureRow label="Summarize thread" desc="Distill any email chain into a summary, key bullet points, and next-step outcome." />
        <FeatureRow label="Project linker" desc="Click the Project button to link this email to any of your named projects." />
        <FeatureRow label="Snooze" desc="Hide an email until a date you choose — it reappears automatically." />
        <FeatureRow label="Remind me" desc="Set a follow-up reminder for tomorrow, in 3 days, or in a week." />
        <FeatureRow label="Create event" desc="Opens an inline calendar event form pre-filled from the email; creates in Microsoft Calendar." />
        <FeatureRow label="Unsubscribe" desc="Auto-detects unsubscribe links. 'Unsub' button appears when found." />
        <FeatureRow label="Ask AI" desc="Jump to the Ask tab with this email pre-loaded as context." />
      </div>

      <H3>Compose & Send</H3>
      <UL>
        <Li>Send new emails or replies directly from Director Assistant</Li>
        <Li><strong>Pre-send Review</strong> — click <strong>🔍 Review</strong> before sending; AI checks tone, flags unanswered questions, lists commitments, and suggests improvements. Send button turns green when the draft passes.</Li>
        <Li><strong>Save to Drafts</strong> — save any AI reply to your IMAP Drafts folder for review in your mail client</Li>
        <Li><strong>Scheduled Send</strong> — compose now, choose a future date/time, and the app sends automatically</Li>
        <Li><strong>Commitment detection</strong> — after Smart Draft, detected promises appear as pills to add to your Actions board</Li>
      </UL>
    </div>
  )
}

function AISection() {
  return (
    <div>
      <H2>AI Features</H2>

      <H3>Email Analysis <Tag color="blue">One click</Tag></H3>
      <P>Select any email and click <strong>AI Analysis (✦)</strong>. The AI panel on the right shows:</P>
      <UL>
        <Li><strong>Summary</strong> — plain-language explanation of what the email is asking</Li>
        <Li><strong>Urgency score</strong> — Low / Medium / High / Critical with reasoning</Li>
        <Li><strong>Key points</strong> — bullet list of the most important facts</Li>
        <Li><strong>Action items</strong> — things you need to do, extracted automatically</Li>
        <Li><strong>Reply suggestions</strong> — 2–3 response options you can copy or adapt</Li>
        <Li><strong>Similar emails</strong> — past emails from your inbox for context</Li>
      </UL>
      <Note>Results are cached for 60 seconds. Re-clicking Analyze within that window returns instantly. High-urgency emails are analyzed automatically in the background when they arrive.</Note>

      <H3>Smart Draft Composer</H3>
      <P>Click <strong>✎ Smart Draft</strong> in any email to generate a complete, ready-to-send reply.</P>
      <P>The AI considers:</P>
      <UL>
        <Li>The full conversation thread (up to 5 prior messages)</Li>
        <Li>Related documents from your knowledge base</Li>
        <Li>Your recent sent emails as a style reference</Li>
      </UL>
      <P>One click pre-fills the compose window. Use the Tone Adjuster to refine if needed.</P>

      <H3>Semantic Search</H3>
      <P>The search box uses <strong>vector similarity</strong> — you don't need exact keywords. "Invoice overdue" also finds "payment late" or "unpaid bill". Full-text fallback runs when no semantic matches are found.</P>

      <H3>Auto-Classification</H3>
      <P>Every email is automatically classified in the background (Work, Personal, Newsletter, Finance, etc.). Categories appear in Analytics and can be used for filtering.</P>

      <H3>Proactive Alert Engine</H3>
      <P>Background tasks run every 30–90 seconds and surface insights as toast notifications and desktop alerts:</P>
      <UL>
        <Li><strong>Deadline detection</strong> — scans new emails for deadlines and creates follow-up reminders</Li>
        <Li><strong>Cluster alerts</strong> — notifies when 3+ new emails share the same topic</Li>
        <Li><strong>Sentiment escalation</strong> — alerts when a VIP sends a frustrated or demanding message</Li>
        <Li><strong>Commitment scan</strong> — every 30 min, scans sent mail and adds commitments to Actions</Li>
        <Li><strong>Relationship health</strong> — every 2 hours, detects when important contacts are waiting too long</Li>
      </UL>

      <H3>Budget Mode</H3>
      <P>Enable <strong>Budget Mode</strong> in App Settings to use Claude Haiku for routine tasks, keeping Sonnet for complex analysis. Reduces API costs by 10–20× while maintaining full capability.</P>
    </div>
  )
}

function ExecutiveTools() {
  return (
    <div>
      <H2>Executive Tools</H2>

      <H3>Weekly Executive Brief <Tag color="purple">New</Tag></H3>
      <P>Go to the <strong>Weekly</strong> tab and click <strong>Generate Brief</strong>. The AI analyses your past 7 days and produces:</P>
      <UL>
        <Li><strong>Summary</strong> — 2–3 sentence executive overview of the week</Li>
        <Li><strong>Top Action Items</strong> — most important things to do next</Li>
        <Li><strong>Commitments Made</strong> — promises you made that need follow-through</Li>
        <Li><strong>Waiting For</strong> — responses you're still expecting from others</Li>
        <Li><strong>Upcoming Deadlines</strong> — time-sensitive items surfaced from your emails</Li>
        <Li><strong>Key Decisions</strong> — decisions made or agreed upon this week</Li>
        <Li><strong>Wins</strong> — positive outcomes and progress to acknowledge</Li>
        <Li><strong>Relationships to Nurture</strong> — contacts who may need attention</Li>
      </UL>
      <Note>The brief is cached for 1 hour. Click ↺ Refresh to force a new generation. Uses Claude Sonnet for depth.</Note>

      <H3>Smart Daily Triage (Focus Tab)</H3>
      <P>Switch to <strong>Focus</strong> to see your top 7 priority unread emails, AI-scored using 7 signals:</P>
      <UL>
        <Li>Urgency keywords (urgent, deadline, ASAP, critical)</Li>
        <Li>Open action items and commitments</Li>
        <Li>VIP sender status</Li>
        <Li>Email recency</Li>
        <Li>Direct questions requiring your response</Li>
        <Li>Relationship health signals</Li>
        <Li>Deadline proximity</Li>
      </UL>
      <P>Score badges <strong>!</strong> / <strong>!!</strong> / <strong>!!!</strong> and reason tags explain exactly why each email was flagged. Click any to jump directly to it. Refreshes every 5 minutes.</P>

      <H3>Chase Queue (Follow-up Drafts) <Tag color="orange">New</Tag></H3>
      <P>Go to the <strong>Chase</strong> tab to see all emails you sent with no reply after 3+ days.</P>
      <UL>
        <Li>Color-coded urgency: 3+ days (neutral) / 7+ days (amber) / 14+ days (red)</Li>
        <Li>Adjust the threshold with the dropdown (2 / 3 / 7 / 14+ days)</Li>
        <Li>Click <strong>✎ Write follow-up</strong> to generate an AI polite chase draft</Li>
        <Li>Open in Compose or copy to clipboard in one click</Li>
      </UL>

      <H3>Daily Brief</H3>
      <P>The <strong>Brief</strong> tab produces a daily AI digest of your most important recent emails, grouped by topic with action items highlighted. Configure the date range in the tab. Cached for 10 minutes.</P>

      <H3>Send-Time Optimizer <Tag color="green">New</Tag></H3>
      <P>When you click <strong>Reply</strong> on any email, a green hint appears below the To field: <strong>"Best time to send: Tuesday at 9:00 AM"</strong>. This is calculated from the recipient's historical email activity patterns — when they're most active and likely to respond quickly.</P>

      <H3>Actions Board</H3>
      <UL>
        <Li><strong>Auto-extracted</strong> — AI finds commitments in every incoming email</Li>
        <Li><strong>Overdue badge</strong> — red count badge on the Actions tab for past-due items</Li>
        <Li><strong>Waiting for Reply</strong> — sent emails 3+ days old with no response</Li>
        <Li><strong>Scan sent mail</strong> — AI scans your sent mail and surfaces commitments you made</Li>
        <Li><strong>CSV export</strong> — export all pending action items as a spreadsheet</Li>
        <Li><strong>Copy checklist</strong> — one-click copy of all items as a Markdown checklist</Li>
      </UL>
    </div>
  )
}

function ContactsSection() {
  return (
    <div>
      <H2>VIP Contacts & Relationship Tracking</H2>

      <H3>VIP Contact Manager <Tag color="purple">New</Tag></H3>
      <P>Go to the <strong>VIP</strong> tab. Click <strong>+ Add VIP</strong> to star your most important contacts.</P>
      <P>Each VIP card shows:</P>
      <UL>
        <Li><strong>Total emails</strong> received from and sent to this contact</Li>
        <Li><strong>Last contact</strong> — how many days ago you last heard from them</Li>
        <Li><strong>Last sent</strong> — when you last reached out to them</Li>
        <Li><strong>Unread count</strong> — emails from this contact you haven't read yet</Li>
        <Li><strong>Awaiting reply</strong> — amber badge when you sent them something more recently than their last reply</Li>
      </UL>
      <P>Click <strong>Emails</strong> to see a scrollable timeline of all emails to/from that contact. Click any email to open it.</P>
      <Tip>Use VIP contacts to ensure you never miss a message from your board, key clients, or direct reports. The awaiting-reply flag is your early warning system.</Tip>

      <H3>Contact Card</H3>
      <P>Click any sender name in the email viewer to open a contact card showing:</P>
      <UL>
        <Li>Total emails received and sent to this person</Li>
        <Li>First and last contact dates</Li>
        <Li>Recent email subjects</Li>
        <Li>AI-written relationship summary and unreplied count</Li>
        <Li>Average response time</Li>
        <Li>Monthly volume chart (last 6 months)</Li>
        <Li><strong>Find on LinkedIn</strong> — pre-filled people search using their name and company</Li>
        <Li><strong>Filter inbox</strong> to show all emails from this sender</Li>
      </UL>

      <H3>Proactive Relationship Alerts</H3>
      <P>The alert engine runs every 2 hours and notifies you when an important contact has been waiting too long for a reply — so you never let a key relationship go cold by accident.</P>
    </div>
  )
}

function ProjectsSection() {
  return (
    <div>
      <H2>Email-to-Project Tracker</H2>

      <H3>Overview <Tag color="purple">New</Tag></H3>
      <P>Go to the <strong>Projects</strong> tab to organize emails into named deals, initiatives, or topics — so you can find everything related to a project in one place instead of searching through your inbox.</P>

      <H3>Create a project</H3>
      <Step n={1}>Click <strong>+ New</strong> in the Projects tab.</Step>
      <Step n={2}>Enter a name (e.g. "Q3 Enterprise Deal — Acme Corp") and optional description.</Step>
      <Step n={3}>The project is created with <strong>Active</strong> status.</Step>

      <H3>Link emails to a project</H3>
      <P><strong>From the email viewer:</strong> click the <strong>Project</strong> button in the header toolbar. A dropdown shows all your active projects — click one to link or unlink the email. The button changes to show how many projects the email is linked to.</P>
      <P><strong>From the Projects tab:</strong> open a project to see all linked emails in chronological order.</P>

      <H3>Project statuses</H3>
      <UL>
        <Li><strong>Active</strong> (green) — ongoing work</Li>
        <Li><strong>Paused</strong> (amber) — temporarily on hold</Li>
        <Li><strong>Resolved</strong> (gray) — completed or closed</Li>
      </UL>
      <P>Click the status badge on any project card to cycle through statuses.</P>

      <H3>Filter and browse</H3>
      <P>Use the All / Active / Paused / Resolved filter bar at the top of the Projects tab. Each button shows a live count. Click any project to see its full email timeline. Click any email to open it in the inbox viewer.</P>

      <H3>Tips</H3>
      <Tip>Link emails as you read them — the Project button is right in the email toolbar. After a client call, quickly link all related emails from the last few days to keep the thread organized.</Tip>
    </div>
  )
}

function KnowledgeSection() {
  return (
    <div>
      <H2>Knowledge Base & Intelligence</H2>

      <H3>Navigation</H3>
      <P>The Knowledge tab has a <strong>left mini-sidebar</strong> with two groups of sub-sections — all visible at once with no scrolling:</P>
      <div className="mb-4">
        <FeatureRow label="Intelligence group" desc="Role Briefing · People Graph · Open Loops · AI Clusters · Topic Timeline" />
        <FeatureRow label="Tools group" desc="Weekly Brief · Chase Queue · Projects · Analytics · Templates · Import PST/OLM" />
      </div>
      <P>Click any item in the left sidebar to switch sections. The active section is highlighted with a blue left border.</P>

      <H3>People Graph</H3>
      <P>Automatically built from your email corpus. Shows all contacts with:</P>
      <UL>
        <Li>Total emails sent and received, first and last contact dates, recent subjects</Li>
        <Li><strong>📞 Phone numbers</strong> — auto-populated from email signatures, Microsoft 365 Contacts, and indexed documents; shown as clickable tel: chips</Li>
        <Li><strong>★ / ☆ VIP star</strong> — filled amber star = VIP contact (amber row highlight); outline star = not VIP. Click to toggle. Changes sync instantly to the VIP tab.</Li>
      </UL>
      <P>Sort by <strong>Relevance</strong>, <strong>Volume</strong>, or <strong>Recency</strong>. Search by name or email.</P>
      <H3>Contact Import, Export &amp; Cleanup</H3>
      <UL>
        <Li><strong>📥 File</strong> — import from <strong>.vcf</strong> (Google, Apple, Outlook) or <strong>.csv</strong> (Yahoo Mail exports CSV — go to contacts.yahoo.com → Export as CSV); duplicates skipped automatically</Li>
        <Li><strong>☁️ Sync</strong> — auto-sync Microsoft 365 address book via Graph API (requires Contacts.Read — if it fails, remove and re-add your M365 account in Settings)</Li>
        <Li><strong>📤 Export</strong> — downloads all contacts + phone numbers as <code>director-assistant-contacts.vcf</code>; import into any contacts app</Li>
        <Li><strong>✏️ Edit button</strong> on each card — opens an inline form with editable <strong>Name</strong>, a <strong>Phone list</strong> (add / remove rows), and a free-text <strong>Note</strong> field. Click Save to persist. Works for any contact — even ones only in email history (creates a record on first save).</Li>
        <Li><strong>🔍 Dupes</strong> — scans for contacts with the same name imported from multiple sources. Shows <strong>⚡ Merge N dupes</strong> (amber) if found — click to combine phone numbers and remove duplicates</Li>
        <Li><strong>✕ button</strong> on each contact card — hides that person from the People list. A "N hidden — show" link appears below the toolbar; click it to reveal hidden contacts and restore any with ↩</Li>
      </UL>
      <H3>Consolidate duplicate accounts</H3>
      <P>If you connected the same email address twice (e.g., once via IMAP and once via Microsoft OAuth), an <strong>⚡ Consolidate duplicates</strong> button appears in <strong>Settings → Email Accounts</strong>. It keeps the OAuth account (preferred), re-attributes all emails, and removes the duplicate.</P>

      <H3>Open Loops</H3>
      <P>Click <strong>Scan emails</strong> to let AI find all unresolved items in your recent emails:</P>
      <UL>
        <Li><strong>Commitments</strong> — "I will send", "we'll follow up", "I'll get back to you"</Li>
        <Li><strong>Awaiting</strong> — "please let me know", "waiting for your response", "can you confirm?"</Li>
        <Li><strong>Deadlines</strong> — time-sensitive mentions and specific dates</Li>
      </UL>
      <P>Each item has an urgency badge (high / medium / low). Filter by type — buttons show live counts including dismissed items. Mark items as resolved with the ✓ button; restore them from the Dismissed section.</P>

      <H3>Projects (AI Clusters)</H3>
      <P>AI automatically groups your emails into 6–12 topic clusters representing ongoing projects or recurring threads. Each cluster shows:</P>
      <UL>
        <Li>Status: Active / Dormant / Resolved</Li>
        <Li>Email count and last activity date</Li>
        <Li>Top keywords</Li>
      </UL>
      <P>Click any cluster to jump to its Timeline view.</P>

      <H3>Topic Timeline</H3>
      <P>Search any keyword or topic to see all related emails in chronological order — oldest to newest. Useful for reconstructing how a situation evolved: "what happened with the contract renewal?" or "how did the hiring process unfold?"</P>

      <H3>Executive Briefing</H3>
      <P>Click <strong>"Brief me on this role"</strong> in the Briefing tab to generate an AI-powered overview covering active projects, key relationships, open commitments, and recommended first-week actions. Scans up to 300 recent emails. Takes 30–60 seconds the first time; cached for 10 minutes.</P>

      <H3>Ask — Second Brain Search</H3>
      <P>The <strong>Ask</strong> tab uses hybrid search (dense vector + full-text) to answer natural-language questions across <strong>emails, documents, and contact notes</strong>:</P>
      <UL>
        <Li>"What did John say about the contract?"</Li>
        <Li>"When is the next board meeting?"</Li>
        <Li>"What did I note about Acme?"  ← searches contact notes</Li>
        <Li>"Find all emails about the Q3 budget"</Li>
      </UL>
      <P>Results show source badges — <strong>Email</strong>, <strong>Document</strong>, or <strong>Contact</strong> (emerald). Contact notes are indexed from the People tab's edit panel. All previous Ask queries are saved in the history panel.</P>

      <H3>Document Q&A</H3>
      <P>Index local folders (PDFs, Word docs, Excel files, text files) in <strong>Settings → Documents</strong>. Indexed documents are fully searchable alongside emails and contact notes in the Ask tab.</P>

      <H3>🎙 Meetings — Live Meeting Intelligence</H3>
      <P>Open <strong>Knowledge → 🎙 Meetings</strong>.</P>
      <UL>
        <Li>Click <strong>Start Recording</strong> — browser microphone captures audio (you'll be prompted for mic access)</Li>
        <Li>Click <strong>Stop</strong> — OpenAI Whisper transcribes the recording</Li>
        <Li>Claude extracts <strong>Action Items</strong> (click "+ Actions" to save to your action board) and writes a <strong>Follow-up Draft</strong> email (click Copy)</Li>
        <Li>Full transcript available in a collapsible section</Li>
      </UL>
      <Note>Requires an <strong>OpenAI API key</strong> in Settings → App Settings (used for Whisper transcription only).</Note>

      <H3>💼 CRM — Deal Pipeline</H3>
      <P>Open <strong>Knowledge → 💼 CRM</strong> for a 5-column Kanban pipeline.</P>
      <UL>
        <Li>Stages: <strong>Prospect → Active → Negotiating → Won → Lost</strong></Li>
        <Li><strong>✨ AI Extract Deals</strong> — scans recent emails and suggests deals to add; approve or dismiss each suggestion</Li>
        <Li><strong>+ New Deal</strong> — manually create a deal with name, contact email, value, and notes</Li>
        <Li>Click a deal card to expand it, then use the arrow buttons to move it to the next or previous stage, or delete it</Li>
      </UL>
    </div>
  )
}

function DashboardSection() {
  return (
    <div>
      <H2>Executive Dashboard</H2>
      <P>Open the dashboard at <a href="/api/dashboard" target="_blank" className="text-accent hover:underline font-medium">http://localhost:8000/api/dashboard</a> — a full-screen dark-theme executive brief that updates every 30 minutes.</P>

      <H3>KPI Tiles</H3>
      <P>Seven live metrics at the top — click any tile to jump to that section:</P>
      <UL>
        <Li><strong>Open Actions</strong> — pending action items (red if any) → scrolls to Action Items</Li>
        <Li><strong>Unread Emails</strong> — unread count across all folders → scrolls to Unread Emails</Li>
        <Li><strong>Chase Queue</strong> — sent emails with no reply in 3+ days → scrolls to Chase Queue</Li>
        <Li><strong>VIP Alerts</strong> — VIP contacts needing your attention → scrolls to VIP Status</Li>
        <Li><strong>Meetings Tomorrow</strong> — events from your connected calendar → scrolls to Schedule</Li>
        <Li><strong>Active Projects</strong> — projects you created in the Projects tab → scrolls to Projects</Li>
        <Li><strong>VIP Contacts</strong> — total VIP contacts being tracked → scrolls to VIP Status</Li>
      </UL>

      <H3>Sections — click any item for full detail</H3>
      <div className="mb-4">
        <FeatureRow label="Needs Attention" desc="Urgent action items and overdue follow-ups shown as clickable orange tags at the top." />
        <FeatureRow label="VIP Alert row" desc="Pulsing cards for VIP contacts who are awaiting your reply or have unread messages." />
        <FeatureRow label="Tomorrow's Schedule" desc="Calendar events from Microsoft 365 with time, organizer, response status, and Join Meeting button." />
        <FeatureRow label="Follow-ups Due" desc="Pending follow-ups with due dates and Reply by Email button." />
        <FeatureRow label="Chase Queue" desc="Emails you sent with no reply — 3d (blue) / 7d (amber) / 14d+ (red). AI can write a follow-up draft." />
        <FeatureRow label="VIP Contact Status" desc="All VIP contacts with last contact date, unread count, and awaiting-reply badge." />
        <FeatureRow label="Your Projects" desc="User-created projects with status (Active / Paused) and linked email count." />
        <FeatureRow label="Unread Emails" desc="Most recent unread emails with full preview on click." />
        <FeatureRow label="Action Items" desc="Open action items — click to see full text and mark as done." />
        <FeatureRow label="Training & Learning" desc="Emails detected as training, course, or certification related." />
        <FeatureRow label="Top Senders" desc="Who emails you most — bar chart." />
        <FeatureRow label="OneDrive / Teams" desc="Recent files and chats (requires Microsoft OAuth)." />
        <FeatureRow label="Email Volume" desc="Bar chart of emails received over the last 7 days." />
      </div>

      <H3>Action buttons in the detail modal</H3>
      <P>Every item opens a modal with the full content. Context-specific buttons appear at the top:</P>
      <UL>
        <Li><strong>↗ Open in App</strong> — opens the exact email in Director Assistant (new tab, navigates directly)</Li>
        <Li><strong>✉ Reply by Email</strong> — opens your mail client pre-addressed to the sender</Li>
        <Li><strong>✓ Mark Done</strong> — marks action items complete instantly; the item disappears from the list immediately (enable "Show done" to see completed items)</Li>
        <Li><strong>✎ Generate Follow-up Draft</strong> — AI writes a chase email; editable textarea appears with Copy and Send via App buttons</Li>
        <Li><strong>▶ Join Meeting</strong> — opens the Teams/Zoom/Meet link for online calendar events</Li>
      </UL>
      <Tip>The "Open in App" button opens a new tab at <code className="bg-gray-100 px-1 rounded text-xs">/?email=ID</code> and Director Assistant automatically loads that email in the viewer. No searching required.</Tip>

      <H3>Auto-refresh</H3>
      <P>The dashboard reloads automatically every 30 minutes. A countdown timer in the top-right shows when the next refresh happens. Click <strong>Refresh now</strong> to force an immediate reload.</P>
    </div>
  )
}

function ProvidersSection() {
  return (
    <div>
      <H2>AI Providers — Priority & Configuration</H2>
      <P>Director Assistant supports multiple AI providers. You can configure which is primary, set fallbacks, and reorder them in <strong>Settings → App Settings → AI Providers</strong>.</P>

      <H3>Supported providers</H3>
      <div className="mb-4">
        <FeatureRow label="🤖 Anthropic Claude" desc="Primary by default. claude-haiku (fast/cheap), claude-sonnet (balanced), claude-opus (most capable). Get a key at console.anthropic.com." />
        <FeatureRow label="🧠 OpenAI GPT" desc="GPT-4o-mini (budget), GPT-4o (capable). Used as fallback or primary. Get a key at platform.openai.com." />
        <FeatureRow label="⚡ Groq" desc="Ultra-fast inference using Llama 3.3 70B, Mixtral, Gemma. Free tier available. Great cost-effective fallback. Key from console.groq.com." />
        <FeatureRow label="🌟 Google Gemini" desc="gemini-1.5-flash (fast), gemini-1.5-pro (capable). Key from Google AI Studio (aistudio.google.com). Requires: pip install google-generativeai." />
        <FeatureRow label="🦙 Ollama (local)" desc="Run models locally — Llama 3.2, Mistral, Phi-3, Qwen. No API costs, no key needed. Requires Ollama installed at localhost:11434." />
        <FeatureRow label="🌙 Kimi (Moonshot AI)" desc="moonshot-v1-8k/32k/128k models. OpenAI-compatible API at api.moonshot.cn. Key from platform.moonshot.cn." />
        <FeatureRow label="🔗 OpenAI-compatible" desc="Any OpenAI-compatible endpoint — Together AI, Perplexity, Mistral, Azure OpenAI, etc. Paste your base URL and key." />
      </div>

      <H3>How priority works</H3>
      <P>The app tries providers in order from top to bottom. If the primary provider hits a rate limit, quota error, or authentication error, it automatically switches to the next enabled provider — silently, without interrupting your workflow.</P>
      <UL>
        <Li>First enabled provider = <strong>Primary</strong> (all requests go here)</Li>
        <Li>Second enabled provider = <strong>Fallback</strong> (used when primary fails)</Li>
        <Li>Additional providers = additional fallback layers</Li>
      </UL>

      <H3>Changing priority</H3>
      <Step n={1}>Go to <strong>Settings → App Settings</strong> (gear icon).</Step>
      <Step n={2}>Find the <strong>AI Providers</strong> section at the top.</Step>
      <Step n={3}>Click <strong>▲ ▼</strong> arrows on any provider card to move it up or down.</Step>
      <Step n={4}>The first enabled card shows a green <strong>Primary</strong> badge; the second shows <strong>Fallback</strong>.</Step>
      <Step n={5}>Click <strong>Save order & settings</strong> to apply immediately — no restart needed.</Step>

      <H3>Adding a new provider</H3>
      <Step n={1}>Click <strong>+ Add provider</strong> in the AI Providers section.</Step>
      <Step n={2}>Choose the provider type (Anthropic, Groq, Kimi, etc.).</Step>
      <Step n={3}>Paste your API key. For Ollama, no key is needed.</Step>
      <Step n={4}>Optionally set a model override (or leave blank to use the auto-mapping).</Step>
      <Step n={5}>Click <strong>🔌 Test connection</strong> to verify the key works, then <strong>Save</strong>.</Step>

      <H3>Auto model mapping</H3>
      <P>When the app internally requests a Claude model (e.g. <code className="bg-gray-100 px-1 rounded text-xs">claude-sonnet-4-6</code>) but a non-Anthropic provider is active, the model is automatically mapped:</P>
      <div className="mb-4 text-xs">
        <FeatureRow label="→ OpenAI" desc="claude-haiku → gpt-4o-mini · claude-sonnet → gpt-4o" />
        <FeatureRow label="→ Groq" desc="claude-haiku → llama-3.1-8b-instant · claude-sonnet → llama-3.3-70b-versatile" />
        <FeatureRow label="→ Gemini" desc="claude-haiku → gemini-1.5-flash · claude-sonnet → gemini-1.5-pro" />
        <FeatureRow label="→ Kimi" desc="claude-haiku → moonshot-v1-8k · claude-sonnet → moonshot-v1-32k" />
      </div>
      <Tip>Set a <strong>model override</strong> on a provider to always use a specific model for that provider, ignoring the auto-mapping.</Tip>

      <H3>Budget Mode</H3>
      <P>Enable <strong>Budget Mode</strong> in App Settings to force the cheapest model on each provider: claude-haiku on Anthropic, gpt-4o-mini on OpenAI, llama-3.1-8b-instant on Groq, etc. Useful for reducing API costs on routine tasks.</P>
    </div>
  )
}

function TipsSection() {
  return (
    <div>
      <H2>Tips & Keyboard Shortcuts</H2>

      <H3>Keyboard shortcuts</H3>
      <div className="space-y-2 mb-4">
        {[
          { key: 'j / k', desc: 'Navigate to next / previous email in the list' },
          { key: 'a', desc: 'Run AI Analysis on the selected email' },
          { key: 'Esc', desc: 'Deselect / close the current email' },
          { key: '⌘ N', desc: 'Open the Compose window for a new email' },
        ].map(({ key, desc }) => (
          <div key={key} className="flex items-center gap-3">
            <div className="flex gap-1 flex-shrink-0 w-28">
              {key.split(' / ').map((k, i) => (
                <span key={i} className="flex items-center gap-1">
                  <KBD>{k}</KBD>
                  {i < key.split(' / ').length - 1 && <span className="text-gray-400 text-xs">/</span>}
                </span>
              ))}
            </div>
            <span className="text-sm text-gray-600">{desc}</span>
          </div>
        ))}
      </div>

      <H3>Workflow tips</H3>
      <UL>
        <Li><strong>Start your day with Focus</strong> — the 7 scored emails tell you what to do first without reading everything.</Li>
        <Li><strong>Monday morning</strong> — hit Weekly to get your executive brief before checking the inbox.</Li>
        <Li><strong>Link as you go</strong> — use the Project button whenever you open an important email. Takes 2 seconds.</Li>
        <Li><strong>VIP first</strong> — check the VIP tab daily; the awaiting-reply badge tells you who needs a response before they chase you.</Li>
        <Li><strong>Chase queue</strong> — check every Thursday; anything 3+ days old with no reply needs follow-up before the weekend.</Li>
      </UL>

      <H3>Multiple email accounts</H3>
      <P>Connect as many accounts as you like (Gmail + Yahoo + Office 365). All accounts are searched together and appear in the same Inbox, prefixed by account number. Use the account filter bar at the top of the email list to isolate a specific account.</P>

      <H3>Sync window</H3>
      <P>By default, the app syncs emails from the last 7 days. Change <strong>Sync Window (days)</strong> in App Settings to go further back. Re-run Ingest after changing this setting.</P>

      <H3>Deleting emails</H3>
      <P>Deleting an email in Director Assistant removes it from the <em>local cache only</em> — it is not deleted from your mail server. Re-ingesting will bring it back.</P>

      <H3>Password security</H3>
      <P>App Passwords are stored in your OS keychain (macOS Keychain / Windows Credential Manager), not in the app database. OAuth tokens are never exposed in any API response.</P>

      <H3>Auto-update</H3>
      <P>The app checks GitHub for new releases every 60 minutes. A popup appears when an update is available. Updates apply automatically — the app restarts in about 30 seconds. You can also check manually in <strong>Settings → Updates</strong>.</P>

      <H3>Docker / team deployment</H3>
      <P>For server or team use, run with Docker:</P>
      <pre className="bg-gray-50 border border-gray-200 rounded-lg text-xs p-3 overflow-x-auto mb-3 font-mono">
{`docker compose up -d
# App runs at http://localhost:8000`}
      </pre>
      <P>Email data persists in the <code className="bg-gray-100 px-1 rounded text-xs">director_data</code> volume across restarts.</P>

      <H3>macOS dock badge</H3>
      <P>The dock icon badge shows your current unread email count, updated automatically every time the app polls for new mail.</P>

      <H3>Memory usage</H3>
      <P>Director Assistant uses a background subprocess for AI vector search. You may see one <code className="bg-gray-100 px-1 rounded text-xs">python3</code> worker process in Activity Monitor — this is normal and expected (~1 GB).</P>
      <P>If you see many Python processes consuming excessive RAM after repeated restarts, they are cleaned up automatically on the next server start. You can also restart the app from the LaunchAgent to trigger cleanup immediately.</P>
      <Tip>The app automatically kills stale background workers on startup. If memory still seems high, quit Director Assistant (Settings → Quit) and relaunch it.</Tip>

      <H3>Contact</H3>
      <P>Built by <strong>Ali Salamat</strong> · <a href="mailto:ali.salamat@firstpc.ca" className="text-accent-600 hover:underline">ali.salamat@firstpc.ca</a></P>
    </div>
  )
}

function ImportSection() {
  return (
    <div>
      <H2>Import PST & OLM Archives</H2>
      <P>Import emails from Outlook archive files directly into Director Assistant. All imported emails are indexed immediately for AI search and analysis.</P>

      <P>Go to <strong>Knowledge → 📦 Import PST</strong> (bottom of the Knowledge sidebar) to access the import tool.</P>

      <H3>Supported formats</H3>
      <div className="mb-4">
        <FeatureRow label=".pst (Outlook for Windows)" desc="Uses readpst (libpst). Install with: brew install libpst on macOS or sudo apt-get install readpst on Linux." />
        <FeatureRow label=".olm (Outlook for Mac)" desc="Built-in parser — no external dependencies. Always available. Reads the ZIP+XML format used by Outlook for Mac." />
      </div>

      <H3>How to import</H3>
      <Step n={1}>Click <strong>Knowledge</strong> in the left sidebar, then select <strong>📦 Import PST</strong> at the bottom of the Knowledge sub-menu.</Step>
      <Step n={2}>Drag and drop your <code className="bg-gray-100 px-1 rounded text-xs">.pst</code> or <code className="bg-gray-100 px-1 rounded text-xs">.olm</code> file onto the upload area, or click <strong>Choose file…</strong> to browse.</Step>
      <Step n={3}>A progress bar shows the import in real-time — email count and the current email subject.</Step>
      <Step n={4}>When complete, a summary shows: <strong>Imported</strong> (new emails added), <strong>Skipped</strong> (duplicates), and <strong>Total</strong>.</Step>

      <H3>Deduplication</H3>
      <P>Each email is identified by a hash of its folder, subject, sender, and date. Re-importing the same file is safe — duplicates are automatically skipped without error.</P>

      <H3>PST parser setup (for .pst files)</H3>
      <P>The <code className="bg-gray-100 px-1 rounded text-xs">readpst</code> tool must be installed for PST files. OLM files work without any setup.</P>
      <pre className="bg-gray-50 border border-gray-200 rounded-lg text-xs p-3 overflow-x-auto mb-3 font-mono">
{`# macOS
brew install libpst

# Ubuntu / Debian
sudo apt-get install readpst

# Then restart Director Assistant`}
      </pre>
      <Tip>The import status page shows a green ✓ OLM badge (always available) and a green ✓ PST or amber ⚠ PST badge depending on whether readpst is installed.</Tip>

      <H3>Large archives</H3>
      <P>PST and OLM files over 1 GB may take 5–15 minutes. The app remains fully usable during import. You can import multiple files — each adds to the existing email database.</P>

      <H3>After import</H3>
      <P>Imported emails appear in all search results, the Ask panel, AI analysis, and the Knowledge intelligence features. They are labelled with the folder name from the archive (e.g. "Inbox", "Sent Items").</P>
    </div>
  )
}

const CONTENT: Record<Section, React.ReactNode> = {
  start:     <GettingStarted />,
  inbox:     <InboxEmail />,
  ai:        <AISection />,
  executive: <ExecutiveTools />,
  contacts:  <ContactsSection />,
  projects:  <ProjectsSection />,
  knowledge:  <KnowledgeSection />,
  dashboard:  <DashboardSection />,
  import:    <ImportSection />,
  providers: <ProvidersSection />,
  tips:      <TipsSection />,
}

export function HelpModal({ onClose }: Props) {
  const [section, setSection] = useState<Section>('start')

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[88vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 flex-shrink-0 bg-gradient-to-r from-accent/5 to-white">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-accent flex items-center justify-center">
              <svg className="w-4 h-4 text-white" viewBox="0 0 20 20" fill="currentColor">
                <path d="M2.003 5.884L10 9.882l7.997-3.998A2 2 0 0016 4H4a2 2 0 00-1.997 1.884z"/>
                <path d="M18 8.118l-8 4-8-4V14a2 2 0 002 2h12a2 2 0 002-2V8.118z"/>
              </svg>
            </div>
            <div>
              <h2 className="text-base font-semibold text-gray-900">Director Assistant</h2>
              <p className="text-xs text-gray-500">v{pkgJson.version} · AI-powered executive email intelligence</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
            <svg className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd"/>
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-1 overflow-hidden min-h-0">

          {/* Sidebar */}
          <nav className="w-48 flex-shrink-0 border-r border-gray-100 bg-gray-50 p-3 space-y-0.5 overflow-y-auto">
            {SECTIONS.map(s => (
              <button key={s.id} onClick={() => setSection(s.id)}
                className={`w-full text-left text-sm px-3 py-2 rounded-lg transition-colors flex items-center gap-2 ${
                  section === s.id
                    ? 'bg-accent text-white font-medium shadow-sm'
                    : 'text-gray-600 hover:bg-gray-200 hover:text-gray-900'
                }`}>
                <span className="text-base leading-none">{s.icon}</span>
                <span>{s.label}</span>
              </button>
            ))}
          </nav>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6 min-h-0">
            {CONTENT[section]}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-gray-100 bg-gray-50 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-gray-500 font-medium">Director Assistant v{pkgJson.version}</span>
            <span className="text-gray-300">·</span>
            <span className="text-xs text-gray-500">Built by <a href="mailto:ali.salamat@firstpc.ca" className="font-semibold text-gray-700 hover:text-accent-600 transition-colors">Ali Salamat</a></span>
            <span className="text-gray-300">·</span>
            <a href="mailto:ali.salamat@firstpc.ca" className="text-xs text-accent-600 hover:text-accent-700 hover:underline transition-colors">ali.salamat@firstpc.ca</a>
          </div>
          <button onClick={onClose} className="text-xs bg-accent text-white px-4 py-1.5 rounded-lg hover:bg-blue-700 transition-colors font-medium">
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
