// Page — the shared floating page frame (Batch B: one geometry + one chrome for
// every ⌘1–7 page). 980×82vh @ top:9vh, radius 16. Header = tinted icon tile ·
// title · short meta · optional tabs · right controls · esc. Footer = the ⌘-map
// (active page lit) on the left + exactly ONE context hint on the right.
//
// `sidecar` switches to the Agent variant (right-pinned, no scrim dim). `hosted`
// neutralizes an embedded popover body (legacy bridge; native pages don't use it).

import React from "react";
import { clickable } from "../../a11y.js";
import { PAGE_ORDER, PAGE_TITLES } from "../shell.constants.js";

// The ⌘-map footer — one span per page, the active one lit.
function CmdMap({ page }) {
  return (
    <span className="cmd-map">
      {PAGE_ORDER.map((p, i) => (
        <React.Fragment key={p}>
          {i > 0 && <span className="sep">·</span>}
          <span className={"m" + (p === page ? " on" : "")}>{"⌘" + (i + 1) + " " + PAGE_TITLES[p]}</span>
        </React.Fragment>
      ))}
    </span>
  );
}

export function Page({
  icon, tint = "blue", title, sub, page, hint, sidecar, wide, narrow, hosted,
  className, tabs, right, foot, onClose, children,
}) {
  const cls = "shell-page"
    + (sidecar ? " sidecar" : "")
    + (wide ? " wide" : "")
    + (narrow ? " narrow" : "")
    + (hosted ? " hosted" : "")
    + (className ? " " + className : "");
  return (
    <div className={cls} onClick={(e) => e.stopPropagation()}>
      <div className="head">
        {icon && <span className={"icon" + (tint ? " tint-" + tint : "")}>{icon}</span>}
        <span className="t">{title}</span>
        {sub && <span className="sub">{sub}</span>}
        {tabs && <span className="page-tabs">{tabs}</span>}
        <span className="sp" />
        {right}
        <span className="esc cmd-kbd" {...clickable(onClose, { label: "close page" })}>esc</span>
      </div>
      <div className={"body" + (hosted ? " page-host" : "")}>{children}</div>
      {foot
        ? <div className="foot">{foot}</div>
        : <div className="foot"><CmdMap page={page} /><span className="sp" />{hint && <span className="hint">{hint}</span>}</div>}
    </div>
  );
}
