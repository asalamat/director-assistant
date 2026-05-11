import { useState, useEffect } from 'react'
import { api } from '../api/client'
import type { AppConfig } from '../types'

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
  const [pollInterval, setPollInterval] = useState(60)
  const [syncWindowDays, setSyncWindowDays] = useState(7)
  const [budgetMode, setBudgetMode] = useState(false)

  const [testingAnt, setTestingAnt] = useState(false)
  const [testingOai, setTestingOai] = useState(false)
  const [testAnt, setTestAnt] = useState<{ valid: boolean; message: string } | null>(null)
  const [testOai, setTestOai] = useState<{ valid: boolean; message: string } | null>(null)

  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')
  const [helpSection, setHelpSection] = useState<HelpSection>(null)

  useEffect(() => {
    api.getConfig().then((cfg) => {
      setConfig(cfg)
      setPollInterval(cfg.poll_interval_seconds)
      setSyncWindowDays(cfg.sync_window_days ?? 7)
      setBudgetMode(cfg.budget_mode ?? false)
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
      const payload: { anthropic_api_key?: string; openai_api_key?: string; poll_interval_seconds?: number; budget_mode?: boolean; sync_window_days?: number } = {
        poll_interval_seconds: pollInterval,
        sync_window_days: syncWindowDays,
        budget_mode: budgetMode,
      }
      if (anthropicKey) payload.anthropic_api_key = anthropicKey
      if (openaiKey) payload.openai_api_key = openaiKey
      await api.saveConfig(payload)
      setSaveMsg('Saved')
      setAnthropicKey(''); setOpenaiKey('')
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
            max={30}
            step={1}
            value={syncWindowDays}
            onChange={e => setSyncWindowDays(Number(e.target.value))}
            className="flex-1 accent-accent"
          />
          <span className="text-sm font-medium text-gray-700 w-20 text-right">
            {syncWindowDays} {syncWindowDays === 1 ? 'day' : 'days'}
          </span>
        </div>
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
