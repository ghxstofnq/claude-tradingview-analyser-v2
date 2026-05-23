// PREP mode workstation — Morning Brief.

import React from "react";
import { Panel, Row, Grade, PillarsPanel } from "./Shared.jsx";

function PrepWorkstation({ alerts, onToggleArm }) {
  const armed = alerts?.armed || {};
  const fired = alerts?.fired || [];
  const htf = [
    { tf: "DAILY", bias: "BULLISH", note: "uptrend intact · PDH untaken" },
    { tf: "4H",    bias: "BULLISH", note: "discount → premium leg, FVG @ 21512" },
    { tf: "1H",    bias: "BULLISH", note: "BoS overnight · pulling from ONL" },
  ];

  const overnight = [
    { k: "Asia range",      v: "21458.75 — 21496.50" },
    { k: "London range",    v: "21471.50 — 21516.00" },
    { k: "London swept",    v: "ONL @ 21471.50",      tone: "amber" },
    { k: "Direction overnight", v: "+0.34 %",         tone: "green" },
  ];

  const levels = [
    { name: "PWH",  px: "21 561.25", state: "untaken", marker: "─" },
    { name: "PDH",  px: "21 528.50", state: "untaken", marker: "─" },
    { name: "ONH",  px: "21 516.00", state: "untaken", marker: "·" },
    { name: "ONL",  px: "21 471.50", state: "taken",   marker: "·" },
    { name: "PDL",  px: "21 462.75", state: "untaken", marker: "─" },
    { name: "PWL",  px: "21 398.00", state: "untaken", marker: "─" },
  ];

  const prepPillars = [
    {
      name: "Draw & Bias",
      status: "pass",
      elements: [
        { name: "HTF Draw on liquidity", status: "pass" },
        { name: "Daily / 4H alignment",  status: "pass" },
        { name: "Overnight context",     status: "pass" },
      ],
    },
    {
      name: "Price-Action Quality",
      status: "weak",
      elements: [
        { name: "Range clarity",        status: "pass" },
        { name: "Premium / discount",   status: "weak" },
        { name: "Liquidity build-up",   status: "pass" },
      ],
    },
    {
      name: "Entry Model + Confirmation",
      status: "pending",
      elements: [
        { name: "Entry model identified", status: "pending" },
        { name: "Confirmation",          status: "pending" },
      ],
    },
  ];

  return (
    <div className="work-scroll">
      <Panel title="MORNING BRIEF · NY AM · MON MAY 25"
             right="08:55 ET · 35m to open">
        <div style={{ color: "var(--prose)", fontSize: 11.5, lineHeight: 1.55 }}>
          HTF aligned long. Asia held; London swept ONL then pushed back. Pre-market
          drifting toward PDH — expect a sweep of <em style={{color:"var(--amber)", fontStyle:"normal"}}>21 528.50</em>{" "}
          or a discount pull to <em style={{color:"var(--amber)", fontStyle:"normal"}}>21 471.50</em>. Trade plan: <strong style={{color:"var(--value-strong)"}}>long off discount</strong>, MSS / Trend continuation.
        </div>
      </Panel>

      <Panel title="HTF BIAS">
        {htf.map((r) => (
          <div className="row" key={r.tf} style={{ alignItems: "flex-start" }}>
            <span className="k" style={{ minWidth: 50 }}>{r.tf}</span>
            <span className="v" style={{ flex: 1, textAlign: "left", paddingLeft: 14 }}>
              <span className="v green" style={{ letterSpacing: ".1em", marginRight: 10 }}>
                {r.bias}
              </span>
              <span style={{ color: "var(--label)", fontSize: 11 }}>{r.note}</span>
            </span>
          </div>
        ))}
      </Panel>

      <Panel title="OVERNIGHT CONTEXT">
        {overnight.map((r) => <Row key={r.k} k={r.k} v={r.v} tone={r.tone} />)}
      </Panel>

      <section className="panel">
        <header className="panel-head">
          <span className="title">KEY LEVELS</span>
          <span className="meta">PWH / PDH / ONH / ONL / PDL / PWL</span>
        </header>
        <div className="panel-body flush">
          {levels.map((lv) => {
            const isArmed = !!armed[lv.name];
            const isFired = fired.some((f) => f.name === lv.name);
            return (
              <div className="level-row" key={lv.name}>
                <span className="marker">{lv.marker}</span>
                <span className="name">{lv.name}</span>
                <span className="price">{lv.px}</span>
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span className={"state " + lv.state}>{lv.state.toUpperCase()}</span>
                  <span className={"bell" + (isFired ? " fired" : isArmed ? " armed" : "")}
                        title={isFired ? "alert fired" : isArmed ? "alert armed — click to disarm" : "set alert"}
                        onClick={() => onToggleArm && onToggleArm(lv.name, lv.px)}>
                    {isFired ? "◉" : isArmed ? "●" : "○"}
                  </span>
                </span>
              </div>
            );
          })}
        </div>
      </section>

      <section className="panel">
        <header className="panel-head">
          <span className="title">PRE-SESSION GRADE</span>
          <span className="meta">
            PILLARS 1 + 2 · <Grade value="B" />
          </span>
        </header>
        <div className="panel-body flush">
          <PillarsPanel pillars={prepPillars} />
        </div>
      </section>

      <Panel title="CLAUDE · PLAN FOR THE OPEN">
        <div style={{ color: "var(--value)", fontSize: 11.5, lineHeight: 1.6 }}>
          Watch the first 15 min for the open reaction at{" "}
          <em style={{color:"var(--amber)", fontStyle:"normal"}}>21 471.50</em>{" "}
          (ONL). A sharp rejection up reads as HTF/LTF aligned → A+ potential
          long off MSS toward <em style={{color:"var(--amber)", fontStyle:"normal"}}>21 528.50</em>{" "}
          (PDH). Continuation through ONL flips this to a retrace day —
          no-trade unless a clean B reclaim forms.
        </div>
        <div className="hr" />
        <Row k="Anchored target" v="21 528.50 (PDH)" tone="num green" />
        <Row k="Anchored stop"   v="21 462.75 (PDL)" tone="num red" />
        <Row k="Sizing if A+ today" v="0.75 R · Mon-reduced" />
      </Panel>

      <section className="panel">
        <header className="panel-head">
          <span className="title">PRICE ALERTS</span>
          <span className="meta">
            <span style={{ color: "var(--green)" }}>{fired.length} fired</span>
            {" · "}
            <span style={{ color: "var(--amber)" }}>{Object.keys(armed).length} armed</span>
          </span>
        </header>
        <div className="panel-body flush">
          {fired.length === 0 && Object.keys(armed).length === 0 && (
            <div className="empty-state" style={{ padding: "14px" }}>
              <div style={{ color: "var(--label)", fontSize: 11 }}>no alerts armed</div>
              <div className="sub">click the ○ on any key level above to arm one</div>
            </div>
          )}
          {fired.length > 0 && (
            <div className="alerts-feed">
              {fired.map((a, i) => (
                <div className="alert-entry" key={i}>
                  <span className="when">{a.t}</span>
                  <span className="what">
                    <b>{a.name}</b> @ <span className="px">{a.px}</span> — {a.note || "price level reached"}
                  </span>
                  <span style={{ color: "var(--green)", fontSize: 9, letterSpacing: ".1em" }}>FIRED</span>
                </div>
              ))}
            </div>
          )}
          {Object.keys(armed).length > 0 && (
            <>
              <div style={{
                padding: "4px 14px",
                fontSize: 9.5, letterSpacing: ".18em",
                color: "var(--label)",
                borderTop: fired.length ? "1px solid var(--border-dim)" : "",
                background: "var(--surface-1)",
              }}>
                ARMED · WATCHING
              </div>
              {Object.entries(armed).map(([name, px]) => (
                <div className="alert-entry" key={name}>
                  <span className="when">—</span>
                  <span className="what">
                    <b>{name}</b> @ <span className="px">{px}</span>
                  </span>
                  <span style={{ color: "var(--amber)", fontSize: 9, letterSpacing: ".1em" }}>ARMED</span>
                </div>
              ))}
            </>
          )}
        </div>
      </section>
    </div>
  );
}

export { PrepWorkstation };
