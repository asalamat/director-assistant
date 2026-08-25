import { useState, useCallback } from 'react'

type Props = {
  onOpenSettings: (tab: string) => void
  onComplete: () => void
}

export function OnboardingWizard({ onOpenSettings, onComplete }: Props) {
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState('')

  const checkEmailAccount = useCallback(async () => {
    setChecking(true)
    setError('')
    try {
      const res = await fetch('/api/accounts')
      const accounts = await res.json()
      if (Array.isArray(accounts) && accounts.length > 0) {
        setStep(2)
      } else {
        setError('No account found yet. Add one in Settings, then click here.')
      }
    } catch {
      setError('Could not verify. Please try again.')
    } finally {
      setChecking(false)
    }
  }, [])

  return (
    <div className="fixed inset-0 bg-black/60 z-[200] flex items-center justify-center">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        <div className="bg-gradient-to-br from-blue-600 to-blue-800 px-8 py-6 text-white">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center">
              <svg className="w-4.5 h-4.5 text-white" viewBox="0 0 20 20" fill="currentColor">
                <path d="M2.003 5.884L10 9.882l7.997-3.998A2 2 0 0016 4H4a2 2 0 00-1.997 1.884z"/>
                <path d="M18 8.118l-8 4-8-4V14a2 2 0 002 2h12a2 2 0 002-2V8.118z"/>
              </svg>
            </div>
            <h1 className="text-lg font-bold">Welcome to Cortex Executive Inbox</h1>
          </div>
          <p className="text-blue-100 text-sm">Set up your workspace in 2 steps.</p>
          <div className="flex gap-1.5 mt-4">
            {[1, 2, 3].map(n => (
              <div key={n} className={`h-1 flex-1 rounded-full transition-all duration-300 ${n <= step ? 'bg-white' : 'bg-white/30'}`} />
            ))}
          </div>
        </div>

        <div className="px-8 py-6">
          {step === 1 && (
            <div>
              <div className="text-center mb-5">
                <div className="text-4xl mb-3">📧</div>
                <h2 className="text-base font-semibold text-gray-900">Connect your email</h2>
                <p className="text-sm text-gray-500 mt-1">
                  Add Gmail, Outlook, Yahoo, or any IMAP account.
                </p>
              </div>
              <button
                onClick={() => onOpenSettings('accounts')}
                className="w-full bg-blue-600 text-white py-2.5 rounded-xl text-sm font-semibold hover:bg-blue-700 transition-colors flex items-center justify-center gap-2 mb-2.5"
              >
                <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd"/>
                </svg>
                Open Settings → Accounts
              </button>
              <button
                onClick={checkEmailAccount}
                disabled={checking}
                className="w-full border border-gray-200 text-gray-600 py-2.5 rounded-xl text-sm font-medium hover:bg-gray-50 transition-colors flex items-center justify-center gap-1.5"
              >
                {checking
                  ? <><span className="animate-spin inline-block leading-none">⟳</span> Checking…</>
                  : "I've added an account — continue →"}
              </button>
              {error && <p className="text-xs text-red-500 mt-2 text-center">{error}</p>}
            </div>
          )}

          {step === 2 && (
            <div>
              <div className="text-center mb-5">
                <div className="text-4xl mb-3">🤖</div>
                <h2 className="text-base font-semibold text-gray-900">Add an AI provider</h2>
                <p className="text-sm text-gray-500 mt-1">
                  Connect Claude, ChatGPT, Gemini, or Ollama to power smart replies, summaries, and Ask.
                </p>
              </div>
              <button
                onClick={() => onOpenSettings('ai')}
                className="w-full bg-blue-600 text-white py-2.5 rounded-xl text-sm font-semibold hover:bg-blue-700 transition-colors flex items-center justify-center gap-2 mb-2.5"
              >
                Open Settings → AI Providers
              </button>
              <button
                onClick={() => setStep(3)}
                className="w-full border border-gray-200 text-gray-600 py-2.5 rounded-xl text-sm font-medium hover:bg-gray-50 transition-colors"
              >
                I've configured it (or skip for now) →
              </button>
            </div>
          )}

          {step === 3 && (
            <div className="text-center py-2">
              <div className="text-5xl mb-4">🎉</div>
              <h2 className="text-base font-semibold text-gray-900 mb-2">You're all set!</h2>
              <p className="text-sm text-gray-500 mb-6">
                Cortex Executive Inbox is fetching your emails now. Check the{' '}
                <strong>Focus</strong> tab for priority items and use <strong>Ask</strong> to search across everything.
              </p>
              <button
                onClick={onComplete}
                className="w-full bg-blue-600 text-white py-2.5 rounded-xl text-sm font-semibold hover:bg-blue-700 transition-colors"
              >
                Start using Cortex Executive Inbox
              </button>
            </div>
          )}

          {step !== 3 && (
            <button
              onClick={onComplete}
              className="w-full text-center text-xs text-gray-400 hover:text-gray-500 mt-4 transition-colors"
            >
              Skip setup
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
