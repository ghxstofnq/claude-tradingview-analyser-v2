#!/usr/bin/env node
// lint-tokens — flag hardcoded hex colors + off-scale px border-radii in the
// renderer CSS that bypass the DESIGN.md custom properties (the #07080a→#121212
// surface ladder, the status hues, and the --r-* radius scale). It is the
// project's own, mechanical version of the Impeccable design-system-radius /
// color checks, wired into the design-verification flow (`npm run lint:tokens`).
//
// What is exempt:
//   • Custom-property DEFINITIONS (`--surface-0: #07080a`, `--r-md: 8px`) — they
//     ARE the token source, so a hex/px there is correct, not a bypass.
//   • Non-hex color forms (rgba(), color-mix(), currentColor) — allowed.
//   • Radii expressed as var(--r-*), %, calc(), inherit — on-scale.
//
// Pre-existing, DESIGN.md-sanctioned raw values (the 7px action-pill + 3px
// keycap radii, the prototype-exact #18191a / #1c1e1f / white-CTA hexes) are
// carried in token-allowlist.json — SEEDED with the current findings so the lint
// starts GREEN and only fails on NEW raw values. After an intentional addition,
// re-seed with `--write` (and justify it in review).
//
// Usage:  node design-harness/lint-tokens.mjs [--write]   ·   npm run lint:tokens

import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const dir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dir, "..");
const cssRoot = path.join(repoRoot, "app", "renderer", "src");
const ALLOWLIST = path.join(dir, "token-allowlist.json");

// DESIGN.md `rounded` scale (px) + the two documented raw exceptions (7px action
// pills, 3px keycaps) live in the allowlist, not here — here we only encode the
// on-scale token values so anything else is surfaced.
const RADIUS_TOKENS_PX = new Set([0, 4, 6, 8, 10, 16, 9999]);

function listCss(base) {
  const out = [];
  for (const ent of readdirSync(base, { withFileTypes: true })) {
    const p = path.join(base, ent.name);
    if (ent.isDirectory()) out.push(...listCss(p));
    else if (ent.name.endsWith(".css")) out.push(p);
  }
  return out.sort();
}

// Blank comments so their contents (which routinely mention hexes) never lint.
function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
}

function findViolations(file, css) {
  const rel = path.relative(repoRoot, file);
  const src = stripComments(css);
  const out = [];
  const declRe = /([a-zA-Z-]+)\s*:\s*([^;{}]+)/g;
  let m;
  while ((m = declRe.exec(src))) {
    const prop = m[1].toLowerCase();
    const value = m[2].trim();
    if (prop.startsWith("--")) continue; // custom-property definition — the token source
    if (/#[0-9a-fA-F]{3,8}\b/.test(value)) {
      out.push({ file: rel, rule: "hardcoded-hex", decl: `${prop}: ${value.replace(/\s+/g, " ")}` });
    }
    if (prop.includes("radius")) {
      const pxs = [...value.matchAll(/(\d+(?:\.\d+)?)px/g)].map((x) => Number(x[1]));
      if (pxs.some((n) => !RADIUS_TOKENS_PX.has(n))) {
        out.push({ file: rel, rule: "off-scale-radius", decl: `${prop}: ${value.replace(/\s+/g, " ")}` });
      }
    }
  }
  return out;
}

const sigOf = (v) => `${v.file} :: ${v.rule} :: ${v.decl}`;

function scan() {
  const findings = [];
  for (const f of listCss(cssRoot)) findings.push(...findViolations(f, readFileSync(f, "utf8")));
  const counts = {};
  for (const v of findings) counts[sigOf(v)] = (counts[sigOf(v)] || 0) + 1;
  return { findings, counts, fileCount: listCss(cssRoot).length };
}

const { findings, counts, fileCount } = scan();

if (process.argv.includes("--write")) {
  const payload = {
    note:
      "Seeded pre-existing raw hex/radius values that bypass DESIGN.md tokens but are " +
      "sanctioned exceptions (prototype-exact 7px/3px radii, raw #18191a/#1c1e1f/white CTA). " +
      "`allow` maps signature -> allowed occurrence count; the lint fails on any NEW signature " +
      "or a count above the allowance. Re-seed with `node design-harness/lint-tokens.mjs --write`.",
    allow: Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b))),
  };
  writeFileSync(ALLOWLIST, JSON.stringify(payload, null, 2) + "\n");
  console.log(`wrote ${path.relative(repoRoot, ALLOWLIST)} — ${Object.keys(counts).length} signatures (${findings.length} findings)`);
  process.exit(0);
}

const allow = existsSync(ALLOWLIST) ? JSON.parse(readFileSync(ALLOWLIST, "utf8")).allow || {} : {};
const offenders = [];
for (const [s, n] of Object.entries(counts)) {
  const allowed = allow[s] || 0;
  if (n > allowed) offenders.push({ sig: s, count: n, allowed });
}

if (offenders.length) {
  console.error(`✗ token lint — ${offenders.length} raw value(s) bypassing DESIGN.md tokens:\n`);
  for (const o of offenders) {
    console.error(`  ${o.sig}${o.allowed ? `   (${o.count} > ${o.allowed} allowed)` : "   (new)"}`);
  }
  console.error(
    "\nFix: use a var(--...) token (surface ladder / status hue / --r-* radius).\n" +
    "If the raw value is an intentional DESIGN.md exception, re-seed the allowlist:\n" +
    "  node design-harness/lint-tokens.mjs --write",
  );
  process.exit(1);
}

console.log(`✓ token lint — ${findings.length} known raw values, all allowlisted; 0 new. Scanned ${fileCount} CSS files.`);
process.exit(0);
