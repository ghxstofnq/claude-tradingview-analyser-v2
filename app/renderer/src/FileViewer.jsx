// In-app file viewer — opens as a fullscreen overlay.
//
// Routes by file extension:
//   .json  → collapsible JSON tree
//   .jsonl → table (auto-columns from first object's keys)
//   .md    → rendered markdown
//   anything else → plain monospace text

import React, { useEffect, useState } from "react";
import { marked } from "marked";

function fileExt(name) {
  const m = /\.([^.]+)$/.exec(name || "");
  return m ? m[1].toLowerCase() : "";
}

function fmtBytes(n) {
  if (n == null) return "—";
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

// ---------- JSON tree ----------

function JsonNode({ k, value, depth, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen || depth < 2);
  const isObj = value !== null && typeof value === "object";
  const isArr = Array.isArray(value);
  const keyLabel = k != null
    ? <span style={{ color: "var(--amber)" }}>"{k}"</span>
    : null;
  const colon = k != null ? <span style={{ color: "var(--label)" }}>: </span> : null;

  if (!isObj) {
    let str;
    let color;
    if (typeof value === "string") { str = `"${value}"`; color = "#59d499"; }
    else if (typeof value === "number") { str = String(value); color = "#57c1ff"; }
    else if (typeof value === "boolean") { str = String(value); color = "#ffc533"; }
    else if (value === null) { str = "null"; color = "var(--label)"; }
    else { str = String(value); color = "var(--value)"; }
    return (
      <div style={{ paddingLeft: depth * 14 }}>
        {keyLabel}{colon}<span style={{ color }}>{str}</span>
      </div>
    );
  }

  const entries = isArr ? value.map((v, i) => [i, v]) : Object.entries(value);
  const sample = isArr
    ? `Array(${entries.length})`
    : `{${entries.length}}`;

  return (
    <div style={{ paddingLeft: depth * 14 }}>
      <span
        onClick={() => setOpen((o) => !o)}
        style={{ cursor: "pointer", userSelect: "none", color: "var(--label)" }}>
        {open ? "▾ " : "▸ "}
      </span>
      {keyLabel}{colon}
      {!open && <span style={{ color: "var(--label)" }}>{sample}</span>}
      {open && (
        <div>
          <span style={{ color: "var(--label)" }}>{isArr ? "[" : "{"}</span>
          {entries.map(([childK, v]) => (
            <JsonNode key={childK} k={childK} value={v} depth={depth + 1} />
          ))}
          <div style={{ paddingLeft: depth * 14 }}>
            <span style={{ color: "var(--label)" }}>{isArr ? "]" : "}"}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function JsonViewer({ data }) {
  return (
    <div style={{
      fontFamily: "ui-monospace, Menlo, monospace",
      fontSize: 11.5,
      lineHeight: 1.55,
      color: "var(--value)",
      whiteSpace: "pre",
    }}>
      <JsonNode k={null} value={data} depth={0} defaultOpen />
    </div>
  );
}

// ---------- JSONL table ----------

function JsonlViewer({ text, maxRows = 500 }) {
  const lines = text.split("\n").filter((l) => l.trim());
  const total = lines.length;
  const rendered = lines.slice(-maxRows);    // last N — most-recent events on top of mind
  const rows = rendered.map((l) => {
    try { return JSON.parse(l); } catch { return { _raw: l }; }
  });

  // Compute the union of keys seen across rows, preserving insertion order.
  const keys = [];
  const seen = new Set();
  for (const r of rows) {
    for (const k of Object.keys(r)) {
      if (!seen.has(k)) { seen.add(k); keys.push(k); }
    }
  }

  return (
    <div>
      <div style={{
        color: "var(--label)", fontSize: 10, marginBottom: 8, letterSpacing: ".06em",
      }}>
        {total <= maxRows ? `${total} rows` : `last ${maxRows} of ${total} rows`}
      </div>
      <div style={{ overflow: "auto", border: "1px solid var(--border)" }}>
        <table style={{
          borderCollapse: "collapse",
          fontFamily: "ui-monospace, Menlo, monospace",
          fontSize: 10.5,
          minWidth: "100%",
        }}>
          <thead>
            <tr style={{ background: "var(--surface-1)" }}>
              {keys.map((k) => (
                <th key={k} style={{
                  textAlign: "left", padding: "5px 9px",
                  color: "var(--amber)", letterSpacing: ".1em",
                  borderBottom: "1px solid var(--border)",
                  position: "sticky", top: 0,
                  background: "var(--surface-1)",
                  fontWeight: "normal",
                }}>{k}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} style={{ borderBottom: "1px solid var(--border-dim, #1e2228)" }}>
                {keys.map((k) => (
                  <td key={k} style={{
                    padding: "4px 9px",
                    color: "var(--value)",
                    verticalAlign: "top",
                    whiteSpace: "nowrap",
                    maxWidth: 360,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }} title={typeof r[k] === "object" ? JSON.stringify(r[k]) : String(r[k] ?? "")}>
                    {r[k] == null
                      ? <span style={{ color: "var(--label-dim, #3d434b)" }}>—</span>
                      : typeof r[k] === "object"
                      ? <span style={{ color: "var(--label)" }}>{JSON.stringify(r[k])}</span>
                      : String(r[k])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------- Markdown ----------

// Lightweight XSS guard for marked output. Claude writes the source
// markdown (pillar1.md, pillar2.md, etc); if Claude ever emits raw HTML
// (intentionally or via a confused prompt), marked passes it through
// unchanged. This stripper removes the obvious vectors. Not a substitute
// for DOMPurify but blocks <script>, <iframe>, <object>, <embed>, <style>,
// and inline event handlers. Good enough for a trusted-but-not-perfectly-
// trusted source like Claude.
function sanitizeMarkdownHtml(html) {
  return html
    .replace(/<\s*(script|iframe|object|embed|style)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<\s*(script|iframe|object|embed|style|link|meta)\b[^>]*\/?\s*>/gi, "")
    .replace(/\s+on[a-z]+\s*=\s*"[^"]*"/gi, "")
    .replace(/\s+on[a-z]+\s*=\s*'[^']*'/gi, "")
    .replace(/\s+on[a-z]+\s*=\s*[^\s>]+/gi, "")
    .replace(/\s+(href|src)\s*=\s*"javascript:[^"]*"/gi, "")
    .replace(/\s+(href|src)\s*=\s*'javascript:[^']*'/gi, "");
}

function MarkdownViewer({ text }) {
  const rawHtml = marked.parse(text, { breaks: true });
  const html = sanitizeMarkdownHtml(rawHtml);
  return (
    <div
      dangerouslySetInnerHTML={{ __html: html }}
      style={{
        color: "var(--value)",
        lineHeight: 1.6,
        fontSize: 12.5,
      }} />
  );
}

// ---------- Plain text fallback ----------

function PlainViewer({ text }) {
  return (
    <pre style={{
      color: "var(--value)",
      fontFamily: "ui-monospace, Menlo, monospace",
      fontSize: 11.5,
      whiteSpace: "pre-wrap",
      lineHeight: 1.5,
      margin: 0,
    }}>{text}</pre>
  );
}

// ---------- Modal shell ----------

export function FileViewer({ file, onClose }) {
  const [state, setState] = useState({ loading: true });

  useEffect(() => {
    if (!file?.path) return;
    setState({ loading: true });
    window.api?.files?.read?.(file.path).then((res) => {
      setState({ loading: false, res });
    }).catch((err) => setState({ loading: false, res: { ok: false, error: String(err?.message || err) } }));
  }, [file?.path]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!file) return null;
  const ext = fileExt(file.label || file.path);

  let body;
  if (state.loading) {
    body = <div style={{ color: "var(--label)", fontSize: 11 }}>loading…</div>;
  } else if (!state.res?.ok) {
    body = <div style={{ color: "var(--red)", fontSize: 11.5 }}>{state.res?.error || "failed to read"}</div>;
  } else {
    const text = state.res.content || "";
    if (ext === "json") {
      try { body = <JsonViewer data={JSON.parse(text)} />; }
      catch { body = <PlainViewer text={text} />; }
    } else if (ext === "jsonl") {
      body = <JsonlViewer text={text} />;
    } else if (ext === "md") {
      body = <MarkdownViewer text={text} />;
    } else {
      body = <PlainViewer text={text} />;
    }
  }

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(6,8,11,0.78)",
        backdropFilter: "blur(2px)",
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 36,
      }}>
      <div style={{
        width: "100%",
        maxWidth: 1100,
        height: "100%",
        background: "var(--surface-0)",
        border: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        fontFamily: "ui-monospace, Menlo, monospace",
      }}>
        <div style={{
          padding: "8px 14px",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          borderBottom: "1px solid var(--border)",
          background: "var(--surface-1)",
        }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 14, minWidth: 0 }}>
            <span style={{ color: "var(--amber)", letterSpacing: ".22em", fontSize: 10.5 }}>
              FILE
            </span>
            <span style={{ color: "var(--value)", fontSize: 12, whiteSpace: "nowrap", textOverflow: "ellipsis", overflow: "hidden" }}>
              {file.label || file.path}
            </span>
            <span style={{ color: "var(--label)", fontSize: 10 }}>
              {fmtBytes(state.res?.size)}
            </span>
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <button
              onClick={() => window.api?.files?.open?.(file.path)}
              style={{
                color: "var(--amber)", background: "transparent",
                border: "1px solid var(--amber, #e3b341)",
                padding: "3px 9px", fontSize: 9.5, letterSpacing: ".16em",
                cursor: "pointer", fontFamily: "inherit",
              }}>
              OPEN IN EDITOR
            </button>
            <button
              onClick={() => window.api?.files?.reveal?.(file.path)}
              style={{
                color: "var(--value)", background: "transparent",
                border: "1px solid var(--border)",
                padding: "3px 9px", fontSize: 9.5, letterSpacing: ".16em",
                cursor: "pointer", fontFamily: "inherit",
              }}>
              FINDER
            </button>
            <span onClick={onClose}
                  style={{ color: "var(--label-dim)", fontSize: 16, cursor: "pointer", padding: "0 4px" }}>×</span>
          </span>
        </div>
        <div style={{ flex: 1, overflow: "auto", padding: 14 }}>
          {body}
        </div>
        <div style={{
          padding: "6px 14px",
          color: "var(--label)", fontSize: 9.5, letterSpacing: ".06em",
          borderTop: "1px solid var(--border)",
          background: "var(--surface-1)",
          whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        }}>
          {file.path}
        </div>
      </div>
    </div>
  );
}
