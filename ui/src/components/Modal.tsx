/**
 * Modal — Issue #1004
 *
 * Accessible modal dialog satisfying WCAG 2.1 criteria 2.1.1 and 2.1.2:
 * - Focus trap via useFocusTrap: Tab/Shift+Tab cycle within the dialog
 * - Escape key closes the modal
 * - Focus is restored to the trigger element on close
 * - role="dialog" + aria-modal="true" + aria-labelledby for screen readers
 * - Backdrop click closes the modal; backdrop is aria-hidden
 * - No focus ever reaches elements behind the open modal
 */

import { useRef } from "react";
import { createPortal } from "react-dom";
import { useFocusTrap } from "../lib/useFocusTrap";

interface ModalProps {
  isOpen: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  /** Optional id for the title element (auto-generated if omitted) */
  titleId?: string;
}

export function Modal({ isOpen, title, onClose, children, titleId = "modal-title" }: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  // Issue #1004: full focus trap — Tab cycles within modal, focus restored on close
  useFocusTrap(dialogRef, isOpen);
  // Focus trap, initial focus, return focus on close, & Escape key
  useEffect(() => {
    if (!isOpen) return;
    // Save active element that opened the modal
    triggerRef.current = document.activeElement as HTMLElement | null;
    // Focus modal heading or first interactive element on open
    const el = dialogRef.current;
    if (el) {
      const focusableSelector =
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
      const focusables = el.querySelectorAll<HTMLElement>(focusableSelector);
      if (headingRef.current) {
        headingRef.current.focus();
      } else if (focusables.length > 0) {
        focusables[0].focus();
      } else {
        el.focus();
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      if (e.key === "Tab") {
        if (!dialogRef.current) return;
        const focusableSelector =
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
        const focusables = Array.from(
          dialogRef.current.querySelectorAll<HTMLElement>(focusableSelector)
        ).filter((elem) => elem.offsetParent !== null || elem === document.activeElement);
        if (focusables.length === 0) {
          e.preventDefault();
          return;
        }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first || !dialogRef.current.contains(document.activeElement)) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            first.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      // Return focus to trigger element on close
      triggerRef.current?.focus();
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return createPortal(
    <>
      {/* Inert backdrop — clicks close the modal but it is invisible to AT */}
      <div
        className="modal-backdrop"
        aria-hidden="true"
        onClick={onClose}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="modal"
        // tabIndex needed so the container itself is focusable when no
        // focusable children exist yet (e.g. loading state)
        tabIndex={-1}
        // Prevent backdrop clicks from propagating through the dialog
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onClose();
          }
        }}
      >
        <div className="modal-header">
          <h2 id={titleId} className="modal-title">{title}</h2>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            aria-label="Close dialog"
          >
            ×
          </button>
          <h2 id="modal-title" ref={headingRef} tabIndex={-1} className="modal-title" style={{ outline: "none" }}>{title}</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close dialog">×</button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </>,
    document.body
  );
}

export default Modal;
