export interface ReviewData {
  tone: string
  tone_label: 'good' | 'warning' | 'issue'
  unanswered_questions: string[]
  commitments: string[]
  suggestions: string[]
  ready: boolean
}

interface Props {
  review: ReviewData
  onDismiss: () => void
}

export function ComposeReviewPanel({ review, onDismiss }: Props) {
  const isGood = review.tone_label === 'good'
  const isIssue = review.tone_label === 'issue'
  return (
    <div className={`rounded-lg border p-3 text-xs space-y-2 ${
      isGood ? 'border-green-200 bg-green-50' :
      isIssue ? 'border-red-200 bg-red-50' :
      'border-amber-200 bg-amber-50'
    }`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span>{isGood ? '✅' : isIssue ? '⚠️' : '💡'}</span>
          <span className={`font-medium ${isGood ? 'text-green-800' : isIssue ? 'text-red-800' : 'text-amber-800'}`}>
            {review.tone}
          </span>
        </div>
        <button onClick={onDismiss} className="text-gray-400 hover:text-gray-600 text-[10px]">✕</button>
      </div>
      {review.unanswered_questions.length > 0 && (
        <div>
          <p className="font-semibold text-red-700 mb-1">Unanswered questions:</p>
          <ul className="space-y-0.5 list-disc list-inside">
            {review.unanswered_questions.map((q, i) => <li key={i} className="text-red-700">{q}</li>)}
          </ul>
        </div>
      )}
      {review.commitments.length > 0 && (
        <div>
          <p className="font-semibold text-gray-600 mb-1">Commitments in this draft:</p>
          <ul className="space-y-0.5 list-disc list-inside">
            {review.commitments.map((c, i) => <li key={i} className="text-gray-600">{c}</li>)}
          </ul>
        </div>
      )}
      {review.suggestions.length > 0 && (
        <div>
          <p className="font-semibold text-amber-700 mb-1">Suggestions:</p>
          <ul className="space-y-0.5 list-disc list-inside">
            {review.suggestions.map((s, i) => <li key={i} className="text-amber-700">{s}</li>)}
          </ul>
        </div>
      )}
    </div>
  )
}
