// shell-keys — map an Electron webview `before-input-event` input to a Command
// Shell global chord, or null when it isn't one of the forwarded shortcuts.
//
// When the TradingView <webview> holds DOM focus the renderer's window keydown
// never fires, so the shell's global shortcuts die. Main attaches
// before-input-event to the guest and forwards ONLY the global chord set
// (⌘/Ctrl+K, ⌘/Ctrl+J, ⇧⌘F, ⌘1-7, Esc) on keyDown — ordinary typing in the
// chart is never shipped across IPC. Pure so it's node --test-able.

const PAGE_KEYS = new Set(["1", "2", "3", "4", "5", "6", "7"]);

export function shellChordFromInput(input) {
  if (!input || input.type !== "keyDown") return null;
  const key = input.key;
  const meta = !!(input.meta || input.control);
  const shift = !!input.shift;
  const isChord =
    key === "Escape" ||
    (meta && (key === "k" || key === "K" || key === "j" || key === "J")) ||
    (meta && shift && (key === "f" || key === "F")) ||
    (meta && PAGE_KEYS.has(key));
  if (!isChord) return null;
  return {
    key,
    meta: !!input.meta,
    control: !!input.control,
    shift,
    alt: !!input.alt,
    repeat: !!input.isAutoRepeat,
  };
}
