// AskView — one-shot "ask Claude" from the palette. Sends the query once on
// open, streams the reply. Below the answer, a row of EVIDENCE chips (one per
// untaken brief key-level) opens a deterministic, real-data evidence card for
// that level — name/price/state/cite/distance + an Arm-alert action. The chips
// are local + real (useSessionBrief); Evidence is NOT a second Claude call.

import React, { useEffect, useRef, useState } from "react";
import { clickable } from "../../a11y.js";
import { useSessionBrief } from "../../hooks/useSessionBrief.js";
import { useLastBar } from "../../hooks/useLastBar.js";
import { armAlertReal } from "../../hooks/useAlerts.js";
import { curateLevel } from "./evidence.helpers.js";

function EvidenceCard({ level, close, onArm }) {
  const e = curateLevel(level, close);
  if (!e) return null;
  return (
    <div className="cmd-ev-card">
      <div className="hd">
        <span className="nm">{e.name}</span>
        <span className="px">{e.price}</span>
        <span className={"st " + (e.state === "untaken" ? "on" : "dim")}>{String(e.state).toUpperCase()}</span>
      </div>
      <div className="rows">
        <div className="r"><span className="k">Distance</span><span className="v">{e.distance != null ? `${e.distance.toFixed(2)} ${e.direction}` : "—"}</span></div>
        {e.cite && <div className="r"><span className="k">Source</span><span className="v cite">{e.cite}</span></div>}
      </div>
      <div className="acts">
        <span className="pill amber interactive" {...clickable(() => onArm(level), { label: `arm alert at ${e.name}` })}>◈ Arm {e.price}</span>
      </div>
    </div>
  );
}

export function AskView({ chat, query, onClose, onToast }) {
  const sentFor = useRef(null);
  const { brief } = useSessionBrief();
  const lastBar = useLastBar();
  const [sel, setSel] = useState(null);

  useEffect(() => {
    if (query && sentFor.current !== query) {
      sentFor.current = query;
      chat.send(query);
    }
  }, [query, chat]);

  const reply = [...(chat.messages || [])].reverse().find((m) => m.type === "reply");
  const streaming = chat.typing;
  const levels = (brief?.key_levels || []).filter((l) => l.state === "untaken" || !l.state);
  const arm = async (l) => {
    const r = await armAlertReal(String(l.price), l.name);
    onToast?.(r?.ok ? `Alert armed · ${l.name} @ ${l.price}` : `Arm failed · ${l.name}`, "amber");
  };

  return (
    <>
      <div className="cmd-pal-input">
        <span className="cmd-pal-head-badge">ASK</span>
        <span style={{ fontSize: 14, color: "var(--value-strong)", flex: 1 }}>{query}</span>
        <span className="cmd-kbd" {...clickable(onClose)}>esc</span>
      </div>
      <div className="cmd-ask">
        <p className="prose">
          {reply ? <span dangerouslySetInnerHTML={{ __html: reply.body }} />
                 : (streaming ? "" : "…")}
          {streaming && <span className="caret" />}
        </p>
        {levels.length > 0 && (
          <>
            <div className="cmd-ev-chips">
              {levels.slice(0, 8).map((l, i) => (
                <span key={i} className={"cmd-ev-chip" + (sel === l ? " on" : "")} {...clickable(() => setSel(sel === l ? null : l), { label: `evidence for ${l.name}` })}>
                  ◫ {l.name} <b>{l.price}</b>
                </span>
              ))}
            </div>
            {sel && <EvidenceCard level={sel} close={lastBar?.close} onArm={arm} />}
          </>
        )}
      </div>
      <div className="cmd-pal-foot">
        <span>Claude · {streaming ? "thinking…" : "answered"}</span>
        <span className="sp" />
        <span>◫ evidence · <span className="cmd-kbd">esc</span> to close</span>
      </div>
    </>
  );
}
