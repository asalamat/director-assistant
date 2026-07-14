import { useState, useEffect, useRef } from 'react'
import { api } from '../api/client'
import type { EmailProvider, Account, IngestProgress, DbStats, AutopilotRule } from '../types'
import { ConfigPanel } from './ConfigPanel'
import { FolderPicker } from './FolderPicker'
import { WebhooksSettings } from './WebhooksSettings'
import { NotifySettings } from './NotifySettings'
import { TasksExportSettings } from './TasksExportSettings'
import { ReportScheduleSettings } from './ReportScheduleSettings'
import { BackupSettings } from './BackupSettings'
import { OvernightTriageSettings } from './OvernightTriageSettings'
import { EmailRulesPanel } from './EmailRulesPanel'
import { AddAccountForm } from './AddAccountForm'
import { VoiceDraftPanel } from './VoiceDraftPanel'

type Section = 'accounts' | 'documents' | 'app' | 'rules' | 'integrations' | 'data' | 'style' | 'autopilot'

const PROVIDER_COLORS: Record<EmailProvider, string> = {
  yahoo_imap:   'bg-purple-100 text-purple-700',
  gmail:        'bg-red-100 text-red-700',
  hotmail:      'bg-blue-100 text-blue-700',
  generic_imap: 'bg-gray-100 text-gray-700',
  office365:    'bg-teal-100 text-teal-700',
}
const PROVIDER_NAMES: Record<EmailProvider, string> = {
  yahoo_imap: 'Yahoo', gmail: 'Gmail', hotmail: 'Hotmail', generic_imap: 'IMAP', office365: 'Office 365',
}

interface Props {
  onConnected: () => void
  initialTab?: 'accounts' | 'config' | 'integrations'
}

const IconEnvelope = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
  </svg>
)

const IconFolder = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 0 1 4.5 9.75h15A2.25 2.25 0 0 1 21.75 12v.75m-8.69-6.44-2.12-2.12a1.5 1.5 0 0 0-1.061-.44H4.5A2.25 2.25 0 0 0 2.25 6v8.25A2.25 2.25 0 0 0 4.5 16.5h15a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-5.379a1.5 1.5 0 0 1-1.06-.44Z" />
  </svg>
)

const IconCog = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
  </svg>
)

const IconShield = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
  </svg>
)

const IconLink = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" />
  </svg>
)

const IconDatabase = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" />
  </svg>
)

const IconArrowLeft = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5 3 12m0 0 7.5-7.5M3 12h18" />
  </svg>
)

const IconAppBadge = () => (
  <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
  </svg>
)

const IconSlack = () => (
  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
    <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z"/>
  </svg>
)
const IconZap = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
  </svg>
)
const IconCheck = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" />
  </svg>
)
const IconMoon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.72 9.72 0 0 1 18 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 0 0 3 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 0 0 9.002-5.998z" />
  </svg>
)
const IconCalendar = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" />
  </svg>
)
const IconLinkedIn = () => (
  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
    <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
  </svg>
)
const IconInstagram = () => (
  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z"/>
  </svg>
)

type NavGroup = { label: string | null; items: { id: Section; icon: React.ReactNode; label: string }[] }

const NAV_GROUPS: NavGroup[] = [
  {
    label: null,
    items: [
      { id: 'accounts',  icon: <IconEnvelope />, label: 'Accounts' },
      { id: 'documents', icon: <IconFolder />,   label: 'Documents' },
      { id: 'app',       icon: <IconCog />,      label: 'App Settings' },
    ],
  },
  {
    label: 'Automation',
    items: [
      { id: 'rules',  icon: <IconShield />, label: 'Rules & Filters' },
      { id: 'style',  icon: <span>✍️</span>, label: 'Writing Style' },
      { id: 'autopilot', icon: <span>🤖</span>, label: 'Email Autopilot' },
    ],
  },
  {
    label: 'Connect',
    items: [
      { id: 'integrations', icon: <IconLink />, label: 'Integrations' },
    ],
  },
  {
    label: 'System',
    items: [
      { id: 'data', icon: <IconDatabase />, label: 'Data & Backup' },
    ],
  },
]

const INPUT_CLS = 'w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent transition-colors'
const BTN_PRIMARY = 'bg-accent text-white rounded-xl px-4 py-2 text-sm font-semibold hover:bg-blue-700 transition-colors disabled:opacity-50'
const BTN_SECONDARY = 'border border-gray-200 bg-white text-gray-700 rounded-xl px-4 py-2 text-sm font-semibold hover:bg-gray-50 transition-colors disabled:opacity-50'
const BTN_DESTRUCTIVE = 'border border-red-200 bg-white text-red-600 rounded-xl px-4 py-2 text-sm font-semibold hover:bg-red-50 transition-colors disabled:opacity-50'

function IntegrationCard({ title, icon, badge, children }: { title: string; icon: React.ReactNode; badge: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="px-5 py-3.5 bg-gray-50 border-b border-gray-100 flex items-center gap-3">
        <span className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${badge}`}>
          {icon}
        </span>
        <p className="text-sm font-semibold text-gray-800">{title}</p>
      </div>
      <div className="p-5">{children}</div>
    </div>
  )
}

export function Settings({ onConnected, initialTab }: Props) {
  const initSection: Section = initialTab === 'config' ? 'app' : initialTab === 'integrations' ? 'integrations' : 'accounts'
  const [section, setSection] = useState<Section>(initSection)
  const [accounts, setAccounts] = useState<Account[]>([])
  const [showAdd, setShowAdd] = useState(false)
  const [fromDate, setFromDate] = useState('')
  const [ingestingId, setIngestingId] = useState<number | 'all' | null>(null)
  const [progress, setProgress] = useState<IngestProgress | null>(null)
  const [docFolders, setDocFolders] = useState<string[]>([])
  const [docIngesting, setDocIngesting] = useState(false)
  const [docMsg, setDocMsg] = useState('')
  const [docCount, setDocCount] = useState<number | null>(null)
  const [showFolderPicker, setShowFolderPicker] = useState(false)
  const [emailReindexing, setEmailReindexing] = useState(false)
  const [emailReindexMsg, setEmailReindexMsg] = useState('')
  const [clearConfirm, setClearConfirm] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [clearMsg, setClearMsg] = useState('')
  const [clearFromDate, setClearFromDate] = useState('')
  const [updateStatus, setUpdateStatus] = useState<{ checking?: boolean; msg?: string; available?: boolean; latest?: string }>({})
  const [ragStats, setRagStats] = useState<{ count: number; collection_size_mb: number; last_indexed: string; embedding_model: string; status: string } | null>(null)
  const [dbStats, setDbStats] = useState<DbStats | null>(null)
  const [dbBusy, setDbBusy] = useState<'optimize' | 'retention' | 'save' | 'delete-before' | null>(null)
  const [dbMsg, setDbMsg] = useState('')
  const [retentionInput, setRetentionInput] = useState('0')
  const [deleteBeforeDate, setDeleteBeforeDate] = useState('')
  const [deleteBeforeCount, setDeleteBeforeCount] = useState<number | null>(null)
  const [deleteBeforeConfirm, setDeleteBeforeConfirm] = useState(false)

  const loadAccounts = async () => {
    try { setAccounts(await api.getAccounts()) } catch { setAccounts([]) }
  }

  useEffect(() => {
    loadAccounts()
    api.getDocumentFolders().then(r => setDocFolders(r.folders || [])).catch(() => {})
    api.listDocuments().then(r => setDocCount(r.total)).catch(() => {})
  }, [])

  useEffect(() => {
    if (section === 'data') {
      api.getRagStats().then(setRagStats).catch(() => {})
      api.getDbStats().then(s => { setDbStats(s); setRetentionInput(String(s.retention_days)) }).catch(() => {})
    }
  }, [section])

  const handleIngest = async (id: number | 'all') => {
    setIngestingId(id)
    setProgress({ total: 0, processed: 0, status: 'running', message: 'Starting…' })
    try {
      if (id === 'all') await api.ingestAll(fromDate || undefined)
      else await api.ingestAccount(id, fromDate || undefined)
      const es = api.subscribeAccountsIngestProgress(p => {
        setProgress(p)
        if (p.status === 'completed' || p.status === 'error') {
          es.close(); setIngestingId(null)
          if (p.status === 'completed') onConnected()
        }
      })
    } catch { setIngestingId(null) }
  }

  const handleRemove = async (id: number) => { await api.removeAccount(id); await loadAccounts() }

  const handleConsolidate = async () => {
    try { const r = await api.consolidateAccounts(); await loadAccounts(); if (r.accounts_removed > 0) onConnected(); alert(r.message) } catch { }
  }

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl border border-gray-200 w-full max-w-4xl flex overflow-hidden" style={{ maxHeight: '92vh' }}>

        {/* Sidebar */}
        <div className="w-56 flex-shrink-0 bg-gray-100 border-r border-gray-200 flex flex-col">
          <div className="px-5 pt-6 pb-4 border-b border-gray-200">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-accent flex items-center justify-center flex-shrink-0">
                <IconAppBadge />
              </div>
              <div>
                <p className="text-sm font-bold text-gray-900 leading-tight">Director Assistant</p>
                <p className="text-[11px] text-gray-400">Settings</p>
              </div>
            </div>
          </div>

          <nav className="flex-1 px-3 py-3 overflow-y-auto">
            {NAV_GROUPS.map((group, gi) => (
              <div key={gi}>
                {group.label && (
                  <p className="text-[10px] font-bold text-gray-500 uppercase tracking-widest px-3 mt-4 mb-1">{group.label}</p>
                )}
                {group.items.map(n => (
                  <button key={n.id} onClick={() => setSection(n.id)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm transition-colors text-left ${
                      section === n.id
                        ? 'bg-accent text-white font-semibold shadow-sm'
                        : 'text-gray-700 hover:bg-gray-200 hover:text-gray-900 font-medium'
                    }`}>
                    {n.icon}
                    {n.label}
                  </button>
                ))}
              </div>
            ))}
          </nav>

          <div className="px-4 py-4 border-t border-gray-200 mt-auto">
            <button onClick={onConnected}
              className="w-full flex items-center gap-2 text-sm text-gray-600 hover:text-accent px-3 py-2 rounded-xl hover:bg-white transition-colors font-medium">
              <IconArrowLeft />
              Back to app
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-8 min-w-0 min-h-0 bg-white">

          {/* Accounts */}
          {section === 'accounts' && (
            <div className="space-y-6">
              <SectionHeader title="Email Accounts" desc="Connected email providers that are polled for new messages." icon={<IconEnvelope />} />

              {accounts.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-bold text-gray-400 uppercase tracking-wide">Connected</p>
                    {accounts.length > 1 && accounts.map(a => a.username).some((u, i, arr) => arr.indexOf(u) !== i) && (
                      <button onClick={handleConsolidate}
                        className="text-xs text-amber-600 border border-amber-200 bg-amber-50 hover:bg-amber-100 rounded-lg px-2.5 py-1 font-semibold transition-colors">
                        Merge duplicates
                      </button>
                    )}
                  </div>

                  {accounts.map(acc => (
                    <div key={acc.id} className="rounded-2xl border border-gray-100 shadow-sm bg-white p-4 flex items-center gap-4">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-sm flex-shrink-0 ${PROVIDER_COLORS[acc.provider]}`}>
                        {PROVIDER_NAMES[acc.provider].slice(0, 1)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-800 truncate">{acc.username}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${PROVIDER_COLORS[acc.provider]}`}>{PROVIDER_NAMES[acc.provider]}</span>
                          {acc.last_ingested && <span className="text-[11px] text-gray-400">Synced {new Date(acc.last_ingested).toLocaleDateString()}</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <button onClick={() => handleIngest(acc.id)} disabled={ingestingId !== null}
                          className={BTN_PRIMARY}>
                          {ingestingId === acc.id ? 'Importing…' : 'Import'}
                        </button>
                        <button onClick={() => handleRemove(acc.id)}
                          className={BTN_DESTRUCTIVE}>
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}

                  <div className="flex items-center gap-3 pt-1">
                    <label className="text-xs font-bold text-gray-500 uppercase tracking-wide whitespace-nowrap">From date</label>
                    <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
                      className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent transition-colors" />
                    {fromDate && (
                      <button onClick={() => setFromDate('')}
                        className="text-xs text-gray-400 hover:text-gray-600 font-medium">Clear</button>
                    )}
                  </div>

                  <button onClick={() => handleIngest('all')} disabled={ingestingId !== null}
                    className={`w-full ${BTN_PRIMARY} py-2.5`}>
                    {ingestingId === 'all' ? 'Importing all…' : 'Import all emails'}
                  </button>

                  {progress && (
                    <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4 space-y-2">
                      <div className="flex justify-between text-xs text-gray-500">
                        <span className="truncate pr-2 font-medium">{progress.message}</span>
                        {progress.total > 0 && <span className="flex-shrink-0 font-mono">{progress.processed}/{progress.total}</span>}
                      </div>
                      {progress.total > 0 && (
                        <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                          <div className="h-full bg-accent rounded-full transition-all duration-300"
                            style={{ width: `${Math.round(progress.processed / progress.total * 100)}%` }} />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {!showAdd ? (
                <button onClick={() => setShowAdd(true)}
                  className="w-full text-sm text-gray-400 hover:text-accent border border-dashed border-gray-200 hover:border-accent rounded-2xl py-3.5 transition-colors font-medium">
                  + Add email account
                </button>
              ) : (
                <div className="rounded-2xl border border-gray-100 shadow-sm p-6">
                  <p className="text-sm font-bold text-gray-800 mb-5">Add account</p>
                  <AddAccountForm onConnected={onConnected} onCancel={() => setShowAdd(false)} onAccountAdded={loadAccounts} />
                </div>
              )}
            </div>
          )}

          {/* Documents */}
          {section === 'documents' && (
            <div className="space-y-5">
              <SectionHeader title="Documents" desc="Index local folders — PDFs, Word, Excel, and text files are searchable alongside emails." icon={<IconFolder />} />
              {docCount !== null && docCount > 0 && (
                <p className="text-xs font-medium text-gray-400">{docCount} file{docCount !== 1 ? 's' : ''} currently indexed</p>
              )}

              {docFolders.length > 0 && (
                <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                  {docFolders.map((f, i) => (
                    <div key={i} className="rounded-xl border border-gray-100 bg-gray-50 px-3 py-2.5 flex items-center gap-3">
                      <IconFolder />
                      <span className="flex-1 text-xs text-gray-700 truncate font-mono">{f}</span>
                      <button onClick={async () => {
                          const next = docFolders.filter((_, j) => j !== i)
                          await api.setDocumentFolders(next).catch(() => {})
                          setDocFolders(next)
                        }}
                        className="text-xs text-gray-400 hover:text-red-500 font-semibold transition-colors">Remove</button>
                    </div>
                  ))}
                </div>
              )}

              <button onClick={() => setShowFolderPicker(true)}
                className="w-full flex items-center justify-center gap-2 border border-dashed border-amber-300 text-amber-600 hover:bg-amber-50 rounded-2xl py-3.5 text-sm font-semibold transition-colors">
                Browse &amp; add folder…
              </button>

              <div className="flex gap-3">
                <button onClick={async () => {
                    setDocIngesting(true); setDocMsg('')
                    try {
                      await api.ingestDocuments()
                      let w = 0
                      const id = setInterval(async () => {
                        w += 1500; const s = await api.getDocumentIngestStatus().catch(() => null)
                        if (!s || s.status !== 'running') {
                          clearInterval(id); setDocMsg(s?.message || 'Done')
                          api.listDocuments().then(r => setDocCount(r.total)).catch(() => {})
                          setDocIngesting(false)
                        } else setDocMsg(s.message)
                        if (w > 120000) { clearInterval(id); setDocIngesting(false) }
                      }, 1500)
                    } catch (e: unknown) { setDocMsg(e instanceof Error ? e.message : 'Failed'); setDocIngesting(false) }
                  }} disabled={docIngesting || docFolders.length === 0}
                  className="flex-1 bg-amber-500 text-white text-sm font-semibold py-2.5 rounded-xl hover:bg-amber-600 disabled:opacity-50 transition-colors">
                  {docIngesting ? 'Indexing…' : 'Index Documents'}
                </button>
                <button onClick={async () => {
                    setEmailReindexing(true); setEmailReindexMsg('')
                    try {
                      await api.reindexEmails()
                      let w = 0
                      const id = setInterval(async () => {
                        w += 2000; const s = await api.getReindexEmailsStatus().catch(() => null)
                        if (!s || s.status !== 'running') {
                          clearInterval(id)
                          setEmailReindexMsg(s?.status === 'done' ? `Done — ${s.indexed} re-indexed` : s?.error || 'Done')
                          setEmailReindexing(false)
                        }
                        if (w > 300000) { clearInterval(id); setEmailReindexing(false) }
                      }, 2000)
                    } catch (e: unknown) { setEmailReindexMsg(e instanceof Error ? e.message : 'Failed'); setEmailReindexing(false) }
                  }} disabled={emailReindexing}
                  className={`flex-1 ${BTN_SECONDARY} py-2.5`}>
                  {emailReindexing ? 'Rebuilding…' : 'Rebuild Email Index'}
                </button>
              </div>
              {(docMsg || emailReindexMsg) && (
                <p className="text-xs text-gray-500 font-medium">{docMsg || emailReindexMsg}</p>
              )}
            </div>
          )}

          {/* App Settings */}
          {section === 'app' && (
            <div className="space-y-6">
              <SectionHeader title="App Settings" desc="AI providers, polling, display preferences, and smart triage rules." icon={<IconCog />} />
              <ConfigPanel />
              <VoiceDraftPanel />
              <TriageRulesPanel />
            </div>
          )}

          {/* Rules & Filters */}
          {section === 'rules' && (
            <div className="space-y-6">
              <SectionHeader title="Rules & Filters" desc="Automatically label, archive, or delete emails based on sender, subject, or content." icon={<IconShield />} />
              <EmailRulesPanel />
            </div>
          )}

          {/* Writing Style */}
          {section === 'style' && <WritingStyleSection />}
          {section === 'autopilot' && <AutopilotSection />}

          {/* Integrations */}
          {section === 'integrations' && (
            <div className="space-y-8">
              <SectionHeader title="Integrations" desc="Connect external services for notifications, task sync, and social media." icon={<IconLink />} />

              <div>
                <p className="text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-3">Communication</p>
                <div className="space-y-4">
                  <IntegrationCard title="Slack & Teams Notifications" icon={<IconSlack />} badge="bg-purple-100 text-purple-600"><NotifySettings /></IntegrationCard>
                  <IntegrationCard title="Webhooks & Zapier" icon={<IconZap />} badge="bg-orange-100 text-orange-600"><WebhooksSettings /></IntegrationCard>
                </div>
              </div>

              <div>
                <p className="text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-3">Automation & Tasks</p>
                <div className="space-y-4">
                  <IntegrationCard title="Task Export (Todoist / Jira)" icon={<IconCheck />} badge="bg-green-100 text-green-600"><TasksExportSettings /></IntegrationCard>
                  <IntegrationCard title="Morning Brief Email" icon={<span className="text-base">☀️</span>} badge="bg-yellow-100 text-yellow-600"><MorningBriefEmailSettings /></IntegrationCard>
                  <IntegrationCard title="Overnight Triage Agent" icon={<IconMoon />} badge="bg-indigo-100 text-indigo-600"><OvernightTriageSettings /></IntegrationCard>
                  <IntegrationCard title="Scheduled Report Email" icon={<IconCalendar />} badge="bg-sky-100 text-sky-600"><ReportScheduleSettings /></IntegrationCard>
                </div>
              </div>

              <div>
                <p className="text-[11px] font-bold text-gray-500 uppercase tracking-widest mb-3">Social Media</p>
                <div className="space-y-4">
                  <IntegrationCard title="LinkedIn" icon={<IconLinkedIn />} badge="bg-blue-100 text-blue-700"><LinkedInSettingsPanel /></IntegrationCard>
                  <IntegrationCard title="Instagram" icon={<IconInstagram />} badge="bg-pink-100 text-pink-600"><InstagramSettingsPanel /></IntegrationCard>
                </div>
              </div>
            </div>
          )}

          {/* Data & Backup */}
          {section === 'data' && (
            <div className="space-y-6">
              <SectionHeader title="Data & Backup" desc="Backup your database, check for updates, and manage the data lifecycle." icon={<IconDatabase />} />

              <div>
                <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">RAG Index</p>
                {ragStats ? (
                  <div className="rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                    <div className="grid grid-cols-2 divide-x divide-y divide-gray-100">
                      {[
                        { label: 'Status', value: (
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                            ragStats.status === 'ready'    ? 'bg-green-100 text-green-700' :
                            ragStats.status === 'indexing' ? 'bg-amber-100 text-amber-700' :
                            ragStats.status === 'empty'    ? 'bg-gray-100 text-gray-500' :
                                                            'bg-red-100 text-red-600'
                          }`}>{ragStats.status}</span>
                        )},
                        { label: 'Documents indexed', value: <span className="text-sm font-semibold text-gray-800">{ragStats.count.toLocaleString()}</span> },
                        { label: 'Index size',        value: <span className="text-sm font-semibold text-gray-800">~{ragStats.collection_size_mb} MB</span> },
                        { label: 'Last indexed',      value: <span className="text-sm font-semibold text-gray-800">{ragStats.last_indexed || 'N/A'}</span> },
                        { label: 'Model',             value: <span className="text-xs font-mono text-gray-600">{ragStats.embedding_model}</span> },
                      ].map(({ label, value }) => (
                        <div key={label} className="px-5 py-3.5 flex items-center justify-between gap-4">
                          <span className="text-xs text-gray-500">{label}</span>
                          {value}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-gray-100 p-6 text-center text-xs text-gray-400">Loading index stats…</div>
                )}
              </div>

              <div>
                <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Database Health</p>
                <DbHealthTile
                  stats={dbStats}
                  busy={dbBusy}
                  msg={dbMsg}
                  retentionInput={retentionInput}
                  onRetentionInput={setRetentionInput}
                  deleteBeforeDate={deleteBeforeDate}
                  deleteBeforeCount={deleteBeforeCount}
                  deleteBeforeConfirm={deleteBeforeConfirm}
                  onDeleteBeforeDate={async (d) => {
                    setDeleteBeforeDate(d); setDeleteBeforeCount(null); setDeleteBeforeConfirm(false)
                    if (!d) return
                    try { const r = await api.countEmailsBefore(d); setDeleteBeforeCount(r.count) } catch { setDeleteBeforeCount(null) }
                  }}
                  onDeleteBeforeConfirmToggle={() => setDeleteBeforeConfirm(v => !v)}
                  onDeleteBefore={async () => {
                    if (!deleteBeforeDate || !deleteBeforeConfirm) return
                    setDbBusy('delete-before'); setDbMsg('')
                    try {
                      const r = await api.deleteEmailsBefore(deleteBeforeDate)
                      setDbMsg(`Deleted ${r.deleted} email(s) before ${deleteBeforeDate}`)
                      setDeleteBeforeCount(null); setDeleteBeforeConfirm(false); setDeleteBeforeDate('')
                      const s = await api.getDbStats(); setDbStats(s)
                    } catch (e) { setDbMsg(e instanceof Error ? e.message : 'Delete failed') }
                    finally { setDbBusy(null) }
                  }}
                  onOptimize={async () => {
                    setDbBusy('optimize'); setDbMsg('')
                    try {
                      const r = await api.optimizeDb()
                      setDbMsg(`Optimized in ${r.duration_ms} ms — now ${r.db_size_mb} MB`)
                      const s = await api.getDbStats(); setDbStats(s)
                    } catch (e) { setDbMsg(e instanceof Error ? e.message : 'Optimize failed') }
                    finally { setDbBusy(null) }
                  }}
                  onSaveRetention={async () => {
                    setDbBusy('save'); setDbMsg('')
                    try {
                      await api.updateConfig({ db_retention_days: parseInt(retentionInput || '0', 10) })
                      const s = await api.getDbStats(); setDbStats(s)
                      setDbMsg('Retention setting saved')
                    } catch (e) { setDbMsg(e instanceof Error ? e.message : 'Save failed') }
                    finally { setDbBusy(null) }
                  }}
                  onApplyRetention={async () => {
                    setDbBusy('retention'); setDbMsg('')
                    try {
                      const r = await api.applyRetention()
                      setDbMsg(r.status === 'disabled' ? 'Retention is disabled (0 days)' : `Pruned ${r.deleted} old email(s)`)
                      const s = await api.getDbStats(); setDbStats(s)
                    } catch (e) { setDbMsg(e instanceof Error ? e.message : 'Prune failed') }
                    finally { setDbBusy(null) }
                  }}
                />
              </div>

              <div>
                <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Backup</p>
                <BackupSettings />
              </div>

              <div>
                <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Updates</p>
                <button onClick={async () => {
                    setUpdateStatus({ checking: true, msg: 'Checking…' })
                    try {
                      const r = await api.checkUpdate()
                      if (r.error) setUpdateStatus({ msg: `Check failed: ${r.error}` })
                      else if (r.update_available && r.latest) setUpdateStatus({ available: true, latest: r.latest, msg: `Update available: v${r.latest}` })
                      else setUpdateStatus({ msg: `Up to date (v${r.current})` })
                    } catch { setUpdateStatus({ msg: 'Check failed — no network?' }) }
                  }} disabled={updateStatus.checking}
                  className={`w-full ${BTN_SECONDARY} py-2.5`}>
                  {updateStatus.checking ? 'Checking…' : 'Check for Updates'}
                </button>
                {updateStatus.msg && (
                  <p className={`text-xs mt-2 font-medium ${updateStatus.available ? 'text-blue-600' : 'text-gray-500'}`}>{updateStatus.msg}</p>
                )}
                {updateStatus.available && (
                  <button onClick={async () => {
                      setUpdateStatus(s => ({ ...s, msg: 'Installing…', checking: true }))
                      try { const r = await api.applyUpdate(); setUpdateStatus({ msg: r.message }); setTimeout(() => window.location.reload(), 30000) }
                      catch { setUpdateStatus({ msg: 'Update failed.' }) }
                    }} className={`w-full mt-2 ${BTN_PRIMARY} py-2.5`}>
                    Install v{updateStatus.latest}
                  </button>
                )}
              </div>

              <div className="rounded-2xl border border-red-100 bg-red-50/40 p-5">
                <p className="text-xs font-bold text-red-400 uppercase tracking-widest mb-3">Danger Zone</p>
                {!clearConfirm ? (
                  <button onClick={() => { setClearConfirm(true); setClearFromDate('') }} disabled={clearing}
                    className={`w-full ${BTN_DESTRUCTIVE} py-2.5`}>
                    Clear Database &amp; Re-ingest
                  </button>
                ) : (
                  <div className="space-y-4">
                    <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3 leading-relaxed">
                      This deletes <strong>all cached emails and vectors</strong> then re-imports. Cannot be undone.
                    </p>
                    <div>
                      <label className="text-xs font-bold text-gray-500 uppercase tracking-wide block mb-1.5">Import from date (blank = all)</label>
                      <input type="date" value={clearFromDate} onChange={e => setClearFromDate(e.target.value)}
                        className={INPUT_CLS} />
                    </div>
                    <div className="flex gap-2">
                      <button onClick={async () => {
                          setClearing(true); setClearMsg(''); setClearConfirm(false)
                          try {
                            const res = await api.clearAndReingest(clearFromDate || undefined)
                            setClearMsg(`Cleared ${res.cleared} emails. Re-importing from ${res.accounts} account${res.accounts !== 1 ? 's' : ''}…`)
                            const es = api.subscribeAccountsIngestProgress(p => {
                              if (p.status === 'completed' || p.status === 'error') {
                                es.close(); setClearing(false); setClearMsg(p.message); onConnected()
                              }
                            })
                          } catch (e: unknown) { setClearMsg(e instanceof Error ? e.message : 'Failed'); setClearing(false) }
                        }} disabled={clearing}
                        className="flex-1 bg-red-500 text-white text-sm font-semibold py-2.5 rounded-xl hover:bg-red-600 disabled:opacity-50 transition-colors">
                        {clearing ? 'Clearing…' : 'Yes, clear everything'}
                      </button>
                      <button onClick={() => setClearConfirm(false)}
                        className={BTN_SECONDARY}>Cancel</button>
                    </div>
                  </div>
                )}
                {clearMsg && <p className="text-xs mt-3 text-gray-600 font-medium">{clearMsg}</p>}
              </div>
            </div>
          )}

        </div>
      </div>

      {showFolderPicker && (
        <FolderPicker
          onSelect={async path => {
            if (docFolders.includes(path)) return
            const next = [...docFolders, path]
            await api.setDocumentFolders(next).catch(() => {})
            setDocFolders(next)
          }}
          onClose={() => setShowFolderPicker(false)}
        />
      )}
    </div>
  )
}

function SectionHeader({ title, desc, icon }: { title: string; desc: string; icon?: React.ReactNode }) {
  return (
    <div className="mb-6">
      <div className="flex items-center gap-2.5 mb-1">
        {icon && <span className="text-accent">{icon}</span>}
        <h2 className="text-xl font-bold text-gray-900">{title}</h2>
      </div>
      <p className="text-sm text-gray-500">{desc}</p>
    </div>
  )
}

const IMAGE_MODELS = [
  { value: 'dall-e-3',    label: 'DALL-E 3 (default)' },
  { value: 'gpt-image-1', label: 'GPT Image 1' },
  { value: 'gpt-5.5',     label: 'GPT-5.5' },
  { value: 'dall-e-2',    label: 'DALL-E 2 (fallback)' },
]

function LinkedInSettingsPanel() {
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [accessToken, setAccessToken] = useState('')
  const [userId, setUserId] = useState('')
  const [customPromptsRaw, setCustomPromptsRaw] = useState('')
  const [imageModel, setImageModel] = useState('dall-e-3')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [verifyResult, setVerifyResult] = useState<Record<string, { ok: boolean; message: string }> | null>(null)

  useEffect(() => {
    api.getLinkedInSettings()
      .then((r: any) => {
        setClientId(r.client_id || '')
        setClientSecret('')
        setAccessToken('')
        setUserId(r.user_id || '')
        setCustomPromptsRaw((r.custom_prompts || []).join('\n'))
        setImageModel(r.image_model || 'dall-e-3')
      })
      .catch(() => {})
  }, [])

  const save = async () => {
    setSaving(true)
    setError('')
    try {
      const prompts = customPromptsRaw.split('\n').map(s => s.trim()).filter(Boolean)
      await api.saveLinkedInSettings({
        client_id: clientId,
        ...(clientSecret ? { client_secret: clientSecret } : {}),
        ...(accessToken ? { access_token: accessToken } : {}),
        user_id: userId, custom_prompts: prompts,
        image_model: imageModel,
      } as any)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const verify = async () => {
    setVerifying(true); setVerifyResult(null); setError('')
    try {
      const r = await (api as any).verifyLinkedIn()
      setVerifyResult(r)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Verification failed')
    } finally {
      setVerifying(false)
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-400 leading-relaxed">
        To connect LinkedIn, create an app at <span className="font-mono text-gray-600">developer.linkedin.com</span>, add the <em>Share on LinkedIn</em> and <em>OpenID Connect</em> products, then generate an access token.
      </p>

      <div className="space-y-4">
        <div>
          <label className="text-xs font-bold text-gray-500 uppercase tracking-wide block mb-1.5">Client ID</label>
          <input type="text" value={clientId} onChange={e => setClientId(e.target.value)}
            placeholder="86xyz..."
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent transition-colors" />
        </div>

        <div>
          <label className="text-xs font-bold text-gray-500 uppercase tracking-wide block mb-1.5">Client Secret</label>
          <input type="password" value={clientSecret} onChange={e => setClientSecret(e.target.value)}
            placeholder="••••••••"
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent transition-colors" />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs font-bold text-gray-500 uppercase tracking-wide">Access Token</label>
            <span className="text-[10px] text-gray-400 bg-gray-50 border border-gray-200 rounded-lg px-2 py-0.5 font-medium">
              LinkedIn Developer portal → OAuth 2.0 tools
            </span>
          </div>
          <input type="password" value={accessToken} onChange={e => setAccessToken(e.target.value)}
            placeholder="••••••••"
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent transition-colors" />
        </div>

        <div>
          <label className="text-xs font-bold text-gray-500 uppercase tracking-wide block mb-1.5">Your LinkedIn User ID</label>
          <input type="text" value={userId} onChange={e => setUserId(e.target.value)}
            placeholder="urn:li:person:XXXXXXXX"
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent transition-colors font-mono" />
        </div>

        <div>
          <label className="text-xs font-bold text-gray-500 uppercase tracking-wide block mb-1.5">Custom Image Prompts</label>
          <p className="text-xs text-gray-400 mb-2">One prompt per line — these appear as quick-select options in the image generation step.</p>
          <textarea value={customPromptsRaw} onChange={e => setCustomPromptsRaw(e.target.value)}
            rows={4}
            placeholder={"Professional headshot on white background\nModern tech office with team"}
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent transition-colors resize-none" />
        </div>

        <div>
          <label className="text-xs font-bold text-gray-500 uppercase tracking-wide block mb-1.5">Image Generation Model</label>
          <p className="text-xs text-gray-400 mb-2">Which OpenAI model to use for generating post images. If the selected model isn't available on your key, the app tries the next one automatically.</p>
          <select value={imageModel} onChange={e => setImageModel(e.target.value)}
            className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent transition-colors bg-white">
            {IMAGE_MODELS.map(m => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        </div>
      </div>

      {error && <p className="text-xs text-red-500 font-medium">{error}</p>}

      <div className="flex gap-2 pt-1">
        <button onClick={save} disabled={saving}
          className={`flex-1 ${BTN_PRIMARY} py-2.5`}>
          {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save LinkedIn Settings'}
        </button>
        <button onClick={verify} disabled={verifying}
          className={`${BTN_SECONDARY} py-2.5`}>
          {verifying ? 'Verifying…' : 'Verify'}
        </button>
      </div>

      {verifyResult && (
        <div className="rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3">
          <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Connectivity Check</p>
          {[
            { key: 'linkedin',    label: 'LinkedIn API' },
            { key: 'openai',      label: 'OpenAI (DALL-E)' },
            { key: 'ai_provider', label: 'AI Provider (Claude)' },
          ].map(({ key, label }) => {
            const r = verifyResult[key]
            if (!r) return null
            return (
              <div key={key} className="flex items-center gap-3 text-sm">
                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0 ${r.ok ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                  {r.ok ? '✓' : '✕'}
                </span>
                <span className="font-semibold text-gray-700 w-36 flex-shrink-0">{label}</span>
                <span className={`text-xs ${r.ok ? 'text-green-600' : 'text-red-500'}`}>{r.message}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function InstagramSettingsPanel() {
  const [appId, setAppId] = useState('')
  const [appSecret, setAppSecret] = useState('')
  const [igLoginAppId, setIgLoginAppId] = useState('')
  const [igLoginAppSecret, setIgLoginAppSecret] = useState('')
  const [igUserId, setIgUserId] = useState('')
  const [openaiKey, setOpenaiKey] = useState('')
  const [openaiKeyPreview, setOpenaiKeyPreview] = useState('')
  const [imageModel, setImageModel] = useState('dall-e-3')
  const [ftpHost, setFtpHost] = useState('')
  const [ftpUser, setFtpUser] = useState('')
  const [ftpPass, setFtpPass] = useState('')
  const [ftpPath, setFtpPath] = useState('')
  const [ftpPublicUrl, setFtpPublicUrl] = useState('')
  const [manualToken, setManualToken] = useState('')
  const [connectedUsername, setConnectedUsername] = useState('')
  const [hasToken, setHasToken] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [ftpVerifying, setFtpVerifying] = useState(false)
  const [ftpVerifyMsg, setFtpVerifyMsg] = useState<{ok: boolean; message: string} | null>(null)
  const [imgKeyTesting, setImgKeyTesting] = useState(false)
  const [imgKeyResult, setImgKeyResult] = useState<{ok: boolean; working_models?: string[]; results?: any[]} | null>(null)
  const [detecting, setDetecting] = useState(false)
  const [detectMsg, setDetectMsg] = useState<{ok: boolean; message: string} | null>(null)
  const [oauthStatus, setOauthStatus] = useState<'idle' | 'waiting' | 'done' | 'error'>('idle')
  const [oauthMsg, setOauthMsg] = useState('')
  const [oauthDirectStatus, setOauthDirectStatus] = useState<'idle' | 'waiting' | 'done' | 'error'>('idle')
  const [oauthDirectMsg, setOauthDirectMsg] = useState('')
  const popupRef = useRef<Window | null>(null)
  const popupDirectRef = useRef<Window | null>(null)

  useEffect(() => {
    api.getInstagramSettings()
      .then((r: any) => {
        setAppId(r.app_id || '')
        setAppSecret('')
        setIgLoginAppId(r.ig_login_app_id || '')
        setIgLoginAppSecret('')
        setIgUserId(r.ig_user_id || '')
        setImageModel(r.image_model || 'dall-e-3')
        setOpenaiKeyPreview(r.openai_key_preview || '')
        setFtpHost(r.ftp_host || '')
        setFtpUser(r.ftp_user || '')
        setFtpPass('')
        setFtpPath(r.ftp_path || '')
        setFtpPublicUrl(r.ftp_public_url || '')
        setConnectedUsername(r.username || '')
        setHasToken(!!(r.access_token_set))
      })
      .catch(() => {})
  }, [])

  const detectAccount = async () => {
    setDetecting(true); setDetectMsg(null)
    try {
      const r = await fetch('/api/instagram/detect-account', { method: 'POST' }).then(x => x.json())
      setDetectMsg({ ok: r.ok, message: r.message })
      if (r.ok) {
        if (r.ig_user_id) setIgUserId(r.ig_user_id)
        if (r.username) setConnectedUsername(r.username)
      }
    } catch { setDetectMsg({ ok: false, message: 'Request failed' }) }
    finally { setDetecting(false) }
  }

  const testImageKey = async () => {
    setImgKeyTesting(true); setImgKeyResult(null)
    try {
      const body = openaiKey ? JSON.stringify({ key: openaiKey }) : '{}'
      const r = await fetch('/api/instagram/test-image-key', { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body }).then(x => x.json())
      setImgKeyResult(r)
    } catch { setImgKeyResult({ ok: false }) }
    finally { setImgKeyTesting(false) }
  }

  const verifyFtp = async () => {
    setFtpVerifying(true); setFtpVerifyMsg(null)
    try {
      const r = await fetch('/api/instagram/verify-ftp', { method: 'POST' }).then(x => x.json())
      setFtpVerifyMsg({ ok: r.ok, message: r.message })
    } catch { setFtpVerifyMsg({ ok: false, message: 'Request failed' }) }
    finally { setFtpVerifying(false) }
  }

  const save = async () => {
    setSaving(true); setError('')
    try {
      await api.saveInstagramSettings({
        app_id: appId,
        ...(appSecret ? { app_secret: appSecret } : {}),
        ig_login_app_id: igLoginAppId,
        ...(igLoginAppSecret ? { ig_login_app_secret: igLoginAppSecret } : {}),
        ig_user_id: igUserId, image_model: imageModel,
        ftp_host: ftpHost, ftp_user: ftpUser,
        ...(ftpPass ? { ftp_pass: ftpPass } : {}),
        ftp_path: ftpPath, ftp_public_url: ftpPublicUrl,
        ...(openaiKey ? { openai_key: openaiKey } : {}),
        ...(manualToken ? { access_token: manualToken } : {}),
      } as any)
      if (openaiKey) { setOpenaiKeyPreview(openaiKey.slice(0, 8) + '…'); setOpenaiKey('') }
      setSaved(true); setTimeout(() => setSaved(false), 2000)
    } catch (e: unknown) { setError(e instanceof Error ? e.message : 'Save failed') }
    finally { setSaving(false) }
  }

  const connect = async () => {
    if (!appId || !appSecret) { setError('Save your App ID and App Secret first'); return }
    setOauthStatus('waiting'); setOauthMsg(''); setError('')
    try {
      const { url } = await fetch('/api/oauth/instagram/auth-url').then(r => r.json())
      const popup = window.open(url, 'igauth', 'width=600,height=700,left=200,top=80')
      popupRef.current = popup
      if (!popup) { setOauthStatus('error'); setOauthMsg('Popup blocked — allow popups and try again'); return }
      const onMsg = (e: MessageEvent) => {
        if (e.data?.type === 'ig-oauth-complete') {
          window.removeEventListener('message', onMsg)
          setOauthStatus('done')
          setHasToken(true)
          if (e.data.username) {
            setConnectedUsername(e.data.username)
            setOauthMsg(`Connected as @${e.data.username}`)
          } else {
            setOauthMsg('Token saved — enter your Instagram Business Account ID below to complete setup')
          }
          api.getInstagramSettings().then((r: any) => { setIgUserId(r.ig_user_id || ''); setConnectedUsername(r.username || '') }).catch(() => {})
        } else if (e.data?.type === 'ig-oauth-error') {
          window.removeEventListener('message', onMsg)
          setOauthStatus('error'); setOauthMsg(e.data.message || 'Connection failed')
        }
      }
      window.addEventListener('message', onMsg)
      const t = setInterval(() => {
        if (popupRef.current?.closed) {
          clearInterval(t); window.removeEventListener('message', onMsg)
          setOauthStatus(s => s === 'waiting' ? 'idle' : s)
        }
      }, 800)
    } catch (e: unknown) { setOauthStatus('error'); setOauthMsg(e instanceof Error ? e.message : 'Failed') }
  }

  const connectDirect = async () => {
    if (!igLoginAppId || !igLoginAppSecret) { setError('Save your Instagram App ID and App Secret first'); return }
    setOauthDirectStatus('waiting'); setOauthDirectMsg(''); setError('')
    try {
      const { url } = await fetch('/api/oauth/instagram-login/auth-url').then(r => r.json())
      const popup = window.open(url, 'igdirectauth', 'width=600,height=700,left=200,top=80')
      popupDirectRef.current = popup
      if (!popup) { setOauthDirectStatus('error'); setOauthDirectMsg('Popup blocked — allow popups and try again'); return }
      const onMsg = (e: MessageEvent) => {
        if (e.data?.type === 'ig-oauth-complete') {
          window.removeEventListener('message', onMsg)
          setOauthDirectStatus('done')
          setHasToken(true)
          if (e.data.username) {
            setConnectedUsername(e.data.username)
            setOauthDirectMsg(`Connected as @${e.data.username}`)
          } else {
            setOauthDirectMsg('Token saved')
          }
          api.getInstagramSettings().then((r: any) => { setIgUserId(r.ig_user_id || ''); setConnectedUsername(r.username || '') }).catch(() => {})
        } else if (e.data?.type === 'ig-oauth-error') {
          window.removeEventListener('message', onMsg)
          setOauthDirectStatus('error'); setOauthDirectMsg(e.data.message || 'Connection failed')
        }
      }
      window.addEventListener('message', onMsg)
      const t = setInterval(() => {
        if (popupDirectRef.current?.closed) {
          clearInterval(t); window.removeEventListener('message', onMsg)
          setOauthDirectStatus(s => s === 'waiting' ? 'idle' : s)
        }
      }, 800)
    } catch (e: unknown) { setOauthDirectStatus('error'); setOauthDirectMsg(e instanceof Error ? e.message : 'Failed') }
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-400 leading-relaxed">
        <strong>Recommended:</strong> Use <strong>Instagram Login</strong> below — no Facebook Page linking required.
        Create an app at <span className="font-mono text-gray-600">developers.facebook.com</span>, add{' '}
        <strong>Instagram</strong> product with <em>Business Login</em>, and add{' '}
        <span className="font-mono text-[11px]">http://localhost:8000/api/oauth/instagram-login/callback</span> as a redirect URI.
      </p>

      {connectedUsername && (
        <div className="flex items-center gap-2 px-4 py-3 bg-green-50 border border-green-200 rounded-xl">
          <span className="text-green-600 text-sm font-bold">✓</span>
          <span className="text-sm font-semibold text-green-700">Connected as @{connectedUsername}</span>
          <button onClick={() => { setConnectedUsername(''); api.saveInstagramSettings({ username: '' } as any).catch(() => {}) }}
            className="ml-auto text-xs text-gray-400 hover:text-gray-600 font-medium">Disconnect</button>
        </div>
      )}

      <div className="space-y-4">
        <div className="border border-pink-100 bg-pink-50/40 rounded-xl p-4 space-y-3">
          <p className="text-xs font-bold text-pink-700">Instagram Login <span className="font-normal text-pink-500">(Recommended — no Facebook Page required)</span></p>
          <div>
            <label className="text-xs font-bold text-gray-500 uppercase tracking-wide block mb-1.5">Instagram App ID</label>
            <input type="text" value={igLoginAppId} onChange={e => setIgLoginAppId(e.target.value)}
              placeholder="2524321461354080"
              className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-pink-400/30 focus:border-pink-400 transition-colors bg-white" />
          </div>
          <div>
            <label className="text-xs font-bold text-gray-500 uppercase tracking-wide block mb-1.5">Instagram App Secret</label>
            <input type="password" value={igLoginAppSecret} onChange={e => setIgLoginAppSecret(e.target.value)}
              placeholder="••••••••••••••••"
              className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-pink-400/30 focus:border-pink-400 transition-colors bg-white" />
          </div>
          <p className="text-[11px] text-gray-400">
            Callback URL to add in Meta Developer Portal:{' '}
            <span className="font-mono select-all">http://localhost:8000/api/oauth/instagram-login/callback</span>
          </p>
          {oauthDirectMsg && (
            <p className={`text-xs font-medium ${oauthDirectStatus === 'done' ? 'text-green-600' : oauthDirectStatus === 'error' ? 'text-red-500' : 'text-gray-500'}`}>
              {oauthDirectStatus === 'waiting' ? '⏳ ' : ''}{oauthDirectMsg}
            </p>
          )}
          <button onClick={connectDirect} disabled={oauthDirectStatus === 'waiting' || !igLoginAppId}
            className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-pink-500 to-purple-600 text-white text-sm font-semibold rounded-xl hover:opacity-90 disabled:opacity-50 transition">
            {oauthDirectStatus === 'waiting' ? 'Connecting…' : connectedUsername ? 'Reconnect Instagram' : 'Connect with Instagram'}
          </button>
        </div>

        <div>
          <label className="text-xs font-bold text-gray-500 uppercase tracking-wide block mb-1.5">
            Paste Access Token
            <span className="text-gray-400 font-normal ml-1 normal-case">(from Meta Developer Portal → Generate token)</span>
          </label>
          <input type="password" value={manualToken} onChange={e => setManualToken(e.target.value)}
            placeholder="Paste token here — overrides OAuth token"
            className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent transition-colors" />
          <p className="text-[11px] text-gray-400 mt-1.5">
            In Meta Developer Portal → your app → Instagram (Added Products) → "Generate token" next to your account → copy and paste here.
          </p>
        </div>

        <details className="border border-gray-100 rounded-xl overflow-hidden">
          <summary className="px-4 py-3 text-xs font-semibold text-gray-400 cursor-pointer hover:text-gray-600 select-none bg-gray-50/70">
            Advanced: Facebook OAuth (requires Facebook Page link)
          </summary>
          <div className="px-4 pb-4 pt-3 space-y-3 border-t border-gray-100">
            <div>
              <label className="text-xs font-bold text-gray-500 uppercase tracking-wide block mb-1.5">Facebook App ID</label>
              <input type="text" value={appId} onChange={e => setAppId(e.target.value)}
                placeholder="1234567890123456"
                className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent transition-colors" />
            </div>
            <div>
              <label className="text-xs font-bold text-gray-500 uppercase tracking-wide block mb-1.5">App Secret</label>
              <input type="password" value={appSecret} onChange={e => setAppSecret(e.target.value)}
                placeholder="••••••••••••••••"
                className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent transition-colors" />
            </div>
            {oauthMsg && (
              <p className={`text-xs font-medium ${oauthStatus === 'done' ? 'text-green-600' : oauthStatus === 'error' ? 'text-red-500' : 'text-gray-500'}`}>
                {oauthStatus === 'waiting' ? '⏳ ' : ''}{oauthMsg}
              </p>
            )}
            <button onClick={connect} disabled={oauthStatus === 'waiting' || !appId}
              className="flex items-center gap-2 px-4 py-2.5 border border-gray-200 text-gray-600 text-sm font-semibold rounded-xl hover:bg-gray-50 disabled:opacity-50 transition-colors">
              Connect via Facebook
            </button>
          </div>
        </details>

        <div>
          <label className="text-xs font-bold text-gray-500 uppercase tracking-wide block mb-1.5">
            Instagram Business Account ID
            {igUserId ? <span className="text-green-600 font-normal ml-1 normal-case">✓ set</span> : <span className="text-amber-500 font-normal ml-1 normal-case">(required)</span>}
          </label>
          <input type="text" value={igUserId} onChange={e => setIgUserId(e.target.value)}
            placeholder="17841400123456789"
            className={`w-full text-sm rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 transition-colors border ${igUserId ? 'border-gray-200 focus:ring-accent/20 focus:border-accent' : 'border-amber-300 focus:ring-amber-400/30 bg-amber-50'}`} />
          <p className="text-[11px] text-gray-400 mt-1.5">
            Auto-filled by Re-detect, or find manually: <span className="font-mono">developers.facebook.com/tools/explorer</span>
          </p>
        </div>

        <div>
          <label className="text-xs font-bold text-gray-500 uppercase tracking-wide block mb-1.5">OpenAI API Key <span className="font-normal text-gray-400 normal-case">(for image generation)</span></label>
          <input type="password" value={openaiKey} onChange={e => setOpenaiKey(e.target.value)}
            placeholder={openaiKeyPreview ? `Current: ${openaiKeyPreview} — paste new key to replace` : 'sk-…  paste your OpenAI key here'}
            className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent transition-colors font-mono" />
          <p className="text-[11px] text-gray-400 mt-1.5">Get your key at platform.openai.com/api-keys — paste and click Save below.</p>
        </div>

        <div>
          <label className="text-xs font-bold text-gray-500 uppercase tracking-wide block mb-1.5">Image Model</label>
          <select value={imageModel} onChange={e => setImageModel(e.target.value)}
            className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent transition-colors bg-white">
            {IMAGE_MODELS.map(m => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
          <p className="text-[11px] text-gray-400 mt-1.5">DALL-E 3 / DALL-E 2 return a public URL directly. GPT Image 1 / GPT-5.5 return base64 — configure FTP below to auto-upload.</p>
          <button onClick={testImageKey} disabled={imgKeyTesting}
            className="mt-2 px-3 py-2 text-xs font-semibold rounded-xl border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 transition-colors disabled:opacity-50">
            {imgKeyTesting ? 'Testing…' : 'Test OpenAI image key'}
          </button>
          {imgKeyResult && (
            <div className={`mt-2 p-3 rounded-xl text-xs font-medium ${imgKeyResult.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
              {imgKeyResult.ok
                ? `✓ Working — models: ${imgKeyResult.working_models?.join(', ')}`
                : (imgKeyResult.results || []).map((r: any) => (
                    <div key={r.model}>{r.model}: {r.ok ? '✓ OK' : `✗ ${r.error?.split('\n')[0]}`}</div>
                  ))
              }
            </div>
          )}
        </div>

        <div className="border-t border-gray-100 pt-4">
          <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">FTP Image Hosting <span className="font-normal text-gray-400 normal-case">(for GPT Image 1 / GPT-5.5)</span></p>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-bold text-gray-500 uppercase tracking-wide block mb-1.5">FTP Host</label>
                <input type="text" value={ftpHost} onChange={e => setFtpHost(e.target.value)}
                  placeholder="ftp.example.com"
                  className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent transition-colors" />
              </div>
              <div>
                <label className="text-xs font-bold text-gray-500 uppercase tracking-wide block mb-1.5">Username</label>
                <input type="text" value={ftpUser} onChange={e => setFtpUser(e.target.value)}
                  placeholder="ftpuser"
                  className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent transition-colors" />
              </div>
            </div>
            <div>
              <label className="text-xs font-bold text-gray-500 uppercase tracking-wide block mb-1.5">Password</label>
              <input type="password" value={ftpPass} onChange={e => setFtpPass(e.target.value)}
                placeholder="••••••••"
                className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent transition-colors" />
            </div>
            <div>
              <label className="text-xs font-bold text-gray-500 uppercase tracking-wide block mb-1.5">Upload Path</label>
              <input type="text" value={ftpPath} onChange={e => setFtpPath(e.target.value)}
                placeholder="/public_html/uploads/"
                className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent transition-colors" />
            </div>
            <div>
              <label className="text-xs font-bold text-gray-500 uppercase tracking-wide block mb-1.5">Public URL Base</label>
              <input type="text" value={ftpPublicUrl} onChange={e => setFtpPublicUrl(e.target.value)}
                placeholder="https://example.com/uploads"
                className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent transition-colors" />
              <p className="text-[11px] text-gray-400 mt-1.5">The HTTP URL where uploaded files are publicly accessible.</p>
            </div>
            <div className="flex items-center gap-3 pt-1">
              <button onClick={verifyFtp} disabled={ftpVerifying || !ftpHost}
                className={`${BTN_SECONDARY}`}>
                {ftpVerifying ? 'Testing…' : 'Verify FTP'}
              </button>
              {ftpVerifyMsg && (
                <span className={`text-xs font-medium ${ftpVerifyMsg.ok ? 'text-green-600' : 'text-red-500'}`}>
                  {ftpVerifyMsg.ok ? '✓ ' : '✗ '}{ftpVerifyMsg.message}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {error && <p className="text-xs text-red-500 font-medium">{error}</p>}

      <div className="flex gap-2 pt-1 flex-wrap">
        <button onClick={save} disabled={saving}
          className={`${BTN_PRIMARY} py-2.5`}>
          {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save'}
        </button>
        {hasToken && (
          <button onClick={detectAccount} disabled={detecting}
            className={`${BTN_SECONDARY} py-2.5`}>
            {detecting ? 'Detecting…' : 'Re-detect Account ID'}
          </button>
        )}
      </div>
      {detectMsg && (
        <p className={`text-xs mt-1 font-medium ${detectMsg.ok ? 'text-green-600' : 'text-red-500'}`}>
          {detectMsg.ok ? '✓ ' : '✗ '}{detectMsg.message}
        </p>
      )}
    </div>
  )
}

function TriageRulesPanel() {
  const [rules, setRules] = useState<{ id: number; rule: string }[]>([])
  const [input, setInput] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => { api.getTriageRules().then(setRules).catch(() => {}) }, [])

  const add = async () => {
    if (!input.trim() || saving) return
    setSaving(true)
    try { const r = await api.addTriageRule(input.trim()); setRules(prev => [...prev, r]); setInput('') }
    finally { setSaving(false) }
  }

  const remove = async (id: number) => { await api.deleteTriageRule(id).catch(() => {}); setRules(prev => prev.filter(r => r.id !== id)) }

  return (
    <div className="rounded-2xl border border-gray-100 shadow-sm p-5">
      <p className="text-sm font-bold text-gray-800 mb-1">Smart Triage Rules</p>
      <p className="text-xs text-gray-400 mb-4">Plain-English rules: "from: ceo@corp.com → critical" · "invoice in subject → urgent"</p>
      <div className="flex gap-2 mb-3">
        <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()}
          placeholder="from: board@company.com → critical"
          className="flex-1 text-sm border border-gray-200 rounded-xl px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent transition-colors" />
        <button onClick={add} disabled={saving || !input.trim()}
          className={`${BTN_PRIMARY}`}>Add</button>
      </div>
      {rules.length === 0 && <p className="text-xs text-gray-300 italic">No rules yet.</p>}
      <ul className="space-y-1.5">
        {rules.map(r => (
          <li key={r.id} className="flex items-center justify-between text-xs bg-gray-50 rounded-xl px-3 py-2.5">
            <span className="text-gray-700 font-mono">{r.rule}</span>
            <button onClick={() => remove(r.id)} className="text-gray-300 hover:text-red-400 ml-3 font-bold transition-colors">✕</button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function MorningBriefEmailSettings() {
  const [enabled, setEnabled] = useState(false)
  const [to, setTo] = useState('')
  const [time, setTime] = useState('08:00')
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.getConfig().then(cfg => {
      setEnabled(cfg.morning_brief_email_enabled ?? false)
      setTo(cfg.morning_brief_email_to ?? '')
      setTime(cfg.morning_brief_email_time ?? '08:00')
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const save = async () => {
    await api.updateConfig({ morning_brief_email_enabled: enabled, morning_brief_email_to: to, morning_brief_email_time: time })
    setSaved(true); setTimeout(() => setSaved(false), 2500)
  }

  if (loading) return <p className="text-xs text-gray-400">Loading…</p>
  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500">Receive a daily email at your chosen time with news headlines, priority inbox, follow-ups, calendar events, and active projects.</p>
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} className="w-4 h-4 rounded accent-accent" />
        <span className="text-sm font-medium text-gray-700">Enable daily morning brief email</span>
      </label>
      {enabled && (
        <div className="space-y-2 pt-1">
          <div>
            <label className="text-xs font-bold text-gray-500 uppercase tracking-wide block mb-1">Send to</label>
            <input value={to} onChange={e => setTo(e.target.value)} placeholder="your@email.com" className={INPUT_CLS} />
          </div>
          <div>
            <label className="text-xs font-bold text-gray-500 uppercase tracking-wide block mb-1">Send time</label>
            <input type="time" value={time} onChange={e => setTime(e.target.value)} className={INPUT_CLS} />
          </div>
        </div>
      )}
      <div className="flex items-center gap-2 pt-1">
        <button onClick={save} className={BTN_PRIMARY}>Save</button>
        {saved && <span className="text-xs text-green-600 font-medium">✓ Saved</span>}
      </div>
    </div>
  )
}

const TONE_PRESETS = [
  { label: 'Professional', value: 'I communicate in a clear, professional tone. I am concise and direct, avoid jargon, and always maintain a respectful, confident voice.' },
  { label: 'Warm & Friendly', value: 'My tone is warm, approachable, and friendly. I like to build personal connections in my emails, use a conversational style, and often add a personal touch.' },
  { label: 'Executive', value: 'I am an executive. My emails are brief, decisive, and action-oriented. I lead with the key point, expect action, and avoid unnecessary explanation.' },
  { label: 'Collaborative', value: 'I prefer a collaborative tone — inclusive language, asking questions, inviting feedback, and framing decisions as team efforts.' },
  { label: 'Formal', value: 'My communication style is formal and structured. I use complete sentences, avoid contractions, and maintain a polished, business-formal register.' },
]

function AutopilotSection() {
  const [rules, setRules] = useState<AutopilotRule[]>([])
  const [loading, setLoading] = useState(true)
  const [newEmail, setNewEmail] = useState('')
  const [newName, setNewName] = useState('')
  const [newMode, setNewMode] = useState<'reply' | 'draft'>('draft')
  const [newHint, setNewHint] = useState('')
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const [addedIds, setAddedIds] = useState<Set<number>>(new Set())
  const [activity, setActivity] = useState<{ id: number; email_id: string; sender: string; subject: string; action: string; created_at: string }[]>([])
  const [activityLoading, setActivityLoading] = useState(false)
  const [userName, setUserName] = useState('')
  const [savingName, setSavingName] = useState(false)
  const [nameMsg, setNameMsg] = useState('')

  const reload = () => api.getAutopilotRules().then((r: { rules: AutopilotRule[] }) => { setRules(r.rules); setLoading(false) }).catch(() => setLoading(false))
  const reloadActivity = () => {
    setActivityLoading(true)
    api.getAutopilotActivity().then(r => { setActivity(r.activity); setActivityLoading(false) }).catch(() => setActivityLoading(false))
  }
  useEffect(() => {
    reload(); reloadActivity()
    api.getConfig().then(cfg => setUserName(cfg.user_name || '')).catch(() => {})
  }, [])

  const saveName = async () => {
    setSavingName(true)
    try {
      await api.updateConfig({ user_name: userName.trim() })
      setNameMsg('Saved')
    } catch { setNameMsg('Failed') }
    setSavingName(false)
    setTimeout(() => setNameMsg(''), 3000)
  }

  const addRule = async () => {
    if (!newEmail.trim()) return
    setSaving(true)
    try {
      const res = await api.addAutopilotRule({ email_addr: newEmail.trim(), display_name: newName.trim(), mode: newMode, prompt_hint: newHint.trim() })
      setAddedIds(prev => new Set([...prev, res.id]))
      await reload()
      setNewEmail(''); setNewName(''); setNewHint('')
      setMsg('Rule saved')
    } catch { setMsg('Failed to save') }
    setSaving(false)
    setTimeout(() => setMsg(''), 3000)
  }

  const updateMode = async (id: number, mode: string, hint: string) => {
    try {
      await api.updateAutopilotRule(id, { mode, prompt_hint: hint })
      setRules(prev => prev.map(r => r.id === id ? { ...r, mode: mode as AutopilotRule['mode'] } : r))
    } catch { setMsg('Update failed'); setTimeout(() => setMsg(''), 3000) }
  }

  const removeRule = async (id: number) => {
    try {
      await api.deleteAutopilotRule(id)
      setRules(prev => prev.filter(r => r.id !== id))
    } catch { setMsg('Remove failed'); setTimeout(() => setMsg(''), 3000) }
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold text-gray-900 mb-1">Email Autopilot</h3>
        <p className="text-sm text-gray-500 mb-4">
          Define senders whose emails trigger automatic AI replies. Choose <strong>Draft</strong> to review before sending, or <strong>Auto Reply</strong> to send immediately.
        </p>
      </div>

      {/* User name — used in all AI-generated autopilot replies */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide mb-2">Your Name</p>
        <p className="text-xs text-blue-600 mb-3">The AI signs replies and refers to you by this name. Leave blank to use a generic greeting.</p>
        <div className="flex gap-2 items-center">
          <input
            className="flex-1 border border-blue-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white"
            placeholder="e.g. Ali Salamat"
            value={userName}
            onChange={e => setUserName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && saveName()}
          />
          <button
            onClick={saveName}
            disabled={savingName}
            className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap"
          >
            {savingName ? 'Saving…' : 'Save'}
          </button>
          {nameMsg && <span className="text-xs text-blue-700 font-medium">{nameMsg}</span>}
        </div>
      </div>

      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-3">
        <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Add Rule</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Email Address</label>
            <input className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" placeholder="sender@example.com" value={newEmail} onChange={e => setNewEmail(e.target.value)} onKeyDown={e => e.key === 'Enter' && addRule()} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Display Name (optional)</label>
            <input className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" placeholder="Jane Smith" value={newName} onChange={e => setNewName(e.target.value)} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Action</label>
            <select className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" value={newMode} onChange={e => setNewMode(e.target.value as 'reply' | 'draft')}>
              <option value="draft">Save as Draft</option>
              <option value="reply">Auto Reply (send immediately)</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Custom Instructions</label>
            <input className="w-full border border-gray-300 rounded px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-400" placeholder="e.g. be brief and formal" value={newHint} onChange={e => setNewHint(e.target.value)} />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={addRule} disabled={saving || !newEmail.trim()} className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50 transition-colors">
            {saving ? 'Saving…' : '+ Add Rule'}
          </button>
          {msg && <span className="text-sm text-green-600">{msg}</span>}
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : rules.length === 0 ? (
        <p className="text-sm text-gray-400 italic">No autopilot rules defined. Add one above.</p>
      ) : (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{rules.length} rule{rules.length !== 1 ? 's' : ''}</p>
          {rules.map(rule => (
            <div key={rule.id} className={`flex items-center gap-3 bg-white border rounded-lg px-4 py-3 transition-colors ${addedIds.has(rule.id) ? 'border-blue-300 bg-blue-50' : 'border-gray-200'}`}>
              <span className="text-lg">🤖</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">{rule.display_name || rule.email_addr}</p>
                <p className="text-xs text-gray-500 truncate">{rule.email_addr}</p>
                {rule.prompt_hint && <p className="text-xs text-gray-400 truncate mt-0.5 italic">"{rule.prompt_hint}"</p>}
              </div>
              <select
                value={rule.mode}
                onChange={e => updateMode(rule.id, e.target.value, rule.prompt_hint)}
                className="border border-gray-300 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white"
              >
                <option value="draft">Draft</option>
                <option value="reply">Auto Reply</option>
                <option value="off">Off</option>
              </select>
              <button onClick={() => removeRule(rule.id)} className="text-red-400 hover:text-red-600 text-xs px-2 py-1 rounded hover:bg-red-50 transition-colors">
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Activity Log */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Recent Activity</p>
          <button onClick={reloadActivity} className="text-xs text-blue-500 hover:underline">Refresh</button>
        </div>
        {activityLoading ? (
          <p className="text-sm text-gray-400">Loading…</p>
        ) : activity.length === 0 ? (
          <p className="text-sm text-gray-400 italic">No activity yet. Autopilot actions will appear here.</p>
        ) : (
          <div className="space-y-1.5">
            {activity.map(a => (
              <div key={a.id} className={`flex items-start gap-2 border rounded-lg px-3 py-2 ${a.action === 'ai_failed' || a.action === 'error' ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-200'}`}>
                <span className="text-base mt-0.5">
                  {a.action === 'reply_sent' ? '📤' : a.action === 'draft_saved' ? '📝' : '⚠️'}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                      a.action === 'reply_sent' ? 'bg-green-100 text-green-700' :
                      a.action === 'draft_saved' ? 'bg-blue-100 text-blue-700' :
                      'bg-red-100 text-red-700'
                    }`}>
                      {a.action === 'reply_sent' ? 'Auto-Reply Sent' :
                       a.action === 'draft_saved' ? 'Draft Saved' :
                       a.action === 'ai_failed' ? 'AI Failed — Check API Credits' : 'Error'}
                    </span>
                    <span className="text-[10px] text-gray-400">{new Date(a.created_at).toLocaleString()}</span>
                  </div>
                  <p className="text-xs text-gray-700 truncate mt-0.5">{a.subject || '(no subject)'}</p>
                  <p className="text-[10px] text-gray-400 truncate">{a.sender}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function WritingStyleSection() {
  const [persona, setPersona] = useState('')
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.getConfig().then(cfg => {
      setPersona(cfg.email_persona || '')
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const save = async () => {
    await api.updateConfig({ email_persona: persona })
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  const applyPreset = (value: string) => {
    setPersona(value)
    setSaved(false)
  }

  if (loading) return <div className="p-8 text-sm text-gray-400">Loading…</div>

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Writing Style"
        desc="Describe your communication style in plain language. The AI will use this whenever it drafts or replies on your behalf."
        icon={<span>✍️</span>}
      />

      {/* Tone presets */}
      <div>
        <p className="text-xs font-bold text-gray-500 uppercase tracking-widest mb-2">Quick presets</p>
        <div className="flex flex-wrap gap-2">
          {TONE_PRESETS.map(p => (
            <button
              key={p.label}
              onClick={() => applyPreset(p.value)}
              className="px-3 py-1.5 rounded-full border border-gray-200 text-xs font-medium text-gray-600 hover:border-accent hover:text-accent transition-colors bg-white"
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Custom description */}
      <div>
        <label className="text-xs font-bold text-gray-500 uppercase tracking-widest block mb-2">
          Your persona &amp; tone description
        </label>
        <textarea
          rows={7}
          value={persona}
          onChange={e => { setPersona(e.target.value); setSaved(false) }}
          placeholder={`Describe yourself and how you communicate.\n\nExamples:\n• "I'm a director at a consulting firm. My tone is professional but approachable. I'm concise, avoid fluff, and sign off with my first name only."\n• "I prefer a warm, collaborative tone. I like to acknowledge the other person's perspective before making my point."`}
          className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent transition-colors placeholder-gray-300"
        />
        <p className="text-[11px] text-gray-400 mt-1">
          This text is prepended to every AI-generated draft and reply. Keep it under 300 words for best results.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <button onClick={save} className={BTN_PRIMARY}>
          Save
        </button>
        {saved && <span className="text-xs text-green-600 font-medium">✓ Saved</span>}
        {persona && (
          <button onClick={() => { setPersona(''); setSaved(false) }} className={BTN_SECONDARY}>
            Clear
          </button>
        )}
      </div>

      {/* Info box */}
      <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4 text-xs text-blue-700 space-y-1">
        <p className="font-semibold">Where this applies</p>
        <ul className="list-disc pl-4 space-y-0.5 text-blue-600">
          <li>Smart Draft (single email reply)</li>
          <li>Bulk Draft (multiple emails at once)</li>
          <li>Voice Draft (AI voice-matched reply)</li>
        </ul>
        <p className="text-blue-500 pt-1">
          Tip: the AI also learns from your sent emails automatically — go to Intelligence → Smart Draft to run the style analysis.
        </p>
      </div>
    </div>
  )
}

function DbHealthTile({ stats, busy, msg, retentionInput, onRetentionInput, deleteBeforeDate, deleteBeforeCount, deleteBeforeConfirm, onDeleteBeforeDate, onDeleteBeforeConfirmToggle, onDeleteBefore, onOptimize, onSaveRetention, onApplyRetention }: {
  stats: DbStats | null
  busy: 'optimize' | 'retention' | 'save' | 'delete-before' | null
  msg: string
  retentionInput: string
  onRetentionInput: (v: string) => void
  deleteBeforeDate: string
  deleteBeforeCount: number | null
  deleteBeforeConfirm: boolean
  onDeleteBeforeDate: (d: string) => void
  onDeleteBeforeConfirmToggle: () => void
  onDeleteBefore: () => void
  onOptimize: () => void
  onSaveRetention: () => void
  onApplyRetention: () => void
}) {
  if (!stats) return <div className="rounded-2xl border border-gray-100 p-6 text-center text-xs text-gray-400">Loading database stats…</div>
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="grid grid-cols-2 divide-x divide-y divide-gray-100">
          {[
            { label: 'Database size', value: `${stats.db_size_mb} MB` },
            { label: 'Emails stored', value: stats.email_count.toLocaleString() },
            { label: 'VIP contacts', value: String(stats.vip_count) },
            { label: 'Last optimized', value: stats.last_vacuum ? new Date(stats.last_vacuum).toLocaleString() : 'Never' },
          ].map(({ label, value }) => (
            <div key={label} className="px-5 py-3.5 flex items-center justify-between gap-4">
              <span className="text-xs text-gray-500">{label}</span>
              <span className="text-sm font-semibold text-gray-800">{value}</span>
            </div>
          ))}
        </div>
      </div>
      <button onClick={onOptimize} disabled={!!busy} className={`w-full ${BTN_SECONDARY} py-2.5`}>
        {busy === 'optimize' ? 'Optimizing…' : 'Optimize Now (VACUUM + ANALYZE)'}
      </button>

      {/* Delete emails before a date */}
      <div className="rounded-2xl border border-red-100 p-4 space-y-3">
        <label className="text-xs font-bold text-red-500 uppercase tracking-wide block">🗑 Delete emails before date</label>
        <p className="text-xs text-gray-500">Permanently removes all emails older than the selected date from your local database.</p>
        <input
          type="date"
          value={deleteBeforeDate}
          onChange={e => onDeleteBeforeDate(e.target.value)}
          className={INPUT_CLS}
        />
        {deleteBeforeDate && deleteBeforeCount !== null && (
          <div className={`text-xs font-medium rounded-lg px-3 py-2 ${deleteBeforeCount === 0 ? 'bg-gray-50 text-gray-500' : 'bg-red-50 text-red-600'}`}>
            {deleteBeforeCount === 0
              ? 'No emails found before this date.'
              : `⚠️ This will permanently delete ${deleteBeforeCount.toLocaleString()} email(s).`}
          </div>
        )}
        {deleteBeforeDate && deleteBeforeCount !== null && deleteBeforeCount > 0 && (
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={deleteBeforeConfirm} onChange={onDeleteBeforeConfirmToggle} className="w-4 h-4 accent-red-500" />
            <span className="text-xs text-gray-600">I understand this cannot be undone</span>
          </label>
        )}
        {deleteBeforeDate && deleteBeforeConfirm && deleteBeforeCount !== null && deleteBeforeCount > 0 && (
          <button onClick={onDeleteBefore} disabled={!!busy}
            className="w-full text-sm font-semibold py-2.5 rounded-xl bg-red-500 text-white hover:bg-red-600 disabled:opacity-50 transition-colors">
            {busy === 'delete-before' ? 'Deleting…' : `Delete ${deleteBeforeCount.toLocaleString()} emails`}
          </button>
        )}
      </div>

      <div className="rounded-2xl border border-gray-100 p-4 space-y-3">
        <label className="text-xs font-bold text-gray-500 uppercase tracking-wide block">
          Auto-delete non-VIP emails older than (days, 0 = off)
        </label>
        <div className="flex gap-2">
          <input type="number" min={0} value={retentionInput}
            onChange={e => onRetentionInput(e.target.value)}
            className={INPUT_CLS} />
          <button onClick={onSaveRetention} disabled={!!busy} className={BTN_SECONDARY}>
            {busy === 'save' ? 'Saving…' : 'Save'}
          </button>
        </div>
        <button onClick={onApplyRetention} disabled={!!busy}
          className="w-full text-sm font-semibold py-2.5 rounded-xl bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50 transition-colors">
          {busy === 'retention' ? 'Pruning…' : 'Prune old emails now'}
        </button>
      </div>
      {msg && <p className="text-xs text-gray-600 font-medium">{msg}</p>}
    </div>
  )
}
