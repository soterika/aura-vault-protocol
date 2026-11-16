/**
 * Accessibility utilities and helpers for WCAG 2.1 AA compliance.
 */

/** Generate unique IDs for ARIA associations */
export function useA11yId(prefix = 'a11y'): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

/** Announce message to screen readers */
export function announceToScreenReader(message: string, priority: 'polite' | 'assertive' = 'polite'): void {
  const region = document.createElement('div');
  region.setAttribute('role', 'status');
  region.setAttribute('aria-live', priority);
  region.setAttribute('aria-atomic', 'true');
  region.style.position = 'absolute';
  region.style.left = '-10000px';
  region.textContent = message;

  document.body.appendChild(region);

  // Remove after announcement (screen readers need time to read)
  setTimeout(() => {
    document.body.removeChild(region);
  }, 1000);
}

/** Check if element is keyboard accessible */
export function isKeyboardAccessible(element: HTMLElement): boolean {
  const tagName = element.tagName.toLowerCase();
  const isNativeButton = tagName === 'button';
  const isNativeLink = tagName === 'a' && element.hasAttribute('href');
  const isNativeInput = ['input', 'textarea', 'select'].includes(tagName);
  const hasRole = element.hasAttribute('role');
  const isTabIndexed = element.hasAttribute('tabindex');

  return isNativeButton || isNativeLink || isNativeInput || hasRole || isTabIndexed;
}

/** Get computed WCAG contrast ratio between two colors */
export function getContrastRatio(rgb1: string, rgb2: string): number {
  const getLuminance = (rgb: string) => {
    const [r, g, b] = rgb.match(/\d+/g)?.map(Number) || [0, 0, 0];
    const [rs, gs, bs] = [r, g, b].map(c => {
      const s = c / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
  };

  const l1 = getLuminance(rgb1);
  const l2 = getLuminance(rgb2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);

  return (lighter + 0.05) / (darker + 0.05);
}

/** Check if contrast ratio meets WCAG AA standards */
export function meetsContrastRequirement(ratio: number, largeText = false): boolean {
  // AA standard: 4.5:1 for normal text, 3:1 for large text
  return largeText ? ratio >= 3 : ratio >= 4.5;
}

/** Focus trap management for modals, dropdowns, etc. */
export class FocusTrap {
  private container: HTMLElement;
  private previousFocus: HTMLElement | null = null;
  private focusableElements: HTMLElement[] = [];

  constructor(container: HTMLElement) {
    this.container = container;
  }

  activate(): void {
    // Store previously focused element
    this.previousFocus = document.activeElement as HTMLElement;

    // Find all focusable elements
    this.focusableElements = this.getFocusableElements();

    // Focus first element
    if (this.focusableElements.length > 0) {
      this.focusableElements[0].focus();
    }

    // Add tab handler
    this.container.addEventListener('keydown', this.handleTabKey);
  }

  deactivate(): void {
    this.container.removeEventListener('keydown', this.handleTabKey);

    // Restore previous focus
    this.previousFocus?.focus();
  }

  private handleTabKey = (e: KeyboardEvent) => {
    if (e.key !== 'Tab') return;

    const first = this.focusableElements[0];
    const last = this.focusableElements[this.focusableElements.length - 1];
    const current = document.activeElement;

    if (e.shiftKey) {
      // Shift+Tab: move focus backward
      if (current === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      // Tab: move focus forward
      if (current === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  private getFocusableElements(): HTMLElement[] {
    const selector = [
      'a[href]',
      'button:not([disabled])',
      'input:not([disabled])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[tabindex]:not([tabindex="-1"])',
    ].join(',');

    return Array.from(this.container.querySelectorAll(selector));
  }
}

/** Validate WCAG 2.1 AA compliance for an element */
export interface A11yValidationResult {
  hasLabel: boolean;
  hasAriaLabel: boolean;
  keyboardAccessible: boolean;
  focusVisible: boolean;
  contrastOk: boolean;
  errors: string[];
}

export function validateA11y(element: HTMLElement): A11yValidationResult {
  const errors: string[] = [];
  let hasLabel = false;
  let hasAriaLabel = false;
  let keyboardAccessible = false;
  let focusVisible = false;
  let contrastOk = true;

  // Check for label
  if (element.tagName === 'INPUT') {
    hasLabel = !!document.querySelector(`label[for="${element.id}"]`);
    hasAriaLabel = element.hasAttribute('aria-label');
    if (!hasLabel && !hasAriaLabel) {
      errors.push('Input missing associated label or aria-label');
    }
  }

  // Check keyboard accessibility
  keyboardAccessible = isKeyboardAccessible(element);
  if (!keyboardAccessible && !element.hasAttribute('data-skip-a11y')) {
    errors.push('Element not keyboard accessible');
  }

  // Check focus styles
  const computedStyle = window.getComputedStyle(element, ':focus-visible');
  focusVisible = !!(computedStyle.outline !== 'none' || computedStyle.boxShadow !== 'none');

  return {
    hasLabel,
    hasAriaLabel,
    keyboardAccessible,
    focusVisible,
    contrastOk,
    errors,
  };
}

/** Get recommended ARIA label for element based on context */
export function getRecommendedAriaLabel(element: HTMLElement): string | null {
  // Check for existing labels
  if (element.hasAttribute('aria-label')) {
    return element.getAttribute('aria-label');
  }

  if (element.tagName === 'INPUT') {
    const labelElement = document.querySelector(`label[for="${element.id}"]`);
    if (labelElement) {
      return labelElement.textContent || null;
    }
  }

  // Suggest based on element type and content
  if (element.tagName === 'BUTTON') {
    return element.textContent || 'Button';
  }

  if (element.tagName === 'A') {
    return element.textContent || element.getAttribute('href');
  }

  return null;
}

/** Utility: Skip to main content link (best practice) */
export function createSkipToMainLink(): HTMLAnchorElement {
  const link = document.createElement('a');
  link.href = '#main-content';
  link.textContent = 'Skip to main content';
  link.className = 'sr-only';
  link.style.cssText = `
    position: absolute;
    top: -40px;
    left: 0;
    background: #000;
    color: #fff;
    padding: 8px;
    z-index: 100;
  `;

  link.addEventListener('focus', () => {
    link.style.top = '0';
  });

  link.addEventListener('blur', () => {
    link.style.top = '-40px';
  });

  return link;
}

/** Announce live region updates for dynamic content */
export class LiveRegion {
  private element: HTMLElement;
  private timeout: NodeJS.Timeout | null = null;

  constructor(role: 'status' | 'alert' = 'status', atomic = false) {
    this.element = document.createElement('div');
    this.element.setAttribute('role', role);
    this.element.setAttribute('aria-live', role === 'alert' ? 'assertive' : 'polite');
    if (atomic) {
      this.element.setAttribute('aria-atomic', 'true');
    }
    this.element.style.cssText = `
      position: absolute;
      left: -10000px;
      width: 1px;
      height: 1px;
      overflow: hidden;
    `;
    document.body.appendChild(this.element);
  }

  announce(message: string, clearAfter = 2000): void {
    this.element.textContent = message;

    if (this.timeout) {
      clearTimeout(this.timeout);
    }

    if (clearAfter > 0) {
      this.timeout = setTimeout(() => {
        this.element.textContent = '';
      }, clearAfter);
    }
  }

  destroy(): void {
    if (this.timeout) {
      clearTimeout(this.timeout);
    }
    this.element.remove();
  }
}

/** Test if user prefers reduced motion */
export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Test if user is on a touch device */
export function isTouchDevice(): boolean {
  return (
    typeof window !== 'undefined' &&
    (window.matchMedia('(hover: none)').matches || 'ontouchstart' in window)
  );
}
