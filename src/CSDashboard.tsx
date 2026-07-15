import React, { useEffect, useState, useRef, useCallback, useMemo } from "react";
import api from "./api";
import "./App.css";

/* ============================================================
   NAVIGATION ARCHITECTURE (per CS_Architecture.docx)
   ------------------------------------------------------------
   CSEET        : Level -> Subject (tab)              -> Chapter Index -> Resources
   Executive    : Level -> Module (tab) -> Subject (tab)              -> Chapter Index -> Resources
   Professional : Level -> Module (tab) -> Mandatory/Elective (split) -> Subject (tab) -> Chapter Index -> Resources
   Others       : Level -> Subject (tab)              -> Chapter Index -> Resources

   The backend tree shape is unchanged: tree[level][subject][module][chapter] = PDFItem[]
   "module" defaults to "General" for CSEET/Others (levels that don't use modules,
   so we merge all of a subject's modules together for those levels).
   "group" ("Mandatory" | "Elective") lives on each PDFItem and is only surfaced
   for Professional-level subjects.
============================================================ */

type Level = "CSEET" | "Executive" | "Professional" | "Others";
type Group = "Mandatory" | "Elective";

const MODULE_LEVELS: Level[] = ["Executive", "Professional"];
const GROUP_LEVELS: Level[]  = ["Professional"];

const isModuleLevel = (lvl: Level) => MODULE_LEVELS.includes(lvl);
const isGroupLevel  = (lvl: Level) => GROUP_LEVELS.includes(lvl);

const VIDEO_API_BASE = (import.meta as any).env?.VITE_VIDEO_API_URL ?? "http://127.0.0.1:8081";
const POLL_INTERVAL_MS = 20000;
const POLL_TIMEOUT_MS  = 15 * 60 * 1000;

const LEVEL_META: Record<Level, { icon: string; desc: string; color: string }> = {
  CSEET:        { icon: "🌱", desc: "Core concepts & Company Law basics", color: "#0a7248" },
  Executive:    { icon: "⚖️", desc: "Corporate Governance & Securities Law", color: "#a05b0a" },
  Professional: { icon: "🏛️", desc: "Advanced Law & Practice",              color: "#0f3d38" },
  Others:       { icon: "📁", desc: "Reference & supplementary",            color: "#5b21b6" },
};

const MODULE_ICONS = ["🧩", "📦", "🗂️", "📚", "🧭", "🔖"];

interface PDFItem {
  _id: string;
  title: string;
  pdf_url: string;
  chapter?: string;
  unit?: string;
  module?: string;
  group?: Group;
  video_url?: string;
  audio_url?: string;
  simplified_pdf_url?: string;
  video_created_at?: string;
  status?: "pending" | "processing" | "completed" | "failed";
}

type ViewerType = "pdf" | "video" | "audio" | "smart_pdf";

interface Viewer {
  type: ViewerType;
  item: PDFItem;
}

interface VideoJob {
  jobId: string;
  dashboardId: string;
  startedAt: number;
  status: "polling" | "completed" | "failed" | "timeout";
  message?: string;
}

interface SmartUpload {
  status: "idle" | "uploading" | "success" | "error";
  message?: string;
}

interface Toast {
  id: number;
  message: string;
  type: "info" | "error" | "success";
}

interface CurrentUser {
  email: string;
  role: string;
  plan?: string;
  cs_level?: string;
}

// Chapter map: chapterName -> PDFItem[]
type ChapterMap = Record<string, PDFItem[]>;
// Subject map: subject -> module -> chapter -> items
type SubjectMap = Record<string, Record<string, ChapterMap>>;

function isMobileDevice(): boolean {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent
  ) || window.innerWidth <= 768;
}

function getNum(s: string): number {
  const m = s.match(/\d+/);
  return m ? parseInt(m[0]) : 999;
}

function sortKeys(keys: string[]): string[] {
  return [...keys].sort((a, b) => {
    const diff = getNum(a) - getNum(b);
    return diff !== 0 ? diff : a.localeCompare(b);
  });
}

// ============================================================
// TREE HELPERS  (level -> subject -> module -> chapter -> items[])
// ============================================================

function getModulesForLevel(levelTree: SubjectMap | undefined): string[] {
  const mods = new Set<string>();
  Object.values(levelTree || {}).forEach((subjObj) =>
    Object.keys(subjObj || {}).forEach((m) => mods.add(m))
  );
  return sortKeys([...mods]);
}

function getSubjectsForModule(levelTree: SubjectMap | undefined, module: string | null): string[] {
  const subjects = Object.keys(levelTree || {}).filter((subj) =>
    module ? !!levelTree![subj][module] : true
  );
  return sortKeys(subjects);
}

function getSubjectChapters(
  levelTree: SubjectMap | undefined,
  subject: string,
  module: string | null
): ChapterMap {
  const subjObj = levelTree?.[subject] || {};
  if (module) return subjObj[module] || {};
  // Levels without modules (CSEET / Others) — merge every module's chapters together
  const merged: ChapterMap = {};
  Object.values(subjObj).forEach((modObj) => {
    Object.entries(modObj).forEach(([ch, items]) => {
      merged[ch] = [...(merged[ch] || []), ...items];
    });
  });
  return merged;
}

function countItemsInChapters(chapters: ChapterMap): number {
  return Object.values(chapters).reduce((sum, items) => sum + items.length, 0);
}

function countItemsInSubject(levelTree: SubjectMap | undefined, subject: string, module: string | null): number {
  return countItemsInChapters(getSubjectChapters(levelTree, subject, module));
}

function countItemsInModule(levelTree: SubjectMap | undefined, module: string): number {
  let count = 0;
  Object.keys(levelTree || {}).forEach((subj) => {
    count += countItemsInChapters(getSubjectChapters(levelTree, subj, module));
  });
  return count;
}

function countItemsInLevel(levelTree: SubjectMap | undefined): number {
  let count = 0;
  Object.values(levelTree || {}).forEach((subjObj) =>
    Object.values(subjObj || {}).forEach((chapters) => {
      count += countItemsInChapters(chapters);
    })
  );
  return count;
}

function getSubjectGroup(levelTree: SubjectMap | undefined, subject: string, module: string | null): Group {
  const chapters = getSubjectChapters(levelTree, subject, module);
  let mandatory = 0, elective = 0;
  Object.values(chapters).forEach((items) =>
    items.forEach((it) => (it.group === "Elective" ? elective++ : mandatory++))
  );
  return elective > mandatory ? "Elective" : "Mandatory";
}

// ============================================================
// PDF BLOB HOOK
// ============================================================

function usePdfBlobUrl(url: string | undefined): { blobUrl: string | null; loading: boolean; error: string | null } {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  useEffect(() => {
    if (!url) { setBlobUrl(null); return; }
    let revoked = false;
    setLoading(true); setError(null); setBlobUrl(null);
    (async () => {
      try {
        const res = await api.get("/dashboard/pdf-proxy", { params: { url }, responseType: "blob" });
        if (revoked) return;
        const blob   = new Blob([res.data], { type: "application/pdf" });
        const objUrl = URL.createObjectURL(blob);
        setBlobUrl(objUrl);
      } catch (err: any) {
        if (!revoked) setError(err?.message ?? "Failed to load PDF");
      } finally {
        if (!revoked) setLoading(false);
      }
    })();
    return () => {
      revoked = true;
      setBlobUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return null; });
    };
  }, [url]);

  return { blobUrl, loading, error };
}

// ============================================================
// PDF VIEWER COMPONENT  (mobile-aware)
// ============================================================

interface PdfViewerProps { url: string; title: string; className?: string; hideDownload?: boolean; }

const PdfViewer: React.FC<PdfViewerProps> = ({ url, title, className = "multimedia-frame pdf-frame", hideDownload = false }) => {
  const { blobUrl, loading, error } = usePdfBlobUrl(url);
  const [isMobile]                  = useState(() => isMobileDevice());

  if (loading) return (
    <div className="pdf-loading-state">
      <div className="loader" />
      <span className="loader-text">Loading PDF…</span>
    </div>
  );

  if (error) return (
    <div className="pdf-error-state">
      <span>⚠️ Could not load PDF: {error}</span>
    </div>
  );

  if (!blobUrl) return null;

  if (isMobile) {
    const googleDocsUrl = `https://docs.google.com/gview?embedded=true&url=${encodeURIComponent(url)}`;
    return (
      <div className="pdf-mobile-wrapper">
        <iframe
          src={googleDocsUrl}
          title={title}
          className={className}
          allowFullScreen
          style={{ width: "100%", height: "100%", border: "none", background: "#fff" }}
        />
        {!hideDownload && (
          <div className="pdf-mobile-bar">
            <a href={blobUrl} download={`${title.replace(/[^a-z0-9]/gi, "_")}.pdf`} className="pdf-mobile-btn pdf-mobile-download">
              ⬇ Download PDF
            </a>
            <a href={blobUrl} target="_blank" rel="noopener noreferrer" className="pdf-mobile-btn pdf-mobile-open">
              ↗ Open in Browser
            </a>
          </div>
        )}
        {hideDownload && (
          <div className="pdf-mobile-bar">
            <span className="pdf-mobile-btn pdf-mobile-open pdf-mobile-open-full" style={{ cursor: "default", opacity: 0.85 }}>
              🧠 Smart PDF — download disabled
            </span>
          </div>
        )}
      </div>
    );
  }

  // Desktop: use the browser's built-in PDF viewer. Appending #toolbar=0 hides
  // the native toolbar (which is what exposes the download/print icons) when
  // downloads should be disabled, e.g. for Smart PDFs.
  const desktopSrc = hideDownload ? `${blobUrl}#toolbar=0&navpanes=0` : blobUrl;

  return <iframe src={desktopSrc} title={title} className={className} allowFullScreen />;
};

// ============================================================
// TOAST COMPONENT
// ============================================================

interface ToastContainerProps {
  toasts: Toast[];
  onDismiss: (id: number) => void;
}

const ToastContainer: React.FC<ToastContainerProps> = ({ toasts, onDismiss }) => {
  if (toasts.length === 0) return null;
  return (
    <div className="toast-container">
      {toasts.map((t) => (
        <div key={t.id} className={`toast-item toast-${t.type}`}>
          <span className="toast-msg">{t.message}</span>
          <button className="toast-close" onClick={() => onDismiss(t.id)}>✕</button>
        </div>
      ))}
    </div>
  );
};

// ============================================================
// BREADCRUMB COMPONENT
// ============================================================

interface CrumbStep { label: string; onClick: () => void; active?: boolean; }

const Breadcrumb: React.FC<{ steps: CrumbStep[]; accent: string }> = ({ steps, accent }) => (
  <div className="cs-breadcrumb" style={{
    display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6,
    padding: "10px 14px", background: "rgba(0,0,0,0.03)", borderRadius: 10,
    marginBottom: 18, fontSize: 14,
  }}>
    {steps.map((s, i) => (
      <React.Fragment key={i}>
        {i > 0 && <span style={{ opacity: 0.4 }}>›</span>}
        <button
          onClick={s.onClick}
          disabled={s.active}
          style={{
            background: "none", border: "none", cursor: s.active ? "default" : "pointer",
            padding: "3px 6px", borderRadius: 6,
            color: s.active ? accent : "inherit",
            fontWeight: s.active ? 700 : 500,
            opacity: s.active ? 1 : 0.75,
            textDecoration: s.active ? "none" : "underline",
            textUnderlineOffset: 3,
          }}
        >
          {s.label}
        </button>
      </React.Fragment>
    ))}
  </div>
);

// ============================================================
// MAIN COMPONENT
// ============================================================

const CSDashboard: React.FC = () => {
  // ── Navigation state (drill-down: Level -> Module -> Subject -> Chapter) ──
  const [selectedLevel,   setSelectedLevel]   = useState<Level | null>(null);
  const [selectedModule,  setSelectedModule]  = useState<string | null>(null);
  const [selectedSubject, setSelectedSubject] = useState<string | null>(null);
  const [selectedChapter, setSelectedChapter] = useState<string | null>(null);

  const [tree,        setTree]        = useState<Record<string, SubjectMap>>({});
  const [viewer,      setViewer]      = useState<Viewer | null>(null);
  const [treeLoading, setTreeLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [isAdmin,     setIsAdmin]     = useState(false);
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [videoJobs,   setVideoJobs]   = useState<Record<string, VideoJob>>({});
  const [smartUploads, setSmartUploads] = useState<Record<string, SmartUpload>>({});
  const smartPdfRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // ── Toast state ──────────────────────────────────────────
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastCounter = useRef(0);

  const showToast = useCallback((message: string, type: Toast["type"] = "info", duration = 4000) => {
    const id = ++toastCounter.current;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, duration);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const videoJobsRef = useRef<Record<string, VideoJob>>({});
  videoJobsRef.current = videoJobs;
  const pollTimers = useRef<Record<string, ReturnType<typeof setInterval>>>({});

  useEffect(() => {
    return () => { Object.values(pollTimers.current).forEach(clearInterval); };
  }, []);

  useEffect(() => {
    checkAdminStatus();
    loadDashboardTree();
  }, []);

  // ── Determine which levels a user can see ─────────────────
  const getAllowedLevels = useCallback((): Level[] => {
    if (isAdmin) return ["CSEET", "Executive", "Professional", "Others"];
    const userLevel = currentUser?.cs_level as Level | undefined;
    if (!userLevel) return ["CSEET", "Executive", "Professional", "Others"];
    const allowed: Level[] = userLevel === "Others" ? ["Others"] : [userLevel, "Others"];
    return allowed;
  }, [isAdmin, currentUser]);

  const checkAdminStatus = async () => {
    try {
      const res = await api.get("/auth/me");
      const user: CurrentUser = res.data;
      setCurrentUser(user);
      setIsAdmin(user.role === "admin");
    } catch {
      setIsAdmin(false);
    }
  };

  const loadDashboardTree = () => {
    api.get("/dashboard/tree")
      .then((res) => setTree(res.data))
      .catch((err) => console.error(err))
      .finally(() => setTreeLoading(false));
  };

  const patchTreeItem = useCallback((dashboardId: string, patch: Partial<PDFItem>) => {
    setTree((prev: any) => {
      const next = JSON.parse(JSON.stringify(prev));
      for (const level in next)
        for (const subject in next[level])
          for (const mod in next[level][subject])
            for (const chapter in next[level][subject][mod]) {
              const items: PDFItem[] = next[level][subject][mod][chapter];
              const idx = items.findIndex((it) => it._id === dashboardId);
              if (idx !== -1) { items[idx] = { ...items[idx], ...patch }; return next; }
            }
      return prev;
    });
    setViewer((v) => v && v.item._id === dashboardId ? { ...v, item: { ...v.item, ...patch } } : v);
  }, []);

  const startPolling = useCallback((dashboardId: string, jobId: string) => {
    if (pollTimers.current[dashboardId]) clearInterval(pollTimers.current[dashboardId]);
    const startedAt = Date.now();
    const timer = setInterval(async () => {
      if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
        clearInterval(pollTimers.current[dashboardId]);
        delete pollTimers.current[dashboardId];
        setVideoJobs((prev) => ({ ...prev, [dashboardId]: { ...prev[dashboardId], status: "timeout", message: "Timed out after 15 min." } }));
        patchTreeItem(dashboardId, { status: "failed" });
        return;
      }
      try {
        const res  = await api.get(`/dashboard/item/${dashboardId}`);
        const item: PDFItem = res.data;
        if (item.video_url && (item.status === "completed" || !item.status)) {
          clearInterval(pollTimers.current[dashboardId]);
          delete pollTimers.current[dashboardId];
          patchTreeItem(dashboardId, {
            video_url:          item.video_url,
            audio_url:          item.audio_url,
            simplified_pdf_url: item.simplified_pdf_url,
            status:             "completed",
            video_created_at:   item.video_created_at,
          });
          setVideoJobs((prev) => ({ ...prev, [dashboardId]: { ...prev[dashboardId], status: "completed", message: "Video ready!" } }));
        } else if (item.status === "failed") {
          clearInterval(pollTimers.current[dashboardId]);
          delete pollTimers.current[dashboardId];
          setVideoJobs((prev) => ({ ...prev, [dashboardId]: { ...prev[dashboardId], status: "failed", message: "Video generation failed." } }));
          patchTreeItem(dashboardId, { status: "failed" });
        }
      } catch (err) { console.warn("[poll] Error:", err); }
    }, POLL_INTERVAL_MS);
    pollTimers.current[dashboardId] = timer;
  }, [patchTreeItem]);

  // ── Create Video (guarded by Smart PDF check) ─────────────
  const handleCreateVideo = async (item: PDFItem) => {
    const dashboardId = item._id;
    if (!item.simplified_pdf_url) {
      showToast("⚠️ Please upload a Smart PDF first before creating a video.", "error", 5000);
      return;
    }
    if (videoJobs[dashboardId]?.status === "polling") return;
    patchTreeItem(dashboardId, { status: "processing" });
    setVideoJobs((prev) => ({ ...prev, [dashboardId]: { jobId: "", dashboardId, startedAt: Date.now(), status: "polling", message: "Submitting job…" } }));
    try {
      const res = await fetch(`${VIDEO_API_BASE}/api/process`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pdf_s3_url: item.pdf_url, dashboard_id: dashboardId, platform: "cs", use_gemini: true, use_openai: true }),
      });
      if (!res.ok) throw new Error(`Video API returned ${res.status}`);
      const data = await res.json();
      setVideoJobs((prev) => ({ ...prev, [dashboardId]: { jobId: data.job_id, dashboardId, startedAt: Date.now(), status: "polling", message: data.message || "Processing…" } }));
      startPolling(dashboardId, data.job_id);
    } catch (err: any) {
      setVideoJobs((prev) => ({ ...prev, [dashboardId]: { ...(prev[dashboardId] ?? { jobId: "", dashboardId, startedAt: Date.now() }), status: "failed", message: err?.message ?? "Submission failed." } }));
      patchTreeItem(dashboardId, { status: "failed" });
      setTimeout(() => {
        setVideoJobs((prev) => { const next = { ...prev }; delete next[dashboardId]; return next; });
        patchTreeItem(dashboardId, { status: undefined });
      }, 5000);
    }
  };

  // ── Smart PDF Upload ───────────────────────────────────────
  const handleSmartPdfSelect = async (
    e: React.ChangeEvent<HTMLInputElement>,
    item: PDFItem,
  ) => {
    const file = e.target.files?.[0];
    if (e.target) e.target.value = "";
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      alert("Only PDF files are accepted for Smart PDF upload.");
      return;
    }
    const id = item._id;
    setSmartUploads((prev) => ({ ...prev, [id]: { status: "uploading", message: "Uploading…" } }));
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await api.post(
        `/admin/materials/${id}/upload_smart_pdf`,
        fd,
        { headers: { "Content-Type": "multipart/form-data" } },
      );
      const { simplified_pdf_url } = res.data as { simplified_pdf_url: string };
      patchTreeItem(id, { simplified_pdf_url });
      setSmartUploads((prev) => ({ ...prev, [id]: { status: "success", message: "Smart PDF saved!" } }));
      setTimeout(() => {
        setSmartUploads((prev) => ({ ...prev, [id]: { status: "idle" } }));
      }, 4000);
    } catch (err: any) {
      const detail = err?.response?.data?.detail ?? "Upload failed. Please try again.";
      setSmartUploads((prev) => ({ ...prev, [id]: { status: "error", message: detail } }));
      setTimeout(() => {
        setSmartUploads((prev) => ({ ...prev, [id]: { status: "idle" } }));
      }, 4000);
    }
  };

  const handleDownloadAudio = async (item: PDFItem) => {
    if (!item.audio_url) return;
    try {
      const res    = await api.get("/dashboard/audio-proxy", { params: { url: item.audio_url }, responseType: "blob" });
      const blob   = new Blob([res.data], { type: "audio/mpeg" });
      const objUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href     = objUrl;
      anchor.download = item.title.replace(/[^a-z0-9]/gi, "_").toLowerCase() + "_audio.mp3";
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(objUrl);
    } catch { alert("Could not download audio. Please try again."); }
  };

  // ── Navigation resets ──────────────────────────────────────
  const goToAllLevels = () => {
    setSelectedLevel(null); setSelectedModule(null);
    setSelectedSubject(null); setSelectedChapter(null); setSearchQuery("");
  };
  const goToLevel = () => {
    setSelectedModule(null); setSelectedSubject(null);
    setSelectedChapter(null); setSearchQuery("");
  };
  const goToModule = () => {
    setSelectedSubject(null); setSelectedChapter(null); setSearchQuery("");
  };
  const goToSubject = () => setSelectedChapter(null);

  const openViewer  = (item: PDFItem, type: ViewerType = "pdf") => setViewer({ type, item });
  const closeViewer = () => setViewer(null);

  // ── Levels visible to this user ───────────────────────────
  const allowedLevels = getAllowedLevels();
  const levelTree      = selectedLevel ? tree[selectedLevel] : undefined;
  const moduleLevel     = selectedLevel ? isModuleLevel(selectedLevel) : false;
  const groupLevel      = selectedLevel ? isGroupLevel(selectedLevel) : false;
  const activeModule    = moduleLevel ? selectedModule : null;

  const accentColor = selectedLevel ? LEVEL_META[selectedLevel].color : "#0a7248";

  // ============================================================
  // VIDEO BUTTON
  // ============================================================

  const renderVideoButton = (item: PDFItem) => {
    const dashboardId = item._id;
    const job         = videoJobs[dashboardId];
    const hasVideo    = !!item.video_url || job?.status === "completed";

    if (hasVideo) return (
      <>
        <button className="resource-action-btn resource-action-video" onClick={() => openViewer(item, "video")} title="Watch video lecture">▶ Watch Video</button>
        {isAdmin && (
          <button className="resource-action-btn resource-action-recreate-video" onClick={() => handleCreateVideo(item)} title="Regenerate video (Admin)">🔄 Recreate</button>
        )}
      </>
    );

    if (job?.status === "polling" || item.status === "processing") return (
      <button className="resource-action-btn resource-action-create-video loading" disabled title={job?.message ?? "Generating…"}>
        <span className="spinner-mini" />{job?.message ?? "Processing…"}
      </button>
    );

    if (job?.status === "failed" || job?.status === "timeout") return (
      <button className="resource-action-btn resource-action-create-video" onClick={() => handleCreateVideo(item)} title="Retry">⚠ Retry Video</button>
    );

    if (isAdmin && !item.video_url) return (
      <button
        className="resource-action-btn resource-action-create-video"
        onClick={() => handleCreateVideo(item)}
        title={item.simplified_pdf_url ? "Generate AI video (Admin)" : "Upload Smart PDF first to create video"}
      >
        🤖 Create Video
      </button>
    );

    return null;
  };

  // ============================================================
  // SMART PDF UPLOAD BUTTON
  // ============================================================
  const renderSmartPdfUploadButton = (item: PDFItem) => {
    if (!isAdmin) return null;

    const id  = item._id;
    const job = smartUploads[id] ?? { status: "idle" };

    const label =
      job.status === "uploading" ? "⏫ Uploading…"        :
      job.status === "success"   ? "✅ Saved!"             :
      job.status === "error"     ? "❌ Retry"              :
      item.simplified_pdf_url    ? "🧠 Replace Smart PDF" :
                                   "🧠 Upload Smart PDF";

    const titleText =
      job.status === "uploading" ? "Uploading Smart PDF to S3…"                      :
      job.status === "error"     ? (job.message ?? "Upload failed — click to retry") :
      item.simplified_pdf_url    ? "Smart PDF exists — click to replace"             :
                                   "Upload a simplified PDF for students (Admin only)";

    return (
      <>
        <input
          ref={(el) => { smartPdfRefs.current[id] = el; }}
          type="file"
          accept=".pdf,application/pdf"
          style={{ display: "none" }}
          onChange={(e) => handleSmartPdfSelect(e, item)}
        />
        <button
          className="resource-action-btn resource-action-smart-pdf-upload"
          disabled={job.status === "uploading"}
          title={titleText}
          onClick={() => smartPdfRefs.current[id]?.click()}
          style={{
            opacity:    job.status === "uploading" ? 0.65 : 1,
            cursor:     job.status === "uploading" ? "not-allowed" : "pointer",
            background:
              job.status === "success" ? "rgba(16,185,129,0.15)" :
              job.status === "error"   ? "rgba(239,68,68,0.12)"  :
              item.simplified_pdf_url  ? "rgba(16,185,129,0.08)" :
                                         "rgba(139,92,246,0.12)",
            borderColor:
              job.status === "success" ? "rgba(16,185,129,0.5)"  :
              job.status === "error"   ? "rgba(239,68,68,0.5)"   :
              item.simplified_pdf_url  ? "rgba(16,185,129,0.35)" :
                                         "rgba(139,92,246,0.4)",
            color:
              job.status === "success" ? "#10b981" :
              job.status === "error"   ? "#ef4444"  :
              item.simplified_pdf_url  ? "#10b981"  :
                                         "#a78bfa",
          }}
        >
          {label}
        </button>
      </>
    );
  };

  // ============================================================
  // RESOURCE ITEM (single PDF/chapter resource card)
  // ============================================================
  const renderResourceItem = (item: PDFItem) => (
    <div key={item._id} className="resource-item">
      {item.unit && <div className="resource-unit-label">📎 {item.unit}</div>}

      <button className="pdf-btn" onClick={() => openViewer(item, "pdf")} title={`Open: ${item.title}`}>
        <span className="pdf-btn-icon">📄</span>
        <span className="pdf-btn-text">{item.title}</span>
      </button>

      <div className="resource-actions">
        <button className="resource-action-btn resource-action-read" onClick={() => openViewer(item, "pdf")} title="Read PDF">
          📖 Read
        </button>

        {item.simplified_pdf_url && (
          <button className="resource-action-btn resource-action-smart-pdf" onClick={() => openViewer(item, "smart_pdf")} title="AI-enhanced Smart PDF">
            🧠 Smart PDF
          </button>
        )}

        {renderVideoButton(item)}

        {item.audio_url && (
          <button className="resource-action-btn resource-action-audio" onClick={() => openViewer(item, "audio")} title="Listen">
            🎵 Audio
          </button>
        )}

        <button className="resource-action-btn resource-action-chat" onClick={() => (window as any).goChat?.()} title="Ask AI about this topic">
          💬 Ask AI
        </button>

        {renderSmartPdfUploadButton(item)}
      </div>

      {smartUploads[item._id]?.status === "uploading" && (
        <div className="video-job-status" style={{ color: "#a78bfa" }}>
          <span className="spinner-mini" />
          <span>Uploading Smart PDF…</span>
        </div>
      )}
      {smartUploads[item._id]?.status === "error" && (
        <div className="video-job-status" style={{ color: "#ef4444" }}>
          ⚠ {smartUploads[item._id].message}
        </div>
      )}

      {videoJobs[item._id]?.status === "polling" && (
        <div className="video-job-status">
          <span className="spinner-mini" />
          <span>{videoJobs[item._id].message ?? "Generating video…"}</span>
          <span className="video-job-elapsed">
            {Math.floor((Date.now() - videoJobs[item._id].startedAt) / 1000)}s
          </span>
        </div>
      )}
    </div>
  );

  // ============================================================
  // SCREEN 1 — LEVEL GRID
  // ============================================================
  const renderLevelGrid = () => (
    <div className="level-selector-section">
      {isAdmin ? (
        <p className="level-selector-hint">Admin view — select any level to manage its content</p>
      ) : (
        <p className="level-selector-hint">
          {currentUser?.cs_level
            ? `Showing content for your level: ${currentUser.cs_level}`
            : "Select your CS exam level to begin"}
        </p>
      )}

      {treeLoading ? (
        <div className="app-full-center" style={{ marginTop: 60 }}>
          <div className="loader" />
          <span className="loader-text">Loading study materials…</span>
        </div>
      ) : (
        <div className="level-cards-grid">
          {(["CSEET", "Executive", "Professional", "Others"] as Level[]).map((lvl) => {
            if (!allowedLevels.includes(lvl)) return null;
            const meta        = LEVEL_META[lvl];
            const lvlTree      = tree[lvl];
            const subjectCount = lvlTree ? Object.keys(lvlTree).length : 0;
            const pdfCount     = countItemsInLevel(lvlTree);
            const isUserLevel  = !isAdmin && currentUser?.cs_level === lvl;

            return (
              <button
                key={lvl}
                className={`level-card${isUserLevel ? " level-card-active" : ""}`}
                onClick={() => setSelectedLevel(lvl)}
                aria-label={`Select ${lvl} level`}
              >
                {isUserLevel && <span className="level-card-my-badge">My Level</span>}
                <span className="level-card-icon">{meta.icon}</span>
                <span className="level-card-name">{lvl}</span>
                <span className="level-card-desc">{meta.desc}</span>
                {subjectCount > 0 ? (
                  <div className="level-card-stats">
                    <span className="level-card-badge">{subjectCount} subjects</span>
                    <span className="level-card-badge level-card-badge-pdf">{pdfCount} PDFs</span>
                  </div>
                ) : (
                  <span className="level-card-empty">No content yet</span>
                )}
                <span className="level-card-arrow">→</span>
              </button>
            );
          })}
        </div>
      )}

      {!treeLoading && (
        <div className="dashboard-stats">
          {(["CSEET", "Executive", "Professional", "Others"] as Level[]).map((lvl) => {
            if (!allowedLevels.includes(lvl)) return null;
            const pdfCount = countItemsInLevel(tree[lvl]);
            if (!pdfCount) return null;
            return (
              <div className="dash-stat" key={lvl}>
                <span className="dash-stat-num">{pdfCount}</span>
                <span className="dash-stat-label">{lvl} PDFs</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  // ============================================================
  // SCREEN 2 — MODULE GRID  (Executive / Professional only)
  // ============================================================
  const renderModuleGrid = () => {
    if (!selectedLevel) return null;
    const modules = getModulesForLevel(levelTree);
    return (
      <div className="premium-tree">
        <div className="subject-card">
          <div className="subject-card-header">
            <h3>Select a Module</h3>
            <span className="subject-module-count">{modules.length} modules</span>
          </div>
          <div className="level-cards-grid">
            {modules.map((mod, i) => {
              const subjCount = getSubjectsForModule(levelTree, mod).length;
              const pdfCount  = countItemsInModule(levelTree, mod);
              return (
                <button
                  key={mod}
                  className="level-card"
                  style={{ borderColor: `${accentColor}33` }}
                  onClick={() => setSelectedModule(mod)}
                >
                  <span className="level-card-icon">{MODULE_ICONS[i % MODULE_ICONS.length]}</span>
                  <span className="level-card-name">{mod}</span>
                  <span className="level-card-desc">Company Secretary — {selectedLevel}</span>
                  <div className="level-card-stats">
                    <span className="level-card-badge">{subjCount} subjects</span>
                    <span className="level-card-badge level-card-badge-pdf">{pdfCount} PDFs</span>
                  </div>
                  <span className="level-card-arrow">→</span>
                </button>
              );
            })}
            {modules.length === 0 && (
              <div className="cs-empty-state">
                <span className="cs-empty-icon">📭</span>
                <p>No modules available yet for <strong>{selectedLevel}</strong>.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  // ============================================================
  // SUBJECT CARD GRID (shared by CSEET/Others direct view and
  // Executive/Professional module-scoped view)
  // ============================================================
  const renderSubjectCards = (subjects: string[], module: string | null) => (
    <div className="level-cards-grid">
      {subjects.map((subj) => {
        const pdfCount    = countItemsInSubject(levelTree, subj, module);
        const chapterCount = Object.keys(getSubjectChapters(levelTree, subj, module)).length;
        return (
          <button
            key={subj}
            className="level-card"
            style={{ borderColor: `${accentColor}33` }}
            onClick={() => setSelectedSubject(subj)}
          >
            <span className="level-card-icon">📘</span>
            <span className="level-card-name">{subj}</span>
            <span className="level-card-desc">Subject-wise index</span>
            <div className="level-card-stats">
              <span className="level-card-badge">{chapterCount} chapters</span>
              <span className="level-card-badge level-card-badge-pdf">{pdfCount} PDFs</span>
            </div>
            <span className="level-card-arrow">→</span>
          </button>
        );
      })}
      {subjects.length === 0 && (
        <div className="cs-empty-state">
          <span className="cs-empty-icon">📭</span>
          <p>No subjects available yet.</p>
        </div>
      )}
    </div>
  );

  // ============================================================
  // SCREEN 3 — SUBJECT GRID (with Mandatory/Elective split for Professional)
  // ============================================================
  const renderSubjectGrid = () => {
    const allSubjects = getSubjectsForModule(levelTree, activeModule);

    if (!groupLevel) {
      return (
        <div className="premium-tree">
          <div className="subject-card">
            <div className="subject-card-header">
              <h3>Select a Subject</h3>
              <span className="subject-module-count">{allSubjects.length} subjects</span>
            </div>
            {renderSubjectCards(allSubjects, activeModule)}
          </div>
        </div>
      );
    }

    // Professional: split Index into Mandatory / Elective
    const mandatory = allSubjects.filter((s) => getSubjectGroup(levelTree, s, activeModule) === "Mandatory");
    const elective   = allSubjects.filter((s) => getSubjectGroup(levelTree, s, activeModule) === "Elective");

    return (
      <div className="premium-tree">
        <div className="subject-card">
          <div className="subject-card-header">
            <h3>🔒 Mandatory Subjects</h3>
            <span className="subject-module-count">{mandatory.length} subjects</span>
          </div>
          {renderSubjectCards(mandatory, activeModule)}
        </div>

        <div className="subject-card">
          <div className="subject-card-header">
            <h3>🌿 Elective Subjects</h3>
            <span className="subject-module-count">{elective.length} subjects</span>
          </div>
          {renderSubjectCards(elective, activeModule)}
        </div>
      </div>
    );
  };

  // ============================================================
  // SCREEN 4 — CHAPTER INDEX + DETAIL  (subject drilled in)
  // ============================================================
  const renderSubjectDetail = () => {
    if (!selectedSubject) return null;
    const chapters    = getSubjectChapters(levelTree, selectedSubject, activeModule);
    const chapterKeys = sortKeys(Object.keys(chapters));

    const q = searchQuery.trim().toLowerCase();
    const filteredKeys = q
      ? chapterKeys.filter((ch) =>
          ch.toLowerCase().includes(q) ||
          chapters[ch].some((it) => it.title?.toLowerCase().includes(q) || it.unit?.toLowerCase().includes(q))
        )
      : chapterKeys;

    const activeChapter = selectedChapter && chapters[selectedChapter] ? selectedChapter : null;

    return (
      <div className="cs-subject-detail">
        {/* CHAPTER INDEX (left) */}
        <div className="subject-card cs-subject-index">
          <div className="subject-card-header">
            <h3>Index</h3>
            <span className="subject-module-count">{filteredKeys.length} ch.</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, padding: "4px 0" }}>
            {filteredKeys.map((ch) => {
              const active = ch === activeChapter;
              return (
                <button
                  key={ch}
                  onClick={() => setSelectedChapter(ch)}
                  className="module-toggle"
                  style={{
                    background: active ? accentColor : undefined,
                    color:      active ? "#fff" : undefined,
                    textAlign:  "left",
                  }}
                >
                  <span className="module-toggle-text">
                    <span className="module-toggle-arrow">{active ? "▾" : "▸"}</span>
                    {ch}
                  </span>
                  <span className="module-toggle-count">{chapters[ch].length}</span>
                </button>
              );
            })}
            {filteredKeys.length === 0 && (
              <div className="cs-empty-state" style={{ padding: 20 }}>
                <span className="cs-empty-icon">🔍</span>
                <p>No chapters match your search.</p>
              </div>
            )}
          </div>
        </div>

        {/* CHAPTER DETAIL (right) */}
        <div className="subject-card">
          {!activeChapter ? (
            <div className="cs-empty-state">
              <span className="cs-empty-icon">👈</span>
              <p>Select a chapter from the Index to view its resources.</p>
            </div>
          ) : (
            <>
              <div className="chapter-header">
                <span className="chapter-dot" />
                <h4>{activeChapter}</h4>
              </div>
              <div className="resource-list">
                {chapters[activeChapter].map((item) => renderResourceItem(item))}
              </div>
            </>
          )}
        </div>
      </div>
    );
  };

  // ============================================================
  // BREADCRUMB STEPS
  // ============================================================
  const breadcrumbSteps = useMemo((): CrumbStep[] => {
    const steps: CrumbStep[] = [{ label: "← All Levels", onClick: goToAllLevels }];
    if (selectedLevel) {
      steps.push({
        label: `${LEVEL_META[selectedLevel].icon} ${selectedLevel}`,
        onClick: goToLevel,
        active: !selectedModule && !selectedSubject,
      });
    }
    if (moduleLevel && selectedModule) {
      steps.push({ label: selectedModule, onClick: goToModule, active: !selectedSubject });
    }
    if (selectedSubject) {
      steps.push({ label: selectedSubject, onClick: goToSubject, active: !selectedChapter });
    }
    if (selectedChapter) {
      steps.push({ label: selectedChapter, onClick: () => {}, active: true });
    }
    return steps;
  }, [selectedLevel, selectedModule, selectedSubject, selectedChapter, moduleLevel]);

  // ============================================================
  // RENDER
  // ============================================================

  const showSearch = !!selectedSubject; // search only makes sense inside the chapter index

  return (
    <div className="cs-dashboard">
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />

      {/* HEADER */}
      <div className="cs-header">
        <div className="cs-header-inner">
          <div>
            <h1>CS Study Dashboard</h1>
            <p>Explore ICSI modules, subjects &amp; chapters — PDFs, Smart PDFs, video and audio lectures</p>
          </div>

          {!isAdmin && currentUser?.cs_level && (
            <div className="cs-user-level-badge" title={`You are enrolled in ${currentUser.cs_level}`}>
              <span className="cs-user-level-icon">
                {LEVEL_META[currentUser.cs_level as Level]?.icon ?? "🎓"}
              </span>
              <span className="cs-user-level-text">{currentUser.cs_level}</span>
            </div>
          )}

          {isAdmin && (
            <div className="cs-admin-badge" title="Admin — all levels visible">
              🔑 Admin View
            </div>
          )}

          {showSearch && (
            <div className="cs-search-wrap">
              <span className="cs-search-icon">🔍</span>
              <input
                className="cs-search-input"
                type="search"
                placeholder="Search chapters, units or topics…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          )}
        </div>
      </div>

      {/* BREADCRUMB (shown once a level is selected) */}
      {selectedLevel && <Breadcrumb steps={breadcrumbSteps} accent={accentColor} />}

      {/* SCREENS */}
      {!selectedLevel && renderLevelGrid()}

      {selectedLevel && moduleLevel && !selectedModule && renderModuleGrid()}

      {selectedLevel && (!moduleLevel || selectedModule) && !selectedSubject && renderSubjectGrid()}

      {selectedLevel && selectedSubject && renderSubjectDetail()}

      {/* VIEWER MODAL */}
      {viewer && (
        <div
          className="multimedia-modal"
          role="dialog"
          aria-modal="true"
          aria-label={viewer.item.title}
          onClick={(e) => { if (e.target === e.currentTarget) closeViewer(); }}
        >
          <div className="multimedia-container">
            <div className="multimedia-header">
              <div className="multimedia-header-info">
                <button className="multimedia-back-btn" onClick={closeViewer} aria-label="Go back">← Back</button>
                <span className="multimedia-header-icon">
                  {viewer.type === "pdf"       && "📄"}
                  {viewer.type === "smart_pdf" && "🧠"}
                  {viewer.type === "video"     && "🎬"}
                  {viewer.type === "audio"     && "🎵"}
                </span>
                <div>
                  <h3 className="multimedia-header-title">{viewer.item.title}</h3>
                  {viewer.item.chapter && <span className="multimedia-header-sub">{viewer.item.chapter}</span>}
                  {viewer.item.unit    && <span className="multimedia-header-unit">📎 {viewer.item.unit}</span>}
                </div>
              </div>

              <div className="multimedia-header-actions">
                {viewer.item.pdf_url && viewer.type !== "pdf" && (
                  <button className="resource-action-btn resource-action-read" onClick={() => setViewer((v) => v ? { ...v, type: "pdf" } : null)}>📖 Read PDF</button>
                )}
                {viewer.item.simplified_pdf_url && viewer.type !== "smart_pdf" && (
                  <button className="resource-action-btn resource-action-smart-pdf" onClick={() => setViewer((v) => v ? { ...v, type: "smart_pdf" } : null)}>🧠 Smart PDF</button>
                )}
                {viewer.item.video_url && viewer.type !== "video" && (
                  <button className="resource-action-btn resource-action-video" onClick={() => setViewer((v) => v ? { ...v, type: "video" } : null)}>🎬 Watch</button>
                )}
                {viewer.item.audio_url && viewer.type !== "audio" && (
                  <button className="resource-action-btn resource-action-audio" onClick={() => setViewer((v) => v ? { ...v, type: "audio" } : null)}>🎵 Audio</button>
                )}
                <button className="resource-action-btn resource-action-chat" onClick={() => { closeViewer(); (window as any).goChat?.(); }}>💬 Ask AI</button>
                <button className="multimedia-close-btn" onClick={closeViewer} aria-label="Close">✕</button>
              </div>
            </div>

            <div className="multimedia-content">
              {viewer.type === "pdf" && (
                <PdfViewer url={viewer.item.pdf_url} title={viewer.item.title} />
              )}

              {viewer.type === "smart_pdf" && viewer.item.simplified_pdf_url && (
                <PdfViewer
                  url={viewer.item.simplified_pdf_url}
                  title={`Smart PDF – ${viewer.item.title}`}
                  hideDownload
                />
              )}

              {viewer.type === "video" && viewer.item.video_url && (
                <video controls autoPlay className="multimedia-frame video-frame" controlsList="nodownload" key={viewer.item.video_url}>
                  <source src={viewer.item.video_url} type="video/mp4" />
                  Your browser does not support the video tag.
                </video>
              )}

              {viewer.type === "audio" && viewer.item.audio_url && (
                <div className="audio-player-container">
                  <audio controls autoPlay className="audio-player" controlsList="nodownload" key={viewer.item.audio_url}>
                    <source src={viewer.item.audio_url} type="audio/mpeg" />
                  </audio>
                  <div className="audio-player-info">
                    <h4>{viewer.item.title}</h4>
                    <p>Now listening to audio lecture</p>
                  </div>
                  <button className="resource-action-btn resource-action-audio" onClick={() => handleDownloadAudio(viewer.item)}>⬇ Download MP3</button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CSDashboard;
