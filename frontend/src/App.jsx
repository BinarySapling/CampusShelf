import { useCallback, useEffect, useId, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { api, formBody } from "./api.js";
import Scanner from "./Scanner.jsx";
import Chatbot from "./Chatbot.jsx";
import LibraryArt from "./LibraryArt.jsx";
import Preloader from "./Preloader.jsx";
import CopyLabels from "./CopyLabels.jsx";
import SearchPicker from "./SearchPicker.jsx";
import { bookingEndTimes, bookingMinutes, bookingStartTimes, campusDateTime } from "./bookingTime.js";
import CatalogueExplorer from "./CatalogueExplorer.jsx";
import { ActiveFilters, CheckboxGroup, RecordFilters, filterRows } from "./Filters.jsx";
import { AnimatePresence, LazyMotion, domAnimation, m, useReducedMotion } from "motion/react";
import { ArrowUpRight, Bell, BookOpen, CalendarDays, ChartNoAxesCombined, Check, CheckCheck, CircleAlert, CircleUserRound, ClipboardList, Clock3, LayoutDashboard, LibraryBig, MapPin, Menu, Plus, Receipt, Repeat2, RotateCw, Sparkles, Star, Users, X } from "lucide-react";

const librarianTabs = [
  ["overview", "Overview", "overview"],
  ["books", "Catalogue", "books"],
  ["add_book", "Add a title", "add_book"],
  ["space_bookings", "Space & Pods", "bookings"],
  ["renewals", "Renewals", "loans"],
  ["reports", "Reports", "overview"],
  ["requests", "Access requests", "requests"],
  ["students", "Students", "students"],
  ["loans", "Circulation", "loans"],
  ["transactions", "Activity", "loans"],
  ["fines", "Fines", "fines"],
  ["reviews", "Reader notes", "reviews"],
  ["account", "Account", "account"],
];

const studentTabs = [
  ["catalogue", "Discover", "books"],
  ["scan_copy", "Scan your copy", "loans"],
  ["space_bookings", "Room & Pods", "bookings"],
  ["my_loans", "My loans", "loans"],
  ["my_history", "History", "loans"],
  ["my_fines", "My fines", "fines"],
  ["account", "Account", "account"],
];

const noticeTimers = new WeakMap();
const navigationCloseTimers = new WeakMap();
function clearNavigationClose(menu) {
  const timer = navigationCloseTimers.get(menu);
  if (timer) window.clearTimeout(timer);
  navigationCloseTimers.delete(menu);
}
function scheduleNavigationClose(menu) {
  clearNavigationClose(menu);
  navigationCloseTimers.set(menu, window.setTimeout(() => {
    if (menu?.isConnected && !menu.matches(":hover") && !menu.contains(document.activeElement)) menu.open = false;
    navigationCloseTimers.delete(menu);
  }, 300));
}
function noticeText(setNotice, text, kind = "success") {
  window.clearTimeout(noticeTimers.get(setNotice));
  setNotice({ text, kind });
  if (kind === "error") {
    noticeTimers.delete(setNotice);
    return;
  }
  noticeTimers.set(setNotice, window.setTimeout(() => { setNotice(null); noticeTimers.delete(setNotice); }, 4500));
}

function StatCard({ label, value, note }) {
  return <article className="stat-card"><div className="stat-symbol"><ChartNoAxesCombined size={19} strokeWidth={1.7} aria-hidden="true" /></div><span>{label}</span><strong>{value ?? "—"}</strong><small>{note}</small></article>;
}

function BookRating({ rating = 0, count = 0 }) {
  const average = Number(rating) || 0;
  const label = count ? `${average.toFixed(1)} out of 5 from ${count} reader rating${count === 1 ? "" : "s"}` : "No reader ratings yet";
  return <span className="book-rating" role="img" aria-label={label}>
    <span className="book-rating-stars" aria-hidden="true">{[1, 2, 3, 4, 5].map((star) => <span key={star} className={star <= Math.round(average) ? "is-rated" : ""}>★</span>)}</span>
    <small>{count ? `${average.toFixed(1)} · ${count} ${count === 1 ? "rating" : "ratings"}` : "No ratings yet"}</small>
  </span>;
}

function PageTitle({ eyebrow, title, note, action }) {
  return <div className="page-title"><div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2>{note && <p>{note}</p>}</div>{action}</div>;
}

function LoadError({ message, onRetry }) {
  return <div className="route-load-error" role="group" aria-label="Page loading error">
    <div role="alert" aria-live="assertive"><strong>This page could not load.</strong><p>{message || "Check your connection and try again."}</p></div>
    <button className="button light small" type="button" onClick={onRetry}>Try again</button>
  </div>;
}

function LoadingState({ label }) {
  return <p className="route-loading" role="status" aria-live="polite">{label}</p>;
}

function useAccessibleDialog(open, dialogRef, onClose) {
  const onCloseRef = useRef(onClose);
  const openRef = useRef(open);
  onCloseRef.current = onClose;
  openRef.current = open;

  useEffect(() => {
    if (!open) return undefined;
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement;
    const focusableSelector = "a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex]:not([tabindex='-1'])";
    const getFocusable = () => [...(dialog?.querySelectorAll(focusableSelector) || [])].filter((element) => element.getClientRects().length);
    const focusable = getFocusable();
    (focusable[0] || dialog)?.focus({ preventScroll: true });

    function handleKeys(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current?.();
        return;
      }
      if (event.key !== "Tab") return;
      const current = getFocusable();
      if (!current.length) {
        event.preventDefault();
        dialog?.focus();
        return;
      }
      const first = current[0];
      const last = current[current.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialog?.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialog?.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeys);
    return () => {
      document.removeEventListener("keydown", handleKeys);
      if (previousFocus?.isConnected) window.requestAnimationFrame(() => {
        if (!openRef.current) previousFocus.focus?.();
      });
    };
  }, [open, dialogRef]);
}

function handleTabListKeyDown(event, keys, idPrefix, setActiveTab) {
  const currentIndex = keys.findIndex((key) => `${idPrefix}${key}` === event.currentTarget.id);
  if (currentIndex < 0) return;
  let nextIndex = currentIndex;
  if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % keys.length;
  else if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + keys.length) % keys.length;
  else if (event.key === "Home") nextIndex = 0;
  else if (event.key === "End") nextIndex = keys.length - 1;
  else return;
  event.preventDefault();
  setActiveTab(keys[nextIndex]);
  document.getElementById(`${idPrefix}${keys[nextIndex]}`)?.focus();
}

function NavIcon({ name }) {
  const icons = { overview: LayoutDashboard, books: LibraryBig, add_book: Plus, bookings: CalendarDays,
    requests: ClipboardList, students: Users, loans: Repeat2, fines: Receipt, reviews: Star, account: CircleUserRound };
  const Icon = icons[name] || BookOpen;
  return <Icon className="nav-icon" size={20} strokeWidth={1.7} aria-hidden="true" />;
}

function BookCover({ book, compact = false }) {
  const [failedUrl, setFailedUrl] = useState(null);
  const tone = (book.title?.charCodeAt(0) || 0) % 4;
  return <div className={`book-cover-visual tone-${tone} ${compact ? "compact" : ""}`} aria-hidden="true">
    <span>{book.category || "CampusShelf edition"}</span>
    <strong>{book.title}</strong>
    <small>{book.author}</small>
    <i />
    {book.cover_url && book.cover_url !== failedUrl && <img className="custom-book-cover" src={book.cover_url} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailedUrl(book.cover_url)} />}
  </div>;
}

function AuthScreen({ onLogin, onSetup, onSignup, setupAvailable }) {
  const [mode, setMode] = useState("login");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const values = Object.fromEntries(new FormData(event.currentTarget));
    try {
      if (mode === "signup") await onSignup(values);
      else if (mode === "setup") await onSetup(values);
      else await onLogin(values);
    } catch (problem) {
      setError(problem.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
    <a className="skip-link" href="#auth-main">Skip to sign in</a>
    <main className="auth-page" id="auth-main" tabIndex={-1} aria-labelledby="auth-heading">
      <section className="auth-card">
        <div className="auth-brand"><img src="/assets/campusshelf-logo.svg" alt="" /><div><b>CampusShelf</b><small>READ. CONNECT. DISCOVER.</small></div></div>
        <span className="eyebrow">YOUR NEXT CHAPTER STARTS HERE</span>
        <h1 id="auth-heading">{mode === "signup" ? "Create student account" : mode === "setup" ? "Set up the library desk" : "Welcome back"}</h1>
        <p className="muted">{mode === "signup" ? "Enter your campus details to create your library account immediately." : mode === "setup" ? "Create the first librarian account to get started." : "Sign in using your student ID, librarian ID, or email."}</p>
        {error && <div className="notice error" id="auth-error" role="alert" aria-live="assertive">{error}</div>}
        <form className="stack-form" onSubmit={submit} aria-busy={busy} aria-describedby={error ? "auth-error" : undefined}>
          {mode === "signup" && <>
            <label>Full name<input name="name" required maxLength="100" autoComplete="name" placeholder="e.g. Aarav Sharma" /></label>
            <label>Campus email<input name="email" type="email" required maxLength="160" autoComplete="email" placeholder="e.g. student@campus.edu" /></label>
            <label>Registration number<input name="registration_number" required maxLength="50" placeholder="e.g. REG-12345" /></label>
            <div className="two-fields"><label>Course<input name="course" required maxLength="60" placeholder="CSE" /></label><label>Year<select name="year" required defaultValue="1">{[1, 2, 3, 4, 5, 6].map((year) => <option key={year} value={year}>Year {year}</option>)}</select></label></div>
            <label>Password<input name="password" type="password" minLength="10" required autoComplete="new-password" /></label>
            <label>Confirm password<input name="confirm_password" type="password" minLength="10" required autoComplete="new-password" /></label>
          </>}
          {mode === "setup" && <>
            <label>Librarian name<input name="name" required maxLength="80" autoComplete="name" /></label>
            <label>Email (optional)<input name="email" type="email" maxLength="160" autoComplete="email" placeholder="librarian@campus.edu" /></label>
            <label>First setup code<input name="setup_code" type="password" autoComplete="one-time-code" /></label>
            <label>Password<input name="password" type="password" minLength="10" required autoComplete="new-password" /></label>
          </>}
          {mode === "login" && <>
            <label>Student ID, librarian ID, or email<input name="login_id" required autoComplete="username" placeholder="e.g. STU-..., LIB-..., or name@campus.edu" /></label>
            <label>Password<input name="password" type="password" required autoComplete="current-password" /></label>
          </>}
          <button className="button primary full" disabled={busy}>{busy ? "Please wait…" : mode === "signup" ? "Create student account" : mode === "setup" ? "Create librarian account" : "Sign in"}</button>
        </form>
        <div className="auth-links">
          {mode !== "login" && <button className="text-button" onClick={() => setMode("login")}>Back to sign in</button>}
          {mode === "login" && <>
            <button className="text-button" onClick={() => setMode("signup")}>New student? Create account</button>
            {setupAvailable && <button className="text-button muted-link" onClick={() => setMode("setup")}>First time? Set up librarian</button>}
          </>}
        </div>
        <div className="auth-note"><span>✓</span> Copy QR codes only identify a book. Your account is always needed to borrow.</div>
      </section>
      <aside className="auth-art"><div className="art-caption"><span className="edition-number">01 / THE CAMPUS COLLECTION</span><Sparkles size={20} aria-hidden="true" /></div><LibraryArt /><div><span className="eyebrow">A PLACE FOR THE NEXT CHAPTER</span><h2>A little curiosity. A whole new chapter.</h2><p>Your campus collection, ready when you are.</p></div></aside>
    </main>
    </>
  );
}

function DashboardDonut({ label, totalLabel, values, centerValue, onNavigate, loading }) {
  const total = values.reduce((sum, item) => sum + (Number(item.value) || 0), 0);
  const circumference = 2 * Math.PI * 58;
  let offset = 0;
  const segments = values.map((item) => {
    const value = Math.max(0, Number(item.value) || 0);
    const length = total ? circumference * value / total : 0;
    const segment = { ...item, value, length, offset };
    offset += length;
    return segment;
  });
  return <section className="panel dashboard-chart-card">
    <div className="panel-head"><div><span className="eyebrow">LIBRARY SNAPSHOT</span><h3>{label}</h3></div><span className="dashboard-chart-total">{total.toLocaleString()} {totalLabel}</span></div>
    <div className="dashboard-donut-layout" aria-busy={loading}>
      <div className="dashboard-donut-wrap">
        <svg className="dashboard-donut-svg" viewBox="0 0 160 160" role="img" aria-label={`${label}: ${segments.map((item) => `${item.label} ${item.value}`).join(", ")}`}>
          <circle cx="80" cy="80" r="58" fill="none" stroke="#edf0e9" strokeWidth="15" />
          {segments.filter((item) => item.length > 0).map((item) => <circle key={item.key} className="dashboard-donut-segment" cx="80" cy="80" r="58" fill="none" stroke={item.color} strokeWidth="15" strokeDasharray={`${item.length} ${circumference - item.length}`} strokeDashoffset={-item.offset} transform="rotate(-90 80 80)" />)}
        </svg>
        <div className="dashboard-donut-center"><strong>{loading ? "…" : Number(centerValue ?? total).toLocaleString()}</strong><span>{totalLabel} in view</span></div>
      </div>
      <div className="dashboard-chart-legend">
        {segments.map((item) => <button className="dashboard-legend-row" type="button" key={item.key} style={{ "--segment-color": item.color }} onClick={() => onNavigate(item.route)}>
          <i className="dashboard-legend-dot" aria-hidden="true" />
          <span className="dashboard-legend-copy"><b>{item.label}</b><small>{loading ? "—" : total ? `${Math.round(item.value / total * 100)}%` : "0%"}</small></span>
          <strong>{loading ? "—" : item.value.toLocaleString()}</strong>
        </button>)}
      </div>
    </div>
  </section>;
}

function Dashboard({ user, onNavigate }) {
  const [stats, setStats] = useState(null);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [reportError, setReportError] = useState("");
  const [updatedAt, setUpdatedAt] = useState(null);
  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    setReportError("");
    const [dashboardResult, reportResult] = await Promise.allSettled([api("/dashboard/"), api("/reports/")]);
    if (dashboardResult.status === "fulfilled") setStats(dashboardResult.value);
    else setLoadError(dashboardResult.reason?.message || "The library overview could not load.");
    if (reportResult.status === "fulfilled") setReport(reportResult.value);
    else setReportError(reportResult.reason?.message || "Activity charts could not load.");
    setUpdatedAt(new Date());
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);
  const greeting = new Date().getHours() < 12 ? "Good morning" : new Date().getHours() < 17 ? "Good afternoon" : "Good evening";
  const firstName = user?.name?.trim().split(/\s+/)[0] || "Librarian";
  const inventory = stats?.inventory || {};
  const loanHealth = stats?.loan_health || {};
  const circulation = report?.circulation || [];
  const maxMonth = Math.max(1, ...circulation.flatMap((item) => [item.issues, item.returns]));
  const recent = (report?.recent_transactions || []).slice(0, 5);
  const dueLabel = (item) => item.days_late > 0 ? `${item.days_late}d overdue` : `Due ${new Date(item.due_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`;
  return <div className="dashboard-page">
    <section className="dashboard-hero">
      <div className="dashboard-hero-art" aria-hidden="true">
        <img className="dashboard-hero-background" src="/assets/library-dashboard-scene.jpg" alt="" fetchPriority="high" />
        <div className="dashboard-hero-inset"><img src="/assets/study-space-pod.jpg" alt="" /><span>THE STUDY NOOK · ROOM TO THINK</span></div>
      </div>
      <div className="dashboard-hero-copy"><span className="eyebrow">THE LIBRARY DESK · {greeting.toUpperCase()}, {firstName.toUpperCase()}</span><h2>Make room for the next <em>great read.</em></h2><p>Keep the collection in balance, spot loans that need attention, and make every reader feel welcome.</p><div className="dashboard-hero-actions"><button className="button hero-action" onClick={() => onNavigate("loans")}>Open circulation <ArrowUpRight size={15} aria-hidden="true" /></button><button className="button dashboard-hero-secondary" onClick={() => onNavigate("add_book")}>Add a title <Plus size={14} aria-hidden="true" /></button></div></div>
    </section>
    <div className="dashboard-heading"><div><span className="eyebrow">TODAY AT THE LIBRARY</span><h2>Good books, accounted for.</h2></div><div className="dashboard-heading-actions"><span className="dashboard-updated"><i className={loading ? "is-loading" : ""} />{updatedAt ? `Updated ${updatedAt.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}` : "Live library data"}</span><button className="button light small dashboard-refresh" type="button" onClick={load} disabled={loading}><RotateCw size={14} className={loading ? "is-spinning" : ""} aria-hidden="true" />Refresh</button></div></div>
    {loadError && <LoadError message={loadError} onRetry={load} />}
    <div className="dashboard-kpi-grid" aria-busy={loading}>
      {[
        { label: "On loan", value: stats?.active_loans, note: "Copies currently with readers", route: "loans", icon: BookOpen, tone: "" },
        { label: "Overdue", value: stats?.overdue_loans, note: "Need a return follow-up", route: "loans", icon: CircleAlert, tone: "coral" },
        { label: "Due soon", value: stats?.due_soon_loans, note: "Due within the next 3 days", route: "loans", icon: Clock3, tone: "gold" },
        { label: "Access requests", value: stats?.pending_requests, note: "Waiting for librarian review", route: "requests", icon: Users, tone: "blue" },
      ].map(({ label, value, note, route, icon: Icon, tone }) => <button className={`dashboard-kpi ${tone}`} type="button" key={label} onClick={() => onNavigate(route)}>
        <span className="dashboard-kpi-icon"><Icon size={18} strokeWidth={1.8} aria-hidden="true" /></span><span className="dashboard-kpi-label">{label}</span><strong>{loading && !stats ? "…" : Number(value || 0).toLocaleString()}</strong><small className="dashboard-kpi-note">{note}</small><ArrowUpRight className="dashboard-kpi-arrow" size={15} aria-hidden="true" />
      </button>)}
    </div>
    <div className="dashboard-fact-strip" aria-label="Library at a glance">
      <button type="button" onClick={() => onNavigate("books")}><BookOpen size={17} aria-hidden="true" /><span><small>Catalogue titles</small><b>{stats ? Number(stats.books || 0).toLocaleString() : loading ? "…" : "0"}</b></span></button>
      <button type="button" onClick={() => onNavigate("books")}><LibraryBig size={17} aria-hidden="true" /><span><small>Physical copies</small><b>{stats ? Number(stats.copies || 0).toLocaleString() : loading ? "…" : "0"}</b></span></button>
      <button type="button" onClick={() => onNavigate("students")}><Users size={17} aria-hidden="true" /><span><small>Approved readers</small><b>{stats ? Number(stats.members || 0).toLocaleString() : loading ? "…" : "0"}</b></span></button>
      <button type="button" onClick={() => onNavigate("fines")}><span className="dashboard-rupee" aria-hidden="true">₹</span><span><small>Unpaid fine entries</small><b>{stats ? Number(stats.unpaid_fines || 0).toLocaleString() : loading ? "…" : "0"}</b></span></button>
    </div>
    <div className="dashboard-chart-grid" aria-busy={loading}>
      <DashboardDonut label="Copy availability" totalLabel="physical copies" centerValue={inventory.total} onNavigate={onNavigate} loading={loading && !stats} values={[
        { key: "available", label: "On shelf", value: inventory.available, color: "#4e7b61", route: "books" },
        { key: "borrowed", label: "With readers", value: inventory.on_loan, color: "#d4a355", route: "loans" },
        { key: "retired", label: "Retired", value: inventory.retired, color: "#9ca9a0", route: "books" },
      ]} />
      <DashboardDonut label="Loan health" totalLabel="active loans" centerValue={stats?.active_loans} onNavigate={onNavigate} loading={loading && !stats} values={[
        { key: "on-track", label: "On track", value: loanHealth.on_track, color: "#4e7b61", route: "loans" },
        { key: "due-soon", label: "Due soon", value: loanHealth.due_soon, color: "#d4a355", route: "loans" },
        { key: "overdue", label: "Overdue", value: loanHealth.overdue, color: "#bd624d", route: "loans" },
      ]} />
    </div>
    <div className="dashboard-lower-grid">
      <section className="panel dashboard-circulation-card">
        <div className="panel-head"><div><span className="eyebrow">LAST SIX MONTHS</span><h3>Circulation rhythm</h3></div><button className="dashboard-panel-link" type="button" onClick={() => onNavigate("reports")}>Full reports <ArrowUpRight size={13} aria-hidden="true" /></button></div>
        <div className="dashboard-chart-summary"><span><i className="chart-key" /> Checkouts <b>{Number(report?.totals?.borrowings || 0).toLocaleString()}</b></span><span><i className="chart-key return-key" /> Returns <b>{Number(report?.totals?.returned || 0).toLocaleString()}</b></span></div>
        {reportError && <LoadError message={reportError} onRetry={load} />}
        {circulation.length ? <div className="dashboard-bars" role="img" aria-label="Monthly checkouts and returns for the last six months"><div className="dashboard-bars-grid" aria-hidden="true"><i /><i /><i /></div><div className="dashboard-month-columns">{circulation.map((month) => <button className="dashboard-month-column" key={month.month} type="button" title={`${month.label}: ${month.issues} checkouts, ${month.returns} returns`} aria-label={`${month.label}: ${month.issues} checkouts and ${month.returns} returns. Open reports.`} onClick={() => onNavigate("reports")}><span className="dashboard-month-bars"><i className="dashboard-bar issue-bar" style={{ height: `${Math.max(month.issues ? 5 : 0, month.issues / maxMonth * 100)}%` }} /><i className="dashboard-bar return-bar" style={{ height: `${Math.max(month.returns ? 5 : 0, month.returns / maxMonth * 100)}%` }} /></span><small className="dashboard-month-label">{month.label.split(" ")[0]}</small></button>)}</div></div> : !loading && <div className="dashboard-chart-empty">Borrowing activity will appear here as books move through the library.</div>}
      </section>
      <section className="panel dashboard-attention-card">
        <div className="panel-head"><div><span className="eyebrow">LIBRARIAN FOLLOW-UP</span><h3>Return desk priorities</h3></div><button className="dashboard-panel-link" type="button" onClick={() => onNavigate("loans")}>Issue register <ArrowUpRight size={13} aria-hidden="true" /></button></div>
        <div className="dashboard-priority-list">{(stats?.priority_loans || []).map((item) => <button className={`dashboard-priority-row ${item.state}`} key={item.issue_code} type="button" onClick={() => onNavigate("loans")}><span className="dashboard-priority-icon">{item.state === "overdue" ? <CircleAlert size={15} aria-hidden="true" /> : <CalendarDays size={15} aria-hidden="true" />}</span><span className="dashboard-priority-copy"><b>{item.book_title || "Untitled book"}</b><small>{item.student_name || "Reader"} · {item.student_id || item.copy_id || item.issue_code}</small></span><span className="dashboard-due-label">{dueLabel(item)}</span></button>)}
          {(!stats?.priority_loans?.length) && <div className="dashboard-empty"><span><Check size={17} aria-hidden="true" /></span><b>All clear at the return desk</b><small>No overdue books or returns due in the next three days.</small></div>}
        </div>
        <div className="dashboard-fine-note"><span>₹</span><p><b>Overdue policy:</b> ₹20 per calendar day after the due date. Fine is recorded when a late copy is received.</p></div>
      </section>
    </div>
    <section className="panel dashboard-recent-card">
      <div className="panel-head"><div><span className="eyebrow">LATEST MOVEMENT</span><h3>Recent circulation</h3></div><button className="dashboard-panel-link" type="button" onClick={() => onNavigate("transactions")}>Open activity <ArrowUpRight size={13} aria-hidden="true" /></button></div>
      <div className="dashboard-recent-list">{recent.map((item) => { const returned = item.status === "returned"; return <button className="dashboard-recent-row" type="button" key={item.issue_code} onClick={() => onNavigate("transactions")}><span className={`dashboard-activity-icon ${returned ? "returned" : ""}`}>{returned ? <Check size={16} aria-hidden="true" /> : <BookOpen size={16} aria-hidden="true" />}</span><span className="dashboard-recent-copy"><b>{item.book_title || "Untitled book"}</b><small>{item.student_name || "Reader"} · {item.student_id || "Campus reader"}</small></span><span className={`dashboard-activity-status ${returned ? "returned" : ""}`}>{returned ? "Returned" : "Issued"}</span><time dateTime={item.borrowed_at}>{new Date(item.borrowed_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</time><ArrowUpRight className="dashboard-recent-arrow" size={14} aria-hidden="true" /></button>; })}
        {loading && !report && <LoadingState label="Loading recent circulation…" />}
        {!loading && recent.length === 0 && <div className="dashboard-chart-empty">Your recent checkouts and returns will appear here.</div>}
      </div>
    </section>
  </div>;
}

function CatalogueTile({ book, onOpen }) {
  return <button type="button" className="catalogue-card book-tile" onClick={() => onOpen(book)}><BookCover book={book} /><span className="eyebrow">{book.category}</span><h3>{book.title}</h3><p>{book.author}</p><BookRating rating={book.average_rating} count={book.rating_count} /><div className="catalogue-footer"><span>{book.available_to_borrow} / {book.total} copies free</span><small>Shelf {book.shelf || "Unassigned"}</small></div><span className="book-tile-link">View title <span aria-hidden="true">↗</span></span></button>;
}

function BooksPage({ onAddBook, onOpenBook }) {
  const [copies, setCopies] = useState(null);
  const [copiesLoading, setCopiesLoading] = useState(false);
  const [copiesError, setCopiesError] = useState("");
  async function showAllCopies() {
    setCopiesLoading(true);
    setCopiesError("");
    try { const result = await api("/books/copies/"); setCopies(result.results); }
    catch (error) { setCopiesError(error.message); }
    finally { setCopiesLoading(false); }
  }
  return <>
    <PageTitle eyebrow="COLLECTION / SEARCH" title="Find a title" note="Search, combine filters, and open a title to explore its copies." action={<button className="button primary" onClick={onAddBook}>＋ Add a book</button>} />
    <CatalogueExplorer path="/books/" renderBook={(book) => <CatalogueTile key={book.id} book={book} onOpen={onOpenBook} />} action={<button className="button light small" type="button" disabled={copiesLoading} onClick={showAllCopies}>{copiesLoading ? "Loading labels…" : "Choose QR labels to print"}</button>} />
    {copiesError && <LoadError message={copiesError} onRetry={showAllCopies} />}
    {copies && <CopyLabels copies={copies} title="All book copies" loading={copiesLoading} error={Boolean(copiesError)} />}
  </>;
}

function AddBookPage({ setNotice, onSaved, onCancel, book = null }) {
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true);
    try {
      const values = Object.fromEntries(new FormData(form));
      const result = book
        ? await api(`/books/${book.id}/`, { method: "POST", body: formBody(values) })
        : await api("/books/", { method: "POST", body: formBody(values) });
      noticeText(setNotice, book ? "Book details and copy count updated." : "Book added. Its copy labels are ready to open.");
      onSaved(result.book);
    } catch (error) {
      noticeText(setNotice, error.message, "error");
    } finally {
      setBusy(false);
    }
  }

  return <>
    <PageTitle eyebrow={book ? "LIBRARY CATALOGUE / EDIT TITLE" : "LIBRARY CATALOGUE / NEW TITLE"} title={book ? "Edit a book" : "Add a book"} note={book ? "Update the catalogue record and active physical copy count." : "Add the title once, then print a separate QR label for each physical copy."} action={<button className="button light" onClick={onCancel}>Back to search</button>} />
    <section className="add-book-layout">
      <form className="panel stack-form add-book-form" onSubmit={submit}>
        <div className="panel-head"><div><span className="eyebrow">BOOK DETAILS</span><h3>{book ? "Edit catalogue entry" : "New catalogue entry"}</h3></div></div>
        <label>Title<input name="title" required maxLength="120" defaultValue={book?.title || ""} /></label>
        <label>Author<input name="author" required maxLength="100" defaultValue={book?.author || ""} /></label>
        <div className="two-fields"><label>Category<input name="category" required maxLength="40" placeholder="Technology" defaultValue={book?.category || ""} /></label><label>ISBN<input name="isbn" maxLength="20" defaultValue={book?.isbn || ""} /></label></div>
        <div className="two-fields"><label>Number of physical copies<input name="copies" type="number" min="0" max="200" defaultValue={book?.total ?? 1} required /><small>Copies currently borrowed cannot be removed.</small></label><label>Shelf<input name="shelf" maxLength="30" placeholder="A-01" defaultValue={book?.shelf || ""} /></label></div>
        <label>Cover image URL (optional)<input name="cover_url" type="url" maxLength="1000" placeholder="https://example.com/book-cover.jpg" defaultValue={book?.cover_url || ""} /><small>Paste an HTTPS image URL. Leave blank to use the default illustrated cover.</small></label>
        <label>Description<textarea name="description" maxLength="300" rows="4" placeholder="A short note about this title" defaultValue={book?.description || ""} /></label>
        <button className="button primary" disabled={busy}>{busy ? "Saving book…" : book ? "Save book changes" : "Save book"}</button>
      </form>
      <aside className="add-book-art"><div className="add-book-art-mark" aria-hidden="true"><BookCover book={{ title: "A new chapter", author: "CampusShelf", category: "YOUR COLLECTION" }} /></div><div><span className="eyebrow">ONE TITLE, MANY READERS</span><h3>Give every copy its own place.</h3><p>CampusShelf creates a unique Copy ID for each physical book so checkouts and returns stay tied to the right copy.</p></div></aside>
    </section>
  </>;
}

function BookDetailPage({ book, onBack, onEdit }) {
  const [copies, setCopies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try { setCopies((await api(`/books/${book.id}/copies/`)).results); }
    catch (error) { setLoadError(error.message); }
    finally { setLoading(false); }
  }, [book.id]);
  useEffect(() => { load(); }, [load]);

  const availableCount = copies.filter((copy) => copy.status === "available").length;
  const shelfLocations = [...new Set(copies.map((copy) => copy.shelf).filter(Boolean))];
  const shelfLabel = shelfLocations.length ? shelfLocations.join(", ") : book.shelf || "Unassigned";

  return <>
    <PageTitle eyebrow="BOOK DETAILS / PHYSICAL COPIES" title={book.title} note={`${book.author} · ${book.category}`} action={<div className="page-title-actions"><button className="button light" onClick={onBack}>← Back to titles</button><button className="button primary" onClick={() => onEdit(book)}>Edit details</button></div>} />
    <section className="book-detail-hero"><div className="detail-cover-wrap"><BookCover book={book} /></div><div><span className="eyebrow">{book.category}</span><h3>{book.title}</h3><p>{book.description || "A title in the CampusShelf collection."}</p><div className="detail-stats"><span><b>{book.total}</b> physical copies</span><span><b>{availableCount}</b> free to borrow</span><span><b>{copies.length - availableCount}</b> on loan</span><span><b>{shelfLocations.length > 1 ? "Shelves" : "Shelf"} {shelfLabel}</b></span></div></div></section>
    {loadError && <LoadError message={loadError} onRetry={load} />}
    {loading && <LoadingState label="Loading copy records…" />}
    <CopyLabels copies={copies} title={book.title} loading={loading} error={Boolean(loadError)} />
  </>;
}

function RequestsPage({ setNotice }) {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [reviewingId, setReviewingId] = useState("");
  const [loadError, setLoadError] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try { setRequests((await api("/requests/")).results); }
    catch (error) { setLoadError(error.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function review(item, action) {
    setReviewingId(item.id);
    try {
      const result = await api(`/requests/${item.id}/${action}/`, { method: "POST", body: formBody({}) });
      noticeText(setNotice, result.student_id ? `${item.name} approved · Student ID ${result.student_id}` : result.message);
      await load();
    } catch (error) {
      noticeText(setNotice, error.message, "error");
    } finally {
      setReviewingId("");
    }
  }

  return <>
    <PageTitle eyebrow="STUDENT ACCESS / REVIEW" title="Signup requests" note="Verify the campus email and registration number before approving portal access." />
    {loadError && <LoadError message={loadError} onRetry={load} />}
    <section className="panel"><div className="panel-head"><div><span className="eyebrow">APPLICATIONS</span><h3>Waiting for a librarian</h3></div><span className="pill">{requests.filter((item) => item.status === "pending").length} pending</span></div>
      <div className="request-list" aria-busy={loading}>{requests.map((item) => <article className="request-row" key={item.id}><div className="request-avatar" aria-hidden="true">{item.name.slice(0, 1).toUpperCase()}</div><div className="request-info"><b>{item.name}</b><span>{item.email}</span><small>Registration {item.registration_number} · {item.course} · Year {item.year}</small></div><span className={`status ${item.status}`}>{item.status}</span>{item.status === "pending" && <div className="row-actions"><button className="button primary small" disabled={Boolean(reviewingId)} onClick={() => review(item, "approve")}>{reviewingId === item.id ? "Saving…" : "Approve"}</button><button className="button danger small" disabled={Boolean(reviewingId)} onClick={() => review(item, "reject")}>Reject</button></div>}</article>)}{loading && <LoadingState label="Loading signup requests…" />}{!loading && !loadError && requests.length === 0 && <p className="empty" role="status">No signup requests yet.</p>}</div>
    </section>
  </>;
}

function StudentsPage({ onAddFine }) {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [query, setQuery] = useState("");
  const [choices, setChoices] = useState({});
  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try { setMembers((await api("/members/")).results); }
    catch (error) { setLoadError(error.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const visible = filterRows(members.map((member) => ({ ...member, portal_state: member.portal_ready ? "ready" : "pending" })), query, choices);
  const courses = [...new Set(members.map((member) => member.course))].filter(Boolean).sort();
  return <>
    <PageTitle eyebrow="DIRECTORY / PORTAL ACCESS" title="Students" note="Find a student, check account details, or add a fine directly." />
    {loadError && <LoadError message={loadError} onRetry={load} />}
    <section className="panel"><div className="panel-head"><div><span className="eyebrow">APPROVED MEMBERS</span><h3>Campus readers</h3></div><span className="pill">{members.length} students</span></div>
      <RecordFilters query={query} onQuery={setQuery} choices={choices} onChoices={setChoices} count={visible.length} loading={loading} label="Search name, student ID, email, or course" groups={[{ key: "course", label: "Course", options: courses.map((value) => ({ value, label: value })) }, { key: "year", label: "Year", options: [...new Set(members.map((member) => String(member.year)))].sort().map((value) => ({ value, label: `Year ${value}` })) }, { key: "portal_state", label: "Portal access", options: [{ value: "ready", label: "Ready" }, { value: "pending", label: "Password needed" }] }]} />
      <div className="table-scroll"><table><thead><tr><th>Student</th><th>Student ID</th><th>Course</th><th>Portal</th><th>Fine balance</th><th>Actions</th></tr></thead><tbody>{visible.map((member) => <tr key={member.id}><td><b>{member.name}</b><small>{member.email}</small></td><td><code>{member.student_id}</code></td><td>{member.course} · Year {member.year}</td><td><span className={`status ${member.portal_ready ? "approved" : "pending"}`}>{member.portal_ready ? "Ready" : "Password needed"}</span></td><td>₹{member.fine_balance}</td><td><button className="button danger small" onClick={() => onAddFine(member)} aria-label={`Add fine for ${member.name}`}>Add fine</button></td></tr>)}</tbody></table></div>
      {loading && <LoadingState label="Loading student directory…" />}
      {!loading && !loadError && !visible.length && <p className="empty" role="status">No students match. Clear your search or try fewer filters.</p>}
    </section>
  </>;
}

function LoansPage({ setNotice }) {
  const [loans, setLoans] = useState([]);
  const [members, setMembers] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, page_size: 25, total: 0, pages: 1 });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState("return");
  const [copyId, setCopyId] = useState("");
  const [memberId, setMemberId] = useState("");
  const [scanOpen, setScanOpen] = useState(false);
  const [scanInfo, setScanInfo] = useState(null);
  const membersLoaded = useRef(false);

  const load = useCallback(async (page = 1, forceMembers = false) => {
    setLoading(true);
    setLoadError("");
    try {
      const params = new URLSearchParams({ page: String(page), page_size: "25" });
      const requests = [api(`/loans/?${params}`)];
      if (forceMembers || !membersLoaded.current) requests.push(api("/members/catalogue/"));
      const [loanData, memberData] = await Promise.all(requests);
      setLoans(loanData.results);
      setPagination(loanData.pagination || { page: 1, page_size: 25, total: loanData.results.length, pages: 1 });
      if (memberData) {
        setMembers(memberData.results);
        membersLoaded.current = true;
      }
    } catch (error) {
      setLoadError(error.message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(1, true); }, [load]);

  async function scanned(value) {
    setScanOpen(false);
    setCopyId(value);
    try {
      const copy = await api(`/copies/${encodeURIComponent(value)}/lookup/`);
      setScanInfo({ ...copy, returned: false });
    } catch (error) {
      setScanInfo(null);
      noticeText(setNotice, error.message, "error");
    }
  }

  async function submit(event) {
    event.preventDefault();
    const values = mode === "issue" ? { member_id: memberId, copy_id: copyId } : { copy_id: copyId };
    setBusy(true);
    try {
      if (mode === "issue") {
        const result = await api("/loans/", { method: "POST", body: formBody(values) });
        noticeText(setNotice, `Issued ${result.loan.book_title} · ${result.loan.issue_code}`);
        setCopyId("");
        setScanInfo(null);
      } else {
        const result = await api("/returns/copy/", { method: "POST", body: formBody(values) });
        noticeText(setNotice, result.fine ? `Returned. Overdue fine: ₹${result.fine.amount}` : "Book returned. No overdue fine.");
        setScanInfo({
          ...(scanInfo || {}),
          copy_id: result.loan.copy_id,
          book_title: result.loan.book_title,
          status: "available",
          active_loan: false,
          returned: true,
        });
      }
      await load(1);
    } catch (error) {
      noticeText(setNotice, error.message, "error");
    } finally {
      setBusy(false);
    }
  }

  return <>
    <PageTitle eyebrow="CIRCULATION DESK / COPY QR" title="Issue and return books" note="Scan a copy label or type its Copy ID. A QR never approves a loan by itself." />
    {loadError && <LoadError message={loadError} onRetry={() => load(pagination.page)} />}
    <section className="panel action-panel"><div className="mode-switch"><button className={mode === "return" ? "selected" : ""} onClick={() => { setMode("return"); setScanInfo(null); }}>Return a copy</button><button className={mode === "issue" ? "selected" : ""} onClick={() => { setMode("issue"); setScanInfo(null); }}>Issue to student</button></div>
      <form className="issue-controls" onSubmit={submit}>
        {mode === "issue" && <SearchPicker label="Approved student" value={memberId} onChange={setMemberId} required loading={loading} options={members.map((member) => ({ value: member.id, label: member.name, detail: `${member.student_id} · ${member.email || member.course || ""}` }))} placeholder="Search student name or ID…" />}
        <label>Physical Copy ID<input value={copyId} onChange={(event) => setCopyId(event.target.value.toUpperCase())} placeholder="Scan the QR or type CSB-…" required /></label>
        <div className="button-line"><button className="button light" type="button" onClick={() => setScanOpen((open) => !open)}>{scanOpen ? "Close scanner" : "Open camera scanner"}</button><button className="button primary" disabled={busy || scanInfo?.returned || (scanInfo && mode === "return" && !scanInfo.active_loan) || (scanInfo && mode === "issue" && scanInfo.status !== "available")}>{busy ? "Saving…" : mode === "issue" ? "Confirm issue" : scanInfo?.returned ? "Return recorded" : scanInfo?.active_loan ? "Complete this return" : "Complete return"}</button></div>
      </form>
      <Scanner open={scanOpen} onScan={scanned} onError={(message) => noticeText(setNotice, message, "error")} />
      {scanInfo && <div className={`scan-result-card ${scanInfo.returned ? "complete" : ""}`} role="status"><span className="scan-result-mark" aria-hidden="true">{scanInfo.returned ? "✓" : "⌗"}</span><div><span className="eyebrow">{scanInfo.returned ? "RETURN RECORDED" : "COPY SCANNED"}</span><b>{scanInfo.book_title || "Physical copy"}</b><small>{scanInfo.copy_id}{scanInfo.member_name ? ` · With ${scanInfo.member_name}` : ""}{scanInfo.issue_code ? ` · ${scanInfo.issue_code}` : ""}</small><p>{scanInfo.returned ? "This copy is available to borrow again." : mode === "return" && scanInfo.active_loan ? "Active loan found. Complete the return to update the copy and its transaction." : scanInfo.status === "available" ? "Available to borrow. Select a student before issuing." : "No active loan was found for this copy. Review its transaction history before changing its status."}</p></div><span className={`status ${scanInfo.returned ? "available" : scanInfo.active_loan ? "borrowed" : scanInfo.status}`}>{scanInfo.returned ? "Available" : scanInfo.active_loan ? "On loan" : scanInfo.status}</span></div>}
    </section>
    <section className="panel"><div className="panel-head"><div><span className="eyebrow">COMPLETE HISTORY</span><h3>Transaction register</h3></div><span className="pill">{pagination.total} records</span></div>
      <div className="table-scroll" aria-busy={loading}><table><thead><tr><th>Issue ID</th><th>Book / copy</th><th>Student</th><th>Due date</th><th>Current fine</th><th>Status</th></tr></thead><tbody>{loans.map((loan) => <tr key={loan.id}><td><code>{loan.issue_code}</code></td><td><b>{loan.book_title}</b><small>{loan.copy_id}</small></td><td>{loan.member_name}<small>{loan.student_id}</small></td><td>{new Date(loan.due_at).toLocaleDateString()}{["due_soon", "overdue"].includes(loan.due_status) && <small><span className={`status ${loan.due_status}`}>{loan.due_message}</span></small>}</td><td>{loan.current_fine === "0" ? "—" : `₹${loan.current_fine}`}</td><td><span className={`status ${loan.status}`}>{loan.status}</span></td></tr>)}</tbody></table>{loading && <LoadingState label="Loading issue records…" />}{!loading && !loadError && loans.length === 0 && <p className="empty" role="status">No books have been issued yet.</p>}</div>
      {pagination.total > 0 && <div className="pagination-controls"><span>Showing {(pagination.page - 1) * pagination.page_size + 1}–{Math.min(pagination.page * pagination.page_size, pagination.total)} of {pagination.total}</span><div><button className="button light small" type="button" disabled={loading || pagination.page <= 1} onClick={() => load(pagination.page - 1)}>Previous</button><span>Page {pagination.page} of {pagination.pages}</span><button className="button light small" type="button" disabled={loading || pagination.page >= pagination.pages} onClick={() => load(pagination.page + 1)}>Next</button></div></div>}
    </section>
  </>;
}

function TransactionsPage({ setNotice, student = false }) {
  const [transactions, setTransactions] = useState([]);
  const [query, setQuery] = useState("");
  const [type, setType] = useState([]);
  const [appliedQuery, setAppliedQuery] = useState("");
  const requestSequence = useRef(0);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const load = useCallback(async (searchTerm, selectedType, pageNumber = 1) => {
    const sequence = ++requestSequence.current;
    setLoading(true);
    setLoadError("");
    try {
      const params = new URLSearchParams({ q: searchTerm, page: String(pageNumber) });
      selectedType.forEach((value) => params.append("type", value));
      const path = student ? "/student/transactions/" : "/transactions/";
      const result = await api(`${path}?${params}`);
      if (sequence !== requestSequence.current) return;
      setAppliedQuery(searchTerm);
      setTransactions(result.results);
      setPagination(result.pagination);
    } catch (error) {
      if (sequence === requestSequence.current) setLoadError(error.message);
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, [student]);

  useEffect(() => { load("", [], 1); }, [load]);

  function submit(event) {
    event.preventDefault();
    load(query, type, 1).catch((error) => noticeText(setNotice, error.message, "error"));
  }

  const labels = { checkout: "Book issued", return: "Book returned", renewal: "Renewal", fine_added: "Fine added", fine_paid: "Fine paid" };
  const icons = { checkout: "↗", return: "✓", renewal: "↻", fine_added: "₹", fine_paid: "✓" };

  return <>
    <PageTitle eyebrow={student ? "STUDENT PORTAL / ACCOUNT HISTORY" : "LIBRARY DESK / AUDIT"} title={student ? "My activity" : "Transaction activity"} note={student ? "A timeline of your checkouts, returns, renewal decisions, and fines." : "Search circulation and account events across the library."} />
    {loadError && <LoadError message={loadError} onRetry={() => load(query, type, pagination.page)} />}
    <section className="panel transaction-panel">
      <form className="transaction-filters" onSubmit={submit}>
        <label className="transaction-search">Search<input value={query} disabled={loading} onChange={(event) => setQuery(event.target.value)} placeholder={student ? "Title, issue ID, or fine reason" : "Student, title, Copy ID, or issue ID"} /></label>

        <button className="button primary" disabled={loading}>{loading ? "Loading…" : "Search history"}</button>
      </form>
      <CheckboxGroup label="Activity types" options={Object.entries(labels).map(([value, label]) => ({ value, label }))} selected={type} disabled={loading} onChange={(values) => { setType(values); load(query, values, 1).catch((error) => noticeText(setNotice, error.message, "error")); }} />
      <ActiveFilters items={[...(appliedQuery ? [{ key: "query", label: `Search: ${appliedQuery}`, remove: () => { setQuery(""); load("", type, 1).catch((error) => noticeText(setNotice, error.message, "error")); } }] : []), ...type.map((value) => ({ key: value, label: labels[value], remove: () => { const values = type.filter((item) => item !== value); setType(values); load(query, values, 1).catch((error) => noticeText(setNotice, error.message, "error")); } }))]} onClear={() => { setQuery(""); setType([]); load("", [], 1).catch((error) => noticeText(setNotice, error.message, "error")); }} />
      <div className="transaction-list" aria-busy={loading}>{transactions.map((item) => <article className="transaction-row" key={item.id}>
        <span className={`transaction-icon ${item.type}`} aria-hidden="true">{icons[item.type]}</span>
        <div className="transaction-copy"><div className="transaction-heading"><b>{item.title}</b><span className={`status ${item.status}`}>{labels[item.type]}</span></div><p>{item.details}</p>{!student && <small>{item.student_name} · {item.student_id}</small>}<time dateTime={item.occurred_at}>{new Date(item.occurred_at).toLocaleString()}</time></div>
        {item.amount && <strong className="transaction-amount">₹{Number(item.amount).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}</strong>}
      </article>)}{loading && <LoadingState label="Loading transaction history…" />}{!loading && !loadError && transactions.length === 0 && <p className="empty" role="status">No activity matches this search.</p>}</div>
      <div className="pagination-controls"><span>{pagination.total} event{pagination.total === 1 ? "" : "s"} · Page {pagination.page} of {pagination.pages}</span><div><button className="button light small" disabled={loading || pagination.page <= 1} onClick={() => load(query, type, pagination.page - 1).catch((error) => noticeText(setNotice, error.message, "error"))}>← Previous</button><button className="button light small" disabled={loading || pagination.page >= pagination.pages} onClick={() => load(query, type, pagination.page + 1).catch((error) => noticeText(setNotice, error.message, "error"))}>Next →</button></div></div>
    </section>
  </>;
}

function FinesPage({ setNotice, initialMemberId = "" }) {
  const [selectedMemberId, setSelectedMemberId] = useState(initialMemberId);
  const [fines, setFines] = useState([]);
  const [fineSearch, setFineSearch] = useState("");
  const [fineFilters, setFineFilters] = useState({});
  const visibleFines = filterRows(fines, fineSearch, fineFilters);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const [fineData, memberData] = await Promise.all([api("/fines/"), api("/members/catalogue/")]);
      setFines(fineData.results);
      setMembers(memberData.results);
    } catch (error) {
      setLoadError(error.message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function addFine(event) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true);
    try {
      await api("/fines/custom/", { method: "POST", body: formBody(Object.fromEntries(new FormData(form))) });
      form.reset();
      noticeText(setNotice, "Custom fine added to the student account.");
      await load();
    } catch (error) {
      noticeText(setNotice, error.message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function markPaid(fine) {
    setBusy(true);
    try {
      await api(`/fines/${fine.id}/paid/`, { method: "POST", body: formBody({}) });
      noticeText(setNotice, "Fine marked as paid.");
      await load();
    } catch (error) {
      noticeText(setNotice, error.message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function removeFine(fine) {
    if (!window.confirm(`Remove the unpaid fine of ₹${fine.amount} for ${fine.member_name}? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await api(`/fines/${fine.id}/remove/`, { method: "POST", body: formBody({}) });
      noticeText(setNotice, "Fine removed from the student account.");
      await load();
    } catch (error) { noticeText(setNotice, error.message, "error"); }
    finally { setBusy(false); }
  }

  return <>
    <PageTitle eyebrow="STUDENT ACCOUNTS / ₹20 PER DAY" title="Fine ledger" note="Current overdue amounts update by calendar day. Returned-book fines are saved as a fixed entry." />
    {loadError && <LoadError message={loadError} onRetry={load} />}
    <div className="content-grid">
      <section className="panel"><div className="panel-head"><div><span className="eyebrow">LIBRARIAN ENTRY</span><h3>Add a custom fine</h3></div></div>
        <form className="stack-form compact" onSubmit={addFine}>
          <SearchPicker label="Student" name="member_id" value={selectedMemberId} onChange={setSelectedMemberId} required loading={loading} options={members.map((member) => ({ value: member.id, label: member.name, detail: `${member.student_id} · ${member.email || member.course || ""}` }))} placeholder="Search student name or ID…" />
          <label>Amount in rupees<input name="amount" type="number" min="0.01" step="0.01" required /></label>
          <label>Reason<input name="reason" maxLength="200" required placeholder="Damaged cover" /></label>
          <button className="button primary" disabled={busy}>{busy ? "Saving…" : "Add unpaid fine"}</button>
        </form>
      </section>
      <section className="panel list-panel"><div className="panel-head"><div><span className="eyebrow">ALL RECORDS</span><h3>Fines and payments</h3></div><span className="pill">{fines.length} entries</span></div>
        <RecordFilters query={fineSearch} onQuery={setFineSearch} choices={fineFilters} onChoices={setFineFilters} count={visibleFines.length} loading={loading} label="Search student, ID, fine reason, or amount" groups={[{ key: "status", label: "Payment status", options: [{ value: "unpaid", label: "Unpaid" }, { value: "paid", label: "Paid" }] }, { key: "fine_type", label: "Fine type", options: [{ value: "custom", label: "Custom" }, { value: "overdue", label: "Overdue" }] }]} /><div className="fine-list" aria-busy={loading}>{visibleFines.map((fine) => <article className="fine-row" key={fine.id}><div className="fine-amount">₹{fine.amount}</div><div className="fine-info"><b>{fine.member_name} <small>{fine.student_id}</small></b><span>{fine.reason}</span><small>{fine.fine_type === "overdue" ? "Overdue fine" : "Custom fine"} · {new Date(fine.created_at).toLocaleDateString()}</small></div><span className={`status ${fine.status}`}>{fine.status}</span>{fine.status === "unpaid" && (fine.current ? <small className="fine-live-note">Return the book to finalise this amount, then mark it paid or remove it.</small> : <div className="fine-actions"><button className="button light small" disabled={busy} onClick={() => markPaid(fine)}>Mark paid</button><button className="button danger small" disabled={busy} onClick={() => removeFine(fine)}>Remove fine</button></div>)}</article>)}{loading && <LoadingState label="Loading fines…" />}{!loading && !loadError && visibleFines.length === 0 && <p className="empty" role="status">No fines match. Try fewer filters or clear the search.</p>}</div>
      </section>
    </div>
  </>;
}

function AccountPage({ user, setNotice }) {
  const [busy, setBusy] = useState(false);

  async function changePassword(event) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true);
    try {
      const result = await api("/auth/password/", {
        method: "POST",
        body: formBody(Object.fromEntries(new FormData(form))),
      });
      form.reset();
      noticeText(setNotice, result.message || "Your password has been changed.");
    } catch (error) {
      noticeText(setNotice, error.message, "error");
    } finally {
      setBusy(false);
    }
  }

  return <>
    <PageTitle eyebrow="ACCOUNT / SECURITY" title="Change password" note="Update the password for your CampusShelf sign-in." />
    <section className="panel password-panel">
      <div className="panel-head"><div><span className="eyebrow">{user.role === "student" ? "STUDENT ACCOUNT" : "LIBRARIAN ACCOUNT"}</span><h3>{user.name}</h3></div><span className="pill">{user.role === "student" ? user.student_id : user.login_id}</span></div>
      <form className="stack-form compact password-form" onSubmit={changePassword}>
        <label>Current password<input name="old_password" type="password" autoComplete="current-password" required /></label>
        <label>New password<input name="new_password1" type="password" minLength="10" autoComplete="new-password" required /><small className="muted">Choose at least 10 characters and avoid common passwords.</small></label>
        <label>Confirm new password<input name="new_password2" type="password" minLength="10" autoComplete="new-password" required /></label>
        <button className="button primary" disabled={busy}>{busy ? "Updating password…" : "Change password"}</button>
      </form>
      <p className="password-help">Your current password is required. If you are a student and cannot sign in, ask a librarian to reset your portal password from the Students page.</p>
    </section>
  </>;
}

async function loadBookChoices() {
  const first = await api("/books/?page_size=100");
  const pages = await Promise.all(Array.from({ length: Math.max(0, (first.pagination?.pages || 1) - 1) }, (_, index) => api(`/books/?page_size=100&page=${index + 2}`)));
  return { results: [first, ...pages].flatMap((page) => page.results) };
}

function ReviewsPage({ setNotice }) {
  const [reviews, setReviews] = useState([]);
  const [books, setBooks] = useState([]);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const [reviewData, bookData, memberData] = await Promise.all([api("/reviews/"), loadBookChoices(), api("/members/catalogue/")]);
      setReviews(reviewData.results);
      setBooks(bookData.results);
      setMembers(memberData.results);
    } catch (error) {
      setLoadError(error.message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  async function submit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true);
    try {
      await api("/reviews/add/", { method: "POST", body: formBody(Object.fromEntries(new FormData(form))) });
      form.reset();
      noticeText(setNotice, "Reader note saved.");
      await load();
    } catch (error) {
      noticeText(setNotice, error.message, "error");
    } finally {
      setBusy(false);
    }
  }
  return <>
    <PageTitle eyebrow="READER NOTES / COMMUNITY" title="Reviews" note="Keep the thoughtful notes readers want to pass along." />
    {loadError && <LoadError message={loadError} onRetry={load} />}
    <div className="content-grid">
      <section className="panel"><div className="panel-head"><div><span className="eyebrow">SHARE A THOUGHT</span><h3>Write a review</h3></div></div>
        <form className="stack-form compact" onSubmit={submit}>
          <SearchPicker label="Book" name="book_id" required loading={loading} options={books.map((book) => ({ value: book.id, label: book.title, detail: `${book.author || ""} · ${book.isbn || ""} · Shelf ${book.shelf || "Unassigned"}` }))} placeholder="Search title, author, or ISBN…" />
          <SearchPicker label="Student" name="member_id" required loading={loading} options={members.map((member) => ({ value: member.id, label: member.name, detail: `${member.student_id} · ${member.email || member.course || ""}` }))} placeholder="Search student name or ID…" />
          <label>Rating<select name="rating" defaultValue="5">{[5, 4, 3, 2, 1].map((rating) => <option key={rating} value={rating}>{rating} / 5</option>)}</select></label>
          <label>Note<textarea name="comment" maxLength="500" rows="4" required /></label>
          <button className="button primary" disabled={busy}>{busy ? "Saving…" : "Save review"}</button>
        </form>
      </section>
      <section className="panel list-panel"><div className="panel-head"><div><span className="eyebrow">WORDS WORTH KEEPING</span><h3>Community notes</h3></div></div><div className="review-list" aria-busy={loading}>{reviews.map((review) => <article className="review-row" key={review.id}><div className="review-rating" role="img" aria-label={`${review.rating} out of 5 stars`}>{"★".repeat(review.rating)}{"☆".repeat(5 - review.rating)}</div><b>{review.book_title}</b><p>“{review.comment}”</p><small>{review.member_name} · {new Date(review.created_at).toLocaleDateString()}</small></article>)}{loading && <LoadingState label="Loading reader notes…" />}{!loading && !loadError && reviews.length === 0 && <p className="empty" role="status">No notes yet.</p>}</div></section>
    </div>
  </>;
}

function StudentBookReviews({ book, setNotice, onRatingChange }) {
  const [reviews, setReviews] = useState([]);
  const [average, setAverage] = useState(0);
  const [ratingCount, setRatingCount] = useState(0);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [hasReview, setHasReview] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const data = await api(`/books/${book.id}/reviews/`);
      setReviews(data.results);
      setAverage(data.average_rating);
      setRatingCount(data.rating_count);
      onRatingChange?.({ average_rating: data.average_rating, rating_count: data.rating_count });
      setHasReview(Boolean(data.my_review));
      setRating(data.my_review?.rating || 0);
      setComment(data.my_review?.comment || "");
    } catch (error) {
      setLoadError(error.message);
      throw error;
    } finally {
      setLoading(false);
    }
  }, [book.id, onRatingChange]);

  useEffect(() => { load().catch(() => {}); }, [load]);

  async function submit(event) {
    event.preventDefault();
    setFeedback(null);
    setBusy(true);
    try {
      const result = await api("/student/reviews/", {
        method: "POST",
        body: formBody({ book_id: book.id, rating: String(rating), comment }),
      });
      noticeText(setNotice, result.message);
      setFeedback({ kind: "success", text: result.message });
      try { await load(); }
      catch { setFeedback({ kind: "error", text: "Your rating was saved, but the review list could not refresh. Use Refresh to reload it." }); }
    } catch (error) {
      setFeedback({ kind: "error", text: error.message });
      noticeText(setNotice, error.message, "error");
    } finally {
      setBusy(false);
    }
  }

  return <section className="panel student-reviews-panel">
    <div className="panel-head"><div><span className="eyebrow">PUBLIC READER RATINGS</span><h3>What readers think</h3></div><button className="button light small" disabled={loading} onClick={() => load().catch(() => {})}>{loading ? "Loading…" : "Refresh"}</button></div>
    {loadError && <LoadError message={loadError} onRetry={() => load().catch(() => {})} />}
    <div className="reader-rating-overview"><strong>{ratingCount ? average.toFixed(1) : "—"}</strong><div><BookRating rating={average} count={ratingCount} /><small>{ratingCount ? `Based on ${ratingCount} student rating${ratingCount === 1 ? "" : "s"}` : "No one has rated this book yet."}</small></div></div>
    <form className="student-review-form" onSubmit={submit}>
      {feedback && <div className={`notice ${feedback.kind}`} role={feedback.kind === "error" ? "alert" : "status"}>{feedback.text}</div>}
      <fieldset className="rating-picker" disabled={busy || loading}>
        <legend>{hasReview ? "Update your rating" : "Your rating"}</legend>
        <div>{[1, 2, 3, 4, 5].map((star) => <button key={star} type="button" className={star <= rating ? "selected" : ""} aria-label={`Rate ${star} out of 5 stars`} aria-pressed={rating === star} onClick={() => setRating(star)}>★</button>)}</div>
      </fieldset>
      <label>Note <span>(optional, up to 500 characters)</span><textarea value={comment} onChange={(event) => setComment(event.target.value)} maxLength={500} rows={3} placeholder="Share what you liked or who you would recommend it to." disabled={busy || loading} /></label>
      <div className="student-review-submit"><small>Your rating and note will be visible to readers in the catalogue.</small><button className="button primary" disabled={busy || loading || rating < 1}>{busy ? "Publishing…" : hasReview ? "Update public rating" : "Publish rating"}</button></div>
    </form>
    <div className="public-review-list" aria-busy={loading}>
      {reviews.map((review) => <article className="public-review-card" key={review.id}><span className="public-review-stars" role="img" aria-label={`${review.rating} out of 5 stars`}>{"★".repeat(review.rating)}{"☆".repeat(5 - review.rating)}</span><p>{review.comment || "Rated without a written note."}</p><small>{review.member_name} · {new Date(review.created_at).toLocaleDateString()}</small></article>)}
      {loading && <LoadingState label="Loading reader ratings…" />}{!loading && !loadError && reviews.length === 0 && <p className="empty" role="status">Be the first reader to rate this title.</p>}
    </div>
  </section>;
}

function IssueSlip({ loan, onClose }) {
  return <section className="issue-slip slip-full">
    <div className="slip-details">
      <span className="eyebrow">CAMPUSSHELF / ISSUE SLIP</span>
      <h3>{loan.book_title}</h3>
      <p>{loan.book_author || "Library title"}{loan.book_category ? ` · ${loan.book_category}` : ""}</p>
      <div className="slip-facts">
        <span><small>Issue ID</small><b>{loan.issue_code}</b></span>
        <span><small>Student</small><b>{loan.member_name} · {loan.student_id}</b></span>
        <span><small>Copy ID</small><b>{loan.copy_id}</b></span>
        <span><small>Checked out</small><b>{new Date(loan.borrowed_at).toLocaleDateString()}</b></span>
        <span><small>Due date</small><b>{new Date(loan.due_at).toLocaleDateString()}</b></span>
        <span><small>Status</small><b>{loan.status}</b></span>
        {loan.returned_at && <span><small>Returned</small><b>{new Date(loan.returned_at).toLocaleDateString()}</b></span>}
        {loan.current_fine !== "0" && <span><small>Current fine</small><b>₹{loan.current_fine}</b></span>}
      </div>
      <p className="slip-help">{loan.status === "borrowed" ? "Show this copy QR to the librarian when you bring the book back. The librarian scans it to complete the return." : "This loan is complete. Keep this slip with your borrowing history."}</p>
    </div>
    <div className="slip-qr"><QRCodeSVG value={loan.copy_id} size={150} /><b>{loan.copy_id}</b><span>Copy QR · issue slip</span></div>
    <div className="slip-actions"><button className="button light" onClick={() => window.print()}>Print issue slip</button>{onClose && <button className="text-button" onClick={onClose}>Close</button>}</div>
  </section>;
}

function RenewalsPage({ setNotice }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [busyId, setBusyId] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try { setItems((await api("/renewals/")).results); }
    catch (error) { setLoadError(error.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  async function review(item, action) {
    setBusyId(item.id);
    try {
      await api(`/renewals/${item.id}/${action}/`, { method: "POST", body: formBody({}) });
      await load();
      noticeText(setNotice, `Renewal ${action === "approve" ? "approved" : "declined"}.`);
    } catch (error) { noticeText(setNotice, error.message, "error"); }
    finally { setBusyId(""); }
  }
  return <>
    <PageTitle eyebrow="CIRCULATION / RENEWALS" title="Renewal requests" note="Review each requested extension of up to 14 days. Renewals are available when the loan is current and no other student is waiting for the title." action={<button className="button light" disabled={loading} onClick={load}>{loading ? "Refreshing…" : "Refresh requests"}</button>} />
    {loadError && <LoadError message={loadError} onRetry={load} />}
    <section className="panel"><div className="reservation-list" aria-busy={loading}>{items.map((item) => <article className="reservation-row" key={item.id}><div className="reservation-mark" aria-hidden="true">↻</div><div className="reservation-info"><b>{item.book_title}</b><span>{item.student_name} · {item.student_id} · Copy {item.copy_id}</span><small>Requested {new Date(item.created_at).toLocaleDateString()} · {item.days_requested} day{item.days_requested === 1 ? "" : "s"} requested · Due {new Date(item.due_at).toLocaleDateString()} · {item.issue_code}</small></div><span className={`status ${item.status}`}>{item.status}</span>{item.status === "pending" && <div className="row-actions"><button className="button primary small" disabled={Boolean(busyId)} onClick={() => review(item, "approve")}>{busyId === item.id ? "Saving…" : `Approve +${item.days_requested} day${item.days_requested === 1 ? "" : "s"}`}</button><button className="button danger small" disabled={Boolean(busyId)} onClick={() => review(item, "reject")}>Decline</button></div>}</article>)}{loading && <LoadingState label="Loading renewal requests…" />}{!loading && !loadError && items.length === 0 && <p className="empty" role="status">No renewal requests yet.</p>}</div></section>
  </>;
}

function ReportsPage() {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try { setReport(await api("/reports/")); }
    catch (error) { setLoadError(error.message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const maxPopular = Math.max(1, ...(report?.popular_books || []).map((item) => item.borrowings));
  const maxMonth = Math.max(1, ...(report?.circulation || []).flatMap((item) => [item.issues, item.returns]));
  return <>
    <PageTitle eyebrow="LIBRARY ANALYTICS" title="Circulation reports" note="See which titles readers choose and how borrowing activity changes over six months." action={<button className="button light" disabled={loading} onClick={load}>{loading ? "Refreshing…" : "Refresh report"}</button>} />
    {loadError && <LoadError message={loadError} onRetry={load} />}
    {report && <div className="stats-grid report-stats"><StatCard label="Lifetime checkouts" value={report.totals.borrowings} note="All recorded issue transactions" /><StatCard label="Currently borrowed" value={report.totals.active} note="Active circulation" /><StatCard label="Completed returns" value={report.totals.returned} note="Returned to the collection" /></div>}
    <div className="reports-grid"><section className="panel"><div className="panel-head"><div><span className="eyebrow">MOST BORROWED</span><h3>Popular titles</h3></div></div><div className="report-rank-list" aria-busy={loading}>{report?.popular_books.map((item, index) => <div className="report-rank" key={item.title}><span>{String(index + 1).padStart(2, "0")}</span><div><b>{item.title}</b><div className="report-bar"><i style={{ width: `${Math.max(5, item.borrowings / maxPopular * 100)}%` }} /></div></div><strong>{item.borrowings}</strong></div>)}{loading && <LoadingState label="Loading popular titles…" />}{!loading && !loadError && !report?.popular_books.length && <p className="empty" role="status">Borrowing history will appear here.</p>}</div></section>
      <section className="panel"><div className="panel-head"><div><span className="eyebrow">LAST SIX MONTHS</span><h3>Borrowing activity</h3></div></div><div className="circulation-chart" aria-busy={loading}>{report?.circulation.map((month) => <div className="circulation-month" key={month.month}><div className="circulation-bars"><i className="issue-bar" title={`${month.issues} checkouts`} style={{ height: `${Math.max(3, month.issues / maxMonth * 100)}%` }} /><i className="return-bar" title={`${month.returns} returns`} style={{ height: `${Math.max(3, month.returns / maxMonth * 100)}%` }} /></div><small>{month.label}</small></div>)}{loading && <LoadingState label="Loading monthly activity…" />}{!loading && !loadError && !report?.circulation.length && <p className="empty" role="status">No borrowing activity yet.</p>}</div><div className="chart-legend"><span><i className="issue-bar" /> Checkouts</span><span><i className="return-bar" /> Returns</span></div></section></div>
    <section className="panel"><div className="panel-head"><div><span className="eyebrow">LATEST ACTIVITY</span><h3>Recent transactions</h3></div></div><div className="table-scroll" aria-busy={loading}><table><thead><tr><th>Issue ID</th><th>Title</th><th>Student</th><th>Issued</th><th>Due</th><th>Status</th></tr></thead><tbody>{report?.recent_transactions.map((item) => <tr key={item.issue_code}><td><code>{item.issue_code}</code></td><td>{item.book_title}</td><td>{item.student_name}<small>{item.student_id}</small></td><td>{new Date(item.borrowed_at).toLocaleDateString()}</td><td>{new Date(item.due_at).toLocaleDateString()}</td><td><span className={`status ${item.status}`}>{item.status}</span></td></tr>)}</tbody></table>{loading && <LoadingState label="Loading recent transactions…" />}{!loading && !loadError && !report?.recent_transactions.length && <p className="empty" role="status">There are no transactions yet.</p>}</div></section>
  </>;
}

const TIME_SLOTS = ["08:00", "09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00", "19:00", "20:00"];

function getLocalDateStr(date = new Date()) {
  return campusDateTime(date).date;
}

function StudentSpaceBookingsPage({ user, setNotice }) {
  const todayStr = getLocalDateStr();
  const [subTab, setSubTab] = useState("browse");
  const [selectedDate, setSelectedDate] = useState(todayStr);
  const [spaceType, setSpaceType] = useState([]);
  const [spaceQuery, setSpaceQuery] = useState("");
  const [availFilter, setAvailFilter] = useState([]);
  const [spaces, setSpaces] = useState([]);
  const [myBookings, setMyBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const requestSequence = useRef(0);
  const [bookingModal, setBookingModal] = useState(null);
  const bookingDialogRef = useRef(null);
  const bookingDialogId = useId();
  const [modalError, setModalError] = useState("");
  const [bookingForm, setBookingForm] = useState({
    date: todayStr,
    start_time: "09:00",
    end_time: "10:00",
    attendees_count: 1,
    purpose: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [cancellingId, setCancellingId] = useState("");
  useAccessibleDialog(Boolean(bookingModal), bookingDialogRef, () => !submitting && setBookingModal(null));

  const loadData = useCallback(async () => {
    const sequence = ++requestSequence.current;
    setLoading(true);
    setLoadError("");
    try {
      const [spacesData, bookingsData] = await Promise.all([
        api(`/spaces/?date=${encodeURIComponent(selectedDate)}`),
        api("/student/space-bookings/"),
      ]);
      if (sequence !== requestSequence.current) return;
      setSpaces(spacesData.results || []);
      setMyBookings(bookingsData.results || []);
    } catch (err) {
      if (sequence === requestSequence.current) setLoadError(err.message);
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, [selectedDate]);

  useEffect(() => { loadData(); }, [loadData]);

  function openBookingModal(space, presetSlot = null) {
    setModalError("");
    let firstEmpty = presetSlot;
    if (!firstEmpty && space.schedule) {
      firstEmpty = space.schedule.find((s) => s.status === "empty" && s.bookable !== false);
    }
    if (!firstEmpty) { noticeText(setNotice, "No future slots are available for this space on the selected date.", "error"); return; }
    const startTime = firstEmpty.start;
    const validEnds = bookingEndTimes(TIME_SLOTS, startTime, space.space_type);
    const endTime = firstEmpty ? firstEmpty.end : (validEnds[0] || "10:00");
    setBookingModal(space);
    setBookingForm({
      date: selectedDate || todayStr,
      start_time: startTime,
      end_time: endTime,
      attendees_count: 1,
      purpose: "",
    });
  }

  function handleStartTimeChange(newStartTime) {
    setModalError("");
    const validEnds = bookingEndTimes(TIME_SLOTS, newStartTime, bookingModal?.space_type);
    let nextEndTime = bookingForm.end_time;
    if (!validEnds.includes(nextEndTime)) {
      nextEndTime = validEnds[0] || "";
    }
    setBookingForm({
      ...bookingForm,
      start_time: newStartTime,
      end_time: nextEndTime,
    });
  }

  async function handleBookingSubmit(e) {
    e.preventDefault();
    if (!bookingModal) return;
    setModalError("");

    if (!bookingForm.date) {
      setModalError("Please select a booking date.");
      return;
    }

    if (bookingForm.date < todayStr) {
      setModalError("Cannot book spaces for a past date.");
      return;
    }

    if (bookingForm.start_time >= bookingForm.end_time) {
      setModalError("End time must be after start time.");
      return;
    }

    if (bookingModal.space_type === "pod" && bookingMinutes(bookingForm.end_time) - bookingMinutes(bookingForm.start_time) > 120) {
      setModalError("Study pod bookings cannot exceed 2 hours per booking.");
      return;
    }

    if (!bookingStartTimes(TIME_SLOTS, bookingForm.date).includes(bookingForm.start_time)) {
      setModalError("Choose a booking start time in the future.");
      return;
    }
    const attendees = Number(bookingForm.attendees_count) || 1;
    if (attendees < 1) {
      setModalError("Please enter at least 1 student.");
      return;
    }
    if (attendees > bookingModal.capacity) {
      setModalError(`Maximum capacity for ${bookingModal.name} is ${bookingModal.capacity} students.`);
      return;
    }

    setSubmitting(true);
    try {
      const res = await api("/spaces/book/", {
        method: "POST",
        body: formBody({
          space_id: bookingModal.id,
          booking_date: bookingForm.date,
          start_time: bookingForm.start_time,
          end_time: bookingForm.end_time,
          attendees_count: String(attendees),
          purpose: bookingForm.purpose,
        }),
      });
      noticeText(setNotice, res.message || "Booking request submitted! Waiting for librarian approval.");
      setBookingModal(null);
      await loadData();
      setSubTab("my_bookings");
    } catch (err) {
      setModalError(err.message || "Failed to submit booking request.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCancelBooking(booking) {
    if (!confirm(`Cancel booking for ${booking.space_name} on ${booking.booking_date}?`)) return;
    setCancellingId(booking.id);
    try {
      const res = await api(`/student/space-bookings/${booking.id}/cancel/`, {
        method: "POST",
        body: formBody({}),
      });
      noticeText(setNotice, res.message || "Booking cancelled.");
      await loadData();
    } catch (err) {
      noticeText(setNotice, err.message, "error");
    } finally {
      setCancellingId("");
    }
  }

  const filteredSpaces = spaces.filter((space) => {
    const matchesQuery = `${space.name} ${space.location} ${space.description} ${space.amenities}`.toLowerCase().includes(spaceQuery.trim().toLowerCase());
    return matchesQuery && (!spaceType.length || spaceType.includes(space.space_type)) && (!availFilter.length || (availFilter.includes("empty_only") && (space.bookable_slots_count ?? space.empty_slots_count) > 0) || (availFilter.includes("occupied_only") && (space.occupied_slots_count > 0 || space.pending_slots_count > 0)));
  });

  const pendingCount = myBookings.filter((b) => b.status === "pending").length;

  return (
    <>
      <PageTitle
        eyebrow="STUDENT PORTAL / FACILITIES"
        title="Study Pods & Conference Rooms"
        note="Reserve quiet focus pods, duo study spaces, or conference rooms for your individual or group study sessions."
      />

      {loadError && <LoadError message={loadError} onRetry={loadData} />}

      {subTab === "browse" && <section className="space-booking-visual">
        <img src="/assets/study-space-pod.jpg" alt="A sunlit study pod with books, a desk lamp, and a quiet place to focus" loading="lazy" />
        <div className="space-booking-visual-copy"><span className="eyebrow">MAKE SPACE FOR A GOOD IDEA</span><h2>Find your focus corner.</h2><p>Choose a quiet pod for solo work or reserve a room when the group project needs a table.</p></div>
        <span className="space-booking-visual-note" aria-hidden="true">READ · THINK · REPEAT</span>
      </section>}

      <div className="subnav-tabs" role="tablist" aria-label="Student space booking sections">
        <button
          type="button"
          role="tab"
          id="student-space-tab-browse"
          aria-controls="student-space-panel-browse"
          aria-selected={subTab === "browse"}
          tabIndex={subTab === "browse" ? 0 : -1}
          className={`subnav-btn ${subTab === "browse" ? "active" : ""}`}
          onClick={() => setSubTab("browse")}
          onKeyDown={(event) => handleTabListKeyDown(event, ["browse", "my_bookings"], "student-space-tab-", setSubTab)}
        >
          Explore Spaces &amp; Slots
        </button>
        <button
          type="button"
          role="tab"
          id="student-space-tab-my_bookings"
          aria-controls="student-space-panel-my_bookings"
          aria-selected={subTab === "my_bookings"}
          tabIndex={subTab === "my_bookings" ? 0 : -1}
          className={`subnav-btn ${subTab === "my_bookings" ? "active" : ""}`}
          onClick={() => setSubTab("my_bookings")}
          onKeyDown={(event) => handleTabListKeyDown(event, ["browse", "my_bookings"], "student-space-tab-", setSubTab)}
        >
          My Bookings {pendingCount > 0 && <span className="subnav-badge">{pendingCount} pending</span>}
        </button>
      </div>

      {subTab === "browse" ? (
        <section id="student-space-panel-browse" className="booking-tab-panel" role="tabpanel" aria-labelledby="student-space-tab-browse" tabIndex={0}>
          <div className="space-filters">
            <div className="filter-group">
              <label className="filter-item">
                Date:
                <input
                  type="date"
                  min={todayStr}
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                />
              </label>


            </div>
            <button type="button" className="button light small" disabled={loading} onClick={loadData}>
              {loading ? "Checking…" : "Refresh schedule"}
            </button>
          </div>

          <RecordFilters query={spaceQuery} onQuery={setSpaceQuery} choices={{ space_type: spaceType, availability: availFilter }} onChoices={(choices) => { setSpaceType(choices.space_type || []); setAvailFilter(choices.availability || []); }} count={filteredSpaces.length} loading={loading} label="Search spaces, locations, or amenities" groups={[{ key: "space_type", label: "Space type", options: [{ value: "pod", label: "Study pods" }, { value: "room", label: "Conference rooms" }, { value: "slot", label: "Study slots" }] }, { key: "availability", label: "Availability", options: [{ value: "empty_only", label: "Free slots available" }, { value: "occupied_only", label: "Booked or pending slots" }] }]} />
          <div className="space-grid" aria-busy={loading}>
            {filteredSpaces.map((space) => (
              <article className="space-card" key={space.id}>
                <div className="space-top">
                  <div className="space-title-row">
                    <h3>{space.name}</h3>
                    <span className="pill">{space.space_type_display}</span>
                  </div>
                  <div className="space-meta">
                    <span><MapPin size={14} aria-hidden="true" /> {space.location || "Library"}</span>
                    <span><Users size={14} aria-hidden="true" /> Up to {space.capacity} {space.capacity === 1 ? "student" : "students"}</span>
                  </div>
                  {space.description && <p className="space-desc">{space.description}</p>}
                  {space.amenities && (
                    <div className="space-amenities-tags">
                      {space.amenities.split(",").map((am, idx) => (
                        <span className="amenity-tag" key={idx}>{am.trim()}</span>
                      ))}
                    </div>
                  )}

                  <div className="schedule-section">
                    <div className="schedule-header">
                      <b>Daily Timeline ({selectedDate})</b>
                      <div className="schedule-legend">
                        <span><i className="legend-dot empty" aria-hidden="true" /> Available</span>
                        <span><i className="legend-dot pending" /> Review</span>
                        <span><i className="legend-dot occupied" /> Booked</span>
                      </div>
                    </div>
                    <p className="slot-help">Choose an available time below to request a booking. Pending requests need librarian approval.</p>
                    <div className="slot-grid" role="group" aria-label={`Time slots for ${space.name} on ${selectedDate}`}>
                      {(space.schedule || []).map((slot, idx) => (
                        <button
                          type="button"
                          disabled={slot.status !== "empty" || slot.bookable === false}
                          key={idx}
                          className={`slot-pill ${slot.status}`}
                          aria-label={`${space.name}, ${selectedDate}, ${slot.start} to ${slot.end}: ${slot.status === "empty" && slot.bookable === false ? "Elapsed, unavailable" : slot.status === "empty" ? "Available, book this slot" : slot.status === "pending" ? "Pending approval, unavailable" : "Booked, unavailable"}`}
                          title={`${slot.start}-${slot.end}: ${slot.status === "empty" && slot.bookable === false ? "Elapsed slot" : slot.status === "empty" ? "Empty / Click to book" : slot.status === "pending" ? "Pending approval" : "Occupied"}`}
                          onClick={() => {
                            if (slot.status === "empty" && slot.bookable !== false) openBookingModal(space, slot);
                          }}
                        >
                          <span className="slot-time"><span>{slot.start}</span><span aria-hidden="true">–</span><span>{slot.end}</span></span>
                          <small>{slot.status === "empty" && slot.bookable === false ? "Elapsed" : slot.status === "empty" ? "Available" : slot.status === "pending" ? "Pending" : "Booked"}</small>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="space-card-foot">
                  <div className="space-summary-pills">
                    <span className="summary-pill empty">{space.empty_slots_count} Empty</span>
                    {space.occupied_slots_count > 0 && <span className="summary-pill occupied">{space.occupied_slots_count} Booked</span>}
                    {space.pending_slots_count > 0 && <span className="summary-pill pending">{space.pending_slots_count} Review</span>}
                  </div>
                  <button
                    type="button"
                    className="button primary small"
                    disabled={(space.bookable_slots_count ?? space.empty_slots_count) === 0}
                    onClick={() => openBookingModal(space)}
                  >
                    {(space.bookable_slots_count ?? space.empty_slots_count) === 0 ? "No future slots" : "Book Slot"}
                  </button>
                </div>
              </article>
            ))}
            {loading && <LoadingState label="Checking space schedules…" />}
            {!loading && !loadError && filteredSpaces.length === 0 && (
              <p className="empty" role="status">No spaces match the selected filters.</p>
            )}
          </div>
        </section>
      ) : <section id="student-space-panel-browse" role="tabpanel" aria-labelledby="student-space-tab-browse" hidden />}

      {subTab === "my_bookings" ? (
        <section id="student-space-panel-my_bookings" className="panel" role="tabpanel" aria-labelledby="student-space-tab-my_bookings" tabIndex={0}>
          <div className="panel-head">
            <div>
              <span className="eyebrow">RESERVATIONS</span>
              <h3>Your Bookings &amp; Requests</h3>
            </div>
            <button type="button" className="button light small" disabled={loading} onClick={loadData}>
              {loading ? "Loading…" : "Refresh"}
            </button>
          </div>

          <div className="booking-list" aria-busy={loading}>
            {myBookings.map((b) => (
              <article className="booking-row-card" key={b.id}>
                <div className="booking-card-main">
                  <div className={`booking-card-icon ${b.space_type || "pod"}`}>
                    <BookOpen size={22} strokeWidth={1.7} aria-hidden="true" />
                  </div>
                  <div className="booking-card-details">
                    <b>{b.space_name}</b>
                    <div className="time-line">
                      <CalendarDays size={14} aria-hidden="true" /> {b.booking_date} · {b.start_time} - {b.end_time}
                    </div>
                    <div className="sub-line">
                      <span><Users size={14} aria-hidden="true" /> {b.attendees_count} {b.attendees_count === 1 ? "student" : "students"}</span>
                      <span>Requested {new Date(b.created_at).toLocaleDateString()}</span>
                    </div>
                    {b.purpose && <p className="purpose-note">“{b.purpose}”</p>}
                    {b.status === "rejected" && b.rejection_reason && (
                      <p className="rejection-note" style={{ color: "var(--red)", fontSize: "9px", marginTop: "4px" }}>
                        Reason: {b.rejection_reason}
                      </p>
                    )}
                  </div>
                </div>

                <div className="booking-card-status-col">
                  <span className={`status ${b.status}`}>
                    {b.status === "pending"
                      ? "Pending Approval"
                      : b.status === "confirmed"
                      ? "Confirmed"
                      : b.status === "rejected"
                      ? "Rejected"
                      : b.status}
                  </span>
                  {["pending", "confirmed"].includes(b.status) && (
                    <button
                      type="button"
                      className="button danger small"
                      disabled={cancellingId === b.id}
                      onClick={() => handleCancelBooking(b)}
                    >
                      {cancellingId === b.id ? "Cancelling…" : "Cancel booking"}
                    </button>
                  )}
                </div>
              </article>
            ))}
            {loading && <LoadingState label="Loading your space bookings…" />}
            {!loading && !loadError && myBookings.length === 0 && (
              <p className="empty" role="status">You haven't requested any space or pod bookings yet.</p>
            )}
          </div>
        </section>
      ) : <section id="student-space-panel-my_bookings" role="tabpanel" aria-labelledby="student-space-tab-my_bookings" hidden />}

      {bookingModal && (
        <div className="booking-modal-overlay" onClick={() => !submitting && setBookingModal(null)}>
          <div ref={bookingDialogRef} className="booking-modal" role="dialog" aria-modal="true" aria-labelledby={`${bookingDialogId}-title`} tabIndex={-1} onClick={(e) => e.stopPropagation()}>
            <div className="booking-modal-header">
              <div>
                <span className="eyebrow">{bookingModal.space_type_display}</span>
                <h3 id={`${bookingDialogId}-title`}>Book {bookingModal.name}</h3>
                <p><MapPin size={14} aria-hidden="true" /> {bookingModal.location} · Max capacity: {bookingModal.capacity} students</p>
              </div>
              <button
                type="button"
                className="modal-close-btn" aria-label="Close dialog"
                disabled={submitting}
                onClick={() => setBookingModal(null)}
              >
                ×
              </button>
            </div>

            <form className="stack-form" onSubmit={handleBookingSubmit}>
              {modalError && (
                <div
                  className="notice error"
                  role="alert"
                  aria-live="assertive"
                  style={{
                    margin: "0 0 14px",
                    padding: "9px 12px",
                    borderRadius: "6px",
                    fontSize: "12px",
                    fontWeight: "500",
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                  }}
                >
                  <span aria-hidden="true">⚠️</span>
                  <span>{modalError}</span>
                </div>
              )}

              <label>
                Booking Date
                <input
                  type="date"
                  min={todayStr}
                  required
                  value={bookingForm.date}
                  onChange={(e) => {
                    setModalError("");
                    const date = e.target.value;
                    const starts = bookingStartTimes(TIME_SLOTS, date);
                    const start = starts.includes(bookingForm.start_time) ? bookingForm.start_time : (starts[0] || "");
                    const ends = bookingEndTimes(TIME_SLOTS, start, bookingModal.space_type);
                    setBookingForm({ ...bookingForm, date, start_time: start, end_time: ends.includes(bookingForm.end_time) ? bookingForm.end_time : (ends[0] || "") });
                  }}
                />
              </label>

              {bookingModal.space_type === "pod" && <p className="pod-booking-limit">Study pods can be booked for up to 2 hours per booking.</p>}
              <div className="two-fields">
                <label>
                  Start Time
                  <select
                    value={bookingForm.start_time}
                    onChange={(e) => handleStartTimeChange(e.target.value)}
                  >
                    {bookingStartTimes(TIME_SLOTS, bookingForm.date).map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </label>
                <label>
                  End Time
                  <select
                    value={bookingForm.end_time}
                    onChange={(e) => {
                      setModalError("");
                      setBookingForm({ ...bookingForm, end_time: e.target.value });
                    }}
                  >
                    {bookingEndTimes(TIME_SLOTS, bookingForm.start_time, bookingModal.space_type).map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </label>
              </div>

              <label>
                How many students will use this space?
                <input
                  type="number"
                  min="1"
                  max={bookingModal.capacity}
                  required
                  value={bookingForm.attendees_count}
                  onChange={(e) => {
                    setModalError("");
                    setBookingForm({ ...bookingForm, attendees_count: parseInt(e.target.value) || 1 });
                  }}
                />
                <small className="muted" style={{ fontSize: "9px" }}>
                  Selected capacity: 1 to {bookingModal.capacity} students
                </small>
              </label>

              <label>
                Purpose / Study Topic (optional)
                <input
                  maxLength="250"
                  placeholder="e.g. Group exam study, team presentation practice"
                  value={bookingForm.purpose}
                  onChange={(e) => setBookingForm({ ...bookingForm, purpose: e.target.value })}
                />
              </label>

              <div className="auth-note" style={{ margin: "4px 0" }}>
                <span>ℹ️</span> When submitted, this request goes to the librarian portal for approval. Once a librarian approves it, your slot is confirmed!
              </div>

              <div className="two-fields" style={{ marginTop: "12px" }}>
                <button
                  type="button"
                  className="button light"
                  disabled={submitting}
                  onClick={() => setBookingModal(null)}
                >
                  Cancel
                </button>
                <button type="submit" className="button primary" disabled={submitting}>
                  {submitting ? "Booking Slot…" : "Book Slot (Send for Approval)"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

function LibrarianSpaceBookingsPage({ setNotice }) {
  const [bookings, setBookings] = useState([]);
  const [spaces, setSpaces] = useState([]);
  const [subTab, setSubTab] = useState("requests");
  const [bookingQuery, setBookingQuery] = useState("");
  const [bookingFilters, setBookingFilters] = useState({});
  const visibleBookings = filterRows(bookings, bookingQuery, bookingFilters);
  const [dateFilter, setDateFilter] = useState("");
  const [scheduleDate, setScheduleDate] = useState(getLocalDateStr());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const requestSequence = useRef(0);
  const [busyId, setBusyId] = useState("");
  const [rejectingBooking, setRejectingBooking] = useState(null);
  const rejectDialogRef = useRef(null);
  const rejectDialogId = useId();
  const [rejectReason, setRejectReason] = useState("");
  useAccessibleDialog(Boolean(rejectingBooking), rejectDialogRef, () => setRejectingBooking(null));

  const loadData = useCallback(async () => {
    const sequence = ++requestSequence.current;
    setLoading(true);
    setLoadError("");
    try {
      const params = new URLSearchParams();
      if (dateFilter) params.append("date", dateFilter);

      const [bookingsData, spacesData] = await Promise.all([
        api(`/librarian/space-bookings/?${params}`),
        api(`/spaces/?date=${encodeURIComponent(scheduleDate)}`),
      ]);
      if (sequence !== requestSequence.current) return;
      setBookings(bookingsData.results || []);
      setSpaces(spacesData.results || []);
    } catch (err) {
      if (sequence === requestSequence.current) setLoadError(err.message);
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, [dateFilter, scheduleDate]);

  useEffect(() => { loadData(); }, [loadData]);

  async function review(booking, action, reason = "") {
    setBusyId(booking.id);
    try {
      const res = await api(`/librarian/space-bookings/${booking.id}/${action}/`, {
        method: "POST",
        body: formBody({ reason }),
      });
      noticeText(setNotice, res.message || `Booking ${action === "approve" ? "confirmed" : "rejected"}.`);
      setRejectingBooking(null);
      setRejectReason("");
      await loadData();
    } catch (err) {
      noticeText(setNotice, err.message, "error");
    } finally {
      setBusyId("");
    }
  }

  const pendingList = bookings.filter((b) => b.status === "pending");
  const confirmedList = bookings.filter((b) => b.status === "confirmed");

  return (
    <>
      <PageTitle
        eyebrow="LIBRARY DESK / RESERVATIONS"
        title="Space & Pod Bookings"
        note="Review student booking requests for study pods, conference rooms, and research slots."
        action={
          <button type="button" className="button light" disabled={loading} onClick={loadData}>
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        }
      />

      {loadError && <LoadError message={loadError} onRetry={loadData} />}

      <div className="stats-grid">
        <StatCard label="Pending Approval" value={pendingList.length} note="Requests waiting for review" />
        <StatCard label="Confirmed Bookings" value={confirmedList.length} note="Active confirmed reservations" />
        <StatCard label="Total Library Spaces" value={spaces.length || 10} note="Pods, rooms & slots" />
      </div>

      <div className="subnav-tabs" role="tablist" aria-label="Librarian space booking sections">
        <button
          type="button"
          role="tab"
          id="librarian-space-tab-requests"
          aria-controls="librarian-space-panel-requests"
          aria-selected={subTab === "requests"}
          tabIndex={subTab === "requests" ? 0 : -1}
          className={`subnav-btn ${subTab === "requests" ? "active" : ""}`}
          onClick={() => setSubTab("requests")}
          onKeyDown={(event) => handleTabListKeyDown(event, ["requests", "schedule"], "librarian-space-tab-", setSubTab)}
        >
          Booking Requests {pendingList.length > 0 && <span className="subnav-badge">{pendingList.length} pending</span>}
        </button>
        <button
          type="button"
          role="tab"
          id="librarian-space-tab-schedule"
          aria-controls="librarian-space-panel-schedule"
          aria-selected={subTab === "schedule"}
          tabIndex={subTab === "schedule" ? 0 : -1}
          className={`subnav-btn ${subTab === "schedule" ? "active" : ""}`}
          onClick={() => setSubTab("schedule")}
          onKeyDown={(event) => handleTabListKeyDown(event, ["requests", "schedule"], "librarian-space-tab-", setSubTab)}
        >
          Live Spaces &amp; Availability
        </button>
      </div>

      {subTab === "requests" ? (
        <section id="librarian-space-panel-requests" className="panel" role="tabpanel" aria-labelledby="librarian-space-tab-requests" tabIndex={0}>
          <div className="space-filters" style={{ margin: "0 0 16px" }}>
            <div className="filter-group">

              <label className="filter-item">
                Date:
                <input
                  type="date"
                  value={dateFilter}
                  onChange={(e) => setDateFilter(e.target.value)}
                />
              </label>
              {dateFilter && (
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setDateFilter("")}
                  style={{ fontSize: "10px" }}
                >
                  Clear date
                </button>
              )}

            </div>
          </div>

          <RecordFilters query={bookingQuery} onQuery={setBookingQuery} choices={bookingFilters} onChoices={setBookingFilters} count={visibleBookings.length} loading={loading} label="Search student, ID, room, or purpose" groups={[{ key: "status", label: "Booking status", options: [{ value: "pending", label: "Pending" }, { value: "confirmed", label: "Confirmed" }, { value: "rejected", label: "Rejected" }, { value: "cancelled", label: "Cancelled" }] }, { key: "space_type", label: "Space type", options: [{ value: "pod", label: "Study pods" }, { value: "room", label: "Conference rooms" }, { value: "slot", label: "Study slots" }] }]} />
          <div className="booking-list" aria-busy={loading}>
            {visibleBookings.map((b) => (
              <article className="booking-row-card" key={b.id}>
                <div className="booking-card-main">
                  <div className={`booking-card-icon ${b.space_type || "pod"}`}>
                    <BookOpen size={22} strokeWidth={1.7} aria-hidden="true" />
                  </div>
                  <div className="booking-card-details">
                    <b>{b.space_name}</b>
                    <div className="time-line">
                      <CalendarDays size={14} aria-hidden="true" /> {b.booking_date} · {b.start_time} - {b.end_time}
                    </div>
                    <div className="sub-line">
                      <span>👤 <strong>{b.student_name}</strong> ({b.student_id})</span>
                      <span>📧 {b.student_email}</span>
                      <span><Users size={14} aria-hidden="true" /> {b.attendees_count} student(s)</span>
                      <span>Requested {new Date(b.created_at).toLocaleDateString()}</span>
                    </div>
                    {b.purpose && <p className="purpose-note">Purpose: “{b.purpose}”</p>}
                    {b.rejection_reason && (
                      <p style={{ color: "var(--red)", fontSize: "9.5px", marginTop: "3px" }}>
                        Declined: {b.rejection_reason}
                      </p>
                    )}
                  </div>
                </div>

                <div className="booking-card-status-col">
                  <span className={`status ${b.status}`}>
                    {b.status === "pending"
                      ? "Pending Approval"
                      : b.status === "confirmed"
                      ? "Confirmed"
                      : b.status === "rejected"
                      ? "Rejected"
                      : b.status}
                  </span>
                  {b.status === "pending" && (
                    <div className="row-actions">
                      <button
                        type="button"
                        className="button primary small"
                        disabled={Boolean(busyId)}
                        onClick={() => review(b, "approve")}
                      >
                        {busyId === b.id ? "Saving…" : "Approve & Confirm"}
                      </button>
                      <button
                        type="button"
                        className="button danger small"
                        disabled={Boolean(busyId)}
                        onClick={() => {
                          setRejectingBooking(b);
                          setRejectReason("");
                        }}
                      >
                        Reject
                      </button>
                    </div>
                  )}
                </div>
              </article>
            ))}
            {loading && <LoadingState label="Loading requests…" />}
            {!loading && !loadError && visibleBookings.length === 0 && (
              <p className="empty" role="status">No booking requests found for the selected filter.</p>
            )}
          </div>
        </section>
      ) : <section id="librarian-space-panel-requests" role="tabpanel" aria-labelledby="librarian-space-tab-requests" hidden />}

      {subTab === "schedule" ? (
        <section id="librarian-space-panel-schedule" className="panel" role="tabpanel" aria-labelledby="librarian-space-tab-schedule" tabIndex={0}>
          <div className="space-filters" style={{ margin: "0 0 18px" }}>
            <label className="filter-item">
              Check Schedule Date:
              <input
                type="date"
                value={scheduleDate}
                onChange={(e) => setScheduleDate(e.target.value)}
              />
            </label>
          </div>

          <div className="space-grid" aria-busy={loading}>
            {spaces.map((sp) => (
              <article className="space-card" key={sp.id}>
                <div className="space-top">
                  <div className="space-title-row">
                    <h3>{sp.name}</h3>
                    <span className="pill">{sp.space_type_display}</span>
                  </div>
                  <div className="space-meta">
                    <span><MapPin size={14} aria-hidden="true" /> {sp.location}</span>
                    <span><Users size={14} aria-hidden="true" /> Up to {sp.capacity} students</span>
                  </div>
                  <div className="schedule-section">
                    <div className="schedule-header">
                      <b>Hourly Occupancy ({scheduleDate})</b>
                      <div className="schedule-legend">
                        <span><i className="legend-dot empty" aria-hidden="true" /> Available</span>
                        <span><i className="legend-dot pending" /> Pending</span>
                        <span><i className="legend-dot occupied" /> Booked</span>
                      </div>
                    </div>
                    <div className="slot-grid">
                      {(sp.schedule || []).map((slot, idx) => (
                        <div key={idx} className={`slot-pill ${slot.status}`}>
                          <span className="slot-time"><span>{slot.start}</span><span aria-hidden="true">–</span><span>{slot.end}</span></span>
                          <small>{slot.status === "empty" ? "Available" : slot.status === "pending" ? "Pending" : "Booked"}</small>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="space-card-foot">
                  <div className="space-summary-pills">
                    <span className="summary-pill empty">{sp.empty_slots_count} Empty</span>
                    {sp.occupied_slots_count > 0 && <span className="summary-pill occupied">{sp.occupied_slots_count} Booked</span>}
                    {sp.pending_slots_count > 0 && <span className="summary-pill pending">{sp.pending_slots_count} Review</span>}
                  </div>
                </div>
              </article>
            ))}
            {loading && <LoadingState label="Loading space schedules…" />}
            {!loading && !loadError && spaces.length === 0 && <p className="empty" role="status">No library spaces are available for this date.</p>}
          </div>
        </section>
      ) : <section id="librarian-space-panel-schedule" role="tabpanel" aria-labelledby="librarian-space-tab-schedule" hidden />}

      {rejectingBooking && (
        <div className="booking-modal-overlay" onClick={() => setRejectingBooking(null)}>
          <div ref={rejectDialogRef} className="booking-modal" role="dialog" aria-modal="true" aria-labelledby={`${rejectDialogId}-title`} tabIndex={-1} onClick={(e) => e.stopPropagation()}>
            <div className="booking-modal-header">
              <div>
                <span className="eyebrow">DECLINE REQUEST</span>
                <h3 id={`${rejectDialogId}-title`}>Reject Booking Request</h3>
                <p>{rejectingBooking.space_name} · {rejectingBooking.booking_date} ({rejectingBooking.start_time} - {rejectingBooking.end_time})</p>
              </div>
              <button
                type="button"
                className="modal-close-btn" aria-label="Close dialog"
                onClick={() => setRejectingBooking(null)}
              >
                ×
              </button>
            </div>
            <form
              className="stack-form"
              onSubmit={(e) => {
                e.preventDefault();
                review(rejectingBooking, "reject", rejectReason);
              }}
            >
              <label>
                Reason for rejection (optional)
                <textarea
                  rows="3"
                  maxLength="250"
                  placeholder="e.g. Space undergoes scheduled maintenance, or overlaps with library event"
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                />
              </label>
              <div className="two-fields" style={{ marginTop: "10px" }}>
                <button
                  type="button"
                  className="button light"
                  onClick={() => setRejectingBooking(null)}
                >
                  Cancel
                </button>
                <button type="submit" className="button danger" disabled={Boolean(busyId)}>
                  {busyId ? "Rejecting…" : "Confirm Rejection"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}


function ScannedBook({ copy, busy, onIssue }) {
  const book = copy.book;
  return <section className="book-detail-hero" aria-label="Scanned book details">
    <div className="detail-cover-wrap"><BookCover book={book} /></div>
    <div>
      <span className="eyebrow">SCANNED COPY / BOOK DETAILS</span>
      <h3>{book.title}</h3>
      <p>By {book.author}</p>
      <p>{book.description || "No description has been added for this title."}</p>
      <div className="slip-facts">
        <span><small>Category</small><b>{book.category || "Uncategorised"}</b></span>
        <span><small>ISBN</small><b>{book.isbn || "Not provided"}</b></span>
        <span><small>Copy ID</small><b>{copy.copy_id}</b></span>
        <span><small>Shelf</small><b>{copy.shelf || book.shelf || "Unassigned"}</b></span>
        <span><small>Free copies / total</small><b>{book.available_to_borrow} / {book.total}</b></span>
        <span><small>This copy</small><b>{copy.status === "available" ? "Available" : copy.status === "borrowed" ? "On loan" : copy.status}</b></span>
      </div>
      <p className="slip-help">{copy.status === "available" ? "Check these details, then confirm to borrow this exact copy." : "This copy is not available for checkout. Scan another copy."}</p>
      {copy.status === "available" && <button className="button primary" disabled={busy} onClick={onIssue}>{busy ? "Checking out…" : "Confirm checkout"}</button>}
    </div>
  </section>;
}

function RenewalRequestControl({ loan, days, busy, retry = false, onDaysChange, onRequest }) {
  return <div className="renewal-request-controls">
    <label>
      <span className="sr-only">Extension length for {loan.book_title}</span>
      <select
        className="renewal-days-select"
        aria-label={`Extension length for ${loan.book_title}`}
        value={days}
        disabled={busy}
        onChange={(event) => onDaysChange(event.target.value)}
      >
        {Array.from({ length: 14 }, (_, index) => index + 1).map((count) => <option key={count} value={count}>{count} {count === 1 ? "day" : "days"}</option>)}
      </select>
    </label>
    <button className="button light small" type="button" disabled={busy} onClick={() => onRequest(loan, Number(days))}>
      {busy ? "Sending…" : retry ? "Request again" : "Request renewal"}
    </button>
  </div>;
}

function StudentPortal({ user, tab, setTab, setNotice, selectedBook, onOpenBook, onBackToBooks, onBookRatingChange }) {
  const [loans, setLoans] = useState([]);
  const [fines, setFines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const loadSequence = useRef(0);
  const [busy, setBusy] = useState(false);
  const [renewingLoanId, setRenewingLoanId] = useState("");
  const [renewalDays, setRenewalDays] = useState({});
  const [copyId, setCopyId] = useState("");
  const [copyInfo, setCopyInfo] = useState(null);
  const [scanOpen, setScanOpen] = useState(false);
  const [slip, setSlip] = useState(null);

  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setLoading(true);
    setLoadError("");
    try {
      if (tab === "my_loans") {
        const result = await api("/student/loans/");
        if (sequence === loadSequence.current) setLoans(result.results);
      }
      if (tab === "my_fines") {
        const result = await api("/fines/");
        if (sequence === loadSequence.current) setFines(result.results);
      }
    } catch (error) {
      if (sequence === loadSequence.current) setLoadError(error.message);
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }, [tab]);
  useEffect(() => { load(); }, [load]);

  async function scanned(value) {
    setScanOpen(false);
    setCopyId(value);
    setSlip(null);
    try {
      setCopyInfo(await api(`/copies/${encodeURIComponent(value)}/`));
    } catch (error) {
      setCopyInfo(null);
      noticeText(setNotice, error.message, "error");
    }
  }

  async function issueCopy() {
    setBusy(true);
    try {
      const result = await api("/student/issue/", { method: "POST", body: formBody({ copy_id: copyId }) });
      openIssueSlip(result.loan);
      setCopyInfo({ ...copyInfo, status: "borrowed" });
      noticeText(setNotice, "Book issued. Your issue slip is ready.");
    } catch (error) {
      noticeText(setNotice, error.message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function requestRenewal(loan, daysRequested) {
    setRenewingLoanId(loan.id);
    try {
      await api("/student/renewals/", { method: "POST", body: formBody({ loan_id: loan.id, days_requested: daysRequested }) });
      await load();
      noticeText(setNotice, `Renewal request for ${daysRequested} day${daysRequested === 1 ? "" : "s"} sent to the library.`);
    } catch (error) {
      noticeText(setNotice, error.message, "error");
    } finally {
      setRenewingLoanId("");
    }
  }

  function openIssueSlip(loan) {
    setSlip(loan);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const dueAlerts = loans.filter((loan) => ["due_soon", "overdue"].includes(loan.due_status));

  if (tab === "space_bookings") return <StudentSpaceBookingsPage user={user} setNotice={setNotice} />;

  if (tab === "catalogue") return <>
    <section className="student-welcome"><div><span className="eyebrow">YOUR CAMPUS LIBRARY</span><h2>Hello, {user.name.split(" ")[0]}.</h2><p>Find a title that interests you, then check out the exact copy from its QR label.</p></div><LibraryArt className="welcome-illustration" /></section>
    <CatalogueExplorer path="/catalogue/" renderBook={(book) => <CatalogueTile key={book.id} book={book} onOpen={onOpenBook} />} />
  </>;

  if (tab === "scan_copy") return <>
    <PageTitle eyebrow="STUDENT PORTAL / READY TO BORROW" title="Scan your copy" note="Scan the QR label on your chosen physical copy, then confirm checkout." action={<button className="button light" onClick={onBackToBooks}>← Browse books</button>} />
    {slip && <IssueSlip loan={slip} onClose={() => setSlip(null)} />}
    <section className="panel scan-student"><div><span className="eyebrow">READY TO BORROW</span><h3>Scan your copy</h3><p>Sign in first, scan the QR label, and confirm the issue. You can borrow up to five books.</p><button className="button primary" disabled={busy} onClick={() => setScanOpen((open) => !open)}>{scanOpen ? "Close camera" : "Open QR scanner"}</button></div><div className="scan-side"><span className="scan-symbol" aria-hidden="true">⌗</span><span>Scan a copy to see its full book details.</span></div></section>
    {copyInfo && <ScannedBook copy={copyInfo} busy={busy} onIssue={issueCopy} />}
    <Scanner open={scanOpen} onScan={scanned} onError={(message) => noticeText(setNotice, message, "error")} />
  </>;

  if (tab === "student_book") return <>
    <PageTitle eyebrow="STUDENT CATALOGUE / TITLE DETAILS" title={selectedBook.title} note={`${selectedBook.author} · ${selectedBook.category}`} action={<button className="button light" onClick={onBackToBooks}>← Back to books</button>} />
    <section className="book-detail-hero"><div className="detail-cover-wrap"><BookCover book={selectedBook} /></div><div><span className="eyebrow">{selectedBook.category}</span><h3>{selectedBook.title}</h3><p>{selectedBook.description || "Find this title on the library shelves."}</p><BookRating rating={selectedBook.average_rating} count={selectedBook.rating_count} /><div className="detail-stats"><span><b>{selectedBook.available_to_borrow}</b> copies free to borrow</span><span><b>{selectedBook.total}</b> copies in the library</span><span>Shelf <b>{selectedBook.shelf || "Unassigned"}</b></span></div></div></section>
    <section className="panel detail-next-step"><span className="eyebrow">{selectedBook.available_to_borrow > 0 ? "READY TO BORROW" : "CURRENTLY UNAVAILABLE"}</span><h3>{selectedBook.available_to_borrow > 0 ? "Scan the QR on your chosen copy" : "All copies are currently in use"}</h3><p>{selectedBook.available_to_borrow > 0 ? "Open the scanner to check out your chosen copy. The librarian scans the same copy QR when you return it." : "Please check the catalogue again after a copy is returned."}</p>{selectedBook.available_to_borrow > 0 && <button className="button primary" onClick={() => { setTab("scan_copy"); window.scrollTo({ top: 0 }); }}>Go to scanner</button>}</section>
    <StudentBookReviews key={selectedBook.id} book={selectedBook} setNotice={setNotice} onRatingChange={onBookRatingChange} />
  </>;

  if (tab === "my_loans") return <>
    <PageTitle eyebrow="STUDENT PORTAL / CIRCULATION" title="My loans" note="Your active issues, due-date alerts, and return dates." />
    {loadError && <LoadError message={loadError} onRetry={load} />}
    {slip && <IssueSlip loan={slip} onClose={() => setSlip(null)} />}
    {dueAlerts.length > 0 && <section className="due-alert-list" aria-label="Due date alerts">{dueAlerts.map((loan) => <article className={`due-alert ${loan.due_status}`} key={loan.id}><span className="due-alert-icon" aria-hidden="true">{loan.due_status === "overdue" ? "!" : "◷"}</span><div><b>{loan.book_title}</b><span>{loan.due_message}{loan.due_status === "overdue" && Number(loan.current_fine) > 0 ? ` · Current fine ₹${loan.current_fine}` : ""}</span></div></article>)}</section>}
    <section className="panel"><div className="table-scroll" aria-busy={loading}><table><thead><tr><th>Book</th><th>Copy ID</th><th>Issue ID</th><th>Due date</th><th>Fine today</th><th>Status</th><th>Renewal (up to 14 days)</th><th>Slip / return QR</th></tr></thead><tbody>{loans.map((loan) => {
      const days = renewalDays[loan.id] || "14";
      const renewing = renewingLoanId === loan.id;
      const renewalControl = <RenewalRequestControl loan={loan} days={days} busy={renewing} onDaysChange={(value) => setRenewalDays((current) => ({ ...current, [loan.id]: value }))} onRequest={requestRenewal} />;
      return <tr key={loan.id}><td><b>{loan.book_title}</b><small>{loan.book_author}</small></td><td><code>{loan.copy_id}</code></td><td><code>{loan.issue_code}</code></td><td>{new Date(loan.due_at).toLocaleDateString()}</td><td>{loan.current_fine === "0" ? "—" : `₹${loan.current_fine}`}</td><td><span className={`status ${loan.status}`}>{loan.status}</span></td><td>{loan.renewal_status === "pending" ? <span className="status pending">In review</span> : loan.renewal_status === "approved" ? <span className="status approved">Renewed</span> : loan.renewal_status === "rejected" ? <div className="renewal-rejected"><span className="status rejected">Declined</span>{loan.renewal_allowed && <RenewalRequestControl loan={loan} days={days} busy={renewing} retry onDaysChange={(value) => setRenewalDays((current) => ({ ...current, [loan.id]: value }))} onRequest={requestRenewal} />}</div> : loan.renewal_allowed ? renewalControl : "—"}</td><td><button className="button light small" onClick={() => openIssueSlip(loan)}>{loan.status === "borrowed" ? "Open return QR & slip" : "Open issue slip"}</button></td></tr>;
    })}</tbody></table>{loading && <LoadingState label="Loading your loans…" />}{!loading && !loadError && loans.length === 0 && <p className="empty" role="status">You do not have any loans yet.</p>}</div></section>
  </>;

  return <>
    <PageTitle eyebrow="STUDENT PORTAL / ACCOUNT" title="My fines" note="The current overdue amount starts on the calendar day after your due date." />
    {loadError && <LoadError message={loadError} onRetry={load} />}
    <section className="student-fine-summary" aria-label="Outstanding fine balance">
      <div><span className="eyebrow">OUTSTANDING BALANCE</span><strong>{loading ? "—" : `₹${fines.filter((fine) => fine.status === "unpaid").reduce((total, fine) => total + Number(fine.amount), 0).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`}</strong><p>{loading ? "Checking your current fine balance…" : fines.some((fine) => fine.status === "unpaid") ? "Please visit the library desk to settle your balance." : "You are all clear. There are no unpaid fines on your account."}</p></div>
      <span className="student-fine-count" aria-live="polite">{loading ? "Loading…" : `${fines.filter((fine) => fine.status === "unpaid").length} unpaid`}</span>
    </section>
    <section className="panel"><div className="panel-head"><div><span className="eyebrow">YOUR ACCOUNT</span><h3>Fine history</h3></div><button className="button light small" disabled={loading} onClick={load}>{loading ? "Refreshing…" : "Refresh fines"}</button></div><div className="fine-list" aria-busy={loading}>{fines.map((fine) => <article className="fine-row" key={fine.id}><div className="fine-amount">₹{Number(fine.amount).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}</div><div className="fine-info"><b>{fine.reason}</b><span>{fine.fine_type === "overdue" ? "Overdue fine" : "Custom fine"}</span><small>{new Date(fine.created_at).toLocaleDateString()}{fine.paid_at ? ` · Paid ${new Date(fine.paid_at).toLocaleDateString()}` : ""}</small></div><span className={`status ${fine.status}`}>{fine.status}</span></article>)}{loading && <LoadingState label="Loading your fines…" />}{!loading && !loadError && fines.length === 0 && <p className="empty" role="status">You do not have any fines.</p>}</div></section>
  </>;
}

function NotificationCenter({ user, onNavigate }) {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [readIds, setReadIds] = useState(() => {
    try {
      const stored = JSON.parse(window.localStorage.getItem(`campusshelf.notifications.read.${user.role}.${user.id}`) || "[]");
      return Array.isArray(stored) ? stored : [];
    } catch {
      return [];
    }
  });
  const rootRef = useRef(null);
  const storageKey = `campusshelf.notifications.read.${user.role}.${user.id}`;
  const unreadCount = items.filter((item) => !readIds.includes(item.id)).length;
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const result = await api("/notifications/");
      setItems(result.results || []);
    } catch {
      // Keep the last successful snapshot visible while the service reconnects.
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 60000);
    return () => window.clearInterval(timer);
  }, [refresh, user.id]);

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(readIds.slice(-250)));
    } catch {
      // Notifications still work for the current session if browser storage is disabled.
    }
  }, [readIds, storageKey]);

  useEffect(() => {
    if (!open) return undefined;
    const closeOutside = (event) => { if (!rootRef.current?.contains(event.target)) setOpen(false); };
    const closeOnEscape = (event) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  function markRead(id) {
    setReadIds((current) => current.includes(id) ? current : [...current, id].slice(-250));
  }

  function openNotification(item) {
    markRead(item.id);
    setOpen(false);
    onNavigate(item.route);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return <div className="notification-center" ref={rootRef}>
    <button className="notification-trigger" type="button" aria-label={`Notifications${unreadCount ? `, ${unreadCount} unread` : ""}`} aria-haspopup="dialog" aria-expanded={open} aria-controls="notification-popover" onClick={() => { setOpen((value) => !value); refresh(); }}>
      <Bell size={18} strokeWidth={1.8} aria-hidden="true" />
      {unreadCount > 0 && <span className="notification-count" aria-hidden="true">{unreadCount > 9 ? "9+" : unreadCount}</span>}
    </button>
    {open && <section className="notification-popover" id="notification-popover" role="dialog" aria-label="Notifications">
      <div className="notification-popover-head"><div><span className="eyebrow">{user.role === "student" ? "YOUR LIBRARY" : "LIBRARY DESK"}</span><h2>Notifications <span>{unreadCount}</span></h2></div><button type="button" className="notification-close" aria-label="Close notifications" onClick={() => setOpen(false)}><X size={17} aria-hidden="true" /></button></div>
      <div className="notification-actions">{unreadCount > 0 && <button className="notification-mark-all" type="button" onClick={() => setReadIds(items.map((item) => item.id))}><CheckCheck size={15} aria-hidden="true" /> Mark all as read</button>}<button className="notification-refresh" type="button" onClick={refresh} disabled={refreshing} aria-label="Refresh notifications"><RotateCw size={14} aria-hidden="true" className={refreshing ? "is-spinning" : ""} /> Refresh</button></div>
      <div className="notification-list" aria-live="polite">
        {items.map((item) => {
          const isRead = readIds.includes(item.id);
          const Icon = item.kind === "urgent" ? CircleAlert : item.kind === "success" ? Check : item.kind === "action" ? Clock3 : Bell;
          return <button className={`notification-item ${isRead ? "is-read" : "is-unread"} ${item.kind || ""}`} type="button" key={item.id} onClick={() => openNotification(item)}>
            <span className="notification-item-icon"><Icon size={17} strokeWidth={1.9} aria-hidden="true" /></span>
            <span className="notification-item-copy"><b>{item.title}</b><span>{item.message}</span><small>{new Date(item.created_at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</small></span>
            {!isRead && <span className="notification-unread-dot" aria-label="Unread" />}
          </button>;
        })}
        {items.length === 0 && <div className="notification-empty"><span className="notification-empty-mark"><Check size={19} aria-hidden="true" /></span><b>All caught up</b><span>New reminders and updates will show here.</span></div>}
      </div>
      <div className="notification-foot"><span>Updates automatically every minute</span><span className="notification-live-dot" /> </div>
    </section>}
  </div>;
}

export default function App() {
  const [user, setUser] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [fineMemberId, setFineMemberId] = useState("");
  const reducedMotion = useReducedMotion();
  const [setupAvailable, setSetupAvailable] = useState(false);
  const [tab, setTab] = useState("overview");
  const [selectedBook, setSelectedBook] = useState(null);
  const [notice, setNotice] = useState(null);
  const [loading, setLoading] = useState(true);
  const handleBookRatingChange = useCallback((ratings) => {
    setSelectedBook((book) => book ? { ...book, ...ratings } : book);
  }, []);
  const menuToggleRef = useRef(null);
  const drawerCloseRef = useRef(null);
  const sidebarRef = useRef(null);
  const routeHeadingRef = useRef(null);
  const lastRouteRef = useRef({ tab, userKey: null });

  useEffect(() => {
    api("/csrf/")
      .then(() => api("/auth/session/"))
      .then((data) => {
        setUser(data.user);
        setSetupAvailable(data.setup_available);
        if (data.user?.role === "student") setTab("catalogue");
      })
      .catch((error) => noticeText(setNotice, error.message, "error"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    drawerCloseRef.current?.focus();
    const handleDrawerKeys = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setMenuOpen(false);
        window.requestAnimationFrame(() => menuToggleRef.current?.focus());
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...(sidebarRef.current?.querySelectorAll("a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex]:not([tabindex='-1'])") || [])].filter((element) => element.getClientRects().length);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || !sidebarRef.current?.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !sidebarRef.current?.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleDrawerKeys);
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener("keydown", handleDrawerKeys); };
  }, [menuOpen]);

  useEffect(() => {
    if (menuOpen) return undefined;
    const closeGroups = () => sidebarRef.current?.querySelectorAll(".sidebar-nav-group[open], .sidebar-profile-menu[open]").forEach((group) => { clearNavigationClose(group); group.open = false; });
    const closeOnOutsideClick = (event) => {
      if (!sidebarRef.current?.contains(event.target)) closeGroups();
    };
    const closeOnEscape = (event) => {
      if (event.key !== "Escape") return;
      const openGroups = [...(sidebarRef.current?.querySelectorAll(".sidebar-nav-group[open], .sidebar-profile-menu[open]") || [])];
      if (!openGroups.length) return;
      event.preventDefault();
      closeGroups();
      openGroups[openGroups.length - 1].querySelector("summary")?.focus();
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuOpen]);

  useEffect(() => {
    const userKey = user?.login_id || user?.student_id || user?.id || null;
    if (user && (lastRouteRef.current.tab !== tab || lastRouteRef.current.userKey !== userKey)) {
      routeHeadingRef.current?.focus({ preventScroll: true });
    }
    lastRouteRef.current = { tab, userKey };
  }, [tab, user]);

  function closeMobileMenu() {
    setMenuOpen(false);
    window.requestAnimationFrame(() => menuToggleRef.current?.focus());
  }

  async function signIn(values) {
    const result = await api("/auth/login/", { method: "POST", body: formBody(values) });
    window.scrollTo({ top: 0 });
    setNotice(null);
    setUser(result.user);
    setTab(result.user.role === "student" ? "catalogue" : "overview");
  }

  async function setup(values) {
    const result = await api("/auth/setup/", { method: "POST", body: formBody(values) });
    setUser(result.user);
    setSetupAvailable(false);
    setTab("overview");
    noticeText(setNotice, `Librarian account created. Your sign-in ID is ${result.user.login_id}.`);
  }

  async function signup(values) {
    const result = await api("/signup/", { method: "POST", body: formBody(values) });
    if (result.user) {
      setUser(result.user);
      setTab("catalogue");
    }
    noticeText(setNotice, result.message);
  }

  async function signOut() {
    try {
      await api("/auth/logout/", { method: "POST", body: formBody({}) });
      setUser(null);
      setSetupAvailable(false);
      setTab("overview");
      noticeText(setNotice, "You have signed out.");
    } catch (error) {
      noticeText(setNotice, error.message, "error");
    }
  }

  if (loading) return <Preloader />;
  if (!user) return <><AuthScreen onLogin={signIn} onSetup={setup} onSignup={signup} setupAvailable={setupAvailable} />{notice && <div className={`toast ${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"} aria-live={notice.kind === "error" ? "assertive" : "polite"}>{notice.text}<button type="button" aria-label="Dismiss notification" onClick={() => setNotice(null)}>×</button></div>}<Chatbot user={null} /></>;

  const isStudent = user.role === "student";
  const tabs = isStudent ? studentTabs : librarianTabs;
  const navigationGroups = isStudent
    ? [["DISCOVER", ["catalogue", "scan_copy", "space_bookings"]], ["MY READING", ["my_loans", "my_history", "my_fines"]], ["ACCOUNT", ["account"]]]
    : [["LIBRARY", ["overview", "books", "add_book", "space_bookings"]], ["CIRCULATION", ["loans", "renewals", "transactions", "fines"]], ["COMMUNITY", ["requests", "students", "reviews"]], ["MANAGEMENT", ["reports", "account"]]];
  function openNavigationGroup(event) {
    const group = event.currentTarget;
    clearNavigationClose(group);
    sidebarRef.current?.querySelectorAll(".sidebar-nav-group[open]").forEach((openGroup) => {
      if (openGroup !== group) { clearNavigationClose(openGroup); openGroup.open = false; }
    });
    const profileMenu = sidebarRef.current?.querySelector(".sidebar-profile-menu[open]");
    if (profileMenu) { clearNavigationClose(profileMenu); profileMenu.open = false; }
    group.open = true;
  }
  function closeNavigationGroup(event) {
    if (!event.currentTarget.contains(event.relatedTarget) && !event.currentTarget.contains(document.activeElement)) scheduleNavigationClose(event.currentTarget);
  }
  function openProfileMenu(event) {
    const menu = event.currentTarget;
    clearNavigationClose(menu);
    sidebarRef.current?.querySelectorAll(".sidebar-nav-group[open]").forEach((group) => { clearNavigationClose(group); group.open = false; });
    menu.open = true;
  }
  function closeProfileMenu(event) {
    if (!event.currentTarget.contains(event.relatedTarget) && !event.currentTarget.contains(document.activeElement)) scheduleNavigationClose(event.currentTarget);
  }
  const activeTab = tab === "book_detail" || tab === "edit_book" ? "books" : tab === "student_book" ? "catalogue" : tab;
  const active = tabs.find((item) => item[0] === activeTab) || tabs[0];
  let content;
  if (tab === "account") content = <AccountPage user={user} setNotice={setNotice} />;
  else if (isStudent && tab === "my_history") content = <TransactionsPage setNotice={setNotice} student />;
  else if (isStudent) content = <StudentPortal key={tab} user={user} tab={tab} setTab={setTab} setNotice={setNotice} selectedBook={selectedBook} onOpenBook={(book) => { setSelectedBook(book); setTab("student_book"); }} onBackToBooks={() => setTab("catalogue")} onBookRatingChange={handleBookRatingChange} />;
  else if (tab === "overview") content = <Dashboard user={user} onNavigate={setTab} />;
  else if (tab === "books") content = <BooksPage onAddBook={() => setTab("add_book")} onOpenBook={(book) => { setSelectedBook(book); setTab("book_detail"); }} />;
  else if (tab === "add_book") content = <AddBookPage setNotice={setNotice} onCancel={() => setTab("books")} onSaved={(book) => { setSelectedBook(book); setTab("book_detail"); }} />;
  else if (tab === "edit_book" && selectedBook) content = <AddBookPage key={`edit-${selectedBook.id}`} book={selectedBook} setNotice={setNotice} onCancel={() => setTab("book_detail")} onSaved={(book) => { setSelectedBook(book); setTab("book_detail"); }} />;
  else if (tab === "book_detail" && selectedBook) content = <BookDetailPage key={selectedBook.id} book={selectedBook} onBack={() => setTab("books")} onEdit={(book) => { setSelectedBook(book); setTab("edit_book"); }} />;
  else if (tab === "book_detail") content = <BooksPage onAddBook={() => setTab("add_book")} onOpenBook={(book) => { setSelectedBook(book); setTab("book_detail"); }} />;
  else if (tab === "requests") content = <RequestsPage setNotice={setNotice} />;
  else if (tab === "space_bookings") content = <LibrarianSpaceBookingsPage setNotice={setNotice} />;
  else if (tab === "renewals") content = <RenewalsPage setNotice={setNotice} />;
  else if (tab === "transactions") content = <TransactionsPage setNotice={setNotice} />;
  else if (tab === "reports") content = <ReportsPage />;
  else if (tab === "students") content = <StudentsPage onAddFine={(member) => { setFineMemberId(member.id); setTab("fines"); window.scrollTo({ top: 0 }); }} />;
  else if (tab === "loans") content = <LoansPage setNotice={setNotice} />;
  else if (tab === "fines") content = <FinesPage key={fineMemberId} setNotice={setNotice} initialMemberId={fineMemberId} />;
  else content = <ReviewsPage setNotice={setNotice} />;

  return <div className={`app-shell ${isStudent ? "student-shell" : ""} ${menuOpen ? "menu-open" : ""}`}>
    <a className="skip-link" href="#portal-content">Skip to content</a>
    {menuOpen && <button className="nav-backdrop" type="button" aria-label="Close navigation" onClick={closeMobileMenu} />}
    <aside className="sidebar" id="portal-navigation" ref={sidebarRef} role={menuOpen ? "dialog" : undefined} aria-modal={menuOpen ? "true" : undefined} aria-label={menuOpen ? "Portal navigation" : undefined}>
      <button className="drawer-close" type="button" aria-label="Close navigation" ref={drawerCloseRef} onClick={closeMobileMenu}><X size={20} aria-hidden="true" /></button>
      <div className="sidebar-brand"><span className="sidebar-brand-mark"><img src="/assets/campusshelf-wordmark-icon.svg" alt="" /></span><div><b>CampusShelf</b><small>THE KNOWLEDGE CLUB</small></div></div>
      <div className="sidebar-portal-label"><span>{isStudent ? "READER PORTAL" : "LIBRARIAN DESK"}</span><i aria-hidden="true" /> <small>ONLINE</small></div>
      <nav className="sidebar-navigation" aria-label={isStudent ? "Student portal" : "Librarian workspace"}>{navigationGroups.map(([heading, keys]) => {
        const groupTabs = keys.map((key) => tabs.find(([tabKey]) => tabKey === key)).filter(Boolean);
        const groupIsActive = groupTabs.some(([key]) => activeTab === key);
        return <details
          className={`sidebar-nav-group ${groupIsActive ? "has-active" : ""}`}
          key={heading}
          onPointerEnter={(event) => { if (event.pointerType !== "touch") openNavigationGroup(event); }}
          onPointerLeave={(event) => { if (event.pointerType !== "touch") closeNavigationGroup(event); }}
        >
          <summary className="sidebar-nav-trigger"><span>{heading}</span></summary>
          <div className="sidebar-nav-items">{groupTabs.map(([key, label, icon]) => <button type="button" className={activeTab === key ? "active" : ""} key={key} aria-current={activeTab === key ? "page" : undefined} onClick={(event) => { setTab(key); setMenuOpen(false); event.currentTarget.closest("details")?.removeAttribute("open"); window.scrollTo({ top: 0 }); window.requestAnimationFrame(() => routeHeadingRef.current?.focus({ preventScroll: true })); }}><NavIcon name={icon} /><span>{label}</span>{activeTab === key && <span className="nav-active-dot" aria-hidden="true" />}</button>)}</div>
        </details>;
      })}</nav>
      <div className="sidebar-help"><span className="eyebrow">{isStudent ? "QUICK TIP" : "AT THE DESK"}</span><p>{isStudent ? "Scan a copy ID to issue a book. Bring returns to the librarian." : "Scan a copy’s unique ID when issuing or receiving a return."}</p>{!isStudent && <a href="/admin/">Open Django Admin <span aria-hidden="true">↗</span></a>}</div>
      <details
        className="sidebar-user sidebar-profile-menu"
        onPointerEnter={(event) => { if (event.pointerType !== "touch") openProfileMenu(event); }}
        onPointerLeave={(event) => { if (event.pointerType !== "touch") closeProfileMenu(event); }}
      >
        <summary className="sidebar-profile-trigger" aria-label={`Profile options for ${user.name}`}>
          <span className="avatar" aria-hidden="true">{user.name.slice(0, 1).toUpperCase()}</span>
          <span className="sidebar-user-copy"><b>{user.name}</b><small>{isStudent ? `STUDENT ID · ${user.student_id}` : `STAFF ID · ${user.login_id}`}</small></span>
          <span className="sidebar-online-dot" title="Signed in" aria-label="Signed in" />
        </summary>
        <div className="sidebar-profile-popover"><button className="signout-button" type="button" onClick={signOut}>Sign out</button></div>
      </details>
    </aside>
    <main className="main-area" aria-hidden={menuOpen || undefined} inert={menuOpen || undefined}><header className="topbar"><button ref={menuToggleRef} className="menu-toggle" type="button" aria-label={menuOpen ? "Close navigation" : "Open navigation"} aria-expanded={menuOpen} aria-controls="portal-navigation" onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X size={21} aria-hidden="true" /> : <Menu size={21} aria-hidden="true" />}</button><div><span className="eyebrow">{isStudent ? "STUDENT PORTAL" : "LIBRARIAN WORKSPACE"}</span><h1 ref={routeHeadingRef} tabIndex={-1}>{active[1]}</h1></div><div className="topbar-right"><span className="portal-chip">{isStudent ? "Reader account" : "Library staff"}</span><span className="top-date"><time dateTime={new Date().toISOString().slice(0, 10)}>{new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</time></span><NotificationCenter user={user} onNavigate={setTab} /></div></header>
      {notice && <div className={`notice ${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"} aria-live={notice.kind === "error" ? "assertive" : "polite"}>{notice.text}<button type="button" aria-label="Dismiss notification" onClick={() => setNotice(null)}>×</button></div>}
      <LazyMotion features={domAnimation}><AnimatePresence mode="wait" initial={false}><m.div id="portal-content" tabIndex={-1} className="page-content" key={tab + (selectedBook?.id || "")} initial={reducedMotion ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: reducedMotion ? 0 : -6 }} transition={{ duration: reducedMotion ? 0 : .2 }}>{content}</m.div></AnimatePresence></LazyMotion>
    </main>
    <Chatbot user={user} />
  </div>;
}
