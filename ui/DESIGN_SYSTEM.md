# Aura Vault Design System

Comprehensive component library and design guidelines for consistent UI across Aura Vault Protocol.

## Overview

The design system provides:
- **20+ reusable components** with TypeScript types
- **Color palette & typography** system with dark/light theme support
- **Spacing & layout grid** for consistent alignment
- **Icon library** (60+ icons)
- **Accessibility-first** design meeting WCAG 2.1 AA
- **Storybook** for interactive documentation

## Design Tokens

### Colors

#### Semantic Colors

| Variable | Light | Dark | Purpose |
|----------|-------|------|---------|
| `--color-primary` | #007AFF | #0A84FF | Primary actions, links |
| `--color-success` | #34C759 | #30B0C0 | Positive states, confirmations |
| `--color-warning` | #FF9500 | #FFB81C | Caution, warnings |
| `--color-error` | #FF3B30 | #FF453A | Errors, destructive actions |
| `--color-info` | #5856D6 | #5B5BFF | Informational messages |

#### Neutral Colors

| Variable | Light | Dark |
|----------|-------|------|
| `--color-text-primary` | #000000 | #FFFFFF |
| `--color-text-secondary` | #666666 | #A0A0A0 |
| `--color-bg-primary` | #FFFFFF | #1A1A1A |
| `--color-bg-secondary` | #F5F5F5 | #2D2D2D |
| `--color-border` | #E0E0E0 | #404040 |

### Typography

#### Font Family
- **Primary**: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif
- **Mono**: "SF Mono", Monaco, "Cascadia Code", Menlo, monospace

#### Font Scales

| Style | Size | Weight | Line Height | Letter Spacing |
|-------|------|--------|-------------|----------------|
| Display | 32px | 700 | 1.2 | -0.5px |
| Heading 1 | 28px | 700 | 1.3 | 0 |
| Heading 2 | 24px | 600 | 1.4 | 0 |
| Heading 3 | 20px | 600 | 1.4 | 0 |
| Body | 16px | 400 | 1.5 | 0 |
| Body Small | 14px | 400 | 1.5 | 0 |
| Label | 12px | 600 | 1.4 | 0.5px |
| Mono | 13px | 400 | 1.6 | 0 |

### Spacing

8px base unit grid:

| Token | Value |
|-------|-------|
| `--space-0` | 0px |
| `--space-1` | 4px |
| `--space-2` | 8px |
| `--space-3` | 12px |
| `--space-4` | 16px |
| `--space-5` | 20px |
| `--space-6` | 24px |
| `--space-7` | 28px |
| `--space-8` | 32px |
| `--space-12` | 48px |
| `--space-16` | 64px |

### Border Radius

| Token | Value | Use Case |
|-------|-------|----------|
| `--radius-none` | 0px | Sharp corners |
| `--radius-sm` | 4px | Inputs, small elements |
| `--radius-md` | 8px | Cards, buttons (default) |
| `--radius-lg` | 12px | Modals, panels |
| `--radius-full` | 9999px | Badges, pills |

### Shadows

| Token | Value | Use Case |
|-------|-------|----------|
| `--shadow-none` | none | No elevation |
| `--shadow-sm` | 0 1px 2px rgba(0,0,0,0.05) | Subtle hover states |
| `--shadow-md` | 0 4px 6px rgba(0,0,0,0.1) | Card elevation |
| `--shadow-lg` | 0 10px 15px rgba(0,0,0,0.2) | Modal, popover |
| `--shadow-xl` | 0 20px 25px rgba(0,0,0,0.25) | Dropdown, tooltip |

## Components

### Core Components

#### Button
```tsx
<Button variant="primary" size="md" loading={false}>
  Click me
</Button>
```

**Variants**: `primary`, `secondary`, `ghost`, `danger`  
**Sizes**: `sm`, `md`, `lg`  
**Props**: `loading`, `leftIcon`, `rightIcon`, `disabled`  
**Accessibility**: Full keyboard support, ARIA busy state

---

#### Input
```tsx
<Input 
  type="text"
  placeholder="Enter value"
  label="Email"
  error="Invalid email"
  required
/>
```

**Types**: `text`, `email`, `number`, `password`, `tel`, `url`  
**Props**: `label`, `error`, `hint`, `disabled`, `required`, `maxLength`  
**Accessibility**: `<label>` association, error announcements

---

#### Card
```tsx
<Card padding="md" elevated>
  Card content
</Card>
```

**Padding**: `sm`, `md`, `lg`  
**Props**: `elevated` (adds shadow)  
**Use for**: Grouping related content, separating sections

---

#### Modal
```tsx
<Modal 
  isOpen={isOpen}
  onClose={handleClose}
  title="Confirm Action"
>
  Are you sure?
</Modal>
```

**Props**: `isOpen`, `onClose`, `title`, `size`, `isDismissable`  
**Sizes**: `sm`, `md`, `lg`  
**Accessibility**: Focus trap, escape key support, backdrop click

---

#### Badge
```tsx
<Badge variant="success">Active</Badge>
```

**Variants**: `default`, `primary`, `success`, `warning`, `error`, `info`  
**Accessibility**: `role="status"` for screen readers

---

#### Spinner
```tsx
<Spinner size="md" label="Loading…" />
```

**Sizes**: `sm`, `md`, `lg`  
**Props**: `label` (screen reader text)  
**Accessibility**: Full ARIA live region support

---

### Form Components

#### Checkbox
```tsx
<Checkbox 
  label="I agree"
  checked={checked}
  onChange={setChecked}
  error={error}
/>
```

#### Radio
```tsx
<Radio 
  name="option"
  value="a"
  label="Option A"
  checked={value === 'a'}
  onChange={handleChange}
/>
```

#### Select
```tsx
<Select
  label="Choose option"
  options={[
    { value: '1', label: 'Option 1' },
    { value: '2', label: 'Option 2' }
  ]}
  value={selected}
  onChange={setSelected}
/>
```

#### Textarea
```tsx
<Textarea
  label="Comments"
  placeholder="Enter your feedback"
  rows={4}
  maxLength={500}
/>
```

#### Toggle
```tsx
<Toggle
  label="Enable notifications"
  checked={enabled}
  onChange={setEnabled}
/>
```

---

### Layout Components

#### Stack
```tsx
<Stack direction="vertical" gap="md">
  <div>Item 1</div>
  <div>Item 2</div>
</Stack>
```

**Direction**: `horizontal`, `vertical`  
**Gap**: `sm`, `md`, `lg`

#### Grid
```tsx
<Grid columns={3} gap="lg">
  {items.map(item => <div key={item.id}>{item.name}</div>)}
</Grid>
```

**Props**: `columns`, `gap`, `autoRows`

#### Flex
```tsx
<Flex justifyContent="space-between" alignItems="center">
  <div>Left</div>
  <div>Right</div>
</Flex>
```

#### Container
```tsx
<Container size="lg" padding>
  Constrained content
</Container>
```

**Sizes**: `sm`, `md`, `lg`, `xl`

---

### Data Display

#### Table
```tsx
<Table
  columns={[
    { key: 'name', label: 'Name' },
    { key: 'amount', label: 'Amount', align: 'right' }
  ]}
  rows={data}
/>
```

**Accessibility**: Proper `<table>` semantics, sortable headers

#### List
```tsx
<List
  items={items}
  renderItem={item => <div>{item.name}</div>}
/>
```

#### Card Grid
```tsx
<CardGrid columns={3}>
  {items.map(item => <Card key={item.id}>{item.title}</Card>)}
</CardGrid>
```

---

### Feedback Components

#### Alert
```tsx
<Alert 
  variant="error"
  title="Error"
  dismissible
>
  Something went wrong
</Alert>
```

**Variants**: `info`, `success`, `warning`, `error`

#### Toast/Notification
```tsx
toast.success('Operation completed', { duration: 3000 });
```

#### Skeleton
```tsx
<Skeleton width="100%" height="20px" />
```

#### Progress
```tsx
<Progress value={65} max={100} />
```

#### Stepper
```tsx
<Stepper 
  steps={['Step 1', 'Step 2', 'Step 3']}
  activeStep={1}
/>
```

---

### Navigation

#### Tabs
```tsx
<Tabs 
  tabs={[
    { id: 'tab1', label: 'Tab 1', content: <div>Content 1</div> },
    { id: 'tab2', label: 'Tab 2', content: <div>Content 2</div> }
  ]}
/>
```

#### Breadcrumb
```tsx
<Breadcrumb items={[
  { label: 'Home', href: '/' },
  { label: 'Settings', href: '/settings' },
  { label: 'Profile', current: true }
]} />
```

#### Pagination
```tsx
<Pagination
  current={page}
  total={totalPages}
  onPageChange={setPage}
/>
```

---

### Overlay Components

#### Tooltip
```tsx
<Tooltip content="Help text">
  <Button>Hover me</Button>
</Tooltip>
```

#### Popover
```tsx
<Popover 
  content={<div>Menu items</div>}
  trigger="click"
>
  <Button>Open Menu</Button>
</Popover>
```

#### Drawer
```tsx
<Drawer
  isOpen={isOpen}
  onClose={handleClose}
  position="left"
>
  Drawer content
</Drawer>
```

---

### Icons

All icons (60+) available from `./Icons.tsx`:

```tsx
import { 
  IconChevronRight, 
  IconSettings,
  IconCheck,
  IconX,
  IconAlertCircle,
  IconLoading
} from './Icons';
```

**Icon sizes**: All icons scale based on parent font-size

---

## Usage Patterns

### Theme Switching
```tsx
import { ThemeProvider } from './ThemeProvider';

<ThemeProvider defaultTheme="light">
  <App />
</ThemeProvider>
```

### Responsive Design
```tsx
<Grid columns={[1, 2, 3]} gap={['sm', 'md', 'lg']}>
  {/* 1 col on mobile, 2 on tablet, 3 on desktop */}
</Grid>
```

### Accessibility Checklist

Before using a component:
- [ ] Labels associated with form inputs
- [ ] Color not sole indicator of meaning
- [ ] Sufficient contrast ratio (4.5:1 minimum)
- [ ] Keyboard navigation supported
- [ ] ARIA attributes appropriate
- [ ] Focus visible on interactive elements

## Storybook

View interactive component documentation:

```bash
npm run storybook
# Opens http://localhost:6006
```

Each component has:
- Multiple usage examples
- Props documentation
- Accessibility guidelines
- Dark mode preview
- Mobile responsive preview

## File Structure

```
ui/src/
├── components/
│   ├── Button.tsx
│   ├── Input.tsx
│   ├── Card.tsx
│   ├── Modal.tsx
│   ├── Primitives.tsx
│   ├── Icons.tsx
│   ├── ...
│   └── index.ts (exports all)
├── stories/
│   ├── Button.stories.tsx
│   ├── Form.stories.tsx
│   ├── Layout.stories.tsx
│   └── ...
├── styles/
│   ├── tokens.css (design tokens)
│   ├── components.css (component styles)
│   └── global.css (global styles)
└── lib/
    └── theme.ts (theme utilities)
```

## Adding New Components

1. **Create component** in `src/components/NewComponent.tsx`
2. **Add types** with clear prop interface
3. **Implement accessibility** (ARIA, keyboard nav)
4. **Export from** `src/components/index.ts`
5. **Create story** in `src/stories/NewComponent.stories.tsx`
6. **Document** in this file
7. **Test** in Storybook and automated tests

## Best Practices

✓ Use design tokens (CSS variables) not hardcoded values  
✓ Ensure components work in both light and dark themes  
✓ Test with keyboard navigation  
✓ Include alt text for icons/images  
✓ Use semantic HTML (`<button>` not `<div>` for buttons)  
✓ Document accessibility features in Storybook  
✓ Keep components focused and composable  
✓ Follow TypeScript strict mode  

## Resources

- [Storybook](http://localhost:6006) - Component playground
- [Web Accessibility](https://www.w3.org/WAI/) - WCAG 2.1 guidelines
- [Design Tokens](https://www.designtokens.org/) - Token specification
- Figma design file: [Link to design]

## Support

Questions about components or design decisions?
- Check component story in Storybook
- Review component source code comments
- See accessibility test in `src/tests/a11y.test.tsx`
- Ask in #design-system Slack channel
