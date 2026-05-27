// SETTINGS page — reference 1:1 port (2026-05-27).
// Mirrors ai-trading-agent/apps/trading-terminal/workstation/settings.jsx.
// Persists via localStorage under workstation:* keys.

import React, { useState } from "react";
import { Panel, Row } from "./Shared.jsx";

function getLS(k, fallback) {
  try {
    const v = localStorage.getItem(k);
    return v == null ? fallback : JSON.parse(v);
  } catch (e) { return fallback; }
}

function setLS(k, v) {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {}
}

function Toggle({ on, onChange }) {
  return (
    <div className={"sw" + (on ? " on" : "")} onClick={() => onChange(!on)}>
      <span className="knob"></span>
    </div>
  );
}

function SettingsPage() {
  const [rDollars,     setR]        = useState(getLS("workstation:rDollars", 100));
  const [defaultSym,   setSym]      = useState(getLS("workstation:defaultSymbol", "MNQ1!"));
  const [soundAlert,   setSoundA]   = useState(getLS("workstation:soundAlert", true));
  const [soundNews,    setSoundN]   = useState(getLS("workstation:soundNews",  true));
  const [soundTrade,   setSoundT]   = useState(getLS("workstation:soundTrade", false));
  const [showFields,   setShow]     = useState(getLS("workstation:showFieldNames", false));

  const persist = (k, setter) => (v) => { setLS(k, v); setter(v); };

  return (
    <div className="work-scroll" style={{ width: "100%" }}>
      <Panel title="TRADING" meta="user-set">
        <div className="row-act">
          <Row k="1 R" v={"$ " + rDollars} />
          <div className="row-act-btns">
            <input className="risk-input" type="number" value={rDollars}
                   onChange={(e) => persist("workstation:rDollars", setR)(Math.max(0, Number(e.target.value) || 0))} />
          </div>
        </div>
        <Row k="Daily loss limit" v={`-2 R = - $ ${rDollars * 2} · hard rule (read-only)`} tone="dim" />
        <div className="row-act">
          <Row k="Default symbol" v={defaultSym} />
          <div className="row-act-btns">
            <select className="risk-input"
                    style={{ width: "auto" }}
                    value={defaultSym}
                    onChange={(e) => persist("workstation:defaultSymbol", setSym)(e.target.value)}>
              <option>MNQ1!</option>
              <option>MES1!</option>
            </select>
          </div>
        </div>
      </Panel>

      <Panel title="INTERFACE">
        <Row k="Theme" v="dark / light toggle in top bar" tone="dim" />
        <div className="row-act">
          <Row k="Sound · alert fire" v={soundAlert ? "on" : "off"} />
          <div className="row-act-btns">
            <Toggle on={soundAlert} onChange={persist("workstation:soundAlert", setSoundA)} />
          </div>
        </div>
        <div className="row-act">
          <Row k="Sound · news fire" v={soundNews ? "on" : "off"} />
          <div className="row-act-btns">
            <Toggle on={soundNews} onChange={persist("workstation:soundNews", setSoundN)} />
          </div>
        </div>
        <div className="row-act">
          <Row k="Sound · trade event" v={soundTrade ? "on" : "off"} />
          <div className="row-act-btns">
            <Toggle on={soundTrade} onChange={persist("workstation:soundTrade", setSoundT)} />
          </div>
        </div>
      </Panel>

      <Panel title="DEV" meta="toggles · for testing">
        <div className="row-act">
          <Row k="Show field names inline" v={showFields ? "on" : "off"} />
          <div className="row-act-btns">
            <Toggle on={showFields} onChange={persist("workstation:showFieldNames", setShow)} />
          </div>
        </div>
      </Panel>
    </div>
  );
}

export { SettingsPage };
