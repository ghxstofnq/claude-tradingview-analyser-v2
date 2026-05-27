// FIXTURES page — reference 1:1 port (2026-05-27).
// Mirrors ai-trading-agent/apps/trading-terminal/workstation/fixtures.jsx.
// Left pane lists fixtures; right pane shows metadata + last-run diff.

import React, { useState } from "react";
import { Panel, Row } from "./Shared.jsx";

function action(name, ...args) {
  return () => {
    if (typeof window[name] === "function") window[name](...args);
    else console.log("[stub]", name, args);
  };
}

function statusPill(s) {
  const cls = s === "pass" ? "green" : s === "fail" ? "red" : "dim";
  const label = (s || "never").toUpperCase();
  return <span className={"grade-pill " + cls}>{label}</span>;
}

function FixturesPage() {
  const fixtures = (typeof window !== "undefined" && window.GOFNQ_DATA)?.fixtures || [];
  const [selPath, setSelPath] = useState(fixtures[0]?.path || null);
  const sel = fixtures.find((f) => f.path === selPath) || null;
  const counts = fixtures.reduce(
    (acc, f) => ({ ...acc, [f.status]: (acc[f.status] || 0) + 1 }), {});

  return (
    <div className="fx-grid">
      <div className="fx-left">
        <div className="panel-head" style={{ padding: "10px 14px" }}>
          <span className="title">FIXTURES</span>
          <span className="meta">
            {fixtures.length} · {counts.pass || 0} pass · {counts.fail || 0} fail · {counts.never || 0} never
          </span>
        </div>
        <div className="fx-list">
          <table className="fx-table">
            <thead>
              <tr>
                <th>DATE</th>
                <th>SESSION</th>
                <th>NAME</th>
                <th>LAST RUN</th>
                <th>STATUS</th>
              </tr>
            </thead>
            <tbody>
              {fixtures.length === 0 && (
                <tr><td colSpan={5} style={{ color: "var(--label)", padding: 14 }}>no fixtures yet</td></tr>
              )}
              {fixtures.map((f) => (
                <tr key={f.path}
                    className={selPath === f.path ? "sel" : ""}
                    onClick={() => setSelPath(f.path)}>
                  <td>{f.date}</td>
                  <td className="dim">{f.session}</td>
                  <td>{f.name}</td>
                  <td className="dim">{f.lastRun || "—"}</td>
                  <td>{statusPill(f.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="fx-footer">
          <button className="btn green" onClick={action("GOFNQ_runAllFixtures")}>RUN ALL</button>
          <button className="btn amber" onClick={action("GOFNQ_saveCurrentReplay")}>SAVE CURRENT REPLAY</button>
        </div>
      </div>

      <div className="fx-right">
        {!sel ? (
          <div className="stub">[ select a fixture ]</div>
        ) : (
          <>
            <div className="panel-head" style={{ padding: "10px 14px" }}>
              <span className="title">{sel.name}</span>
              <span className="meta">{sel.date} · {sel.session}</span>
            </div>
            <div className="panel" style={{ borderBottom: "0", flex: 1, overflowY: "auto" }}>
              <div className="sect-hd">FIXTURE</div>
              <Row k="Path"  v={sel.path} />
              <Row k="Tags"  v={(sel.tags || []).join(" · ") || "—"} />
              <Row k="Cycles" v={sel.cycles || "—"} />
              <Row k="Notes" v={sel.notes || "—"} />

              <div className="sect-hd">EXPECTED</div>
              {(sel.expected || []).length === 0
                ? <Row k="—" v="no assertions" tone="dim" />
                : (sel.expected || []).map((e, i) => <Row key={i} k={e.k} v={e.v} />)}

              <div className="sect-hd">LAST RUN {sel.lastRun ? `· ${sel.lastRun}` : ""}</div>
              {(sel.lastDiff || []).length === 0 ? (
                <Row k="—" v="never run" tone="dim" />
              ) : (
                <div className="fx-diff">
                  {(sel.lastDiff || []).map((d, i) => (
                    <div key={i} className={d.pass ? "ok" : "miss"}>
                      {d.pass ? "✓" : "✗"} {d.assertion}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="fx-footer">
              <button className="btn green" onClick={action("GOFNQ_runFixture", sel.path)}>RUN</button>
              <button className="btn amber" onClick={action("GOFNQ_openFixtureInReview", sel.path)}>OPEN IN REVIEW</button>
              <button className="btn"       onClick={action("GOFNQ_editFixture", sel.path)}>EDIT EXPECTED</button>
              <button className="btn red"   onClick={action("GOFNQ_deleteFixture", sel.path)}
                      style={{ marginLeft: "auto" }}>DELETE</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export { FixturesPage };
