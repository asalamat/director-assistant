import { useState, useEffect, useCallback } from "react";
import { api } from "../api/client";
import { useUIContext } from "../contexts/UIContext";

interface Job {
  id: number;
  company: string;
  role: string | null;
  stage: string;
  contact: string | null;
  contact_email: string | null;
  applied_date: string | null;
  last_contact: string | null;
  notes: string | null;
  email_ids: string | null;
  created_at: string;
}

interface JobForm {
  company: string;
  role: string;
  stage: string;
  contact: string;
  contact_email: string;
  applied_date: string;
  notes: string;
}

const STAGES: { key: string; label: string; color: string; header: string }[] = [
  { key: "applied", label: "Applied", color: "bg-blue-50 border-blue-200", header: "bg-blue-100 text-blue-800" },
  { key: "interview_scheduled", label: "Interview Scheduled", color: "bg-amber-50 border-amber-200", header: "bg-amber-100 text-amber-800" },
  { key: "interviewed", label: "Interviewed", color: "bg-purple-50 border-purple-200", header: "bg-purple-100 text-purple-800" },
  { key: "offer", label: "Offer", color: "bg-green-50 border-green-200", header: "bg-green-100 text-green-800" },
  { key: "rejected", label: "Rejected", color: "bg-gray-50 border-gray-200", header: "bg-gray-100 text-gray-600" },
];

const EMPTY_FORM: JobForm = {
  company: "", role: "", stage: "applied",
  contact: "", contact_email: "", applied_date: "", notes: "",
};

export default function JobTracker() {
  const { openCompose } = useUIContext();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [form, setForm] = useState<JobForm>(EMPTY_FORM);
  const [extractedJobs, setExtractedJobs] = useState<Partial<Job>[]>([]);
  const [extractChecked, setExtractChecked] = useState<Set<number>>(new Set());
  const [scanning, setScanning] = useState(false);
  const [showExtractModal, setShowExtractModal] = useState(false);
  const [scanMeta, setScanMeta] = useState<{ deduped: number; excluded: number } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/jobs");
      const data = await res.json();
      setJobs(data.jobs || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleAdd = async () => {
    if (!form.company.trim()) return;
    await fetch("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        email_ids: [],
      }),
    });
    setForm(EMPTY_FORM);
    setShowAddForm(false);
    load();
  };

  const handleMove = async (id: number, stage: string) => {
    await fetch(`/api/jobs/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stage }),
    });
    load();
  };

  const handleDelete = async (id: number) => {
    await fetch(`/api/jobs/${id}`, { method: "DELETE" });
    load();
  };

  const handleScan = async () => {
    setScanning(true);
    try {
      const res = await fetch("/api/jobs/extract", { method: "POST" });
      const data = await res.json();
      const found: Partial<Job>[] = data.jobs || [];
      setExtractedJobs(found);
      setExtractChecked(new Set(found.map((_, i) => i)));
      setScanMeta({ deduped: data.deduped ?? 0, excluded: data.excluded ?? 0 });
      setShowExtractModal(true);
    } finally {
      setScanning(false);
    }
  };

  const handleExclude = async (i: number) => {
    const job = extractedJobs[i];
    await fetch("/api/jobs/exclude-scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ company: job.company, role: job.role }),
    });
    setExtractedJobs(prev => prev.filter((_, idx) => idx !== i));
    setExtractChecked(prev => {
      const next = new Set<number>();
      prev.forEach(idx => {
        if (idx < i) next.add(idx);
        else if (idx > i) next.add(idx - 1);
      });
      return next;
    });
  };

  const handleAddSelected = async () => {
    const toAdd = extractedJobs.filter((_, i) => extractChecked.has(i));
    for (const j of toAdd) {
      await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company: j.company || "Unknown",
          role: j.role || null,
          stage: j.stage || "applied",
          contact: j.contact || null,
          contact_email: j.contact_email || null,
          applied_date: j.applied_date || null,
          last_contact: j.last_contact || null,
          notes: j.notes || null,
          email_ids: j.email_ids ? JSON.parse(j.email_ids) : [],
        }),
      });
    }
    setShowExtractModal(false);
    setExtractedJobs([]);
    setExtractChecked(new Set());
    load();
  };

  const jobsByStage = (stageKey: string) => jobs.filter(j => j.stage === stageKey);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 flex-shrink-0">
        <h2 className="text-base font-semibold text-gray-800">Job Application Tracker</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={handleScan}
            disabled={scanning}
            className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 bg-white text-gray-700 hover:border-blue-300 hover:text-blue-600 hover:bg-blue-50 transition-colors disabled:opacity-50"
          >
            {scanning ? "Scanning…" : "Scan Emails"}
          </button>
          <button
            onClick={() => setShowAddForm(v => !v)}
            className="text-xs px-3 py-1.5 rounded-lg bg-accent text-white hover:bg-blue-700 transition-colors"
          >
            + Add Application
          </button>
          <button onClick={load} disabled={loading} className="text-xs text-gray-400 hover:text-accent px-2 py-1 rounded hover:bg-blue-50 transition-colors">↺</button>
        </div>
      </div>

      {/* Add form */}
      {showAddForm && (
        <div className="px-4 py-3 border-b border-gray-200 bg-gray-50 flex-shrink-0">
          <div className="grid grid-cols-2 gap-2 mb-2">
            <input
              placeholder="Company *"
              value={form.company}
              onChange={e => setForm(f => ({ ...f, company: e.target.value }))}
              className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
            <input
              placeholder="Role / Position"
              value={form.role}
              onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
              className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
            <input
              placeholder="Contact Name"
              value={form.contact}
              onChange={e => setForm(f => ({ ...f, contact: e.target.value }))}
              className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
            <input
              placeholder="Contact Email"
              value={form.contact_email}
              onChange={e => setForm(f => ({ ...f, contact_email: e.target.value }))}
              className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
            <input
              type="date"
              placeholder="Applied Date"
              value={form.applied_date}
              onChange={e => setForm(f => ({ ...f, applied_date: e.target.value }))}
              className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
            <select
              value={form.stage}
              onChange={e => setForm(f => ({ ...f, stage: e.target.value }))}
              className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400 bg-white"
            >
              {STAGES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </div>
          <textarea
            placeholder="Notes"
            value={form.notes}
            onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
            rows={2}
            className="w-full text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 resize-none focus:outline-none focus:ring-1 focus:ring-blue-400 mb-2"
          />
          <div className="flex gap-2">
            <button
              onClick={handleAdd}
              disabled={!form.company.trim()}
              className="text-xs px-3 py-1.5 rounded-lg bg-accent text-white hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              Save
            </button>
            <button
              onClick={() => { setShowAddForm(false); setForm(EMPTY_FORM); }}
              className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-100 transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Kanban board */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden">
        <div className="flex gap-3 p-4 h-full min-w-max">
          {STAGES.map(stage => (
            <div key={stage.key} className="flex flex-col w-56 flex-shrink-0">
              <div className={`flex items-center justify-between px-3 py-2 rounded-t-xl font-medium text-xs mb-1 ${stage.header}`}>
                <span>{stage.label}</span>
                <span className="text-xs opacity-70">{jobsByStage(stage.key).length}</span>
              </div>
              <div className="flex-1 overflow-y-auto space-y-2 pr-0.5">
                {jobsByStage(stage.key).map(job => (
                  <JobCard
                    key={job.id}
                    job={job}
                    stages={STAGES}
                    onMove={handleMove}
                    onDelete={handleDelete}
                    onThankYou={openCompose}
                  />
                ))}
                {jobsByStage(stage.key).length === 0 && (
                  <div className="text-xs text-gray-400 text-center py-6 border border-dashed border-gray-200 rounded-xl">
                    No applications
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Extract confirmation modal */}
      {showExtractModal && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-lg w-full max-w-lg max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
              <div>
                <span className="text-sm font-semibold text-gray-800">
                  Found {extractedJobs.length} new job{extractedJobs.length !== 1 ? "s" : ""} in emails
                </span>
                {scanMeta && (scanMeta.deduped > 0 || scanMeta.excluded > 0) && (
                  <div className="text-xs text-gray-400 mt-0.5">
                    {scanMeta.deduped > 0 && <span>{scanMeta.deduped} already on board</span>}
                    {scanMeta.deduped > 0 && scanMeta.excluded > 0 && <span> · </span>}
                    {scanMeta.excluded > 0 && <span>{scanMeta.excluded} excluded</span>}
                  </div>
                )}
              </div>
              <button
                onClick={() => setShowExtractModal(false)}
                className="text-gray-400 hover:text-gray-600 text-lg leading-none"
              >×</button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {extractedJobs.length === 0 ? (
                <p className="text-xs text-gray-500 text-center py-4">No job applications detected in recent emails.</p>
              ) : (
                extractedJobs.map((job, i) => (
                  <div key={i} className="flex items-start gap-2 bg-gray-50 rounded-lg p-3 border border-gray-200 hover:border-blue-200 transition-colors">
                    <input
                      type="checkbox"
                      checked={extractChecked.has(i)}
                      onChange={e => {
                        const next = new Set(extractChecked);
                        e.target.checked ? next.add(i) : next.delete(i);
                        setExtractChecked(next);
                      }}
                      className="mt-0.5 flex-shrink-0 cursor-pointer"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-semibold text-gray-800">{job.company}</div>
                      {job.role && <div className="text-xs text-gray-500">{job.role}</div>}
                      {job.contact && <div className="text-xs text-gray-400">{job.contact}{job.contact_email ? ` · ${job.contact_email}` : ""}</div>}
                      {job.notes && <div className="text-xs text-gray-400 mt-1 line-clamp-2">{job.notes}</div>}
                    </div>
                    <button
                      onClick={() => handleExclude(i)}
                      title="Don't show this again"
                      className="flex-shrink-0 text-[11px] text-gray-400 hover:text-red-500 hover:bg-red-50 px-1.5 py-1 rounded transition-colors"
                    >
                      ✕ hide
                    </button>
                  </div>
                ))
              )}
            </div>
            <div className="flex gap-2 px-4 py-3 border-t border-gray-200">
              <button
                onClick={handleAddSelected}
                disabled={extractChecked.size === 0}
                className="text-xs px-3 py-1.5 rounded-lg bg-accent text-white hover:bg-blue-700 transition-colors disabled:opacity-50"
              >
                Add Selected ({extractChecked.size})
              </button>
              <button
                onClick={() => setShowExtractModal(false)}
                className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-100 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface JobCardProps {
  job: Job;
  stages: typeof STAGES;
  onMove: (id: number, stage: string) => void;
  onDelete: (id: number) => void;
  onThankYou: (prefill: { to?: string; subject?: string; body?: string }) => void;
}

function JobCard({ job, stages, onMove, onDelete, onThankYou }: JobCardProps) {
  const [showMove, setShowMove] = useState(false);
  const [thanking, setThanking] = useState(false);
  const [thankError, setThankError] = useState<string | null>(null);

  const canThank = job.stage === "interviewed" || job.stage === "offer";

  const openLinkedIn = () => {
    const url = `https://www.linkedin.com/search/results/all/?keywords=${encodeURIComponent(
      job.company + " " + (job.role || "")
    )}`;
    window.open(url, "_blank");
  };

  const handleThankYou = async () => {
    setThanking(true);
    setThankError(null);
    try {
      const res = await api.draftThankYou(job.id);
      onThankYou({ to: res.to, subject: res.subject, body: res.body });
    } catch (e) {
      setThankError(e instanceof Error ? e.message : "Failed to draft");
      setTimeout(() => setThankError(null), 3000);
    } finally {
      setThanking(false);
    }
  };

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm text-xs">
      <div className="flex items-start justify-between gap-1 mb-1">
        <span className="font-semibold text-gray-800 leading-tight">{job.company}</span>
        <button
          onClick={() => onDelete(job.id)}
          className="text-gray-300 hover:text-red-400 transition-colors flex-shrink-0 text-base leading-none"
          title="Delete"
        >×</button>
      </div>
      {job.role && <div className="text-gray-500 mb-1 truncate">{job.role}</div>}
      {job.contact && (
        <div className="text-gray-400 truncate">
          {job.contact}{job.contact_email ? ` · ${job.contact_email}` : ""}
        </div>
      )}
      {job.last_contact && (
        <div className="text-gray-400 mt-1">Last contact: {job.last_contact}</div>
      )}
      {job.notes && (
        <div className="text-gray-400 mt-1 line-clamp-2">{job.notes}</div>
      )}
      <div className="mt-2 pt-2 border-t border-gray-100 flex items-center justify-between">
        {showMove ? (
          <select
            autoFocus
            defaultValue={job.stage}
            onChange={e => { onMove(job.id, e.target.value); setShowMove(false); }}
            onBlur={() => setShowMove(false)}
            className="text-xs border border-gray-200 rounded px-1.5 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 flex-1"
          >
            {stages.map(s => (
              <option key={s.key} value={s.key}>{s.label}</option>
            ))}
          </select>
        ) : (
          <button
            onClick={() => setShowMove(true)}
            className="text-xs text-gray-400 hover:text-accent hover:bg-blue-50 px-2 py-1 rounded transition-colors"
          >
            Move to…
          </button>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <button
          onClick={openLinkedIn}
          className="text-[11px] bg-gray-100 text-gray-600 px-2 py-1 rounded hover:bg-gray-200"
        >
          🔗 LinkedIn
        </button>
        {canThank && (
          <button
            onClick={handleThankYou}
            disabled={thanking}
            className="text-[11px] bg-purple-600 text-white px-2 py-1 rounded hover:bg-purple-700 disabled:opacity-50"
          >
            {thanking ? "…" : "✉ Thank-You"}
          </button>
        )}
      </div>
      {thankError && (
        <div className="mt-1 text-[11px] text-red-500">{thankError}</div>
      )}
    </div>
  );
}
