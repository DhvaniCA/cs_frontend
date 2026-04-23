import React, { useEffect, useState } from "react";
import api from "./api";
import "./App.css";

type Student = {
  _id: string;
  name?: string;
  email?: string;
  phone?: string;
  cs_level?: string;      // ← CS levels: CSEET | Executive | Professional
  cs_attempt?: string;
  status?: string;
  plan?: string;
  subscription_status?: string;
  payment_id?: string;
  plan_activated_at?: string;
};

const LEVEL_COLOR: Record<string, { bg: string; color: string }> = {
  CSEET:   { bg: "var(--success-bg)",  color: "var(--success)"  },
  Executive:    { bg: "var(--warning-bg)",  color: "var(--warning)"  },
  Professional: { bg: "#eef2ff",            color: "#4338ca"          },
  default:      { bg: "var(--surface-2)",   color: "var(--text-muted)"},
};

function getLevelStyle(level?: string) {
  return LEVEL_COLOR[level ?? ""] ?? LEVEL_COLOR.default;
}

function getInitials(name?: string) {
  if (!name) return "?";
  return name.trim().split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
}

const AdminDashboard: React.FC = () => {
  const [students,      setStudents]      = useState<Student[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [search,        setSearch]        = useState("");
  const [filterLevel,   setFilterLevel]   = useState<string>("All");
  const [activeTab,     setActiveTab]     = useState<"pending" | "approved">("pending");
  const [toast,         setToast]         = useState<{ msg: string; type: "success" | "error" } | null>(null);

  const fetchStudents = async () => {
    try {
      const res = await api.get("/admin/students");
      setStudents(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchStudents(); }, []);

  const showToast = (msg: string, type: "success" | "error") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const approveStudent = async (id: string) => {
    setActionLoading(id);
    try {
      await api.post(`/admin/approve/${id}`);
      showToast("Student approved successfully!", "success");
      fetchStudents();
    } catch {
      showToast("Approval failed. Please try again.", "error");
    } finally {
      setActionLoading(null);
    }
  };

  // Filter using cs_level field
  const allLevels = ["All", ...Array.from(new Set(students.map((s) => s.cs_level).filter(Boolean) as string[]))];

  const applyFilters = (list: Student[]) => {
    let result = list;
    if (filterLevel !== "All") result = result.filter((s) => s.cs_level === filterLevel);
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (s) =>
          s.name?.toLowerCase().includes(q) ||
          s.email?.toLowerCase().includes(q) ||
          s.phone?.includes(q)
      );
    }
    return result;
  };

  const pending  = applyFilters(students.filter((s) => s.status === "pending"));
  const approved = applyFilters(students.filter((s) => s.status === "approved"));

  const totalPending  = students.filter((s) => s.status === "pending").length;
  const totalApproved = students.filter((s) => s.status === "approved").length;
  const totalPaid     = students.filter((s) => s.plan === "paid").length;
  const totalFree     = students.filter((s) => s.plan !== "paid").length;

  if (loading) {
    return (
      <div className="admin-loading">
        <div className="loader" />
        <p className="loader-text">Loading dashboard…</p>
      </div>
    );
  }

  const currentList = activeTab === "pending" ? pending : approved;

  return (
    <div className="adm-page">

      {/* Toast */}
      {toast && (
        <div className={`adm-toast adm-toast-${toast.type}`} role="alert">
          <span>{toast.type === "success" ? "✅" : "⚠"}</span>
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <div className="adm-header">
        <div className="adm-header-left">
          <h1 className="adm-title">Admin Control Centre</h1>
          <p className="adm-subtitle">Manage CS student registrations and platform access</p>
        </div>
        <button className="adm-refresh-btn" onClick={fetchStudents} title="Refresh">🔄 Refresh</button>
      </div>

      {/* Stats */}
      <div className="adm-stats">
        <div className="adm-stat-card adm-stat-total">
          <div className="adm-stat-icon">👥</div>
          <div className="adm-stat-body">
            <div className="adm-stat-num">{students.length}</div>
            <div className="adm-stat-label">Total Students</div>
          </div>
        </div>
        <div className="adm-stat-card adm-stat-pending">
          <div className="adm-stat-icon">⏳</div>
          <div className="adm-stat-body">
            <div className="adm-stat-num">{totalPending}</div>
            <div className="adm-stat-label">Awaiting Approval</div>
          </div>
          {totalPending > 0 && <div className="adm-stat-urgent-dot" />}
        </div>
        <div className="adm-stat-card adm-stat-approved">
          <div className="adm-stat-icon">✅</div>
          <div className="adm-stat-body">
            <div className="adm-stat-num">{totalApproved}</div>
            <div className="adm-stat-label">Approved Students</div>
          </div>
        </div>
        <div className="adm-stat-card adm-stat-rate">
          <div className="adm-stat-icon">📈</div>
          <div className="adm-stat-body">
            <div className="adm-stat-num">
              {students.length ? Math.round((totalApproved / students.length) * 100) : 0}%
            </div>
            <div className="adm-stat-label">Approval Rate</div>
          </div>
        </div>
        <div className="adm-stat-card" style={{ borderTop: "3px solid var(--accent)" }}>
          <div className="adm-stat-icon">✨</div>
          <div className="adm-stat-body">
            <div className="adm-stat-num" style={{ color: "var(--warning)" }}>{totalPaid}</div>
            <div className="adm-stat-label">Premium Students</div>
          </div>
        </div>
        <div className="adm-stat-card">
          <div className="adm-stat-icon">🆓</div>
          <div className="adm-stat-body">
            <div className="adm-stat-num">{totalFree}</div>
            <div className="adm-stat-label">Free Tier Students</div>
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="adm-controls">
        <div className="adm-search-wrap">
          <span className="adm-search-icon">🔍</span>
          <input
            className="adm-search-input"
            type="search"
            placeholder="Search by name, email or phone…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search students"
          />
          {search && (
            <button className="adm-search-clear" onClick={() => setSearch("")} aria-label="Clear search">✕</button>
          )}
        </div>
        <div className="adm-filter-pills" role="group" aria-label="Filter by CS level">
          {allLevels.map((lvl) => (
            <button
              key={lvl}
              className={`adm-filter-pill${filterLevel === lvl ? " adm-filter-pill-active" : ""}`}
              onClick={() => setFilterLevel(lvl)}
            >
              {lvl}
            </button>
          ))}
        </div>
      </div>

      {/* Tabs */}
      <div className="adm-tabs" role="tablist">
        <button role="tab" aria-selected={activeTab === "pending"}
          className={`adm-tab${activeTab === "pending" ? " adm-tab-active" : ""}`}
          onClick={() => setActiveTab("pending")}>
          Pending
          {totalPending > 0 && <span className="adm-tab-badge adm-tab-badge-pending">{totalPending}</span>}
        </button>
        <button role="tab" aria-selected={activeTab === "approved"}
          className={`adm-tab${activeTab === "approved" ? " adm-tab-active" : ""}`}
          onClick={() => setActiveTab("approved")}>
          Approved
          <span className="adm-tab-badge">{totalApproved}</span>
        </button>
      </div>

      {/* Student list */}
      <div role="tabpanel">
        {currentList.length === 0 ? (
          <div className="adm-empty">
            <span className="adm-empty-icon">
              {search || filterLevel !== "All" ? "🔍" : activeTab === "pending" ? "🎉" : "📭"}
            </span>
            <p className="adm-empty-title">
              {search || filterLevel !== "All"
                ? "No students match your filters"
                : activeTab === "pending"
                ? "No pending approvals"
                : "No approved students yet"}
            </p>
            <p className="adm-empty-sub">
              {search || filterLevel !== "All"
                ? "Try adjusting your search or filter"
                : activeTab === "pending"
                ? "All caught up! 🎊"
                : "Approved students will appear here"}
            </p>
          </div>
        ) : (
          <>
            <div className="adm-list-meta">
              Showing {currentList.length} student{currentList.length !== 1 ? "s" : ""}
              {(search || filterLevel !== "All") && (
                <button className="adm-clear-filters" onClick={() => { setSearch(""); setFilterLevel("All"); }}>
                  Clear filters
                </button>
              )}
            </div>

            <div className="adm-student-grid">
              {currentList.map((student) => {
                const lvlStyle   = getLevelStyle(student.cs_level);
                const isPending  = student.status === "pending";
                const isActioning = actionLoading === student._id;

                return (
                  <div key={student._id} className={`adm-student-card${!isPending ? " adm-student-card-approved" : ""}`}>
                    <div className="adm-card-strip" />
                    <div className="adm-card-body">
                      <div className="adm-card-top">
                        <div className="adm-avatar">{getInitials(student.name)}</div>
                        <div className="adm-card-identity">
                          <h3 className="adm-student-name">{student.name || "Unnamed Student"}</h3>
                          <p className="adm-student-email" title={student.email}>{student.email}</p>
                          {student.phone && <p className="adm-student-phone">📞 {student.phone}</p>}
                        </div>
                        <span
                          className="adm-status-badge"
                          style={isPending
                            ? { background: "var(--warning-bg)", color: "var(--warning)" }
                            : { background: "var(--success-bg)", color: "var(--success)" }
                          }
                        >
                          {isPending ? "Pending" : "Active"}
                        </span>
                      </div>

                      <div className="adm-card-details">
                        {/* CS level chip */}
                        <div className="adm-detail-chip" style={{ background: lvlStyle.bg, color: lvlStyle.color }}>
                          🎓 {student.cs_level || "—"}
                        </div>
                        <div className="adm-detail-chip">
                          🗓 {student.cs_attempt || "—"}
                        </div>
                        <div
                          className="adm-detail-chip"
                          style={
                            student.plan === "paid"
                              ? { background: "rgba(212,136,42,0.15)", color: "var(--warning)", border: "1px solid rgba(212,136,42,0.4)", fontWeight: 700 }
                              : { background: "var(--surface-2)", color: "var(--text-muted)" }
                          }
                        >
                          {student.plan === "paid" ? "✨ Premium" : "🆓 Free"}
                        </div>
                      </div>

                      {isPending ? (
                        <div className="adm-card-action">
                          <button
                            className="adm-approve-btn"
                            disabled={isActioning}
                            onClick={() => approveStudent(student._id)}
                          >
                            {isActioning ? <><span className="auth-spinner" /> Approving…</> : " ✓ Approve Student"}
                          </button>
                        </div>
                      ) : (
                        <div className="adm-card-action">
                          <div className="adm-approved-stamp">✅ Access Granted</div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default AdminDashboard;
