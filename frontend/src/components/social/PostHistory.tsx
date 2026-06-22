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

export function PostHistory() {
  const [posts, setPosts] = useState<LinkedInPost[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [deleting, setDeleting] = useState<Set<string>>(new Set())

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
          const text = post.post_text || ''
          const truncated = text.length > 100 ? text.slice(0, 100) + '…' : text

          return (
            <div key={post.id} className="border border-gray-200 rounded-xl p-4 space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900 truncate">{post.topic || post.subject || '(no topic)'}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{new Date(post.created_at).toLocaleDateString()}</p>
                </div>
                <span className={`flex-shrink-0 px-2 py-0.5 rounded-full text-[11px] font-medium ${STATUS_STYLES[post.status] ?? 'bg-gray-100 text-gray-500'}`}>
                  {statusLabel(post)}
                </span>
              </div>

              <p className="text-xs text-gray-600 leading-relaxed">
                {isExpanded ? text : truncated}
                {text.length > 100 && (
                  <button
                    onClick={() => toggleExpand(post.id)}
                    className="ml-1 text-accent hover:underline"
                  >
                    {isExpanded ? 'Show less' : 'Show more'}
                  </button>
                )}
              </p>

              <div className="flex items-center gap-3 pt-1">
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
