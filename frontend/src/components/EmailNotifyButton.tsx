import { useState } from 'react'

interface Props { emailId: string }

export function EmailNotifyButton({ emailId }: Props) {
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<{target: string; ok: boolean} | null>(null)

  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const share = async (target: 'slack' | 'teams') => {
    setOpen(false)
    setErrorMsg(null)
    try {
      const res = await fetch(`/api/notify/${target}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email_id: emailId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        const msg = data.detail || `HTTP ${res.status}`
        const friendly = msg.includes('not configured')
          ? `${target === 'slack' ? 'Slack' : 'Teams'} not configured — add webhook URL in Settings → Integrations`
          : msg
        setErrorMsg(friendly)
        setTimeout(() => setErrorMsg(null), 5000)
      } else {
        setStatus({ target, ok: data.ok ?? true })
        setTimeout(() => setStatus(null), 3000)
      }
    } catch (e: any) {
      setErrorMsg(e.message || 'Network error')
      setTimeout(() => setErrorMsg(null), 4000)
    }
  }

  if (errorMsg) {
    return (
      <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1 max-w-xs leading-tight">
        ⚠ {errorMsg}
      </span>
    )
  }

  if (status) {
    return (
      <span className={`text-xs px-2 py-1 rounded ${status.ok ? 'text-green-600' : 'text-red-500'}`}>
        {status.ok ? `✓ Sent to ${status.target}` : `✗ ${status.target} failed`}
      </span>
    )
  }

  return (
    <div className="relative inline-block">
      <button onClick={() => setOpen(v => !v)}
        title="Share to Slack or Teams"
        className="text-xs border border-gray-200 rounded-lg px-2 py-1 text-gray-500 hover:bg-gray-50 hover:border-accent transition-colors">
        Share →
      </button>
      {open && (
        <div className="absolute top-full right-0 mt-1 z-20 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden"
          onMouseLeave={() => setOpen(false)}>
          <button onClick={() => share('slack')} className="flex items-center gap-2 px-3 py-2 text-xs text-gray-700 hover:bg-gray-50 w-full text-left">
            💬 Slack
          </button>
          <button onClick={() => share('teams')} className="flex items-center gap-2 px-3 py-2 text-xs text-gray-700 hover:bg-blue-50 w-full text-left">
            🟦 Teams
          </button>
        </div>
      )}
    </div>
  )
}
