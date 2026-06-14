import { useState, useRef } from 'react'
import type { EmailProvider } from '../types'
import { api } from '../api/client'

const PROVIDER_LABELS: Record<EmailProvider, string> = {
  yahoo_imap:   'Yahoo Mail',
  gmail:        'Gmail',
  hotmail:      'Hotmail / Outlook.com',
  generic_imap: 'Generic IMAP',
  office365:    'Office 365 (work)',
}

const PROVIDER_HINTS: Record<EmailProvider, string> = {
  yahoo_imap:   'Use an App Password from Yahoo Account Security',
  gmail:        'Use an App Password (enable 2FA first) or Sign in with Google',
  hotmail:      'Enable IMAP in Outlook Settings, then use an App Password — or Sign in with Microsoft OAuth2',
  generic_imap: 'Enter your IMAP server address',
  office365:    'Requires Tenant ID, Client ID, and Client Secret from Azure',
}

const IMAP_PROVIDERS: EmailProvider[] = ['yahoo_imap', 'gmail', 'hotmail', 'generic_imap']

interface Props {
  onConnected: () => void
  onCancel?: () => void
  onAccountAdded: () => void
}

export function AddAccountForm({ onConnected, onCancel, onAccountAdded }: Props) {
  const [provider, setProvider] = useState<EmailProvider>('gmail')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [imapHost, setImapHost] = useState('')
  const [tenantId, setTenantId] = useState('')
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [hotmailMode, setHotmailMode] = useState<'password' | 'oauth'>('password')
  const [oauthStatus, setOauthStatus] = useState<'idle' | 'waiting' | 'done' | 'error'>('idle')
  const [oauthMsg, setOauthMsg] = useState('')
  const oauthPopupRef = useRef<Window | null>(null)
  const [gmailMode, setGmailMode] = useState<'password' | 'oauth'>('password')
  const [googleStatus, setGoogleStatus] = useState<'idle' | 'waiting' | 'done' | 'error'>('idle')
  const [googleMsg, setGoogleMsg] = useState('')
  const googlePopupRef = useRef<Window | null>(null)

  const handleMicrosoftSignIn = async () => {
    setOauthStatus('waiting'); setOauthMsg(''); setError('')
    try {
      const { url } = await api.getMicrosoftAuthUrl(username.trim() || undefined)
      const popup = window.open(url, 'msauth', 'width=520,height=680,left=200,top=80')
      oauthPopupRef.current = popup
      if (!popup) { setOauthStatus('error'); setOauthMsg('Popup blocked — allow popups and try again.'); return }
      const onMsg = async (e: MessageEvent) => {
        if (e.data?.type === 'oauth-complete') {
          window.removeEventListener('message', onMsg)
          setOauthStatus('done'); setOauthMsg(`Signed in as ${e.data.username || 'Microsoft account'} — importing…`)
          onAccountAdded()
          setTimeout(() => { onCancel?.(); setOauthStatus('idle'); setOauthMsg(''); setUsername('') }, 2500)
        } else if (e.data?.type === 'oauth-error') {
          window.removeEventListener('message', onMsg)
          setOauthStatus('error'); setOauthMsg(e.data.message || 'Sign-in failed.')
        }
      }
      window.addEventListener('message', onMsg)
      const t = setInterval(() => {
        if (oauthPopupRef.current?.closed) { clearInterval(t); window.removeEventListener('message', onMsg); setOauthStatus(s => s === 'waiting' ? 'idle' : s) }
      }, 800)
    } catch (e: unknown) { setOauthStatus('error'); setOauthMsg(e instanceof Error ? e.message : 'Failed') }
  }

  const handleGoogleSignIn = async () => {
    setGoogleStatus('waiting'); setGoogleMsg(''); setError('')
    try {
      const { url } = await api.getGoogleAuthUrl(username.trim() || undefined)
      const popup = window.open(url, 'gauth', 'width=520,height=680,left=200,top=80')
      googlePopupRef.current = popup
      if (!popup) { setGoogleStatus('error'); setGoogleMsg('Popup blocked — allow popups and try again.'); return }
      const onMsg = async (e: MessageEvent) => {
        if (e.data?.type === 'oauth-complete') {
          window.removeEventListener('message', onMsg)
          setGoogleStatus('done'); setGoogleMsg(`Signed in as ${e.data.username || 'Google account'} — importing…`)
          onAccountAdded()
          setTimeout(() => { onCancel?.(); setGoogleStatus('idle'); setGoogleMsg(''); setUsername('') }, 2500)
        } else if (e.data?.type === 'oauth-error') {
          window.removeEventListener('message', onMsg)
          setGoogleStatus('error'); setGoogleMsg(e.data.message || 'Sign-in failed.')
        }
      }
      window.addEventListener('message', onMsg)
      const t = setInterval(() => {
        if (googlePopupRef.current?.closed) { clearInterval(t); window.removeEventListener('message', onMsg); setGoogleStatus(s => s === 'waiting' ? 'idle' : s) }
      }, 800)
    } catch (e: unknown) { setGoogleStatus('error'); setGoogleMsg(e instanceof Error ? e.message : 'Failed') }
  }

  const handleConnect = async () => {
    setLoading(true); setError('')
    try {
      const payload = provider === 'office365'
        ? { provider, username, tenant_id: tenantId, client_id: clientId, client_secret: clientSecret }
        : provider === 'generic_imap' ? { provider, username, password, imap_host: imapHost }
        : { provider, username, password }
      await api.addAccount(payload).catch(() => api.connect(payload))
      onAccountAdded(); onConnected(); onCancel?.()
    } catch (e: unknown) { setError(e instanceof Error ? e.message : 'Failed to connect') }
    finally { setLoading(false) }
  }

  const useOAuth = (provider === 'hotmail' && hotmailMode === 'oauth') || (provider === 'gmail' && gmailMode === 'oauth')
  const showPassword = IMAP_PROVIDERS.includes(provider) && !useOAuth

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wider">Provider</label>
        <select value={provider} onChange={e => setProvider(e.target.value as EmailProvider)}
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent bg-white">
          {Object.entries(PROVIDER_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <p className="text-xs text-gray-400 mt-1">{PROVIDER_HINTS[provider]}</p>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wider">Email address</label>
        <input type="email" value={username} onChange={e => setUsername(e.target.value)} placeholder="you@example.com"
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent" />
      </div>

      {provider === 'gmail' && (
        <div className="flex gap-2 text-xs">
          {(['password', 'oauth'] as const).map(m => (
            <button key={m} onClick={() => setGmailMode(m)}
              className={`px-3 py-1.5 rounded-lg border font-medium transition-colors ${gmailMode === m ? 'bg-accent text-white border-accent' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
              {m === 'password' ? 'App Password' : 'Sign in with Google'}
            </button>
          ))}
        </div>
      )}

      {provider === 'hotmail' && (
        <div className="flex gap-2 text-xs">
          {(['password', 'oauth'] as const).map(m => (
            <button key={m} onClick={() => setHotmailMode(m)}
              className={`px-3 py-1.5 rounded-lg border font-medium transition-colors ${hotmailMode === m ? 'bg-accent text-white border-accent' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
              {m === 'password' ? 'App Password' : 'Sign in with Microsoft'}
            </button>
          ))}
        </div>
      )}

      {provider === 'gmail' && gmailMode === 'oauth' && (
        <OAuthPanel status={googleStatus} msg={googleMsg} label="Sign in with Google" onSignIn={handleGoogleSignIn}
          icon={<svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>} />
      )}

      {provider === 'hotmail' && hotmailMode === 'oauth' && (
        <OAuthPanel status={oauthStatus} msg={oauthMsg} label="Sign in with Microsoft" onSignIn={handleMicrosoftSignIn}
          icon={<svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 21 21"><rect x="1" y="1" width="9" height="9" fill="#f25022"/><rect x="11" y="1" width="9" height="9" fill="#7fba00"/><rect x="1" y="11" width="9" height="9" fill="#00a4ef"/><rect x="11" y="11" width="9" height="9" fill="#ffb900"/></svg>} />
      )}

      {showPassword && (
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wider">App password</label>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••••••"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent" />
        </div>
      )}

      {provider === 'generic_imap' && (
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wider">IMAP server</label>
          <input value={imapHost} onChange={e => setImapHost(e.target.value)} placeholder="imap.example.com"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent" />
        </div>
      )}

      {provider === 'office365' && ['Tenant ID', 'Client ID', 'Client Secret'].map((lbl, i) => {
        const vals = [tenantId, clientId, clientSecret]
        const setters = [setTenantId, setClientId, setClientSecret]
        return (
          <div key={lbl}>
            <label className="block text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wider">{lbl}</label>
            <input type={i === 2 ? 'password' : 'text'} value={vals[i]} onChange={e => setters[i](e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent" />
          </div>
        )
      })}

      {error && <p className="text-red-600 text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

      {!useOAuth && (
        <div className="flex gap-2 pt-1">
          <button onClick={handleConnect} disabled={loading || !username}
            className="flex-1 bg-accent text-white rounded-lg px-4 py-2.5 text-sm font-medium disabled:opacity-50 hover:bg-blue-700 transition-colors">
            {loading ? 'Connecting…' : 'Connect account'}
          </button>
          {onCancel && (
            <button onClick={onCancel} className="px-4 py-2.5 border border-gray-200 text-gray-600 text-sm rounded-lg hover:bg-gray-50">Cancel</button>
          )}
        </div>
      )}
    </div>
  )
}

function OAuthPanel({ status, msg, label, onSignIn, icon }: {
  status: 'idle' | 'waiting' | 'done' | 'error'; msg: string; label: string; onSignIn: () => void; icon: React.ReactNode
}) {
  if (status === 'idle') return (
    <button onClick={onSignIn} className="w-full flex items-center justify-center gap-2.5 bg-white border border-gray-200 text-gray-700 rounded-lg px-4 py-2.5 text-sm font-medium hover:bg-gray-50 shadow-sm transition-colors">
      {icon} {label}
    </button>
  )
  if (status === 'waiting') return (
    <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-2">
      <div className="flex items-center gap-2 text-sm text-blue-700 font-medium">
        <span className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin flex-shrink-0" /> {label} in the popup
      </div>
      <button onClick={onSignIn} className="w-full text-xs border border-blue-300 text-blue-700 bg-white rounded-lg py-1.5 hover:bg-blue-50">Reopen window</button>
    </div>
  )
  if (status === 'done') return <p className="text-sm text-green-600 bg-green-50 border border-green-200 rounded-lg px-4 py-3">{msg}</p>
  return (
    <div className="space-y-2">
      <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">{msg}</p>
      <button onClick={onSignIn} className="w-full bg-red-600 text-white rounded-lg px-4 py-2.5 text-sm font-medium hover:bg-red-700">Try Again</button>
    </div>
  )
}
