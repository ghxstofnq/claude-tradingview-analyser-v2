// Shared terminal components: Panel, Row, Grade, Pillars, SetupCard,
// TradeCard, ClaudeFeed, etc.

import React, { useState, useEffect, useRef } from "react";

// ---------- Panel ----------
function Panel({ title, meta, right, children, flush }) {
  return (
    <section className="panel">
      <header className="panel-head">
        <span className="title">{title}</span>
        <span className="meta">{right || meta}</span>
      </header>
      <div className={"panel-body" + (flush ? " flush" : "")}>{children}</div>
    </section>
  );
}

function SectionHead({ title, count }) {
  return (
    <div className="section-head">
      <span className="t">{title}</span>
      {count !== undefined && <span className="ct">{count}</span>}
    </div>
  );
}

// ---------- Row ----------
function Row({ k, v, tone, mono = true }) {
  const cls = "v" + (tone ? " " + tone : "") + (mono ? "" : "");
  return (
    <div className="row">
      <span className="k">{k}</span>
      <span className={cls}>{v}</span>
    </div>
  );
}

// ---------- Grade badge ----------
function Grade({ value, large }) {
  const map = {
    "A+": "a-plus", "B": "b", "no-trade": "no-trade",
  };
  const cls = "grade " + (map[value] || "pending") + (large ? " large" : "");
  return <span className={cls}>{value}</span>;
}

// ---------- Pillar panel ----------
function PillarsPanel({ pillars, expanded = true }) {
  // pillars: [{ name, status, elements: [{name, status}] }]
  return (
    <div className="pillars">
      {pillars.map((p, i) => (
        <div className="pillar" key={i}>
          <div className="ptitle">PILLAR {i + 1}</div>
          <div className="pname">{p.name}</div>
          <div className={"pillar-status " + p.status}>
            <span className="ind"></span>
            <span>{p.status.toUpperCase()}</span>
          </div>
          {expanded && (
            <div className="elements">
              {p.elements.map((e, j) => (
                <div className={"element " + e.status} key={j}>
                  <span className="name">{e.name}</span>
                  <span className="mark">
                    {e.status === "pass" ? "✓"
                      : e.status === "weak" ? "~"
                      : e.status === "fail" ? "✗"
                      : "·"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------- Setup card ----------
function SetupCard({ setup, onAccept, onReject, featured }) {
  const variant =
    setup.grade === "A+" ? "featured" :
    setup.grade === "B" ? "b" : "";
  return (
    <div className={"setup-card " + variant + (featured ? " featured" : "")}>
      <div className="sc-head">
        <Grade value={setup.grade} />
        {setup.tf && (
          <span style={{
            display: "inline-block",
            border: "1px solid var(--border)",
            color: "var(--label)",
            fontSize: 9.5,
            letterSpacing: ".12em",
            padding: "1px 6px",
            marginLeft: 6,
            borderRadius: 2,
          }} title={`Fired on ${setup.tf} bar close`}>
            {setup.tf.toUpperCase()}
          </span>
        )}
        <span className="label">{setup.label || "ACTIVE SETUP"}</span>
        <span className="age">{setup.age}</span>
      </div>
      <div className="sc-body">
        <Row k="Model" v={setup.model} />
        <Row k="Side"
             v={<span className={setup.side === "long" ? "v green" : "v red"}>
                 {setup.side.toUpperCase()}
               </span>} />
        <Row k="Entry" v={setup.entry} tone="num" />
        <Row k="Stop"  v={setup.stop}  tone="num red" />
        <Row k="TP1"   v={setup.tp1}   tone="num green" />
        <Row k="TP2"   v={setup.tp2}   tone="num green" />
        <Row k="Invalidation" v={setup.invalidation} tone="num red" />
        <Row k="R : R" v={setup.rr} tone="num" />
      </div>
      <div className="sc-foot">
        <span className={"conf " + (setup.confirmed ? "confirmed" : "pending")}>
          <span className="dot"></span>
          {setup.confirmed ? `CONFIRMED · ${setup.confirmAge}` : `AWAITING CONFIRMATION`}
        </span>
        <span className="sc-actions">
          <button className="btn reject" onClick={onReject}>REJECT</button>
          <button className="btn accept" onClick={onAccept}>ACCEPT</button>
        </span>
      </div>
    </div>
  );
}

// ---------- Journal snapshot mini-chart ----------
// A tiny SVG candle chart that stands in for a captured chart image.
// Deterministic per setup id so identical setups render the same picture.
function Snapshot({ id = "setup", side = "long", entry, stop, tp1, tp2, w = 124, h = 64, full = false }) {
  // simple seeded RNG
  let s = 0;
  for (let i = 0; i < id.length; i++) s = (s * 31 + id.charCodeAt(i)) | 0;
  const rand = () => {
    s = (s * 1664525 + 1013904223) | 0;
    return ((s >>> 0) % 1000) / 1000;
  };
  const n = full ? 64 : 22;
  const bars = [];
  let last = 50;
  for (let i = 0; i < n; i++) {
    const drift = (rand() - 0.5) * 6;
    const trendBias = side === "long" ? (i > n / 3 ? 1.4 : -1.2) : (i > n / 3 ? -1.4 : 1.2);
    const o = last;
    const c = o + drift + trendBias;
    const hi = Math.max(o, c) + rand() * 3;
    const lo = Math.min(o, c) - rand() * 3;
    bars.push({ o, c, hi, lo });
    last = c;
  }
  let lo = Infinity, hi = -Infinity;
  for (const b of bars) { if (b.lo < lo) lo = b.lo; if (b.hi > hi) hi = b.hi; }
  lo -= 3; hi += 3;
  const padR = full ? 78 : 0;
  const padL = full ? 8 : 0;
  const padT = full ? 18 : 4;
  const padB = full ? 22 : 4;
  const innerW = w - padL - padR;
  const innerH = h - padT - padB;
  const cw = Math.max(1.5, innerW / n * 0.75);
  const xFor = (i) => padL + i * (innerW / n) + (innerW / n) / 2;
  const yFor = (v) => padT + innerH - ((v - lo) / (hi - lo)) * innerH;

  // entry line near middle of move
  const entryY = padT + innerH * 0.62;
  const stopY  = side === "long" ? entryY + innerH * 0.22 : entryY - innerH * 0.22;
  const tp1Y   = side === "long" ? entryY - innerH * 0.32 : entryY + innerH * 0.32;
  const tp2Y   = side === "long" ? entryY - innerH * 0.55 : entryY + innerH * 0.55;

  const lblFont = full ? 11 : 8.5;

  return (
    <div className="snapshot" style={{ width: w, height: h }}>
      <svg width={w} height={h}>
        {full && (
          <g>
            {[0, 0.25, 0.5, 0.75, 1].map((p, i) => (
              <line key={i} x1={padL} x2={padL + innerW}
                    y1={padT + innerH * p} y2={padT + innerH * p}
                    style={{ stroke: "var(--snap-grid)" }} />
            ))}
          </g>
        )}
        {bars.map((b, i) => {
          const up = b.c >= b.o;
          const x = xFor(i);
          const strokeVar = up ? "var(--candle-up-stroke)" : "var(--candle-down-stroke)";
          const fillVar = up ? "var(--candle-up-fill)" : "var(--candle-down-fill)";
          return (
            <g key={i}>
              <line x1={x} x2={x} y1={yFor(b.hi)} y2={yFor(b.lo)}
                    style={{ stroke: strokeVar }} strokeWidth="1" />
              <rect x={x - cw/2} y={Math.min(yFor(b.o), yFor(b.c))} width={cw}
                    height={Math.max(1, Math.abs(yFor(b.o) - yFor(b.c)))}
                    style={{ fill: fillVar, stroke: strokeVar }} />
            </g>
          );
        })}
        {/* entry / stop / tp lines */}
        <line x1={padL} x2={padL + innerW} y1={entryY} y2={entryY}
              style={{ stroke: "var(--amber)" }} strokeDasharray="2 3" opacity="0.95" />
        <line x1={padL} x2={padL + innerW} y1={stopY}  y2={stopY}
              style={{ stroke: "var(--red)" }} strokeDasharray="2 3" opacity="0.85" />
        <line x1={padL} x2={padL + innerW} y1={tp1Y}   y2={tp1Y}
              style={{ stroke: "var(--green)" }} strokeDasharray="2 3" opacity="0.85" />
        {full && tp2 && (
          <line x1={padL} x2={padL + innerW} y1={tp2Y} y2={tp2Y}
                style={{ stroke: "var(--green)" }} strokeDasharray="2 3" opacity="0.7" />
        )}

        {full && (
          <g fontFamily="ui-monospace, Menlo, monospace">
            <rect x={padL + innerW + 4} y={entryY - 9} width={70} height={18}
                  style={{ fill: "var(--snap-label-bg)", stroke: "var(--amber)" }} />
            <text x={padL + innerW + 9} y={entryY + 4} fontSize={lblFont}
                  style={{ fill: "var(--amber)", letterSpacing: "0.04em" }}>E {entry}</text>
            <rect x={padL + innerW + 4} y={stopY - 9} width={70} height={18}
                  style={{ fill: "var(--snap-label-bg)", stroke: "var(--red)" }} />
            <text x={padL + innerW + 9} y={stopY + 4} fontSize={lblFont}
                  style={{ fill: "var(--red)", letterSpacing: "0.04em" }}>S {stop}</text>
            <rect x={padL + innerW + 4} y={tp1Y - 9} width={70} height={18}
                  style={{ fill: "var(--snap-label-bg)", stroke: "var(--green)" }} />
            <text x={padL + innerW + 9} y={tp1Y + 4} fontSize={lblFont}
                  style={{ fill: "var(--green)", letterSpacing: "0.04em" }}>T1 {tp1}</text>
            {tp2 && (<>
              <rect x={padL + innerW + 4} y={tp2Y - 9} width={70} height={18}
                    style={{ fill: "var(--snap-label-bg)", stroke: "var(--green)" }} />
              <text x={padL + innerW + 9} y={tp2Y + 4} fontSize={lblFont}
                    style={{ fill: "var(--green)", letterSpacing: "0.04em" }}>T2 {tp2}</text>
            </>)}
          </g>
        )}
      </svg>
      {!full && <span className="label">SNAPSHOT</span>}
    </div>
  );
}

// ---------- Snapshot fullscreen viewer ----------
function SnapshotFullscreen({ trade, onClose }) {
  const wrapRef = useRef(null);
  const [size, setSize] = useState({ w: 900, h: 600 });
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  useEffect(() => {
    const el = wrapRef.current; if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize({ w: Math.max(400, r.width - 56), h: Math.max(300, r.height - 56) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div className="snap-full">
      <div className="snap-full-bar">
        <span className="title">JOURNAL SNAPSHOT</span>
        <span className="sep">·</span>
        <span className="id">#{trade.id}</span>
        <span className="sep">·</span>
        <Grade value={trade.grade} />
        <span className={"side " + trade.side}>{trade.side.toUpperCase()}</span>
        <span className="sep">·</span>
        <span className="model">{trade.model}</span>
        <span className="when">captured {trade.taken}</span>
        <span className="esc-hint">press<b>ESC</b>or</span>
        <span className="x" onClick={onClose}>×</span>
      </div>
      <div className="snap-full-body">
        <div className="snap-full-canvas" ref={wrapRef}>
          <span className="stamp">
            <b>{trade.id}</b> · SNAPSHOT · 1m · MNQ1!
          </span>
          <Snapshot id={trade.id} side={trade.side}
                    entry={trade.entry} stop={trade.stop}
                    tp1={trade.tp1} tp2={trade.tp2}
                    w={size.w} h={size.h} full />
          <span className="ts">captured {trade.taken}</span>
        </div>
        <div className="snap-full-side">
          <Panel title="TRADE">
            <Row k="Side" v={<span className={trade.side === "long" ? "v green" : "v red"}>
                              {trade.side.toUpperCase()}
                            </span>} />
            <Row k="Model" v={trade.model} />
            <Row k="Entry" v={trade.entry} tone="num" />
            <Row k="Stop" v={trade.stop} tone="num red" />
            <Row k="TP1" v={trade.tp1} tone="num green" />
            <Row k="TP2" v={trade.tp2} tone="num green" />
            <Row k="R : R" v={trade.rr} tone="num" />
            <Row k="Size" v={trade.size} />
            <Row k="R risked" v={trade.risk} />
          </Panel>
          <Panel title="OUTCOME">
            <Row k="P / L" v={trade.pnl}
                 tone={trade.pnlPositive ? "green" : trade.pnlNegative ? "red" : ""} />
            <Row k="Status" v={
              <span className={"outcome " + trade.outcome} style={{ letterSpacing: ".12em" }}>
                {trade.outcomeLabel}
              </span>
            } />
            <Row k="Note" v={trade.statusNote} tone="dim" />
          </Panel>
          <Panel title="NOTES">
            <div style={{ color: "var(--prose)", fontSize: 11.5, lineHeight: 1.6 }}>
              Snapshots are a human memory aid only. They are never fed back
              into Claude's analysis — they exist so future-you can see what
              past-you saw at the moment of the trade.
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

// ---------- Taken-trade card ----------
function TradeCard({ trade, showSnapshot = true }) {
  const [fullscreen, setFullscreen] = useState(false);
  return (
    <div className={"trade-card " + trade.side}>
      <div className="tc-head">
        <span className="id">#{trade.id}</span>
        <Grade value={trade.grade} />
        <span className={"side " + trade.side}>{trade.side.toUpperCase()}</span>
        <span style={{ color: "var(--label)", fontSize: 9.5, letterSpacing: ".1em" }}>
          {trade.model}
        </span>
        <span className="when">{trade.taken}</span>
      </div>
      <div className="tc-body">
        <Row k="Entry" v={trade.entry} tone="num" />
        <Row k="Size" v={trade.size} />
        <Row k="Stop" v={trade.stop} tone="num red" />
        <Row k="R risked" v={trade.risk} />
        <Row k="TP1" v={trade.tp1} tone="num green" />
        <Row k="TP2" v={trade.tp2} tone="num green" />
        <Row k="R:R" v={trade.rr || "3.1"} tone="num" />
        <Row k="P / L" v={trade.pnl} tone={trade.pnlPositive ? "green" : trade.pnlNegative ? "red" : ""} />
      </div>
      {showSnapshot && (
        <div className="snapshot-row">
          <Snapshot id={trade.id}
                    side={trade.side}
                    entry={trade.entry}
                    stop={trade.stop}
                    tp1={trade.tp1} />
          <div className="meta" style={{ flex: 1 }}>
            <div>
              <div className="title">JOURNAL SNAPSHOT</div>
              <div style={{ color: "var(--prose)", fontSize: 10.5, letterSpacing: 0, marginTop: 4 }}>
                Captured at entry · {trade.taken}
              </div>
            </div>
            <div className="view" onClick={() => setFullscreen(true)}>[ VIEW FULL ]</div>
          </div>
        </div>
      )}
      <div className="tc-status">
        <span className={"outcome " + trade.outcome}>
          {trade.outcomeLabel}
        </span>
        <span style={{ color: "var(--label)", fontSize: 9.5, letterSpacing: ".06em" }}>
          {trade.statusNote}
        </span>
      </div>
      {fullscreen && (
        <SnapshotFullscreen trade={trade} onClose={() => setFullscreen(false)} />
      )}
    </div>
  );
}

// ---------- Claude conversation feed ----------
function ClaudeFeed({ messages, typing, onSubmit, onArmPrice, armedPrices, firedPrices, onCancel, onReset }) {
  const feedRef = useRef(null);
  const [input, setInput] = useState("");
  useEffect(() => {
    const el = feedRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, typing]);

  // Delegated click handler: clicking a price <em> in Claude's prose arms
  // an alert. Hover styling tells the user the price is interactive.
  useEffect(() => {
    if (!onArmPrice) return;
    const el = feedRef.current;
    if (!el) return;
    const handler = (e) => {
      const target = e.target;
      if (target && target.tagName === "EM") {
        const px = (target.textContent || "").trim();
        if (px) onArmPrice(px, target);
      }
    };
    el.addEventListener("click", handler);
    return () => el.removeEventListener("click", handler);
  }, [onArmPrice]);

  // After each render, mark armed/fired <em> elements so the user can see
  // which prices already have an alert on them.
  useEffect(() => {
    const el = feedRef.current;
    if (!el) return;
    const ems = el.querySelectorAll(".claude-msg .body em");
    ems.forEach((em) => {
      const px = (em.textContent || "").trim();
      em.classList.toggle("armed", !!armedPrices && armedPrices.has(px));
      em.classList.toggle("fired", !!firedPrices && firedPrices.has(px));
    });
  });

  const submit = () => {
    if (!input.trim()) return;
    onSubmit && onSubmit(input.trim());
    setInput("");
  };
  return (
    <div className="claude">
      <div className="claude-feed" ref={feedRef}>
        {messages.map((m, i) => (
          <div key={i} className={"claude-msg " + m.type}>
            <div className="head">
              <span className="who">
                {m.type === "bar-read" ? "BAR-CLOSE · CLAUDE" :
                 m.type === "reply" ? "CLAUDE" : "YOU"}
              </span>
              <span>{m.t}</span>
            </div>
            <div className="body" dangerouslySetInnerHTML={{ __html: m.body }} />
          </div>
        ))}
        {typing && (
          <div className="claude-msg reply">
            <div className="head">
              <span className="who">CLAUDE</span>
              <span>now</span>
            </div>
            <div className="body">
              <span className="typing"><i></i><i></i><i></i></span>
            </div>
          </div>
        )}
      </div>
      <form className="claude-compose"
            onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <span className="prompt">&gt;</span>
        <input value={input} onChange={(e) => setInput(e.target.value)}
               placeholder={onArmPrice ? "ask claude… (click any price to arm an alert)" : "ask claude…"} />
        <span className="caret"></span>
      </form>
      {/* Compact controls: STOP appears only while Claude is mid-turn
          (kill switch). RESET is always available and starts the chat
          conversation fresh. Both call IPC handlers in main. */}
      {(onCancel || onReset) && (
        <div style={{
          display: "flex", justifyContent: "flex-end", gap: 8,
          padding: "4px 12px 8px",
        }}>
          {typing && onCancel && (
            <button onClick={onCancel}
                    title="abort Claude's current turn"
                    style={{
                      background: "transparent",
                      border: "1px solid var(--red, #f0796a)",
                      color: "var(--red, #f0796a)",
                      padding: "2px 10px",
                      fontFamily: "ui-monospace, Menlo, monospace",
                      fontSize: 9.5,
                      letterSpacing: ".16em",
                      cursor: "pointer",
                    }}>
              [ STOP ]
            </button>
          )}
          {onReset && (
            <button onClick={onReset}
                    title="clear chat history and start a fresh conversation with Claude"
                    style={{
                      background: "transparent",
                      border: "1px solid var(--border, #2a3038)",
                      color: "var(--label)",
                      padding: "2px 10px",
                      fontFamily: "ui-monospace, Menlo, monospace",
                      fontSize: 9.5,
                      letterSpacing: ".16em",
                      cursor: "pointer",
                    }}>
              [ RESET ]
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ---------- Bracket button alias ----------
function Btn({ kind, children, onClick, sm }) {
  return (
    <button className={"btn" + (kind ? " " + kind : "") + (sm ? " sm" : "")}
            onClick={onClick}>
      {children}
    </button>
  );
}

// ---------- Status-line (footer) ----------
function StatusLine({ phase, killzone, loop, mode, subState, lastBar, sessionsRun }) {
  const loopLabel = { healthy: "HEALTHY", stale: "STALE", down: "DOWN" }[loop];
  const loopTone = { healthy: "green", stale: "amber", down: "red" }[loop];
  return (
    <div className="statusline">
      <span><span className="b">{mode}</span>{subState ? ` · ${subState.toUpperCase()}` : ""}</span>
      <span className="sep">·</span>
      <span><span className="b">{phase}</span></span>
      <span className="sep">·</span>
      <span>KZ <span className="amber">{killzone}</span></span>
      <span className="sep">·</span>
      <span>BAR <span className="b">{lastBar}</span></span>
      <div className="right">
        <span>LOOP <span className={loopTone}>{loopLabel}</span></span>
        <span className="sep">·</span>
        <span>SES {sessionsRun}/3</span>
        <span className="sep">·</span>
        <span>v0.4.1</span>
      </div>
    </div>
  );
}

export {
  Panel, SectionHead, Row, Grade, PillarsPanel,
  SetupCard, TradeCard, ClaudeFeed, Btn, StatusLine, Snapshot,
};
