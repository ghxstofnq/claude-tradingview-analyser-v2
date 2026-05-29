const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  claude: {
    // Cross-purpose activity stream — fires for every event from any
    // userTurn (brief, wrap, bar-close, chat, review, catch-up, shutdown).
    // Used by the CLAUDE popover to show what Claude is doing globally,
    // not just in the interactive chat conversation.
    onActivity(cb) {
      const listener = (_e, ev) => cb(ev);
      ipcRenderer.on("claude:activity", listener);
      return () => ipcRenderer.removeListener("claude:activity", listener);
    },
  },
  chat: {
    send(text, options = {}) {
      return ipcRenderer.invoke("chat:send_message", { text, provider: options.provider });
    },
    cancel() {
      return ipcRenderer.invoke("chat:cancel_turn");
    },
    reset() {
      return ipcRenderer.invoke("chat:reset");
    },
    onChunk(cb) {
      const listener = (_e, ev) => cb(ev);
      ipcRenderer.on("chat:chunk", listener);
      return () => ipcRenderer.removeListener("chat:chunk", listener);
    },
    onToolCall(cb) {
      const listener = (_e, ev) => cb(ev);
      ipcRenderer.on("chat:tool_call", listener);
      return () => ipcRenderer.removeListener("chat:tool_call", listener);
    },
    onTurnComplete(cb) {
      const listener = (_e, ev) => cb(ev);
      ipcRenderer.on("chat:turn_complete", listener);
      return () => ipcRenderer.removeListener("chat:turn_complete", listener);
    },
    onQueued(cb) {
      const listener = (_e, ev) => cb(ev);
      ipcRenderer.on("chat:queued", listener);
      return () => ipcRenderer.removeListener("chat:queued", listener);
    },
    onQueueReady(cb) {
      const listener = (_e, ev) => cb(ev);
      ipcRenderer.on("chat:queue_ready", listener);
      return () => ipcRenderer.removeListener("chat:queue_ready", listener);
    },
  },
  trade: {
    accept(setup) {
      return ipcRenderer.invoke("trade:accept", { setup });
    },
    reject(setupId, reason) {
      return ipcRenderer.invoke("trade:reject", { setupId, reason });
    },
    list() {
      return ipcRenderer.invoke("trades:list");
    },
    onAccepted(cb) {
      const listener = (_e, ev) => cb(ev);
      ipcRenderer.on("trade:accepted", listener);
      return () => ipcRenderer.removeListener("trade:accepted", listener);
    },
    onRejected(cb) {
      const listener = (_e, ev) => cb(ev);
      ipcRenderer.on("trade:rejected", listener);
      return () => ipcRenderer.removeListener("trade:rejected", listener);
    },
    onOutcome(cb) {
      const listener = (_e, ev) => cb(ev);
      ipcRenderer.on("trade:outcome", listener);
      return () => ipcRenderer.removeListener("trade:outcome", listener);
    },
  },
  bar: {
    onClose(cb) {
      const listener = (_e, ev) => cb(ev);
      ipcRenderer.on("bar:close", listener);
      return () => ipcRenderer.removeListener("bar:close", listener);
    },
  },
  health: {
    onUpdate(cb) {
      const listener = (_e, ev) => cb(ev);
      ipcRenderer.on("health:update", listener);
      return () => ipcRenderer.removeListener("health:update", listener);
    },
  },
  detector: {
    start() { return ipcRenderer.invoke("detector:start"); },
    stop()  { return ipcRenderer.invoke("detector:stop"); },
  },
  walkers: {
    onState(cb) {
      const listener = (_e, ev) => cb(ev);
      ipcRenderer.on("walkers:state", listener);
      return () => ipcRenderer.removeListener("walkers:state", listener);
    },
  },
  alert: {
    arm(price, label) {
      return ipcRenderer.invoke("alert:arm", { price, label });
    },
    disarm(id) {
      return ipcRenderer.invoke("alert:disarm", { id });
    },
    onFired(cb) {
      const listener = (_e, ev) => cb(ev);
      ipcRenderer.on("alert:fired", listener);
      return () => ipcRenderer.removeListener("alert:fired", listener);
    },
    onState(cb) {
      const listener = (_e, ev) => cb(ev);
      ipcRenderer.on("alerts:state", listener);
      return () => ipcRenderer.removeListener("alerts:state", listener);
    },
  },
  prep: {
    get() {
      return ipcRenderer.invoke("prep:get");
    },
    refresh() {
      return ipcRenderer.invoke("prep:run");
    },
    recap() {
      return ipcRenderer.invoke("prep:recap_get");
    },
    priorBrief(session, excludeDate) {
      return ipcRenderer.invoke("prep:prior_brief_get", { session, excludeDate });
    },
    resetPairDecision() {
      return ipcRenderer.invoke("pair-decision:reset");
    },
    openReaction(session) {
      return ipcRenderer.invoke("prep:open_reaction_get", { session });
    },
    onUpdated(cb) {
      const listener = (_e, ev) => cb(ev);
      ipcRenderer.on("prep:brief_updated", listener);
      return () => ipcRenderer.removeListener("prep:brief_updated", listener);
    },
    onStatus(cb) {
      const listener = (_e, ev) => cb(ev);
      ipcRenderer.on("prep:status", listener);
      return () => ipcRenderer.removeListener("prep:status", listener);
    },
  },
  setups: {
    list(session, limit) {
      return ipcRenderer.invoke("live:setups_list", { session, limit });
    },
    current() {
      return ipcRenderer.invoke("setup:current");
    },
    clear() {
      return ipcRenderer.invoke("setup:clear");
    },
  },
  review: {
    listSessions() {
      return ipcRenderer.invoke("review:list_sessions");
    },
    journal(date, session) {
      return ipcRenderer.invoke("review:get_journal", { date, session });
    },
    library(limit) {
      return ipcRenderer.invoke("review:library", { limit });
    },
    exportSession(date, session) {
      return ipcRenderer.invoke("review:export_session", { date, session });
    },
  },
  memory: {
    // Read-only view of state/memory/{USER,MEMORY}.md for the REVIEW
    // page's agent-state panel. Mutations always go through the model
    // via the memory MCP tool.
    read() {
      return ipcRenderer.invoke("memory:read");
    },
  },
  usage: {
    // Today's spend roll-up — by-purpose, by-model breakdown of cost +
    // tokens. Read from metrics.jsonl filtered to today's ET date.
    today() {
      return ipcRenderer.invoke("usage:today");
    },
  },
  status: {
    lastBar() {
      return ipcRenderer.invoke("status:last_bar_get");
    },
  },
  quote: {
    cache() {
      return ipcRenderer.invoke("quote:cache_get");
    },
  },
  files: {
    list() {
      return ipcRenderer.invoke("files:list");
    },
    open(p) {
      return ipcRenderer.invoke("files:open", { path: p });
    },
    reveal(p) {
      return ipcRenderer.invoke("files:reveal", { path: p });
    },
    read(p) {
      return ipcRenderer.invoke("files:read", { path: p });
    },
  },
  error: {
    onError(cb) {
      const listener = (_e, ev) => cb(ev);
      ipcRenderer.on("app:error", listener);
      return () => ipcRenderer.removeListener("app:error", listener);
    },
  },
  calendar: {
    thisWeek() {
      return ipcRenderer.invoke("calendar:this-week");
    },
    onUpdate(cb) {
      const listener = (_e, ev) => cb(ev);
      ipcRenderer.on("calendar:update", listener);
      return () => ipcRenderer.removeListener("calendar:update", listener);
    },
  },
  backtest: {
    start(cfg) {
      return ipcRenderer.invoke("backtest:start", cfg);
    },
    stop() {
      return ipcRenderer.invoke("backtest:stop");
    },
    decision({ choice, setupId, reason } = {}) {
      return ipcRenderer.invoke("backtest:decision", { choice, setupId, reason });
    },
    list() {
      return ipcRenderer.invoke("backtest:list");
    },
    get({ runId }) {
      return ipcRenderer.invoke("backtest:get", { runId });
    },
    delete({ runId }) {
      return ipcRenderer.invoke("backtest:delete", { runId });
    },
    status() {
      return ipcRenderer.invoke("backtest:status");
    },
    onEvent(cb) {
      const listener = (_e, ev) => cb(ev);
      ipcRenderer.on("backtest:event", listener);
      return () => ipcRenderer.removeListener("backtest:event", listener);
    },
  },
});
