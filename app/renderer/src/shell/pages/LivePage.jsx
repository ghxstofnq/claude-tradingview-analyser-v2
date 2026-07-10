// LivePage — ⌘2. Native LIVE page: the segmented FEED | POSITIONS toggle lives
// inline in the page header (beside the "Live" title); the page frame supplies
// the green-tinted header, the red-outline FLATTEN control, and the single Live
// footer. LiveBody renders only the body (segment selection is threaded down).
// Still `hosted` because LiveBody renders inside a `.bt-popover.embedded` (every
// existing LIVE body style applies).

import React, { useState, useEffect } from "react";
import { Page } from "./Page.jsx";
import { PAGE_ICONS } from "../shell.constants.js";
import { LiveBody } from "../../LivePopover.jsx";
import { clickable } from "../../a11y.js";
import { useExecutionState } from "../../hooks/useExecutionState.js";
import { useTrades } from "../../hooks/useTrades.js";
import { liveFooterCopy } from "../../Live.helpers.js";

const SEGS = [["feed", "FEED"], ["positions", "POSITIONS"]];

export function LivePage({ symbol, guards, onFlatten, onClose }) {
  const [seg, setSeg] = useState("feed");
  const [userPicked, setUserPicked] = useState(false);
  const exec = useExecutionState();
  const { activeTrade } = useTrades();
  const hasPosition = !!exec.position || !!activeTrade;
  const effectiveSeg = userPicked ? seg : (hasPosition ? "positions" : "feed");

  // Real automation mode (C2-c) — the same config the Settings page reads. The
  // footer copy must match the actual execution path (AUTO fires without accept).
  const [mode, setMode] = useState("manual");
  useEffect(() => {
    let alive = true;
    const load = () => window.api?.execution?.config?.get?.()
      .then((r) => { if (alive && r?.ok) setMode(r.config?.automationMode ?? "manual"); })
      .catch(() => {});
    load(); const h = setInterval(load, 5000); return () => { alive = false; clearInterval(h); };
  }, []);

  const tabs = (
    <div className="cs-live-tabs">
      {SEGS.map(([v, l]) => (
        <span key={v} className={"cs-provpill" + (effectiveSeg === v ? " is-on" : "")}
              {...clickable(() => { setUserPicked(true); setSeg(v); }, { label: l })}>{l}</span>
      ))}
    </div>
  );

  const foot = (
    <>
      <span className={mode === "auto" ? "cs-live-foot-auto" : undefined}>{liveFooterCopy(mode)}</span>
      <span className="sp" />
      <span>⇧⌘F flattens anywhere · esc</span>
    </>
  );

  return (
    <Page icon={PAGE_ICONS.live} tint="green" title="Live" page="live" hosted narrow className="narrow" onClose={onClose}
          tabs={tabs} foot={foot}
          right={<span className="cs-btn-flatten" onClick={onFlatten} title="⇧⌘F flattens anywhere">FLATTEN</span>}>
      <LiveBody guards={guards} symbol={symbol} seg={effectiveSeg} setSeg={setSeg} setUserPicked={setUserPicked} />
    </Page>
  );
}
