import { useId, useState } from "react";

export function CheckboxGroup({ label, options, selected, onChange, disabled = false, searchable = false }) {
  const id = useId();
  const [query, setQuery] = useState("");
  const visible = options.filter((option) => option.label.toLowerCase().includes(query.trim().toLowerCase()));
  return <fieldset className="checkbox-filter" disabled={disabled}>
    <legend>{label}<span>{selected.length ? `${selected.length} selected` : "Any"}</span></legend>
    {searchable && <input className="filter-option-search" aria-label={`Find ${label.toLowerCase()} options`} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Find ${label.toLowerCase()}…`} />}
    <div className="checkbox-options">{visible.map((option, index) => <label key={option.value} htmlFor={`${id}-${index}`} className={selected.includes(option.value) ? "checked" : ""}><input id={`${id}-${index}`} type="checkbox" checked={selected.includes(option.value)} onChange={(event) => onChange(event.target.checked ? [...selected, option.value] : selected.filter((value) => value !== option.value))} /><span>{option.label}</span></label>)}</div>
    {!visible.length && <p className="filter-no-options">No matching options.</p>}
  </fieldset>;
}

export function ActiveFilters({ items, onClear }) {
  if (!items.length) return null;
  return <div className="active-filters" aria-label="Active filters">{items.map((item) => <button type="button" className="filter-chip" key={item.key} onClick={item.remove} aria-label={`Remove ${item.label} filter`}>{item.label}<span aria-hidden="true">×</span></button>)}<button type="button" className="text-button" onClick={onClear}>Clear all</button></div>;
}

export function filterRows(rows, query, choices) {
  const text = query.trim().toLowerCase();
  return rows.filter((row) => (!text || Object.values(row).filter((value) => typeof value === "string" || typeof value === "number").join(" ").toLowerCase().includes(text)) && Object.entries(choices).every(([key, values]) => !values.length || values.includes(String(row[key]))));
}

export function RecordFilters({ query, onQuery, choices, onChoices, groups, count, loading, label = "Search records" }) {
  function clear() { onQuery(""); onChoices({}); }
  const active = [
    ...(query ? [{ key: "query", label: `Search: ${query}`, remove: () => onQuery("") }] : []),
    ...groups.flatMap((group) => (choices[group.key] || []).map((value) => ({ key: `${group.key}-${value}`, label: group.options.find((option) => option.value === value)?.label || value, remove: () => onChoices({ ...choices, [group.key]: choices[group.key].filter((item) => item !== value) }) }))),
  ];
  return <div className="record-filters"><input type="search" aria-label={label} placeholder={label} value={query} onChange={(event) => onQuery(event.target.value)} /><div className="record-checkbox-groups">{groups.map((group) => <CheckboxGroup key={group.key} label={group.label} options={group.options} selected={choices[group.key] || []} onChange={(values) => onChoices({ ...choices, [group.key]: values })} />)}</div><ActiveFilters items={active} onClear={clear} /><p className="filter-result-count" role="status">{loading ? "Loading records…" : `${count} matching ${count === 1 ? "record" : "records"}`}</p></div>;
}
