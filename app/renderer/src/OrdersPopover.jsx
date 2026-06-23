// app/renderer/src/OrdersPopover.jsx
// ORDERS — manual market-order ticket. Sizes from the per-trade risk in Settings
// + live ICT structure; auto-picks the stop (typed/clickable override); TP from
// untaken session/PD/PW draws; shows R:R + current position; places to the
// confirmed account; one-tap Flatten. All math in main (execution:order*).
// Laid out with the shared Panel/Row system to match PREP/LIVE/REVIEW.
import React, { useState, useEffect, useRef, useCallback } from "react";
import { clickable } from "./a11y.js";
import { Panel, Row } from "./Shared.jsx";
import { executionAdapter } from "./execution/executionAdapter.js";
import { formatStopSource, routingLabel, blockMessage, orderResultToast } from "./Orders.helpers.js";

const fmt = (n) => (n == null || !Number.isFinite(Number(n)) ? "—" : Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 }));
const sameNum = (a, b) => a !== "" && a != null && Number(a) === Number(b);

function OrdersBody({ onToast, toast, symbol }) {
  const [ctx, setCtx] = useState(null);
  const [acct, setAcct] = useState(null);
  const [pos, setPos] = useState(null);
  const [side, setSide] = useState("buy");
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
  const stopOptions = preview?.stopOptions ?? [];
  const tpDraws = preview?.tpDraws ?? [];

  const routeRight = (
    <span className="ord-head-right">
      <span className={"ord-route " + (routable ? "ok" : "bad")}>{routingLabel(acct || {})}</span>
      <span className="pill interactive" title="refresh structure" onClick={() => loadContext(true)}>↻</span>
    </span>
  );

  return (
    <>
      <div className="body orders-scroll">
        {/* POSITION */}
        <Panel title="POSITION" right={pos ? ctx?.symbol : "flat"}>
          {pos ? (
            <>
              <Row k="SIDE / QTY" v={`${(pos.side || "").toUpperCase()} ${pos.qty}`} tone={pos.side === "buy" ? "ok" : "bad"} />
              <Row k="AVG FILL" v={fmt(pos.avgFill)} />
              <Row k="uPnL" v={pos.uPnlUsd != null ? `$${fmt(pos.uPnlUsd)}` : "—"} tone={pos.uPnlUsd > 0 ? "ok" : pos.uPnlUsd < 0 ? "bad" : ""} />
            </>
          ) : <div className="ord-empty">no open position</div>}
        </Panel>

        {/* ORDER TICKET */}
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
          <div className="row">
            <span className="k">STOP</span>
            <span className="v ord-field">
              <input className="ord-in" placeholder={preview?.stopAuto ? String(preview.stopAuto.price) : "type"} value={typedStop} onChange={(e) => setTypedStop(e.target.value)} />
              <span className="ord-hint">{preview?.stopSource ? `${formatStopSource(preview.stopSource)} · ${fmt(preview.stop)}` : "—"}</span>
              {typedStop !== "" && <span className="pill interactive" onClick={() => setTypedStop("")}>auto</span>}
            </span>
          </div>
          <div className="row">
            <span className="k">TP <span className="ord-opt">optional</span></span>
            <span className="v ord-field">
              <input className="ord-in" placeholder="none" value={typedTp} onChange={(e) => setTypedTp(e.target.value)} />
              <span className="ord-hint">{preview?.rr != null ? `${preview.rr}R` : ""}</span>
              {typedTp !== "" && <span className="pill interactive" onClick={() => setTypedTp("")}>clear</span>}
            </span>
          </div>
          <div className="row">
            <span className="k">RISK $</span>
            <span className="v ord-field">
              <input className="ord-in" value={risk ?? ""} onChange={(e) => setRisk(e.target.value === "" ? "" : Number(e.target.value))} />
              <span className={"ord-hint" + (preview && !preview.withinTolerance ? " warn" : "")}>
                {preview ? `${preview.contracts}c · $${fmt(preview.actualRiskUsd)}${preview.rr != null ? ` · ${preview.rr}R` : ""}` : ""}
              </span>
            </span>
          </div>
          {blocked && <div className="orders-block">{blockMessage(blocked)}</div>}
        </Panel>

        {/* STOP LEVELS — clickable structure on the stop side */}
        <Panel title="STOP LEVELS" right={side === "buy" ? "lows below" : "highs above"}>
          {stopOptions.length ? stopOptions.map((o, i) => (
            <div key={i} className={"ord-pick" + (sameNum(typedStop, o.stopPrice) ? " sel" : "")} onClick={() => setTypedStop(String(o.stopPrice))}>
              <span className="nm">{formatStopSource(o.kind)}</span>
              <span className="lv">{fmt(o.levelPrice)}</span>
              <span className="ar">stop</span>
              <span className="sp">{fmt(o.stopPrice)}</span>
            </div>
          )) : <div className="ord-empty">no structure on the stop side — type a stop</div>}
        </Panel>

        {/* TARGET DRAWS — clickable untaken draws on the target side */}
        <Panel title="TARGET DRAWS" right={side === "buy" ? "above" : "below"}>
          {tpDraws.length ? tpDraws.map((d, i) => (
            <div key={i} className={"ord-pick" + (sameNum(typedTp, d.price) ? " sel" : "")} onClick={() => setTypedTp(String(d.price))}>
              <span className="nm">{d.name}</span>
              <span className="lv">{fmt(d.price)}</span>
              <span className="ar" />
              <span className="sp">{d.rr != null ? `${d.rr}R` : ""}</span>
            </div>
          )) : <div className="ord-empty">no untaken draws on the target side</div>}
        </Panel>
      </div>

      {/* pinned footer */}
      <div className="orders-foot">
        {!routable && <div className="orders-block">account not routable — confirm an account in Settings</div>}
        <div className="orders-actions">
          <button className={"pill big " + (side === "buy" ? "green" : "red")} disabled={!canPlace} onClick={place}>
            PLACE {side.toUpperCase()}{preview?.contracts >= 1 ? ` ${preview.contracts}c` : ""}
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
        <div className="bt-popover w-660 orders-pop" onClick={(e) => e.stopPropagation()}>
          <div className="head">
            <span className="t">ORDERS · manual ticket</span>
            <span className="spacer" style={{ flex: 1 }} />
            <span className="x" onClick={() => setOpen(false)}>×</span>
          </div>
          <OrdersBody onToast={setToast} toast={toast} symbol={symbol} />
        </div>
      )}
    </div>
  );
}
