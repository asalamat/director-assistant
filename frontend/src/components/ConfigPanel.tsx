import { useState, useEffect, useRef } from 'react'
import { api } from '../api/client'
import type { AppConfig } from '../types'
import { AIProvidersPanel } from './AIProvidersPanel'

interface Props {
  onSaved?: () => void
}

type HelpSection = 'yahoo' | 'gmail' | 'hotmail' | 'office365' | null

function HelpBox({ section }: { section: HelpSection }) {
  if (!section) return null

  const content: Record<NonNullable<HelpSection>, { title: string; steps: string[] }> = {
    yahoo: {
      title: 'Yahoo — App Password',
      steps: [
        'Sign in at login.yahoo.com',
        'Go to Account Security → Generate app password',
        'Select "Other app" → type "Director Assistant"',
        'Copy the 16-character password shown — use it as your password here',
        'IMAP is enabled automatically for Yahoo accounts',
      ],
    },
    gmail: {
      title: 'Gmail — App Password',
      steps: [
        'Enable 2-Step Verification on your Google Account first',
        'Go to myaccount.google.com → Security → App passwords',
        'Select app "Mail" and device "Other" → Generate',
        'Copy the 16-character password — use it as your password here',
        'In Gmail Settings → See all settings → Forwarding and POP/IMAP → Enable IMAP',
      ],
    },
    hotmail: {
      title: 'Hotmail / Outlook.com — App Password',
      steps: [
        'Enable two-step verification on account.microsoft.com',
        'Go to Security → Advanced security options → App passwords',
        'Create a new app password → copy it',
        'Use outlook.office365.com as the IMAP server (port 993)',
        'Use your full email as the username',
      ],
    },
    office365: {
      title: 'Office 365 — Azure App Registration',
      steps: [
        'Go to portal.azure.com → Azure Active Directory → App registrations',
        'Click "New registration" → name it "Director Assistant"',
        'Under Authentication, add platform "Mobile and desktop" with redirect URI http://localhost',
        'Under API permissions → Add → Microsoft Graph → Mail.Read (Delegated)',
        'Grant admin consent if required by your org',
        'Copy the Application (client) ID and your Tenant ID',
        'Use these as Client ID and Tenant ID in the account form',
      ],
    },
  }

  const { title, steps } = content[section]
  return (
    <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-800">
      <p className="font-semibold mb-2">{title}</p>
      <ol className="list-decimal list-inside space-y-1">
        {steps.map((s, i) => <li key={i}>{s}</li>)}
      </ol>
    </div>
  )
}

function KeyField({
  label,
  sublabel,
  placeholder,
  value,
  onChange,
  onTest,
  testing,
  testResult,
  currentPreview,
  hasKey,
  linkText,
  linkHref,
}: {
  label: string
  sublabel: string
  placeholder: string
  value: string
  onChange: (v: string) => void
  onTest: () => void
  testing: boolean
  testResult: { valid: boolean; message: string } | null
  currentPreview: string
  hasKey: boolean
  linkText: string
  linkHref: string
}) {
  const [show, setShow] = useState(false)
  return (
    <div>
      <h2 className="text-sm font-semibold text-gray-800 mb-1">{label}</h2>
      <p className="text-xs text-gray-500 mb-2">
        {sublabel}{' '}
        <a href={linkHref} target="_blank" rel="noreferrer" className="text-accent underline">
          {linkText} →
        </a>
      </p>

      {hasKey && !value && (
        <div className="mb-2 text-xs text-green-700 bg-green-50 border border-green-200 rounded px-3 py-1.5 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />
          Key configured: <span className="font-mono">{currentPreview}</span>
          <span className="text-gray-400 ml-1">(enter a new key to replace)</span>
        </div>
      )}

      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            type={show ? 'text' : 'password'}
            placeholder={hasKey ? 'Enter new key to replace…' : placeholder}
            value={value}
            onChange={e => onChange(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono pr-10 focus:outline-none focus:border-accent"
          />
          <button
            onClick={() => setShow(v => !v)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 text-xs"
          >
            {show ? 'Hide' : 'Show'}
          </button>
        </div>
        <button
          onClick={onTest}
          disabled={!value || testing}
          className="px-3 py-2 text-xs bg-gray-100 hover:bg-gray-200 border border-gray-300 rounded-lg disabled:opacity-50 transition-colors"
        >
          {testing ? 'Testing…' : 'Test'}
        </button>
      </div>

      {testResult && (
        <p className={`mt-1.5 text-xs ${testResult.valid ? 'text-green-600' : 'text-red-500'}`}>
          {testResult.valid ? '✓' : '✗'} {testResult.message}
        </p>
      )}
    </div>
  )
}

export function ConfigPanel({ onSaved }: Props) {
  const [config, setConfig] = useState<AppConfig | null>(null)

  const [anthropicKey, setAnthropicKey] = useState('')
  const [openaiKey, setOpenaiKey] = useState('')
  const [elevenLabsKey, setElevenLabsKey] = useState('')
  const [msClientId, setMsClientId] = useState('')
  const [googleClientId, setGoogleClientId] = useState('')
  const [googleClientSecret, setGoogleClientSecret] = useState('')
  const [digestEnabled, setDigestEnabled] = useState(false)
  const [digestTime, setDigestTime] = useState('08:00')
  const [digestEmail, setDigestEmail] = useState('')
  const [pollInterval, setPollInterval] = useState(60)
  const [syncWindowDays, setSyncWindowDays] = useState(0)
  const [budgetMode, setBudgetMode] = useState(false)

  const [testingAnt, setTestingAnt] = useState(false)
  const [testingOai, setTestingOai] = useState(false)
  const [testAnt, setTestAnt] = useState<{ valid: boolean; message: string } | null>(null)
  const [testOai, setTestOai] = useState<{ valid: boolean; message: string } | null>(null)

  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')
  const [helpSection, setHelpSection] = useState<HelpSection>(null)

  // Microsoft auto-setup wizard
  const [setupStatus, setSetupStatus] = useState<'idle' | 'running' | 'login_wait' | 'done' | 'error' | 'needs_cli'>('idle')
  const [setupMsg, setSetupMsg] = useState('')
  const [setupFix, setSetupFix] = useState('')
  const setupPollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopSetupPoll = () => { if (setupPollRef.current) { clearInterval(setupPollRef.current); setupPollRef.current = null } }

  useEffect(() => () => stopSetupPoll(), [])

  const runAutoSetup = async () => {
    setSetupStatus('running'); setSetupMsg('Checking Azure CLI…'); setSetupFix('')
    try {
      const r = await api.autoSetupMicrosoft()
      if (r.status === 'needs_cli') {
        setSetupStatus('needs_cli')
        setSetupMsg(r.message ?? 'Azure CLI not installed')
        setSetupFix(r.fix ?? 'brew install azure-cli')
      } else if (r.status === 'login_required') {
        setSetupStatus('login_wait')
        setSetupMsg(r.message ?? 'Sign in to Azure in the browser, then click Continue.')
        // Poll every 4s for login to complete
        stopSetupPoll()
        setupPollRef.current = setInterval(async () => {
          try {
            const r2 = await api.autoSetupMicrosoft()
            if (r2.status === 'done') {
              stopSetupPoll()
              setSetupStatus('done')
              setSetupMsg(`Microsoft app registered! Client ID: ${(r2.client_id ?? '').slice(0, 8)}…`)
              setMsClientId('')
              const updated = await api.getConfig()
              setConfig(updated)
            } else if (r2.status === 'error') {
              stopSetupPoll()
              setSetupStatus('error')
              setSetupMsg(r2.message ?? 'Setup failed')
            }
          } catch { /* still waiting */ }
        }, 4000)
      } else if (r.status === 'done') {
        setSetupStatus('done')
        setSetupMsg(`Microsoft app registered! Client ID: ${(r.client_id ?? '').slice(0, 8)}…`)
        setMsClientId('')
        const updated = await api.getConfig()
        setConfig(updated)
      } else {
        setSetupStatus('error')
        setSetupMsg(r.message ?? 'Setup failed')
      }
    } catch (e: unknown) {
      setSetupStatus('error')
      setSetupMsg(e instanceof Error ? e.message : 'Setup failed')
    }
  }

  useEffect(() => {
    api.getConfig().then((cfg) => {
      setConfig(cfg)
      setPollInterval(cfg.poll_interval_seconds)
      setSyncWindowDays(cfg.sync_window_days ?? 7)
      setBudgetMode(cfg.budget_mode ?? false)
      setMsClientId(cfg.ms_client_id ?? '')
      setGoogleClientId(cfg.google_client_id ?? '')
      setDigestEnabled(cfg.digest_schedule_enabled ?? false)
      setDigestTime(cfg.digest_schedule_time ?? '08:00')
      setDigestEmail(cfg.digest_schedule_email ?? '')
    }).catch(() => {})
  }, [])

  const handleTestAnt = async () => {
    setTestingAnt(true); setTestAnt(null)
    try {
      const r = await api.testApiKey(anthropicKey)
      setTestAnt({ valid: r.valid, message: r.valid ? `Valid — ${r.model}` : (r.error ?? 'Invalid') })
    } catch {
      setTestAnt({ valid: false, message: 'Network error' })
    } finally {
      setTestingAnt(false)
    }
  }

  const handleTestOai = async () => {
    setTestingOai(true); setTestOai(null)
    try {
      const r = await api.testOpenAIKey(openaiKey)
      setTestOai({ valid: r.valid, message: r.valid ? `Valid — ${r.model}` : (r.error ?? 'Invalid') })
    } catch {
      setTestOai({ valid: false, message: 'Network error' })
    } finally {
      setTestingOai(false)
    }
  }

  const handleSave = async () => {
    setSaving(true); setSaveMsg('')
    try {
      const payload: { anthropic_api_key?: string; openai_api_key?: string; ms_client_id?: string; google_client_id?: string; google_client_secret?: string; poll_interval_seconds?: number; budget_mode?: boolean; sync_window_days?: number; digest_schedule_enabled?: boolean; digest_schedule_time?: string; digest_schedule_email?: string } = {
        poll_interval_seconds: pollInterval,
        sync_window_days: syncWindowDays,
        budget_mode: budgetMode,
      }
      if (anthropicKey) payload.anthropic_api_key = anthropicKey
      if (openaiKey) payload.openai_api_key = openaiKey
      if (msClientId) payload.ms_client_id = msClientId
      if (googleClientId) payload.google_client_id = googleClientId
      if (googleClientSecret) payload.google_client_secret = googleClientSecret
      if (elevenLabsKey) (payload as Record<string, unknown>).elevenlabs_api_key = elevenLabsKey
      payload.digest_schedule_enabled = digestEnabled
      payload.digest_schedule_time = digestTime
      payload.digest_schedule_email = digestEmail
      await api.saveConfig(payload)
      setSaveMsg('Saved')
      setAnthropicKey(''); setOpenaiKey(''); setElevenLabsKey('')
      const updated = await api.getConfig()
      setConfig(updated)
      onSaved?.()
      setTimeout(() => setSaveMsg(''), 3000)
    } catch {
      setSaveMsg('Save failed')
    } finally {
      setSaving(false)
    }
  }

  const toggleHelp = (section: HelpSection) =>
    setHelpSection(prev => prev === section ? null : section)

  return (
    <div className="max-w-lg mx-auto p-6 space-y-6">

      {/* ── Multi-provider AI settings ─────────────────────────────── */}
      <div className="border border-accent-200 rounded-xl p-4">
        <AIProvidersPanel />
      </div>

      {/* Legacy single-key fields — kept for quick access */}
      <details className="border border-dashed border-gray-200 rounded-xl">
        <summary className="px-4 py-3 text-xs font-medium text-gray-500 cursor-pointer hover:text-gray-700 select-none">
          Legacy API key fields (also managed above)
        </summary>
        <div className="px-4 pb-4 space-y-4 pt-2">

      {/* Anthropic / Claude */}
      <KeyField
        label="Anthropic API Key (Claude)"
        sublabel="Primary AI provider for recommendations, digest, and classification."
        placeholder="sk-ant-…"
        value={anthropicKey}
        onChange={v => { setAnthropicKey(v); setTestAnt(null) }}
        onTest={handleTestAnt}
        testing={testingAnt}
        testResult={testAnt}
        currentPreview={config?.api_key_preview ?? ''}
        hasKey={config?.has_api_key ?? false}
        linkText="Get a key"
        linkHref="https://console.anthropic.com/settings/keys"
      />

      {/* OpenAI fallback */}
      <div className="border border-dashed border-gray-300 rounded-xl p-4 space-y-3">
        <div className="flex items-start gap-2">
          <div className="flex-1">
            <h2 className="text-sm font-semibold text-gray-800">OpenAI API Key (Backup)</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              Used automatically when Claude hits its daily usage limit.
              Haiku calls fall back to <span className="font-mono">gpt-4o-mini</span>,
              Sonnet calls to <span className="font-mono">gpt-4o</span>.
            </p>
          </div>
          <span className="text-xs px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full whitespace-nowrap">Optional</span>
        </div>
        <KeyField
          label=""
          sublabel=""
          placeholder="sk-…"
          value={openaiKey}
          onChange={v => { setOpenaiKey(v); setTestOai(null) }}
          onTest={handleTestOai}
          testing={testingOai}
          testResult={testOai}
          currentPreview={config?.openai_key_preview ?? ''}
          hasKey={config?.has_openai_key ?? false}
          linkText="Get a key"
          linkHref="https://platform.openai.com/api-keys"
        />
      </div>{/* end openai border div */}
        </div>{/* end legacy fields */}
      </details>

      {/* Microsoft Integration — Auto-Setup */}
      <div className="border border-blue-200 rounded-xl p-4 space-y-3">
        <div className="flex items-start gap-2">
          <svg className="w-5 h-5 mt-0.5 flex-shrink-0" viewBox="0 0 21 21" xmlns="http://www.w3.org/2000/svg">
            <rect x="1" y="1" width="9" height="9" fill="#f25022"/>
            <rect x="11" y="1" width="9" height="9" fill="#7fba00"/>
            <rect x="1" y="11" width="9" height="9" fill="#00a4ef"/>
            <rect x="11" y="11" width="9" height="9" fill="#ffb900"/>
          </svg>
          <div className="flex-1">
            <h2 className="text-sm font-semibold text-gray-800">Microsoft Integration</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              One-click setup — registers the Azure app automatically using the Azure CLI. No portal required.
            </p>
          </div>
        </div>

        {/* Already configured */}
        {config?.has_ms_client_id && setupStatus === 'idle' && (
          <div className="flex items-center gap-2 text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
            <span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />
            App configured: <span className="font-mono">{config.ms_client_id.slice(0, 8)}…</span>
            <button onClick={() => setSetupStatus('idle')} className="ml-auto text-gray-400 hover:text-red-500 text-xs">Re-run setup</button>
          </div>
        )}

        {/* Setup button */}
        {setupStatus === 'idle' && !config?.has_ms_client_id && (
          <button
            onClick={runAutoSetup}
            className="w-full flex items-center justify-center gap-2 bg-blue-600 text-white text-sm font-medium py-2.5 rounded-lg hover:bg-blue-700 transition-colors"
          >
            Auto-Setup Microsoft App
          </button>
        )}

        {/* Running */}
        {setupStatus === 'running' && (
          <div className="flex items-center gap-2 text-sm text-blue-700 bg-blue-50 border border-blue-200 rounded-lg px-4 py-3">
            <span className="inline-block w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
            {setupMsg}
          </div>
        )}

        {/* Needs CLI */}
        {setupStatus === 'needs_cli' && (
          <div className="space-y-2">
            <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">{setupMsg}</p>
            <p className="text-xs text-gray-500">Run this in Terminal, then click Setup again:</p>
            <div className="flex items-center gap-2 bg-gray-900 rounded-lg px-3 py-2">
              <code className="text-green-400 text-xs flex-1 font-mono">{setupFix}</code>
              <button onClick={() => navigator.clipboard.writeText(setupFix)} className="text-gray-400 hover:text-white text-xs flex-shrink-0">Copy</button>
            </div>
            <button onClick={runAutoSetup} className="w-full border border-blue-300 text-blue-700 text-sm py-2 rounded-lg hover:bg-blue-50">
              Try Again
            </button>
          </div>
        )}

        {/* Waiting for browser login */}
        {setupStatus === 'login_wait' && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-blue-700 bg-blue-50 border border-blue-200 rounded-lg px-4 py-3">
              <span className="inline-block w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
              Sign in to Azure in the browser window that opened, then the setup will continue automatically.
            </div>
            <button onClick={runAutoSetup} className="w-full border border-blue-300 text-blue-700 text-sm py-2 rounded-lg hover:bg-blue-50">
              Continue Setup
            </button>
          </div>
        )}

        {/* Done */}
        {setupStatus === 'done' && (
          <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-4 py-3">{setupMsg}</p>
        )}

        {/* Error */}
        {setupStatus === 'error' && (
          <div className="space-y-2">
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">{setupMsg}</p>
            <button onClick={runAutoSetup} className="w-full border border-gray-300 text-gray-700 text-sm py-2 rounded-lg hover:bg-gray-50">
              Try Again
            </button>
          </div>
        )}

        {/* Manual fallback */}
        <details className="text-xs">
          <summary className="text-gray-400 cursor-pointer hover:text-gray-600 select-none">Enter Client ID manually instead</summary>
          <div className="mt-2 space-y-1.5">
            <input
              type="text"
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              value={msClientId}
              onChange={e => setMsClientId(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-accent"
            />
          </div>
        </details>
      </div>

      {/* Google / Gmail Integration */}
      <div className="border border-red-200 rounded-xl p-4 space-y-3">
        <div className="flex items-start gap-2">
          <svg className="w-5 h-5 mt-0.5 flex-shrink-0" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
            <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
            <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
            <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
          </svg>
          <div className="flex-1">
            <h2 className="text-sm font-semibold text-gray-800">Google / Gmail Integration</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              OAuth sign-in for Gmail — no App Password needed. Requires a Google Cloud OAuth client.
            </p>
          </div>
          <span className="text-xs px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full whitespace-nowrap">Optional</span>
        </div>

        {config?.has_google_client_id && (
          <div className="flex items-center gap-2 text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
            <span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />
            Client configured: <span className="font-mono">{config.google_client_id.slice(0, 12)}…</span>
          </div>
        )}

        <details className={config?.has_google_client_id ? 'text-xs' : 'text-xs open'} open={!config?.has_google_client_id}>
          <summary className="text-gray-500 cursor-pointer hover:text-gray-700 select-none font-medium">
            {config?.has_google_client_id ? 'Update credentials' : 'Enter Google Cloud OAuth credentials'}
          </summary>
          <div className="mt-3 space-y-2">
            <div>
              <label className="text-xs text-gray-500 block mb-1">Client ID</label>
              <input
                type="text"
                placeholder="xxxxxxxxxx-xxxx.apps.googleusercontent.com"
                value={googleClientId}
                onChange={e => setGoogleClientId(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-accent"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Client Secret</label>
              <input
                type="password"
                placeholder="GOCSPX-…"
                value={googleClientSecret}
                onChange={e => setGoogleClientSecret(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:border-accent"
              />
            </div>
            <p className="text-xs text-gray-400">
              Create at <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer" className="text-accent underline">Google Cloud Console</a> → OAuth 2.0 Client IDs → Web application. Add <code className="bg-gray-100 px-1 rounded">http://localhost:8000/api/oauth/google/callback</code> as an authorized redirect URI.
            </p>
          </div>
        </details>
      </div>

      {/* Poll interval */}
      <div>
        <h2 className="text-sm font-semibold text-gray-800 mb-1">Auto-check interval</h2>
        <p className="text-xs text-gray-500 mb-3">How often to check for new emails in the background.</p>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={30}
            max={600}
            step={30}
            value={pollInterval}
            onChange={e => setPollInterval(Number(e.target.value))}
            className="flex-1 accent-accent"
          />
          <span className="text-sm font-medium text-gray-700 w-20 text-right">
            {pollInterval >= 60
              ? `${Math.round(pollInterval / 60)} min${Math.round(pollInterval / 60) !== 1 ? 's' : ''}`
              : `${pollInterval}s`}
          </span>
        </div>
      </div>

      {/* Sync window */}
      <div>
        <h2 className="text-sm font-semibold text-gray-800 mb-1">Sync window</h2>
        <p className="text-xs text-gray-500 mb-3">
          How far back to look for new and deleted emails on each poll.
          Wider = catches older changes; narrower = faster polls.
        </p>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={1}
            max={31}
            step={1}
            value={syncWindowDays === 0 ? 31 : syncWindowDays}
            onChange={e => setSyncWindowDays(Number(e.target.value) === 31 ? 0 : Number(e.target.value))}
            className="flex-1 accent-accent"
          />
          <span className="text-sm font-medium text-gray-700 w-20 text-right">
            {syncWindowDays === 0 ? 'Unlimited' : `${syncWindowDays} ${syncWindowDays === 1 ? 'day' : 'days'}`}
          </span>
        </div>
        <div className="flex justify-between text-xs text-gray-400 mt-1">
          <span>1 day</span>
          <span>Unlimited →</span>
        </div>
      </div>

      {/* Translation Language */}
      <div className="border border-gray-200 rounded-xl p-4">
        <h2 className="text-sm font-semibold text-gray-800 mb-1">Translation Language</h2>
        <p className="text-xs text-gray-500 mb-2">Language used when you click "Translate" on an email.</p>
        <select
          value={config?.translation_language ?? 'English'}
          onChange={async e => {
            await api.updateConfig({ translation_language: e.target.value })
            setConfig(c => c ? { ...c, translation_language: e.target.value } : c)
          }}
          className="text-sm border border-gray-300 rounded-lg px-3 py-1.5 focus:outline-none focus:border-accent bg-white"
        >
          {['English','Farsi (Persian)','French','Spanish','German','Italian','Portuguese','Dutch','Japanese','Chinese','Arabic','Korean','Russian','Polish','Turkish','Swedish','Norwegian','Danish','Finnish','Hebrew','Hindi'].map(lang => (
            <option key={lang} value={lang}>{lang}</option>
          ))}
        </select>
      </div>

      {/* ElevenLabs TTS */}
      <div className="border border-gray-200 rounded-xl p-4 space-y-3">
        <div>
          <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 block">ElevenLabs API Key (TTS)</label>
          <p className="text-xs text-gray-400 mb-2">Required for 🔊 Read Aloud. Get a key at <a href="https://elevenlabs.io" target="_blank" rel="noreferrer" className="text-accent underline">elevenlabs.io</a>.</p>
          {config?.has_elevenlabs && !elevenLabsKey && (
            <p className="text-xs text-green-700 bg-green-50 border border-green-200 rounded px-3 py-1.5 mb-2">Key configured — enter a new key to replace.</p>
          )}
          <input type="password" value={elevenLabsKey} onChange={e => setElevenLabsKey(e.target.value)}
            placeholder={config?.has_elevenlabs ? 'Enter new key to replace…' : 'sk_…'}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-accent" />
        </div>
      </div>

      {/* Scheduled Email Digest */}
      <div className="border border-gray-200 rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-gray-800">Scheduled Digest</h2>
            <p className="text-xs text-gray-500 mt-0.5">Email yourself a daily brief at a set time. Requires an IMAP account with App Password.</p>
          </div>
          <button onClick={() => setDigestEnabled(v => !v)}
            className={`relative w-10 h-5 rounded-full flex-shrink-0 transition-colors ${digestEnabled ? 'bg-accent' : 'bg-gray-300'}`}>
            <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${digestEnabled ? 'translate-x-5' : 'translate-x-0.5'}`} />
          </button>
        </div>
        {digestEnabled && (
          <div className="space-y-2">
            <div className="flex gap-2 items-center">
              <label className="text-xs text-gray-500 w-12 flex-shrink-0">Time</label>
              <input type="time" value={digestTime} onChange={e => setDigestTime(e.target.value)}
                className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-accent" />
            </div>
            <div className="flex gap-2 items-center">
              <label className="text-xs text-gray-500 w-12 flex-shrink-0">Send to</label>
              <input type="email" value={digestEmail} onChange={e => setDigestEmail(e.target.value)}
                placeholder="your@email.com"
                className="flex-1 border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:border-accent" />
            </div>
          </div>
        )}
      </div>

      {/* Budget / Economy mode */}
      <div className="border border-amber-200 rounded-xl p-4 bg-amber-50">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1">
            <h2 className="text-sm font-semibold text-amber-800">Budget mode (Economy)</h2>
            <p className="text-xs text-amber-700 mt-1">
              Forces all AI calls to use the cheapest models — <span className="font-mono">claude-haiku</span> for Claude,{' '}
              <span className="font-mono">gpt-4o-mini</span> for OpenAI.
              Saves API costs; recommendations may be less detailed.
            </p>
          </div>
          <button
            onClick={() => setBudgetMode(v => !v)}
            className={`relative w-10 h-5 rounded-full flex-shrink-0 transition-colors mt-0.5 ${
              budgetMode ? 'bg-amber-500' : 'bg-gray-300'
            }`}
          >
            <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
              budgetMode ? 'translate-x-5' : 'translate-x-0.5'
            }`} />
          </button>
        </div>
        {budgetMode && (
          <p className="text-xs text-amber-700 mt-2 font-medium">
            ON — Haiku / gpt-4o-mini for all calls
          </p>
        )}
      </div>

      {/* Provider help */}
      <div>
        <h2 className="text-sm font-semibold text-gray-800 mb-3">Email provider setup guides</h2>
        <div className="grid grid-cols-2 gap-2">
          {(['yahoo', 'gmail', 'hotmail', 'office365'] as HelpSection[]).map(s => (
            <button
              key={s}
              onClick={() => toggleHelp(s)}
              className={`px-3 py-2 text-xs rounded-lg border transition-colors text-left ${
                helpSection === s
                  ? 'border-accent bg-accent/5 text-accent font-medium'
                  : 'border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50'
              }`}
            >
              {s === 'yahoo' && 'Yahoo IMAP'}
              {s === 'gmail' && 'Gmail IMAP'}
              {s === 'hotmail' && 'Hotmail / Outlook'}
              {s === 'office365' && 'Office 365 (Azure)'}
            </button>
          ))}
        </div>
        <HelpBox section={helpSection} />
      </div>

      {/* Save */}
      <div className="flex items-center gap-3 pt-2 border-t border-gray-200">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-2 text-sm bg-accent text-white rounded-lg hover:bg-accent/90 disabled:opacity-60 transition-colors"
        >
          {saving ? 'Saving…' : 'Save settings'}
        </button>
        {saveMsg && (
          <span className={`text-xs ${saveMsg === 'Saved' ? 'text-green-600' : 'text-red-500'}`}>
            {saveMsg}
          </span>
        )}
      </div>
    </div>
  )
}
