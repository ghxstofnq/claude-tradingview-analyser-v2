// app/renderer/src/Analytics.jsx
// BACKTEST ANALYTICS dashboard — the designer's AnalyticsBody, ported to the
// real renderer and fed an honest `A` shape built by cli/lib/backtest-analytics
// (buildAnalytics) from paired open/outcome rows. Cumulative-R + expectancy are
// the hero numbers; win-rate (~46% by design) is deliberately demoted.
//
// Two honesty deviations from the designer mock (constraints #6/#7):
//   • EquityCurve plots the REAL per-trade cumulative-R series, not a seeded
//     random walk that merely lands on the final number.
//   • BIAS ALIGNMENT + ENTRY-TIME cards render only when their data exists;
//     bias alignment isn't tracked per trade, so it's omitted, never faked.
//
// Reusable: REVIEW's TRACK RECORD can render <Analytics A={...} /> later.

import React, { useEffect, useRef } from "react";

const sgn = (n, d = 1) => (n > 0 ? "+" : n < 0 ? "−" : "") + Math.abs(n).toFixed(d);

// Price/number with a hover data-source tooltip (designer's Px).
function Px({ v, children, src, tone, big }) {
  const text = v != null ? v : children;
  return (
    <span className={"px-h" + (tone ? " " + tone : "") + (big ? " big" : "")}
          data-src={src || "data source · attached"} tabIndex={0}>{text}</span>
  );
}

// ── Cumulative-R equity curve — drawn from the REAL per-trade series ─────
function EquityCurve({ equity = [] }) {
  const ref = useRef(null);
  const wrap = useRef(null);
  useEffect(() => {
    const canvas = ref.current, box = wrap.current;
    if (!canvas || !box) return;
    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const W = box.clientWidth, H = box.clientHeight;
      if (!W || !H) return;
      canvas.width = W * dpr; canvas.height = H * dpr;
      const ctx = canvas.getContext("2d");
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const css = getComputedStyle(document.documentElement);
      const col = (n) => css.getPropertyValue(n).trim();
      ctx.clearRect(0, 0, W, H);
      if (!equity.length) return;

      // cumulative series with a 0 origin
      const cum = [0, ...equity];
      const finalR = cum[cum.length - 1];
      let lo = Math.min(...cum), hi = Math.max(...cum);
      lo = Math.min(lo, 0); hi = Math.max(hi, 0);
      const span = hi - lo || 1;
      const pad = span * 0.08; lo -= pad; hi += pad;

      const padR = 42, padL = 4, padT = 8, padB = 14;
      const iw = W - padL - padR, ih = H - padT - padB;
      const x = (i) => padL + (i / Math.max(1, cum.length - 1)) * iw;
      const y = (v) => padT + ih - ((v - lo) / (hi - lo)) * ih;
      const up = finalR >= 0;
      const lineCol = up ? col("--green") : col("--red");

      // horizontal grid + right axis
      ctx.font = "9px ui-monospace, Menlo, monospace";
      ctx.textBaseline = "middle";
      for (let g = 0; g <= 4; g++) {
        const v = lo + (hi - lo) * (g / 4), yy = y(v);
        ctx.strokeStyle = col("--border"); ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(padL, yy); ctx.lineTo(padL + iw, yy); ctx.stroke();
        ctx.fillStyle = col("--label-dim"); ctx.textAlign = "left";
        ctx.fillText((v >= 0 ? "+" : "−") + Math.abs(Math.round(v)) + "R", padL + iw + 6, yy);
      }
      // zero baseline
      const y0 = y(0);
      ctx.strokeStyle = col("--border-d"); ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(padL, y0); ctx.lineTo(padL + iw, y0); ctx.stroke();
      ctx.setLineDash([]);

      // area fill under the curve
      const grad = ctx.createLinearGradient(0, padT, 0, padT + ih);
      grad.addColorStop(0, up ? "rgba(110,199,136,0.20)" : "rgba(224,108,117,0.20)");
      grad.addColorStop(1, up ? "rgba(110,199,136,0.01)" : "rgba(224,108,117,0.01)");
      ctx.beginPath();
      ctx.moveTo(x(0), y0);
      for (let i = 0; i < cum.length; i++) ctx.lineTo(x(i), y(cum[i]));
      ctx.lineTo(x(cum.length - 1), y0); ctx.closePath();
      ctx.fillStyle = grad; ctx.fill();

      // the line
      ctx.beginPath();
      for (let i = 0; i < cum.length; i++) { const px = x(i), py = y(cum[i]); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
      ctx.strokeStyle = lineCol; ctx.lineWidth = 1.6; ctx.stroke();

      // final marker
      const fx = x(cum.length - 1), fy = y(finalR);
      ctx.fillStyle = lineCol;
      ctx.beginPath(); ctx.arc(fx, fy, 2.6, 0, Math.PI * 2); ctx.fill();
    };
    draw();
    const ro = new ResizeObserver(draw); ro.observe(box);
    const mo = new MutationObserver(draw);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => { ro.disconnect(); mo.disconnect(); };
  }, [equity]);
  return <div className="eq-chart" ref={wrap}><canvas ref={ref}></canvas></div>;
}

// ── Expectancy / win breakdown card ─────────────────────────────────────
function BreakdownCard({ title, rows, unit, maxExp = 2.5 }) {
  return (
    <div className="bd-card">
      <div className="bd-hd"><span>{title}</span><span className="u">EXP · WIN%</span></div>
      {rows.map((r) => {
        const w = Math.max(3, Math.min(100, (Math.abs(r.exp) / maxExp) * 100));
        const low = r.exp < 0.35 && r.exp >= 0;
        const neg = r.exp < 0;
        return (
          <div className="bd-row" key={r.k}>
            <span className="lbl" title={r.k}>{r.k}</span>
            <span className="barwrap">
              <span className="axis" style={{ left: 0 }} />
              <span className={"bar" + (neg ? " neg" : "") + (low ? " low" : "")} style={{ left: 0, width: w + "%" }} />
            </span>
            <span className="exp-cell" style={{ textAlign: "right" }}>
              <span className={"exp" + (neg ? " neg" : low ? " low" : "")}>{sgn(r.exp, 2)}</span>
              <span className="win"> · {r.win}%</span>
            </span>
          </div>
        );
      })}
      <div className="bd-foot"><span>{unit}</span><span>n = {rows.reduce((a, r) => a + r.n, 0)}</span></div>
    </div>
  );
}

// ── The dashboard ───────────────────────────────────────────────────────
export default function Analytics({ A, loading }) {
  if (loading) {
    return (
      <div className="section">
        <div className="sect-hd"><span>PERFORMANCE</span><span className="meta">COMPUTING…</span></div>
        <div style={{ color: "var(--label-dim)", fontSize: 11, padding: "8px 0" }}>
          aggregating per-trade R across runs…
        </div>
      </div>
    );
  }
  if (!A || A.n_trades === 0) {
    return (
      <div className="section">
        <div className="sect-hd"><span>PERFORMANCE</span><span className="meta">{A?.window_label ?? "NO DATA"}</span></div>
        <div style={{ color: "var(--label-dim)", fontSize: 11, padding: "8px 0" }}>
          no completed trades in these runs yet — analytics populate once setups resolve.
        </div>
      </div>
    );
  }

  const maxSession = Math.max(1, ...A.sessions.map((s) => Math.abs(s.r)));
  const maxOutcome = Math.max(1, ...A.outcomes.map((o) => o.n));
  const total = A.n_trades;
  const payMax = Math.max(A.avg_win, Math.abs(A.avg_loss), 0.01);

  return (
    <>
      {/* HERO — cumulative R + expectancy */}
      <div className="section">
        <div className="sect-hd"><span>PERFORMANCE</span><span className="meta">{A.window_label}</span></div>
        <div className="an-hero">
          <div className="htile">
            <span className="k">CUMULATIVE R</span>
            <span className={"v " + (A.cum_r >= 0 ? "green" : "red")}><Px v={sgn(A.cum_r, 1) + "R"} src={`Σ per-trade R · ${A.n_trades} trades`} /></span>
            <span className="sub">{A.n_trades} trades · {A.n_sessions} sessions · net of nothing — runs are free</span>
          </div>
          <div className="htile">
            <span className="k">EXPECTANCY</span>
            <span className="v amber"><Px v={sgn(A.expectancy, 2) + "R"} src="cum R ÷ trades · per-trade edge" /></span>
            <span className="sub">per trade · payoff {A.payoff.toFixed(2)}× carries a {A.win_pct}% win-rate</span>
          </div>
        </div>
        <div className="an-strip">
          <div className="c muted">
            <span className="k">WIN RATE</span>
            <span className="v">{A.win_pct}%</span>
            <span className="tag">BY DESIGN — EDGE IS PAYOFF</span>
          </div>
          <div className="c"><span className="k">PAYOFF</span><span className="v">{A.payoff.toFixed(2)}×</span></div>
          <div className="c"><span className="k">AVG WIN</span><span className="v green"><Px v={sgn(A.avg_win, 2) + "R"} src={`${A.win_n} winners · mean R`} /></span></div>
          <div className="c"><span className="k">AVG LOSS</span><span className="v red"><Px v={sgn(A.avg_loss, 2) + "R"} src={`${A.loss_n} losers · mean R`} /></span></div>
          <div className="c"><span className="k">MAX DD</span><span className="v red">{A.max_drawdown_r.toFixed(1)}R</span></div>
        </div>
      </div>

      {/* EQUITY CURVE */}
      <div className="section">
        <div className="an-equity">
          <div className="eq-head">
            <span className="t">CUMULATIVE R · EQUITY CURVE</span>
            <span className="meta">peak <b>{sgn(A.cum_r, 1)}R</b> · max DD <b className="red">{A.max_drawdown_r.toFixed(1)}R</b> · best session <b>{sgn(A.best_session_r, 0)}R</b></span>
          </div>
          <EquityCurve equity={A.equity} />
        </div>
      </div>

      {/* BREAKDOWNS */}
      <div className="section">
        <div className="sect-hd"><span>EXPECTANCY BY CUT</span><span className="meta">EXP · WIN% PER GROUP</span></div>
        <div className="an-breakdowns">
          {A.by_grade?.length > 0 && <BreakdownCard title="BY GRADE" rows={A.by_grade} unit="A+ leads" maxExp={2.5} />}
          {A.by_model?.length > 0 && <BreakdownCard title="BY MODEL" rows={A.by_model} unit="best model leads" maxExp={2.5} />}
          {A.by_time?.length > 0 && <BreakdownCard title="ENTRY TIME · ET" rows={A.by_time} unit="killzone open leads" maxExp={2.5} />}
        </div>
      </div>

      {/* SESSION CONCENTRATION */}
      <div className="section">
        <div className="sect-hd"><span>SESSION CONCENTRATION</span><span className="meta">WHICH SESSIONS DROVE THE RESULT</span></div>
        {A.sessions.map((sv) => {
          const w = (Math.abs(sv.r) / maxSession) * 100;
          const pct = A.cum_r !== 0 ? Math.round((sv.r / A.cum_r) * 100) : 0;
          const neg = sv.r < 0;
          return (
            <div className="conc-row" key={sv.k}>
              <span className="lbl">{sv.k}<span className="n">{sv.n} trades</span></span>
              <span className="track">
                <span className={"fill" + (neg ? " neg" : "")} style={{ width: w + "%" }} />
                <span className="pct">{pct}% of cum R</span>
              </span>
              <span className={"rval" + (neg ? " neg" : "")}><Px v={sgn(sv.r, 1) + "R"} src={`${sv.k} · Σ R across ${sv.n} trades`} /></span>
            </div>
          );
        })}
      </div>

      {/* OUTCOME BREAKDOWN */}
      <div className="section">
        <div className="sect-hd"><span>OUTCOME BREAKDOWN</span><span className="meta">{total} TRADES</span></div>
        {A.outcomes.map((o) => {
          const w = (o.n / maxOutcome) * 100;
          const pct = Math.round((o.n / total) * 100);
          return (
            <div className="oc-row" key={o.k}>
              <span className={"lbl " + o.tone}>{o.k}</span>
              <span className="n">{o.n}</span>
              <span className="track"><span className={"fill " + o.tone} style={{ width: w + "%" }} /></span>
              <span className="each">{pct}% · {o.r_each}</span>
            </div>
          );
        })}
      </div>

      {/* WINNERS vs LOSERS */}
      <div className="section">
        <div className="sect-hd"><span>WINNERS vs LOSERS</span><span className="meta">PAYOFF ASYMMETRY</span></div>
        <div className="wl">
          <div className="wlcol win">
            <span className="k">AVG WIN</span>
            <span className="v"><Px v={sgn(A.avg_win, 2) + "R"} src={`${A.win_n} winners · mean R`} /></span>
            <span className="sub">{A.win_n} winners · largest {sgn(A.largest_win_r, 1)}R</span>
          </div>
          <div className="wlcol loss">
            <span className="k">AVG LOSS</span>
            <span className="v"><Px v={sgn(A.avg_loss, 2) + "R"} src={`${A.loss_n} losers · mean R`} /></span>
            <span className="sub">{A.loss_n} losers · {A.be_n} scratched at BE</span>
          </div>
        </div>
        <div className="payoff-bar">
          <div className="pb-axis">
            <span className="pb-mid" />
            <span className="pb-loss" style={{ width: (Math.abs(A.avg_loss) / payMax) * 50 + "%" }} />
            <span className="pb-win" style={{ width: (A.avg_win / payMax) * 50 + "%" }} />
          </div>
          <div className="pb-foot"><span>← AVG LOSS {A.avg_loss.toFixed(2)}R</span><span>{A.payoff.toFixed(2)}× PAYOFF</span><span>AVG WIN +{A.avg_win.toFixed(2)}R →</span></div>
        </div>
      </div>
    </>
  );
}
