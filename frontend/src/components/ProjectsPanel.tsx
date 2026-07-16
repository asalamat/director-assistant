import { useState, useEffect } from 'react'
import DOMPurify from 'dompurify'
import { api } from '../api/client'
import { EmptyState, Spinner, Button } from './ui'
import { useEmailContext } from '../contexts/EmailContext'
import { useUIContext } from '../contexts/UIContext'
import { ProjectNotes } from './ProjectNotes'
import { ProjectTaskBoard } from './ProjectTaskBoard'
import { ProjectGantt, GanttTask } from './ProjectGantt'
import { ProjectDashboard } from './ProjectDashboard'
import { ProjectMilestones } from './ProjectMilestones'
import { ProjectBudget } from './ProjectBudget'
import { ProjectBurndown } from './ProjectBurndown'
import { ProjectTemplates } from './ProjectTemplates'

interface Project { id: number; name: string; description: string; status: string; email_count: number; created_at: string }

interface ProjectPlan {
  summary: string
  objectives: string[]
  phases: Array<{
    name: string; start_week: number; duration_weeks: number; milestone: string
    tasks: Array<{ name: string; duration_days: number; assignee: string; priority: string }>
  }>
  risks: Array<{ description: string; impact: string; mitigation: string }>
  estimated_duration_weeks: number
}

const STATUS_COLORS: Record<string, string> = {
  active:   'bg-green-100 text-green-700',
  paused:   'bg-amber-100 text-amber-700',
  resolved: 'bg-gray-100 text-gray-500',
}

const IMPACT_COLORS: Record<string, string> = {
  high:   'bg-red-100 text-red-700',
  medium: 'bg-amber-100 text-amber-700',
  low:    'bg-green-100 text-green-700',
}

const PRIORITY_COLORS: Record<string, string> = {
  high:   'bg-red-50 text-red-600',
  medium: 'bg-amber-50 text-amber-600',
  low:    'bg-gray-50 text-gray-500',
}

const esc = (s: string | number) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function buildPlanHTML(project: Project, plan: ProjectPlan): string {
  const phases = plan.phases.map(ph => `
    <h3 style="margin:16px 0 6px;font-size:14px;color:#1e293b">${esc(ph.name)} — Week ${esc(ph.start_week)}, ${esc(ph.duration_weeks)}w (${esc(ph.milestone)})</h3>
    <table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:8px">
      <thead><tr style="background:#f1f5f9">
        <th style="padding:4px 8px;text-align:left;border:1px solid #e2e8f0">Task</th>
        <th style="padding:4px 8px;text-align:left;border:1px solid #e2e8f0">Days</th>
        <th style="padding:4px 8px;text-align:left;border:1px solid #e2e8f0">Assignee</th>
        <th style="padding:4px 8px;text-align:left;border:1px solid #e2e8f0">Priority</th>
      </tr></thead>
      <tbody>${ph.tasks.map(t => `<tr>
        <td style="padding:4px 8px;border:1px solid #e2e8f0">${esc(t.name)}</td>
        <td style="padding:4px 8px;border:1px solid #e2e8f0">${esc(t.duration_days)}</td>
        <td style="padding:4px 8px;border:1px solid #e2e8f0">${esc(t.assignee)}</td>
        <td style="padding:4px 8px;border:1px solid #e2e8f0">${esc(t.priority)}</td>
      </tr>`).join('')}</tbody>
    </table>`).join('')
  const risks = plan.risks.map(r => `
    <tr><td style="padding:4px 8px;border:1px solid #e2e8f0">${esc(r.description)}</td>
    <td style="padding:4px 8px;border:1px solid #e2e8f0">${esc(r.impact)}</td>
    <td style="padding:4px 8px;border:1px solid #e2e8f0">${esc(r.mitigation)}</td></tr>`).join('')
  return `<!DOCTYPE html><html><head><title>${esc(project.name)} — Project Plan</title>
  <style>body{font-family:system-ui,sans-serif;max-width:800px;margin:32px auto;color:#334155;font-size:13px}
  h1{font-size:20px;margin-bottom:4px}h2{font-size:15px;margin:20px 0 8px;border-bottom:1px solid #e2e8f0;padding-bottom:4px}
  ul{margin:4px 0 0 20px;padding:0}li{margin-bottom:2px}@media print{body{margin:0}}</style></head>
  <body><h1>${esc(project.name)}</h1><p style="color:#64748b;font-size:12px">Estimated duration: ${esc(plan.estimated_duration_weeks)} weeks</p>
  <h2>Summary</h2><p>${esc(plan.summary)}</p>
  <h2>Objectives</h2><ul>${plan.objectives.map(o => `<li>${esc(o)}</li>`).join('')}</ul>
  <h2>Phases &amp; Tasks</h2>${phases}
  <h2>Risks</h2><table style="width:100%;border-collapse:collapse;font-size:12px">
  <thead><tr style="background:#f1f5f9">
    <th style="padding:4px 8px;text-align:left;border:1px solid #e2e8f0">Risk</th>
    <th style="padding:4px 8px;text-align:left;border:1px solid #e2e8f0">Impact</th>
    <th style="padding:4px 8px;text-align:left;border:1px solid #e2e8f0">Mitigation</th>
  </tr></thead><tbody>${risks}</tbody></table>
  </body></html>`
}

interface ProjectPlanViewProps { plan: ProjectPlan }

function ProjectPlanView({ plan }: ProjectPlanViewProps) {
  const [expandedPhase, setExpandedPhase] = useState<number | null>(null)
  return (
    <div className="mt-3 space-y-3">
      <p className="text-xs text-gray-600 leading-relaxed">{plan.summary}</p>
      {plan.objectives.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-700 mb-1">Objectives</p>
          <ul className="space-y-0.5 pl-3">
            {plan.objectives.map((o, i) => (
              <li key={i} className="text-xs text-gray-600 list-disc">{o}</li>
            ))}
          </ul>
        </div>
      )}
      <div>
        <p className="text-xs font-semibold text-gray-700 mb-1">Phases</p>
        <div className="space-y-1">
          {plan.phases.map((ph, i) => (
            <div key={i} className="border border-gray-100 rounded-lg overflow-hidden">
              <button className="w-full flex items-center justify-between px-3 py-2 bg-gray-50 hover:bg-gray-100 text-left transition-colors"
                onClick={() => setExpandedPhase(expandedPhase === i ? null : i)}>
                <span className="text-xs font-medium text-gray-800">{ph.name}</span>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-gray-400">{ph.duration_weeks}w · {ph.tasks.length} tasks</span>
                  <span className="text-[10px] text-gray-400">{expandedPhase === i ? '▲' : '▼'}</span>
                </div>
              </button>
              {ph.milestone && <p className="px-3 py-1 text-[10px] text-accent bg-blue-50">{ph.milestone}</p>}
              {expandedPhase === i && (
                <table className="w-full text-xs">
                  <thead><tr className="bg-gray-50">
                    <th className="px-3 py-1.5 text-left text-[10px] text-gray-500 font-medium">Task</th>
                    <th className="px-2 py-1.5 text-left text-[10px] text-gray-500 font-medium">Days</th>
                    <th className="px-2 py-1.5 text-left text-[10px] text-gray-500 font-medium">Assignee</th>
                    <th className="px-2 py-1.5 text-left text-[10px] text-gray-500 font-medium">Pri</th>
                  </tr></thead>
                  <tbody>{ph.tasks.map((t, j) => (
                    <tr key={j} className="border-t border-gray-50">
                      <td className="px-3 py-1.5 text-gray-700">{t.name}</td>
                      <td className="px-2 py-1.5 text-gray-500">{t.duration_days}</td>
                      <td className="px-2 py-1.5 text-gray-500 truncate max-w-[80px]">{t.assignee}</td>
                      <td className="px-2 py-1.5">
                        <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${PRIORITY_COLORS[t.priority.toLowerCase()] || PRIORITY_COLORS.low}`}>
                          {t.priority}
                        </span>
                      </td>
                    </tr>
                  ))}</tbody>
                </table>
              )}
            </div>
          ))}
        </div>
      </div>
      {plan.risks.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-700 mb-1">Risks</p>
          <div className="space-y-1">
            {plan.risks.map((r, i) => (
              <div key={i} className="border border-gray-100 rounded-lg px-3 py-2">
                <div className="flex items-start gap-2">
                  <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium flex-shrink-0 mt-0.5 ${IMPACT_COLORS[r.impact.toLowerCase()] || IMPACT_COLORS.medium}`}>
                    {r.impact}
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs text-gray-700">{r.description}</p>
                    <p className="text-[10px] text-gray-400 mt-0.5">{r.mitigation}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export function ProjectsPanel() {
  const { emails, selectEmail, fetchEmail } = useEmailContext()
  const { setActiveTab, openCompose } = useUIContext()
  const handleEmailSelect = (id: string) => {
    const em = emails.find(e => e.id === id)
    if (em) { selectEmail(em); setActiveTab('inbox') }
    else { fetchEmail(id); setActiveTab('inbox') }
  }
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [wizardStep, setWizardStep] = useState<'name' | 'brief'>('name')
  const [newName, setNewName] = useState('')
  const [wizardGoal, setWizardGoal] = useState('')
  const [wizardTimeline, setWizardTimeline] = useState('')
  const [wizardStakeholders, setWizardStakeholders] = useState('')
  const [wizardDeliverables, setWizardDeliverables] = useState('')
  const [wizardConstraints, setWizardConstraints] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [saving, setSaving] = useState(false)
  const [selected, setSelected] = useState<Project | null>(null)
  const [projEmails, setProjEmails] = useState<any[]>([])
  const [emailsLoading, setEmailsLoading] = useState(false)
  const [filter, setFilter] = useState<'all' | 'active' | 'paused' | 'resolved'>('all')
  const [plan, setPlan] = useState<ProjectPlan | null>(null)
  const [planLoading, setPlanLoading] = useState(false)
  const [planMsg, setPlanMsg] = useState('')
  const [ganttTasks, setGanttTasks] = useState<GanttTask[]>([])
  const [weeklyUpdate, setWeeklyUpdate] = useState<{ subject: string; body: string } | null>(null)
  const [weeklyLoading, setWeeklyLoading] = useState(false)
  const [showWeekly, setShowWeekly] = useState(false)
  const [recommendations, setRecommendations] = useState<{ health?: string } | null>(null)
  const [savingTemplate, setSavingTemplate] = useState(false)
  const [clientReportLoading, setClientReportLoading] = useState(false)

  const load = () => {
    setLoading(true)
    api.getProjects().then(r => setProjects(r.projects)).catch(() => setProjects([])).finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  const resetWizard = () => {
    setNewName(''); setWizardGoal(''); setWizardTimeline(''); setWizardStakeholders('')
    setWizardDeliverables(''); setWizardConstraints(''); setNewDesc(''); setWizardStep('name')
    setShowCreate(false)
  }

  const advanceToWizardBrief = () => {
    if (!newName.trim()) return
    setWizardStep('brief')
  }

  const create = async () => {
    if (!newName.trim()) return
    setSaving(true)
    const parts: string[] = []
    if (wizardGoal.trim())         parts.push(`Goal: ${wizardGoal.trim()}`)
    if (wizardTimeline.trim())     parts.push(`Timeline: ${wizardTimeline.trim()}`)
    if (wizardStakeholders.trim()) parts.push(`Stakeholders: ${wizardStakeholders.trim()}`)
    if (wizardDeliverables.trim()) parts.push(`Deliverables: ${wizardDeliverables.trim()}`)
    if (wizardConstraints.trim())  parts.push(`Constraints: ${wizardConstraints.trim()}`)
    const description = parts.join('\n')
    try {
      const r = await api.createProject({ name: newName.trim(), description, status: 'active' })
      resetWizard()
      load()
      // Auto-open the new project and generate plan if brief was filled
      if (parts.length > 0 && r && (r as any).id) {
        const proj = { id: (r as any).id, name: newName.trim(), description, status: 'active', email_count: 0, created_at: '' }
        setSelected(proj); setProjEmails([]); setPlan(null)
        setPlanLoading(true); setPlanMsg('AI is creating your project plan…')
        try {
          const planRes = await api.generateProjectPlan((r as any).id)
          setPlan(planRes.plan); setPlanMsg('')
        } catch { setPlanMsg('Plan generation failed — click Generate Plan to retry') }
        setPlanLoading(false)
      }
    } catch { /* silent */ }
    setSaving(false)
  }

  const openProject = async (proj: Project) => {
    setSelected(proj)
    setPlan(null)
    setPlanMsg('')
    setGanttTasks([])
    setWeeklyUpdate(null)
    setShowWeekly(false)
    setRecommendations(null)
    setProjDocIds(new Set())
    setEmailsLoading(true)
    const [emailsRes, planRes, tasksRes, docsRes] = await Promise.allSettled([
      api.getProjectEmails(proj.id),
      api.getProjectPlan(proj.id),
      api.getProjectTasks(proj.id),
      api.getProjectDocuments(proj.id),
    ])
    if (emailsRes.status === 'fulfilled') setProjEmails(emailsRes.value.emails)
    else setProjEmails([])
    if (planRes.status === 'fulfilled' && planRes.value?.plan) setPlan(planRes.value.plan)
    if (tasksRes.status === 'fulfilled') setGanttTasks(tasksRes.value.tasks || [])
    if (docsRes.status === 'fulfilled') {
      const savedIds = new Set(docsRes.value.documents.map((d: {doc_id: string}) => d.doc_id))
      setProjDocIds(savedIds)
      // Populate indexedDocs with saved filenames so they show even without opening picker
      setIndexedDocs(prev => {
        const merged = [...prev]
        docsRes.value.documents.forEach((d: {doc_id: string; filename: string}) => {
          if (!merged.find(m => m.doc_id === d.doc_id)) {
            merged.push({ doc_id: d.doc_id, filename: d.filename, file_type: '' })
          }
        })
        return merged
      })
    }
    setEmailsLoading(false)
  }

  const cycleStatus = async (proj: Project, e: React.MouseEvent) => {
    e.stopPropagation()
    const next = proj.status === 'active' ? 'paused' : proj.status === 'paused' ? 'resolved' : 'active'
    await api.updateProject(proj.id, { status: next })
    setProjects(prev => prev.map(p => p.id === proj.id ? { ...p, status: next } : p))
    if (selected?.id === proj.id) setSelected(prev => prev ? { ...prev, status: next } : null)
  }

  const deleteProject = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirm('Delete this project?')) return
    await api.deleteProject(id)
    setProjects(prev => prev.filter(p => p.id !== id))
    if (selected?.id === id) setSelected(null)
  }

  const unlinkEmail = async (emailId: string) => {
    if (!selected) return
    await api.unlinkEmailFromProject(selected.id, emailId)
    setProjEmails(prev => prev.filter(e => e.id !== emailId))
    setProjects(prev => prev.map(p => p.id === selected.id ? { ...p, email_count: Math.max(0, p.email_count - 1) } : p))
  }

  const [showDocPicker, setShowDocPicker] = useState(false)
  const [indexedDocs, setIndexedDocs] = useState<{doc_id: string; filename: string; file_type: string}[]>([])
  const [projDocIds, setProjDocIds] = useState<Set<string>>(new Set())

  const openDocPicker = async () => {
    setShowDocPicker(true)
    const r = await api.listDocuments().catch(() => ({ documents: [] }))
    setIndexedDocs(r.documents || [])
  }

  const handleGeneratePlan = async () => {
    if (!selected) return
    setPlanLoading(true)
    setPlanMsg('')
    try {
      const res = await api.generateProjectPlan(selected.id)
      if (res?.plan) { setPlan(res.plan); setPlanMsg('') }
      else setPlanMsg('No plan returned.')
    } catch (err: any) {
      setPlanMsg(err?.message || 'Failed to generate plan.')
    }
    setPlanLoading(false)
  }

  const handleExportPDF = () => {
    if (!plan || !selected) return
    const html = buildPlanHTML(selected, plan)
    const w = window.open('', '_blank')
    w?.document.write(html)
    w?.document.close()
    w?.print()
  }

  const handleExportMSProject = async () => {
    if (!selected) return
    const res = await fetch(`/api/projects/${selected.id}/export/msproject`)
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `${selected.name}.xml`; a.click()
    URL.revokeObjectURL(url)
  }

  const handleWeeklyUpdate = async () => {
    if (!selected) return
    setWeeklyLoading(true)
    try {
      const res = await api.getWeeklyUpdate(selected.id)
      setWeeklyUpdate(res)
      setShowWeekly(true)
    } catch { /* silent */ }
    setWeeklyLoading(false)
  }

  const handleSaveAsTemplate = async () => {
    if (!selected) return
    setSavingTemplate(true)
    try {
      const res = await api.saveProjectAsTemplate(selected.id)
      alert(`Template saved: "${res.name}" (${res.task_count} tasks)`)
    } catch (err: any) {
      alert(err?.message || 'Failed to save template')
    }
    setSavingTemplate(false)
  }

  const [proposalLoading, setProposalLoading] = useState(false)

  const handleProposal = async () => {
    if (!selected) return
    setProposalLoading(true)
    try {
      const res = await api.generateProposal(selected.id)
      openCompose({ subject: res.subject, body: res.body })
    } catch { /* silent */ }
    setProposalLoading(false)
  }

  const handleClientReport = async () => {
    if (!selected) return
    setClientReportLoading(true)
    try {
      const res = await api.getClientReport(selected.id)
      const w = window.open('', '_blank')
      w?.document.write(DOMPurify.sanitize(res.html, { WHOLE_DOCUMENT: true, USE_PROFILES: { html: true } }))
      w?.document.close()
      w?.print()
    } catch { /* silent */ }
    setClientReportLoading(false)
  }

  const filtered = filter === 'all' ? projects : projects.filter(p => p.status === filter)

  if (selected) {
    return (
      <div className="flex flex-col h-full">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-3 flex-shrink-0">
          <button onClick={() => setSelected(null)} className="text-gray-400 hover:text-gray-700 text-xs">← Back</button>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold text-gray-800 truncate">{selected.name}</h2>
            {selected.description && <p className="text-xs text-gray-400 truncate">{selected.description}</p>}
          </div>
          <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[selected.status] || STATUS_COLORS.active}`}>
            {selected.status}
          </span>
          <button onClick={handleSaveAsTemplate} disabled={savingTemplate}
            className="text-[10px] border border-gray-200 px-2 py-1 rounded-lg hover:bg-gray-50 disabled:opacity-50 flex-shrink-0"
            title="Save tasks as a reusable template">
            {savingTemplate ? '…' : '💾 Template'}
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
          {/* Project Dashboard — stat tiles */}
          <ProjectDashboard
            project={selected}
            tasks={ganttTasks}
            plan={plan}
            recommendations={recommendations}
          />
          {emailsLoading && <div className="flex justify-center py-8"><Spinner size="md" /></div>}
          {!emailsLoading && projEmails.length === 0 && (
            <div className="py-4">
              <EmptyState icon="📎" title="No emails linked yet" description="Open an email and use the project linker to add emails here." />
            </div>
          )}
          {projEmails.map(e => (
            <div key={e.id} className={`border rounded-xl p-3 flex gap-3 hover:border-accent transition-colors cursor-pointer group ${!e.is_read ? 'bg-amber-50 border-amber-200' : 'bg-white border-gray-100'}`}
              onClick={() => handleEmailSelect(e.id)}>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800 truncate">{e.subject || '(no subject)'}</p>
                <p className="text-xs text-gray-500 truncate">{e.sender}</p>
                <p className="text-xs text-gray-400">{(e.date || '').slice(0, 10)} · {e.folder}</p>
              </div>
              <button onClick={(ev) => { ev.stopPropagation(); unlinkEmail(e.id) }}
                className="text-gray-200 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all p-1 flex-shrink-0"
                title="Unlink from project">✕</button>
            </div>
          ))}

          {/* Document linker */}
          <div className="border border-dashed border-gray-200 rounded-xl p-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-gray-500">📄 Documents</p>
              <button onClick={openDocPicker} className="text-xs text-accent hover:underline">+ Link document</button>
            </div>
            {projDocIds.size === 0 && <p className="text-xs text-gray-400 italic">No documents linked — add indexed docs to enrich the AI plan</p>}
            {Array.from(projDocIds).map(docId => {
              const doc = indexedDocs.find(d => d.doc_id === docId)
              return doc ? (
                <div key={docId} className="flex items-center gap-2 py-1">
                  <span className="text-xs text-gray-600 flex-1 truncate">📎 {doc.filename}</span>
                  <button onClick={async () => {
                    setProjDocIds(s => { const n = new Set(s); n.delete(docId); return n })
                    if (selected) await api.unlinkProjectDocument(selected.id, docId).catch(() => {})
                  }}
                    className="text-gray-300 hover:text-red-400 text-xs">✕</button>
                </div>
              ) : null
            })}
            {showDocPicker && (
              <div className="mt-2 border border-gray-200 rounded-lg overflow-hidden max-h-48 overflow-y-auto">
                {indexedDocs.length === 0 && <p className="text-xs text-gray-400 p-3">No indexed documents. Add folders in Settings → Documents.</p>}
                {indexedDocs.map(doc => (
                  <button key={doc.doc_id} onClick={async () => {
                    if (!selected) return
                    setProjDocIds(s => new Set([...s, doc.doc_id]))
                    setShowDocPicker(false)
                    await api.linkProjectDocument(selected.id, doc.doc_id, doc.filename).catch(() => {})
                  }}
                    className={`w-full text-left px-3 py-2 text-xs hover:bg-blue-50 border-b border-gray-50 last:border-0 flex items-center gap-2 ${projDocIds.has(doc.doc_id) ? 'text-accent font-medium' : 'text-gray-700'}`}>
                    <span className="flex-1 truncate">📎 {doc.filename}</span>
                    <span className="text-gray-400 flex-shrink-0">{doc.file_type}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* AI Plan section */}
          <div className="pt-2 border-t border-gray-100">
            <div className="flex items-center gap-2 flex-wrap">
              <button onClick={handleGeneratePlan} disabled={planLoading}
                className="text-xs bg-accent text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 disabled:opacity-50">
                {planLoading ? '⟳ Generating…' : plan ? '↺ Regenerate Plan' : '✦ Generate AI Plan'}
              </button>
              {plan && (
                <>
                  <button onClick={handleExportPDF}
                    className="text-xs border border-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-50">
                    📄 Export PDF
                  </button>
                  <button onClick={handleExportMSProject}
                    className="text-xs border border-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-50">
                    📊 MS Project (.xml)
                  </button>
                </>
              )}
              <button onClick={handleWeeklyUpdate} disabled={weeklyLoading}
                className="text-xs border border-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-50 disabled:opacity-50">
                {weeklyLoading ? '⟳ Drafting…' : '📅 Weekly Update'}
              </button>
              <button onClick={handleClientReport} disabled={clientReportLoading}
                className="text-xs border border-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-50 disabled:opacity-50">
                {clientReportLoading ? '⟳ Building…' : '📊 Client Report'}
              </button>
              <button onClick={handleProposal} disabled={proposalLoading}
                className="text-xs border border-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-50 disabled:opacity-50">
                {proposalLoading ? '⟳ Drafting…' : '📄 Proposal'}
              </button>
            </div>
            {planMsg && <p className="text-xs text-red-500 mt-1">{planMsg}</p>}
            {plan && <ProjectPlanView plan={plan} />}
          </div>

          {/* Milestone tracking */}
          <ProjectMilestones projectId={selected.id} />

          {/* Gantt chart */}
          <div className="pt-2 border-t border-gray-100">
            <p className="text-xs font-semibold text-gray-700 mb-2">Progress Diagram (Gantt)</p>
            {ganttTasks.length === 0 ? (
              <p className="text-xs text-gray-400 italic">Click <strong>⚡ Load from Plan</strong> in the Task Board below to populate tasks, then come back here to see the Gantt chart. Edit tasks in the Kanban board — the diagram updates automatically.</p>
            ) : (
              <ProjectGantt
                tasks={ganttTasks}
                onProgressChange={async (taskId, progress, status) => {
                  if (!selected) return
                  setGanttTasks(prev => prev.map(t => t.id === taskId ? { ...t, progress, status } : t))
                  await api.updateProjectTask(selected.id, taskId, { progress, status }).catch(() => {})
                }}
              />
            )}
          </div>

          {/* Budget tracking */}
          <ProjectBudget projectId={selected.id} />

          {/* Burndown chart */}
          {ganttTasks.length > 0 && (
            <ProjectBurndown
              tasks={ganttTasks as any[]}
              createdAt={selected.created_at}
              estimatedWeeks={plan?.estimated_duration_weeks ?? 8}
            />
          )}

          {/* Weekly Update modal */}
          {showWeekly && weeklyUpdate && (
            <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
              onClick={() => setShowWeekly(false)}>
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-5 space-y-3"
                onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-gray-800">Weekly Update Draft</p>
                  <button onClick={() => setShowWeekly(false)} className="text-gray-400 hover:text-gray-700 text-lg leading-none">✕</button>
                </div>
                <p className="text-sm font-medium text-gray-700 border-b border-gray-100 pb-2">{weeklyUpdate.subject}</p>
                <pre className="text-xs text-gray-600 whitespace-pre-wrap leading-relaxed max-h-64 overflow-y-auto font-sans">
                  {weeklyUpdate.body}
                </pre>
                <button
                  onClick={() => navigator.clipboard.writeText(`${weeklyUpdate.subject}\n\n${weeklyUpdate.body}`)}
                  className="w-full text-xs border border-gray-200 px-3 py-2 rounded-lg hover:bg-gray-50 text-gray-600">
                  📋 Copy
                </button>
              </div>
            </div>
          )}

          {/* Progress notes + AI review */}
          <div className="border-t border-gray-100 pt-4">
            <ProjectNotes projectId={selected.id} />
          </div>

          {/* Task Board */}
          <ProjectTaskBoard projectId={selected.id} />
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
        <div>
          <h2 className="text-sm font-semibold text-gray-800">Projects</h2>
          <p className="text-xs text-gray-400 mt-0.5">Link emails to deals and initiatives</p>
        </div>
        <Button variant="primary" size="sm" onClick={() => setShowCreate(v => !v)}>+ New</Button>
      </div>

      {showCreate && wizardStep === 'name' && (
        <div className="px-4 py-3 bg-blue-50 border-b border-blue-100 flex-shrink-0 space-y-2">
          <p className="text-xs font-semibold text-blue-700">Step 1 of 2 — Project Name</p>
          <ProjectTemplates onCreated={(projId, projName) => {
            resetWizard()
            load()
            const proj = { id: projId, name: projName, description: '', status: 'active', email_count: 0, created_at: '' }
            setSelected(proj)
            setProjEmails([])
            setPlan(null)
          }} />
          <input value={newName} onChange={e => setNewName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && newName.trim() && advanceToWizardBrief()}
            placeholder="e.g. Website Redesign, Q3 Sales Campaign… (or use template above)"
            className="w-full text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-accent bg-white" autoFocus />
          <div className="flex gap-2 justify-end">
            <button onClick={resetWizard} className="text-xs text-gray-500 px-2 py-1">Cancel</button>
            <Button variant="primary" size="sm" onClick={advanceToWizardBrief} disabled={!newName.trim()}>Next →</Button>
          </div>
        </div>
      )}

      {showCreate && wizardStep === 'brief' && (
        <div className="px-4 py-3 bg-blue-50 border-b border-blue-100 flex-shrink-0 space-y-2.5">
          <div className="flex items-center gap-2">
            <button onClick={() => setWizardStep('name')} className="text-xs text-blue-600 hover:underline">← Back</button>
            <p className="text-xs font-semibold text-blue-700">Step 2 of 2 — Project Brief for <span className="text-blue-900">{newName}</span></p>
          </div>
          <p className="text-[11px] text-blue-600">AI will use these details to build a detailed project plan. Fill in what you know — skip the rest.</p>
          {[
            { label: 'Goal / Objective', val: wizardGoal, set: setWizardGoal, ph: 'What does success look like?' },
            { label: 'Timeline / Deadline', val: wizardTimeline, set: setWizardTimeline, ph: 'e.g. 3 months, by Sep 30' },
            { label: 'Key Stakeholders', val: wizardStakeholders, set: setWizardStakeholders, ph: 'e.g. CEO, Marketing team, Client X' },
            { label: 'Main Deliverables', val: wizardDeliverables, set: setWizardDeliverables, ph: 'e.g. new website, launch campaign, signed contract' },
            { label: 'Risks / Constraints', val: wizardConstraints, set: setWizardConstraints, ph: 'e.g. limited budget, dependency on vendor' },
          ].map(({ label, val, set, ph }) => (
            <div key={label}>
              <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide block mb-0.5">{label}</label>
              <input value={val} onChange={e => set(e.target.value)} placeholder={ph}
                className="w-full text-sm border border-gray-200 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-accent bg-white" />
            </div>
          ))}
          <div className="flex gap-2 justify-end pt-1">
            <button onClick={resetWizard} className="text-xs text-gray-500 px-2 py-1">Cancel</button>
            <button onClick={create} disabled={saving}
              className="text-xs border border-gray-200 text-gray-600 px-3 py-1.5 rounded-lg hover:bg-white disabled:opacity-50">
              {saving ? '…' : 'Create without plan'}
            </button>
            <Button variant="primary" size="sm" loading={saving} onClick={create} disabled={saving}>
              ✦ Create &amp; Generate Plan
            </Button>
          </div>
        </div>
      )}

      <div className="px-4 py-2 border-b border-gray-50 flex gap-1 flex-shrink-0">
        {(['all', 'active', 'paused', 'resolved'] as const).map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`text-xs px-2.5 py-1 rounded-lg transition-colors ${filter === f ? 'bg-accent text-white' : 'text-gray-500 hover:bg-gray-100'}`}>
            {f.charAt(0).toUpperCase() + f.slice(1)} ({(f === 'all' ? projects : projects.filter(p => p.status === f)).length})
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading && <div className="flex justify-center py-12"><Spinner size="md" /></div>}
        {!loading && filtered.length === 0 && (
          <div className="py-12">
            <EmptyState icon="📁" title="No projects yet" description="Create a project to link related emails together" />
          </div>
        )}
        {filtered.map(proj => (
          <div key={proj.id} onClick={() => openProject(proj)}
            className="px-4 py-3 border-b border-gray-50 hover:bg-gray-50 cursor-pointer group transition-colors">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center flex-shrink-0 text-accent text-sm font-bold">
                {proj.name[0]?.toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-gray-800 truncate">{proj.name}</p>
                  <button onClick={e => cycleStatus(proj, e)}
                    className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium flex-shrink-0 hover:opacity-80 transition-opacity ${STATUS_COLORS[proj.status] || STATUS_COLORS.active}`}
                    title="Click to cycle status">
                    {proj.status}
                  </button>
                </div>
                {proj.description && <p className="text-xs text-gray-400 truncate">{proj.description}</p>}
                <p className="text-xs text-gray-400">{proj.email_count} email{proj.email_count !== 1 ? 's' : ''}</p>
              </div>
              <button onClick={e => deleteProject(proj.id, e)}
                className="text-gray-200 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all p-1 flex-shrink-0 text-xs">✕</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
