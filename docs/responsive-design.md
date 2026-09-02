# Responsive Design — Aura Vault Protocol

Mobile-first design guidelines and viewport specifications for all Aura frontend surfaces.

---

## Breakpoints

| Name | Min width | Target devices |
|---|---|---|
| `xs` | 320px | Small phones (iPhone SE) |
| `sm` | 480px | Large phones |
| `md` | 768px | Tablets, landscape phones |
| `lg` | 1024px | Small laptops, large tablets |
| `xl` | 1280px | Desktops |
| `2xl` | 1440px | Large monitors |

CSS custom media queries:

```css
/* mobile-first — add complexity upward */
@custom-media --sm  (min-width: 480px);
@custom-media --md  (min-width: 768px);
@custom-media --lg  (min-width: 1024px);
@custom-media --xl  (min-width: 1280px);
```

---

## Layout Behavior per Viewport

### Vault Dashboard (main page)

| Viewport | Layout |
|---|---|
| `xs`–`sm` | Single column; StatCards stack vertically; action buttons full-width |
| `md` | Two-column: StatCards in 2-up grid; action panel below |
| `lg`+ | Three-column: sidebar nav + main content + activity panel |

### Deposit / Withdraw Panels

| Viewport | Layout |
|---|---|
| `xs`–`sm` | Full-screen modal sheet sliding from bottom |
| `md`+ | Centered modal dialog (560px max-width) |

### Navigation

| Viewport | Layout |
|---|---|
| `xs`–`md` | Bottom tab bar (4 tabs max); hamburger for secondary items |
| `lg`+ | Left sidebar (240px), collapsible to icon-only (64px) |

---

## Touch Interaction Requirements

- All tap targets: minimum **44×44px** (WCAG 2.5.5 AAA; Apple HIG requirement)
- Spacing between adjacent tap targets: minimum **8px** to prevent mis-taps
- Swipe-to-dismiss on bottom sheet modals
- No hover-only interactions — every hover state must have a tap equivalent
- Long-press is not used for any primary action (not discoverable on mobile)
- Touch feedback (`:active` state) responds within **50ms**

---

## Performance Budget (Mobile)

Core Web Vitals targets for the vault dashboard on a mid-range Android device (Moto G Power, throttled 4G):

| Metric | Target |
|---|---|
| LCP (Largest Contentful Paint) | < 2.5s |
| FID / INP (Interaction to Next Paint) | < 100ms |
| CLS (Cumulative Layout Shift) | < 0.1 |
| TTI (Time to Interactive) | < 4s |
| Total JS bundle (initial) | < 200KB gzipped |
| Total page weight | < 500KB |

### Techniques to hit the budget

- Code-split by route; vault dashboard loads independently of history/settings
- Skeleton screens instead of spinner overlays — no layout shift on data load
- Token logos: SVG sprites or 32px WebP with explicit `width`/`height` attributes
- Avoid loading Storybook or dev dependencies in production bundle
- Preconnect to the Stellar Horizon RPC endpoint in `<head>`
- `font-display: swap` on Inter to avoid invisible text during font load

---

## No Horizontal Scroll

All pages must pass the "no horizontal scrolling" requirement at all breakpoints:

- Never set `width` greater than `100vw` on any block-level element
- Use `overflow-x: hidden` on `<body>` as a safety net, but fix root causes
- Tables on mobile: horizontally scrollable within a `max-width: 100%` container with a visible scroll indicator — the page itself does not scroll horizontally
- Long wallet addresses: always truncate with CSS (`text-overflow: ellipsis; overflow: hidden`) or show a shortened form (first 6 + last 4 chars)

---

## Mobile Navigation

Bottom tab bar specification (xs–md):

```
┌──────────────────────────────┐
│  Dashboard                   │  ← page content
│                              │
│                              │
├──────┬──────┬──────┬─────────┤  ← bottom nav bar (56px height)
│  🏠  │  💰  │  📊  │   ⚙️   │
│Vault │ Trade│History│Settings│
└──────┴──────┴──────┴─────────┘
```

- Bar height: 56px + safe area inset (accounts for iPhone home indicator)
- Active tab: `--color-brand-primary` icon + label
- Inactive tab: `--color-neutral-600` icon + label
- Selected state communicated via both color and a top border indicator (not color alone)

---

## Responsive Component Overrides

### StatCard (mobile)

- Remove delta percentage on `xs` to save space; show on `sm`+
- Reduce padding from `--space-4` to `--space-3`
- Value font size drops from `--text-3xl` to `--text-2xl`

### TokenAmountInput (mobile)

- Max button becomes an icon-only button (32×32px) with `aria-label="Set maximum amount"`
- Token logo + symbol collapse to symbol-only below `sm`

### TransactionStatus (mobile)

- Transaction hash is always truncated to 8 + 8 chars with a copy button
- "View on explorer" opens in an in-app browser if available, else new tab

### DataTable (transaction history)

Mobile column priority (hide lowest-priority columns first as viewport shrinks):

| Priority | Column | Hidden below |
|---|---|---|
| 1 | Type (deposit/withdraw) | never |
| 2 | Amount | never |
| 3 | Date | `xs` (show relative time only) |
| 4 | Transaction hash | `sm` |
| 5 | Status | `md` (inline with Type on mobile) |

---

## Testing Checklist

Before any release, verify on these target profiles:

| Device profile | Viewport | OS |
|---|---|---|
| iPhone SE 3rd gen | 375×667 | iOS 17 |
| iPhone 15 Pro | 393×852 | iOS 17 |
| Samsung Galaxy S23 | 360×780 | Android 14 |
| iPad 10th gen | 820×1180 | iPadOS 17 |
| 13" MacBook | 1280×800 | macOS |
| 27" desktop | 1920×1080 | Windows / macOS |

Automated checks (run in CI via Playwright):

```bash
# Runs viewport tests across all breakpoints
npm run test:responsive
```

Manual checks:
- [ ] Google Mobile-Friendly Test passes
- [ ] No horizontal scroll at 320px width
- [ ] All tap targets ≥ 44px (Chrome DevTools → Rendering → Show layout shift regions)
- [ ] Lighthouse mobile score > 90 (Performance, Accessibility, Best Practices, SEO)
- [ ] VoiceOver (iOS) and TalkBack (Android) can navigate the deposit flow
