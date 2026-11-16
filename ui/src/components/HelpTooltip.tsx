/**
 * HelpTooltip
 *
 * Renders a keyboard-accessible "?" button next to a financial term.
 * Click or press Enter/Space to open a plain-language tooltip.
 * Press Escape to dismiss.
 *
 * Accessibility:
 *  - <button> receives focus via Tab
 *  - aria-describedby links trigger → tooltip content
 *  - role="tooltip" + aria-live="polite" for screen reader announcements
 *  - Escape closes and returns focus to trigger
 */

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  useId,
  type KeyboardEvent,
} from 'react';
import { helpContent, type HelpKey } from '../lib/helpContent';

export interface HelpTooltipProps {
  helpKey: HelpKey;
  /** Preferred direction. Default: 'top' */
  side?: 'top' | 'bottom' | 'left' | 'right';
  className?: string;
}

export default function HelpTooltip({
  helpKey,
  side = 'top',
  className = '',
}: HelpTooltipProps) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const tooltipId = useId();

  const entry = helpContent[helpKey];
  const close = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => setOpen((v) => !v), []);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLButtonElement>) => {
      if (e.key === 'Escape' && open) {
        close();
        triggerRef.current?.focus();
      }
    },
    [open, close],
  );

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        triggerRef.current && !triggerRef.current.contains(e.target as Node) &&
        tooltipRef.current && !tooltipRef.current.contains(e.target as Node)
      ) {
        close();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, close]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') { close(); triggerRef.current?.focus(); }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, close]);

  const positionClass: Record<typeof side, string> = {
    top:    'bottom-full mb-2 left-1/2 -translate-x-1/2',
    bottom: 'top-full mt-2 left-1/2 -translate-x-1/2',
    left:   'right-full mr-2 top-1/2 -translate-y-1/2',
    right:  'left-full ml-2 top-1/2 -translate-y-1/2',
  };

  return (
    <span
      className={`relative inline-flex items-center ${className}`}
      style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-label={`Help: ${entry.title}`}
        aria-describedby={open ? tooltipId : undefined}
        aria-expanded={open}
        onClick={toggle}
        onKeyDown={handleKeyDown}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          minWidth: 44,
          minHeight: 44,
          width: '1.4em',
          height: '1.4em',
          borderRadius: '50%',
          border: '1.5px solid currentColor',
          background: open ? 'var(--color-primary, #6c74f5)' : 'transparent',
          color: open ? '#fff' : 'inherit',
          fontSize: '0.7em',
          fontWeight: 600,
          cursor: 'pointer',
          opacity: open ? 1 : 0.65,
          transition: 'background 150ms, color 150ms, opacity 150ms',
        }}
      >
        ?
      </button>

      {open && (
        <div
          ref={tooltipRef}
          id={tooltipId}
          role="tooltip"
          aria-live="polite"
          className={`absolute z-50 w-64 rounded-lg px-3 py-2.5 shadow-lg ${positionClass[side]}`}
          style={{
            position: 'absolute',
            zIndex: 1100,
            width: 256,
            borderRadius: 8,
            padding: '10px 12px',
            background: '#1e293b',
            color: '#f1f5f9',
            boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
          }}
        >
          <p style={{ margin: 0, fontWeight: 600, fontSize: 12, color: '#fff' }}>
            {entry.title}
          </p>
          <p style={{ margin: '4px 0 0', fontSize: 12, lineHeight: 1.55, color: '#cbd5e1' }}>
            {entry.description}
          </p>
        </div>
      )}
    </span>
  );
}
