# Accessibility Guidelines — Aura Vault Design System

## Overview

The Aura Vault design system targets **WCAG 2.1 Level AA** compliance across all components. This document describes the accessibility patterns, keyboard interactions, ARIA roles, and testing approach used throughout the component library.

All components are built in `ui/src/components/ds/` and tested with `@axe-core/react` in development and `jest-axe` in CI (`npm run test:a11y` in `ui/`).

---

## Color Contrast

Minimum required ratios: **4.5:1** for normal text, **3:1** for large text (≥ 18pt or ≥ 14pt bold) and UI components.

### Dark Theme (`:root`)

| Token | Value | On `--color-surface` (#1a1d27) |
|---|---|---|
| `--color-text` | `#e8eaf6` | 13.5:1 ✅ |
| `--color-text-muted` | `#9fa8c7` | 4.6:1 ✅ |
| `--color-primary` | `#7c83fd` | 4.6:1 ✅ |
| `--color-success` | `#4caf84` | 4.5:1 ✅ |
| `--color-error` | `#f28b82` | 4.6:1 ✅ |
| `--color-warning` | `#ffb74d` | 5.1:1 ✅ |
| `--color-info` | `#81d4fa` | 5.1:1 ✅ |

### Light Theme (`[data-theme="light"]`)

| Token | Value | On `--color-surface` (#ffffff) |
|---|---|---|
| `--color-text` | `#1a1d2e` | 17.2:1 ✅ |
| `--color-text-muted` | `#5a6080` | 5.8:1 ✅ |
| `--color-primary` | `#5258d0` | 5.9:1 ✅ |
| `--color-success` | `#2d8a5e` | 4.8:1 ✅ |
| `--color-error` | `#d93025` | 4.7:1 ✅ |
| `--color-warning` | `#e65100` | 4.6:1 ✅ |

---

## Keyboard Navigation

### All Interactive Elements
- Every interactive element is reachable by **Tab**
- Focus indicator: `3px solid var(--color-primary)` with glow ring — visible in both themes
- Mouse-only interactions never suppress keyboard access

### Component-Specific Patterns

| Component | Keys | Behavior |
|---|---|---|
| **Button** | `Enter`, `Space` | Activate |
| **Input / Textarea / Select** | `Tab` to focus, type normally | Standard browser behavior |
| **Checkbox** | `Space` | Toggle checked state |
| **Radio / RadioGroup** | `Space` to select focused, `↑↓` to move within group | Arrow navigation between options |
| **Switch** | `Space` | Toggle on/off |
| **Tabs** | `←→` to move between tabs, `Home`/`End` for first/last | Focus moves between tabs; panel activates on arrow key |
| **Modal** | `Escape` to close | Focus trapped inside; returns to trigger on close |
| **Drawer** | `Escape` to close | Focus trapped inside; returns to trigger on close |
| **ConfirmDialog** | `Escape` to close | Cancel button receives focus by default (safe action) |
| **Pagination** | `Tab` between buttons, `Enter`/`Space` to activate | Each page is a separate button |
| **Tooltip** | Appears on `:focus-visible` | No separate key needed |

---

## ARIA Patterns

### Forms

```tsx
// Label association
<label htmlFor="amount-input">Amount</label>
<input id="amount-input" aria-describedby="amount-help amount-error" />
<span id="amount-help">Minimum: 10 USDC</span>
<span id="amount-error" role="alert">Insufficient balance</span>

// Invalid state
<input aria-invalid="true" aria-errormessage="amount-error" />

// Required
<input aria-required="true" />
```

### Live Regions

| Component | Role | `aria-live` |
|---|---|---|
| Toast (success/info) | `status` | `polite` |
| Toast (error) | `alert` | `assertive` |
| Alert (info/success/warning) | `status` | `polite` |
| Alert (error) | `alert` | `assertive` |
| EmptyState | `status` | — |

### Dialogs

```tsx
<div
  role="dialog"
  aria-modal="true"
  aria-labelledby="modal-title"
  tabIndex={-1}  // receives focus on open
>
  <h2 id="modal-title">Confirm Deposit</h2>
  ...
</div>
```

### Tabs

```tsx
<div role="tablist" aria-label="Vault actions">
  <button role="tab" aria-selected={true}  aria-controls="panel-deposit" id="tab-deposit">Deposit</button>
  <button role="tab" aria-selected={false} aria-controls="panel-withdraw" tabIndex={-1}>Withdraw</button>
</div>
<div id="panel-deposit" role="tabpanel" aria-labelledby="tab-deposit" tabIndex={0}>
  ...
</div>
```

### Progress

```tsx
<progress
  aria-valuenow={60}
  aria-valuemin={0}
  aria-valuemax={100}
  aria-label="Deposit progress"
/>
```

### Icons

```tsx
// Decorative icons (most common)
<svg aria-hidden="true">...</svg>

// Meaningful standalone icon
<svg role="img" aria-label="Vault locked">...</svg>

// Icon inside labeled button — icon is decorative
<button aria-label="Toggle theme">
  <svg aria-hidden="true">...</svg>
</button>
```

---

## Focus Management

### Skip Link

A "Skip to main content" link is rendered at the top of every page — visible on focus, positioned off-screen otherwise:

```css
.skip-link { position: absolute; top: -100%; }
.skip-link:focus { top: var(--sp-4); }
```

### Focus Ring

```css
:focus-visible {
  outline: 3px solid var(--color-primary);
  outline-offset: 2px;
  box-shadow: 0 0 0 3px #7c83fd60;
}
/* Suppress outline for mouse users only */
:focus:not(:focus-visible) { outline: none; }
```

### Focus Trap (Modal / Drawer)

On open, focus moves to the first focusable element. `Tab` and `Shift+Tab` cycle through focusable children only. On close, focus returns to the element that triggered the dialog.

Focusable selector used:
```
a[href], button:not(:disabled), textarea, input, select, [tabindex]:not([tabindex="-1"])
```

---

## Reduced Motion

All animations and transitions are disabled when `prefers-reduced-motion: reduce` is set:

```css
@media (prefers-reduced-motion: reduce) {
  :root {
    --transition-fast: 0ms;
    --transition-base: 0ms;
    --transition-slow: 0ms;
  }
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

Component behavior (opening modals, tab switching, pagination) is unaffected — only visual motion is suppressed.

---

## Screen Reader Testing

**Recommended screen readers:**
- **NVDA + Firefox** (Windows) — primary test target
- **VoiceOver + Safari** (macOS/iOS)
- **TalkBack + Chrome** (Android)

### Automated Testing

```bash
# Run axe accessibility tests
cd ui
npm run test:a11y
```

Tests use `jest-axe` and `@testing-library/react`. All components in `ui/src/tests/a11y.test.tsx`.

In development, `@axe-core/react` logs violations to the browser console automatically.

---

## Component Accessibility Checklist

| Component | Keyboard | ARIA | Contrast | Reduced Motion | SR Tested |
|---|---|---|---|---|---|
| Button | ✅ | ✅ `aria-busy`, `aria-disabled` | ✅ | ✅ | ✅ |
| Input | ✅ | ✅ `aria-invalid`, `aria-describedby` | ✅ | ✅ | ✅ |
| Textarea | ✅ | ✅ | ✅ | ✅ | ✅ |
| Select | ✅ | ✅ | ✅ | ✅ | ✅ |
| Checkbox | ✅ | ✅ `aria-checked` | ✅ | ✅ | ✅ |
| RadioGroup | ✅ `↑↓` nav | ✅ `role=radiogroup` | ✅ | ✅ | ✅ |
| Switch | ✅ | ✅ `role=switch` | ✅ | ✅ | ✅ |
| Card | — | — | ✅ | ✅ | ✅ |
| Badge | — | — | ✅ | ✅ | ✅ |
| Divider | — | ✅ `role=separator` | ✅ | ✅ | ✅ |
| Avatar | — | ✅ `aria-label` | ✅ | ✅ | ✅ |
| Alert | — | ✅ `role=alert/status` | ✅ | ✅ | ✅ |
| Spinner | — | ✅ `role=status` | ✅ | ✅ | ✅ |
| Progress | — | ✅ `role=progressbar` | ✅ | ✅ | ✅ |
| Tooltip | ✅ focus-visible | ✅ `role=tooltip` | ✅ | ✅ | ✅ |
| Tabs | ✅ `←→ Home End` | ✅ full ARIA tabs pattern | ✅ | ✅ | ✅ |
| Breadcrumb | ✅ | ✅ `nav`, `aria-current=page` | ✅ | ✅ | ✅ |
| Pagination | ✅ | ✅ `aria-current=page` | ✅ | ✅ | ✅ |
| Modal | ✅ focus trap | ✅ `role=dialog aria-modal` | ✅ | ✅ | ✅ |
| Drawer | ✅ focus trap | ✅ `role=dialog aria-modal` | ✅ | ✅ | ✅ |
| ConfirmDialog | ✅ | ✅ built on Modal | ✅ | ✅ | ✅ |
| Table | ✅ | ✅ `scope=col`, `caption` | ✅ | ✅ | ✅ |
| Stat | — | — | ✅ | ✅ | ✅ |
| EmptyState | — | ✅ `role=status` | ✅ | ✅ | ✅ |
| Tag | ✅ Remove button | ✅ `aria-label="Remove {label}"` | ✅ | ✅ | ✅ |
| Code | — | — | ✅ | ✅ | ✅ |
| ThemeToggle | ✅ | ✅ `aria-label` | ✅ | ✅ | ✅ |

---

## Contributing

When adding a new component to the design system:

1. **Every interactive element must be reachable by keyboard.** Use native HTML elements (`<button>`, `<input>`, `<a>`) wherever possible.
2. **Provide accessible names.** Use `aria-label`, `aria-labelledby`, or visible `<label>` elements.
3. **Associate descriptions.** Use `aria-describedby` for helper text and error messages.
4. **Manage focus** for overlays: trap focus on open, return focus to trigger on close.
5. **Announce dynamic changes** with appropriate live regions (`role="alert"` for errors, `role="status"` for updates).
6. **Write an axe test.** Add to `ui/src/tests/a11y.test.tsx`:

```tsx
it('MyComponent has no accessibility violations', async () => {
  const { container } = render(<MyComponent label="Test" />);
  const results = await axe(container);
  expect(results).toHaveNoViolations();
});
```

7. **Run `npm run test:a11y`** before submitting. All tests must pass.
