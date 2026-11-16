import { useEffect, useRef, useState } from "react";

interface UseAnimatedNumberOptions {
  decimals?: number;
  duration?: number;
}

/** Ease a changing numeric value without blocking interaction. */
export function useAnimatedNumber(
  target: number,
  { decimals = 2, duration = 260 }: UseAnimatedNumberOptions = {},
): string {
  const safeTarget = Number.isFinite(target) ? target : 0;
  const [current, setCurrent] = useState(safeTarget);
  const currentRef = useRef(safeTarget);

  useEffect(() => {
    const from = currentRef.current;
    const to = safeTarget;
    if (from === to) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      currentRef.current = to;
      setCurrent(to);
      return;
    }

    let frame = 0;
    let start: number | undefined;
    const animate = (timestamp: number) => {
      start ??= timestamp;
      const progress = Math.min((timestamp - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const value = from + (to - from) * eased;
      setCurrent(value);
      if (progress < 1) frame = window.requestAnimationFrame(animate);
      else currentRef.current = to;
    };
    frame = window.requestAnimationFrame(animate);
    return () => window.cancelAnimationFrame(frame);
  }, [safeTarget, duration]);

  return current.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}
