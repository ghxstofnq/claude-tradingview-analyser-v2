// keymap — resolve a keydown into a shell action descriptor. Pure.
//
// e:     {key, metaKey, ctrlKey, shiftKey, repeat, typing}
// state: {paletteOpen, flattenOpen, page}
//
// Precedence (prototype-faithful): global meta chords fire even while typing
// (⌘K must work from inside the palette input); bare `/` and 1–7 only when not
// typing and no palette/flatten overlay is up (an open page may be switched).

import { PAGE_ORDER } from "./shell.constants.js";

export function resolveKey(e, state = {}) {
  const meta = e.metaKey || e.ctrlKey;
  const k = e.key;

  if (meta && (k === "k" || k === "K")) return { type: "toggle-palette" };
  if (meta && (k === "j" || k === "J")) return { type: "toggle-agent" };
  if (meta && e.shiftKey && (k === "f" || k === "F")) return { type: "open-flatten" };
  if (meta && k >= "1" && k <= "7") return { type: "open-page", page: PAGE_ORDER[+k - 1] };
  if (k === "Escape") return { type: "back" };

  if (state.flattenOpen) {
    if (k === "Enter" && !e.repeat) return { type: "flatten-hold-start" };
    return null;
  }

  if (state.paletteOpen) {
    if (k === "ArrowDown") return { type: "sel", delta: 1 };
    if (k === "ArrowUp") return { type: "sel", delta: -1 };
    if (k === "Tab") return { type: "force-ask" };
    if (k === "Enter") return { type: "palette-enter" };
    return null;
  }

  if (!e.typing) {
    if (k === "/") return { type: "open-palette" };
    if (k >= "1" && k <= "7") return { type: "open-page", page: PAGE_ORDER[+k - 1] };
  }
  return null;
}
