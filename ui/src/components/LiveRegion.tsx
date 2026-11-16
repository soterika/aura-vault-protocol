/**
 * LiveRegion — Issue #63 WCAG 2.1 AA
 *
 * Invisible but screen-reader-visible container that announces dynamic
 * content changes.  Use `polite` for non-urgent updates (success messages)
 * and `assertive` for critical errors.
 *
 * Usage:
 *   const { announce } = useLiveRegion();
 *   announce("Deposit submitted successfully.");
 */

import { useCallback, useRef, useState, useEffect } from "react";

type Politeness = "polite" | "assertive";

interface Props {
  politeness?: Politeness;
  /** Optional id for targeted aria-describedby linking */
  id?: string;
}

/** Visually-hidden but accessible live region container. */
export function LiveRegion({ politeness = "polite", id }: Props) {
  const [message, setMessage] = useState("");

  // Expose imperative handle via a custom event so hook below can drive it.
  useEffect(() => {
    const handler = (e: Event) => {
      const { text } = (e as CustomEvent<{ text: string }>).detail;
      // Briefly clear then set to ensure re-announcement even for identical text.
      setMessage("");
      requestAnimationFrame(() => setMessage(text));
    };
    const key = id ? `live-region:${id}` : "live-region";
    document.addEventListener(key, handler);
    return () => document.removeEventListener(key, handler);
  }, [id]);

  return (
    <div
      id={id}
      role={politeness === "assertive" ? "alert" : "status"}
      aria-live={politeness}
      aria-atomic="true"
      style={{
        position: "absolute",
        width: 1,
        height: 1,
        overflow: "hidden",
        clip: "rect(0 0 0 0)",
        whiteSpace: "nowrap",
      }}
    >
      {message}
    </div>
  );
}

/** Hook to drive a named LiveRegion. */
export function useLiveRegion(id?: string) {
  const announce = useCallback(
    (text: string) => {
      const key = id ? `live-region:${id}` : "live-region";
      document.dispatchEvent(new CustomEvent(key, { detail: { text } }));
    },
    [id]
  );
  return { announce };
}

/** Inline hook variant — mounts its own hidden region, no separate component needed. */
export function useInlineLiveRegion(politeness: Politeness = "polite") {
  const regionRef = useRef<HTMLDivElement | null>(null);

  const regionProps = {
    role: politeness === "assertive" ? "alert" : ("status" as const),
    "aria-live": politeness,
    "aria-atomic": "true" as const,
    ref: regionRef,
    style: {
      position: "absolute" as const,
      width: 1,
      height: 1,
      overflow: "hidden" as const,
      clip: "rect(0 0 0 0)",
      whiteSpace: "nowrap" as const,
    },
  };

  const announce = useCallback((text: string) => {
    if (!regionRef.current) return;
    regionRef.current.textContent = "";
    requestAnimationFrame(() => {
      if (regionRef.current) regionRef.current.textContent = text;
    });
  }, []);

  return { announce, regionProps };
}
