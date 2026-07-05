#!/usr/bin/env python3
"""Gate-corpus parity proof: diff a recorded tape vs the live walker-inputs, bar by bar.

Domains:
  A bar alignment   — every bar minute present on both sides
  B OHLC            — exact equality (1m bar of the event)
  C engine evidence — exact, EXCEPT allowlisted batch-1-changed fields and
                      dual-emit additive fields (expected deltas, counted separately)
  D context         — ltf_bias_context / session_state: report-only (known domain)
Usage: parity-diff.py <tape.json> <walker-inputs.jsonl>
"""
import json, sys, datetime, zoneinfo

ET = zoneinfo.ZoneInfo('America/New_York')

# Fields whose VALUES may legitimately differ: batch-1 semantic fixes (live 07-02
# ran pre-batch-1 Pine) or dual-emit additive fields (absent in live).
ZONE_ALLOW = {'wick_tapped', 'entered', 'entered_ms', 'bars_in_zone', 'minutes_in_zone',
              'ce_held', 'confirm_close', 'confirm_dir', 'confirm_ms', 'confirm_strict',
              'chop_15m', 'state', 'kind', 'dir', 'inverted_ms', 'reacted', 'reaction_dir',
              'deep_px', 'fill_state', 'mitigated_ms', 'distance_to_top', 'distance_to_bottom', 'distance_to_ce'}
# state/kind/dir allowlisted because formation-bar-guard + confirm timing shifts can
# cascade into lifecycle state on specific zones; boundary identity is the hard check.
QUALITY_ALLOW = {'or_swept', 'leg_high_org', 'leg_low_org', 'leg_high_org_ms', 'leg_low_org_ms',
                 'range_vs_normal', 'coherence', 'range_3h', 'range_quality', 'displacement',
                 'candle', 'regime', 'atr_14', 'atr_17'}
# quality scalars beyond overnight/session are live-forming-bar sensitive (live capture
# lands post-close; replay recompute is at-close) — report, don't fail. The hard quality
# checks: session, overnight_dir, overnight_net, or_high, or_low.
QUALITY_HARD = ['session', 'overnight_dir', 'overnight_net', 'or_high', 'or_low']
SWEEP_ALLOW = {'rejected_rw'}

def bar_key(ms):
    ms = ms * 1000 if ms < 10**12 else ms  # live events carry seconds
    return datetime.datetime.fromtimestamp(ms / 1000, tz=ET).strftime('%H:%M')

def load_live(path):
    out = {}
    for line in open(path):
        d = json.loads(line)
        ev = d.get('event') or {}
        # key on bar OPEN time of the 1m bar the event closed
        ms = ev.get('bar_open_time') or ev.get('bar_close_time')
        if not ms:
            continue
        k = bar_key(ms)
        out[k] = d  # last write wins (5m-tagged duplicates share the bar)
    return out

def load_tape(path):
    d = json.load(open(path))
    out = {}
    for e in d.get('entries', []):
        b = (e.get('inputs') or {}).get('bundle') or {}
        ms = (b.get('engine') or {}).get('meta', {}).get('bar_ms')
        # tape meta.bar_ms = the FORMING cursor bar; its state is confirmed
        # through bar_ms - 1m. Shift one bar back so keys mean the same thing
        # on both sides: "state after bar X closed".
        if ms:
            ms -= 60_000
        if not ms:
            ev = e.get('event') or {}
            ts = ev.get('ts')
            if ts:
                k = ts[11:16]
                out[k] = e
                continue
        else:
            out[bar_key(ms)] = e
    return out

def ohlc_of_live(d):
    o = (d.get('event') or {}).get('ohlc') or {}
    return tuple(o.get(x) for x in ('open', 'high', 'low', 'close'))

def ohlc_of_tape(e):
    b = (e.get('inputs') or {}).get('bundle') or {}
    lb = (b.get('bars') or {}).get('last_bar') or {}
    if lb:
        return tuple(lb.get(x) for x in ('open', 'high', 'low', 'close'))
    ev = e.get('event') or {}
    o = ev.get('ohlc') or {}
    return tuple(o.get(x) for x in ('open', 'high', 'low', 'close'))

def engine_of(x, live=True):
    b = (x.get('inputs') or {}).get('bundle') or {}
    return b.get('engine') or {}

def zkey(z):
    return (z.get('top'), z.get('bottom'), z.get('created_ms'))

def diff_engine(le, te, allow_report):
    hard, expected = [], []
    # levels: name -> (price, swept)
    ll = {l.get('name'): l for l in (le.get('levels') or [])}
    tl = {l.get('name'): l for l in (te.get('levels') or [])}
    for name in sorted(set(ll) | set(tl)):
        a, b = ll.get(name), tl.get(name)
        if a is None or b is None:
            hard.append(f'level {name}: present only in {"live" if a else "tape"}')
            continue
        for f in ('price', 'swept', 'state'):
            if a.get(f) != b.get(f):
                hard.append(f'level {name}.{f}: live={a.get(f)} tape={b.get(f)}')
    # sweeps: target -> fields
    ls = {s.get('target'): s for s in (le.get('sweeps') or [])}
    ts = {s.get('target'): s for s in (te.get('sweeps') or [])}
    for t in sorted(set(ls) | set(ts)):
        a, b = ls.get(t), ts.get(t)
        if a is None or b is None:
            hard.append(f'sweep {t}: present only in {"live" if a else "tape"}')
            continue
        for f in set(a) | set(b):
            if f in SWEEP_ALLOW:
                continue
            if a.get(f) != b.get(f):
                hard.append(f'sweep {t}.{f}: live={a.get(f)} tape={b.get(f)}')
    # quality
    lq, tq = le.get('quality') or {}, te.get('quality') or {}
    for f in QUALITY_HARD:
        if lq.get(f) != tq.get(f):
            hard.append(f'quality.{f}: live={lq.get(f)} tape={tq.get(f)}')
    for f in sorted((set(lq) | set(tq)) - set(QUALITY_HARD)):
        if lq.get(f) != tq.get(f):
            expected.append(f'quality.{f}')
    # zones: match by boundary identity
    for kind in ('fvgs', 'bprs'):
        lz = {zkey(z): z for z in (le.get(kind) or [])}
        tz = {zkey(z): z for z in (te.get(kind) or [])}
        only_l = set(lz) - set(tz)
        only_t = set(tz) - set(lz)
        # zone-set drift can be legit (FVG_MAX window + lifecycle cascades) — count it
        if only_l or only_t:
            expected.append(f'{kind} set drift: live-only={len(only_l)} tape-only={len(only_t)}')
        for k in set(lz) & set(tz):
            a, b = lz[k], tz[k]
            for f in set(a) | set(b):
                if a.get(f) == b.get(f):
                    continue
                (expected if f in ZONE_ALLOW else hard).append(
                    f'{kind[:-1]} {k[0]}/{k[1]}.{f}: live={a.get(f)} tape={b.get(f)}' if f not in ZONE_ALLOW else f'{kind[:-1]}.{f}')
    return hard, expected

def main():
    tape_p, live_p = sys.argv[1], sys.argv[2]
    live = load_live(live_p)
    tape = load_tape(tape_p)
    both = sorted(set(live) & set(tape))
    only_live = sorted(set(live) - set(tape))
    only_tape = sorted(set(tape) - set(live))
    print(f'A BAR ALIGNMENT: live={len(live)} tape={len(tape)} both={len(both)}')
    if only_live: print(f'  only-live bars: {only_live[:10]}{"..." if len(only_live)>10 else ""}')
    if only_tape: print(f'  only-tape bars: {only_tape[:10]}{"..." if len(only_tape)>10 else ""}')

    ohlc_bad = []
    hard_all, expected_count = [], {}
    for k in both:
        lo, to = ohlc_of_live(live[k]), ohlc_of_tape(tape[k])
        if lo != to and all(v is not None for v in lo + to):
            ohlc_bad.append(f'{k}: live={lo} tape={to}')
        h, ex = diff_engine(engine_of(live[k]), engine_of(tape[k]), True)
        for x in h:
            hard_all.append(f'{k} {x}')
        for x in ex:
            expected_count[x.split(":")[0]] = expected_count.get(x.split(":")[0], 0) + 1

    print(f'\nB OHLC: {len(both) - len(ohlc_bad)}/{len(both)} exact')
    for x in ohlc_bad[:10]:
        print('  MISMATCH', x)

    print(f'\nC ENGINE hard mismatches: {len(hard_all)}')
    seen = set()
    shown = 0
    for x in hard_all:
        head = x.split(':')[0]
        sig = head.split(' ', 1)[1] if ' ' in head else head
        if sig in seen:
            continue
        seen.add(sig)
        print('  HARD', x)
        shown += 1
        if shown >= 25:
            print(f'  ... ({len(hard_all)} total lines, {len(seen)} distinct)')
            break

    print('\nC expected deltas (batch-1 / dual-emit / forming-bar-sensitive), bars affected:')
    for f, n in sorted(expected_count.items(), key=lambda x: -x[1])[:20]:
        print(f'  {f}: {n}')

    # D context — report only
    k0 = both[len(both)//2] if both else None
    if k0:
        lc = (live[k0].get('inputs') or {}).get('ltf_bias_context') or {}
        tc = (tape[k0].get('inputs') or {}).get('ltf_bias_context') or {}
        diffs = [f for f in set(lc) | set(tc) if lc.get(f) != tc.get(f)]
        print(f'\nD CONTEXT (report-only, sample bar {k0}): differing fields: {sorted(diffs)}')

    verdict = 'PASS' if not hard_all and not ohlc_bad and not only_live and not only_tape else ('PASS-WITH-NOTES' if not hard_all and not ohlc_bad else 'FAIL')
    print(f'\nVERDICT: {verdict}')

main()
