import { useState, useEffect, useCallback } from 'react'
import { api } from '../api/client'
import type { AIProvider, AIProviderSave } from '../types'
import { Button, Badge, Spinner } from './ui'

const PROVIDER_ICONS: Record<string, string> = {
  anthropic:         '🤖',
  openai:            '🧠',
  groq:              '⚡',
  gemini:            '🌟',
  ollama:            '🦙',
  kimi:              '🌙',
  'openai-compatible': '🔗',
}

// Left accent border per provider — white card, colored left stripe
const PROVIDER_ACCENT: Record<string, string> = {
  anthropic:         'border-l-4 border-l-orange-400',
  openai:            'border-l-4 border-l-green-500',
  groq:              'border-l-4 border-l-purple-500',
  gemini:            'border-l-4 border-l-blue-500',
  ollama:            'border-l-4 border-l-gray-400',
  kimi:              'border-l-4 border-l-indigo-500',
  'openai-compatible': 'border-l-4 border-l-gray-400',
}

interface ProviderForm {
  type: string
  label: string
  key: string
  base_url: string
  model_override: string
  enabled: boolean
}

function ProviderCard({
  provider, index, total, onMoveUp, onMoveDown, onToggle, onDelete, onEdit
}: {
  provider: AIProvider & { key?: string }
  index: number
  total: number
  onMoveUp: () => void
  onMoveDown: () => void
  onToggle: () => void
  onDelete: () => void
  onEdit: () => void
}) {
  return (
    <div className={`bg-white border border-gray-200 rounded-xl p-3 shadow-sm transition-all
      ${PROVIDER_ACCENT[provider.type] || 'border-l-4 border-l-gray-300'}
      ${!provider.enabled ? 'opacity-60' : 'hover:shadow-card-md'}`}>
      <div className="flex items-center gap-3">
        {/* Priority arrows */}
        <div className="flex flex-col gap-0.5">
          <button onClick={onMoveUp} disabled={index === 0}
            className="text-gray-500 hover:text-gray-900 disabled:opacity-25 text-[10px] leading-none p-1 rounded hover:bg-gray-100 transition-colors font-bold">▲</button>
          <button onClick={onMoveDown} disabled={index === total - 1}
            className="text-gray-500 hover:text-gray-900 disabled:opacity-25 text-[10px] leading-none p-1 rounded hover:bg-gray-100 transition-colors font-bold">▼</button>
        </div>

        {/* Icon + info */}
        <div className="flex items-center gap-2.5 flex-1 min-w-0">
          <span className="text-2xl">{PROVIDER_ICONS[provider.type] || '🔗'}</span>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <p className="text-sm font-semibold text-gray-900 truncate">{provider.label || provider.type}</p>
              {index === 0 && provider.enabled && <Badge variant="success">Primary</Badge>}
              {index === 1 && provider.enabled && <Badge variant="info">Fallback</Badge>}
              {index > 1 && provider.enabled && <Badge variant="default">Reserve {index + 1}</Badge>}
              {!provider.enabled && <Badge variant="default">Disabled</Badge>}
            </div>
            <p className="text-xs text-gray-600 mt-0.5">
              {provider.key_preview ? `Key: ${provider.key_preview}` : <span className="text-amber-600 font-medium">No key set</span>}
              {provider.base_url && <span className="ml-2 text-gray-500">{provider.base_url}</span>}
              {provider.model_override && <span className="ml-2 text-gray-500">Model: {provider.model_override}</span>}
            </p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <button onClick={onToggle}
            className={`text-xs font-medium px-2.5 py-1 rounded-lg border transition-colors ${
              provider.enabled
                ? 'border-gray-200 text-gray-700 hover:bg-gray-50'
                : 'border-accent-200 text-accent-600 bg-accent-50 hover:bg-accent-100'
            }`}>
            {provider.enabled ? 'Disable' : 'Enable'}
          </button>
          <button onClick={onEdit}
            className="text-xs text-gray-600 hover:text-accent-600 px-2 py-1 rounded-lg hover:bg-gray-100 transition-colors border border-gray-200 hover:border-accent-200">
            Edit
          </button>
          <button onClick={onDelete}
            className="text-xs text-gray-500 hover:text-red-600 px-2 py-1 rounded-lg hover:bg-red-50 transition-colors border border-gray-200 hover:border-red-200">✕</button>
        </div>
      </div>
    </div>
  )
}

function AddProviderForm({
  availableTypes, availableModels, onSave, onCancel, initial
}: {
  availableTypes: Record<string, { label: string; base_url: string }>
  availableModels: Record<string, string[]>
  onSave: (p: ProviderForm, test: boolean) => Promise<void>
  onCancel: () => void
  initial?: ProviderForm
}) {
  const [form, setForm] = useState<ProviderForm>(initial || {
    type: 'anthropic', label: '', key: '', base_url: '', model_override: '', enabled: true
  })
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null)

  const typeInfo = availableTypes[form.type] || {}
  const models = availableModels[form.type] || []

  // Auto-fill base_url and label when type changes
  const setType = (t: string) => {
    const info = availableTypes[t] || {}
    setForm(f => ({ ...f, type: t, base_url: info.base_url || '', label: info.label || t, model_override: '' }))
    setTestResult(null)
  }

  const test = async () => {
    setTesting(true); setTestResult(null)
    try {
      const r = await api.testProvider({ type: form.type, key: form.key, base_url: form.base_url, model: form.model_override })
      setTestResult({ ok: r.valid, msg: r.valid ? `✓ Connected — model: ${r.model}` : (r.error || 'Failed') })
    } catch (e: any) {
      setTestResult({ ok: false, msg: e.message || 'Test failed' })
    }
    setTesting(false)
  }

  const save = async () => {
    setSaving(true)
    await onSave(form, false)
    setSaving(false)
  }

  return (
    <div className="border border-accent-200 bg-accent-50/30 rounded-xl p-4 space-y-3">
      <p className="text-xs font-semibold text-gray-700">{initial ? 'Edit provider' : 'Add AI provider'}</p>

      {/* Provider type */}
      <div>
        <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide block mb-1">Provider</label>
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(availableTypes).map(([t, info]) => (
            <button key={t} onClick={() => setType(t)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                form.type === t ? 'border-accent-500 bg-accent-500 text-white shadow-sm' : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'
              }`}>
              <span>{PROVIDER_ICONS[t] || '🔗'}</span>
              <span>{info.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Label */}
      <div>
        <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide block mb-1">Display name</label>
        <input value={form.label} onChange={e => setForm(f => ({...f, label: e.target.value}))} placeholder={typeInfo.label || form.type}
          className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent-500/30 focus:border-accent-500 bg-white" />
      </div>

      {/* API Key */}
      {form.type !== 'ollama' && (
        <div>
          <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide block mb-1">
            API Key {form.type === 'ollama' ? '(not required)' : '*'}
          </label>
          <input value={form.key} onChange={e => setForm(f => ({...f, key: e.target.value}))}
            placeholder={`Paste your ${form.type} API key…`} type="password"
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent-500/30 focus:border-accent-500 bg-white font-mono" />
        </div>
      )}

      {/* Base URL (for openai-compatible / custom) */}
      {(form.type === 'openai-compatible' || form.base_url) && (
        <div>
          <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide block mb-1">Base URL</label>
          <input value={form.base_url} onChange={e => setForm(f => ({...f, base_url: e.target.value}))}
            placeholder="https://your-api.example.com/v1"
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent-500/30 focus:border-accent-500 bg-white font-mono" />
        </div>
      )}

      {/* Model override */}
      <div>
        <label className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide block mb-1">
          Default model <span className="font-normal text-gray-400">(optional — overrides auto-mapping)</span>
        </label>
        {models.length > 0 ? (
          <select value={form.model_override} onChange={e => setForm(f => ({...f, model_override: e.target.value}))}
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-accent-500 bg-white">
            <option value="">Auto (recommended)</option>
            {models.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        ) : (
          <input value={form.model_override} onChange={e => setForm(f => ({...f, model_override: e.target.value}))}
            placeholder="e.g. my-custom-model"
            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-accent-500 bg-white" />
        )}
      </div>

      {/* Test result */}
      {testResult && (
        <div className={`text-xs px-3 py-2 rounded-lg ${testResult.ok ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
          {testResult.msg}
        </div>
      )}

      <div className="flex gap-2">
        <Button variant="ghost" size="sm" loading={testing} onClick={test} disabled={!form.key && form.type !== 'ollama'}>
          {testing ? 'Testing…' : '🔌 Test connection'}
        </Button>
        <div className="flex-1" />
        <Button variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
        <Button variant="primary" size="sm" loading={saving} onClick={save}
          disabled={!form.key && form.type !== 'ollama'}>
          Save
        </Button>
      </div>
    </div>
  )
}

export function AIProvidersPanel() {
  const [providers, setProviders] = useState<(AIProvider & { key?: string })[]>([])
  const [availableTypes, setAvailableTypes] = useState<Record<string, { label: string; base_url: string }>>({})
  const [availableModels, setAvailableModels] = useState<Record<string, string[]>>({})
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [editIdx, setEditIdx] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')
  // Store full keys separately (masked on server)
  const [keys, setKeys] = useState<Record<number, string>>({})

  const load = useCallback(() => {
    setLoading(true)
    api.getProviders().then(r => {
      setProviders(r.providers)
      setAvailableTypes(r.available_types)
      setAvailableModels(r.available_models)
    }).catch(() => {}).finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  const buildSaveList = (): AIProviderSave[] =>
    providers.map((p, i) => ({
      type: p.type,
      label: p.label || p.type,
      key: keys[i] || '',  // use stored key or empty (server keeps existing)
      enabled: p.enabled,
      priority: i + 1,
      base_url: p.base_url || '',
      model_override: p.model_override || '',
    }))

  const saveAll = async (list?: AIProviderSave[]) => {
    setSaving(true); setSaveMsg('')
    try {
      const payload = list || buildSaveList()
      await api.saveProviders(payload)
      setSaveMsg('Saved — changes take effect immediately')
      setTimeout(() => setSaveMsg(''), 3000)
      // Clear keys cache (keys are on server now)
      setKeys({})
      load()
    } catch (e: any) {
      setSaveMsg('Save failed: ' + (e.message || 'unknown error'))
    }
    setSaving(false)
  }

  const moveUp = (i: number) => {
    if (i === 0) return
    const next = [...providers]
    ;[next[i-1], next[i]] = [next[i], next[i-1]]
    setProviders(next)
  }

  const moveDown = (i: number) => {
    if (i === providers.length - 1) return
    const next = [...providers]
    ;[next[i], next[i+1]] = [next[i+1], next[i]]
    setProviders(next)
  }

  const toggle = (i: number) => {
    const next = [...providers]
    next[i] = { ...next[i], enabled: !next[i].enabled }
    setProviders(next)
  }

  const deleteP = (i: number) => {
    setProviders(prev => prev.filter((_, idx) => idx !== i))
  }

  const addProvider = async (form: ProviderForm) => {
    const newP: AIProvider & { key?: string } = {
      type: form.type, label: form.label || availableTypes[form.type]?.label || form.type,
      enabled: true, priority: providers.length + 1,
      key_preview: form.key ? form.key.slice(0, 4) + '…' : '',
      base_url: form.base_url, model_override: form.model_override,
    }
    const newIdx = providers.length
    setProviders(prev => [...prev, newP])
    if (form.key) setKeys(prev => ({ ...prev, [newIdx]: form.key }))
    setShowAdd(false)
    // Save immediately
    const list: AIProviderSave[] = [...buildSaveList(), {
      type: form.type, label: newP.label, key: form.key,
      enabled: true, priority: newIdx + 1,
      base_url: form.base_url, model_override: form.model_override,
    }]
    await saveAll(list)
  }

  const editProvider = async (form: ProviderForm) => {
    if (editIdx === null) return
    const next = [...providers]
    next[editIdx] = { ...next[editIdx], ...form,
      key_preview: form.key ? form.key.slice(0, 4) + '…' : next[editIdx].key_preview }
    if (form.key) setKeys(prev => ({ ...prev, [editIdx]: form.key }))
    setProviders(next)
    setEditIdx(null)
    await saveAll()
  }

  if (loading) return <div className="flex justify-center py-8"><Spinner size="sm" /></div>

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-gray-800">AI Providers</h3>
          <p className="text-xs text-gray-400 mt-0.5">
            Drag ▲▼ to set priority order — the first enabled provider is <strong>primary</strong>, the next is the <strong>fallback</strong>.
          </p>
        </div>
        {saveMsg && (
          <span className={`text-xs ${saveMsg.includes('failed') ? 'text-red-500' : 'text-emerald-600'}`}>
            {saveMsg}
          </span>
        )}
      </div>

      {/* Provider list */}
      <div className="space-y-2">
        {providers.length === 0 && (
          <p className="text-sm text-gray-400 text-center py-6">No providers configured — add one below</p>
        )}
        {providers.map((p, i) => (
          editIdx === i ? (
            <AddProviderForm
              key={i}
              availableTypes={availableTypes}
              availableModels={availableModels}
              initial={{ type: p.type, label: p.label, key: '', base_url: p.base_url || '', model_override: p.model_override || '', enabled: p.enabled }}
              onSave={editProvider}
              onCancel={() => setEditIdx(null)}
            />
          ) : (
            <ProviderCard
              key={i} provider={p} index={i} total={providers.length}
              onMoveUp={() => moveUp(i)}
              onMoveDown={() => moveDown(i)}
              onToggle={() => toggle(i)}
              onDelete={() => deleteP(i)}
              onEdit={() => setEditIdx(i)}
            />
          )
        ))}
      </div>

      {/* Add / Save row */}
      {showAdd ? (
        <AddProviderForm
          availableTypes={availableTypes}
          availableModels={availableModels}
          onSave={addProvider}
          onCancel={() => setShowAdd(false)}
        />
      ) : (
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={() => setShowAdd(true)}>+ Add provider</Button>
          {providers.length > 0 && (
            <Button variant="primary" size="sm" loading={saving} onClick={() => saveAll()}>
              Save order & settings
            </Button>
          )}
        </div>
      )}

      {/* Info box */}
      <div className="text-xs text-gray-700 bg-blue-50 rounded-xl p-3 space-y-1 leading-relaxed border border-blue-100">
        <p><strong className="text-gray-900">How priority works:</strong> The app tries providers top-to-bottom. If the primary hits a rate limit, auth error, or quota, it automatically switches to the next enabled provider.</p>
        <p><strong className="text-gray-900">Supported:</strong> Anthropic Claude · OpenAI GPT · Groq (Llama/Mixtral) · Google Gemini · Kimi (Moonshot AI) · Ollama (local) · Any OpenAI-compatible API</p>
      </div>
    </div>
  )
}
