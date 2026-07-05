#!/usr/bin/env python3
"""Strict tape-vs-tape diff: same day recorded twice must be identical except
wall-clock stamps. Reports every differing JSON path (grouped by leaf key)."""
import json, sys

def walk(a, b, path, out):
    if isinstance(a, dict) and isinstance(b, dict):
        for k in set(a) | set(b):
            if k not in a or k not in b:
                out.setdefault(f'{path}.{k} (presence)', 0)
                out[f'{path}.{k} (presence)'] += 1
            else:
                walk(a[k], b[k], f'{path}.{k}', out)
    elif isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            out.setdefault(f'{path} (length {len(a)} vs {len(b)})', 0)
            out[f'{path} (length {len(a)} vs {len(b)})'] += 1
            return
        for i, (x, y) in enumerate(zip(a, b)):
            walk(x, y, f'{path}[]', out)
    else:
        if a != b:
            out.setdefault(path, 0)
            out[path] += 1

t1 = json.load(open(sys.argv[1]))
t2 = json.load(open(sys.argv[2]))
e1, e2 = t1.get('entries', []), t2.get('entries', [])
print(f'entries: run1={len(e1)} run2={len(e2)}')
out = {}
for a, b in zip(e1, e2):
    walk(a, b, 'entry', out)
# collapse array-index noise: group by path
print(f'\ndiffering paths ({len(out)} distinct):')
for p, n in sorted(out.items(), key=lambda x: -x[1])[:40]:
    print(f'  {n:5d}  {p}')
if not out:
    print('  NONE — byte-deterministic')
