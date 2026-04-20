import React, { useEffect, useState } from "react";
import Auth from "./Auth";
import Chat from "./Chat";
import AdminDashboard from "./AdminDashboard";
import AdminUpload from "./AdminUpload";
import CSDashboard from "./CSDashboard";
import api from "./api";
import "./App.css";

type Role = "student" | "admin" | null;
type AdminView = "dashboard" | "upload" | "chat" | "study";
type StudentView = "study" | "chat";

type NavItem<V> = { view: V; label: string; icon: string; desc?: string };

const ADMIN_NAV: NavItem<AdminView>[] = [
  { view: "dashboard", icon: "📊", label: "Dashboard",    desc: "Students & approvals"  },
  { view: "upload",    icon: "📤", label: "Upload",        desc: "Add study materials"   },
  { view: "study",     icon: "🎬", label: "Study Hub",     desc: "Browse CS content"     },
  { view: "chat",      icon: "💬", label: "Chat",          desc: "Test the AI tutor"     },
];

const STUDENT_NAV: NavItem<StudentView>[] = [
  { view: "study", icon: "📚", label: "Study Hub",  desc: "ICSI modules & PDFs"    },
  { view: "chat",  icon: "🤖", label: "AI Tutor",   desc: "Ask CS / ICSI questions" },
];

const App: React.FC = () => {
  const [role,        setRole]        = useState<Role>(null);
  const [checking,    setChecking]    = useState(true);
  const [adminView,   setAdminView]   = useState<AdminView>("dashboard");
  const [studentView, setStudentView] = useState<StudentView>("study");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  (window as any).goChat = () => {
    if (role === "admin") setAdminView("chat");
    else                  setStudentView("chat");
    setSidebarOpen(false);
  };

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) { setChecking(false); return; }
    api.get("/auth/me")
      .then((res) => setRole(res.data.role))
      .catch(() => { localStorage.removeItem("token"); setRole(null); })
      .finally(() => setChecking(false));
  }, []);

  const handleLogout = () => {
    localStorage.removeItem("token");
    setRole(null);
  };

  /* Loading */
  if (checking) {
    return (
      <div className="app-splash">
        <div className="app-splash-inner">
          <div className="app-splash-logo">CS</div>
          <div className="loader" />
          <p className="loader-text">Loading your CS assistant…</p>
        </div>
      </div>
    );
  }

  /* Auth */
  if (!role) return <Auth onLoggedIn={setRole} />;

  const isAdmin    = role === "admin";
  const activeNav  = isAdmin ? ADMIN_NAV  : STUDENT_NAV;
  const activeView = isAdmin ? adminView  : studentView;
  const setView    = isAdmin
    ? (v: any) => { setAdminView(v);   setSidebarOpen(false); }
    : (v: any) => { setStudentView(v); setSidebarOpen(false); };

  const currentMeta = activeNav.find((n) => n.view === activeView)!;

  const renderContent = () => {
    if (isAdmin) {
      if (adminView === "dashboard") return <AdminDashboard />;
      if (adminView === "upload")    return <AdminUpload />;
      if (adminView === "study")     return <CSDashboard />;
      return <Chat />;
    }
    return studentView === "study" ? <CSDashboard /> : <Chat />;
  };

  return (
    <div className="app-root">

      {/* TOP HEADER */}
      <header className="app-header">
        <div className="app-header-brand">
          <button
            className="app-hamburger"
            onClick={() => setSidebarOpen((o) => !o)}
            aria-label="Toggle sidebar"
            aria-expanded={sidebarOpen}
          >
            <span /><span /><span />
          </button>
          <div className="app-logo-wrap">
            <div className="app-logo-icon">CS</div>
            <div className="app-logo-text-wrap">
              <span className="app-logo">CS Tutor</span>
              <span className="app-subtitle">AI-Powered ICSI Prep</span>
            </div>
          </div>
        </div>

        <div className="app-header-center">
          <span className="app-breadcrumb-page">
            {currentMeta.icon}&nbsp;{currentMeta.label}
          </span>
        </div>

        <div className="app-header-right">
          <div className={`app-role-badge${isAdmin ? " app-role-admin" : " app-role-student"}`}>
            <span className="app-role-dot" />
            <span className="app-role-text">{isAdmin ? "Admin" : "Student"}</span>
          </div>
          <button className="app-logout-btn" onClick={handleLogout}>
            <span className="app-logout-icon">↩</span>
            <span className="app-logout-label">Logout</span>
          </button>
        </div>
      </header>

      {/* BODY */}
      <div className="app-body">

        {sidebarOpen && (
          <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} aria-hidden="true" />
        )}

        <aside className={`app-sidebar${sidebarOpen ? " app-sidebar-open" : ""}`}>

          <div className="sidebar-top">
            <div className="sidebar-top-brand">
              <div className="sidebar-brand-logo">CS</div>
              <div>
                <div className="sidebar-brand-name">CS Tutor</div>
                <div className="sidebar-brand-role">
                  {isAdmin ? "Administrator" : "Student Portal"}
                </div>
              </div>
            </div>
            <button className="sidebar-close-btn" onClick={() => setSidebarOpen(false)} aria-label="Close sidebar">✕</button>
          </div>

          <nav className="sidebar-nav" aria-label="Main navigation">
            <div className="sidebar-nav-section-label">
              {isAdmin ? "Admin Menu" : "Navigation"}
            </div>
            {activeNav.map((item) => (
              <button
                key={item.view}
                className={`sidebar-nav-item${activeView === item.view ? " sidebar-nav-item-active" : ""}`}
                onClick={() => setView(item.view)}
                aria-current={activeView === item.view ? "page" : undefined}
              >
                <span className="sidebar-nav-icon">{item.icon}</span>
                <div className="sidebar-nav-info">
                  <span className="sidebar-nav-label-text">{item.label}</span>
                  {item.desc && <span className="sidebar-nav-desc">{item.desc}</span>}
                </div>
                {activeView === item.view && <span className="sidebar-nav-active-dot" />}
              </button>
            ))}
          </nav>

          <div className="sidebar-footer">
            <div className={`sidebar-role-chip${isAdmin ? " sidebar-role-admin" : " sidebar-role-student"}`}>
              <span className="sidebar-role-dot" />
              <span>Logged in as&nbsp;<strong>{isAdmin ? "Admin" : "Student"}</strong></span>
            </div>
            <button className="sidebar-logout-btn" onClick={handleLogout}>↩&nbsp;Sign out</button>
          </div>

        </aside>

        <main className="app-main" id="main-content">
          {renderContent()}
        </main>

      </div>
    </div>
  );
};

export default App;