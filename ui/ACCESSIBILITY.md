# Accessibility Guide - WCAG 2.1 AA Compliance

Complete guide to making Aura Vault Protocol accessible to all users.

## Overview

This guide ensures compliance with:
- **WCAG 2.1 Level AA** standards
- **ARIA 1.2** authoring practices
- **Section 508** US accessibility requirements
- **ADA** digital accessibility compliance

## Keyboard Navigation

### All Interactive Elements Keyboard Accessible

Every button, link, input, and control must be keyboard accessible:

```tsx
// ✓ Good - Native button is keyboard accessible
<button onClick={handleClick}>Click me</button>

// ✗ Bad - Div is not keyboard accessible
<div onClick={handleClick} className="fake-button">Click me</div>

// ✓ Good - If using div, add role and keyboard handlers
<div
  role="button"
  tabIndex={0}
  onClick={handleClick}
  onKeyDown={(e) => {
    if (e.key === 'Enter' || e.key === ' ') handleClick();
  }}
>
  Click me
</div>
```

### Tab Order

```tsx
// Natural tab order (in DOM order)
<form>
  <input />   {/* tabIndex 0 (default) */}
  <input />   {/* tabIndex 1 */}
  <button />  {/* tabIndex 2 */}
</form>

// Override if necessary (use sparingly)
<input tabIndex={1} />
<input tabIndex={2} />
<input tabIndex={3} />
```

### Focus Management

```tsx
import { useRef, useEffect } from 'react';

export function Modal({ isOpen, onClose }) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isOpen) {
      // Move focus to close button when modal opens
      closeButtonRef.current?.focus();
    }
  }, [isOpen]);

  return (
    <div role="dialog" aria-modal="true">
      <button ref={closeButtonRef} onClick={onClose}>
        Close
      </button>
    </div>
  );
}
```

### No Keyboard Traps

Ensure users can always escape using Tab/Escape:

```tsx
export function Dropdown() {
  const [isOpen, setIsOpen] = useState(false);

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      setIsOpen(false);
    }
    // Tab should move to next element, not trap
  };

  return (
    <div onKeyDown={handleKeyDown}>
      {/* Content */}
    </div>
  );
}
```

## ARIA - Accessible Rich Internet Applications

### ARIA Labels

```tsx
// Button with icon - add aria-label
<button aria-label="Close modal">
  <IconX />
</button>

// Input without visible label
<input aria-label="Search deposits" type="search" />

// Form field with label
<label htmlFor="email">Email:</label>
<input id="email" type="email" />
```

### ARIA Roles

```tsx
// Dialog/Modal
<div role="dialog" aria-modal="true" aria-labelledby="dialog-title">
  <h2 id="dialog-title">Confirm Action</h2>
</div>

// Alert
<div role="alert">
  Error: Insufficient funds
</div>

// Status
<div role="status" aria-live="polite">
  Deposit in progress...
</div>

// Navigation
<nav role="navigation" aria-label="Main">
  {/* Menu items */}
</nav>

// Search
<form role="search">
  {/* Search form */}
</form>
```

### ARIA Properties

```tsx
// Hidden from screen readers
<span aria-hidden="true">→</span>

// Disabled state
<button aria-disabled="true" disabled>
  Save
</button>

// Required field
<input
  aria-required="true"
  required
  aria-label="Email"
  type="email"
/>

// Invalid input with error description
<input
  aria-invalid="true"
  aria-describedby="email-error"
  type="email"
/>
<p id="email-error">Invalid email format</p>

// Expanded/collapsed (accordion, disclosure)
<button
  aria-expanded={isOpen}
  aria-controls="panel-1"
>
  More Info
</button>
<div id="panel-1" hidden={!isOpen}>
  Details...
</div>

// Busy state (loading)
<button aria-busy="true" disabled>
  Loading...
</button>

// Current page indicator
<nav>
  <a href="/">Home</a>
  <a href="/deposit" aria-current="page">Deposit</a>
  <a href="/withdraw">Withdraw</a>
</nav>
```

### Live Regions

```tsx
// Polite announcement (waits for pause)
<div role="status" aria-live="polite">
  Deposit submitted successfully
</div>

// Assertive announcement (interrupts screen reader)
<div role="alert" aria-live="assertive">
  Critical error: Connection lost
</div>

// With aria-atomic (announce whole region)
<div role="status" aria-live="polite" aria-atomic="true">
  <p>Processing: {progress}%</p>
</div>
```

## Color Contrast

### Minimum Ratios

- **4.5:1** for normal text (< 18pt or < 14pt bold)
- **3:1** for large text (≥ 18pt or ≥ 14pt bold)
- **3:1** for UI components and graphics

### Check Contrast

Use tools:
- [WebAIM Contrast Checker](https://webaim.org/resources/contrastchecker/)
- [Accessible Colors](https://accessible-colors.com/)
- Chrome DevTools built-in checker

### CSS Variables with Contrast

```css
/* Light theme - dark text on light background */
:root {
  --color-text: #000000; /* WCAG AAA */
  --color-text-secondary: #595959; /* WCAG AA */
  --color-bg: #ffffff;
  --color-primary: #0066cc; /* 4.5:1 contrast */
}

/* Dark theme - light text on dark background */
@media (prefers-color-scheme: dark) {
  :root {
    --color-text: #ffffff; /* WCAG AAA */
    --color-text-secondary: #b0b0b0; /* WCAG AA */
    --color-bg: #000000;
    --color-primary: #4399ff; /* 4.5:1 contrast */
  }
}
```

## Form Accessibility

### Labeled Inputs

```tsx
// ✓ Good - label associated with input
<label htmlFor="email">Email:</label>
<input id="email" type="email" required />

// ✗ Bad - label not associated
<label>Email:</label>
<input type="email" />

// ✓ Good - aria-label for icon-only inputs
<input
  type="search"
  aria-label="Search deposits"
  placeholder="Type to search..."
/>
```

### Error Messages

```tsx
export function FormField({ error, ...props }) {
  const errorId = useId();

  return (
    <div>
      <label htmlFor={props.id}>Email</label>
      <input
        {...props}
        type="email"
        aria-invalid={!!error}
        aria-describedby={error ? errorId : undefined}
      />
      {error && (
        <p id={errorId} role="alert" className="error">
          {error}
        </p>
      )}
    </div>
  );
}
```

### Required/Optional Indication

```tsx
// ✓ Good - indicates required with aria and visual cue
<label htmlFor="email">
  Email
  <span aria-label="required">*</span>
</label>
<input id="email" required aria-required="true" type="email" />

// ✓ Also good - aria-required alone
<input aria-required="true" required />
```

## Text Alternatives

### Images

```tsx
// ✓ Good - meaningful alt text
<img
  src="vault-diagram.png"
  alt="Aura Vault deposit flow: user deposits tokens, receives shares"
/>

// ✓ Good - decorative image hidden
<img src="icon.png" alt="" aria-hidden="true" />

// ✗ Bad - missing alt text
<img src="vault-diagram.png" />

// ✗ Bad - generic alt text
<img src="vault-diagram.png" alt="image" />
```

### Icons with Text

```tsx
// ✓ Good - icon with text label
<button>
  <IconDownload aria-hidden="true" />
  Download
</button>

// ✓ Good - icon only with aria-label
<button aria-label="Download">
  <IconDownload />
</button>

// ✗ Bad - icon only, no label
<button>
  <IconDownload />
</button>
```

## Focus Indicators

### Always Visible

```css
/* ✓ Good - always show focus */
*:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

/* ✓ Good - custom focus style with sufficient contrast */
button:focus-visible {
  outline: 2px solid var(--color-primary);
  background-color: var(--color-secondary);
}

/* ✗ Bad - removing focus indicator */
button:focus {
  outline: none; /* NEVER do this without replacing */
}
```

### Focus Order

```tsx
// ✓ Good - logical flow: left to right, top to bottom
<form>
  <input placeholder="Name" /> {/* Focus 1 */}
  <input placeholder="Email" /> {/* Focus 2 */}
  <button>Submit</button> {/* Focus 3 */}
</form>

// ✗ Bad - illogical focus order
<div style={{ display: 'flex', flexDirection: 'row-reverse' }}>
  <button>Submit</button> {/* Focus should be last, not first */}
  <input placeholder="Email" />
  <input placeholder="Name" />
</div>
```

## Semantic HTML

### Use Native Elements

```tsx
// ✓ Good - semantic HTML
<button onClick={handleClick}>Submit</button>
<a href="/deposits">View Deposits</a>
<nav>Menu</nav>
<main>Content</main>
<aside>Sidebar</aside>
<footer>Footer</footer>

// ✗ Bad - non-semantic div/span
<div onClick={handleClick} className="button">Submit</div>
<span onClick={handleNavigate} className="link">View Deposits</span>
<div className="nav">Menu</div>
```

### Heading Structure

```tsx
// ✓ Good - proper heading hierarchy
<h1>Aura Vault</h1>
<h2>Dashboard</h2>
<h3>Recent Deposits</h3>
<h3>Statistics</h3>

// ✗ Bad - skipping heading levels
<h1>Aura Vault</h1>
<h4>Dashboard</h4>
{/* h2 and h3 skipped */}
```

### Lists

```tsx
// ✓ Good - semantic list
<ul>
  <li>Deposit</li>
  <li>Withdraw</li>
  <li>Harvest</li>
</ul>

// ✗ Bad - list as divs
<div>
  <div>Deposit</div>
  <div>Withdraw</div>
  <div>Harvest</div>
</div>
```

## Animation & Motion

### Respect User Preference

```css
/* Default: animation enabled */
.spinner {
  animation: spin 1s linear infinite;
}

/* Respect prefers-reduced-motion */
@media (prefers-reduced-motion: reduce) {
  .spinner {
    animation: none;
  }

  * {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

### No Auto-Playing Media

```tsx
// ✗ Bad - auto-playing video
<video autoPlay>
  <source src="video.mp4" />
</video>

// ✓ Good - user-controlled video
<video controls>
  <source src="video.mp4" />
</video>
```

## Screen Reader Testing

### Common Issues

| Issue | Test | Solution |
|-------|------|----------|
| Missing labels | Tab to input, screen reader silent | Add `<label>` or `aria-label` |
| Generic link text | "Click here" - unclear | Use descriptive text: "View deposit details" |
| Missing alt text | Image skipped by screen reader | Add meaningful `alt` attribute |
| Non-semantic buttons | Button not announced as button | Use `<button>` or `role="button"` |
| Unmapped form errors | Error not announced | Use `role="alert"` or `aria-live` |

### Testing with Screen Readers

1. **NVDA** (Windows, free)
   ```bash
   # Download from https://www.nvaccess.org/
   # Test with keyboard navigation
   ```

2. **JAWS** (Windows/Mac, commercial)
   ```bash
   # Industry standard screen reader
   ```

3. **VoiceOver** (Mac/iOS, built-in)
   ```bash
   # Enable: Cmd + F5 on Mac
   # Enable: Settings > Accessibility > VoiceOver on iOS
   ```

### Testing Checklist

- [ ] Can navigate entire page with keyboard
- [ ] Form labels are announced correctly
- [ ] Errors are announced with `role="alert"`
- [ ] All buttons and links are announced
- [ ] Focus position is clear
- [ ] Page structure is logical (heading hierarchy)
- [ ] Images have alt text
- [ ] No keyboard traps

## Automated Testing

### Axe DevTools

```typescript
import { axe } from 'jest-axe';
import { render } from '@testing-library/react';

describe('Button Accessibility', () => {
  it('should have no accessibility violations', async () => {
    const { container } = render(<Button>Click me</Button>);
    const results = await axe(container);
    expect(results).toHaveNoViolations();
  });
});
```

### Running Tests

```bash
# Unit tests with accessibility checks
npm test

# Specific a11y tests
npm run test:a11y

# Full page audit with Lighthouse
npm run lighthouse
```

### Continuous Integration

```yaml
# .github/workflows/a11y.yml
name: Accessibility Tests
on: [push, pull_request]
jobs:
  a11y:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v2
      - run: npm install
      - run: npm run test:a11y
```

## Compliance Checklist

### Visual Design

- [ ] Color contrast ≥ 4.5:1 (AA standard)
- [ ] Text size ≥ 14px for body text
- [ ] Line height ≥ 1.5
- [ ] Letter spacing ≥ 0.12em
- [ ] Focus indicator always visible
- [ ] 44px minimum tap targets

### Keyboard Navigation

- [ ] All functions operable via keyboard
- [ ] No keyboard traps
- [ ] Focus order logical
- [ ] Tab key navigates forward
- [ ] Shift+Tab navigates backward
- [ ] Enter/Space activate buttons
- [ ] Escape closes dialogs

### ARIA & Semantic HTML

- [ ] Proper heading hierarchy
- [ ] Form inputs have labels
- [ ] Images have alt text
- [ ] Landmark regions defined
- [ ] Live regions announce updates
- [ ] Roles used correctly
- [ ] Properties/states accurate

### Screen Reader

- [ ] Page structure logical
- [ ] All text readable
- [ ] Links have descriptive text
- [ ] Form instructions clear
- [ ] Errors announced
- [ ] Confirm buttons announced

### Color & Contrast

- [ ] No information conveyed by color alone
- [ ] AAA contrast checked (≥ 7:1 for normal text)
- [ ] Dark mode variant tested
- [ ] Themes meet contrast requirements

### Motor & Touch

- [ ] 44px minimum targets
- [ ] Adequate spacing between clickables
- [ ] No double-tap required
- [ ] Pointer events supported
- [ ] Touch feedback provided

### Motion & Animation

- [ ] `prefers-reduced-motion` respected
- [ ] Auto-playing content controllable
- [ ] No flashing > 3x per second
- [ ] Animations can be paused

## Tools & Resources

### Testing Tools
- [Axe DevTools](https://www.deque.com/axe/devtools/)
- [Lighthouse](https://developers.google.com/web/tools/lighthouse)
- [WAVE](https://wave.webaim.org/extension/)
- [NVDA Screen Reader](https://www.nvaccess.org/)
- [WebAIM Contrast Checker](https://webaim.org/resources/contrastchecker/)

### Learning Resources
- [WCAG 2.1 Guidelines](https://www.w3.org/WAI/WCAG21/quickref/)
- [ARIA Authoring Guide](https://www.w3.org/WAI/ARIA/apg/)
- [MDN Accessibility](https://developer.mozilla.org/en-US/docs/Web/Accessibility)
- [A11ycasts by Google](https://www.youtube.com/playlist?list=PLNYkxOF6rcICWx0C9Xc-RgEzwLvePng7V)

### Browser Extensions
- Axe DevTools
- WAVE
- Lighthouse
- Color Contrast Analyzer
- HeadingsMap

## Support & Questions

For accessibility questions or issues:
- Check this guide first
- Review component Storybook examples
- See automated test examples
- Ask in #accessibility Slack channel
- Open accessibility issue with details
