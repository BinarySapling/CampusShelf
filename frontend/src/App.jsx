import { useEffect, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { api, formBody } from "./api.js";
import Scanner from "./Scanner.jsx";

const librarianTabs = [
  ["overview", "Overview", "⌂"],
  ["books", "Find a title", "⌕"],
  ["add_book", "Add a book", "+"],
  ["requests", "Signup requests", "✉"],
  ["students", "Students", "♙"],
  ["loans", "Issue & return", "↔"],
  ["fines", "Fines", "₹"],
  ["reviews", "Reader notes", "☆"],
  ["account", "Account", "⚙"],
];

const studentTabs = [
  ["catalogue", "Browse books", "▤"],
  ["my_loans", "My loans", "↔"],
  ["my_fines", "My fines", "₹"],
  ["account", "Account", "⚙"],
];

function noticeText(setNotice, text, kind = "success") {
  setNotice({ text, kind });
  window.setTimeout(() => setNotice(null), 4500);
}

function StatCard({ label, value, note }) {
  return <article className="stat-card"><span>{label}</span><strong>{value ?? "—"}</strong><small>{note}</small></article>;
}

function PageTitle({ eyebrow, title, note, action, image = true }) {
  return <div className={`page-title ${image ? "page-title-image" : ""}`}><div><span className="eyebrow">{eyebrow}</span><h2>{title}</h2>{note && <p>{note}</p>}</div>{action}{image && <img src="/assets/library-reading-room.jpg" alt="A sunny library reading table" />}</div>;
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
      <aside className="auth-art"><img src="/assets/owl-librarian.png" alt="" /><div><span className="eyebrow">READ · RETURN · REPEAT</span><h2>Every book has a place. Every reader has a story.</h2><p>A friendly campus library desk, online whenever you need it.</p></div></aside>
    </main>
  );
}

function Dashboard({ setNotice }) {
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
      <img src="/assets/library-reading-room.jpg" alt="Sunlight falling across an open book in the library" />
      <div className="dashboard-hero-copy"><span className="eyebrow">CAMPUSSHELF / LIBRARIAN DESK</span><h2>A thoughtful space for every reader.</h2><p>Keep the shelves in order and help each book find its next reader.</p></div>
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
    <div className="feature-note"><div className="feature-icon">₹</div><div><b>Overdue fines update automatically</b><p>₹20 for each calendar day after the due date. No daily job or duplicate charge is needed.</p></div></div>
  </>;
}

function BooksPage({ setNotice, onAddBook, onOpenBook }) {
  const [books, setBooks] = useState([]);
  const [copies, setCopies] = useState(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  async function loadBooks(query = "") {
    setLoading(true);
    try {
      const result = await api(`/books/?q=${encodeURIComponent(query)}`);
      setBooks(result.results);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { loadBooks().catch((error) => noticeText(setNotice, error.message, "error")); }, []);

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
      <form className="search-row" onSubmit={(event) => { event.preventDefault(); loadBooks(search).catch((error) => noticeText(setNotice, error.message, "error")); }}><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Type a title or author" /><button className="button light" disabled={loading}>{loading ? "Loading…" : "Search"}</button></form>
      <p className="route-hint">{loading ? "Loading the collection…" : `${books.length} title${books.length === 1 ? "" : "s"} found · Select a book to open its copy labels.`}</p>
      <div className="catalogue-grid book-catalogue-grid">{books.map((book) => <button type="button" className="catalogue-card book-tile" key={book.id} onClick={() => onOpenBook(book)}>
        <img src="/assets/library-reading-room.jpg" alt="" />
        <span className="eyebrow">{book.category}</span><h3>{book.title}</h3><p>{book.author}</p>
        <div className="catalogue-footer"><span>{book.available} / {book.total} copies free</span><small>Shelf {book.shelf || "Unassigned"}</small></div>
        <span className="book-tile-link">Open copies →</span>
      </button>)}{loading && <p className="empty">Loading titles…</p>}{!loading && books.length === 0 && <p className="empty">No titles found. Try another search or add a new book.</p>}</div>
    </section>
    {copies && <section className="panel qr-panel"><div className="panel-head"><div><span className="eyebrow">PRINTABLE LABELS</span><h3>{copies.title}</h3></div><button className="button light" onClick={() => window.print()}>Print labels</button></div><div className="qr-grid">{copies.results.map((copy) => <article className="qr-card" key={copy.id}><QRCodeSVG value={copy.copy_id} size={120} />{copies.title === "All book copies" && <span>{copy.book_title}</span>}<b>{copy.copy_id}</b><span>{copy.status === "available" ? "Free" : "Allotted"} · {copy.shelf}</span></article>)}</div>{copies.results.length === 0 && <p className="empty">There are no physical copies to label yet.</p>}</section>}
  </>;
}

function AddBookPage({ setNotice, onSaved, onCancel }) {
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true);
    try {
      const result = await api("/books/", { method: "POST", body: formBody(Object.fromEntries(new FormData(form))) });
      noticeText(setNotice, "Book added. Its copy labels are ready to open.");
      onSaved(result.book);
    } catch (error) {
      noticeText(setNotice, error.message, "error");
    } finally {
      setBusy(false);
    }
  }

  return <>
    <PageTitle eyebrow="LIBRARY CATALOGUE / NEW TITLE" title="Add a book" note="Add the title once, then print a separate QR label for each physical copy." action={<button className="button light" onClick={onCancel}>Back to search</button>} />
    <section className="add-book-layout">
      <form className="panel stack-form add-book-form" onSubmit={submit}>
        <div className="panel-head"><div><span className="eyebrow">BOOK DETAILS</span><h3>New catalogue entry</h3></div></div>
        <label>Title<input name="title" required maxLength="120" /></label>
        <label>Author<input name="author" required maxLength="100" /></label>
        <div className="two-fields"><label>Category<input name="category" required maxLength="40" placeholder="Technology" /></label><label>ISBN<input name="isbn" maxLength="20" /></label></div>
        <div className="two-fields"><label>Number of copies<input name="copies" type="number" min="0" max="200" defaultValue="1" required /></label><label>Shelf<input name="shelf" maxLength="30" placeholder="A-01" /></label></div>
        <label>Description<textarea name="description" maxLength="300" rows="4" placeholder="A short note about this title" /></label>
        <button className="button primary" disabled={busy}>{busy ? "Saving book…" : "Save book"}</button>
      </form>
      <aside className="add-book-art"><img src="/assets/library-reading-room.jpg" alt="Open books on a sunny library table" /><div><span className="eyebrow">ONE TITLE, MANY READERS</span><h3>Every copy gets its own identity.</h3><p>CampusShelf creates a unique Copy ID for each copy you add.</p></div></aside>
    </section>
  </>;
}

function BookDetailPage({ book, setNotice, onBack }) {
  const [copies, setCopies] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api(`/books/${book.id}/copies/`)
      .then((data) => setCopies(data.results))
      .catch((error) => noticeText(setNotice, error.message, "error"))
      .finally(() => setLoading(false));
  }, [book.id]);

  const availableCount = copies.filter((copy) => copy.status === "available").length;

  return <>
    <PageTitle eyebrow="BOOK DETAILS / PHYSICAL COPIES" title={book.title} note={`${book.author} · ${book.category}`} action={<button className="button light" onClick={onBack}>← Back to titles</button>} />
    <section className="book-detail-hero"><img src="/assets/library-reading-room.jpg" alt="Books and an open book at a library table" /><div><span className="eyebrow">{book.category}</span><h3>{book.title}</h3><p>{book.description || "A title in the CampusShelf collection."}</p><div className="detail-stats"><span><b>{book.total}</b> physical copies</span><span><b>{availableCount}</b> free to borrow</span><span><b>{copies.length - availableCount}</b> allotted</span></div></div></section>
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
      const copy = await api(`/copies/${encodeURIComponent(value)}/`);
      setScanInfo(`${copy.book_title} · ${copy.status}`);
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
      } else {
        const result = await api("/returns/copy/", { method: "POST", body: formBody(values) });
        noticeText(setNotice, result.fine ? `Returned. Overdue fine: ₹${result.fine.amount}` : "Book returned. No overdue fine.");
      }
      setCopyId("");
      setScanInfo(null);
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
        <div className="button-line"><button className="button light" type="button" onClick={() => setScanOpen((open) => !open)}>{scanOpen ? "Close scanner" : "Open camera scanner"}</button><button className="button primary" disabled={busy}>{busy ? "Saving…" : mode === "issue" ? "Confirm issue" : "Complete return"}</button></div>
      </form>
      <Scanner open={scanOpen} onScan={scanned} onError={(message) => noticeText(setNotice, message, "error")} />
      {scanInfo && <p className="scan-result">{scanInfo}</p>}
    </section>
    <section className="panel"><div className="panel-head"><div><span className="eyebrow">RECENT ACTIVITY</span><h3>Issue register</h3></div><span className="pill">{loans.length} records</span></div>
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
      const [reviewData, bookData, memberData] = await Promise.all([api("/reviews/"), api("/books/"), api("/members/catalogue/")]);
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

function StudentPortal({ user, tab, setNotice, selectedBook, onOpenBook, onBackToBooks }) {
  const [books, setBooks] = useState([]);
  const [loans, setLoans] = useState([]);
  const [fines, setFines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [copyId, setCopyId] = useState("");
  const [copyInfo, setCopyInfo] = useState(null);
  const [scanOpen, setScanOpen] = useState(false);
  const [slip, setSlip] = useState(null);

  async function load(searchTerm = query) {
    setLoading(true);
    try {
      if (tab === "catalogue") setBooks((await api(`/catalogue/?q=${encodeURIComponent(searchTerm)}`)).results);
      if (tab === "my_loans") setLoans((await api("/student/loans/")).results);
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
      setSlip(result.loan);
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
    try { await load(query); } catch (error) { noticeText(setNotice, error.message, "error"); }
  }

  function openIssueSlip(loan) {
    setSlip(loan);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (tab === "catalogue") return <>
    <section className="student-welcome"><img src="/assets/library-reading-room.jpg" alt="A bright corner of the campus library" /><div><span className="eyebrow">YOUR CAMPUS LIBRARY</span><h2>Hello, {user.name.split(" ")[0]}.</h2><p>Find a title, then scan the QR on the exact copy you want to borrow.</p></div></section>
    {slip && <IssueSlip loan={slip} onClose={() => setSlip(null)} />}
    <section className="panel"><div className="panel-head"><div><span className="eyebrow">COLLECTION</span><h3>Search the shelves</h3></div></div><form className="search-row" onSubmit={search}><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search books or authors" /><button className="button light" disabled={loading}>{loading ? "Loading…" : "Search"}</button></form>
      <div className="catalogue-grid book-catalogue-grid">{books.map((book) => <button type="button" className="catalogue-card book-tile" key={book.id} onClick={() => onOpenBook(book)}><img src="/assets/library-reading-room.jpg" alt="" /><span className="eyebrow">{book.category}</span><h3>{book.title}</h3><p>{book.author}</p><div className="catalogue-footer"><span>{book.available} copies free</span><small>Shelf {book.shelf || "Unassigned"}</small></div><span className="book-tile-link">Open title →</span></button>)}{loading && <p className="empty">Loading books…</p>}{!loading && books.length === 0 && <p className="empty">No books match that search.</p>}</div>
    </section>
    <section className="panel scan-student"><div><span className="eyebrow">READY TO BORROW</span><h3>Scan your copy</h3><p>Sign in first, scan the QR label, and confirm the issue. You can borrow up to five books.</p><button className="button primary" disabled={busy} onClick={() => setScanOpen((open) => !open)}>{scanOpen ? "Close camera" : "Open QR scanner"}</button></div><div className="scan-side">{copyInfo ? <><b>{copyInfo.book_title}</b><span>{copyInfo.copy_id}</span><span className={`status ${copyInfo.status}`}>{copyInfo.status}</span>{copyInfo.status === "available" && <button className="button dark" disabled={busy} onClick={issueCopy}>{busy ? "Checking out…" : "Confirm checkout"}</button>}</> : <span className="scan-symbol">⌗</span>}</div></section>
    <Scanner open={scanOpen} onScan={scanned} onError={(message) => noticeText(setNotice, message, "error")} />
  </>;

  if (tab === "student_book") return <>
    <PageTitle eyebrow="STUDENT CATALOGUE / TITLE DETAILS" title={selectedBook.title} note={`${selectedBook.author} · ${selectedBook.category}`} action={<button className="button light" onClick={onBackToBooks}>← Back to books</button>} />
    <section className="book-detail-hero"><img src="/assets/library-reading-room.jpg" alt="A reading table in the campus library" /><div><span className="eyebrow">{selectedBook.category}</span><h3>{selectedBook.title}</h3><p>{selectedBook.description || "Find this title on the library shelves."}</p><div className="detail-stats"><span><b>{selectedBook.available}</b> copies free to borrow</span><span><b>{selectedBook.total}</b> copies in the library</span><span>Shelf <b>{selectedBook.shelf || "Unassigned"}</b></span></div></div></section>
    <section className="panel detail-next-step"><span className="eyebrow">READY TO BORROW</span><h3>Scan the QR on your chosen copy</h3><p>Go back to the catalogue to open the scanner. The librarian scans the same copy QR when you return it.</p><button className="button primary" onClick={onBackToBooks}>Back to catalogue and scanner</button></section>
  </>;

  if (tab === "my_loans") return <>
    <PageTitle eyebrow="STUDENT PORTAL / CIRCULATION" title="My loans" note="Your active issues and return dates." />
    {slip && <IssueSlip loan={slip} onClose={() => setSlip(null)} />}
    <section className="panel"><div className="table-scroll"><table><thead><tr><th>Book</th><th>Copy ID</th><th>Issue ID</th><th>Due date</th><th>Fine today</th><th>Status</th><th>Slip / return QR</th></tr></thead><tbody>{loans.map((loan) => <tr key={loan.id}><td><b>{loan.book_title}</b><small>{loan.book_author}</small></td><td><code>{loan.copy_id}</code></td><td><code>{loan.issue_code}</code></td><td>{new Date(loan.due_at).toLocaleDateString()}</td><td>{loan.current_fine === "0" ? "—" : `₹${loan.current_fine}`}</td><td><span className={`status ${loan.status}`}>{loan.status}</span></td><td><button className="button light small" onClick={() => openIssueSlip(loan)}>{loan.status === "borrowed" ? "Open return QR & slip" : "Open issue slip"}</button></td></tr>)}</tbody></table></div>{loading && <p className="empty">Loading your loans…</p>}{!loading && loans.length === 0 && <p className="empty">You do not have any loans yet.</p>}</section>
  </>;

  return <>
    <PageTitle eyebrow="STUDENT PORTAL / ACCOUNT" title="My fines" note="The current overdue amount starts on the calendar day after your due date." />
    <section className="panel"><div className="fine-list">{fines.map((fine) => <article className="fine-row" key={fine.id}><div className="fine-amount">₹{fine.amount}</div><div className="fine-info"><b>{fine.reason}</b><span>{fine.fine_type === "overdue" ? "Overdue fine" : "Custom fine"}</span><small>{new Date(fine.created_at).toLocaleDateString()}</small></div><span className={`status ${fine.status}`}>{fine.status}</span></article>)}{loading && <p className="empty">Loading your fines…</p>}{!loading && fines.length === 0 && <p className="empty">You do not have any fines.</p>}</div></section>
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
  const activeTab = tab === "book_detail" ? "books" : tab === "student_book" ? "catalogue" : tab;
  const active = tabs.find((item) => item[0] === activeTab) || tabs[0];
  let content;
  if (tab === "account") content = <AccountPage user={user} setNotice={setNotice} />;
  else if (isStudent) content = <StudentPortal key={tab} user={user} tab={tab} setNotice={setNotice} selectedBook={selectedBook} onOpenBook={(book) => { setSelectedBook(book); setTab("student_book"); }} onBackToBooks={() => setTab("catalogue")} />;
  else if (tab === "overview") content = <Dashboard setNotice={setNotice} />;
  else if (tab === "books") content = <BooksPage setNotice={setNotice} onAddBook={() => setTab("add_book")} onOpenBook={(book) => { setSelectedBook(book); setTab("book_detail"); }} />;
  else if (tab === "add_book") content = <AddBookPage setNotice={setNotice} onCancel={() => setTab("books")} onSaved={(book) => { setSelectedBook(book); setTab("book_detail"); }} />;
  else if (tab === "book_detail" && selectedBook) content = <BookDetailPage key={selectedBook.id} book={selectedBook} setNotice={setNotice} onBack={() => setTab("books")} />;
  else if (tab === "book_detail") content = <BooksPage setNotice={setNotice} onAddBook={() => setTab("add_book")} onOpenBook={(book) => { setSelectedBook(book); setTab("book_detail"); }} />;
  else if (tab === "requests") content = <RequestsPage setNotice={setNotice} />;
  else if (tab === "students") content = <StudentsPage setNotice={setNotice} />;
  else if (tab === "loans") content = <LoansPage setNotice={setNotice} />;
  else if (tab === "fines") content = <FinesPage setNotice={setNotice} />;
  else content = <ReviewsPage setNotice={setNotice} />;

  return <div className={`app-shell ${isStudent ? "student-shell" : ""}`}>
    <aside className="sidebar">
      <div className="sidebar-brand"><img src="/assets/campusshelf-emblem.png" alt="" /><div><b>CampusShelf</b><small>{isStudent ? "STUDENT PORTAL" : "LIBRARIAN DESK"}</small></div></div>
      <div className="sidebar-label">{isStudent ? "YOUR LIBRARY" : "WORKSPACE"}</div>
      <nav>{tabs.map(([key, label, icon]) => <button className={tab === key ? "active" : ""} key={key} onClick={() => setTab(key)}><span className="nav-icon">{icon}</span>{label}{key === "requests" && <i className="nav-dot" />}</button>)}</nav>
      {!isStudent && <div className="sidebar-help"><span className="eyebrow">QUICK NOTE</span><p>Scan the label on the physical copy, not the book cover.</p><a href="/admin/">Open Django Admin ↗</a></div>}
      <div className="sidebar-user"><div className="avatar">{user.name.slice(0, 1).toUpperCase()}</div><div><b>{user.name}</b><small>{isStudent ? user.student_id : user.login_id}</small></div><button title="Sign out" onClick={signOut}>↗</button></div>
    </aside>
    <main className="main-area"><header className="topbar"><div><span className="eyebrow">{active[1].toUpperCase()}</span><h1>{active[1]}</h1></div><div className="topbar-right"><span className="db-indicator"><i /> MongoDB</span><span className="top-date">CampusShelf Library</span></div></header>
      {notice && <div className={`notice ${notice.kind}`} role="status">{notice.text}<button onClick={() => setNotice(null)}>×</button></div>}
      <div className="page-content">{content}</div>
    </main>
  </div>;
}
