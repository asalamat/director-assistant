import type { EmailMessage } from '../types'

interface Props {
  email: EmailMessage | null
  loading: boolean
  onAnalyze: () => void
  analyzing: boolean
}

function formatDateFull(dateStr: string | null): string {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleString([], {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

export function EmailViewer({ email, loading, onAnalyze, analyzing }: Props) {
  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-white">
        <div className="text-gray-400 text-sm animate-pulse">Loading email…</div>
      </div>
    )
  }

  if (!email) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-white gap-2">
        <div className="text-4xl">✉️</div>
        <p className="text-gray-400 text-sm">Select an email to read it</p>
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col bg-white overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-gray-100">
        <div className="flex items-start justify-between gap-4">
          <h2 className="text-lg font-semibold text-gray-900 flex-1">{email.subject || '(no subject)'}</h2>
          <button
            onClick={onAnalyze}
            disabled={analyzing}
            className="flex-shrink-0 flex items-center gap-1.5 bg-accent text-white text-xs font-medium px-3 py-1.5 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-60"
          >
            {analyzing ? (
              <>
                <span className="animate-spin">⟳</span>
                <span>Analyzing…</span>
              </>
            ) : (
              <>
                <span>✦</span>
                <span>AI Analysis</span>
              </>
            )}
          </button>
        </div>

        <div className="mt-2 space-y-1">
          <div className="flex gap-2 text-sm">
            <span className="text-gray-400 w-12 flex-shrink-0">From</span>
            <span className="text-gray-800">{email.sender}</span>
          </div>
          {email.recipients.length > 0 && (
            <div className="flex gap-2 text-sm">
              <span className="text-gray-400 w-12 flex-shrink-0">To</span>
              <span className="text-gray-700">{email.recipients.join(', ')}</span>
            </div>
          )}
          <div className="flex gap-2 text-sm">
            <span className="text-gray-400 w-12 flex-shrink-0">Date</span>
            <span className="text-gray-500">{formatDateFull(email.date)}</span>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {email.body_html ? (
          <div
            className="prose prose-sm max-w-none text-gray-800"
            dangerouslySetInnerHTML={{ __html: email.body_html }}
          />
        ) : (
          <pre className="whitespace-pre-wrap font-sans text-sm text-gray-800 leading-relaxed">
            {email.body || '(empty)'}
          </pre>
        )}
      </div>
    </div>
  )
}
