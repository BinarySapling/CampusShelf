import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));

export default function CopyLabels({ copies, title, loading = false }) {
  const [selected, setSelected] = useState([]);
  const selectedCopies = copies.filter((copy) => selected.includes(copy.id));

  function printLabels(items) {
    if (!items.length) return;
    const labels = items.map((copy) => {
      const card = document.getElementById(`copy-label-${copy.id}`);
      const svg = card?.querySelector("svg")?.outerHTML;
      if (!svg) throw new Error("Label is not ready. Please refresh the labels.");
      return `<article><small>CampusShelf · Library copy</small><h1>${escapeHtml(copy.book_title || title)}</h1>${svg}<strong>${escapeHtml(copy.copy_id)}</strong><p>Shelf ${escapeHtml(copy.shelf || "Unassigned")}</p></article>`;
    }).join("");
    const frame = document.createElement("iframe");
    frame.title = "Print selected copy labels";
    frame.style.cssText = "position:fixed;width:1px;height:1px;left:-10000px;border:0";
    frame.onload = () => {
      const printWindow = frame.contentWindow;
      if (!printWindow) { frame.remove(); return; }
      printWindow.addEventListener("afterprint", () => frame.remove(), { once: true });
      printWindow.focus();
      printWindow.print();
    };
    frame.srcdoc = `<!doctype html><html><head><title>CampusShelf copy labels</title><style>@page{margin:12mm}*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif;color:#000}article{width:65mm;text-align:center;padding:5mm;border:1px dashed #777;break-after:page;page-break-after:always;break-inside:avoid}article:last-child{break-after:auto;page-break-after:auto}small{font-size:9pt}h1{font-size:13pt;line-height:1.3;margin:4mm 0;overflow-wrap:anywhere}svg{display:block;width:38mm;height:38mm;margin:4mm auto}strong{display:block;font-size:10pt;overflow-wrap:anywhere}p{font-size:10pt;margin:3mm 0 0}</style></head><body>${labels}</body></html>`;
    document.body.appendChild(frame);
  }

  return <section className="panel qr-panel">
    <div className="panel-head"><div><span className="eyebrow">PRINTABLE COPY LABELS</span><h3>{title}</h3></div></div>
    <div className="label-print-toolbar">
      <div className="label-selection-actions"><button type="button" className="text-button" disabled={loading || !copies.length} onClick={() => setSelected(copies.map((copy) => copy.id))}>Select all</button><button type="button" className="text-button" disabled={!selectedCopies.length} onClick={() => setSelected([])}>Clear selection</button><span role="status">{selectedCopies.length} of {copies.length} selected</span></div>
      <div className="button-line"><button type="button" className="button light" disabled={loading || !copies.length} onClick={() => printLabels(copies)}>Print all labels</button><button type="button" className="button primary" disabled={loading || !selectedCopies.length} onClick={() => printLabels(selectedCopies)}>Print selected ({selectedCopies.length})</button></div>
    </div>
    <p className="route-hint">Choose individual copies or select all. Each label prints on a separate page; the print dialog controls paper size.</p>
    <div className="qr-grid copy-status-grid">{copies.map((copy) => <article id={`copy-label-${copy.id}`} className={`qr-card copy-status-card ${selected.includes(copy.id) ? "label-selected" : ""}`} key={copy.id}>
      <label className="label-checkbox"><input type="checkbox" checked={selected.includes(copy.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, copy.id] : current.filter((id) => id !== copy.id))} /><span>Select {copy.copy_id}</span></label>
      <QRCodeSVG value={copy.copy_id} size={116} marginSize={4} />
      <span>{copy.book_title || title}</span><b>{copy.copy_id}</b><span>Shelf {copy.shelf || "Unassigned"}</span><span className={`status ${copy.status}`}>{copy.status === "available" ? "Free to borrow" : "Allotted"}</span>
      <button className="button light small" type="button" onClick={() => printLabels([copy])}>Print this label</button>
    </article>)}</div>
    {loading && <p className="empty">Loading copy labels…</p>}{!loading && !copies.length && <p className="empty">There are no physical copies to label yet.</p>}
  </section>;
}
