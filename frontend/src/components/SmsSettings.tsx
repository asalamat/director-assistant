import { useState, useEffect } from 'react'
import { api } from '../api/client'

export function SmsSettings() {
  const [accountSid, setAccountSid] = useState('')
  const [authToken, setAuthToken] = useState('')
  const [fromNumber, setFromNumber] = useState('')
  const [authTokenSet, setAuthTokenSet] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null)

  useEffect(() => {
    api.getSmsSettings().then(s => {
      setAccountSid(s.account_sid)
      setFromNumber(s.from_number)
      setAuthTokenSet(s.auth_token_set)
    }).catch(() => {})
  }, [])

  const save = async () => {
    setSaving(true)
    const payload: { account_sid?: string; auth_token?: string; from_number?: string } = {
      account_sid: accountSid,
      from_number: fromNumber,
    }
    if (authToken.trim()) payload.auth_token = authToken.trim()
    await api.saveSmsSettings(payload).catch(() => {})
    setSaving(false)
    setSaved(true)
    setAuthToken('')
    if (authToken.trim()) setAuthTokenSet(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const test = async () => {
    setTesting(true)
    setTestResult(null)
    try {
      const r = await api.testSmsConnection()
      setTestResult(r)
    } catch (e) {
      setTestResult({ ok: false, error: (e as Error).message })
    }
    setTesting(false)
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-400">
        Create a free Twilio account at{' '}
        <a href="https://www.twilio.com/try-twilio" target="_blank" rel="noreferrer" className="underline">
          twilio.com
        </a>
        , buy a phone number (~$1/mo), then paste your Account SID and Auth Token from the Twilio console below.
      </p>

      <div>
        <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1 block">Account SID</label>
        <input value={accountSid} onChange={e => setAccountSid(e.target.value)}
          placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </div>

      <div>
        <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1 block">
          Auth Token {authTokenSet && <span className="text-green-600 normal-case font-normal">(saved)</span>}
        </label>
        <input value={authToken} onChange={e => setAuthToken(e.target.value)} type="password"
          placeholder={authTokenSet ? 'Enter a new token to replace it' : 'Your Twilio Auth Token'}
          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </div>

      <div>
        <label className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1 block">From Number</label>
        <input value={fromNumber} onChange={e => setFromNumber(e.target.value)}
          placeholder="+15551234567"
          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </div>

      <div className="flex items-center gap-2">
        <button onClick={save} disabled={saving}
          className="text-xs bg-accent text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors">
          {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save'}
        </button>
        <button onClick={test} disabled={testing}
          className="text-xs border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-gray-50 disabled:opacity-50 transition-colors">
          {testing ? 'Sending…' : 'Test Connection'}
        </button>
        {testResult && (
          <span className={`text-xs ${testResult.ok ? 'text-green-600' : 'text-red-500'}`}>
            {testResult.ok ? '✓ Test SMS sent' : `✗ ${testResult.error || 'Failed'}`}
          </span>
        )}
      </div>
    </div>
  )
}
