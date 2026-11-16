# Responsive Design Guide

Mobile-first responsive design implementation for Aura Vault Protocol.

## Overview

This guide ensures all UI components work seamlessly across:
- **Mobile** (320px+)
- **Tablet** (768px+)
- **Desktop** (1024px+)
- **Wide** (1440px+)

## Breakpoints

```css
--breakpoint-mobile: 320px;   /* Mobile first */
--breakpoint-tablet: 768px;   /* Tablet and up */
--breakpoint-desktop: 1024px; /* Desktop and up */
--breakpoint-wide: 1440px;    /* Wide screens */
```

### Using Breakpoints

```tsx
// Mobile-first: write styles for mobile, then enhance for larger screens
import styles from './MyComponent.module.css';

export function MyComponent() {
  return <div className={styles.container}>Content</div>;
}
```

```css
/* Start mobile: 320px and up */
.container {
  display: grid;
  grid-template-columns: 1fr;
  gap: 16px;
}

/* Tablet: 768px and up */
@media (min-width: 768px) {
  .container {
    grid-template-columns: repeat(2, 1fr);
    gap: 24px;
  }
}

/* Desktop: 1024px and up */
@media (min-width: 1024px) {
  .container {
    grid-template-columns: repeat(3, 1fr);
    gap: 32px;
  }
}
```

## Mobile-First Principles

### 1. Start with Single Column

Mobile layouts start with one column, then expand:

```tsx
<ResponsiveGrid
  columns={{ mobile: 1, tablet: 2, desktop: 3 }}
  gap="1rem"
>
  {items.map(item => <Card key={item.id}>{item.name}</Card>)}
</ResponsiveGrid>
```

### 2. Touch-Friendly Tap Targets

All interactive elements have 44px minimum (iOS standard):

```tsx
<TouchButton>Click me</TouchButton>
{/* Automatically: min-height: 44px, min-width: 44px */}
```

Manual implementation:

```css
button {
  min-height: 44px;
  min-width: 44px;
  padding: max(8px, calc((44px - 1em) / 2)) 16px;
}
```

### 3. Full-Width Inputs on Mobile

Forms use full width on mobile for easier input:

```tsx
<Input label="Email" type="email" />
{/* Automatically full-width on mobile (< 768px) */}
```

```css
@media (max-width: 767px) {
  input {
    width: 100%;
    min-height: 44px;
    font-size: 16px; /* Prevent iOS zoom */
  }
}
```

### 4. No Horizontal Scrolling

Prevent unintended horizontal scroll:

```css
@media (max-width: 767px) {
  body,
  html {
    width: 100%;
    overflow-x: hidden;
  }

  img,
  video,
  embed,
  iframe {
    max-width: 100%;
  }
}
```

### 5. Adaptive Typography

Font sizes scale for readability:

```css
/* Mobile: 320px+ */
body { font-size: 16px; }
h1 { font-size: 28px; }
h2 { font-size: 24px; }

/* Tablet: 768px+ */
@media (min-width: 768px) {
  h1 { font-size: 32px; }
  h2 { font-size: 28px; }
}

/* Desktop: 1024px+ */
@media (min-width: 1024px) {
  h1 { font-size: 36px; }
  h2 { font-size: 32px; }
}
```

## Mobile Navigation

### Hamburger Menu Implementation

```tsx
import { MobileNav } from './components/MobileNav';

export function Header() {
  return (
    <MobileNav
      logo={<Logo />}
      items={[
        { label: 'Dashboard', href: '/' },
        { label: 'Deposit', href: '/deposit' },
        { label: 'Withdraw', href: '/withdraw' },
        { label: 'Settings', href: '/settings' }
      ]}
    >
      {/* Footer content (e.g., logout button) */}
    </MobileNav>
  );
}
```

### Desktop Navigation (Alternative)

```tsx
<nav className="ds-desktop-nav">
  <a href="/">Dashboard</a>
  <a href="/deposit">Deposit</a>
  <a href="/withdraw">Withdraw</a>
  <a href="/settings">Settings</a>
</nav>
```

Show mobile menu on small screens, desktop nav on large:

```css
.ds-desktop-nav {
  display: none;
}

@media (min-width: 768px) {
  .ds-desktop-nav {
    display: flex;
  }

  .ds-mobile-nav__toggle {
    display: none;
  }
}
```

## Touch Optimizations

### Pointer Media Features

```css
/* Touch devices (no hover, coarse pointer) */
@media (hover: none) and (pointer: coarse) {
  /* Disable hover effects */
  button:hover {
    background-color: inherit;
  }

  /* Enhance tap targets */
  button {
    min-height: 44px;
    min-width: 44px;
  }
}

/* Pointer fine devices (mouse) */
@media (hover: hover) and (pointer: fine) {
  button:hover {
    background-color: rgba(0, 0, 0, 0.05);
  }
}
```

### Fast Touch Response

```css
button {
  transition: all 100ms ease; /* < 100ms response */
  active-state should apply immediately
}

button:active {
  opacity: 0.8;
  transform: scale(0.98);
}
```

### Avoid Double-Tap Zoom

```css
/* Already set in viewport meta tag */
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5">

/* Also prevent by using 16px+ font size */
input {
  font-size: 16px; /* iOS won't zoom on focus */
}
```

## Performance Optimization

### Mobile Performance Checklist

- [ ] Images optimized (WEBP with fallback)
- [ ] Lazy load images below fold
- [ ] Critical CSS inline
- [ ] Defer non-critical JavaScript
- [ ] Minimize animations on low-end devices
- [ ] Use CSS containment for performance
- [ ] Limit re-paints with will-change

### Example: Image Optimization

```tsx
<img
  src="image.webp"
  srcSet="image.webp 1x, image-2x.webp 2x"
  alt="Description"
  loading="lazy"
  decoding="async"
/>
```

### CSS Containment

```css
.ds-card {
  contain: layout style paint;
}

.ds-list-item {
  contain: content;
}
```

### Reduced Motion Support

```css
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

## Google Mobile-Friendly Test

Checklist to pass: https://search.google.com/test/mobile-friendly

- [ ] Viewport meta tag present
- [ ] Text readable without zooming (16px+)
- [ ] Tap targets adequately spaced (44px minimum)
- [ ] No horizontal scrolling
- [ ] Clickable elements not obstructed
- [ ] Images responsive
- [ ] Mobile viewport configured

### Viewport Meta Tag

```html
<meta
  name="viewport"
  content="width=device-width, initial-scale=1, maximum-scale=5"
/>
```

## Core Web Vitals

Target scores > 90:

### 1. Largest Contentful Paint (LCP)

Target: < 2.5 seconds

```tsx
// Lazy load below-fold content
<Suspense fallback={<Skeleton />}>
  <BelowFoldContent />
</Suspense>
```

### 2. First Input Delay (FID)

Target: < 100ms

```tsx
// Use useCallback to prevent re-renders
const handleClick = useCallback(() => {
  // Fast handler
}, []);
```

### 3. Cumulative Layout Shift (CLS)

Target: < 0.1

```css
/* Reserve space for dynamic content */
.ds-skeleton {
  min-height: 20px;
  margin-bottom: 8px;
}

/* Use aspect-ratio for images */
img {
  aspect-ratio: 16 / 9;
}
```

### Monitor with Web Vitals

```typescript
import { onCLS, onFID, onLCP } from 'web-vitals';

onLCP(metric => console.log('LCP:', metric.value));
onFID(metric => console.log('FID:', metric.value));
onCLS(metric => console.log('CLS:', metric.value));
```

## Responsive Components

### Stack (Flexible Layout)

```tsx
<Stack direction="vertical" gap="md">
  <div>Item 1</div>
  <div>Item 2</div>
</Stack>

{/* On mobile: vertical, On desktop: same */}
```

### Grid (Responsive)

```tsx
<Grid columns={[1, 2, 3]} gap="1rem">
  {items.map(item => <Card key={item.id}>{item}</Card>)}
</Grid>

{/* 1 col on mobile, 2 on tablet, 3 on desktop */}
```

### Container (Constrained)

```tsx
<Container size="lg" padding centered>
  Content stays readable
</Container>

{/* Max-width on desktop, full width on mobile */}
```

### ResponsiveGrid (Auto-Responsive)

```tsx
<ResponsiveGrid
  columns={{ mobile: 1, tablet: 2, desktop: 3 }}
  minColumnWidth="280px"
>
  {cards}
</ResponsiveGrid>
```

## Responsive Forms

### Mobile-Friendly Form

```tsx
<form>
  <Stack direction="vertical" gap="md">
    <Input
      label="Full Name"
      type="text"
      required
      autoComplete="name"
    />
    <Input
      label="Email"
      type="email"
      required
      autoComplete="email"
    />
    <Select
      label="Country"
      options={countries}
      autoComplete="country-name"
    />
    <TouchButton type="submit">Submit</TouchButton>
  </Stack>
</form>
```

Best practices:
- Single column on mobile
- 16px+ font size
- 44px tap targets
- Autocomplete attributes
- Full width inputs
- Clear error messages

## Testing Responsive Design

### Browser DevTools

1. Open DevTools (F12)
2. Toggle Device Toolbar (Ctrl+Shift+M)
3. Test at:
   - iPhone SE (375px)
   - iPad (768px)
   - Desktop (1024px+)

### Automated Testing

```tsx
describe('Responsive Grid', () => {
  it('renders 1 column on mobile', () => {
    // Mock window width
    global.innerWidth = 375;
    const { container } = render(<Grid columns={[1, 2, 3]} />);
    expect(container.querySelector('.ds-grid')).toHaveStyle(
      'grid-template-columns: repeat(1, 1fr)'
    );
  });
});
```

### Performance Testing

```bash
# Lighthouse audit
npm run lighthouse -- https://localhost:3000

# Core Web Vitals
npm run web-vitals
```

## Troubleshooting

### Horizontal Scroll on Mobile

**Cause**: Element wider than viewport  
**Fix**: Add `max-width: 100%; overflow-x: auto;`

```css
table {
  max-width: 100%;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
}
```

### Text Too Small on Mobile

**Cause**: Font size < 16px  
**Fix**: Increase base font size or use responsive scaling

```css
@media (max-width: 767px) {
  body {
    font-size: 16px; /* Minimum for mobile */
  }
}
```

### Buttons Hard to Tap

**Cause**: Tap target < 44px  
**Fix**: Use TouchButton or increase padding

```tsx
<TouchButton>Tap me</TouchButton>
```

### Zooming on Input Focus (iOS)

**Cause**: Font size < 16px on input  
**Fix**: Set font-size: 16px

```css
input {
  font-size: 16px; /* Prevents iOS zoom */
}
```

## Resources

- [Mobile-Friendly Test](https://search.google.com/test/mobile-friendly)
- [Lighthouse](https://developers.google.com/web/tools/lighthouse)
- [Web Vitals](https://web.dev/vitals/)
- [MDN Responsive Design](https://developer.mozilla.org/en-US/docs/Learn/CSS/CSS_layout/Responsive_Design)
- [WCAG Mobile Accessibility](https://www.w3.org/WAI/mobile/)
