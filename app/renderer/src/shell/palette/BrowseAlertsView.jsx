// BrowseAlertsView — the palette's alert browser: armed (disarmable) + fired.

import React, { useState } from "react";
import { clickable } from "../../a11y.js";

export function BrowseAlertsView({ armed = [], fired = [], onDisarm }) {
  const [sel, setSel] = useState(0);
  const selA = armed[sel] || null;
  return (
    <div className="cmd-browse">
      <div className="list">
        <div className="cmd-pal-sect">ARMED · {armed.length}</div>
        {armed.map((a, i) => (
          <div key={a.id ?? i} className={"cmd-arow" + (i === sel ? " sel" : "")}
               {...clickable(() => setSel(i))}>
            <span className="d" />
            <span className="nm">{a.name}</span>
            <span className="pr">{a.price}</span>
          </div>
        ))}
        {fired.length > 0 && <div className="cmd-pal-sect">FIRED TODAY · {fired.length}</div>}
        {fired.map((a, i) => (
          <div key={"f" + (a.id ?? i)} className="cmd-arow fired">
            <span className="d" />
            <span className="nm">{a.name}</span>
            <span className="pr">{a.t || a.price}</span>
          </div>
        ))}
      </div>
      {selA ? (
        <div className="detail">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span className="price">{selA.price}</span>
            <span className="badge">ARMED</span>
          </div>
          <span className="sub">{selA.name}</span>
          <div className="facts">
            <span className="k">On fire</span><span className="v">notify + ticket suggestion</span>
            <span className="k">Expires</span><span className="v">session close 16:00 ET</span>
          </div>
          <div className="acts">
            <span className="cmd-disarm" {...clickable(() => onDisarm(selA.id))}>Disarm</span>
          </div>
        </div>
      ) : (
        <div className="none">no armed alerts — type "arm pdh" in a level to create one</div>
      )}
    </div>
  );
}
