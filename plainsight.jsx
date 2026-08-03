import React, { useState, useMemo, useCallback, useRef, useEffect } from "react";
import Papa from "papaparse";
import {
  ResponsiveContainer, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";

/* ---------------- design tokens ---------------- */
const T = {
  paper: "#F2F5F1",
  card: "#FFFFFF",
  ink: "#17322B",
  inkSoft: "#4C6159",
  line: "#D8E2DC",
  gain: "#1F9D5B",
  loss: "#C4472B",
  accentSoft: "#E3F0E8",
  mono: "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
  display: "'Space Grotesk', 'Avenir Next', 'Segoe UI', sans-serif",
  body: "'Inter', 'Helvetica Neue', Arial, sans-serif",
};

/* ---------------- sample data ---------------- */
const SAMPLE_CSV = `date,product,region,revenue,units
2025-01-14,Espresso beans,North,1840,92
2025-01-22,Cold brew kit,Online,960,32
2025-02-03,Espresso beans,North,2110,105
2025-02-17,Mugs & merch,South,430,43
2025-02-25,Cold brew kit,Online,1280,41
2025-03-05,Espresso beans,North,1990,99
2025-03-19,Mugs & merch,Online,610,61
2025-03-28,Cold brew kit,South,1450,47
2025-04-08,Espresso beans,North,2340,117
2025-04-21,Cold brew kit,Online,1710,55
2025-05-06,Espresso beans,North,2205,110
2025-05-14,Mugs & merch,South,380,38
2025-05-27,Cold brew kit,Online,2050,66
2025-06-09,Espresso beans,North,2510,124
2025-06-18,Cold brew kit,Online,2380,77
2025-06-30,Mugs & merch,Online,540,54
2025-07-07,Espresso beans,North,1780,89
2025-07-15,Cold brew kit,Online,2860,92
2025-07-29,Mugs & merch,South,290,29
2025-08-05,Espresso beans,North,1655,83
2025-08-19,Cold brew kit,Online,3120,101
2025-09-02,Espresso beans,North,2050,102
2025-09-16,Cold brew kit,Online,2440,79
2025-09-29,Mugs & merch,Online,720,72
2025-10-08,Espresso beans,North,2620,131
2025-10-21,Cold brew kit,Online,1980,64
2025-11-04,Espresso beans,North,2980,149
2025-11-17,Mugs & merch,South,910,91
2025-11-26,Cold brew kit,Online,1620,52
2025-12-03,Espresso beans,North,3410,170
2025-12-15,Mugs & merch,Online,1240,124
2025-12-22,Cold brew kit,Online,1490,48`;

/* ---------------- column detection ---------------- */
function detectColumns(rows) {
  if (!rows.length) return { dateCols: [], numCols: [], catCols: [] };
  const cols = Object.keys(rows[0]);
  const sample = rows.slice(0, 200);
  const dateCols = [], numCols = [], catCols = [];
  cols.forEach((c) => {
    let dateHits = 0, numHits = 0, nonEmpty = 0;
    const uniques = new Set();
    sample.forEach((r) => {
      const v = r[c];
      if (v === null || v === undefined || v === "") return;
      nonEmpty++;
      uniques.add(String(v));
      const s = String(v).trim();
      if (!isNaN(toNum(v))) numHits++;
      else if (/\d/.test(s) && !isNaN(Date.parse(s))) dateHits++;
    });
    if (!nonEmpty) return;
    if (dateHits / nonEmpty > 0.7) dateCols.push(c);
    else if (numHits / nonEmpty > 0.8) numCols.push(c);
    else if (uniques.size <= Math.max(20, nonEmpty * 0.5)) catCols.push(c);
  });
  return { dateCols, numCols, catCols };
}

const toNum = (v) => {
  if (v === null || v === undefined) return NaN;
  let s = String(v).trim().replace(/[$,€£₱%\s]/g, "");
  if (s === "") return NaN;                    // a blank cell is missing, not zero
  let sign = 1;
  if (/^\(.*\)$/.test(s)) { sign = -1; s = s.slice(1, -1); }  // (1,200) = -1200 in accounting exports
  const n = Number(s);
  return isFinite(n) ? n * sign : NaN;
};

// Bucket a date value into "YYYY-MM". Date-only ISO strings are parsed as UTC
// midnight but read back with local getters, which shifts them a day west of
// Greenwich — so read those off the string instead of going through Date.
const monthKey = (v) => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  const iso = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (iso) return `${iso[1]}-${String(Number(iso[2])).padStart(2, "0")}`;
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

const fmt = (n) =>
  Math.abs(n) >= 1000
    ? n.toLocaleString(undefined, { maximumFractionDigits: 0 })
    : n.toLocaleString(undefined, { maximumFractionDigits: 2 });

/* ---------------- aggregation ---------------- */
function buildSummary(rows, dateCol, metricCol, catCol) {
  const vals = rows.map((r) => toNum(r[metricCol])).filter((n) => !isNaN(n));
  const total = vals.reduce((a, b) => a + b, 0);
  const avg = vals.length ? total / vals.length : 0;

  let monthly = [];
  if (dateCol) {
    const byMonth = {};
    rows.forEach((r) => {
      const key = monthKey(r[dateCol]);
      const n = toNum(r[metricCol]);
      if (key === null || isNaN(n)) return;
      byMonth[key] = (byMonth[key] || 0) + n;
    });
    monthly = Object.entries(byMonth)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, value]) => ({ month, value: Math.round(value * 100) / 100 }));
  }

  let byCategory = [];
  let categoryCount = 0;
  if (catCol) {
    const m = {};
    rows.forEach((r) => {
      const n = toNum(r[metricCol]);
      const k = String(r[catCol] ?? "").trim() || "(blank)";
      if (isNaN(n)) return;
      m[k] = (m[k] || 0) + n;
    });
    const all = Object.entries(m)
      .map(([name, value]) => ({ name, value: Math.round(value * 100) / 100 }))
      .sort((a, b) => b.value - a.value);
    categoryCount = all.length;
    byCategory = all.slice(0, 8);
  }

  let momPct = null;
  if (monthly.length >= 2) {
    const last = monthly[monthly.length - 1].value;
    const prev = monthly[monthly.length - 2].value;
    if (prev !== 0) momPct = ((last - prev) / Math.abs(prev)) * 100;
  }

  const best = monthly.length ? monthly.reduce((a, b) => (b.value > a.value ? b : a)) : null;
  const worst = monthly.length ? monthly.reduce((a, b) => (b.value < a.value ? b : a)) : null;

  return {
    rowCount: rows.length, valueCount: vals.length, total, avg,
    monthly, byCategory, categoryCount, momPct, best, worst,
  };
}

/* ---------------- local model pipeline (Ollama / LM Studio) ---------------- */
// Nothing leaves the machine: the browser talks straight to a model server on
// localhost. Both providers below are reachable over plain HTTP with no key.

const LS_KEY = "plainsight.localModel";

const jsonFetch = async (url, init, timeoutMs) => {
  // Local generation can be slow on CPU, but it can also hang outright —
  // without an abort the UI would spin forever with no way back.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
};

const PROVIDERS = {
  ollama: {
    label: "Ollama",
    defaultBaseUrl: "http://localhost:11434",
    docs: "Start it with `ollama serve`, then pull a model, e.g. `ollama pull llama3.1`.",
    // Ollama rejects cross-origin browsers unless the origin is allow-listed.
    corsHint: "If requests fail with a network error, restart Ollama with OLLAMA_ORIGINS set to this page's origin (or `*` while developing).",
    async listModels(baseUrl) {
      const res = await jsonFetch(`${baseUrl}/api/tags`, {}, 8000);
      if (!res.ok) throw new Error(`Ollama replied ${res.status}`);
      const data = await res.json();
      const names = (data.models || []).map((m) => m.name).filter(Boolean);
      // /api/tags also lists embedding models, which can't hold a conversation —
      // and they sort first often enough that auto-select would land on one and
      // fail at generation time for no visible reason. Ask which can actually talk.
      const checked = await Promise.all(names.map(async (name) => {
        try {
          const r = await jsonFetch(`${baseUrl}/api/show`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model: name }),
          }, 8000);
          if (!r.ok) return name;                    // can't tell — keep it
          const caps = (await r.json()).capabilities;
          if (!Array.isArray(caps)) return name;     // older Ollama — keep it
          return caps.includes("completion") ? name : null;
        } catch { return name; }
      }));
      return checked.filter(Boolean);
    },
    async chat(baseUrl, model, prompt, timeoutMs) {
      const res = await jsonFetch(
        `${baseUrl}/api/chat`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            messages: [{ role: "user", content: prompt }],
            stream: false,
            options: { temperature: 0.2 },
          }),
        },
        timeoutMs,
      );
      if (!res.ok) throw new Error(await describeHttpError(res, "Ollama"));
      const data = await res.json();
      return (data.message?.content || "").trim();
    },
  },

  lmstudio: {
    label: "LM Studio",
    defaultBaseUrl: "http://localhost:1234",
    docs: "In LM Studio open the Developer tab, load a model, and click Start Server.",
    corsHint: "If requests fail with a network error, enable CORS in LM Studio's server settings.",
    async listModels(baseUrl) {
      // The OpenAI-compat /v1/models endpoint lists embedding models right
      // alongside chat models with no way to tell them apart — the same
      // trap already fixed for Ollama. LM Studio's own /api/v0/models does
      // carry a `type` field ("llm" | "vlm" | "embeddings"), so prefer that
      // and only fall back to /v1/models (unfiltered) on older servers.
      try {
        const res = await jsonFetch(`${baseUrl}/api/v0/models`, {}, 8000);
        if (res.ok) {
          const data = await res.json();
          return (data.data || []).filter((m) => m.type !== "embeddings").map((m) => m.id).filter(Boolean);
        }
      } catch { /* older LM Studio without /api/v0 — fall through */ }
      const res = await jsonFetch(`${baseUrl}/v1/models`, {}, 8000);
      if (!res.ok) throw new Error(`LM Studio replied ${res.status}`);
      const data = await res.json();
      return (data.data || []).map((m) => m.id).filter(Boolean);
    },
    async chat(baseUrl, model, prompt, timeoutMs) {
      const res = await jsonFetch(
        `${baseUrl}/v1/chat/completions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            messages: [{ role: "user", content: prompt }],
            stream: false,
            temperature: 0.2,
            max_tokens: 1000,
          }),
        },
        timeoutMs,
      );
      if (!res.ok) throw new Error(await describeHttpError(res, "LM Studio"));
      const data = await res.json();
      return (data.choices?.[0]?.message?.content || "").trim();
    },
  },
};

async function describeHttpError(res, who) {
  let detail = "";
  try {
    const body = await res.json();
    detail = body?.error?.message || body?.error || "";
  } catch {
    /* body wasn't JSON */
  }
  if (res.status === 404) {
    return `${who} doesn't have that model loaded (404).${detail ? " " + detail : ""}`;
  }
  return `${who} returned ${res.status}${detail ? ": " + detail : ""}`;
}

const trimBaseUrl = (u) => (u || "").trim().replace(/\/+$/, "");

async function askLocalModel(cfg, prompt) {
  const provider = PROVIDERS[cfg.provider];
  if (!provider) throw new Error("Unknown provider.");
  if (!cfg.model) throw new Error("Pick a model first.");
  try {
    const text = await provider.chat(trimBaseUrl(cfg.baseUrl), cfg.model, prompt, cfg.timeoutMs);
    if (!text) throw new Error("The model returned an empty response.");
    return text;
  } catch (e) {
    if (e.name === "AbortError") {
      throw new Error(
        `${provider.label} didn't respond within ${Math.round(cfg.timeoutMs / 1000)}s. ` +
          "A smaller model, or a longer timeout, usually fixes this.",
      );
    }
    // fetch() rejects with a bare TypeError for both "nothing listening" and
    // "blocked by CORS", and the browser won't tell us which. Cover both.
    if (e instanceof TypeError) {
      throw new Error(
        `Couldn't reach ${provider.label} at ${trimBaseUrl(cfg.baseUrl)}. ` +
          `Check it's running. ${provider.corsHint}`,
      );
    }
    throw e;
  }
}

// Local models follow "reply with only JSON" far less reliably than a hosted
// frontier model, so pull the object out of whatever wrapping they add.
function extractJsonObject(raw) {
  const cleaned = raw.replace(/```json/gi, "```").split("```").join("\n").trim();
  const start = cleaned.indexOf("{");
  if (start === -1) return null;
  // Walk to the matching brace so trailing prose doesn't break the parse.
  let depth = 0, inStr = false, escaped = false;
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (inStr) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(cleaned.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function summaryForPrompt(s, metricCol, catCol, dateCol) {
  return JSON.stringify({
    metric: metricCol,
    dateColumn: dateCol || null,
    categoryColumn: catCol || null,
    rowCount: s.rowCount,
    rowsWithAValue: s.valueCount,
    total: Math.round(s.total * 100) / 100,
    averagePerRow: Math.round(s.avg * 100) / 100,
    monthOverMonthPct: s.momPct === null ? null : Math.round(s.momPct * 10) / 10,
    bestMonth: s.best,
    worstMonth: s.worst,
    monthlyTotals: s.monthly,
    topCategories: s.byCategory,
    totalCategoryCount: s.categoryCount,
  });
}

/* ---------------- small UI pieces ---------------- */
const CONN_COLOUR = { ok: T.gain, bad: T.loss, warn: T.loss, checking: T.inkSoft, unknown: T.inkSoft };

const Dot = ({ state }) => (
  <span aria-hidden="true" style={{
    width: 9, height: 9, borderRadius: "50%", flexShrink: 0, display: "inline-block",
    background: CONN_COLOUR[state] || T.inkSoft,
  }} />
);

// Compact header control: connection state at a glance, and the way into settings.
function SettingsToggle({ cfg, conn, open, onToggle }) {
  const label = conn.state === "ok" && cfg.model
    ? `${PROVIDERS[cfg.provider].label} · ${cfg.model}`
    : conn.state === "checking" ? "Connecting…" : "No model";
  return (
    <button className="ps-btn" onClick={onToggle}
      aria-expanded={open} aria-controls="ps-settings"
      title={conn.message || "Model settings"}
      style={{
        background: "transparent", color: T.ink, display: "flex",
        alignItems: "center", gap: 8, maxWidth: 280,
      }}>
      <Dot state={conn.state} />
      <span style={{
        fontFamily: T.mono, fontSize: 12, fontWeight: 400,
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>{label}</span>
      <span aria-hidden="true" style={{ fontSize: 11 }}>{open ? "▲" : "▼"}</span>
    </button>
  );
}

function SettingsPanel({ cfg, models, conn, onProvider, onPatch, onConnect, onClose }) {
  const provider = PROVIDERS[cfg.provider];
  const busy = conn.state === "checking";
  const row = { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 12 };
  const lab = {
    fontFamily: T.mono, fontSize: 12, letterSpacing: "0.08em", textTransform: "uppercase",
    color: T.inkSoft, width: 104, flexShrink: 0,
  };

  return (
    <section id="ps-settings" style={{
      background: T.card, border: `1px solid ${T.line}`, borderRadius: 10,
      padding: "18px 20px", marginBottom: 24, fontSize: 13,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 16 }}>
        <div style={{ fontFamily: T.display, fontWeight: 700, fontSize: 16 }}>Model settings</div>
        <button className="ps-btn" onClick={onClose}
          style={{ background: "transparent", color: T.ink, padding: "4px 10px", fontSize: 13 }}>
          Close
        </button>
      </div>

      <div style={row}>
        <span style={lab}>Server</span>
        <select className="ps-select" value={cfg.provider} aria-label="Model server"
          onChange={(e) => onProvider(e.target.value)}>
          {Object.entries(PROVIDERS).map(([k, p]) => (
            <option key={k} value={k}>{p.label}</option>
          ))}
        </select>
      </div>

      <div style={row}>
        <span style={lab}>Address</span>
        <input className="ps-input" value={cfg.baseUrl} spellCheck={false} aria-label="Server address"
          onChange={(e) => onPatch({ baseUrl: e.target.value })}
          onKeyDown={(e) => e.key === "Enter" && onConnect()}
          style={{ flex: "none", width: 230, fontFamily: T.mono, fontSize: 12, padding: "6px 8px" }} />
        <button className="ps-btn" onClick={onConnect} disabled={busy}
          style={{ background: "transparent", color: T.ink, padding: "6px 12px", fontSize: 13, opacity: busy ? 0.6 : 1 }}>
          {busy ? "Checking…" : "Connect"}
        </button>
      </div>

      <div style={row}>
        <span style={lab}>Model</span>
        {models.length > 0 ? (
          <select className="ps-select" value={cfg.model} aria-label="Model"
            onChange={(e) => onPatch({ model: e.target.value })}>
            {models.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        ) : (
          <span style={{ color: T.inkSoft }}>Connect to load the model list.</span>
        )}
      </div>

      <div style={{ ...row, marginBottom: 0 }}>
        <span style={lab}>Timeout</span>
        {/* Exposed because a large model on CPU can legitimately exceed the default. */}
        <input className="ps-input" type="number" min="10" max="900" aria-label="Response timeout in seconds"
          value={Math.round(cfg.timeoutMs / 1000)}
          onChange={(e) => {
            const secs = Number(e.target.value);
            if (Number.isFinite(secs) && secs > 0) onPatch({ timeoutMs: secs * 1000 });
          }}
          style={{ flex: "none", width: 80, fontFamily: T.mono, fontSize: 12, padding: "6px 8px" }} />
        <span style={{ color: T.inkSoft }}>seconds before giving up on a reply</span>
      </div>

      <div style={{
        marginTop: 16, paddingTop: 14, borderTop: `1px solid ${T.line}`,
        display: "flex", gap: 8, alignItems: "flex-start", lineHeight: 1.55,
      }}>
        <span style={{ paddingTop: 4 }}><Dot state={conn.state} /></span>
        <span style={{ color: CONN_COLOUR[conn.state] || T.inkSoft }}>
          {conn.message || `Not connected yet. ${provider.docs}`}
        </span>
      </div>
    </section>
  );
}

function Delta({ pct }) {
  if (pct === null) return null;
  const up = pct >= 0;
  return (
    <span style={{ color: up ? T.gain : T.loss, fontFamily: T.mono, fontSize: 13 }}>
      {up ? "▲" : "▼"} {Math.abs(pct).toFixed(1)}% vs prior month
    </span>
  );
}

/* ---------------- main app ---------------- */
export default function PlainsightDataAnalysis() {
  const [rows, setRows] = useState(null);
  const [fileName, setFileName] = useState("");
  const [parseError, setParseError] = useState("");
  const [dateCol, setDateCol] = useState("");
  const [metricCol, setMetricCol] = useState("");
  const [catCol, setCatCol] = useState("");
  const [insights, setInsights] = useState(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insightsError, setInsightsError] = useState("");
  const [question, setQuestion] = useState("");
  const [qa, setQa] = useState([]); // {q, a}
  const [qaLoading, setQaLoading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);

  /* ---- local model config (persisted, so it survives a reload) ---- */
  const [cfg, setCfg] = useState(() => {
    const fallback = {
      provider: "ollama",
      baseUrl: PROVIDERS.ollama.defaultBaseUrl,
      model: "",
      timeoutMs: 120000,
    };
    try {
      const saved = JSON.parse(localStorage.getItem(LS_KEY) || "null");
      return saved ? { ...fallback, ...saved } : fallback;
    } catch {
      return fallback;
    }
  });
  const [models, setModels] = useState([]);
  const [conn, setConn] = useState({ state: "unknown", message: "" });
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(cfg)); } catch { /* private mode */ }
  }, [cfg]);

  const patchCfg = (patch) => setCfg((c) => ({ ...c, ...patch }));

  const switchProvider = (provider) => {
    // Base URL and model belong to the old provider — reset both, or we'd be
    // pointing LM Studio's client at Ollama's port.
    setModels([]);
    setConn({ state: "unknown", message: "" });
    patchCfg({ provider, baseUrl: PROVIDERS[provider].defaultBaseUrl, model: "" });
  };

  const connect = useCallback(async () => {
    const provider = PROVIDERS[cfg.provider];
    setConn({ state: "checking", message: `Looking for ${provider.label}…` });
    try {
      const found = await provider.listModels(trimBaseUrl(cfg.baseUrl));
      setModels(found);
      if (!found.length) {
        setConn({
          state: "warn",
          message: `${provider.label} is running but has no models loaded. ${provider.docs}`,
        });
        return;
      }
      // Keep the saved model if it's still there, else take the first.
      const model = found.includes(cfg.model) ? cfg.model : found[0];
      patchCfg({ model });
      setConn({ state: "ok", message: `${provider.label} connected — ${found.length} model${found.length === 1 ? "" : "s"} available.` });
    } catch (e) {
      setModels([]);
      const reachability =
        e.name === "AbortError"
          ? `${provider.label} didn't respond in time.`
          : e instanceof TypeError
            ? `Couldn't reach ${provider.label} at ${trimBaseUrl(cfg.baseUrl)}. ${provider.corsHint}`
            : e.message;
      setConn({ state: "bad", message: `${reachability} ${provider.docs}` });
    }
  }, [cfg.provider, cfg.baseUrl, cfg.model]);

  // Probe on mount, and again whenever the provider changes, so a running
  // server is picked up without a click. Base-URL edits stay manual — we'd
  // otherwise fire a request on every keystroke.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { connect(); }, [cfg.provider]);

  const aiReady = conn.state === "ok" && !!cfg.model;

  const detected = useMemo(() => (rows ? detectColumns(rows) : null), [rows]);

  const loadCsvText = useCallback((text, name) => {
    setParseError("");
    Papa.parse(text, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => {
        const data = res.data.filter((r) => Object.values(r).some((v) => v !== ""));
        if (!data.length) { setParseError("That file parsed to zero rows. Check that it has a header row and data."); return; }
        const det = detectColumns(data);
        if (!det.numCols.length) { setParseError("No numeric column found. Plainsight Data analysis needs at least one column of numbers (revenue, units, amount…)."); return; }
        setRows(data);
        setFileName(name);
        setDateCol(det.dateCols[0] || "");
        // prefer a column that smells like money
        const moneyish = det.numCols.find((c) => /rev|sale|amount|total|price|income/i.test(c));
        setMetricCol(moneyish || det.numCols[0]);
        setCatCol(det.catCols[0] || "");
        setInsights(null); setInsightsError(""); setQa([]);
      },
      error: () => setParseError("Couldn't parse that file. Make sure it's a CSV."),
    });
  }, []);

  const onFile = useCallback((file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => loadCsvText(e.target.result, file.name);
    reader.onerror = () => setParseError("Couldn't read that file.");
    reader.readAsText(file);
  }, [loadCsvText]);

  const summary = useMemo(() => {
    if (!rows || !metricCol) return null;
    try { return buildSummary(rows, dateCol, metricCol, catCol); }
    catch { return null; }
  }, [rows, dateCol, metricCol, catCol]);

  const runInsights = async () => {
    if (!summary) return;
    setInsightsLoading(true); setInsightsError(""); setInsights(null);
    try {
      const raw = await askLocalModel(cfg,
        `You are a plain-English business analyst for a small business owner with no data background. ` +
        `Here is a summary of their data (metric: "${metricCol}"):\n${summaryForPrompt(summary, metricCol, catCol, dateCol)}\n\n` +
        `Respond ONLY with JSON, no markdown fences, no commentary before or after, in this shape: ` +
        `{"headline": "one-sentence big picture", "insights": [{"title": "short label", "detail": "2-3 plain sentences with concrete numbers"}], "watchout": "one risk or thing to check"}. ` +
        `Give 3 to 5 insights. Use everyday language, no jargon.`
      );
      const parsed = extractJsonObject(raw);
      if (parsed && parsed.headline) {
        setInsights(parsed);
      } else {
        // Smaller local models often ignore "JSON only". The prose is still
        // useful, so show it rather than throwing the whole answer away.
        setInsights({
          headline: "The model replied in prose rather than the expected format.",
          insights: [{ title: "Model output", detail: raw }],
          watchout: "",
        });
      }
    } catch (e) {
      setInsightsError(e.message);
    } finally { setInsightsLoading(false); }
  };

  const runQuestion = async () => {
    const q = question.trim();
    if (!q || !summary || qaLoading) return;
    setQaLoading(true); setQuestion("");
    try {
      const a = await askLocalModel(cfg,
        `You are answering a small business owner's question about their data. ` +
        `Data summary (metric: "${metricCol}"):\n${summaryForPrompt(summary, metricCol, catCol, dateCol)}\n\n` +
        `Question: ${q}\n\n` +
        `Answer in 2-4 plain sentences with concrete numbers where possible. If the summary can't answer it, say what extra data would be needed. No markdown.`
      );
      setQa((prev) => [...prev, { q, a }]);
    } catch (e) {
      setQa((prev) => [...prev, { q, a: e.message, isError: true }]);
    } finally { setQaLoading(false); }
  };

  const reset = () => {
    setRows(null); setFileName(""); setInsights(null); setQa([]);
    setParseError(""); setDateCol(""); setMetricCol(""); setCatCol("");
    setInsightsError(""); setQuestion("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const exportCsv = () => {
    if (!summary) return;
    const esc = (v) => {
      const s = String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const L = [
      `Plainsight Data analysis summary,${esc(fileName)}`,
      `Metric,${esc(metricCol)}`,
      `Rows analyzed,${summary.rowCount}`,
      `Rows with a value,${summary.valueCount}`,
      `Total,${Math.round(summary.total * 100) / 100}`,
      `Average per row,${Math.round(summary.avg * 100) / 100}`,
    ];
    if (summary.momPct !== null) {
      L.push(`Month-over-month change %,${Math.round(summary.momPct * 10) / 10}`);
    }
    if (summary.monthly.length) {
      L.push("", "Month,Total");
      summary.monthly.forEach((m) => L.push(`${m.month},${m.value}`));
    }
    if (summary.byCategory.length) {
      L.push("", `${esc(catCol)},Total`);
      summary.byCategory.forEach((c) => L.push(`${esc(c.name)},${c.value}`));
    }
    if (insights) {
      L.push("", "AI insights,", `Headline,${esc(insights.headline)}`);
      (insights.insights || []).forEach((it) => L.push(`${esc(it.title)},${esc(it.detail)}`));
      if (insights.watchout) L.push(`Worth checking,${esc(insights.watchout)}`);
    }
    const url = URL.createObjectURL(
      new Blob([L.join("\n")], { type: "text/csv;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `plainsight-summary-${(fileName || "data").replace(/\.csv$/i, "")}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  /* ---------- styles ---------- */
  const css = `
    @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=Inter:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap');
    * { box-sizing: border-box; }
    .ps-select { font-family: ${T.mono}; font-size: 13px; color: ${T.ink}; background: ${T.card};
      border: 1px solid ${T.line}; border-radius: 6px; padding: 6px 8px; }
    .ps-btn { font-family: ${T.display}; font-weight: 700; font-size: 14px; border-radius: 8px;
      padding: 10px 18px; cursor: pointer; border: 1px solid ${T.ink}; transition: transform .06s ease; }
    .ps-btn:active { transform: translateY(1px); }
    .ps-btn:focus-visible, .ps-select:focus-visible, .ps-input:focus-visible {
      outline: 2px solid ${T.gain}; outline-offset: 2px; }
    .ps-input { flex: 1; font-family: ${T.body}; font-size: 14px; padding: 10px 12px;
      border: 1px solid ${T.line}; border-radius: 8px; color: ${T.ink}; background: ${T.card}; }
    @media (prefers-reduced-motion: reduce) { .ps-btn { transition: none; } }
    .receipt { position: relative; background: ${T.card}; border: 1px solid ${T.line}; border-radius: 4px; }
    .receipt::after { content: ""; position: absolute; left: 0; right: 0; bottom: -8px; height: 8px;
      background: linear-gradient(-45deg, transparent 6px, ${T.card} 0) 0 0 / 12px 8px repeat-x,
                  linear-gradient(45deg, transparent 6px, ${T.card} 0) 6px 0 / 12px 8px repeat-x; }
  `;

  return (
    <div style={{ minHeight: "100vh", background: T.paper, color: T.ink, fontFamily: T.body, padding: "0 16px 64px" }}>
      <style>{css}</style>

      <div style={{ maxWidth: 880, margin: "0 auto" }}>
        {/* header */}
        <header style={{ padding: "36px 0 20px", display: "flex", alignItems: "baseline", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <div>
            <div style={{ fontFamily: T.display, fontWeight: 700, fontSize: 30, letterSpacing: "-0.02em" }}>
              Plainsight Data analysis
            </div>
            <div style={{ color: T.inkSoft, fontSize: 14, marginTop: 4 }}>
              Your numbers, explained in plain English. No formulas, no SQL.
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            {/* Always available — the model is worth configuring before a file is loaded. */}
            <SettingsToggle cfg={cfg} conn={conn} open={showSettings}
              onToggle={() => setShowSettings((v) => !v)} />
            {rows && (
              <>
                <button className="ps-btn" onClick={exportCsv}
                  style={{ background: T.ink, color: T.paper }}>
                  Export CSV
                </button>
                <button className="ps-btn" onClick={reset}
                  style={{ background: "transparent", color: T.ink }}>
                  Load a different file
                </button>
              </>
            )}
          </div>
        </header>

        {showSettings && (
          <SettingsPanel
            cfg={cfg}
            models={models}
            conn={conn}
            onProvider={switchProvider}
            onPatch={patchCfg}
            onConnect={connect}
            onClose={() => setShowSettings(false)}
          />
        )}

        {/* upload state */}
        {!rows && (
          <section>
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); onFile(e.dataTransfer.files[0]); }}
              style={{
                border: `2px dashed ${dragOver ? T.gain : T.line}`,
                background: dragOver ? T.accentSoft : T.card,
                borderRadius: 12, padding: "56px 24px", textAlign: "center",
              }}
            >
              <div style={{ fontFamily: T.display, fontWeight: 700, fontSize: 20, marginBottom: 8 }}>
                Drop a CSV of your sales here
              </div>
              <div style={{ color: T.inkSoft, fontSize: 14, marginBottom: 20 }}>
                Exports from Square, Shopify, Excel, or any spreadsheet work. Needs a header row and at least one number column.
              </div>
              <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
                {/* A real button, not a styled <label> — a label isn't keyboard focusable. */}
                <button className="ps-btn" style={{ background: T.ink, color: T.paper }}
                  onClick={() => fileInputRef.current?.click()}>
                  Choose a file
                </button>
                <input ref={fileInputRef} type="file" accept=".csv,text/csv" style={{ display: "none" }}
                  onChange={(e) => {
                    onFile(e.target.files[0]);
                    e.target.value = ""; // otherwise picking the same file twice fires no change event
                  }} />
                <button className="ps-btn" style={{ background: "transparent", color: T.ink }}
                  onClick={() => loadCsvText(SAMPLE_CSV, "sample-coffee-sales.csv")}>
                  Try sample data
                </button>
              </div>
              {parseError && (
                <div style={{ marginTop: 18, color: T.loss, fontSize: 14 }}>{parseError}</div>
              )}
              <div style={{ marginTop: 22, fontSize: 12, color: T.inkSoft }}>
                Everything runs on this machine. Your file is read in the browser, and the AI analysis
                goes to a model server on localhost — nothing is uploaded anywhere.
              </div>
            </div>
          </section>
        )}

        {/* dashboard */}
        {rows && summary && (
          <>
            {/* column pickers */}
            <section style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center", marginBottom: 22 }}>
              <span style={{ fontFamily: T.mono, fontSize: 12, color: T.inkSoft }}>{fileName} · {summary.rowCount} rows</span>
              <label style={{ fontSize: 13, color: T.inkSoft }}>
                Analyze{" "}
                <select className="ps-select" value={metricCol} onChange={(e) => setMetricCol(e.target.value)}>
                  {detected.numCols.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
              {detected.dateCols.length > 0 && (
                <label style={{ fontSize: 13, color: T.inkSoft }}>
                  over{" "}
                  <select className="ps-select" value={dateCol} onChange={(e) => setDateCol(e.target.value)}>
                    {detected.dateCols.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
              )}
              {detected.catCols.length > 0 && (
                <label style={{ fontSize: 13, color: T.inkSoft }}>
                  split by{" "}
                  <select className="ps-select" value={catCol} onChange={(e) => setCatCol(e.target.value)}>
                    {detected.catCols.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
              )}
            </section>

            {/* receipt strip — signature element */}
            <section className="receipt" style={{ padding: "20px 24px 24px", marginBottom: 34 }}>
              <div style={{ fontFamily: T.mono, fontSize: 11, letterSpacing: "0.12em", color: T.inkSoft, textTransform: "uppercase", marginBottom: 14 }}>
                ***** summary · {metricCol} *****
              </div>
              <div style={{ display: "flex", gap: 32, flexWrap: "wrap" }}>
                <div>
                  <div style={{ fontFamily: T.mono, fontSize: 12, color: T.inkSoft }}>TOTAL</div>
                  <div style={{ fontFamily: T.mono, fontSize: 30, fontWeight: 500 }}>{fmt(summary.total)}</div>
                  <Delta pct={summary.momPct} />
                </div>
                <div>
                  <div style={{ fontFamily: T.mono, fontSize: 12, color: T.inkSoft }}>AVG / ROW</div>
                  <div style={{ fontFamily: T.mono, fontSize: 30, fontWeight: 500 }}>{fmt(summary.avg)}</div>
                  {summary.valueCount !== summary.rowCount && (
                    <span style={{ fontFamily: T.mono, fontSize: 13, color: T.inkSoft }}>
                      over {fmt(summary.valueCount)} rows with a value
                    </span>
                  )}
                </div>
                {summary.best && (
                  <div>
                    <div style={{ fontFamily: T.mono, fontSize: 12, color: T.inkSoft }}>BEST MONTH</div>
                    <div style={{ fontFamily: T.mono, fontSize: 30, fontWeight: 500 }}>{summary.best.month}</div>
                    <span style={{ fontFamily: T.mono, fontSize: 13, color: T.gain }}>{fmt(summary.best.value)}</span>
                  </div>
                )}
                {summary.worst && (
                  <div>
                    <div style={{ fontFamily: T.mono, fontSize: 12, color: T.inkSoft }}>SLOWEST</div>
                    <div style={{ fontFamily: T.mono, fontSize: 30, fontWeight: 500 }}>{summary.worst.month}</div>
                    <span style={{ fontFamily: T.mono, fontSize: 13, color: T.loss }}>{fmt(summary.worst.value)}</span>
                  </div>
                )}
              </div>
            </section>

            {/* charts */}
            <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 20, marginBottom: 30 }}>
              {summary.monthly.length > 1 && (
                <div style={{ background: T.card, border: `1px solid ${T.line}`, borderRadius: 10, padding: 18 }}>
                  <div style={{ fontFamily: T.display, fontWeight: 700, fontSize: 15, marginBottom: 12 }}>
                    {metricCol} by month
                  </div>
                  <ResponsiveContainer width="100%" height={220}>
                    <AreaChart data={summary.monthly} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
                      <CartesianGrid stroke={T.line} strokeDasharray="3 3" />
                      <XAxis dataKey="month" tick={{ fontSize: 11, fontFamily: T.mono, fill: T.inkSoft }} />
                      <YAxis tick={{ fontSize: 11, fontFamily: T.mono, fill: T.inkSoft }} />
                      <Tooltip contentStyle={{ fontFamily: T.mono, fontSize: 12, border: `1px solid ${T.line}` }} />
                      <Area type="monotone" dataKey="value" stroke={T.ink} strokeWidth={2} fill={T.accentSoft} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
              {summary.byCategory.length > 1 && (
                <div style={{ background: T.card, border: `1px solid ${T.line}`, borderRadius: 10, padding: 18 }}>
                  <div style={{ fontFamily: T.display, fontWeight: 700, fontSize: 15, marginBottom: 12 }}>
                    {metricCol} by {catCol}
                    {summary.categoryCount > summary.byCategory.length &&
                      ` (top ${summary.byCategory.length} of ${summary.categoryCount})`}
                  </div>
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={summary.byCategory} margin={{ top: 4, right: 8, left: -10, bottom: 0 }}>
                      <CartesianGrid stroke={T.line} strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="name" tick={{ fontSize: 11, fontFamily: T.mono, fill: T.inkSoft }} interval={0} angle={-12} height={44} />
                      <YAxis tick={{ fontSize: 11, fontFamily: T.mono, fill: T.inkSoft }} />
                      <Tooltip contentStyle={{ fontFamily: T.mono, fontSize: 12, border: `1px solid ${T.line}` }} />
                      <Bar dataKey="value" fill={T.ink} radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </section>

            {/* AI insights */}
            <section style={{ marginBottom: 34 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
                <div style={{ fontFamily: T.display, fontWeight: 700, fontSize: 19 }}>What your data says</div>
                <button className="ps-btn" onClick={runInsights} disabled={insightsLoading || !aiReady}
                  title={aiReady ? "" : "Connect a local model first"}
                  style={{ background: T.ink, color: T.paper, opacity: insightsLoading || !aiReady ? 0.6 : 1 }}>
                  {insightsLoading ? "Reading your numbers…" : insights ? "Explain again" : "Explain my data"}
                </button>
              </div>

              {/* Settings live in the header now; this is just a pointer for the
                  one case where their absence blocks you. */}
              {!aiReady && !showSettings && (
                <div style={{
                  background: T.accentSoft, borderLeft: `4px solid ${T.gain}`,
                  borderRadius: "0 8px 8px 0", padding: "12px 16px", marginBottom: 16,
                  fontSize: 14, display: "flex", alignItems: "center",
                  justifyContent: "space-between", gap: 12, flexWrap: "wrap",
                }}>
                  <span>Connect a local model to turn this on. Charts and export work without one.</span>
                  <button className="ps-btn" onClick={() => setShowSettings(true)}
                    style={{ background: "transparent", color: T.ink, padding: "6px 12px", fontSize: 13 }}>
                    Open settings
                  </button>
                </div>
              )}

              {insightsError && <div style={{ color: T.loss, fontSize: 14, marginBottom: 10 }}>{insightsError}</div>}
              {!insights && !insightsLoading && !insightsError && (
                <div style={{ color: T.inkSoft, fontSize: 14 }}>
                  One click gets you a plain-English readout: what's growing, what's slipping, and what to check next.
                </div>
              )}
              {insights && (
                <div>
                  <div style={{ fontFamily: T.display, fontWeight: 700, fontSize: 16, background: T.accentSoft, borderLeft: `4px solid ${T.gain}`, padding: "12px 16px", borderRadius: "0 8px 8px 0", marginBottom: 16 }}>
                    {insights.headline}
                  </div>
                  <div style={{ display: "grid", gap: 12 }}>
                    {(insights.insights || []).map((it, i) => (
                      <div key={i} style={{ background: T.card, border: `1px solid ${T.line}`, borderRadius: 10, padding: "14px 18px" }}>
                        <div style={{ fontFamily: T.mono, fontSize: 12, letterSpacing: "0.08em", textTransform: "uppercase", color: T.inkSoft, marginBottom: 6 }}>
                          {it.title}
                        </div>
                        <div style={{ fontSize: 15, lineHeight: 1.55 }}>{it.detail}</div>
                      </div>
                    ))}
                    {insights.watchout && (
                      <div style={{ background: T.card, border: `1px solid ${T.loss}`, borderRadius: 10, padding: "14px 18px" }}>
                        <div style={{ fontFamily: T.mono, fontSize: 12, letterSpacing: "0.08em", textTransform: "uppercase", color: T.loss, marginBottom: 6 }}>
                          Worth checking
                        </div>
                        <div style={{ fontSize: 15, lineHeight: 1.55 }}>{insights.watchout}</div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </section>

            {/* Q&A */}
            <section>
              <div style={{ fontFamily: T.display, fontWeight: 700, fontSize: 19, marginBottom: 6 }}>Ask a question</div>
              <div style={{ color: T.inkSoft, fontSize: 14, marginBottom: 14 }}>
                In your own words — "which month was slowest?", "is online growing?", "what should I stock more of?"
              </div>
              <div style={{ display: "grid", gap: 10, marginBottom: 14 }}>
                {qa.map((item, i) => (
                  <div key={i} style={{
                    background: T.card, borderRadius: 10, padding: "12px 16px",
                    border: `1px solid ${item.isError ? T.loss : T.line}`,
                  }}>
                    <div style={{ fontFamily: T.mono, fontSize: 13, color: T.inkSoft, marginBottom: 6 }}>Q: {item.q}</div>
                    <div style={{ fontSize: 15, lineHeight: 1.55, color: item.isError ? T.loss : T.ink }}>{item.a}</div>
                  </div>
                ))}
                {qaLoading && <div style={{ fontFamily: T.mono, fontSize: 13, color: T.inkSoft }}>Thinking it over…</div>}
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <input className="ps-input" value={question} placeholder="Type a question about your data"
                  onChange={(e) => setQuestion(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && runQuestion()} />
                <button className="ps-btn" onClick={runQuestion} disabled={qaLoading || !question.trim() || !aiReady}
                  title={aiReady ? "" : "Connect a local model first"}
                  style={{ background: T.ink, color: T.paper, opacity: qaLoading || !question.trim() || !aiReady ? 0.6 : 1 }}>
                  Ask
                </button>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
