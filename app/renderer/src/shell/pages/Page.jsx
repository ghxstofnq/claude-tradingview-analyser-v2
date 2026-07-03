// Page — the shared floating page frame (title bar + esc + scrollable body).
// Sits over the scrim; hosts either a native layout or an embedded popover body.

import React from "react";
import { clickable } from "../../a11y.js";

export function Page({ icon, tint = "blue", title, sub, wide, hosted, tabs, foot, onClose, children }) {
  return (
    <div className={"shell-page" + (wide ? " wide" : "") + (hosted ? " hosted" : "")}
         onClick={(e) => e.stopPropagation()}>
      <div className="head">
        {icon && <span className={"icon tint-" + tint}>{icon}</span>}
        <span className="t">{title}</span>
        {sub && <span className="sub">{sub}</span>}
        {tabs && <span className="page-tabs">{tabs}</span>}
        <span className="sp" />
        <span className="esc cmd-kbd" {...clickable(onClose, { label: "close page" })}>esc</span>
      </div>
      <div className={"body" + (hosted ? " page-host" : "")}>{children}</div>
      {foot && <div className="foot">{foot}</div>}
    </div>
  );
}
