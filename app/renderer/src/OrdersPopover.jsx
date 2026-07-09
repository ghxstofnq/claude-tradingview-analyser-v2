// app/renderer/src/OrdersPopover.jsx
// ORDERS — manual market-order ticket. Sizes from the per-trade risk in Settings
// + live ICT structure; auto-picks the stop (typed/clickable override); TP from
// untaken session/PD/PW draws; shows R:R + current position; places to the
// confirmed account; one-tap Flatten. All math in main (execution:order*).
// Laid out with the shared Panel/Row system to match PREP/LIVE/REVIEW.
import React, { useState, useEffect, useRef, useCallback } from "react";
import { clickable } from "./a11y.js";
import { useFloat } from "./hooks/useFloat.js";
import { Panel, Row } from "./Shared.jsx";
import { executionAdapter } from "./execution/executionAdapter.js";
import { routingLabel, blockMessage, orderResultToast, stopChooserRows, tpChooserRows } from "./Orders.helpers.js";

const fmt = (n) => (n == null || !Number.isFinite(Number(n)) ? "—" : Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 }));
const symShort = (s) => String(s || "").replace(/1!$/, "") || "—";

function OrdersBody({ onToast, toast, symbol, initialSide = "buy" }) {
  const [ctx, setCtx] = useState(null);
  const [acct, setAcct] = useState(null);
  const [pos, setPos] = useState(null);
  const [side, setSide] = useState(initialSide === "sell" ? "sell" : "buy");
  const [typedStop, setTypedStop] = useState("");
  const [typedTp, setTypedTp] = useState("");
  const [risk, setRisk] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const debounce = useRef(null);
  const firstLoad = useRef(true);

  const loadContext = useCallback(async (refresh = false) => {
    const r = await executionAdapter.orderContext({ refresh, symbol });
    if (r?.ok) setCtx(r.context);
  }, [symbol]);

  // account gate + default risk — mount only (don't clobber an inline risk edit).
  useEffect(() => {
    window.api?.execution?.account?.get?.().then((r) => { if (r?.ok) setAcct(r); });
    window.api?.execution?.config?.get?.().then((r) => { if (r?.ok) setRisk(r.config?.guards?.defaultRisk ?? 120); });
  }, []);

  // structure context — read from the in-app webview chart on mount + whenever
  // the trader's symbol changes; clear typed levels + the stale preview so the
  // old symbol's stop/TP don't linger. On a symbol change, settle briefly first
  // so the webview finishes switching before we read it.
  useEffect(() => {
    setTypedStop(""); setTypedTp(""); setPreview(null);
    if (firstLoad.current) { firstLoad.current = false; loadContext(false); return; }
    const t = setTimeout(() => loadContext(false), 800);
    return () => clearTimeout(t);
  }, [loadContext]);

  useEffect(() => {
    let live = true;
    const tick = async () => { const r = await executionAdapter.state(); if (live && r?.ok) setPos(r.state?.position ?? null); };
    tick(); const id = setInterval(tick, 2000);
    return () => { live = false; clearInterval(id); };
  }, []);

  useEffect(() => {
    if (!ctx || risk == null) return;
    clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      const r = await executionAdapter.orderPreview({
        side, symbol,
        typedStop: typedStop === "" ? null : Number(typedStop),
        typedTp: typedTp === "" ? null : Number(typedTp),
        riskUsd: Number(risk),
      });
      if (r?.ok) setPreview(r.preview);
    }, 150);
    return () => clearTimeout(debounce.current);
  }, [ctx, side, typedStop, typedTp, risk, symbol]);

  const place = async () => {
    setBusy(true);
    try {
      const r = await executionAdapter.placeManual({
        side, symbol,
        typedStop: typedStop === "" ? null : Number(typedStop),
        typedTp: typedTp === "" ? null : Number(typedTp),
        riskUsd: Number(risk),
      });
      onToast(orderResultToast(r, { side, contracts: preview?.contracts, symbol: ctx?.symbol }));
    } finally { setBusy(false); }
  };
  const flatten = async () => {
    const r = await executionAdapter.flatten({ symbol: ctx?.symbol });
    onToast(r?.ok ? `FLATTEN SENT · ${ctx?.symbol}` : `FLATTEN FAILED · ${r?.error || ""}`);
  };

  const routable = acct?.gate?.route === true;
  const blocked = preview?.block;
  const canPlace = routable && !blocked && !busy && preview?.contracts >= 1;
  const stopRows = stopChooserRows(preview, typedStop);
  const tpRows = tpChooserRows(preview, typedTp);

  // Enter confirms (refined ticket decision, 2026-07-10): buttons → glance →
  // ⏎ places. Ignored while typing in a field; esc still closes via the shell.
  const placeRef = useRef(null);
  placeRef.current = canPlace ? place : null;
  useEffect(() => {
    const h = (e) => {
      if (e.key !== "Enter" || e.repeat) return;
      const tag = e.target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (placeRef.current) { e.preventDefault(); placeRef.current(); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  const routeRight = (
    <span className="ord-head-right">
      <span className={"ord-route " + (routable ? "ok" : "bad")}>{routingLabel(acct || {})}</span>
      <span className="pill interactive" title="refresh structure" onClick={() => loadContext(true)}>↻</span>
    </span>
  );

  return (
    <>
      <div className="body orders-scroll">
        {/* POSITION — only when one exists (the refined ticket is for entries) */}
        {pos && (
          <Panel title="POSITION" right={ctx?.symbol}>
            <Row k="SIDE / QTY" v={`${(pos.side || "").toUpperCase()} ${pos.qty}`} tone={pos.side === "buy" ? "ok" : "bad"} />
            <Row k="AVG FILL" v={fmt(pos.avgFill)} />
            <Row k="uPnL" v={pos.uPnlUsd != null ? `$${fmt(pos.uPnlUsd)}` : "—"} tone={pos.uPnlUsd > 0 ? "ok" : pos.uPnlUsd < 0 ? "bad" : ""} />
          </Panel>
        )}

        {/* ORDER — side · symbol · live price (stacked chooser, 2026-07-10) */}
        <Panel title="ORDER" right={routeRight}>
          <div className="row">
            <span className="k">SIDE</span>
            <span className="v ord-sides">
              <span className={"pill interactive" + (side === "buy" ? " active green" : "")} onClick={() => setSide("buy")}>BUY</span>
              <span className={"pill interactive" + (side === "sell" ? " active red" : "")} onClick={() => setSide("sell")}>SELL</span>
            </span>
          </div>
          <Row k="SYMBOL" v={ctx?.symbol ?? "—"} tone={ctx?.stale ? "warn" : ""} />
          <Row k="PRICE" v={fmt(ctx?.price)} />
          {blocked && <div className="orders-block">{blockMessage(blocked)}</div>}
        </Panel>

        {/* STOP — choose one; default = nearest entry-FVG's 1/3 candle.
            Picking the default writes "" so placement re-derives it fresh. */}
        <Panel title="STOP" right={side === "buy" ? "lows below" : "highs above"}>
          {stopRows.rows.map((r) => (
            <div key={r.key} className={"ord-choice" + (r.sel ? " sel" : "")} onClick={() => setTypedStop(r.value)}>
              <span className="dot">{r.sel ? "●" : "○"}</span>
              <span className="tag">{r.tag}</span>
              <span className="nm">{r.label}</span>
              <span className="px">{fmt(r.stopPrice)}</span>
              <span className="pts">{r.pts != null ? `${fmt(r.pts)} pts` : ""}</span>
            </div>
          ))}
          {!stopRows.rows.length && <div className="ord-empty">no structure on the stop side — type one below</div>}
          <div className={"ord-choice custom" + (stopRows.customSel ? " sel" : "")}>
            <span className="dot">{stopRows.customSel ? "●" : "○"}</span>
            <span className="tag">custom</span>
            <input className="ord-in" placeholder="price" value={typedStop} onChange={(e) => setTypedStop(e.target.value)} />
            {typedStop !== "" && <span className="pill interactive" onClick={() => setTypedStop("")}>default</span>}
          </div>
        </Panel>

        {/* TP — choose one; default = 1:2 from the working stop. */}
        <Panel title="TP" right={side === "buy" ? "above" : "below"}>
          {tpRows.rows.map((r) => (
            <div key={r.key} className={"ord-choice" + (r.sel ? " sel" : "")} onClick={() => setTypedTp(r.value)}>
              <span className="dot">{r.sel ? "●" : "○"}</span>
              <span className="tag">{r.tag}</span>
              <span className="nm">{r.label}</span>
              <span className="px">{fmt(r.price)}</span>
              <span className="pts">{r.rr != null ? `${fmt(r.rr)}R` : ""}</span>
            </div>
          ))}
          {!tpRows.rows.length && <div className="ord-empty">no TP available — type one below</div>}
          <div className={"ord-choice custom" + (tpRows.customSel ? " sel" : "")}>
            <span className="dot">{tpRows.customSel ? "●" : "○"}</span>
            <span className="tag">custom</span>
            <input className="ord-in" placeholder="price" value={typedTp} onChange={(e) => setTypedTp(e.target.value)} />
            {typedTp !== "" && <span className="pill interactive" onClick={() => setTypedTp("")}>1:2</span>}
          </div>
        </Panel>

        {/* RISK — seeds from Settings defaultRisk; sizing is live. */}
        <Panel title="RISK">
          <div className="row">
            <span className="k">RISK $</span>
            <span className="v ord-field">
              <input className="ord-in" value={risk ?? ""} onChange={(e) => setRisk(e.target.value === "" ? "" : Number(e.target.value))} />
              <span className={"ord-hint" + (preview && !preview.withinTolerance ? " warn" : "")}>
                {preview ? `→ ${preview.contracts} ${symShort(ctx?.symbol)} · $${fmt(preview.actualRiskUsd)} actual${preview.rr != null ? ` · ${preview.rr}R` : ""}` : ""}
              </span>
            </span>
          </div>
        </Panel>
      </div>

      {/* pinned footer */}
      <div className="orders-foot">
        {!routable && <div className="orders-block">account not routable — confirm an account in Settings</div>}
        <div className="orders-actions">
          <button className={"pill big " + (side === "buy" ? "green" : "red")} disabled={!canPlace} onClick={place}>
            CONFIRM — {side.toUpperCase()}{preview?.contracts >= 1 ? ` ${preview.contracts} ${symShort(ctx?.symbol)}` : ""} MARKET
            {canPlace ? <span className="ord-kbd">⏎</span> : null}
          </button>
          <button className="pill big" disabled={!pos} onClick={flatten}>FLATTEN</button>
        </div>
        {toast && <div className="orders-toast">{toast}</div>}
      </div>
    </>
  );
}

export function OrdersCell({ symbol }) {
  const [open, setOpen] = useState(false);
  const float = useFloat();
  const [toast, setToast] = useState(null);
  useEffect(() => {
    const onOpen = (e) => {
      if (e.detail?.which === "orders") setOpen((o) => !o);
      if (e.detail?.which === "all-close") setOpen(false);
    };
    window.addEventListener("topbar:open-cell", onOpen);
    return () => window.removeEventListener("topbar:open-cell", onOpen);
  }, []);
  useEffect(() => { if (!toast) return; const id = setTimeout(() => setToast(null), 3000); return () => clearTimeout(id); }, [toast]);

  return (
    <div className={"cell pop-cell" + (open ? " open" : "")}
         {...clickable((e) => { if (e.target.closest(".bt-popover")) return; setOpen((o) => !o); })}>
      <span className="k">ORDERS</span>
      {open && (
        <div className={"bt-popover w-660 orders-pop" + float.popoverClass} style={float.popoverStyle} onClick={(e) => e.stopPropagation()}>
          <div className="head" onMouseDown={float.onDragStart}>
            <span className="t">ORDERS · manual ticket</span>
            <span className="spacer" style={{ flex: 1 }} />
            <span className={"float-btn" + (float.floating ? " on" : "")}
                  title={float.floating ? "Dock window" : "Float — move & resize freely"}
                  onClick={float.toggle}>⛶</span>
            <span className="x" onClick={() => setOpen(false)}>×</span>
          </div>
          <OrdersBody onToast={setToast} toast={toast} symbol={symbol} />
        </div>
      )}
    </div>
  );
}

// Exported for the Command Shell palette ticket view (2026-07-03) — same
// structure+risk order flow, seeded with a side from the parsed "long/short"
// command. OrdersCell keeps its own default.
export { OrdersBody };
