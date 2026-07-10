// useCoach — on-demand weekly coach narration for the Review page (Track 2 §2b
// item 2). Reads the persisted coach.md on mount (absent → no card) and exposes
// generate() to run one on-demand turn.
//
// In-flight guard: while a generate is running the button disables — a second
// click is a no-op (the main process also rejects a concurrent turn, so this is
// belt-and-braces against queue pileup). A failure leaves the existing coach
// text untouched; the error surfaces via the app's existing app:error toast.

import { useEffect, useState, useCallback, useRef } from "react";

export function useCoach() {
  const [coach, setCoach] = useState(null); // raw coach.md text or null
  const [currentHash, setCurrentHash] = useState(null); // hash of a fresh digest
  const [inFlight, setInFlight] = useState(false);
  const inFlightRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const res = await window.api?.review?.coach?.();
      if (res?.ok) {
        setCoach(res.coach ?? null);
        setCurrentHash(res.current_hash ?? null);
      }
    } catch { /* absent → no card */ }
  }, []);

  useEffect(() => { load(); }, [load]);

  const generate = useCallback(async (limit) => {
    if (inFlightRef.current) return; // no queue pileup
    inFlightRef.current = true;
    setInFlight(true);
    try {
      const res = await window.api?.review?.generateCoach?.(limit);
      if (res?.ok && res.coach) {
        setCoach(res.coach);
        // A just-generated read is fresh by definition: the digest it was built
        // from IS the current one, so match currentHash to it (no extra fold).
        if (res.digest_hash) setCurrentHash(res.digest_hash);
      }
    } catch { /* error surfaced via app:error toast; keep existing coach */ } finally {
      inFlightRef.current = false;
      setInFlight(false);
    }
  }, []);

  return { coach, currentHash, inFlight, generate };
}
