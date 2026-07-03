// ReviewPage — ⌘3. Hosts the REVIEW body; tabs (SESSION / TRACK / LIBRARY)
// are managed here and passed down.

import React, { useState } from "react";
import { Page } from "./Page.jsx";
import { PAGE_ICONS, PAGE_FOOT } from "../shell.constants.js";
import { ReviewWorkstation as ReviewBody } from "../../ReviewPopover.jsx";

const TABS = [["SESSION", "SESSION"], ["TRACK", "TRACK RECORD"], ["LIBRARY", "LIBRARY"]];

export function ReviewPage({ onClose }) {
  const [view, setView] = useState("SESSION");
  const [picked, setPicked] = useState(null);
  const tabs = TABS.map(([v, l]) => (
    <span key={v} className={"pill interactive" + (view === v ? " active" : "")}
          onClick={() => setView(v)}>{l}</span>
  ));
  return (
    <Page icon={PAGE_ICONS.review} tint="mute" title="Review" wide hosted tabs={tabs}
          onClose={onClose} foot={<><span>{PAGE_FOOT}</span><span className="sp" /><span>rows jump the chart behind</span></>}>
      <ReviewBody view={view} picked={picked} setPicked={setPicked} />
    </Page>
  );
}
