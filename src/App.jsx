import { useState, useRef, useCallback, useEffect } from "react";
import ExcelJS from "exceljs";

const PEOPLE = ["Socio 1", "Socio 2", "Socio 3"];
const PERSON_COLORS = {
  "Socio 1":  { bg: "#DBEAFE", text: "#1D4ED8", border: "#BFDBFE" },
  "Socio 2":   { bg: "#D1FAE5", text: "#065F46", border: "#A7F3D0" },
  "Socio 3": { bg: "#EDE9FE", text: "#5B21B6", border: "#DDD6FE" },
};
const MONTHS = ["Tutti","Gen","Feb","Mar","Apr","Mag","Giu","Lug","Ago","Set","Ott","Nov","Dic"];

const Field = ({ label, value, onChange, placeholder, full, dark }) => (
  <div style={full ? { gridColumn: "1/-1" } : {}}>
    <label style={{ fontSize: 10, color: "#94A3B8", display: "block", marginBottom: 3, textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</label>
    <input value={value ?? ""} onChange={onChange} placeholder={placeholder}
      style={{ width: "100%", padding: "8px 11px", border: `1.5px solid ${dark ? "#475569" : "#E2D9C8"}`, borderRadius: 6, fontSize: 13, outline: "none", background: dark ? "#1E293B" : "#FDFCFA", color: dark ? "#F1F5F9" : "#1E293B" }} />
  </div>
);

function fileFingerprint(file) {
  return `${file.name}_${file.size}_${file.lastModified}`;
}

function isHeic(file) {
  const name = file.name.toLowerCase();
  return name.endsWith(".heic") || name.endsWith(".heif") ||
    file.type === "image/heic" || file.type === "image/heif";
}

async function heicToJpeg(file) {
  // Server-side conversion: send raw HEIC base64 to /api/heic-convert
  const arrayBuffer = await file.arrayBuffer();
  const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
  const resp = await fetch("/api/heic-convert", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ heicBase64: base64 }),
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error || `Conversione HEIC fallita (${resp.status})`);
  }
  const { jpegBase64 } = await resp.json();
  const byteChars = atob(jpegBase64);
  const byteArr = new Uint8Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) byteArr[i] = byteChars.charCodeAt(i);
  return new File([byteArr], file.name.replace(/\.(heic|heif)$/i, ".jpg"), { type: "image/jpeg" });
}

async function compressImage(file) {
  if (isHeic(file)) {
    file = await heicToJpeg(file);
  }
  return new Promise((res, rej) => {
    const reader = new FileReader();
    reader.onerror = rej;
    reader.onload = (e) => {
      const dataUrl = e.target.result;
      const img = new Image();
      img.onerror = () => res({ b64: dataUrl.split(",")[1], mediaType: "image/jpeg", previewUrl: dataUrl });
      img.onload = () => {
        const tryCompress = (maxPx, quality) => {
          let { width, height } = img;
          if (width > maxPx || height > maxPx) {
            if (width > height) { height = Math.round(height * maxPx / width); width = maxPx; }
            else { width = Math.round(width * maxPx / height); height = maxPx; }
          }
          const canvas = document.createElement("canvas");
          canvas.width = width; canvas.height = height;
          canvas.getContext("2d").drawImage(img, 0, 0, width, height);
          return canvas.toDataURL("image/jpeg", quality);
        };
        let out = tryCompress(800, 0.75);
        if (out.length > 3 * 1024 * 1024) out = tryCompress(600, 0.65);
        if (out.length > 3 * 1024 * 1024) out = tryCompress(400, 0.55);
        res({ b64: out.split(",")[1], mediaType: "image/jpeg", previewUrl: out });
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });
}

async function analyzeBase64(b64, mediaType, previewUrl) {
  const response = await fetch("/api/proxy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: b64 } },
          { type: "text", text: `Analizza questa immagine che potrebbe contenere uno o più scontrini fiscali italiani. Per OGNI scontrino presente rispondi con un array JSON. Rispondi SOLO con il JSON, nessun testo, nessun markdown, nessun backtick. Formato: [{"data":"GG/MM","numFisc":"numero scontrino o stringa vuota","ristorante":"nome esercente","importo":"numero con punto decimale es 12.32"}]. Se c'è un solo scontrino restituisci comunque un array con un elemento. Se non vedi nessuno scontrino restituisci []. Se un campo non è leggibile usa stringa vuota.` }
        ]
      }]
    })
  });
  const data = await response.json();
  if (!response.ok) throw new Error("HTTP " + response.status + ": " + JSON.stringify(data).slice(0, 300));
  const rawText = data.content?.find(b => b.type === "text")?.text?.trim() || "[]";
  let scontrini;
  try { scontrini = JSON.parse(rawText.replace(/```json|```/g, "").trim()); }
  catch(e) { throw new Error("Parse error: " + rawText.slice(0, 100)); }
  return { scontrini, previewUrl };
}

async function buildXLSX(entries) {
  const parseDate = (str) => {
    if (!str) return null;
    const [d, m] = str.split("/").map(Number);
    return (!d || !m) ? null : new Date(2025, m - 1, d);
  };
  const THIN = { style: "thin" };
  const CENTER = { horizontal: "center", vertical: "middle" };
  const wb = new ExcelJS.Workbook();
  for (const persona of PEOPLE) {
    const righe = entries.filter(e => e.persona === persona);
    const ws = wb.addWorksheet(persona);
    ws.columns = [{ width: 12.7 }, { width: 9.9 }, { width: 40.3 }, { width: 10.0 }];
    const hdr = ws.addRow(["DATA", "Num sc fisc.", "RISTORANTE/BAR", "IMPORTO"]);
    hdr.height = 15;
    [1,2,3,4].forEach(c => {
      hdr.getCell(c).font = { name: "Garamond", size: 9 };
      hdr.getCell(c).alignment = CENTER;
      hdr.getCell(c).border = { top: THIN, bottom: THIN };
    });
    ws.addRow([]);
    for (const e of righe) {
      const row = ws.addRow([parseDate(e.data), e.numFisc || "", e.ristorante, e.importo]);
      [1,2,3,4].forEach(c => {
        row.getCell(c).font = { name: "Garamond", size: 9 };
        row.getCell(c).alignment = CENTER;
        row.getCell(c).border = { top: THIN, bottom: THIN };
      });
      row.getCell(1).numFmt = "d-mmm";
      row.getCell(4).numFmt = '"€" #,##0.00';
    }
    ws.addRow([]);
    const tot = righe.reduce((s, e) => s + e.importo, 0);
    const totRow = ws.addRow(["", "", "TOTALE", tot]);
    totRow.getCell(3).font = { name: "Garamond", size: 12, bold: true, italic: true };
    totRow.getCell(3).alignment = { horizontal: "right", vertical: "middle" };
    totRow.getCell(4).font = { name: "Garamond", size: 9, bold: true };
    totRow.getCell(4).alignment = CENTER;
    totRow.getCell(4).numFmt = '[$€-2] #,##0.00';
  }
  const buffer = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: "SCONTRINI_2025.xlsx" });
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function App() {
  const [dark, setDark]                   = useState(() => localStorage.getItem("papertrail_dark") === "1");
  const [authed, setAuthed]               = useState(() => localStorage.getItem("scontrini_auth") === "ok");
  const [pwInput, setPwInput]             = useState("");
  const [pwError, setPwError]             = useState(false);
  const [queue, setQueue]                 = useState([]);
  const [currentFile, setCurrentFile]     = useState(null);
  const [pendingReview, setPendingReview] = useState([]);
  const [reviewIdx, setReviewIdx]         = useState(0);
  const [step, setStep]                   = useState("idle");
  const [entries, setEntries]             = useState(() => {
    try { return JSON.parse(localStorage.getItem("scontrini_entries") || "[]"); } catch { return []; }
  });
  const [toast, setToast]                 = useState(null);
  const [dragging, setDragging]           = useState(false);
  const [editForm, setEditForm]           = useState(null);
  const [persona, setPersona]             = useState("Socio 1");
  const [qrUrl, setQrUrl]                 = useState("");
  const [filterMonth, setFilterMonth]     = useState(0);
  const [editingId, setEditingId]         = useState(null);
  const [editingRow, setEditingRow]       = useState(null);
  const [showPreview, setShowPreview]     = useState(false);
  const [lightboxImg, setLightboxImg]     = useState(null);
  const [processedHashes, setProcessedHashes] = useState(() => {
    try { return JSON.parse(localStorage.getItem("scontrini_hashes") || "[]"); } catch { return []; }
  });

  const fileRef       = useRef();
  const folderRef     = useRef();
  const processingRef = useRef(false);

  // Theme colors
  const th = dark ? {
    bg: "#0F172A", card: "#1E293B", border: "#334155", text: "#F1F5F9",
    sub: "#94A3B8", inputBg: "#0F172A", hover: "#273548",
    header: "#020617", tableHead: "#162032", tableRow1: "#1E293B", tableRow2: "#172033",
    filterActive: "#422006", dropzone: "#172033",
  } : {
    bg: "#F5F0E8", card: "#fff", border: "#E2D9C8", text: "#1E293B",
    sub: "#94A3B8", inputBg: "#FDFCFA", hover: "#F8F5EF",
    header: "#1E293B", tableHead: "#F8F5EF", tableRow1: "#fff", tableRow2: "#FDFCFA",
    filterActive: "#FEF3C7", dropzone: "#fff",
  };

  useEffect(() => {
    localStorage.setItem("scontrini_entries", JSON.stringify(entries.map(({ preview, ...rest }) => rest)));
  }, [entries]);
  useEffect(() => { localStorage.setItem("scontrini_hashes", JSON.stringify(processedHashes)); }, [processedHashes]);
  useEffect(() => {
    setQrUrl(`https://quickchart.io/qr?text=${encodeURIComponent(window.location.href)}&size=160&margin=2`);
  }, []);

  const toggleDark = () => {
    setDark(d => {
      const next = !d;
      localStorage.setItem("papertrail_dark", next ? "1" : "0");
      return next;
    });
  };

  const handleLogin = () => {
    const correct = import.meta.env.VITE_APP_PASSWORD;
    if (pwInput === correct) {
      localStorage.setItem("scontrini_auth", "ok");
      setAuthed(true); setPwError(false);
    } else { setPwError(true); setPwInput(""); }
  };

  const showToast = (msg, type = "ok") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const filteredEntries = filterMonth === 0 ? entries : entries.filter(e => {
    const m = parseInt((e.data || "").split("/")[1]);
    return m === filterMonth;
  });

  const exportPDF = () => {
    const win = window.open("", "_blank");
    const months = ["","Gen","Feb","Mar","Apr","Mag","Giu","Lug","Ago","Set","Ott","Nov","Dic"];
    const label = filterMonth > 0 ? months[filterMonth] : "Tutti i mesi";
    let html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>PaperTrail 2025</title><style>
      body{font-family:Garamond,serif;padding:30px;color:#1E293B;}h1{font-size:18px;margin-bottom:4px;}
      .sub{font-size:12px;color:#64748B;margin-bottom:24px;}h2{font-size:14px;font-weight:bold;margin:20px 0 6px;border-bottom:2px solid #E2D9C8;padding-bottom:4px;}
      table{width:100%;border-collapse:collapse;font-size:12px;margin-bottom:8px;}
      th{text-align:center;padding:6px 10px;border-top:1px solid #333;border-bottom:1px solid #333;font-size:10px;text-transform:uppercase;}
      td{text-align:center;padding:5px 10px;border-bottom:1px solid #E2D9C8;}
      .total-row td{border-top:2px solid #333;border-bottom:none;font-weight:bold;}
      .total-label{text-align:right;font-style:italic;font-size:14px;}
      .grand{margin-top:24px;padding:12px 16px;border-top:3px solid #1E293B;font-size:13px;display:flex;justify-content:space-between;}
    </style></head><body>`;
    html += `<h1>PaperTrail — Rimborso Spese 2025</h1><div class="sub">Periodo: ${label} · Generato il ${new Date().toLocaleDateString("it-IT")}</div>`;
    let grandTotal = 0;
    for (const p of PEOPLE) {
      const righe = filteredEntries.filter(e => e.persona === p);
      if (!righe.length) continue;
      const tot = righe.reduce((s, e) => s + e.importo, 0);
      grandTotal += tot;
      html += `<h2>${p}</h2><table><thead><tr><th>Data</th><th>Num. Fiscale</th><th>Ristorante / Bar</th><th>Importo</th></tr></thead><tbody>`;
      for (const e of righe) {
        html += `<tr><td>${e.data||""}</td><td>${e.numFisc||"—"}</td><td>${e.ristorante}</td><td>€ ${e.importo.toFixed(2)}</td></tr>`;
      }
      html += `<tr class="total-row"><td colspan="3" class="total-label">TOTALE</td><td>€ ${tot.toFixed(2)}</td></tr></tbody></table>`;
    }
    html += `<div class="grand"><span>Totale complessivo</span><strong>€ ${grandTotal.toFixed(2)}</strong></div></body></html>`;
    win.document.write(html); win.document.close(); win.focus();
    setTimeout(() => win.print(), 400);
  };

  const processQueue = useCallback(async (items) => {
    if (processingRef.current) return;
    processingRef.current = true;
    setStep("processing");
    setQueue(items.map(it => ({ name: it.name, status: "waiting" })));
    const allExtracted = [];
    let firstError = null;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      setCurrentFile({ name: item.name, idx: i + 1, total: items.length });
      setQueue(prev => prev.map((q, qi) => qi === i ? { ...q, status: "processing" } : q));
      try {
        const { b64, mediaType, previewUrl } = await item.getBase64();
        const { scontrini } = await analyzeBase64(b64, mediaType, previewUrl);
        if (!scontrini.length) {
          setQueue(prev => prev.map((q, qi) => qi === i ? { ...q, status: "skip", note: "Nessuno scontrino" } : q));
        } else {
          scontrini.forEach(s => allExtracted.push({ ...s, preview: previewUrl, persona, fileName: item.name }));
          setQueue(prev => prev.map((q, qi) => qi === i ? { ...q, status: "done", count: scontrini.length } : q));
        }
      } catch (err) {
        if (!firstError) firstError = err.message;
        setQueue(prev => prev.map((q, qi) => qi === i ? { ...q, status: "error", note: err.message.slice(0, 80) } : q));
      }
    }
    processingRef.current = false; setCurrentFile(null);
    if (allExtracted.length > 0) {
      setPendingReview(allExtracted.map((s, i) => ({ id: i, data: s.data || "", numFisc: s.numFisc || "", ristorante: s.ristorante || "", importo: String(s.importo || ""), persona: s.persona, preview: s.preview, fileName: s.fileName })));
      setReviewIdx(0); setEditForm(null); setStep("review");
    } else {
      const msg = firstError ? `Errore: ${firstError.slice(0, 120)}` : "Nessuno scontrino estratto";
      showToast(msg, "err"); setStep("idle");
    }
  }, [persona]);

  const addFiles = (files) => {
    const valid = Array.from(files).filter(f => f.type.startsWith("image/") || isHeic(f));
    if (!valid.length) { showToast("Nessuna immagine valida", "err"); return; }
    const duplicates = valid.filter(f => processedHashes.includes(fileFingerprint(f)));
    if (duplicates.length > 0) {
      if (!window.confirm(`Queste foto sembrano già elaborate:\n${duplicates.map(f => f.name).join(", ")}\n\nContinuare?`)) return;
    }
    setProcessedHashes(prev => [...new Set([...prev, ...valid.map(fileFingerprint)])]);
    processQueue(valid.map(file => ({ name: file.name, getBase64: () => compressImage(file) })));
  };

  const current = pendingReview[reviewIdx];
  const currentEdit = editForm ?? current;

  const saveCurrentAndNext = () => {
    const toSave = editForm ?? current;
    const imp = parseFloat(String(toSave.importo).replace(",", "."));
    if (!toSave.data || !toSave.ristorante || isNaN(imp) || imp <= 0) { showToast("Compila data, ristorante e importo", "err"); return; }
    const savedPersona = toSave.persona;
    setEntries(prev => [...prev, { id: Date.now() + Math.random(), data: toSave.data, numFisc: toSave.numFisc, ristorante: toSave.ristorante, importo: imp, persona: savedPersona, preview: toSave.preview || null }]);
    if (reviewIdx + 1 < pendingReview.length) {
      setEditForm({ ...pendingReview[reviewIdx + 1], persona: savedPersona }); setReviewIdx(idx => idx + 1);
    } else { setEditForm(null); setStep("idle"); setQueue([]); setPendingReview([]); setReviewIdx(0); showToast(`✓ Salvati ${reviewIdx + 1} scontrini`); }
  };

  const skipCurrent = () => {
    const p = (editForm ?? current)?.persona;
    if (reviewIdx + 1 < pendingReview.length) { setEditForm({ ...pendingReview[reviewIdx + 1], persona: p }); setReviewIdx(idx => idx + 1); }
    else { setEditForm(null); setStep("idle"); setQueue([]); }
  };

  const saveAll = () => {
    const valid = pendingReview.slice(reviewIdx).filter(s => s.data && s.ristorante && parseFloat(String(s.importo).replace(",", ".")) > 0);
    if (!valid.length) { showToast("Nessuno scontrino valido rimasto", "err"); return; }
    setEntries(prev => [...prev, ...valid.map(s => ({ id: Date.now() + Math.random(), data: s.data, numFisc: s.numFisc, ristorante: s.ristorante, importo: parseFloat(String(s.importo).replace(",", ".")), persona: s.persona, preview: s.preview || null }))]);
    setStep("idle"); setQueue([]); setPendingReview([]); setReviewIdx(0); showToast(`✓ Salvati ${valid.length} scontrini`);
  };

  const removeEntry = (id) => setEntries(prev => prev.filter(e => e.id !== id));

  const startEdit = (entry) => { setEditingId(entry.id); setEditingRow({ ...entry, importo: String(entry.importo) }); };
  const saveEdit = () => {
    const imp = parseFloat(String(editingRow.importo).replace(",", "."));
    if (!editingRow.data || !editingRow.ristorante || isNaN(imp) || imp <= 0) { showToast("Compila data, ristorante e importo", "err"); return; }
    setEntries(prev => prev.map(e => e.id === editingId ? { ...editingRow, importo: imp } : e));
    setEditingId(null); setEditingRow(null); showToast("✓ Scontrino modificato");
  };

  const exportXLSX = async () => {
    if (!filteredEntries.length) { showToast("Nessuno scontrino da esportare", "err"); return; }
    try { await buildXLSX(filteredEntries); showToast(`Esportato! ${filteredEntries.length} scontrini.`); }
    catch (err) { showToast("Errore: " + err.message, "err"); }
  };

  const clearAll = () => {
    if (!window.confirm("Eliminare tutti i dati? L'operazione non è reversibile.")) return;
    setEntries([]); setProcessedHashes([]); showToast("Dati eliminati");
  };

  const totals = PEOPLE.map(p => ({ name: p, count: filteredEntries.filter(e => e.persona === p).length, total: filteredEntries.filter(e => e.persona === p).reduce((s, e) => s + e.importo, 0) }));
  const grand = filteredEntries.reduce((s, e) => s + e.importo, 0);
  const statusColor = { waiting: "#94A3B8", processing: "#F59E0B", done: "#22C55E", error: "#EF4444", skip: "#94A3B8" };
  const statusIcon  = { waiting: "⏳", done: "✓", error: "✕", skip: "—" };

  if (!authed) return (
    <div style={{ minHeight: "100vh", background: th.bg, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Segoe UI', system-ui, sans-serif" }}>
      <div style={{ background: th.card, borderRadius: 16, padding: "40px 36px", width: "100%", maxWidth: 360, boxShadow: "0 8px 40px rgba(0,0,0,0.2)", textAlign: "center", border: `1px solid ${th.border}` }}>
        <div style={{ fontSize: 44, marginBottom: 12 }}>🧾</div>
        <div style={{ fontSize: 20, fontWeight: 700, color: th.text, marginBottom: 6 }}>PaperTrail</div>
        <div style={{ fontSize: 13, color: th.sub, marginBottom: 28 }}>Expense tracking · AI</div>
        <input type="password" value={pwInput} onChange={e => { setPwInput(e.target.value); setPwError(false); }}
          onKeyDown={e => e.key === "Enter" && handleLogin()} placeholder="Password" autoFocus
          style={{ width: "100%", padding: "11px 14px", border: `1.5px solid ${pwError ? "#EF4444" : th.border}`, borderRadius: 8, fontSize: 14, marginBottom: 8, outline: "none", background: pwError ? (dark ? "#3B1515" : "#FEF2F2") : th.inputBg, color: th.text }} />
        {pwError && <div style={{ fontSize: 12, color: "#EF4444", marginBottom: 10 }}>Password errata</div>}
        <button onClick={handleLogin} style={{ width: "100%", background: "#1E293B", color: "#fff", border: "none", padding: "12px", borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: "pointer", marginTop: 4 }}>Accedi</button>
      </div>
    </div>
  );

  return (
    <>
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: ${th.bg}; transition: background 0.2s; }
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes fadeIn { from { opacity:0; transform:translateY(-6px);} to {opacity:1;transform:translateY(0);} }
        @keyframes modalIn { from { opacity:0; transform:scale(0.96);} to {opacity:1;transform:scale(1);} }
        input:focus, select:focus { border-color: #F59E0B !important; box-shadow: 0 0 0 3px rgba(245,158,11,0.12); outline: none; }
        button:active { opacity: 0.8; }
        tr:hover .row-actions { opacity: 1 !important; }
        ::placeholder { color: #64748B; }
      `}</style>

      <div style={{ fontFamily: "'Segoe UI', system-ui, sans-serif", minHeight: "100vh", background: th.bg, color: th.text, transition: "background 0.2s, color 0.2s" }}>

        {toast && (
          <div style={{ position: "fixed", top: 14, right: 14, zIndex: 9999, background: toast.type === "err" ? "#7F1D1D" : "#14532D", color: "#fff", padding: "11px 18px", borderRadius: 8, fontSize: 13, boxShadow: "0 4px 20px rgba(0,0,0,0.3)", animation: "fadeIn 0.2s ease" }}>
            {toast.msg}
          </div>
        )}

        {lightboxImg && (
          <div onClick={() => setLightboxImg(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.9)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20, cursor: "zoom-out" }}>
            <img src={lightboxImg} alt="Scontrino" style={{ maxWidth: "100%", maxHeight: "90vh", borderRadius: 10 }} onClick={e => e.stopPropagation()} />
            <button onClick={() => setLightboxImg(null)} style={{ position: "fixed", top: 16, right: 16, background: "rgba(255,255,255,0.15)", border: "none", color: "#fff", fontSize: 22, width: 40, height: 40, borderRadius: "50%", cursor: "pointer" }}>✕</button>
          </div>
        )}

        {showPreview && (
          <div onClick={() => setShowPreview(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
            <div onClick={e => e.stopPropagation()} style={{ background: th.card, borderRadius: 14, padding: 24, width: "100%", maxWidth: 700, maxHeight: "85vh", overflowY: "auto", animation: "modalIn 0.2s ease", border: `1px solid ${th.border}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
                <div style={{ fontWeight: 700, fontSize: 16, color: th.text }}>Anteprima — {filterMonth > 0 ? MONTHS[filterMonth] : "Tutti i mesi"}</div>
                <button onClick={() => setShowPreview(false)} style={{ background: "none", border: "none", fontSize: 20, cursor: "pointer", color: th.sub }}>✕</button>
              </div>
              {PEOPLE.map(p => {
                const righe = filteredEntries.filter(e => e.persona === p);
                if (!righe.length) return null;
                return (
                  <div key={p} style={{ marginBottom: 24 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: PERSON_COLORS[p].text, background: PERSON_COLORS[p].bg, padding: "6px 12px", borderRadius: "6px 6px 0 0", borderBottom: `2px solid ${PERSON_COLORS[p].border}` }}>{p}</div>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                      <thead><tr style={{ background: th.tableHead }}>
                        {["DATA","Num sc fisc.","RISTORANTE/BAR","IMPORTO"].map(h => (
                          <th key={h} style={{ padding: "6px 10px", textAlign: "center", fontWeight: 700, borderBottom: `1px solid ${th.border}`, borderTop: `1px solid ${th.border}`, color: th.text }}>{h}</th>
                        ))}
                      </tr></thead>
                      <tbody>
                        {righe.map((e, i) => (
                          <tr key={e.id} style={{ borderBottom: `1px solid ${th.border}`, background: i % 2 === 0 ? th.tableRow1 : th.tableRow2 }}>
                            <td style={{ padding: "5px 10px", textAlign: "center", fontFamily: "monospace", color: th.text }}>{e.data}</td>
                            <td style={{ padding: "5px 10px", textAlign: "center", color: th.sub }}>{e.numFisc || "—"}</td>
                            <td style={{ padding: "5px 10px", textAlign: "center", color: th.text }}>{e.ristorante}</td>
                            <td style={{ padding: "5px 10px", textAlign: "center", fontWeight: 600, color: th.text }}>€ {e.importo.toFixed(2)}</td>
                          </tr>
                        ))}
                        <tr style={{ borderTop: `2px solid ${th.border}` }}>
                          <td colSpan={3} style={{ padding: "8px 10px", textAlign: "right", fontStyle: "italic", fontWeight: 700, fontSize: 14, color: th.text }}>TOTALE</td>
                          <td style={{ padding: "8px 10px", textAlign: "center", fontWeight: 700, color: th.text }}>€ {righe.reduce((s,e) => s + e.importo, 0).toFixed(2)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                );
              })}
              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 }}>
                <button onClick={() => setShowPreview(false)} style={{ background: "none", border: `1px solid ${th.border}`, padding: "9px 18px", borderRadius: 7, fontSize: 13, cursor: "pointer", color: th.sub }}>Chiudi</button>
                <button onClick={() => { setShowPreview(false); exportXLSX(); }} style={{ background: "#22C55E", color: "#fff", border: "none", padding: "9px 22px", borderRadius: 7, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>⬇ Scarica .xlsx</button>
              </div>
            </div>
          </div>
        )}

        <div style={{ background: th.header, padding: "14px 22px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ color: "#fff", fontSize: 17, fontWeight: 700 }}>🧾 PaperTrail</div>
            <div style={{ color: "#94A3B8", fontSize: 12, marginTop: 1 }}>Expense tracking · AI</div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button onClick={toggleDark} title={dark ? "Modalità chiara" : "Modalità scura"}
              style={{ background: "none", border: "1px solid #334155", color: dark ? "#F59E0B" : "#94A3B8", padding: "6px 10px", borderRadius: 7, fontSize: 16, cursor: "pointer" }}>
              {dark ? "☀️" : "🌙"}
            </button>
            {entries.length > 0 && <>
              <button onClick={() => setShowPreview(true)} style={{ background: "#334155", color: "#CBD5E1", border: "none", padding: "8px 14px", borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>👁 Anteprima</button>
              <button onClick={exportPDF} style={{ background: "#7C3AED", color: "#fff", border: "none", padding: "8px 14px", borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>📄 PDF</button>
              <button onClick={exportXLSX} style={{ background: "#22C55E", color: "#fff", border: "none", padding: "8px 16px", borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>⬇ .xlsx</button>
            </>}
          </div>
        </div>

        <div style={{ maxWidth: 820, margin: "0 auto", padding: "18px 14px" }}>

          {entries.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, marginBottom: 18 }}>
              {totals.map(tp => (
                <div key={tp.name} style={{ background: th.card, borderRadius: 8, padding: "11px 14px", border: `1px solid ${PERSON_COLORS[tp.name].border}`, borderTop: `3px solid ${PERSON_COLORS[tp.name].text}` }}>
                  <div style={{ fontSize: 10, color: PERSON_COLORS[tp.name].text, textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 700 }}>{tp.name}</div>
                  <div style={{ fontSize: 18, fontWeight: 700, marginTop: 2, color: th.text }}>€{tp.total.toFixed(2)}</div>
                  <div style={{ fontSize: 11, color: th.sub }}>{tp.count} scontrini</div>
                </div>
              ))}
              <div style={{ background: "#1E293B", borderRadius: 8, padding: "11px 14px" }}>
                <div style={{ fontSize: 10, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.07em" }}>Totale</div>
                <div style={{ fontSize: 18, fontWeight: 700, color: "#fff", marginTop: 2 }}>€{grand.toFixed(2)}</div>
                <div style={{ fontSize: 11, color: "#94A3B8" }}>{filteredEntries.length} tot</div>
              </div>
            </div>
          )}

          {step === "idle" && (
            <>
              <div style={{ background: th.card, borderRadius: 10, padding: "12px 18px", border: `1px solid ${th.border}`, marginBottom: 12, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <span style={{ fontSize: 13, color: th.sub, fontWeight: 500 }}>Assegna a:</span>
                <div style={{ display: "flex", gap: 7 }}>
                  {PEOPLE.map(p => (
                    <button key={p} onClick={() => setPersona(p)} style={{ padding: "5px 14px", borderRadius: 20, border: `1.5px solid ${persona === p ? PERSON_COLORS[p].border : th.border}`, background: persona === p ? PERSON_COLORS[p].bg : th.card, color: persona === p ? PERSON_COLORS[p].text : th.sub, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: "none" }} onChange={e => addFiles(e.target.files)} />
              <input ref={folderRef} type="file" accept="image/*" multiple style={{ display: "none" }} {...{ webkitdirectory: "true", directory: "true" }} onChange={e => addFiles(e.target.files)} />

              <div onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
                onDrop={e => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); }}
                style={{ border: `2.5px dashed ${dragging ? "#F59E0B" : th.border}`, background: dragging ? (dark ? "#422006" : "#FEF3C7") : th.dropzone, borderRadius: 14, padding: "32px 20px", textAlign: "center", transition: "all 0.15s", marginBottom: 12 }}>
                <div style={{ fontSize: 40 }}>📁</div>
                <div style={{ fontSize: 15, fontWeight: 700, marginTop: 10, color: th.text }}>Trascina qui le foto degli scontrini</div>
                <div style={{ fontSize: 13, color: th.sub, marginTop: 5 }}>Anche più foto o un'intera cartella · JPG, PNG, HEIC</div>
                <div style={{ display: "flex", justifyContent: "center", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
                  <button onClick={() => fileRef.current.click()} style={{ background: "#F59E0B", color: "#fff", border: "none", padding: "9px 20px", borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Seleziona foto</button>
                  <button onClick={() => folderRef.current.click()} style={{ background: "#1E293B", color: "#fff", border: "none", padding: "9px 20px", borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Seleziona cartella</button>
                </div>
              </div>

              <div style={{ background: dark ? "#1e2d45" : "#EFF6FF", border: dark ? "1px solid #2d4a6e" : "1px solid #BFDBFE", borderRadius: 10, padding: "16px 18px", display: "flex", gap: 20, alignItems: "center" }}>
                {qrUrl && <img src={qrUrl} alt="QR" width={100} height={100} style={{ borderRadius: 6, border: "1px solid #BFDBFE", flexShrink: 0, background: "#fff" }} />}
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#1D4ED8", marginBottom: 4 }}>Apri sul telefono</div>
                  <div style={{ fontSize: 12, color: dark ? "#93C5FD" : "#3B82F6", lineHeight: 1.5 }}>Scansiona il QR per aprire l'app sul telefono e fotografare gli scontrini direttamente.</div>
                </div>
              </div>
            </>
          )}

          {step === "processing" && (
            <div style={{ background: th.card, borderRadius: 12, padding: 20, marginBottom: 18, border: `1px solid ${th.border}` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                <div style={{ width: 20, height: 20, border: "3px solid #F59E0B", borderTop: "3px solid transparent", borderRadius: "50%", animation: "spin 0.7s linear infinite", flexShrink: 0 }} />
                <span style={{ fontWeight: 700, fontSize: 15, color: th.text }}>Elaborazione — {currentFile ? `${currentFile.idx}/${currentFile.total}: ${currentFile.name}` : "…"}</span>
              </div>
              <div style={{ background: th.border, borderRadius: 6, height: 6, marginBottom: 14, overflow: "hidden" }}>
                <div style={{ background: "#F59E0B", height: "100%", borderRadius: 6, width: `${(queue.filter(q => ["done","error","skip"].includes(q.status)).length / Math.max(queue.length,1)) * 100}%`, transition: "width 0.4s ease" }} />
              </div>
              <div style={{ maxHeight: 220, overflowY: "auto", display: "flex", flexDirection: "column", gap: 5 }}>
                {queue.map((q, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 9, padding: "6px 10px", background: th.tableRow2, borderRadius: 6, fontSize: 13 }}>
                    <span style={{ color: statusColor[q.status], flexShrink: 0 }}>
                      {q.status === "processing" ? <span style={{ display: "inline-block", width: 13, height: 13, border: "2px solid #F59E0B", borderTop: "2px solid transparent", borderRadius: "50%", animation: "spin 0.7s linear infinite", verticalAlign: "middle" }} /> : statusIcon[q.status] || "⏳"}
                    </span>
                    <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: q.status === "error" ? "#EF4444" : th.text }}>{q.name}</span>
                    {q.count > 1 && <span style={{ background: "#FEF3C7", color: "#92400E", padding: "1px 8px", borderRadius: 20, fontSize: 11, fontWeight: 600 }}>{q.count} scontrini</span>}
                    {q.note && <span style={{ fontSize: 11, color: th.sub }}>{q.note}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {step === "review" && current && (
            <div style={{ background: th.card, borderRadius: 12, padding: 20, marginBottom: 18, border: `1px solid ${th.border}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#F59E0B", textTransform: "uppercase", letterSpacing: "0.07em" }}>✦ Revisione {reviewIdx + 1} di {pendingReview.length}</div>
                <div style={{ display: "flex", gap: 5 }}>
                  {pendingReview.map((_, i) => (<div key={i} style={{ width: 8, height: 8, borderRadius: "50%", background: i < reviewIdx ? "#22C55E" : i === reviewIdx ? "#F59E0B" : th.border }} />))}
                </div>
              </div>
              <div style={{ fontSize: 11, color: th.sub, marginBottom: 12, fontStyle: "italic" }}>{current.fileName}</div>
              <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
                {current.preview && <img src={current.preview} alt="" onClick={() => setLightboxImg(current.preview)} style={{ width: 95, height: 125, objectFit: "cover", borderRadius: 7, border: `1px solid ${th.border}`, flexShrink: 0, cursor: "zoom-in" }} />}
                <div style={{ flex: 1 }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 11 }}>
                    <Field dark={dark} label="Data (GG/MM)" value={currentEdit?.data} onChange={e => setEditForm(f => ({ ...(f ?? current), data: e.target.value }))} placeholder="es. 27/02" />
                    <Field dark={dark} label="Num. fiscale" value={currentEdit?.numFisc} onChange={e => setEditForm(f => ({ ...(f ?? current), numFisc: e.target.value }))} placeholder="es. 2005-0025" />
                    <Field dark={dark} label="Ristorante / Bar" value={currentEdit?.ristorante} onChange={e => setEditForm(f => ({ ...(f ?? current), ristorante: e.target.value }))} placeholder="Nome esercente" full />
                    <Field dark={dark} label="Importo €" value={currentEdit?.importo} onChange={e => setEditForm(f => ({ ...(f ?? current), importo: e.target.value }))} placeholder="es. 12.32" />
                    <div>
                      <label style={{ fontSize: 10, color: "#94A3B8", display: "block", marginBottom: 3, textTransform: "uppercase", letterSpacing: "0.06em" }}>Assegna a</label>
                      <select value={currentEdit?.persona ?? current.persona} onChange={e => setEditForm(f => ({ ...(f ?? current), persona: e.target.value }))}
                        style={{ width: "100%", padding: "8px 11px", border: `1.5px solid ${PERSON_COLORS[currentEdit?.persona ?? current.persona]?.border}`, borderRadius: 6, fontSize: 13, background: PERSON_COLORS[currentEdit?.persona ?? current.persona]?.bg, color: PERSON_COLORS[currentEdit?.persona ?? current.persona]?.text, fontWeight: 600, cursor: "pointer" }}>
                        {PEOPLE.map(p => <option key={p} value={p} style={{ background: "#fff", color: "#1E293B" }}>{p}</option>)}
                      </select>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
                    <button onClick={saveCurrentAndNext} style={{ background: "#1E293B", color: "#fff", border: "none", padding: "9px 22px", borderRadius: 7, fontSize: 13, fontWeight: 700, cursor: "pointer" }}>✓ Salva e avanti</button>
                    {reviewIdx + 1 < pendingReview.length && <button onClick={saveAll} style={{ background: "#22C55E", color: "#fff", border: "none", padding: "9px 16px", borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>✓✓ Salva tutti i restanti</button>}
                    <button onClick={skipCurrent} style={{ background: "none", color: th.sub, border: `1px solid ${th.border}`, padding: "9px 14px", borderRadius: 7, fontSize: 13, cursor: "pointer" }}>Salta</button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {entries.length > 0 && (
            <div style={{ background: th.card, borderRadius: 12, border: `1px solid ${th.border}`, overflow: "hidden", marginBottom: 18 }}>
              <div style={{ padding: "11px 18px", borderBottom: `1px solid ${th.border}`, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: th.sub, textTransform: "uppercase", letterSpacing: "0.06em" }}>Scontrini salvati — {filteredEntries.length} voci</span>
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginLeft: "auto" }}>
                  {MONTHS.map((m, i) => (
                    <button key={i} onClick={() => setFilterMonth(i)}
                      style={{ padding: "3px 10px", borderRadius: 20, border: `1px solid ${filterMonth === i ? "#F59E0B" : th.border}`, background: filterMonth === i ? (dark ? "#422006" : "#FEF3C7") : th.card, color: filterMonth === i ? "#92400E" : th.sub, fontSize: 11, fontWeight: filterMonth === i ? 700 : 400, cursor: "pointer" }}>
                      {m}
                    </button>
                  ))}
                </div>
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: th.tableHead }}>
                    {["","Data","Num. Fiscale","Ristorante / Bar","Importo","Per",""].map((h,i) => (
                      <th key={i} style={{ padding: "8px 14px", textAlign: "left", fontSize: 10, color: th.sub, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredEntries.map((e, i) => (
                    <tr key={e.id} style={{ borderTop: `1px solid ${th.border}`, background: i % 2 === 0 ? th.tableRow1 : th.tableRow2 }}>
                      {editingId === e.id ? (
                        <>
                          <td style={{ padding: "6px 10px", width: 44 }}>
                            {e.preview ? <img src={e.preview} alt="" onClick={() => setLightboxImg(e.preview)} style={{ width: 36, height: 48, objectFit: "cover", borderRadius: 4, border: `1px solid ${th.border}`, cursor: "zoom-in", display: "block" }} /> : <div style={{ width: 36, height: 48, background: th.tableHead, borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>🧾</div>}
                          </td>
                          <td style={{ padding: "6px 8px" }}><input value={editingRow.data} onChange={ev => setEditingRow(r => ({ ...r, data: ev.target.value }))} style={{ width: 70, padding: "4px 7px", border: "1.5px solid #F59E0B", borderRadius: 5, fontSize: 12, background: th.inputBg, color: th.text }} /></td>
                          <td style={{ padding: "6px 8px" }}><input value={editingRow.numFisc} onChange={ev => setEditingRow(r => ({ ...r, numFisc: ev.target.value }))} style={{ width: 90, padding: "4px 7px", border: `1.5px solid ${th.border}`, borderRadius: 5, fontSize: 12, background: th.inputBg, color: th.text }} /></td>
                          <td style={{ padding: "6px 8px" }}><input value={editingRow.ristorante} onChange={ev => setEditingRow(r => ({ ...r, ristorante: ev.target.value }))} style={{ width: "100%", padding: "4px 7px", border: `1.5px solid ${th.border}`, borderRadius: 5, fontSize: 12, background: th.inputBg, color: th.text }} /></td>
                          <td style={{ padding: "6px 8px" }}><input value={editingRow.importo} onChange={ev => setEditingRow(r => ({ ...r, importo: ev.target.value }))} style={{ width: 65, padding: "4px 7px", border: `1.5px solid ${th.border}`, borderRadius: 5, fontSize: 12, background: th.inputBg, color: th.text }} /></td>
                          <td style={{ padding: "6px 8px" }}>
                            <select value={editingRow.persona} onChange={ev => setEditingRow(r => ({ ...r, persona: ev.target.value }))} style={{ padding: "4px 7px", borderRadius: 5, border: `1.5px solid ${th.border}`, fontSize: 12, background: PERSON_COLORS[editingRow.persona]?.bg, color: PERSON_COLORS[editingRow.persona]?.text }}>
                              {PEOPLE.map(p => <option key={p} value={p}>{p}</option>)}
                            </select>
                          </td>
                          <td style={{ padding: "6px 8px" }}>
                            <button onClick={saveEdit} style={{ background: "#22C55E", color: "#fff", border: "none", padding: "4px 10px", borderRadius: 5, fontSize: 12, cursor: "pointer", marginRight: 4 }}>✓</button>
                            <button onClick={() => { setEditingId(null); setEditingRow(null); }} style={{ background: "none", border: `1px solid ${th.border}`, padding: "4px 8px", borderRadius: 5, fontSize: 12, cursor: "pointer", color: th.sub }}>✕</button>
                          </td>
                        </>
                      ) : (
                        <>
                          <td style={{ padding: "6px 10px", width: 44 }}>
                            {e.preview ? <img src={e.preview} alt="" onClick={() => setLightboxImg(e.preview)} style={{ width: 36, height: 48, objectFit: "cover", borderRadius: 4, border: `1px solid ${th.border}`, cursor: "zoom-in", display: "block" }} /> : <div style={{ width: 36, height: 48, background: th.tableHead, borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>🧾</div>}
                          </td>
                          <td style={{ padding: "9px 14px", color: th.sub, fontFamily: "monospace" }}>{e.data}</td>
                          <td style={{ padding: "9px 14px", color: th.sub, fontFamily: "monospace", fontSize: 12 }}>{e.numFisc || "—"}</td>
                          <td style={{ padding: "9px 14px", fontWeight: 500, color: th.text }}>{e.ristorante}</td>
                          <td style={{ padding: "9px 14px", fontWeight: 700, color: th.text }}>€ {e.importo.toFixed(2)}</td>
                          <td style={{ padding: "9px 14px" }}>
                            <span style={{ background: PERSON_COLORS[e.persona]?.bg, color: PERSON_COLORS[e.persona]?.text, border: `1px solid ${PERSON_COLORS[e.persona]?.border}`, padding: "2px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600 }}>{e.persona}</span>
                          </td>
                          <td style={{ padding: "9px 14px" }}>
                            <span className="row-actions" style={{ opacity: 0, transition: "opacity 0.15s", display: "flex", gap: 4 }}>
                              <button onClick={() => startEdit(e)} style={{ background: "none", border: "none", color: th.sub, cursor: "pointer", fontSize: 14, padding: "2px 4px" }}>✏️</button>
                              <button onClick={() => removeEntry(e.id)} style={{ background: "none", border: "none", color: th.sub, cursor: "pointer", fontSize: 14, padding: "2px 4px" }}>✕</button>
                            </span>
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {step === "idle" && entries.length > 0 && (
            <div style={{ display: "flex", gap: 10, justifyContent: "center", alignItems: "center", flexWrap: "wrap" }}>
              <button onClick={() => setShowPreview(true)} style={{ background: "#334155", color: "#fff", border: "none", padding: "13px 24px", borderRadius: 9, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>👁 Anteprima</button>
              <button onClick={exportPDF} style={{ background: "#7C3AED", color: "#fff", border: "none", padding: "13px 24px", borderRadius: 9, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>📄 Esporta PDF</button>
              <button onClick={exportXLSX} style={{ background: "#22C55E", color: "#fff", border: "none", padding: "13px 36px", borderRadius: 9, fontSize: 15, fontWeight: 700, cursor: "pointer", boxShadow: "0 3px 14px rgba(34,197,94,0.3)" }}>⬇ Esporta SCONTRINI_2025.xlsx</button>
              <button onClick={clearAll} style={{ background: "none", color: "#EF4444", border: "1px solid #FECACA", padding: "13px 18px", borderRadius: 9, fontSize: 13, cursor: "pointer" }}>🗑 Svuota tutto</button>
            </div>
          )}

        </div>
      </div>
    </>
  );
}
