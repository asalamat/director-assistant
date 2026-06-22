import { useEffect, useState } from 'react'
import { api } from '../../api/client'

interface LinkedInPost {
  id: string
  subject: string
  topic: string
  post_text: string
  audience: string
  tone: string
  image_url: string | null
  content_type: string
  scheduled_at: string | null
  published_at: string | null
  linkedin_post_id: string | null
  status: string
  created_at: string
}

const STATUS_STYLES: Record<string, string> = {
  draft:     'bg-gray-100 text-gray-600',
  scheduled: 'bg-amber-100 text-amber-700',
  published: 'bg-green-100 text-green-700',
  failed:    'bg-red-100 text-red-600',
}

function statusLabel(post: LinkedInPost): string {
  if (post.status === 'scheduled' && post.scheduled_at) {
    return `Scheduled ${new Date(post.scheduled_at).toLocaleDateString()}`
  }
  return post.status.charAt(0).toUpperCase() + post.status.slice(1)
}

function contentTypeLabel(ct: string): string {
  if (ct === 'image') return '🖼 Image only'
  if (ct === 'article') return '📄 Text only'
  return '🖼+📄 Image & text'
}

export function PostHistory() {
  const [posts, setPosts] = useState<LinkedInPost[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [deleting, setDeleting] = useState<Set<string>>(new Set())
  const [retrying, setRetrying] = useState<Set<string>>(new Set())
  const [retryError, setRetryError] = useState<Record<string, string>>({})
  // Ask AI state
  const [askOpen, setAskOpen] = useState<Set<string>>(new Set())
  const [askInput, setAskInput] = useState<Record<string, string>>({})
  const [askLoading, setAskLoading] = useState<Set<string>>(new Set())
  const [askAnswer, setAskAnswer] = useState<Record<string, string>>({})

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    api.getLinkedInHistory()
      .then(r => { if (!cancelled) setPosts(r.posts) })
      .catch(e => { if (!cancelled) setError(e.message || 'Failed to load history') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const toggleAsk = (id: string) => {
    setAskOpen(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const handleRetry = async (post: LinkedInPost) => {
    setRetrying(prev => new Set(prev).add(post.id))
    setRetryError(prev => { const n = {...prev}; delete n[post.id]; return n })
    try {
      const r = await (api as any).publishLinkedInPost({
        id: post.id,
        post_text: post.post_text || '',
        content_type: post.content_type || 'article',
        image_url: post.image_url || '',
        topic: post.topic || '',
        subject: post.subject || '',
      })
      if (r.error) {
        setRetryError(prev => ({...prev, [post.id]: r.error}))
      } else {
        setPosts(prev => prev.map(p => p.id === post.id ? {...p, status: 'published', linkedin_post_id: r.linkedin_post_id} : p))
      }
    } catch (e) {
      setRetryError(prev => ({...prev, [post.id]: (e as Error).message}))
    } finally {
      setRetrying(prev => { const next = new Set(prev); next.delete(post.id); return next })
    }
  }

  const handleAsk = async (post: LinkedInPost) => {
    const question = (askInput[post.id] || '').trim()
    if (!question) return
    setAskLoading(prev => new Set(prev).add(post.id))
    setAskAnswer(prev => { const n = {...prev}; delete n[post.id]; return n })
    try {
      const r = await fetch('/api/linkedin/ask', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ topic: post.topic, post_text: post.post_text, question }),
      })
      const data = await r.json()
      if (data.error) {
        setAskAnswer(prev => ({...prev, [post.id]: `Error: ${data.error}`}))
      } else {
        setAskAnswer(prev => ({...prev, [post.id]: data.answer}))
      }
    } catch (e) {
      setAskAnswer(prev => ({...prev, [post.id]: 'Failed to get answer'}))
    } finally {
      setAskLoading(prev => { const next = new Set(prev); next.delete(post.id); return next })
    }
  }

  const handleDelete = async (id: string) => {
    setDeleting(prev => new Set(prev).add(id))
    try {
      await api.deleteLinkedInPost(id)
      setPosts(prev => prev.filter(p => p.id !== id))
    } catch {
      // silently restore
    } finally {
      setDeleting(prev => { const next = new Set(prev); next.delete(id); return next })
    }
  }

  return (
    <div className="flex flex-col h-full overflow-y-auto p-6 max-w-3xl mx-auto space-y-5">
      <div>
        <h2 className="text-base font-semibold text-gray-900">Post History</h2>
        <p className="text-xs text-gray-500 mt-0.5">All LinkedIn posts — drafts, scheduled, published, and failed.</p>
      </div>

      {loading && <p className="text-sm text-gray-400">Loading…</p>}
      {error && <p className="text-sm text-red-500">{error}</p>}

      {!loading && !error && posts.length === 0 && (
        <div className="border border-dashed border-gray-200 rounded-xl p-8 text-center">
          <p className="text-sm text-gray-400">No posts yet — create your first LinkedIn post</p>
        </div>
      )}

      <div className="space-y-3">
        {posts.map(post => {
          const isExpanded = expanded.has(post.id)
          const isAskOpen = askOpen.has(post.id)
          const text = post.post_text || ''
          const truncated = text.length > 120 ? text.slice(0, 120) + '…' : text

          return (
            <div key={post.id} className="border border-gray-200 rounded-xl p-4 space-y-3">
              {/* Header row */}
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900 truncate">{post.topic || post.subject || '(no topic)'}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <p className="text-xs text-gray-400">{new Date(post.created_at).toLocaleDateString()}</p>
                    <span className="text-[10px] text-gray-400">·</span>
                    <p className="text-[10px] text-gray-400">{contentTypeLabel(post.content_type)}</p>
                  </div>
                </div>
                <span className={`flex-shrink-0 px-2 py-0.5 rounded-full text-[11px] font-medium ${STATUS_STYLES[post.status] ?? 'bg-gray-100 text-gray-500'}`}>
                  {statusLabel(post)}
                </span>
              </div>

              {/* Image thumbnail if saved */}
              {post.image_url && (
                <div className="rounded-lg overflow-hidden border border-gray-100 max-h-40">
                  <img src={post.image_url} alt="Post image" className="w-full object-cover max-h-40" />
                </div>
              )}

              {/* Post text */}
              <p className="text-xs text-gray-600 leading-relaxed">
                {isExpanded ? text : truncated}
                {text.length > 120 && (
                  <button
                    onClick={() => toggleExpand(post.id)}
                    className="ml-1 text-accent hover:underline"
                  >
                    {isExpanded ? 'Show less' : 'Show more'}
                  </button>
                )}
              </p>

              {retryError[post.id] && (
                <p className="text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2 leading-relaxed">{retryError[post.id]}</p>
              )}

              {/* Ask AI panel */}
              {isAskOpen && (
                <div className="bg-gray-50 rounded-xl p-3 space-y-2">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      className="flex-1 px-3 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent placeholder-gray-400"
                      placeholder={`Ask about "${post.topic || 'this post'}"…`}
                      value={askInput[post.id] || ''}
                      onChange={e => setAskInput(prev => ({...prev, [post.id]: e.target.value}))}
                      onKeyDown={e => { if (e.key === 'Enter') handleAsk(post) }}
                    />
                    <button
                      onClick={() => handleAsk(post)}
                      disabled={askLoading.has(post.id) || !(askInput[post.id] || '').trim()}
                      className="px-3 py-1.5 bg-accent text-white rounded-lg text-xs font-medium hover:opacity-90 disabled:opacity-50 transition"
                    >
                      {askLoading.has(post.id) ? '…' : 'Ask'}
                    </button>
                  </div>
                  {askAnswer[post.id] && (
                    <p className="text-xs text-gray-700 leading-relaxed whitespace-pre-wrap">{askAnswer[post.id]}</p>
                  )}
                </div>
              )}

              {/* Action buttons */}
              <div className="flex items-center gap-2 flex-wrap pt-0.5">
                {post.status === 'published' && post.linkedin_post_id && (
                  <a
                    href={`https://www.linkedin.com/feed/update/${post.linkedin_post_id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-accent hover:underline font-medium"
                  >
                    View on LinkedIn
                  </a>
                )}
                {post.status !== 'scheduled' && (
                  <button
                    onClick={() => handleRetry(post)}
                    disabled={retrying.has(post.id)}
                    className="text-xs font-medium text-white bg-accent px-3 py-1 rounded-lg hover:opacity-90 disabled:opacity-50 transition"
                  >
                    {retrying.has(post.id) ? 'Posting…' : post.status === 'published' ? '↺ Post Again' : '↺ Retry'}
                  </button>
                )}
                <button
                  onClick={() => toggleAsk(post.id)}
                  className={`text-xs font-medium px-3 py-1 rounded-lg border transition ${
                    isAskOpen
                      ? 'border-accent text-accent bg-blue-50'
                      : 'border-gray-200 text-gray-600 hover:border-accent hover:text-accent'
                  }`}
                >
                  Ask AI
                </button>
                <button
                  onClick={() => handleDelete(post.id)}
                  disabled={deleting.has(post.id)}
                  className="text-xs text-gray-400 hover:text-red-500 disabled:opacity-50 ml-auto"
                >
                  {deleting.has(post.id) ? 'Deleting…' : 'Delete'}
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
