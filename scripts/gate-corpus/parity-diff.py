#!/usr/bin/env python3
"""Diff recorded tape vs live walker-inputs and optionally write a certificate.

The certificate is intentionally stricter than the human diff: it is written
only for an exact PASS (zero alignment, OHLC, hard, and allowlisted note counts).
Any FAIL or PASS-WITH-NOTES exits nonzero and leaves no positive certificate.
"""

import argparse
import datetime as dt
import hashlib
import json
import os
import sys

CERT_SCHEMA = "gate-corpus-parity-certificate/v1"
GENERATOR = "scripts/gate-corpus/parity-diff.py"

ZONE_ALLOW = {
    "wick_tapped", "entered", "entered_ms", "bars_in_zone", "minutes_in_zone",
    "ce_held", "confirm_close", "confirm_dir", "confirm_ms", "confirm_strict",
    "chop_15m", "state", "kind", "dir", "inverted_ms", "reacted",
    "reaction_dir", "deep_px", "fill_state", "mitigated_ms",
    "distance_to_top", "distance_to_bottom", "distance_to_ce",
}
QUALITY_ALLOW = {
    "or_swept", "leg_high_org", "leg_low_org", "leg_high_org_ms",
    "leg_low_org_ms", "range_vs_normal", "coherence", "range_3h",
    "range_quality", "displacement", "candle", "regime", "atr_14", "atr_17",
}
ALLOWLIST_FIELDS = ZONE_ALLOW | QUALITY_ALLOW


def load_tape(path):
    with open(path, "r", encoding="utf8") as f:
        data = json.load(f)
    if isinstance(data, list):
        return {"entries": data}, data
    return data, data.get("entries") or []


def load_live(path):
    rows = []
    with open(path, "r", encoding="utf8") as f:
        for line in f:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def entry_key(entry):
    event = entry.get("event") or {}
    if event.get("ts"):
        return event["ts"]
    if event.get("bar_close_ts"):
        return event["bar_close_ts"]
    bundle = (entry.get("inputs") or {}).get("bundle") or {}
    last_bar = (bundle.get("bars") or {}).get("last_bar") or {}
    if last_bar.get("time") is not None:
        return str(last_bar["time"])
    return None


def keyed(entries):
    out = {}
    duplicates = []
    missing_keys = []
    for i, entry in enumerate(entries):
        key = entry_key(entry)
        if key is None:
            missing_keys.append(i)
            key = f"__row_{i}"
        if key in out:
            duplicates.append(key)
            continue
        out[key] = entry
    return out, duplicates, missing_keys


def ohlc_of_live(entry):
    o = (entry.get("event") or {}).get("ohlc") or {}
    return tuple(o.get(k) for k in ("open", "high", "low", "close"))


def ohlc_of_tape(entry):
    bundle = (entry.get("inputs") or {}).get("bundle") or {}
    bars = bundle.get("bars") or {}
    last_bar = bars.get("last_bar") or {}
    if not last_bar and bars.get("last_5_bars"):
        last_bar = bars["last_5_bars"][-1]
    if last_bar:
        return tuple(last_bar.get(k) for k in ("open", "high", "low", "close"))
    o = (entry.get("event") or {}).get("ohlc") or {}
    return tuple(o.get(k) for k in ("open", "high", "low", "close"))


def engine_of(entry):
    bundle = (entry.get("inputs") or {}).get("bundle") or {}
    return bundle.get("engine") or {}


def compare_json(path, live_value, tape_value, hard, notes):
    if live_value == tape_value:
        return
    field = path.rsplit(".", 1)[-1]
    if field in ALLOWLIST_FIELDS:
        notes.append(path)
        return
    if isinstance(live_value, dict) and isinstance(tape_value, dict):
        for key in sorted(set(live_value) | set(tape_value)):
            compare_json(f"{path}.{key}" if path else key, live_value.get(key), tape_value.get(key), hard, notes)
        return
    if isinstance(live_value, list) and isinstance(tape_value, list):
        if len(live_value) != len(tape_value):
            hard.append(f"{path}.length live={len(live_value)} tape={len(tape_value)}")
            return
        for idx, (lv, tv) in enumerate(zip(live_value, tape_value)):
            compare_json(f"{path}[{idx}]", lv, tv, hard, notes)
        return
    hard.append(f"{path}: live={live_value!r} tape={tape_value!r}")


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def validate_certificate_args(args):
    missing = [
        name for name, value in {
            "--manifest-id": args.manifest_id,
            "--selection-digest": args.selection_digest,
            "--schema": args.schema,
            "--code-rev": args.code_rev,
        }.items()
        if value is None
    ]
    if missing:
        return f"--certificate-out requires {', '.join(missing)}"
    digest = args.selection_digest or ""
    if len(digest) != 64 or any(ch not in "0123456789abcdef" for ch in digest):
        return "--selection-digest must be 64 lowercase hexadecimal characters"
    return None


def parity_scope(tape_doc, tape_entries, live_entries):
    date = tape_doc.get("date") if isinstance(tape_doc, dict) else None
    session = tape_doc.get("session") if isinstance(tape_doc, dict) else None
    symbols = set()
    for entry in [*tape_entries, *live_entries]:
        symbol = ((engine_of(entry).get("meta") or {}).get("symbol"))
        if symbol:
            symbols.add(symbol)
    if not isinstance(date, str) or not date:
        return None, "tape has no top-level date"
    if not isinstance(session, str) or not session:
        return None, "tape has no top-level session"
    if len(symbols) != 1:
        return None, f"parity inputs must identify exactly one symbol (found {sorted(symbols)})"
    return {"date": date, "session": session, "symbol": next(iter(symbols))}, None


def write_certificate(args, tape_path, live_path, counts, scope):
    cert = {
        "schema_version": CERT_SCHEMA,
        "generator": GENERATOR,
        "verdict": "PASS",
        "generated_at": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "manifest_id": args.manifest_id,
        "selection_digest": args.selection_digest,
        "engine": {"schema": int(args.schema), "code_rev": int(args.code_rev)},
        "scope": scope,
        "sources": {
            "tape": {"path": os.path.abspath(tape_path), "sha256": sha256_file(tape_path)},
            "live": {"path": os.path.abspath(live_path), "sha256": sha256_file(live_path)},
        },
        "mismatch_counts": counts,
    }
    output = os.path.abspath(args.certificate_out)
    tmp = f"{output}.tmp-{os.getpid()}"
    try:
        with open(tmp, "w", encoding="utf8") as f:
            json.dump(cert, f, indent=2, sort_keys=True)
            f.write("\n")
        os.replace(tmp, output)
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)


def parse_args(argv):
    p = argparse.ArgumentParser(description="Diff recorded tape vs live walker-inputs")
    p.add_argument("tape_json")
    p.add_argument("walker_inputs_jsonl")
    p.add_argument("--certificate-out")
    p.add_argument("--manifest-id")
    p.add_argument("--selection-digest")
    p.add_argument("--schema", type=int)
    p.add_argument("--code-rev", type=int)
    return p.parse_args(argv)


def main(argv=None):
    args = parse_args(argv or sys.argv[1:])
    if args.certificate_out:
        try:
            os.remove(args.certificate_out)
        except FileNotFoundError:
            pass
        invalid = validate_certificate_args(args)
        if invalid:
            print(f"CERTIFICATE ERROR: {invalid}", file=sys.stderr)
            return 2

    live_entries = load_live(args.walker_inputs_jsonl)
    tape_doc, tape_entries = load_tape(args.tape_json)
    scope, scope_error = parity_scope(tape_doc, tape_entries, live_entries)
    if args.certificate_out and scope_error:
        print(f"CERTIFICATE ERROR: {scope_error}", file=sys.stderr)
        return 2

    live, live_duplicates, live_missing_keys = keyed(live_entries)
    tape, tape_duplicates, tape_missing_keys = keyed(tape_entries)

    live_keys = set(live)
    tape_keys = set(tape)
    both = sorted(live_keys & tape_keys)
    only_live = sorted(live_keys - tape_keys)
    only_tape = sorted(tape_keys - live_keys)

    ohlc_bad = []
    hard = []
    notes = []
    if not live or not tape:
        hard.append("parity inputs must both contain at least one keyed entry")
    for source, duplicates, missing_keys in (
        ("live", live_duplicates, live_missing_keys),
        ("tape", tape_duplicates, tape_missing_keys),
    ):
        hard.extend(f"{source} duplicate event key: {key}" for key in duplicates)
        hard.extend(f"{source} row {idx} has no event key" for idx in missing_keys)

    for key in both:
        lo = ohlc_of_live(live[key])
        to = ohlc_of_tape(tape[key])
        if any(v is None for v in lo + to) or lo != to:
            ohlc_bad.append(key)
        compare_json(f"engine[{key}]", engine_of(live[key]), engine_of(tape[key]), hard, notes)

    counts = {
        "alignment": len(only_live) + len(only_tape),
        "ohlc": len(ohlc_bad),
        "hard": len(hard),
    }
    if counts["alignment"] or counts["ohlc"] or counts["hard"]:
        verdict = "FAIL"
    elif notes:
        verdict = "PASS-WITH-NOTES"
    else:
        verdict = "PASS"

    print(f"A BAR ALIGNMENT: live={len(live)} tape={len(tape)} both={len(both)}")
    if only_live:
        print(f" only-live bars: {only_live[:10]}{'...' if len(only_live) > 10 else ''}")
    if only_tape:
        print(f" only-tape bars: {only_tape[:10]}{'...' if len(only_tape) > 10 else ''}")
    print(f"B OHLC mismatches: {counts['ohlc']}")
    print(f"C hard engine mismatches: {counts['hard']}")
    print(f"D allowlisted notes: {len(notes)}")
    print(f"VERDICT: {verdict}")

    if verdict == "PASS" and args.certificate_out:
        write_certificate(args, args.tape_json, args.walker_inputs_jsonl, counts, scope)
    return 0 if verdict == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
