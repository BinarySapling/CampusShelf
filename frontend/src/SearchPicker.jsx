import { lazy, Suspense, useEffect, useId, useRef, useState } from "react";
const Select = lazy(() => import("react-select"));

export default function SearchPicker({ label, name, options, value, onChange, required = false, disabled = false, loading = false, placeholder }) {
  const id = useId();
  const wrapper = useRef(null);
  const [internalValue, setInternalValue] = useState("");
  const selectedId = value === undefined ? internalValue : value;
  useEffect(() => {
    const form = wrapper.current?.closest("form");
    const reset = () => { setInternalValue(""); onChange?.(""); };
    form?.addEventListener("reset", reset);
    return () => form?.removeEventListener("reset", reset);
  }, [onChange]);
  return <div className="search-picker-field" ref={wrapper}>
    <label htmlFor={id}>{label}</label>
    <Suspense fallback={<input id={id} required={required} value="" onChange={() => {}} placeholder="Loading searchable choices…" aria-busy="true" />}><Select inputId={id} instanceId={id} name={name} options={options}
      value={options.find((option) => option.value === selectedId) || null}
      onChange={(option) => { const next = option?.value || ""; setInternalValue(next); onChange?.(next); }}
      required={required} isDisabled={disabled} isLoading={loading} isClearable isSearchable
      placeholder={placeholder || "Type to search…"} className="search-picker" classNamePrefix="picker"
      noOptionsMessage={({ inputValue }) => inputValue ? "No matches. Try another name, ID, or title." : "No entries available."}
      menuPosition="fixed" menuPortalTarget={typeof document === "undefined" ? undefined : document.body}
      styles={{ menuPortal: (base) => ({ ...base, zIndex: 1200 }) }}
      formatOptionLabel={(option, { context }) => context === "value" ? option.label : <div className="picker-result"><span>{option.label}</span>{option.detail && <small>{option.detail}</small>}</div>}
      filterOption={({ data }, input) => `${data.label} ${data.detail || ""}`.toLocaleLowerCase().includes(input.trim().toLocaleLowerCase())}
    /></Suspense>
  </div>;
}
