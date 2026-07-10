// useAppErrors — capture of app:error events for the System page ANOMALIES card
// (Track 2 §2b item 5). app:error events are otherwise ephemeral in this surface
// (they flash into the chat feed and scroll away); this keeps the last N in a
// capped ring buffer so the operator can still find — and EXPLAIN — an error a
// few seconds after it fired. The buffer math is the pure pushAppError helper.
//
// SCOPE: the buffer is mount-scoped. Errors are captured only while the System
// page is mounted; unmounting the page (navigating away) drops the subscription
// AND the buffered errors, and errors that fire while the page is closed are not
// retained — they still appear in the chat feed. Red readiness blockers, by
// contrast, are always reconstructable from the live readiness object, so those
// are explainable regardless of when they occurred.

import { useCallback, useEffect, useState } from "react";
import { pushAppError, MAX_ERRORS } from "../shell/anomalies.helpers.js";

export function useAppErrors({ cap = MAX_ERRORS } = {}) {
  const [errors, setErrors] = useState([]);

  useEffect(() => {
    const off = window.api?.error?.onError?.((ev) => {
      setErrors((prev) => pushAppError(prev, ev, cap));
    });
    return () => off?.();
  }, [cap]);

  const clear = useCallback(() => setErrors([]), []);
  return { errors, clear };
}
