import { useEffect, useState } from "react";
import { Search, SlidersHorizontal } from "lucide-react";
import { api } from "./api.js";
import { ActiveFilters, CheckboxGroup } from "./Filters.jsx";

const emptyFilters = { categories: [], availability: [], extras: [] };
const availabilityOptions = [{ value: "available", label: "Available now" }, { value: "unavailable", label: "Join the hold queue" }];
const extraOptions = [{ value: "rated", label: "Rated 4 stars & above" }, { value: "cover", label: "Has a cover image" }];

export default function CatalogueExplorer({ path, renderBook, action }) {
  const [query, setQuery] = useState("");
  const [term, setTerm] = useState("");
  const [filters, setFilters] = useState(emptyFilters);
  const [sort, setSort] = useState("title");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(24);
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState({ results: [], categories: [], pagination: { total: 0, pages: 1, page: 1 } });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ q: term, sort, page: String(page), page_size: String(pageSize) });
    filters.categories.forEach((category) => params.append("category", category));
    filters.availability.forEach((status) => params.append("availability", status));
    if (filters.extras.includes("rated")) params.set("min_rating", "4");
    if (filters.extras.includes("cover")) params.set("with_cover", "1");
    setLoading(true); setError("");
    api(`${path}?${params}`, { signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) setData(result); })
      .catch((problem) => { if (!controller.signal.aborted) setError(problem.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [path, term, sort, page, pageSize, filters, revision]);

  function changeFilter(key, values) { setFilters((current) => ({ ...current, [key]: values })); setPage(1); }
  function clear() { setQuery(""); setTerm(""); setFilters(emptyFilters); setSort("title"); setPage(1); }
  const active = [
    ...(term ? [{ key: "search", label: `Search: ${term}`, remove: () => { setQuery(""); setTerm(""); setPage(1); } }] : []),
    ...Object.entries(filters).flatMap(([key, values]) => values.map((value) => ({ key: `${key}-${value}`, label: [...availabilityOptions, ...extraOptions].find((item) => item.value === value)?.label || value, remove: () => changeFilter(key, values.filter((item) => item !== value)) }))),
    ...(sort !== "title" ? [{ key: "sort", label: `Sort: ${sort === "rating" ? "Top rated" : sort === "newest" ? "Newest" : sort === "author" ? "Author" : "Title Z–A"}`, remove: () => { setSort("title"); setPage(1); } }] : []),
  ];
  return <section className="panel search-panel catalogue-explorer">
    <div className="panel-head"><div><span className="eyebrow">EXPLORE THE COLLECTION</span><h3>Find your next chapter</h3></div>{action}</div>
    <form className="catalogue-search-form" onSubmit={(event) => { event.preventDefault(); setTerm(query.trim()); setPage(1); setRevision((value) => value + 1); }}>
      <div className="search-input-wrap"><Search size={18} aria-hidden="true" /><input type="search" aria-label="Search the catalogue" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Title, author, ISBN, or shelf…" /></div><button className="button primary">Search books</button>
    </form>
    <details className="filter-disclosure" open>
      <summary><SlidersHorizontal size={17} aria-hidden="true" /> Refine your search <span>{active.length ? `${active.length} active` : "All titles"}</span></summary>
      <div className="catalogue-checkbox-filters">
        <CheckboxGroup label="Categories" searchable options={data.categories.map((value) => ({ value, label: value }))} selected={filters.categories} onChange={(values) => changeFilter("categories", values)} />
        <div><CheckboxGroup label="Availability" options={availabilityOptions} selected={filters.availability} onChange={(values) => changeFilter("availability", values)} /><CheckboxGroup label="More options" options={extraOptions} selected={filters.extras} onChange={(values) => changeFilter("extras", values)} /></div>
      </div>
    </details>
    <ActiveFilters items={active} onClear={clear} />
    <div className="catalogue-result-toolbar"><p role="status" aria-live="polite">{loading ? "Updating results…" : `${data.pagination.total} ${data.pagination.total === 1 ? "title" : "titles"} found`}</p><div><label>Sort by<select value={sort} onChange={(event) => { setSort(event.target.value); setPage(1); }}><option value="title">Title A–Z</option><option value="title_desc">Title Z–A</option><option value="author">Author A–Z</option><option value="newest">Newest additions</option><option value="rating">Top rated</option></select></label><label>Per page<select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}>{[12,24,48].map((size) => <option key={size}>{size}</option>)}</select></label></div></div>
    {error ? <div className="notice error" role="alert">{error}<button type="button" className="button light small" onClick={() => setRevision((value) => value + 1)}>Retry</button></div> : <>
      <div className={`catalogue-grid book-catalogue-grid ${loading ? "is-updating" : ""}`} aria-busy={loading}>{data.results.map(renderBook)}</div>
      {!loading && !data.results.length && <div className="empty"><h3>No books match these filters</h3><p>Try fewer categories or another search term.</p><button className="button light" type="button" onClick={clear}>Reset search & filters</button></div>}
      <div className="pagination-controls"><span>Page {data.pagination.page} of {data.pagination.pages}</span><div><button className="button light small" disabled={loading || data.pagination.page <= 1} onClick={() => setPage(data.pagination.page - 1)}>← Previous</button><button className="button light small" disabled={loading || data.pagination.page >= data.pagination.pages} onClick={() => setPage(data.pagination.page + 1)}>Next →</button></div></div>
    </>}
  </section>;
}
