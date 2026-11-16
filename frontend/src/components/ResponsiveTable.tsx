'use client';

import { useRef, useState, useEffect, type ReactNode } from 'react';

interface ResponsiveTableProps {
  /** The <table> element (or any content) to wrap */
  children: ReactNode;
  /** Accessible label for the scroll region */
  label?: string;
  className?: string;
}

/**
 * ResponsiveTable
 *
 * Wraps a <table> in a horizontally-scrollable container with
 * gradient shadow indicators on both edges. On viewports < 640px
 * the table scrolls horizontally with smooth touch scrolling.
 * Shadows appear/disappear as the user scrolls.
 */
export default function ResponsiveTable({
  children,
  label,
  className = '',
}: ResponsiveTableProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [shadows, setShadows] = useState({ left: false, right: false });

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const update = () => {
      const { scrollLeft, scrollWidth, clientWidth } = el;
      setShadows({
        left: scrollLeft > 4,
        right: scrollLeft + clientWidth < scrollWidth - 4,
      });
    };

    update(); // check on mount
    el.addEventListener('scroll', update, { passive: true });

    // Re-check when the container resizes (e.g., viewport rotation)
    const ro = new ResizeObserver(update);
    ro.observe(el);

    return () => {
      el.removeEventListener('scroll', update);
      ro.disconnect();
    };
  }, []);

  const shadowClasses = [
    'table-scroll-container',
    shadows.left && 'has-overflow-left',
    shadows.right && 'has-overflow-right',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={`table-scroll-wrapper ${className}`}
      role="region"
      aria-label={label ?? 'Scrollable table'}
    >
      <div ref={scrollRef} className={shadowClasses}>
        {children}
      </div>
    </div>
  );
}
