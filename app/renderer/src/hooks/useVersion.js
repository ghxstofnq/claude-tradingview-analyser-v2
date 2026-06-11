// useVersion — subscribes to version:status (main-process git poll) and
// exposes { state, sha, boot_sha, restart_needed, pull_needed, behind }.
import { useEffect, useState } from "react";

export function useVersion() {
  const [status, setStatus] = useState(null);
  useEffect(() => {
    let alive = true;
    window.api?.version?.get?.().then((s) => { if (alive && s?.sha) setStatus(s); }).catch(() => {});
    const off = window.api?.version?.onUpdate?.((s) => setStatus(s));
    return () => { alive = false; off?.(); };
  }, []);
  return status;
}
