import React, { useEffect, useRef, useState } from "react";
import api from "./api";
import "./App.css";

// ── Types ────────────────────────────────────────────────────────────────────

interface Doc {
  _id: string;
  filename: string;
  course?: string;
  level?: string;
  subject?: string;
  module?: string;
  chapter?: string;
  unit?: string;
  section?: string;
  pdf_url?: string;
  storage_backend?: string;
  uploaded_at: string;
  total_vectors?: number;
}

interface UploadProgress {
  filename: string;
  status: "pending" | "uploading" | "success" | "error";
  progress: number;
  error?: string;
  stats?: {
    total_vectors: number;
    text_chunks: number;
    table_chunks: number;
    storage_backend?: string;
  };
}

interface DeleteReport {
  doc_id: string;
  filename: string;
  pinecone_deleted: number;
  s3_deleted: boolean;
  local_deleted: boolean;
  mongo_docs: boolean;
  mongo_dashboard: number;
  errors: string[];
}

// ── Constants ────────────────────────────────────────────────────────────────

// CS exam levels — different from CA
const COURSES = ["CSEET", "Executive", "Professional", "Others"] as const;

const LEVEL_ICONS: Record<string, string> = {
  CSEET:        "🌱",
  Executive:    "⚖️",
  Professional: "🏛️",
  Others:       "📁",
};

const STORAGE_BADGE: Record<string, { label: string; cls: string }> = {
  s3:             { label: "☁ S3",    cls: "storage-s3"    },
  local:          { label: "💾 Local", cls: "storage-local" },
  local_fallback: { label: "⚠ Local", cls: "storage-warn"  },
};

// ── Toast ────────────────────────────────────────────────────────────────────

const Toast: React.FC<{ msg: string; type: "success" | "error"; onClose: () => void }> = ({ msg, type, onClose }) => (
  <div style={{
    position: "fixed", top: "24px", right: "24px", zIndex: 9999,
    display: "flex", alignItems: "center", gap: "12px", padding: "14px 20px",
    borderRadius: "12px", background: type === "success" ? "#0a3d30" : "#3d0a0a",
    border: `1px solid ${type === "success" ? "#1a7a50" : "#7a2020"}`,
    color: "#fff", fontFamily: "inherit", fontSize: "14px", fontWeight: 500,
    boxShadow: "0 8px 32px rgba(0,0,0,0.4)", maxWidth: "420px",
  }}>
    <span style={{ fontSize: "20px" }}>{type === "success" ? "✅" : "❌"}</span>
    <span style={{ flex: 1 }}>{msg}</span>
    <button onClick={onClose} style={{ background: "none", border: "none", color: "rgba(255,255,255,0.7)", cursor: "pointer", fontSize: "16px", padding: "0 0 0 8px" }}>✕</button>
  </div>
);

// ── Component ─────────────────────────────────────────────────────────────────

const AdminUpload: React.FC = () => {
  const [files,          setFiles]          = useState<File[]>([]);
  const [course,        setCourse]       = useState<string>("CSEET");
  const [subject,        setSubject]        = useState("");
  const [module,         setModule]         = useState("");
  const [chapter,        setChapter]        = useState("");
  const [unit,           setUnit]           = useState("");
  const [section,        setSection]        = useState("");
  const [customHeading,  setCustomHeading]  = useState("");
  const [loading,        setLoading]        = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress[]>([]);
  const [dragOver,       setDragOver]       = useState(false);
  const [toast,          setToast]          = useState<{ msg: string; type: "success" | "error" } | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);
  const showToast = (msg: string, type: "success" | "error" = "success") => {
    setToast({ msg, type }); setTimeout(() => setToast(null), 3500);
  };

  const [groupedDocs,  setGroupedDocs]  = useState<Record<string, Doc[]>>({});
  const [docsLoading,  setDocsLoading]  = useState(true);
  const [expanded,     setExpanded]     = useState<Record<string, boolean>>({});
  const [searchDocs,   setSearchDocs]   = useState("");
  const [viewMode,     setViewMode]     = useState<"tree" | "flat">("tree");
  const [deleteTarget, setDeleteTarget] = useState<Doc | null>(null);
  const [deleteLoading,setDeleteLoading]= useState(false);
  const [deleteReport, setDeleteReport] = useState<DeleteReport | null>(null);

  useEffect(() => { fetchGrouped(); }, []);

  const fetchGrouped = async () => {
    setDocsLoading(true);
    try {
      const res = await api.get("/admin/documents/grouped");
      setGroupedDocs(res.data);
      const init: Record<string, boolean> = {};
      Object.keys(res.data).forEach((k) => (init[k] = true));
      setExpanded(init);
    } catch { console.error("Failed to fetch grouped docs"); }
    finally { setDocsLoading(false); }
  };

  const toggleExpand = (key: string) => setExpanded((p) => ({ ...p, [key]: !p[key] }));

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    const dropped = Array.from(e.dataTransfer.files).filter((f) => f.type === "application/pdf");
    if (dropped.length) setFiles((prev) => [...prev, ...dropped]);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const sel = Array.from(e.target.files).filter((f) => f.type === "application/pdf");
      setFiles((prev) => [...prev, ...sel]);
    }
  };

  const removeFile    = (i: number) => setFiles((p) => p.filter((_, idx) => idx !== i));
  const clearAllFiles = () => { setFiles([]); if (fileRef.current) fileRef.current.value = ""; };

  const handleUpload = async () => {
    if (files.length === 0) { alert("Please select at least one PDF file."); return; }
    setLoading(true);
    const initialProgress: UploadProgress[] = files.map((f) => ({ filename: f.name, status: "pending", progress: 0 }));
    setUploadProgress(initialProgress);

    let successCount = 0, errorCount = 0;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      setUploadProgress((prev) => prev.map((p, idx) => idx === i ? { ...p, status: "uploading", progress: 50 } : p));
      const fd = new FormData();
      fd.append("file", file); fd.append("course", course); fd.append("subject", subject);
      fd.append("module", module); fd.append("chapter", chapter); fd.append("unit", unit);
      fd.append("section", section); fd.append("custom_heading", customHeading);
      try {
        const res = await api.post("/admin/materials/upload_enhanced", fd);
        setUploadProgress((prev) => prev.map((p, idx) => idx === i ? { ...p, status: "success", progress: 100, stats: res.data.statistics } : p));
        successCount++;
      } catch (err: any) {
        setUploadProgress((prev) => prev.map((p, idx) => idx === i ? { ...p, status: "error", progress: 100, error: err.response?.data?.detail || "Upload failed" } : p));
        errorCount++;
      }
    }
    setLoading(false);
    if (successCount > 0 && errorCount === 0) {
      const label = successCount === 1 ? "1 file uploaded" : `${successCount} files uploaded`;
      showToast(`✔ ${label} successfully!`, "success");
      setTimeout(() => { setFiles([]); setUploadProgress([]); if (fileRef.current) fileRef.current.value = ""; }, 1500);
    } else if (successCount > 0) {
      showToast(`⚠ ${successCount} file(s) uploaded, ${errorCount} failed.`, "error");
    } else {
      showToast(`Upload failed for all ${errorCount} file(s).`, "error");
    }
    fetchGrouped();
  };

  const confirmDelete  = (doc: Doc) => { setDeleteTarget(doc); setDeleteReport(null); };
  const closeDeleteModal = () => { setDeleteTarget(null); setDeleteReport(null); };
  const executeDelete = async () => {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    try {
      const res = await api.delete(`/admin/materials/${deleteTarget._id}`);
      setDeleteReport(res.data.report as DeleteReport);
      fetchGrouped();
    } catch (err: any) { alert(err.response?.data?.detail || "Delete failed."); }
    finally { setDeleteLoading(false); }
  };

  const totalDocs = Object.values(groupedDocs).reduce((a, d) => a + d.length, 0);
  const s3Count   = Object.values(groupedDocs).flat().filter((d) => d.storage_backend === "s3").length;

  const filteredGroups = Object.entries(groupedDocs).filter(([key, docs]) => {
    if (!searchDocs.trim()) return true;
    const q = searchDocs.toLowerCase();
    return key.toLowerCase().includes(q) || docs.some((d) => d.filename.toLowerCase().includes(q) || d.chapter?.toLowerCase().includes(q) || d.subject?.toLowerCase().includes(q));
  });

  const buildSubjectTree = (docs: Doc[]) => {
    const tree: Record<string, Record<string, Doc[]>> = {};
    docs.forEach((doc) => {
      const subj = doc.subject || "General";
      const chap = doc.chapter || doc.filename.replace(".pdf", "");
      (tree[subj] = tree[subj] || {})[chap] = (tree[subj][chap] = tree[subj][chap] || []);
      tree[subj][chap].push(doc);
    });
    return tree;
  };

  const DocItem = ({ doc }: { doc: Doc }) => {
    const sb    = doc.storage_backend || "local";
    const badge = STORAGE_BADGE[sb] || STORAGE_BADGE.local;
    return (
      <div className="doc-item">
        <div className="doc-item-left">
          <span className="doc-item-icon">📄</span>
          <div className="doc-item-info">
            <span className="doc-item-name">{doc.filename}</span>
            <div className="doc-item-meta">
              {doc.subject        && <span className="doc-meta-tag">📋 {doc.subject}</span>}
              {doc.chapter        && <span className="doc-meta-tag">📑 {doc.chapter}</span>}
              {doc.unit           && <span className="doc-meta-tag">📎 {doc.unit}</span>}
              {doc.total_vectors != null && <span className="doc-meta-tag doc-meta-vectors">🧠 {doc.total_vectors} vectors</span>}
              <span className={`doc-meta-tag doc-storage-badge ${badge.cls}`}>{badge.label}</span>
            </div>
          </div>
        </div>
        <div className="doc-item-right">
          {doc.pdf_url && (
            <a href={doc.pdf_url} target="_blank" rel="noreferrer" className="doc-view-btn" title="View PDF">👁</a>
          )}
          <span className="doc-item-date">
            {new Date(doc.uploaded_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
          </span>
          <button className="doc-delete-btn" onClick={() => confirmDelete(doc)} title="Delete">🗑</button>
        </div>
      </div>
    );
  };

  return (
    <div className="admin-upload-page">

      {toast && <Toast msg={toast.msg} type={toast.type} onClose={() => setToast(null)} />}

      {/* Delete Modal */}
      {deleteTarget && (
        <div className="delete-modal-overlay" onClick={closeDeleteModal}>
          <div className="delete-modal" onClick={(e) => e.stopPropagation()}>
            <div className="delete-modal-header">
              <span className="delete-modal-icon">🗑</span>
              <h3>Delete Document</h3>
              <button className="delete-modal-close" onClick={closeDeleteModal}>✕</button>
            </div>
            {!deleteReport ? (
              <>
                <div className="delete-modal-body">
                  <p>You are about to permanently delete:</p>
                  <div className="delete-modal-filename">📄 {deleteTarget.filename}</div>
                  <div className="delete-modal-warning">⚠️ This will remove the file from <strong>all three</strong> systems:</div>
                  <ul className="delete-modal-list">
                    <li><span className="delete-check">☁</span><span><strong>AWS S3</strong> — the PDF file itself</span></li>
                    <li><span className="delete-check">🧠</span><strong>Pinecone</strong> — all {deleteTarget.total_vectors ?? "?"} embedding vectors</li>
                    <li><span className="delete-check">🗄</span><strong>MongoDB</strong> — document record + Study Hub entries</li>
                  </ul>
                  <p className="delete-modal-irreversible">This action cannot be undone.</p>
                </div>
                <div className="delete-modal-actions">
                  <button className="delete-cancel-btn" onClick={closeDeleteModal} disabled={deleteLoading}>Cancel</button>
                  <button className="delete-confirm-btn" onClick={executeDelete} disabled={deleteLoading}>
                    {deleteLoading ? <><span className="auth-spinner" /> Deleting…</> : "Delete Permanently"}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="delete-modal-body">
                  <div className="delete-report-title">
                    {deleteReport.errors.length === 0 ? "✅ Deletion complete" : "⚠️ Deletion completed with warnings"}
                  </div>
                  <div className="delete-report-grid">
                    <div className={`delete-report-item ${deleteReport.pinecone_deleted > 0 ? "report-ok" : "report-warn"}`}>
                      <span className="report-icon">🧠</span>
                      <div><div className="report-label">Pinecone Vectors</div><div className="report-value">{deleteReport.pinecone_deleted} deleted</div></div>
                    </div>
                    <div className={`delete-report-item ${deleteReport.s3_deleted || deleteReport.local_deleted ? "report-ok" : "report-warn"}`}>
                      <span className="report-icon">☁</span>
                      <div><div className="report-label">File Storage</div><div className="report-value">{deleteReport.s3_deleted ? "Removed from S3" : deleteReport.local_deleted ? "Removed locally" : "Not found"}</div></div>
                    </div>
                    <div className={`delete-report-item ${deleteReport.mongo_docs ? "report-ok" : "report-error"}`}>
                      <span className="report-icon">🗄</span>
                      <div><div className="report-label">MongoDB Documents</div><div className="report-value">{deleteReport.mongo_docs ? "Record removed" : "Not found"}</div></div>
                    </div>
                    <div className={`delete-report-item ${deleteReport.mongo_dashboard > 0 ? "report-ok" : "report-warn"}`}>
                      <span className="report-icon">📚</span>
                      <div><div className="report-label">Study Hub Entries</div><div className="report-value">{deleteReport.mongo_dashboard} removed</div></div>
                    </div>
                  </div>
                  {deleteReport.errors.length > 0 && (
                    <div style={{ background: "var(--error-bg)", border: "1.5px solid #fecaca", borderRadius: "var(--radius-sm)", padding: "10px 12px" }}>
                      {deleteReport.errors.map((e, i) => <div key={i} style={{ fontSize: "0.78rem", color: "#7f1d1d" }}>• {e}</div>)}
                    </div>
                  )}
                </div>
                <div className="delete-modal-actions">
                  <button className="delete-cancel-btn" onClick={closeDeleteModal}>Close</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Page Header */}
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-title">Upload Study Materials</h1>
          <p className="admin-page-subtitle">
            Add PDFs to the CS knowledge base — indexed for AI search and visible in Study Hub instantly.
          </p>
        </div>
        <div className="admin-header-stats">
          <div className="admin-header-stat">
            <span className="admin-header-stat-num">{totalDocs}</span>
            <span className="admin-header-stat-label">Total PDFs</span>
          </div>
          <div className="admin-header-stat">
            <span className="admin-header-stat-num">{s3Count}</span>
            <span className="admin-header-stat-label">On S3</span>
          </div>
          <div className="admin-header-stat">
            <span className="admin-header-stat-num">{Object.keys(groupedDocs).length}</span>
            <span className="admin-header-stat-label">Levels</span>
          </div>
        </div>
      </div>

      {/* Upload Section */}
      <div className="upload-section-grid">

        {/* Drop zone */}
        <div className="upload-card">
          <div className="upload-card-title">
            <span className="upload-card-icon">📤</span>
            Select PDF Files
            {files.length > 0 && <button className="clear-files-btn" onClick={clearAllFiles}>Clear all</button>}
          </div>
          <div
            className={`drop-zone${dragOver ? " drop-zone-over" : ""}`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleFileDrop}
            onClick={() => fileRef.current?.click()}
          >
            <input ref={fileRef} type="file" accept=".pdf" multiple style={{ display: "none" }} onChange={handleFileSelect} />
            {files.length === 0 ? (
              <div className="drop-zone-placeholder">
                <span className="drop-zone-icon">📂</span>
                <span className="drop-zone-text">Drag &amp; drop PDFs here, or click to browse</span>
                <span className="drop-zone-hint">Multiple files supported</span>
              </div>
            ) : (
              <div className="file-list">
                {files.map((f, i) => (
                  <div key={i} className="file-item">
                    <span className="file-item-icon">📄</span>
                    <span className="file-item-name">{f.name}</span>
                    <span className="file-item-size">{(f.size / 1024).toFixed(0)} KB</span>
                    <button className="file-item-remove" onClick={(e) => { e.stopPropagation(); removeFile(i); }}>✕</button>
                  </div>
                ))}
                <div className="drop-zone-add-more" onClick={() => fileRef.current?.click()}>+ Add more PDFs</div>
              </div>
            )}
          </div>
          <div className="storage-info-banner">
            <span className="storage-info-icon">☁</span>
            <span>PDFs will be stored on <strong>AWS S3</strong> (if configured) and indexed in Pinecone for AI search.</span>
          </div>
        </div>

        {/* Metadata form */}
        <div className="upload-card">
          <div className="upload-card-title">
            <span className="upload-card-icon">🏷️</span>
            Metadata
          </div>

          {/* CS Level tabs */}
          <div className="course-tab-group" role="group" aria-label="Select CS level">
            {COURSES.map((c) => (
              <button key={c} type="button"
                className={`course-tab${course === c ? " course-tab-active" : ""}`}
                onClick={() => setCourse(c)}>
                {LEVEL_ICONS[c] || "📁"} {c}
              </button>
            ))}
          </div>

          <div className="upload-fields">
            <div className="upload-fields-row">
              <div className="upload-field">
                <label className="upload-label">Subject <span className="upload-label-req">*</span><span className="upload-label-opt"> — for tree grouping</span></label>
                <input className="upload-input" placeholder="e.g. Company Law, Governance, IBC"
                  value={subject} onChange={(e) => setSubject(e.target.value)} />
              </div>
              <div className="upload-field">
                <label className="upload-label">Module <span className="upload-label-opt">(optional)</span></label>
                <input className="upload-input" placeholder="e.g. Module 1, Paper 2"
                  value={module} onChange={(e) => setModule(e.target.value)} />
              </div>
            </div>
            <div className="upload-fields-row">
              <div className="upload-field">
                <label className="upload-label">Chapter <span className="upload-label-opt">(uses filename if blank)</span></label>
                <input className="upload-input" placeholder="e.g. Chapter 5: Board Meetings"
                  value={chapter} onChange={(e) => setChapter(e.target.value)} />
              </div>
              <div className="upload-field">
                <label className="upload-label">Unit <span className="upload-label-opt">(optional)</span></label>
                <input className="upload-input" placeholder="e.g. Unit 1 – Overview"
                  value={unit} onChange={(e) => setUnit(e.target.value)} />
              </div>
            </div>
            <div className="upload-field">
              <label className="upload-label">Section / Extra Tag <span className="upload-label-opt">(optional)</span></label>
              <input className="upload-input" placeholder="e.g. SS-1 – Secretarial Standard on Board Meetings"
                value={section} onChange={(e) => setSection(e.target.value)} />
            </div>
          </div>

          {uploadProgress.length > 0 && (
            <div className="upload-progress-section">
              <div className="upload-progress-title">Upload Progress</div>
              {uploadProgress.map((p, i) => (
                <div key={i} className="upload-progress-item">
                  <div className="upload-progress-header">
                    <span className="upload-progress-filename">
                      {p.status === "pending"   && "⏳"}
                      {p.status === "uploading" && "⏫"}
                      {p.status === "success"   && "✅"}
                      {p.status === "error"     && "❌"}
                      {" "}{p.filename}
                    </span>
                    {p.stats && (
                      <span className="upload-progress-stats">
                        {p.stats.total_vectors} vectors{p.stats.storage_backend === "s3" && " · ☁ S3"}
                      </span>
                    )}
                  </div>
                  {p.error && <div className="upload-progress-error">{p.error}</div>}
                  {p.stats && <div className="upload-progress-details">Text: {p.stats.text_chunks} · Tables: {p.stats.table_chunks}</div>}
                </div>
              ))}
            </div>
          )}

          <button className="upload-submit-btn" onClick={handleUpload} disabled={loading || files.length === 0}>
            {loading
              ? <><span className="auth-spinner" /> Uploading {files.length} file{files.length > 1 ? "s" : ""}…</>
              : `Upload ${files.length > 0 ? files.length : ""} PDF${files.length > 1 ? "s" : ""} →`}
          </button>
        </div>
      </div>

      {/* Uploaded Documents */}
      <div className="docs-section">
        <div className="docs-section-header">
          <h2 className="docs-section-title">
            <span>📚</span> Uploaded Materials
            <span className="docs-total-badge">{totalDocs}</span>
          </h2>
          <div className="docs-controls">
            <div className="view-toggle">
              <button className={`view-toggle-btn${viewMode === "tree" ? " view-toggle-active" : ""}`} onClick={() => setViewMode("tree")}>🌳 Tree</button>
              <button className={`view-toggle-btn${viewMode === "flat" ? " view-toggle-active" : ""}`} onClick={() => setViewMode("flat")}>📋 List</button>
            </div>
            <div className="docs-search-wrap">
              <span className="docs-search-icon">🔍</span>
              <input className="docs-search-input" placeholder="Search by name, subject, chapter…"
                value={searchDocs} onChange={(e) => setSearchDocs(e.target.value)} />
            </div>
          </div>
        </div>

        {docsLoading ? (
          <div className="app-full-center" style={{ padding: "40px 0" }}>
            <div className="loader" /><span className="loader-text">Loading documents…</span>
          </div>
        ) : filteredGroups.length === 0 ? (
          <div className="admin-empty-state">
            <span>📭</span>
            <p>{searchDocs ? "No documents match your search." : "No materials uploaded yet."}</p>
          </div>
        ) : viewMode === "tree" ? (
          <div className="docs-accordion">
            {filteredGroups.map(([levelKey, docs]) => {
              const filteredDocs = searchDocs
                ? docs.filter((d) => d.filename.toLowerCase().includes(searchDocs.toLowerCase()) || d.chapter?.toLowerCase().includes(searchDocs.toLowerCase()) || d.subject?.toLowerCase().includes(searchDocs.toLowerCase()))
                : docs;
              if (filteredDocs.length === 0) return null;
              const subjectTree = buildSubjectTree(filteredDocs);
              const lvlKey = `lvl-${levelKey}`;
              return (
                <div key={levelKey} className="docs-group docs-group-level">
                  <button className="docs-group-header docs-level-header" onClick={() => toggleExpand(lvlKey)}>
                    <div className="docs-group-left">
                      <span className="docs-group-arrow">{expanded[lvlKey] !== false ? "▾" : "▸"}</span>
                      <span className="docs-level-icon">{LEVEL_ICONS[levelKey] || "📁"}</span>
                      <span className="docs-group-name">{levelKey}</span>
                    </div>
                    <span className="docs-group-badge">{filteredDocs.length} files</span>
                  </button>
                  {expanded[lvlKey] !== false && (
                    <div className="docs-level-body">
                      {Object.entries(subjectTree).map(([subj, chapters]) => {
                        const subjKey = `subj-${levelKey}-${subj}`;
                        return (
                          <div key={subj} className="docs-subject-block">
                            <button className="docs-subject-header" onClick={() => toggleExpand(subjKey)}>
                              <span className="docs-group-arrow">{expanded[subjKey] !== false ? "▾" : "▸"}</span>
                              <span className="docs-subject-icon">📋</span>
                              <span className="docs-subject-name">{subj}</span>
                              <span className="docs-subject-count">{Object.values(chapters).flat().length} files</span>
                            </button>
                            {expanded[subjKey] !== false && (
                              <div className="docs-chapters-list">
                                {Object.entries(chapters).map(([chap, chapDocs]) => {
                                  const chapKey = `chap-${levelKey}-${subj}-${chap}`;
                                  return (
                                    <div key={chap} className="docs-chapter-block">
                                      <button className="docs-chapter-header" onClick={() => toggleExpand(chapKey)}>
                                        <span className="docs-group-arrow">{expanded[chapKey] !== false ? "▾" : "▸"}</span>
                                        <span className="chapter-dot-sm" />
                                        <span className="docs-chapter-name">{chap}</span>
                                        <span className="docs-chapter-count">{chapDocs.length}</span>
                                      </button>
                                      {expanded[chapKey] !== false && (
                                        <div className="docs-group-items">
                                          {chapDocs.map((doc) => <DocItem key={doc._id} doc={doc} />)}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="docs-accordion">
            {filteredGroups.map(([key, docs]) => {
              const filteredDocs = searchDocs
                ? docs.filter((d) => d.filename.toLowerCase().includes(searchDocs.toLowerCase()) || d.chapter?.toLowerCase().includes(searchDocs.toLowerCase()))
                : docs;
              if (filteredDocs.length === 0) return null;
              return (
                <div key={key} className="docs-group">
                  <button className="docs-group-header" onClick={() => toggleExpand(key)}>
                    <div className="docs-group-left">
                      <span className="docs-group-arrow">{expanded[key] ? "▾" : "▸"}</span>
                      <span className="docs-level-icon">{LEVEL_ICONS[key] || "📁"}</span>
                      <span className="docs-group-name">{key}</span>
                    </div>
                    <span className="docs-group-badge">{filteredDocs.length} files</span>
                  </button>
                  {expanded[key] && (
                    <div className="docs-group-items">
                      {filteredDocs.map((doc) => <DocItem key={doc._id} doc={doc} />)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminUpload;
