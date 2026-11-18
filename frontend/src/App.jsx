import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { api, formBody } from "./api.js";
import Scanner from "./Scanner.jsx";

const librarianTabs = [
  ["overview", "Overview", "overview"],
  ["books", "Catalogue", "books"],
  ["add_book", "Add a title", "add_book"],
  ["reservations", "Book holds", "requests"],
  ["renewals", "Renewals", "loans"],
  ["reports", "Reports", "overview"],
  ["requests", "Access requests", "requests"],
  ["students", "Students", "students"],
  ["loans", "Circulation", "loans"],
  ["fines", "Fines", "fines"],
  ["reviews", "Reader notes", "reviews"],
  ["account", "Account", "account"],
];

const studentTabs = [
  ["catalogue", "Discover", "books"],
  ["my_loans", "My loans", "loans"],
  ["my_holds", "My holds", "requests"],
  ["my_fines", "My fines", "fines"],
  ["account", "Account", "account"],
];

function noticeText(setNotice, text, kind = "success") {
  setNotice({ text, kind });
  window.setTimeout(() => setNotice(null), 4500);
}

function StatCard({ label, value, note }) {
  return <article className="stat-card"><span>{label}</span><strong>{value ?? "—"}</strong><small>{note}</small></article>;
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
  const paths = {
    overview: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
    books: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v17H6.5A2.5 2.5 0 0 0 4 22z" /><path d="M4 5.5v14A2.5 2.5 0 0 1 6.5 17H20M8 7h8" /></>,
    add_book: <><path d="M5 4h11a2 2 0 0 1 2 2v7" /><path d="M5 4v16h7M8 8h6M16 16h6M19 13v6" /></>,
    requests: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m4 7 8 6 8-6" /></>,
    students: <><path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="10" cy="7" r="4" /><path d="M20 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>,
    loans: <><path d="M7 7h13l-3-3M20 7l-3 3M17 17H4l3 3M4 17l3-3" /></>,
    fines: <><circle cx="12" cy="12" r="9" /><path d="M15 8.5a3.5 3.5 0 0 0-2.7-1.1c-1.5 0-2.5.8-2.5 1.9 0 3 5.7 1.3 5.7 4.6 0 1.3-1.1 2.3-2.9 2.3a4.2 4.2 0 0 1-3.2-1.3M12 5.5v13" /></>,
    reviews: <><path d="m12 3 2.7 5.5 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" /></>,
    account: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-1.8 3.1-.2-.1a1.7 1.7 0 0 0-1.8.4l-.1.1h-3.6l-.1-.2a1.7 1.7 0 0 0-1.6-1.1 1.7 1.7 0 0 0-1.2.5l-.1.1-3.1-1.8.1-.2A1.7 1.7 0 0 0 6 16l-.1-.1v-3.6l.2-.1a1.7 1.7 0 0 0 .6-2.8l-.1-.1 1.8-3.1.2.1a1.7 1.7 0 0 0 2.8-1.4V4.8H15v.2a1.7 1.7 0 0 0 2.8 1.2l.1-.1L21 7.9l-.1.2a1.7 1.7 0 0 0 .4 1.8l.1.1v3.6l-.2.1a1.7 1.7 0 0 0-1.8 1.3z" /></>,
  };
  return <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] || paths.books}</svg>;
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
        <div className="auth-brand"><img src="/assets/campusshelf-emblem.png" alt="" /><div><b>CampusShelf</b><small>THE KNOWLEDGE CLUB</small></div></div>
        <span className="eyebrow">A CALMER KIND OF LIBRARY</span>
        <h1>{mode === "signup" ? "Request student access" : mode === "setup" ? "Set up the library desk" : "Welcome back"}</h1>
        <p className="muted">{mode === "signup" ? "Send your campus details to a librarian for approval." : mode === "setup" ? "Create the first librarian account to get started." : "Sign in to manage your reading and borrowing."}</p>
        {error && <div className="notice error">{error}</div>}
        <form className="stack-form" onSubmit={submit}>
          {mode === "signup" && <>
            <label>Full name<input name="name" required maxLength="100" autoComplete="name" /></label>
            <label>Campus email<input name="email" type="email" required maxLength="160" autoComplete="email" /></label>
            <label>Registration number<input name="registration_number" required maxLength="50" /></label>
            <div className="two-fields"><label>Course<input name="course" required maxLength="60" placeholder="CSE" /></label><label>Year<select name="year" required defaultValue="1">{[1, 2, 3, 4, 5, 6].map((year) => <option key={year} value={year}>Year {year}</option>)}</select></label></div>
            <label>Password<input name="password" type="password" minLength="10" required autoComplete="new-password" /></label>
            <label>Confirm password<input name="confirm_password" type="password" minLength="10" required autoComplete="new-password" /></label>
          </>}
          {mode === "setup" && <>
            <label>Librarian name<input name="name" required maxLength="80" autoComplete="name" /></label>
            <label>First setup code<input name="setup_code" type="password" autoComplete="one-time-code" /></label>
            <label>Password<input name="password" type="password" minLength="10" required autoComplete="new-password" /></label>
          </>}
          {mode === "login" && <>
            <label>Student ID or librarian ID<input name="login_id" required autoComplete="username" /></label>
            <label>Password<input name="password" type="password" required autoComplete="current-password" /></label>
          </>}
          <button className="button primary full" disabled={busy}>{busy ? "Please wait…" : mode === "signup" ? "Send approval request" : mode === "setup" ? "Create librarian account" : "Sign in"}</button>
        </form>
        <div className="auth-links">
          {mode !== "login" && <button className="text-button" onClick={() => setMode("login")}>Back to sign in</button>}
          {mode === "login" && <>
            <button className="text-button" onClick={() => setMode("signup")}>Student? Request access</button>
            {setupAvailable && <button className="text-button muted-link" onClick={() => setMode("setup")}>First time? Set up librarian</button>}
          </>}
        </div>
        <div className="auth-note"><span>✓</span> Copy QR codes only identify a book. Your account is always needed to borrow.</div>
      </section>
      <aside className="auth-art"><div className="auth-art-mark" aria-hidden="true">C<span>S</span></div><div><span className="eyebrow">A PLACE FOR THE NEXT CHAPTER</span><h2>Good books travel. Ideas stay with you.</h2><p>Your campus collection, ready when you are.</p></div></aside>
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
      <div className="table-scroll"><table><thead><tr><th>Issue ID</th><th>Book / copy</th><th>Student</th><th>Due date</th><th>Current fine</th><th>Status</th></tr></thead><tbody>{loans.map((loan) => <tr key={loan.id}><td><code>{loan.issue_code}</code></td><td><b>{loan.book_title}</b><small>{loan.copy_id}</small></td><td>{loan.member_name}<small>{loan.student_id}</small></td><td>{new Date(loan.due_at).toLocaleDateString()}</td><td>{loan.current_fine === "0" ? "—" : `₹${loan.current_fine}`}</td><td><span className={`status ${loan.status}`}>{loan.status}</span></td></tr>)}</tbody></table></div>{loading && <p className="empty">Loading issue records…</p>}{!loading && loans.length === 0 && <p className="empty">No books have been issued yet.</p>}
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

function StudentPortal({ user, tab, setTab, setNotice, selectedBook, onOpenBook, onBackToBooks, onBookRatingChange }) {
  const [books, setBooks] = useState([]);
  const [loans, setLoans] = useState([]);
  const [holds, setHolds] = useState([]);
  const [fines, setFines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
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
    try {
      await api("/student/renewals/", { method: "POST", body: formBody({ loan_id: loan.id }) });
      await load();
      noticeText(setNotice, "Renewal request sent to the library.");
    } catch (error) {
      noticeText(setNotice, error.message, "error");
    }
  }

  function openIssueSlip(loan) {
    setSlip(loan);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (tab === "catalogue") return <>
    <section className="student-welcome"><div><span className="eyebrow">YOUR CAMPUS LIBRARY</span><h2>Hello, {user.name.split(" ")[0]}.</h2><p>Find a title that interests you, then check out the exact copy from its QR label.</p></div><div className="welcome-mark" aria-hidden="true"><span>YOUR NEXT</span><b>read</b><span>STARTS HERE</span></div></section>
    {slip && <IssueSlip loan={slip} onClose={() => setSlip(null)} />}
    <section className="panel"><div className="panel-head"><div><span className="eyebrow">COLLECTION</span><h3>Search the shelves</h3></div></div><form className="search-row" onSubmit={search}><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search books or authors" /><button className="button light" disabled={loading}>{loading ? "Loading…" : "Search"}</button></form>
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
    <PageTitle eyebrow="STUDENT PORTAL / CIRCULATION" title="My loans" note="Your active issues and return dates." />
    {slip && <IssueSlip loan={slip} onClose={() => setSlip(null)} />}
    <section className="panel"><div className="table-scroll"><table><thead><tr><th>Book</th><th>Copy ID</th><th>Issue ID</th><th>Due date</th><th>Fine today</th><th>Status</th><th>Renewal</th><th>Slip / return QR</th></tr></thead><tbody>{loans.map((loan) => <tr key={loan.id}><td><b>{loan.book_title}</b><small>{loan.book_author}</small></td><td><code>{loan.copy_id}</code></td><td><code>{loan.issue_code}</code></td><td>{new Date(loan.due_at).toLocaleDateString()}</td><td>{loan.current_fine === "0" ? "—" : `₹${loan.current_fine}`}</td><td><span className={`status ${loan.status}`}>{loan.status}</span></td><td>{loan.renewal_status === "pending" ? <span className="status pending">In review</span> : loan.renewal_status === "approved" ? <span className="status approved">Renewed</span> : loan.renewal_status === "rejected" ? <span className="renewal-rejected"><span className="status rejected">Declined</span>{loan.renewal_allowed && <button className="button light small" onClick={() => requestRenewal(loan)}>Request again</button>}</span> : loan.renewal_allowed ? <button className="button light small" onClick={() => requestRenewal(loan)}>Request renewal</button> : "—"}</td><td><button className="button light small" onClick={() => openIssueSlip(loan)}>{loan.status === "borrowed" ? "Open return QR & slip" : "Open issue slip"}</button></td></tr>)}</tbody></table></div>{loading && <p className="empty">Loading your loans…</p>}{!loading && loans.length === 0 && <p className="empty">You do not have any loans yet.</p>}</section>
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

  async function signIn(values) {
    const result = await api("/auth/login/", { method: "POST", body: formBody(values) });
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
  if (!user) return <><AuthScreen onLogin={signIn} onSetup={setup} onSignup={signup} setupAvailable={setupAvailable} />{notice && <div className={`toast ${notice.kind}`}>{notice.text}</div>}</>;

  const isStudent = user.role === "student";
  const tabs = isStudent ? studentTabs : librarianTabs;
  const activeTab = tab === "book_detail" || tab === "add_book" || tab === "edit_book" ? "books" : tab === "student_book" ? "catalogue" : tab;
  const active = tabs.find((item) => item[0] === activeTab) || tabs[0];
  let content;
  if (tab === "account") content = <AccountPage user={user} setNotice={setNotice} />;
  else if (isStudent) content = <StudentPortal key={tab} user={user} tab={tab} setTab={setTab} setNotice={setNotice} selectedBook={selectedBook} onOpenBook={(book) => { setSelectedBook(book); setTab("student_book"); }} onBackToBooks={() => setTab("catalogue")} onBookRatingChange={(ratings) => setSelectedBook((book) => book ? { ...book, ...ratings } : book)} />;
  else if (tab === "overview") content = <Dashboard setNotice={setNotice} onNavigate={setTab} />;
  else if (tab === "books") content = <BooksPage setNotice={setNotice} onAddBook={() => setTab("add_book")} onOpenBook={(book) => { setSelectedBook(book); setTab("book_detail"); }} />;
  else if (tab === "add_book") content = <AddBookPage setNotice={setNotice} onCancel={() => setTab("books")} onSaved={(book) => { setSelectedBook(book); setTab("book_detail"); }} />;
  else if (tab === "edit_book" && selectedBook) content = <AddBookPage key={`edit-${selectedBook.id}`} book={selectedBook} setNotice={setNotice} onCancel={() => setTab("book_detail")} onSaved={(book) => { setSelectedBook(book); setTab("book_detail"); }} />;
  else if (tab === "book_detail" && selectedBook) content = <BookDetailPage key={selectedBook.id} book={selectedBook} setNotice={setNotice} onBack={() => setTab("books")} onEdit={(book) => { setSelectedBook(book); setTab("edit_book"); }} />;
  else if (tab === "book_detail") content = <BooksPage setNotice={setNotice} onAddBook={() => setTab("add_book")} onOpenBook={(book) => { setSelectedBook(book); setTab("book_detail"); }} />;
  else if (tab === "requests") content = <RequestsPage setNotice={setNotice} />;
  else if (tab === "reservations") content = <ReservationsPage setNotice={setNotice} />;
  else if (tab === "renewals") content = <RenewalsPage setNotice={setNotice} />;
  else if (tab === "reports") content = <ReportsPage setNotice={setNotice} />;
  else if (tab === "students") content = <StudentsPage setNotice={setNotice} />;
  else if (tab === "loans") content = <LoansPage setNotice={setNotice} />;
  else if (tab === "fines") content = <FinesPage setNotice={setNotice} />;
  else content = <ReviewsPage setNotice={setNotice} />;

  return <div className={`app-shell ${isStudent ? "student-shell" : ""}`}>
    <aside className="sidebar">
      <div className="sidebar-brand"><img src="/assets/campusshelf-emblem.png" alt="" /><div><b>CampusShelf</b><small>{isStudent ? "STUDENT PORTAL" : "LIBRARIAN DESK"}</small></div></div>
      <div className="sidebar-label">{isStudent ? "YOUR LIBRARY" : "WORKSPACE"}</div>
      <nav aria-label={isStudent ? "Student portal" : "Librarian workspace"}>{tabs.map(([key, label, icon]) => <button className={activeTab === key ? "active" : ""} key={key} onClick={() => setTab(key)}><NavIcon name={icon} />{label}</button>)}</nav>
      {!isStudent && <div className="sidebar-help"><span className="eyebrow">QUICK NOTE</span><p>Scan the label on the physical copy, not the book cover.</p><a href="/admin/">Open Django Admin ↗</a></div>}
      <div className="sidebar-user"><div className="avatar">{user.name.slice(0, 1).toUpperCase()}</div><div><b>{user.name}</b><small>{isStudent ? user.student_id : user.login_id}</small></div><button className="signout-button" title="Sign out" onClick={signOut}>Sign out</button></div>
    </aside>
    <main className="main-area"><header className="topbar"><div><span className="eyebrow">{isStudent ? "STUDENT PORTAL" : "LIBRARIAN WORKSPACE"}</span><h1>{active[1]}</h1></div><div className="topbar-right"><span className="portal-chip">{isStudent ? "Reader account" : "Library staff"}</span><span className="top-date">CampusShelf</span></div></header>
      {notice && <div className={`notice ${notice.kind}`} role="status">{notice.text}<button onClick={() => setNotice(null)}>×</button></div>}
      <div className="page-content">{content}</div>
    </main>
  </div>;
}
