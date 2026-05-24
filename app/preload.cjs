const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  chat: {
    send(text) {
      return ipcRenderer.invoke("chat:send_message", { text });
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
  },
  mode: {
    switch(mode) {
      return ipcRenderer.invoke("mode:switch", { mode });
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
});
