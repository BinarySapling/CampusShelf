import { useCallback, useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { api, formBody } from "./api.js";
import Scanner from "./Scanner.jsx";
import Chatbot from "./Chatbot.jsx";
import LibraryArt from "./LibraryArt.jsx";
import { AnimatePresence, LazyMotion, domAnimation, m, useReducedMotion } from "motion/react";
import { BookOpen, CalendarDays, ChartNoAxesCombined, CircleUserRound, ClipboardList, LayoutDashboard, LibraryBig, MapPin, Menu, Plus, Receipt, Repeat2, Sparkles, Star, Users, X } from "lucide-react";

const librarianTabs = [
  ["overview", "Overview", "overview"],
  ["books", "Catalogue", "books"],
  ["add_book", "Add a title", "add_book"],
  ["reservations", "Book holds", "requests"],
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
  ["space_bookings", "Room & Pods", "bookings"],
  ["my_loans", "My loans", "loans"],
  ["my_history", "History", "loans"],
  ["my_holds", "My holds", "requests"],
  ["my_fines", "My fines", "fines"],
  ["account", "Account", "account"],
];

function noticeText(setNotice, text, kind = "success") {
  setNotice({ text, kind });
  window.setTimeout(() => setNotice(null), 4500);
}

function StatCard({ label, value, note }) {
  return <article className="stat-card"><div className="stat-symbol"><ChartNoAxesCombined size={19} strokeWidth={1.7} aria-hidden="true" /></div><span>{label}</span><strong>{value ?? "—"}</strong><small>{note}</small></article>;
}

function BookRating({ rating = 0, count = 0 }) {
  const average = Number(rating) || 0;
  const label = count ? `${average.toFixed(1)} out of 5 from ${count} reader rating${count === 1 ? "" : "s"}` : "No reader ratings yet";
  return <span className="book-rating" aria-label={label}>
    <span className="book-rating-stars" aria-hidden="true">{[1, 2, 3, 4, 5].map((star) => <span key={star} className={star <= Math.round(average) ? "is-rated" : ""}>★</span>)}</span>
    <small>{count ? `${average.toFixed(1)} · ${count} ${count === 1 ? "rating" : "ratings"}` : "No ratings yet"}</small>
  </span>;
}

function PageTitle({ eyebrow, title, note, action }) {
  return <div className="page-title"><div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2>{note && <p>{note}</p>}</div>{action}</div>;
}

function NavIcon({ name }) {
  const icons = { overview: LayoutDashboard, books: LibraryBig, add_book: Plus, bookings: CalendarDays,
    requests: ClipboardList, students: Users, loans: Repeat2, fines: Receipt, reviews: Star, account: CircleUserRound };
  const Icon = icons[name] || BookOpen;
  return <Icon className="nav-icon" size={20} strokeWidth={1.7} aria-hidden="true" />;
}

function BookCover({ book, compact = false }) {
  const tone = (book.title?.charCodeAt(0) || 0) % 4;
  return <div className={`book-cover-visual tone-${tone} ${compact ? "compact" : ""}`} aria-hidden="true">
    <span>{book.category || "CampusShelf edition"}</span>
    <strong>{book.title}</strong>
    <small>{book.author}</small>
    <i />
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
    <main className="auth-page">
      <section className="auth-card">
        <div className="auth-brand"><img src="/assets/campusshelf-emblem.png" alt="" /><div><b>CampusShelf</b><small>READ. CONNECT. DISCOVER.</small></div></div>
        <span className="eyebrow">YOUR NEXT CHAPTER STARTS HERE</span>
        <h1>{mode === "signup" ? "Create student account" : mode === "setup" ? "Set up the library desk" : "Welcome back"}</h1>
        <p className="muted">{mode === "signup" ? "Enter your campus details to create your library account immediately." : mode === "setup" ? "Create the first librarian account to get started." : "Sign in using your student ID, librarian ID, or email."}</p>
        {error && <div className="notice error">{error}</div>}
        <form className="stack-form" onSubmit={submit}>
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
  );
}

function Dashboard({ setNotice, onNavigate }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    api("/dashboard/")
      .then(setStats)
      .catch((error) => noticeText(setNotice, error.message, "error"))
      .finally(() => setLoading(false));
  }, []);
  return <>
    <section className="dashboard-hero">
      <div className="dashboard-hero-copy"><span className="eyebrow">THE LIBRARY DESK</span><h2>Make room for the next great read.</h2><p>One place to care for the collection, keep circulation moving, and welcome new readers.</p><button className="button hero-action" onClick={() => onNavigate("loans")}>Open circulation <span aria-hidden="true">↗</span></button></div>
      <div className="dashboard-stamp" aria-hidden="true"><span>READ</span><b>CS</b><span>RETURN · REPEAT</span></div>
    </section>
    <div className="dashboard-intro"><div><span className="eyebrow">TODAY AT THE LIBRARY</span><h2>Here is what is happening.</h2></div><span className="dashboard-date">Your library, at a glance</span></div>
    <div className="stats-grid">
      <StatCard label="Titles" value={loading ? "…" : stats?.books} note="In the catalogue" />
      <StatCard label="Physical copies" value={loading ? "…" : stats?.copies} note="Each one has a QR label" />
      <StatCard label="Students" value={loading ? "…" : stats?.members} note="Approved portal accounts" />
      <StatCard label="Books on loan" value={loading ? "…" : stats?.active_loans} note="Across all students" />
      <StatCard label="Late returns" value={loading ? "…" : stats?.overdue_loans} note="Fine starts the next day" />
      <StatCard label="Due soon" value={loading ? "…" : stats?.due_soon_loans} note="Due within three days" />
      <StatCard label="Requests to review" value={loading ? "…" : stats?.pending_requests} note="Approve before portal access" />
    </div>
    <div className="feature-note"><div className="feature-icon">₹</div><div><b>Overdue fines are calculated consistently</b><p>₹20 per calendar day after the due date, with a single charge recorded when a late book is returned.</p></div></div>
  </>;
}

function BooksPage({ setNotice, onAddBook, onOpenBook }) {
  const [books, setBooks] = useState([]);
  const [copies, setCopies] = useState(null);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [availability, setAvailability] = useState("all");
  const [categories, setCategories] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [loading, setLoading] = useState(true);

  async function loadBooks(query = search, page = 1, selectedCategory = category, selectedAvailability = availability) {
    setLoading(true);
    try {
      const params = new URLSearchParams({ q: query, page: String(page), category: selectedCategory, availability: selectedAvailability });
      const result = await api(`/books/?${params}`);
      setBooks(result.results);
      setCategories(result.categories || []);
      setPagination(result.pagination);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { loadBooks(search, 1, category, availability).catch((error) => noticeText(setNotice, error.message, "error")); }, []);

  async function showAllCopies() {
    try {
      const result = await api("/books/copies/");
      setCopies({ title: "All book copies", results: result.results });
    } catch (error) {
      noticeText(setNotice, error.message, "error");
    }
  }

  return <>
    <PageTitle eyebrow="COLLECTION / SEARCH" title="Find a title" note="Search the shelves, then open a title to see every copy and its status." action={<button className="button primary" onClick={onAddBook}>＋ Add a book</button>} />
    <section className="panel search-panel">
      <div className="panel-head"><div><span className="eyebrow">LIBRARY CATALOGUE</span><h3>Search books and authors</h3></div><button className="button light small" type="button" onClick={showAllCopies}>Print all QR labels</button></div>
      <form className="search-row" onSubmit={(event) => { event.preventDefault(); loadBooks(search, 1).catch((error) => noticeText(setNotice, error.message, "error")); }}><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Type a title or author" /><button className="button light" disabled={loading}>{loading ? "Loading…" : "Search"}</button></form>
      <div className="catalogue-filters"><label>Category<select value={category} onChange={(event) => { const value = event.target.value; setCategory(value); loadBooks(search, 1, value, availability).catch((error) => noticeText(setNotice, error.message, "error")); }}><option value="">All categories</option>{categories.map((item) => <option key={item} value={item}>{item}</option>)}</select></label><label>Availability<select value={availability} onChange={(event) => { const value = event.target.value; setAvailability(value); loadBooks(search, 1, category, value).catch((error) => noticeText(setNotice, error.message, "error")); }}><option value="all">Any status</option><option value="available">Available to borrow</option><option value="unavailable">Unavailable</option></select></label></div>
      <p className="route-hint">{loading ? "Loading the collection…" : `${pagination.total} title${pagination.total === 1 ? "" : "s"} · Select a book to edit details or open its copy labels.`}</p>
      <div className="catalogue-grid book-catalogue-grid">{books.map((book) => <button type="button" className="catalogue-card book-tile" key={book.id} onClick={() => onOpenBook(book)}>
        <BookCover book={book} />
        <span className="eyebrow">{book.category}</span><h3>{book.title}</h3><p>{book.author}</p><BookRating rating={book.average_rating} count={book.rating_count} />
        <div className="catalogue-footer"><span>{book.available_to_borrow} / {book.total} copies free</span><small>Shelf {book.shelf || "Unassigned"}</small></div>
        <span className="book-tile-link">Open copies →</span>
      </button>)}{loading && <p className="empty">Loading titles…</p>}{!loading && books.length === 0 && <p className="empty">No titles found. Try another search or add a new book.</p>}</div>
      <div className="pagination-controls"><span>Page {pagination.page} of {pagination.pages}</span><div><button className="button light small" disabled={loading || pagination.page <= 1} onClick={() => loadBooks(search, pagination.page - 1).catch((error) => noticeText(setNotice, error.message, "error"))}>← Previous</button><button className="button light small" disabled={loading || pagination.page >= pagination.pages} onClick={() => loadBooks(search, pagination.page + 1).catch((error) => noticeText(setNotice, error.message, "error"))}>Next →</button></div></div>
    </section>
    {copies && <section className="panel qr-panel"><div className="panel-head"><div><span className="eyebrow">PRINTABLE LABELS</span><h3>{copies.title}</h3></div><button className="button light" onClick={() => window.print()}>Print labels</button></div><div className="qr-grid">{copies.results.map((copy) => <article className="qr-card" key={copy.id}><QRCodeSVG value={copy.copy_id} size={120} />{copies.title === "All book copies" && <span>{copy.book_title}</span>}<b>{copy.copy_id}</b><span>{copy.status === "available" ? "Free" : "Allotted"} · {copy.shelf}</span></article>)}</div>{copies.results.length === 0 && <p className="empty">There are no physical copies to label yet.</p>}</section>}
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
        <div className="two-fields"><label>Number of physical copies<input name="copies" type="number" min="0" max="200" defaultValue={book?.total ?? 1} required /><small>Copies currently borrowed or held for pickup cannot be removed.</small></label><label>Shelf<input name="shelf" maxLength="30" placeholder="A-01" defaultValue={book?.shelf || ""} /></label></div>
        <label>Description<textarea name="description" maxLength="300" rows="4" placeholder="A short note about this title" defaultValue={book?.description || ""} /></label>
        <button className="button primary" disabled={busy}>{busy ? "Saving book…" : book ? "Save book changes" : "Save book"}</button>
      </form>
      <aside className="add-book-art"><div className="add-book-art-mark" aria-hidden="true"><BookCover book={{ title: "A new chapter", author: "CampusShelf", category: "YOUR COLLECTION" }} /></div><div><span className="eyebrow">ONE TITLE, MANY READERS</span><h3>Give every copy its own place.</h3><p>CampusShelf creates a unique Copy ID for each physical book so checkouts and returns stay tied to the right copy.</p></div></aside>
    </section>
  </>;
}

function BookDetailPage({ book, setNotice, onBack, onEdit }) {
  const [copies, setCopies] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api(`/books/${book.id}/copies/`)
      .then((data) => setCopies(data.results))
      .catch((error) => noticeText(setNotice, error.message, "error"))
      .finally(() => setLoading(false));
  }, [book.id]);

  const availableCount = copies.filter((copy) => copy.status === "available").length;
  const shelfLocations = [...new Set(copies.map((copy) => copy.shelf).filter(Boolean))];
  const shelfLabel = shelfLocations.length ? shelfLocations.join(", ") : book.shelf || "Unassigned";

  return <>
    <PageTitle eyebrow="BOOK DETAILS / PHYSICAL COPIES" title={book.title} note={`${book.author} · ${book.category}`} action={<div className="page-title-actions"><button className="button light" onClick={onBack}>← Back to titles</button><button className="button primary" onClick={() => onEdit(book)}>Edit details</button></div>} />
    <section className="book-detail-hero"><div className="detail-cover-wrap"><BookCover book={book} /></div><div><span className="eyebrow">{book.category}</span><h3>{book.title}</h3><p>{book.description || "A title in the CampusShelf collection."}</p><div className="detail-stats"><span><b>{book.total}</b> physical copies</span><span><b>{availableCount}</b> free to borrow</span><span><b>{copies.length - availableCount}</b> on loan</span><span><b>{shelfLocations.length > 1 ? "Shelves" : "Shelf"} {shelfLabel}</b></span></div></div></section>
    <section className="panel"><div className="panel-head"><div><span className="eyebrow">COPY BY COPY</span><h3>QR labels and availability</h3></div><button className="button light" disabled={loading || copies.length === 0} onClick={() => window.print()}>Print these labels</button></div>
      <div className="qr-grid copy-status-grid">{copies.map((copy) => <article className="qr-card copy-status-card" key={copy.id}><QRCodeSVG value={copy.copy_id} size={116} /><span className={`status ${copy.status}`}>{copy.status === "available" ? "Free to borrow" : "Allotted"}</span><b>{copy.copy_id}</b><span>Shelf {copy.shelf || "Unassigned"}</span>{copy.borrowed_to && <span>With {copy.borrowed_to}</span>}{copy.due_at && <span>Due {new Date(copy.due_at).toLocaleDateString()}</span>}{copy.issue_code && <small>Issue {copy.issue_code}</small>}</article>)}</div>
      {loading && <p className="empty">Loading copy labels…</p>}{!loading && copies.length === 0 && <p className="empty">This title has no physical copies yet.</p>}
    </section>
  </>;
}

function RequestsPage({ setNotice }) {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [reviewingId, setReviewingId] = useState("");
  async function load() {
    setLoading(true);
    try { setRequests((await api("/requests/")).results); }
    finally { setLoading(false); }
  }
  useEffect(() => { load().catch((error) => noticeText(setNotice, error.message, "error")); }, []);

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
    <section className="panel"><div className="panel-head"><div><span className="eyebrow">APPLICATIONS</span><h3>Waiting for a librarian</h3></div><span className="pill">{requests.filter((item) => item.status === "pending").length} pending</span></div>
      <div className="request-list">{requests.map((item) => <article className="request-row" key={item.id}><div className="request-avatar">{item.name.slice(0, 1).toUpperCase()}</div><div className="request-info"><b>{item.name}</b><span>{item.email}</span><small>Registration {item.registration_number} · {item.course} · Year {item.year}</small></div><span className={`status ${item.status}`}>{item.status}</span>{item.status === "pending" && <div className="row-actions"><button className="button primary small" disabled={Boolean(reviewingId)} onClick={() => review(item, "approve")}>{reviewingId === item.id ? "Saving…" : "Approve"}</button><button className="button danger small" disabled={Boolean(reviewingId)} onClick={() => review(item, "reject")}>Reject</button></div>}</article>)}{loading && <p className="empty">Loading signup requests…</p>}{!loading && requests.length === 0 && <p className="empty">No signup requests yet.</p>}</div>
    </section>
  </>;
}

function StudentsPage({ setNotice }) {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  async function load() {
    setLoading(true);
    try { setMembers((await api("/members/")).results); }
    finally { setLoading(false); }
  }
  useEffect(() => { load().catch((error) => noticeText(setNotice, error.message, "error")); }, []);
  return <>
    <PageTitle eyebrow="DIRECTORY / PORTAL ACCESS" title="Students" note="Approved accounts can use their Student ID to borrow from the QR catalogue." />
    <section className="panel"><div className="panel-head"><div><span className="eyebrow">APPROVED MEMBERS</span><h3>Campus readers</h3></div><span className="pill">{members.length} students</span></div>
      <div className="table-scroll"><table><thead><tr><th>Student</th><th>Student ID</th><th>Course</th><th>Portal</th><th>Fine balance</th></tr></thead><tbody>{members.map((member) => <tr key={member.id}><td><b>{member.name}</b><small>{member.email}</small></td><td><code>{member.student_id}</code></td><td>{member.course} · Year {member.year}</td><td><span className={`status ${member.portal_ready ? "approved" : "pending"}`}>{member.portal_ready ? "Ready" : "Password needed"}</span></td><td>₹{member.fine_balance}</td></tr>)}</tbody></table></div>
      {loading && <p className="empty">Loading students…</p>}
      {!loading && members.length === 0 && <p className="empty">Approved student accounts will appear here.</p>}
    </section>
  </>;
}

function LoansPage({ setNotice }) {
  const [loans, setLoans] = useState([]);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState("return");
  const [copyId, setCopyId] = useState("");
  const [memberId, setMemberId] = useState("");
  const [scanOpen, setScanOpen] = useState(false);
  const [scanInfo, setScanInfo] = useState(null);

  async function load() {
    setLoading(true);
    try {
      const [loanData, memberData] = await Promise.all([api("/loans/"), api("/members/catalogue/")]);
      setLoans(loanData.results);
      setMembers(memberData.results);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load().catch((error) => noticeText(setNotice, error.message, "error")); }, []);

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
      await load();
    } catch (error) {
      noticeText(setNotice, error.message, "error");
    } finally {
      setBusy(false);
    }
  }

  return <>
    <PageTitle eyebrow="CIRCULATION DESK / COPY QR" title="Issue and return books" note="Scan a copy label or type its Copy ID. A QR never approves a loan by itself." />
    <section className="panel action-panel"><div className="mode-switch"><button className={mode === "return" ? "selected" : ""} onClick={() => { setMode("return"); setScanInfo(null); }}>Return a copy</button><button className={mode === "issue" ? "selected" : ""} onClick={() => { setMode("issue"); setScanInfo(null); }}>Issue to student</button></div>
      <form className="issue-controls" onSubmit={submit}>
        {mode === "issue" && <label>Approved student<select value={memberId} onChange={(event) => setMemberId(event.target.value)} required><option value="">Choose a student</option>{members.map((member) => <option value={member.id} key={member.id}>{member.name} · {member.student_id}</option>)}</select></label>}
        <label>Physical Copy ID<input value={copyId} onChange={(event) => setCopyId(event.target.value.toUpperCase())} placeholder="Scan the QR or type CSB-…" required /></label>
        <div className="button-line"><button className="button light" type="button" onClick={() => setScanOpen((open) => !open)}>{scanOpen ? "Close scanner" : "Open camera scanner"}</button><button className="button primary" disabled={busy || scanInfo?.returned || (scanInfo && mode === "return" && !scanInfo.active_loan) || (scanInfo && mode === "issue" && scanInfo.status !== "available")}>{busy ? "Saving…" : mode === "issue" ? "Confirm issue" : scanInfo?.returned ? "Return recorded" : scanInfo?.active_loan ? "Complete this return" : "Complete return"}</button></div>
      </form>
      <Scanner open={scanOpen} onScan={scanned} onError={(message) => noticeText(setNotice, message, "error")} />
      {scanInfo && <div className={`scan-result-card ${scanInfo.returned ? "complete" : ""}`} role="status"><span className="scan-result-mark" aria-hidden="true">{scanInfo.returned ? "✓" : "⌗"}</span><div><span className="eyebrow">{scanInfo.returned ? "RETURN RECORDED" : "COPY SCANNED"}</span><b>{scanInfo.book_title || "Physical copy"}</b><small>{scanInfo.copy_id}{scanInfo.member_name ? ` · With ${scanInfo.member_name}` : ""}{scanInfo.issue_code ? ` · ${scanInfo.issue_code}` : ""}</small><p>{scanInfo.returned ? "This copy is available to borrow again." : mode === "return" && scanInfo.active_loan ? "Active loan found. Complete the return to update the copy and its transaction." : scanInfo.status === "available" ? "Available to borrow. Select a student before issuing." : "No active loan was found for this copy. Review its transaction history before changing its status."}</p></div><span className={`status ${scanInfo.returned ? "available" : scanInfo.active_loan ? "borrowed" : scanInfo.status}`}>{scanInfo.returned ? "Available" : scanInfo.active_loan ? "On loan" : scanInfo.status}</span></div>}
    </section>
    <section className="panel"><div className="panel-head"><div><span className="eyebrow">COMPLETE HISTORY</span><h3>Transaction register</h3></div><span className="pill">{loans.length} records</span></div>
      <div className="table-scroll"><table><thead><tr><th>Issue ID</th><th>Book / copy</th><th>Student</th><th>Due date</th><th>Current fine</th><th>Status</th></tr></thead><tbody>{loans.map((loan) => <tr key={loan.id}><td><code>{loan.issue_code}</code></td><td><b>{loan.book_title}</b><small>{loan.copy_id}</small></td><td>{loan.member_name}<small>{loan.student_id}</small></td><td>{new Date(loan.due_at).toLocaleDateString()}{["due_soon", "overdue"].includes(loan.due_status) && <small><span className={`status ${loan.due_status}`}>{loan.due_message}</span></small>}</td><td>{loan.current_fine === "0" ? "—" : `₹${loan.current_fine}`}</td><td><span className={`status ${loan.status}`}>{loan.status}</span></td></tr>)}</tbody></table></div>{loading && <p className="empty">Loading issue records…</p>}{!loading && loans.length === 0 && <p className="empty">No books have been issued yet.</p>}
    </section>
  </>;
}

function TransactionsPage({ setNotice, student = false }) {
  const [transactions, setTransactions] = useState([]);
  const [query, setQuery] = useState("");
  const [type, setType] = useState("");
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (searchTerm, selectedType, pageNumber = 1) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ q: searchTerm, type: selectedType, page: String(pageNumber) });
      const path = student ? "/student/transactions/" : "/transactions/";
      const result = await api(`${path}?${params}`);
      setTransactions(result.results);
      setPagination(result.pagination);
    } finally {
      setLoading(false);
    }
  }, [student]);

  useEffect(() => { load("", "", 1).catch((error) => noticeText(setNotice, error.message, "error")); }, [load]);

  function submit(event) {
    event.preventDefault();
    load(query, type, 1).catch((error) => noticeText(setNotice, error.message, "error"));
  }

  const labels = { checkout: "Book issued", return: "Book returned", renewal: "Renewal", fine_added: "Fine added", fine_paid: "Fine paid" };
  const icons = { checkout: "↗", return: "✓", renewal: "↻", fine_added: "₹", fine_paid: "✓" };

  return <>
    <PageTitle eyebrow={student ? "STUDENT PORTAL / ACCOUNT HISTORY" : "LIBRARY DESK / AUDIT"} title={student ? "My activity" : "Transaction activity"} note={student ? "A timeline of your checkouts, returns, renewal decisions, and fines." : "Search circulation and account events across the library."} />
    <section className="panel transaction-panel">
      <form className="transaction-filters" onSubmit={submit}>
        <label className="transaction-search">Search<input value={query} disabled={loading} onChange={(event) => setQuery(event.target.value)} placeholder={student ? "Title, issue ID, or fine reason" : "Student, title, Copy ID, or issue ID"} /></label>
        <label>Activity type<select value={type} disabled={loading} onChange={(event) => { const value = event.target.value; setType(value); load(query, value, 1).catch((error) => noticeText(setNotice, error.message, "error")); }}><option value="">All activity</option><option value="checkout">Book issued</option><option value="return">Book returned</option><option value="renewal">Renewal</option><option value="fine_added">Fine added</option><option value="fine_paid">Fine paid</option></select></label>
        <button className="button primary" disabled={loading}>{loading ? "Loading…" : "Search history"}</button>
      </form>
      <div className="transaction-list">{transactions.map((item) => <article className="transaction-row" key={item.id}>
        <span className={`transaction-icon ${item.type}`} aria-hidden="true">{icons[item.type]}</span>
        <div className="transaction-copy"><div className="transaction-heading"><b>{item.title}</b><span className={`status ${item.status}`}>{labels[item.type]}</span></div><p>{item.details}</p>{!student && <small>{item.student_name} · {item.student_id}</small>}<time dateTime={item.occurred_at}>{new Date(item.occurred_at).toLocaleString()}</time></div>
        {item.amount && <strong className="transaction-amount">₹{Number(item.amount).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}</strong>}
      </article>)}{loading && <p className="empty">Loading transaction history…</p>}{!loading && transactions.length === 0 && <p className="empty">No activity matches this search.</p>}</div>
      <div className="pagination-controls"><span>{pagination.total} event{pagination.total === 1 ? "" : "s"} · Page {pagination.page} of {pagination.pages}</span><div><button className="button light small" disabled={loading || pagination.page <= 1} onClick={() => load(query, type, pagination.page - 1).catch((error) => noticeText(setNotice, error.message, "error"))}>← Previous</button><button className="button light small" disabled={loading || pagination.page >= pagination.pages} onClick={() => load(query, type, pagination.page + 1).catch((error) => noticeText(setNotice, error.message, "error"))}>Next →</button></div></div>
    </section>
  </>;
}

function FinesPage({ setNotice }) {
  const [fines, setFines] = useState([]);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  async function load() {
    setLoading(true);
    try {
      const [fineData, memberData] = await Promise.all([api("/fines/"), api("/members/catalogue/")]);
      setFines(fineData.results);
      setMembers(memberData.results);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load().catch((error) => noticeText(setNotice, error.message, "error")); }, []);

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

  return <>
    <PageTitle eyebrow="STUDENT ACCOUNTS / ₹20 PER DAY" title="Fine ledger" note="Current overdue amounts update by calendar day. Returned-book fines are saved as a fixed entry." />
    <div className="content-grid">
      <section className="panel"><div className="panel-head"><div><span className="eyebrow">LIBRARIAN ENTRY</span><h3>Add a custom fine</h3></div></div>
        <form className="stack-form compact" onSubmit={addFine}>
          <label>Student<select name="member_id" required defaultValue=""><option value="" disabled>Choose a student</option>{members.map((member) => <option key={member.id} value={member.id}>{member.name} · {member.student_id}</option>)}</select></label>
          <label>Amount in rupees<input name="amount" type="number" min="0.01" step="0.01" required /></label>
          <label>Reason<input name="reason" maxLength="200" required placeholder="Damaged cover" /></label>
          <button className="button primary" disabled={busy}>{busy ? "Saving…" : "Add unpaid fine"}</button>
        </form>
      </section>
      <section className="panel list-panel"><div className="panel-head"><div><span className="eyebrow">ALL RECORDS</span><h3>Fines and payments</h3></div><span className="pill">{fines.length} entries</span></div>
        <div className="fine-list">{fines.map((fine) => <article className="fine-row" key={fine.id}><div className="fine-amount">₹{fine.amount}</div><div className="fine-info"><b>{fine.member_name} <small>{fine.student_id}</small></b><span>{fine.reason}</span><small>{fine.fine_type === "overdue" ? "Overdue fine" : "Custom fine"} · {new Date(fine.created_at).toLocaleDateString()}</small></div><span className={`status ${fine.status}`}>{fine.status}</span>{fine.status === "unpaid" && !fine.current && <button className="button light small" disabled={busy} onClick={() => markPaid(fine)}>Mark paid</button>}</article>)}{loading && <p className="empty">Loading fines…</p>}{!loading && fines.length === 0 && <p className="empty">There are no fines to show.</p>}</div>
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

function ReviewsPage({ setNotice }) {
  const [reviews, setReviews] = useState([]);
  const [books, setBooks] = useState([]);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  async function load() {
    setLoading(true);
    try {
      const [reviewData, bookData, memberData] = await Promise.all([api("/reviews/"), api("/books/?page_size=100"), api("/members/catalogue/")]);
      setReviews(reviewData.results);
      setBooks(bookData.results);
      setMembers(memberData.results);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load().catch((error) => noticeText(setNotice, error.message, "error")); }, []);
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
    <div className="content-grid">
      <section className="panel"><div className="panel-head"><div><span className="eyebrow">SHARE A THOUGHT</span><h3>Write a review</h3></div></div>
        <form className="stack-form compact" onSubmit={submit}>
          <label>Book<select name="book_id" required defaultValue=""><option value="" disabled>Choose a title</option>{books.map((book) => <option key={book.id} value={book.id}>{book.title}</option>)}</select></label>
          <label>Student<select name="member_id" required defaultValue=""><option value="" disabled>Choose a student</option>{members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
          <label>Rating<select name="rating" defaultValue="5">{[5, 4, 3, 2, 1].map((rating) => <option key={rating} value={rating}>{rating} / 5</option>)}</select></label>
          <label>Note<textarea name="comment" maxLength="500" rows="4" required /></label>
          <button className="button primary" disabled={busy}>{busy ? "Saving…" : "Save review"}</button>
        </form>
      </section>
      <section className="panel list-panel"><div className="panel-head"><div><span className="eyebrow">WORDS WORTH KEEPING</span><h3>Community notes</h3></div></div><div className="review-list">{reviews.map((review) => <article className="review-row" key={review.id}><div className="review-rating">{"★".repeat(review.rating)}{"☆".repeat(5 - review.rating)}</div><b>{review.book_title}</b><p>“{review.comment}”</p><small>{review.member_name} · {new Date(review.created_at).toLocaleDateString()}</small></article>)}{loading && <p className="empty">Loading reader notes…</p>}{!loading && reviews.length === 0 && <p className="empty">No notes yet.</p>}</div></section>
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
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const data = await api(`/books/${book.id}/reviews/`);
      setReviews(data.results);
      setAverage(data.average_rating);
      setRatingCount(data.rating_count);
      onRatingChange?.({ average_rating: data.average_rating, rating_count: data.rating_count });
      setHasReview(Boolean(data.my_review));
      setRating(data.my_review?.rating || 0);
      setComment(data.my_review?.comment || "");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load().catch((error) => noticeText(setNotice, error.message, "error")); }, [book.id]);

  async function submit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true);
    try {
      const result = await api("/student/reviews/", {
        method: "POST",
        body: formBody({ book_id: book.id, rating: String(rating), comment }),
      });
      noticeText(setNotice, result.message);
      await load();
    } catch (error) {
      noticeText(setNotice, error.message, "error");
    } finally {
      setBusy(false);
    }
  }

  return <section className="panel student-reviews-panel">
    <div className="panel-head"><div><span className="eyebrow">PUBLIC READER RATINGS</span><h3>What readers think</h3></div><button className="button light small" disabled={loading} onClick={() => load().catch((error) => noticeText(setNotice, error.message, "error"))}>{loading ? "Loading…" : "Refresh"}</button></div>
    <div className="reader-rating-overview"><strong>{ratingCount ? average.toFixed(1) : "—"}</strong><div><BookRating rating={average} count={ratingCount} /><small>{ratingCount ? `Based on ${ratingCount} student rating${ratingCount === 1 ? "" : "s"}` : "No one has rated this book yet."}</small></div></div>
    <form className="student-review-form" onSubmit={submit}>
      <fieldset className="rating-picker" disabled={busy || loading}>
        <legend>{hasReview ? "Update your rating" : "Your rating"}</legend>
        <div>{[1, 2, 3, 4, 5].map((star) => <button key={star} type="button" className={star <= rating ? "selected" : ""} aria-label={`Rate ${star} out of 5 stars`} aria-pressed={rating === star} onClick={() => setRating(star)}>★</button>)}</div>
      </fieldset>
      <label>Note <span>(optional, up to 500 characters)</span><textarea value={comment} onChange={(event) => setComment(event.target.value)} maxLength={500} rows={3} placeholder="Share what you liked or who you would recommend it to." disabled={busy || loading} /></label>
      <div className="student-review-submit"><small>Your rating and note will be visible to readers in the catalogue.</small><button className="button primary" disabled={busy || loading || rating < 1}>{busy ? "Publishing…" : hasReview ? "Update public rating" : "Publish rating"}</button></div>
    </form>
    <div className="public-review-list" aria-live="polite">
      {reviews.map((review) => <article className="public-review-card" key={review.id}><span className="public-review-stars" aria-label={`${review.rating} out of 5 stars`}>{"★".repeat(review.rating)}{"☆".repeat(5 - review.rating)}</span><p>{review.comment || "Rated without a written note."}</p><small>{review.member_name} · {new Date(review.created_at).toLocaleDateString()}</small></article>)}
      {loading && <p className="empty">Loading reader ratings…</p>}{!loading && reviews.length === 0 && <p className="empty">Be the first reader to rate this title.</p>}
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

function ReservationsPage({ setNotice }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  async function load() {
    setLoading(true);
    try { setItems((await api("/reservations/")).results); }
    finally { setLoading(false); }
  }
  useEffect(() => { load().catch((error) => noticeText(setNotice, error.message, "error")); }, []);
  return <>
    <PageTitle eyebrow="CIRCULATION / HOLDS" title="Book reservations" note="A copy returning to the shelf is assigned to the next student in line." action={<button className="button light" disabled={loading} onClick={() => load().catch((error) => noticeText(setNotice, error.message, "error"))}>Refresh queue</button>} />
    <section className="panel"><div className="reservation-list">{items.map((item) => <article className="reservation-row" key={item.id}><div className="reservation-mark">{item.status === "ready" ? "✓" : "↗"}</div><div className="reservation-info"><b>{item.book_title}</b><span>{item.author} · Shelf {item.shelf}</span><small>{item.student_name} · {item.student_id} · Placed {new Date(item.created_at).toLocaleDateString()}</small></div><span className={`status ${item.status}`}>{item.status === "ready" ? "Ready for pickup" : item.status}</span></article>)}{loading && <p className="empty">Loading reservations…</p>}{!loading && items.length === 0 && <p className="empty">There are no book holds yet.</p>}</div></section>
  </>;
}

function RenewalsPage({ setNotice }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  async function load() {
    setLoading(true);
    try { setItems((await api("/renewals/")).results); }
    finally { setLoading(false); }
  }
  useEffect(() => { load().catch((error) => noticeText(setNotice, error.message, "error")); }, []);
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
    <PageTitle eyebrow="CIRCULATION / RENEWALS" title="Renewal requests" note="Approve one 14-day extension when the loan is current and no other student is waiting for the title." action={<button className="button light" disabled={loading} onClick={() => load().catch((error) => noticeText(setNotice, error.message, "error"))}>Refresh requests</button>} />
    <section className="panel"><div className="reservation-list">{items.map((item) => <article className="reservation-row" key={item.id}><div className="reservation-mark">↻</div><div className="reservation-info"><b>{item.book_title}</b><span>{item.student_name} · {item.student_id} · Copy {item.copy_id}</span><small>Requested {new Date(item.created_at).toLocaleDateString()} · Due {new Date(item.due_at).toLocaleDateString()} · {item.issue_code}</small></div><span className={`status ${item.status}`}>{item.status}</span>{item.status === "pending" && <div className="row-actions"><button className="button primary small" disabled={Boolean(busyId)} onClick={() => review(item, "approve")}>{busyId === item.id ? "Saving…" : "Approve +14 days"}</button><button className="button danger small" disabled={Boolean(busyId)} onClick={() => review(item, "reject")}>Decline</button></div>}</article>)}{loading && <p className="empty">Loading renewal requests…</p>}{!loading && items.length === 0 && <p className="empty">No renewal requests yet.</p>}</div></section>
  </>;
}

function ReportsPage({ setNotice }) {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  async function load() {
    setLoading(true);
    try { setReport(await api("/reports/")); }
    finally { setLoading(false); }
  }
  useEffect(() => { load().catch((error) => noticeText(setNotice, error.message, "error")); }, []);
  const maxPopular = Math.max(1, ...(report?.popular_books || []).map((item) => item.borrowings));
  const maxMonth = Math.max(1, ...(report?.circulation || []).flatMap((item) => [item.issues, item.returns]));
  return <>
    <PageTitle eyebrow="LIBRARY ANALYTICS" title="Circulation reports" note="See which titles readers choose and how borrowing activity changes over six months." action={<button className="button light" disabled={loading} onClick={() => load().catch((error) => noticeText(setNotice, error.message, "error"))}>Refresh report</button>} />
    {report && <div className="stats-grid report-stats"><StatCard label="Lifetime checkouts" value={report.totals.borrowings} note="All recorded issue transactions" /><StatCard label="Currently borrowed" value={report.totals.active} note="Active circulation" /><StatCard label="Completed returns" value={report.totals.returned} note="Returned to the collection" /></div>}
    <div className="reports-grid"><section className="panel"><div className="panel-head"><div><span className="eyebrow">MOST BORROWED</span><h3>Popular titles</h3></div></div><div className="report-rank-list">{report?.popular_books.map((item, index) => <div className="report-rank" key={item.title}><span>{String(index + 1).padStart(2, "0")}</span><div><b>{item.title}</b><div className="report-bar"><i style={{ width: `${Math.max(5, item.borrowings / maxPopular * 100)}%` }} /></div></div><strong>{item.borrowings}</strong></div>)}{loading && <p className="empty">Loading popular titles…</p>}{!loading && !report?.popular_books.length && <p className="empty">Borrowing history will appear here.</p>}</div></section>
      <section className="panel"><div className="panel-head"><div><span className="eyebrow">LAST SIX MONTHS</span><h3>Borrowing activity</h3></div></div><div className="circulation-chart">{report?.circulation.map((month) => <div className="circulation-month" key={month.month}><div className="circulation-bars"><i className="issue-bar" title={`${month.issues} checkouts`} style={{ height: `${Math.max(3, month.issues / maxMonth * 100)}%` }} /><i className="return-bar" title={`${month.returns} returns`} style={{ height: `${Math.max(3, month.returns / maxMonth * 100)}%` }} /></div><small>{month.label}</small></div>)}{loading && <p className="empty">Loading monthly activity…</p>}</div><div className="chart-legend"><span><i className="issue-bar" /> Checkouts</span><span><i className="return-bar" /> Returns</span></div></section></div>
    <section className="panel"><div className="panel-head"><div><span className="eyebrow">LATEST ACTIVITY</span><h3>Recent transactions</h3></div></div><div className="table-scroll"><table><thead><tr><th>Issue ID</th><th>Title</th><th>Student</th><th>Issued</th><th>Due</th><th>Status</th></tr></thead><tbody>{report?.recent_transactions.map((item) => <tr key={item.issue_code}><td><code>{item.issue_code}</code></td><td>{item.book_title}</td><td>{item.student_name}<small>{item.student_id}</small></td><td>{new Date(item.borrowed_at).toLocaleDateString()}</td><td>{new Date(item.due_at).toLocaleDateString()}</td><td><span className={`status ${item.status}`}>{item.status}</span></td></tr>)}</tbody></table></div>{loading && <p className="empty">Loading recent transactions…</p>}{!loading && !report?.recent_transactions.length && <p className="empty">There are no transactions yet.</p>}</section>
  </>;
}

const TIME_SLOTS = ["08:00", "09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00", "19:00", "20:00"];

function getLocalDateStr(date = new Date()) {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function StudentSpaceBookingsPage({ user, setNotice }) {
  const todayStr = getLocalDateStr();
  const [subTab, setSubTab] = useState("browse");
  const [selectedDate, setSelectedDate] = useState(todayStr);
  const [spaceType, setSpaceType] = useState("all");
  const [availFilter, setAvailFilter] = useState("all");
  const [spaces, setSpaces] = useState([]);
  const [myBookings, setMyBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [bookingModal, setBookingModal] = useState(null);
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

  async function loadData() {
    setLoading(true);
    try {
      const [spacesData, bookingsData] = await Promise.all([
        api(`/spaces/?date=${encodeURIComponent(selectedDate)}&type=${encodeURIComponent(spaceType)}`),
        api("/student/space-bookings/"),
      ]);
      setSpaces(spacesData.results || []);
      setMyBookings(bookingsData.results || []);
    } catch (err) {
      noticeText(setNotice, err.message, "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, [selectedDate, spaceType]);

  function openBookingModal(space, presetSlot = null) {
    setModalError("");
    let firstEmpty = presetSlot;
    if (!firstEmpty && space.schedule) {
      firstEmpty = space.schedule.find((s) => s.status === "empty");
    }
    const startTime = firstEmpty ? firstEmpty.start : "09:00";
    const validEnds = TIME_SLOTS.filter((t) => t > startTime);
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
    const validEnds = TIME_SLOTS.filter((t) => t > newStartTime);
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

  const filteredSpaces = spaces.filter((sp) => {
    if (availFilter === "empty_only") return sp.empty_slots_count > 0;
    if (availFilter === "occupied_only") return sp.occupied_slots_count > 0 || sp.pending_slots_count > 0;
    return true;
  });

  const pendingCount = myBookings.filter((b) => b.status === "pending").length;

  return (
    <>
      <PageTitle
        eyebrow="STUDENT PORTAL / FACILITIES"
        title="Study Pods & Conference Rooms"
        note="Reserve quiet focus pods, duo study spaces, or conference rooms for your individual or group study sessions."
      />

      <div className="subnav-tabs">
        <button
          type="button"
          className={`subnav-btn ${subTab === "browse" ? "active" : ""}`}
          onClick={() => setSubTab("browse")}
        >
          Explore Spaces &amp; Slots
        </button>
        <button
          type="button"
          className={`subnav-btn ${subTab === "my_bookings" ? "active" : ""}`}
          onClick={() => setSubTab("my_bookings")}
        >
          My Bookings {pendingCount > 0 && <span className="subnav-badge">{pendingCount} pending</span>}
        </button>
      </div>

      {subTab === "browse" && (
        <>
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
              <label className="filter-item">
                Type:
                <select value={spaceType} onChange={(e) => setSpaceType(e.target.value)}>
                  <option value="all">All Spaces</option>
                  <option value="pod">Study Pods</option>
                  <option value="room">Conference Rooms</option>
                  <option value="slot">Study Slots</option>
                </select>
              </label>
              <label className="filter-item">
                Availability:
                <select value={availFilter} onChange={(e) => setAvailFilter(e.target.value)}>
                  <option value="all">Any Status</option>
                  <option value="empty_only">Empty Slots Available</option>
                  <option value="occupied_only">Occupied / In Use</option>
                </select>
              </label>
            </div>
            <button type="button" className="button light small" disabled={loading} onClick={loadData}>
              {loading ? "Checking…" : "Refresh schedule"}
            </button>
          </div>

          <div className="space-grid">
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
                        <span><i className="legend-dot empty" /> Empty</span>
                        <span><i className="legend-dot pending" /> Review</span>
                        <span><i className="legend-dot occupied" /> Booked</span>
                      </div>
                    </div>
                    <div className="slot-grid">
                      {(space.schedule || []).map((slot, idx) => (
                        <button
                          type="button"
                          disabled={slot.status !== "empty"}
                          key={idx}
                          className={`slot-pill ${slot.status}`}
                          title={`${slot.start}-${slot.end}: ${slot.status === "empty" ? "Empty / Click to book" : slot.status === "pending" ? "Pending approval" : "Occupied"}`}
                          onClick={() => {
                            if (slot.status === "empty") openBookingModal(space, slot);
                          }}
                        >
                          <span>{slot.start}</span>
                          <small>{slot.status === "empty" ? "Empty" : slot.status === "pending" ? "Pending" : "Booked"}</small>
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
                    disabled={space.empty_slots_count === 0}
                    onClick={() => openBookingModal(space)}
                  >
                    {space.empty_slots_count === 0 ? "Fully Booked" : "Book Slot"}
                  </button>
                </div>
              </article>
            ))}
            {loading && <p className="empty">Checking space schedules…</p>}
            {!loading && filteredSpaces.length === 0 && (
              <p className="empty">No spaces match the selected filters.</p>
            )}
          </div>
        </>
      )}

      {subTab === "my_bookings" && (
        <section className="panel">
          <div className="panel-head">
            <div>
              <span className="eyebrow">RESERVATIONS</span>
              <h3>Your Bookings &amp; Requests</h3>
            </div>
            <button type="button" className="button light small" disabled={loading} onClick={loadData}>
              {loading ? "Loading…" : "Refresh"}
            </button>
          </div>

          <div className="booking-list">
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
            {loading && <p className="empty">Loading your space bookings…</p>}
            {!loading && myBookings.length === 0 && (
              <p className="empty">You haven't requested any space or pod bookings yet.</p>
            )}
          </div>
        </section>
      )}

      {bookingModal && (
        <div className="booking-modal-overlay" onClick={() => !submitting && setBookingModal(null)}>
          <div className="booking-modal" role="dialog" aria-modal="true" aria-label="Space booking" onClick={(e) => e.stopPropagation()}>
            <div className="booking-modal-header">
              <div>
                <span className="eyebrow">{bookingModal.space_type_display}</span>
                <h3>Book {bookingModal.name}</h3>
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
                  <span>⚠️</span>
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
                    setBookingForm({ ...bookingForm, date: e.target.value });
                  }}
                />
              </label>

              <div className="two-fields">
                <label>
                  Start Time
                  <select
                    value={bookingForm.start_time}
                    onChange={(e) => handleStartTimeChange(e.target.value)}
                  >
                    {TIME_SLOTS.slice(0, -1).map((t) => (
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
                    {TIME_SLOTS.filter((t) => t > bookingForm.start_time).map((t) => (
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
  const [statusFilter, setStatusFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [scheduleDate, setScheduleDate] = useState(getLocalDateStr());
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [rejectingBooking, setRejectingBooking] = useState(null);
  const [rejectReason, setRejectReason] = useState("");

  async function loadData() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter && statusFilter !== "all") params.append("status", statusFilter);
      if (dateFilter) params.append("date", dateFilter);
      if (typeFilter && typeFilter !== "all") params.append("type", typeFilter);

      const [bookingsData, spacesData] = await Promise.all([
        api(`/librarian/space-bookings/?${params}`),
        api(`/spaces/?date=${encodeURIComponent(scheduleDate)}`),
      ]);
      setBookings(bookingsData.results || []);
      setSpaces(spacesData.results || []);
    } catch (err) {
      noticeText(setNotice, err.message, "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, [statusFilter, dateFilter, typeFilter, scheduleDate]);

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

      <div className="stats-grid">
        <StatCard label="Pending Approval" value={pendingList.length} note="Requests waiting for review" />
        <StatCard label="Confirmed Bookings" value={confirmedList.length} note="Active confirmed reservations" />
        <StatCard label="Total Library Spaces" value={spaces.length || 10} note="Pods, rooms & slots" />
      </div>

      <div className="subnav-tabs">
        <button
          type="button"
          className={`subnav-btn ${subTab === "requests" ? "active" : ""}`}
          onClick={() => setSubTab("requests")}
        >
          Booking Requests {pendingList.length > 0 && <span className="subnav-badge">{pendingList.length} pending</span>}
        </button>
        <button
          type="button"
          className={`subnav-btn ${subTab === "schedule" ? "active" : ""}`}
          onClick={() => setSubTab("schedule")}
        >
          Live Spaces &amp; Availability
        </button>
      </div>

      {subTab === "requests" && (
        <section className="panel">
          <div className="space-filters" style={{ margin: "0 0 16px" }}>
            <div className="filter-group">
              <label className="filter-item">
                Status:
                <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                  <option value="all">All Statuses</option>
                  <option value="pending">Pending Approval</option>
                  <option value="confirmed">Confirmed</option>
                  <option value="rejected">Rejected</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </label>
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
              <label className="filter-item">
                Type:
                <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
                  <option value="all">All Types</option>
                  <option value="pod">Pods</option>
                  <option value="room">Conference Rooms</option>
                  <option value="slot">Slots</option>
                </select>
              </label>
            </div>
          </div>

          <div className="booking-list">
            {bookings.map((b) => (
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
            {loading && <p className="empty">Loading requests…</p>}
            {!loading && bookings.length === 0 && (
              <p className="empty">No booking requests found for the selected filter.</p>
            )}
          </div>
        </section>
      )}

      {subTab === "schedule" && (
        <section className="panel">
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

          <div className="space-grid">
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
                        <span><i className="legend-dot empty" /> Empty</span>
                        <span><i className="legend-dot pending" /> Pending</span>
                        <span><i className="legend-dot occupied" /> Booked</span>
                      </div>
                    </div>
                    <div className="slot-grid">
                      {(sp.schedule || []).map((slot, idx) => (
                        <div key={idx} className={`slot-pill ${slot.status}`}>
                          <span>{slot.start}</span>
                          <small>{slot.status === "empty" ? "Empty" : slot.status === "pending" ? "Pending" : "Booked"}</small>
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
          </div>
        </section>
      )}

      {rejectingBooking && (
        <div className="booking-modal-overlay" onClick={() => setRejectingBooking(null)}>
          <div className="booking-modal" role="dialog" aria-modal="true" aria-label="Space booking" onClick={(e) => e.stopPropagation()}>
            <div className="booking-modal-header">
              <div>
                <span className="eyebrow">DECLINE REQUEST</span>
                <h3>Reject Booking Request</h3>
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


function StudentPortal({ user, tab, setTab, setNotice, selectedBook, onOpenBook, onBackToBooks, onBookRatingChange }) {
  const [books, setBooks] = useState([]);
  const [loans, setLoans] = useState([]);
  const [holds, setHolds] = useState([]);
  const [fines, setFines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [renewingLoanId, setRenewingLoanId] = useState("");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [availability, setAvailability] = useState("all");
  const [categories, setCategories] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [copyId, setCopyId] = useState("");
  const [copyInfo, setCopyInfo] = useState(null);
  const [scanOpen, setScanOpen] = useState(false);
  const [slip, setSlip] = useState(null);

  async function load(searchTerm = query, pageNumber = 1, selectedCategory = category, selectedAvailability = availability) {
    setLoading(true);
    try {
      if (tab === "catalogue") {
        const params = new URLSearchParams({ q: searchTerm, page: String(pageNumber), category: selectedCategory, availability: selectedAvailability });
        const result = await api(`/catalogue/?${params}`);
        setBooks(result.results);
        setCategories(result.categories || []);
        setPagination(result.pagination);
      }
      if (tab === "my_loans") setLoans((await api("/student/loans/")).results);
      if (tab === "my_holds") setHolds((await api("/student/reservations/")).results);
      if (tab === "my_fines") setFines((await api("/fines/")).results);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load().catch((error) => noticeText(setNotice, error.message, "error")); }, [tab]);

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

  async function search(event) {
    event.preventDefault();
    try { await load(query, 1); } catch (error) { noticeText(setNotice, error.message, "error"); }
  }

  async function reserveBook(bookId) {
    setBusy(true);
    try {
      const result = await api("/student/reservations/", { method: "POST", body: formBody({ book_id: bookId }) });
      noticeText(setNotice, `Reservation ${result.reservation.status === "ready" ? "ready for pickup" : "added to the queue"}.`);
      setTab("my_holds");
    } catch (error) {
      noticeText(setNotice, error.message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function cancelHold(hold) {
    try {
      await api(`/student/reservations/${hold.id}/cancel/`, { method: "POST", body: formBody({}) });
      await load();
      noticeText(setNotice, "Reservation cancelled.");
    } catch (error) {
      noticeText(setNotice, error.message, "error");
    }
  }

  async function requestRenewal(loan) {
    setRenewingLoanId(loan.id);
    try {
      await api("/student/renewals/", { method: "POST", body: formBody({ loan_id: loan.id }) });
      await load();
      noticeText(setNotice, "Renewal request sent to the library.");
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
    {slip && <IssueSlip loan={slip} onClose={() => setSlip(null)} />}
    <section className="panel"><div className="panel-head"><div><span className="eyebrow">COLLECTION</span><h3>Search the shelves</h3></div></div><form className="search-row" onSubmit={search}><input value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Search books or authors" placeholder="Search books or authors" /><button className="button light" disabled={loading}>{loading ? "Loading…" : "Search"}</button></form>
      <div className="catalogue-filters"><label>Category<select value={category} onChange={(event) => { const value = event.target.value; setCategory(value); load(query, 1, value, availability).catch((error) => noticeText(setNotice, error.message, "error")); }}><option value="">All categories</option>{categories.map((item) => <option key={item} value={item}>{item}</option>)}</select></label><label>Availability<select value={availability} onChange={(event) => { const value = event.target.value; setAvailability(value); load(query, 1, category, value).catch((error) => noticeText(setNotice, error.message, "error")); }}><option value="all">Any status</option><option value="available">Available now</option><option value="unavailable">Join the hold queue</option></select></label></div>
      <p className="route-hint">{pagination.total} titles in this view</p>
      <div className="catalogue-grid book-catalogue-grid">{books.map((book) => <button type="button" className="catalogue-card book-tile" key={book.id} onClick={() => onOpenBook(book)}><BookCover book={book} /><span className="eyebrow">{book.category}</span><h3>{book.title}</h3><p>{book.author}</p><BookRating rating={book.average_rating} count={book.rating_count} /><div className="catalogue-footer"><span>{book.available_to_borrow} copies available</span><small>Shelf {book.shelf || "Unassigned"}</small></div><span className="book-tile-link">View title <span aria-hidden="true">↗</span></span></button>)}{loading && <p className="empty">Loading books…</p>}{!loading && books.length === 0 && <p className="empty">No books match that search.</p>}</div>
      <div className="pagination-controls"><span>Page {pagination.page} of {pagination.pages}</span><div><button className="button light small" disabled={loading || pagination.page <= 1} onClick={() => load(query, pagination.page - 1).catch((error) => noticeText(setNotice, error.message, "error"))}>← Previous</button><button className="button light small" disabled={loading || pagination.page >= pagination.pages} onClick={() => load(query, pagination.page + 1).catch((error) => noticeText(setNotice, error.message, "error"))}>Next →</button></div></div>
    </section>
    <section className="panel scan-student"><div><span className="eyebrow">READY TO BORROW</span><h3>Scan your copy</h3><p>Sign in first, scan the QR label, and confirm the issue. You can borrow up to five books.</p><button className="button primary" disabled={busy} onClick={() => setScanOpen((open) => !open)}>{scanOpen ? "Close camera" : "Open QR scanner"}</button></div><div className="scan-side">{copyInfo ? <><b>{copyInfo.book_title}</b><span>{copyInfo.copy_id}</span><span className={`status ${copyInfo.status}`}>{copyInfo.status}</span>{copyInfo.status === "available" && <button className="button dark" disabled={busy} onClick={issueCopy}>{busy ? "Checking out…" : "Confirm checkout"}</button>}</> : <span className="scan-symbol">⌗</span>}</div></section>
    <Scanner open={scanOpen} onScan={scanned} onError={(message) => noticeText(setNotice, message, "error")} />
  </>;

  if (tab === "student_book") return <>
    <PageTitle eyebrow="STUDENT CATALOGUE / TITLE DETAILS" title={selectedBook.title} note={`${selectedBook.author} · ${selectedBook.category}`} action={<button className="button light" onClick={onBackToBooks}>← Back to books</button>} />
    <section className="book-detail-hero"><div className="detail-cover-wrap"><BookCover book={selectedBook} /></div><div><span className="eyebrow">{selectedBook.category}</span><h3>{selectedBook.title}</h3><p>{selectedBook.description || "Find this title on the library shelves."}</p><BookRating rating={selectedBook.average_rating} count={selectedBook.rating_count} /><div className="detail-stats"><span><b>{selectedBook.available_to_borrow}</b> copies free to borrow</span><span><b>{selectedBook.total}</b> copies in the library</span><span>Shelf <b>{selectedBook.shelf || "Unassigned"}</b></span></div></div></section>
    <section className="panel detail-next-step"><span className="eyebrow">{selectedBook.available_to_borrow > 0 ? "READY TO BORROW" : "RESERVATION QUEUE"}</span><h3>{selectedBook.available_to_borrow > 0 ? "Scan the QR on your chosen copy" : "Get in line for the next copy"}</h3><p>{selectedBook.available_to_borrow > 0 ? "Go back to the catalogue to open the scanner. The librarian scans the same copy QR when you return it." : "We’ll mark your hold ready as soon as a copy is available."}</p>{selectedBook.available_to_borrow > 0 ? <button className="button primary" onClick={onBackToBooks}>Back to catalogue and scanner</button> : <button className="button primary" disabled={busy} onClick={() => reserveBook(selectedBook.id)}>{busy ? "Adding hold…" : "Reserve this book"}</button>}</section>
    <StudentBookReviews key={selectedBook.id} book={selectedBook} setNotice={setNotice} onRatingChange={onBookRatingChange} />
  </>;

  if (tab === "my_loans") return <>
    <PageTitle eyebrow="STUDENT PORTAL / CIRCULATION" title="My loans" note="Your active issues, due-date alerts, and return dates." />
    {slip && <IssueSlip loan={slip} onClose={() => setSlip(null)} />}
    {dueAlerts.length > 0 && <section className="due-alert-list" aria-label="Due date alerts">{dueAlerts.map((loan) => <article className={`due-alert ${loan.due_status}`} key={loan.id}><span className="due-alert-icon" aria-hidden="true">{loan.due_status === "overdue" ? "!" : "◷"}</span><div><b>{loan.book_title}</b><span>{loan.due_message}{loan.due_status === "overdue" && Number(loan.current_fine) > 0 ? ` · Current fine ₹${loan.current_fine}` : ""}</span></div></article>)}</section>}
    <section className="panel"><div className="table-scroll"><table><thead><tr><th>Book</th><th>Copy ID</th><th>Issue ID</th><th>Due date</th><th>Fine today</th><th>Status</th><th>Renewal</th><th>Slip / return QR</th></tr></thead><tbody>{loans.map((loan) => <tr key={loan.id}><td><b>{loan.book_title}</b><small>{loan.book_author}</small></td><td><code>{loan.copy_id}</code></td><td><code>{loan.issue_code}</code></td><td>{new Date(loan.due_at).toLocaleDateString()}</td><td>{loan.current_fine === "0" ? "—" : `₹${loan.current_fine}`}</td><td><span className={`status ${loan.status}`}>{loan.status}</span></td><td>{loan.renewal_status === "pending" ? <span className="status pending">In review</span> : loan.renewal_status === "approved" ? <span className="status approved">Renewed</span> : loan.renewal_status === "rejected" ? <span className="renewal-rejected"><span className="status rejected">Declined</span>{loan.renewal_allowed && <button className="button light small" disabled={renewingLoanId === loan.id} onClick={() => requestRenewal(loan)}>{renewingLoanId === loan.id ? "Sending…" : "Request again"}</button>}</span> : loan.renewal_allowed ? <button className="button light small" disabled={renewingLoanId === loan.id} onClick={() => requestRenewal(loan)}>{renewingLoanId === loan.id ? "Sending…" : "Request renewal"}</button> : "—"}</td><td><button className="button light small" onClick={() => openIssueSlip(loan)}>{loan.status === "borrowed" ? "Open return QR & slip" : "Open issue slip"}</button></td></tr>)}</tbody></table></div>{loading && <p className="empty">Loading your loans…</p>}{!loading && loans.length === 0 && <p className="empty">You do not have any loans yet.</p>}</section>
  </>;

  if (tab === "my_holds") return <>
    <PageTitle eyebrow="STUDENT PORTAL / RESERVATIONS" title="My holds" note="Follow your place in line and see when a copy is ready for pickup." />
    <section className="panel"><div className="reservation-list">{holds.map((hold) => <article className="reservation-row" key={hold.id}><div className="reservation-mark">{hold.status === "ready" ? "✓" : "↗"}</div><div className="reservation-info"><b>{hold.book_title}</b><span>{hold.author} · Shelf {hold.shelf}</span><small>Placed {new Date(hold.created_at).toLocaleDateString()}{hold.status === "waiting" && hold.queue_position ? ` · Queue position ${hold.queue_position}` : ""}</small></div><span className={`status ${hold.status}`}>{hold.status === "ready" ? "Ready for pickup" : hold.status}</span>{["waiting", "ready"].includes(hold.status) && <button className="button light small" onClick={() => cancelHold(hold)}>Cancel hold</button>}</article>)}{loading && <p className="empty">Loading your reservations…</p>}{!loading && holds.length === 0 && <p className="empty">No holds yet. Reserve a title from its details page when all copies are in use.</p>}</div></section>
  </>;

  return <>
    <PageTitle eyebrow="STUDENT PORTAL / ACCOUNT" title="My fines" note="The current overdue amount starts on the calendar day after your due date." />
    <section className="student-fine-summary" aria-label="Outstanding fine balance">
      <div><span className="eyebrow">OUTSTANDING BALANCE</span><strong>{loading ? "—" : `₹${fines.filter((fine) => fine.status === "unpaid").reduce((total, fine) => total + Number(fine.amount), 0).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`}</strong><p>{loading ? "Checking your current fine balance…" : fines.some((fine) => fine.status === "unpaid") ? "Please visit the library desk to settle your balance." : "You are all clear. There are no unpaid fines on your account."}</p></div>
      <span className="student-fine-count">{loading ? "Loading…" : `${fines.filter((fine) => fine.status === "unpaid").length} unpaid`}</span>
    </section>
    <section className="panel"><div className="panel-head"><div><span className="eyebrow">YOUR ACCOUNT</span><h3>Fine history</h3></div><button className="button light small" disabled={loading} onClick={() => load().catch((error) => noticeText(setNotice, error.message, "error"))}>{loading ? "Refreshing…" : "Refresh fines"}</button></div><div className="fine-list">{fines.map((fine) => <article className="fine-row" key={fine.id}><div className="fine-amount">₹{Number(fine.amount).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}</div><div className="fine-info"><b>{fine.reason}</b><span>{fine.fine_type === "overdue" ? "Overdue fine" : "Custom fine"}</span><small>{new Date(fine.created_at).toLocaleDateString()}{fine.paid_at ? ` · Paid ${new Date(fine.paid_at).toLocaleDateString()}` : ""}</small></div><span className={`status ${fine.status}`}>{fine.status}</span></article>)}{loading && <p className="empty">Loading your fines…</p>}{!loading && fines.length === 0 && <p className="empty">You do not have any fines.</p>}</div></section>
  </>;
}

export default function App() {
  const [user, setUser] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const reducedMotion = useReducedMotion();
  const [setupAvailable, setSetupAvailable] = useState(false);
  const [tab, setTab] = useState("overview");
  const [selectedBook, setSelectedBook] = useState(null);
  const [notice, setNotice] = useState(null);
  const [loading, setLoading] = useState(true);

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
    const closeOnEscape = (event) => { if (event.key === "Escape") setMenuOpen(false); };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", closeOnEscape);
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener("keydown", closeOnEscape); };
  }, [menuOpen]);

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

  if (loading) return <main className="loading-screen"><img src="/assets/campusshelf-emblem.png" alt="" /><span>Opening the library…</span></main>;
  if (!user) return <><AuthScreen onLogin={signIn} onSetup={setup} onSignup={signup} setupAvailable={setupAvailable} />{notice && <div className={`toast ${notice.kind}`}>{notice.text}</div>}<Chatbot user={null} /></>;

  const isStudent = user.role === "student";
  const tabs = isStudent ? studentTabs : librarianTabs;
  const activeTab = tab === "book_detail" || tab === "add_book" || tab === "edit_book" ? "books" : tab === "student_book" ? "catalogue" : tab;
  const active = tabs.find((item) => item[0] === activeTab) || tabs[0];
  let content;
  if (tab === "account") content = <AccountPage user={user} setNotice={setNotice} />;
  else if (isStudent && tab === "my_history") content = <TransactionsPage setNotice={setNotice} student />;
  else if (isStudent) content = <StudentPortal key={tab} user={user} tab={tab} setTab={setTab} setNotice={setNotice} selectedBook={selectedBook} onOpenBook={(book) => { setSelectedBook(book); setTab("student_book"); }} onBackToBooks={() => setTab("catalogue")} onBookRatingChange={(ratings) => setSelectedBook((book) => book ? { ...book, ...ratings } : book)} />;
  else if (tab === "overview") content = <Dashboard setNotice={setNotice} onNavigate={setTab} />;
  else if (tab === "books") content = <BooksPage setNotice={setNotice} onAddBook={() => setTab("add_book")} onOpenBook={(book) => { setSelectedBook(book); setTab("book_detail"); }} />;
  else if (tab === "add_book") content = <AddBookPage setNotice={setNotice} onCancel={() => setTab("books")} onSaved={(book) => { setSelectedBook(book); setTab("book_detail"); }} />;
  else if (tab === "edit_book" && selectedBook) content = <AddBookPage key={`edit-${selectedBook.id}`} book={selectedBook} setNotice={setNotice} onCancel={() => setTab("book_detail")} onSaved={(book) => { setSelectedBook(book); setTab("book_detail"); }} />;
  else if (tab === "book_detail" && selectedBook) content = <BookDetailPage key={selectedBook.id} book={selectedBook} setNotice={setNotice} onBack={() => setTab("books")} onEdit={(book) => { setSelectedBook(book); setTab("edit_book"); }} />;
  else if (tab === "book_detail") content = <BooksPage setNotice={setNotice} onAddBook={() => setTab("add_book")} onOpenBook={(book) => { setSelectedBook(book); setTab("book_detail"); }} />;
  else if (tab === "requests") content = <RequestsPage setNotice={setNotice} />;
  else if (tab === "space_bookings") content = <LibrarianSpaceBookingsPage setNotice={setNotice} />;
  else if (tab === "reservations") content = <ReservationsPage setNotice={setNotice} />;
  else if (tab === "renewals") content = <RenewalsPage setNotice={setNotice} />;
  else if (tab === "transactions") content = <TransactionsPage setNotice={setNotice} />;
  else if (tab === "reports") content = <ReportsPage setNotice={setNotice} />;
  else if (tab === "students") content = <StudentsPage setNotice={setNotice} />;
  else if (tab === "loans") content = <LoansPage setNotice={setNotice} />;
  else if (tab === "fines") content = <FinesPage setNotice={setNotice} />;
  else content = <ReviewsPage setNotice={setNotice} />;

  return <div className={`app-shell ${isStudent ? "student-shell" : ""} ${menuOpen ? "menu-open" : ""}`}>
    <a className="skip-link" href="#portal-content">Skip to content</a>
    {menuOpen && <button className="nav-backdrop" aria-label="Close navigation" onClick={() => setMenuOpen(false)} />}
    <aside className="sidebar" id="portal-navigation">
      <button className="drawer-close" type="button" aria-label="Close navigation" onClick={() => setMenuOpen(false)}><X size={20} /></button>
      <div className="sidebar-brand"><img src="/assets/campusshelf-emblem.png" alt="" /><div><b>CampusShelf</b><small>{isStudent ? "STUDENT PORTAL" : "LIBRARIAN DESK"}</small></div></div>
      <div className="sidebar-label">{isStudent ? "YOUR LIBRARY" : "WORKSPACE"}</div>
      <nav aria-label={isStudent ? "Student portal" : "Librarian workspace"}>{tabs.map(([key, label, icon]) => <button className={activeTab === key ? "active" : ""} key={key} aria-current={activeTab === key ? "page" : undefined} onClick={() => { setTab(key); setMenuOpen(false); window.scrollTo({ top: 0 }); }}><NavIcon name={icon} /><span>{label}</span>{activeTab === key && <span className="nav-active-dot" />}</button>)}</nav>
      {!isStudent && <div className="sidebar-help"><span className="eyebrow">QUICK NOTE</span><p>Scan the label on the physical copy, not the book cover.</p><a href="/admin/">Open Django Admin ↗</a></div>}
      <div className="sidebar-user"><div className="avatar">{user.name.slice(0, 1).toUpperCase()}</div><div><b>{user.name}</b><small>{isStudent ? user.student_id : user.login_id}</small></div></div>
    </aside>
    <main className="main-area"><header className="topbar"><button className="menu-toggle" type="button" aria-label={menuOpen ? "Close navigation" : "Open navigation"} aria-expanded={menuOpen} aria-controls="portal-navigation" onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X size={21} /> : <Menu size={21} />}</button><div><span className="eyebrow">{isStudent ? "STUDENT PORTAL" : "LIBRARIAN WORKSPACE"}</span><h1>{active[1]}</h1></div><div className="topbar-right"><span className="portal-chip">{isStudent ? "Reader account" : "Library staff"}</span><span className="top-date">{new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span><button className="signout-button" type="button" onClick={signOut}>Sign out</button></div></header>
      {notice && <div className={`notice ${notice.kind}`} role="status">{notice.text}<button aria-label="Dismiss notification" onClick={() => setNotice(null)}>×</button></div>}
      <LazyMotion features={domAnimation}><AnimatePresence mode="wait" initial={false}><m.div id="portal-content" tabIndex={-1} className="page-content" key={tab + (selectedBook?.id || "")} initial={reducedMotion ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: reducedMotion ? 0 : -6 }} transition={{ duration: reducedMotion ? 0 : .2 }}>{content}</m.div></AnimatePresence></LazyMotion>
    </main>
    <Chatbot user={user} />
  </div>;
}
