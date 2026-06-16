// app/renderer/src/OrdersPopover.jsx
// ORDERS — manual market-order ticket. Sizes from the per-trade risk in Settings
// + live ICT structure; auto-picks the stop (typed/dropdown override); TP from
// untaken session/PD/PW draws; shows R:R + current position; places to the
// confirmed account; one-tap Flatten. All math in main (execution:order*).
import React, { useState, useEffect, useRef, useCallback } from "react";
import { executionAdapter } from "./execution/executionAdapter.js";
import { formatDrawOption, formatStopSource, routingLabel, blockMessage } from "./Orders.helpers.js";

const fmt = (n) => (n == null || !Number.isFinite(Number(n)) ? "—" : Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 }));

function OrdersBody({ onToast }) {
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

  const loadContext = useCallback(async (refresh = false) => {
    const r = await executionAdapter.orderContext({ refresh });
    if (r?.ok) setCtx(r.context);
  }, []);

  // on mount: context + account gate + risk default + position
  useEffect(() => {
    loadContext(false);
    window.api?.execution?.account?.get?.().then((r) => { if (r?.ok) setAcct(r); });
    window.api?.execution?.config?.get?.().then((r) => { if (r?.ok) setRisk(r.config?.guards?.defaultRisk ?? 120); });
  }, [loadContext]);

  // poll position
  useEffect(() => {
    let live = true;
    const tick = async () => { const r = await executionAdapter.state(); if (live && r?.ok) setPos(r.state?.position ?? null); };
    tick(); const id = setInterval(tick, 2000);
    return () => { live = false; clearInterval(id); };
  }, []);

  // recompute preview (debounced) whenever inputs change and a context exists
  useEffect(() => {
    if (!ctx || risk == null) return;
    clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      const r = await executionAdapter.orderPreview({
        side,
        typedStop: typedStop === "" ? null : Number(typedStop),
        typedTp: typedTp === "" ? null : Number(typedTp),
        riskUsd: Number(risk),
      });
      if (r?.ok) setPreview(r.preview);
    }, 150);
    return () => clearTimeout(debounce.current);
  }, [ctx, side, typedStop, typedTp, risk]);

  const place = async () => {
    setBusy(true);
    try {
      const r = await executionAdapter.placeManual({
        side,
        typedStop: typedStop === "" ? null : Number(typedStop),
        typedTp: typedTp === "" ? null : Number(typedTp),
        riskUsd: Number(risk),
      });
      onToast(r?.ok ? `ORDER SENT · ${side.toUpperCase()} ${preview?.contracts}c ${ctx?.symbol}` : `BLOCKED · ${r?.code ? blockMessage(r.code) : (r?.message || r?.error || "rejected")}`);
    } finally { setBusy(false); }
  };
  const flatten = async () => {
    const r = await executionAdapter.flatten({ symbol: ctx?.symbol });
    onToast(r?.ok ? `FLATTEN SENT · ${ctx?.symbol}` : `FLATTEN FAILED · ${r?.error || ""}`);
  };

  const routable = acct?.gate?.route === true;
  const blocked = preview?.block;
  const canPlace = routable && !blocked && !busy && preview?.contracts >= 1;

  return (
    <div className="orders-body">
      {/* position line */}
      <div className="orders-pos">
        {pos ? (
          <span>{pos.side?.toUpperCase()} {pos.qty} {pos.symbol} @ {fmt(pos.avgFill)} · uPnL {pos.uPnlUsd != null ? `$${fmt(pos.uPnlUsd)}` : "—"}</span>
        ) : <span className="dim">flat</span>}
      </div>

      {/* symbol + routing */}
      <div className="orders-row">
        <span className="lbl">SYMBOL</span>
        <span className="val">{ctx?.symbol ?? "—"}{ctx?.stale ? <span className="warn"> · structure stale</span> : null}</span>
        <span className="spacer" />
        <span className={"route " + (routable ? "ok" : "bad")}>{routingLabel(acct || {})}</span>
        <span className="pill ghost" onClick={() => loadContext(true)}>↻</span>
      </div>

      {/* side */}
      <div className="orders-row">
        <span className="lbl">SIDE</span>
        <span className={"pill " + (side === "buy" ? "on green" : "")} onClick={() => setSide("buy")}>BUY</span>
        <span className={"pill " + (side === "sell" ? "on red" : "")} onClick={() => setSide("sell")}>SELL</span>
        <span className="spacer" />
        <span className="lbl">PRICE</span><span className="val">{fmt(ctx?.price)}</span>
      </div>

      {/* stop */}
      <div className="orders-row">
        <span className="lbl">STOP</span>
        <input className="num" placeholder={preview?.stopAuto ? String(preview.stopAuto.price) : "type stop"} value={typedStop} onChange={(e) => setTypedStop(e.target.value)} />
        <select className="sel" value="" onChange={(e) => { if (e.target.value !== "") setTypedStop(e.target.value); }}>
          <option value="">{preview?.stopSource ? `auto: ${formatStopSource(preview.stopSource)} ${fmt(preview.stop)}` : "pick level…"}</option>
          {(preview?.stopOptions ?? []).map((o, i) => (
            <option key={i} value={o.stopPrice}>{formatStopSource(o.kind)} {fmt(o.levelPrice)} → {fmt(o.stopPrice)}</option>
          ))}
        </select>
        {typedStop !== "" && <span className="pill ghost" onClick={() => setTypedStop("")}>auto</span>}
      </div>

      {/* tp */}
      <div className="orders-row">
        <span className="lbl">TP</span>
        <input className="num" placeholder="optional" value={typedTp} onChange={(e) => setTypedTp(e.target.value)} />
        <select className="sel" value="" onChange={(e) => { if (e.target.value !== "") setTypedTp(e.target.value); }}>
          <option value="">pick draw…</option>
          {(preview?.tpDraws ?? []).map((d, i) => (
            <option key={i} value={d.price}>{formatDrawOption(d)}</option>
          ))}
        </select>
        {typedTp !== "" && <span className="pill ghost" onClick={() => setTypedTp("")}>clear</span>}
      </div>

      {/* risk + size + rr */}
      <div className="orders-row">
        <span className="lbl">RISK $</span>
        <input className="num" value={risk ?? ""} onChange={(e) => setRisk(e.target.value === "" ? "" : Number(e.target.value))} />
        <span className="spacer" />
        <span className="lbl">SIZE</span>
        <span className={"val " + (preview?.withinTolerance ? "" : "warn")}>{preview?.contracts ?? "—"}c · ${fmt(preview?.actualRiskUsd)}</span>
        <span className="lbl">R:R</span><span className="val">{preview?.rr != null ? `${preview.rr}R` : "—"}</span>
      </div>

      {/* block banner */}
      {blocked && <div className="orders-block">{blockMessage(blocked)}</div>}
      {!routable && <div className="orders-block">Account not routable — confirm an account in Settings.</div>}

      {/* actions */}
      <div className="orders-actions">
        <button className={"pill big " + (side === "buy" ? "green" : "red")} disabled={!canPlace} onClick={place}>
          PLACE {side.toUpperCase()}{preview?.contracts >= 1 ? ` ${preview.contracts}c` : ""}
        </button>
        <button className="pill big" disabled={!pos} onClick={flatten}>FLATTEN</button>
      </div>
    </div>
  );
}

export function OrdersCell() {
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
         onClick={(e) => { if (e.target.closest(".bt-popover")) return; setOpen((o) => !o); }}>
      <span className="k">ORDERS</span>
      {open && (
        <div className="bt-popover w-660 orders-pop" onClick={(e) => e.stopPropagation()}>
          <div className="head">
            <span className="t">ORDERS · manual ticket</span>
            <span className="spacer" style={{ flex: 1 }} />
            <span className="x" onClick={() => setOpen(false)}>×</span>
          </div>
          <div className="body">
            <OrdersBody onToast={setToast} />
            {toast && <div className="orders-toast">{toast}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
