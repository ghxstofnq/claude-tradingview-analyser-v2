// chimes — distinct WebAudio tones per walker-signal class. Same defensive
// pattern as CommandShell's playTick: everything wrapped, audio failure is
// silent. One short-lived AudioContext per chime keeps state simple.
//
// Three tiers (walkerSignals.signalEffects):
//   loud   — packet fired: rising three-note arpeggio, clearly audible
//   normal — progress (tap / awaiting confirm / confirmed): two quick notes
//   soft   — housekeeping (spawn / invalidate): single low blip

const PATTERNS = {
  loud:   { notes: [523.25, 659.25, 783.99], dur: 0.14, gap: 0.10, gain: 0.22 },
  normal: { notes: [587.33, 739.99],         dur: 0.10, gap: 0.08, gain: 0.10 },
  soft:   { notes: [392.0],                  dur: 0.09, gap: 0,    gain: 0.06 },
};

export function playChime(tier) {
  const p = PATTERNS[tier];
  if (!p) return;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    let t = ctx.currentTime;
    for (const f of p.notes) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = f;
      o.connect(g); g.connect(ctx.destination);
      g.gain.setValueAtTime(p.gain, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + p.dur);
      o.start(t); o.stop(t + p.dur + 0.01);
      t += p.gap || p.dur;
    }
    setTimeout(() => { try { ctx.close(); } catch { /* closed */ } }, 1200);
  } catch { /* audio unavailable */ }
}
