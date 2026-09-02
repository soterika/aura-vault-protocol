import { useState, useId, type ReactNode } from "react";

export interface MobileNavProps {
  logo?: ReactNode;
  items: Array<{ label: string; href: string; icon?: ReactNode }>;
  children?: ReactNode;
}

/** Mobile navigation menu with hamburger toggle. */
export function MobileNav({ logo, items, children }: MobileNavProps) {
  const [isOpen, setIsOpen] = useState(false);
  const menuId = useId();

  return (
    <>
      {/* Mobile Menu Button */}
      <button
        className="ds-mobile-nav__toggle"
        aria-expanded={isOpen}
        aria-controls={menuId}
        aria-label="Toggle navigation menu"
      >
        <span className="ds-mobile-nav__hamburger" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
      </button>

      {/* Menu Overlay */}
      {isOpen && (
        <div
          className="ds-mobile-nav__overlay"
          onClick={() => setIsOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Mobile Menu */}
      <nav
        id={menuId}
        className={`ds-mobile-nav ${isOpen ? "ds-mobile-nav--open" : ""}`}
        role="navigation"
      >
        {logo && <div className="ds-mobile-nav__logo">{logo}</div>}

        <ul className="ds-mobile-nav__list" role="list">
          {items.map((item) => (
            <li key={item.href} role="listitem">
              <a
                href={item.href}
                className="ds-mobile-nav__link"
                onClick={() => setIsOpen(false)}
              >
                {item.icon && <span className="ds-mobile-nav__icon">{item.icon}</span>}
                <span>{item.label}</span>
              </a>
            </li>
          ))}
        </ul>

        {children && <div className="ds-mobile-nav__footer">{children}</div>}
      </nav>
    </>
  );
}

/* ── Responsive Grid ──────────────────────────────────────────────────── */
export interface ResponsiveGridProps {
  children: ReactNode;
  columns?: { mobile?: number; tablet?: number; desktop?: number };
  gap?: string;
  minColumnWidth?: string;
}

/** Responsive grid with mobile-first breakpoints. */
export function ResponsiveGrid({
  children,
  columns = { mobile: 1, tablet: 2, desktop: 3 },
  gap = "1rem",
  minColumnWidth = "280px",
}: ResponsiveGridProps) {
  return (
    <div
      className="ds-responsive-grid"
      style={
        {
          "--ds-grid-columns-mobile": columns.mobile,
          "--ds-grid-columns-tablet": columns.tablet,
          "--ds-grid-columns-desktop": columns.desktop,
          "--ds-grid-gap": gap,
          "--ds-grid-min-width": minColumnWidth,
        } as React.CSSProperties
      }
    >
      {children}
    </div>
  );
}

/* ── Touch-Friendly Button ────────────────────────────────────────────── */
export interface TouchButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
}

/** Button with 44px minimum tap target (mobile accessible). */
export function TouchButton({
  className = "",
  children,
  ...props
}: TouchButtonProps) {
  return (
    <button
      className={`ds-touch-button ${className}`}
      style={{ minHeight: "44px", minWidth: "44px" }}
      {...props}
    >
      {children}
    </button>
  );
}

/* ── Mobile Drawer ────────────────────────────────────────────────────── */
export interface MobileDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  position?: "left" | "right" | "bottom";
}

/** Mobile-optimized drawer panel. */
export function MobileDrawer({
  isOpen,
  onClose,
  title,
  children,
  position = "bottom",
}: MobileDrawerProps) {
  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div
          className="ds-drawer-backdrop"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      {/* Drawer */}
      <div
        className={`ds-mobile-drawer ds-mobile-drawer--${position} ${
          isOpen ? "ds-mobile-drawer--open" : ""
        }`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? "drawer-title" : undefined}
      >
        <div className="ds-mobile-drawer__header">
          {title && (
            <h2 id="drawer-title" className="ds-mobile-drawer__title">
              {title}
            </h2>
          )}
          <button
            className="ds-mobile-drawer__close"
            onClick={onClose}
            aria-label="Close drawer"
          >
            ✕
          </button>
        </div>
        <div className="ds-mobile-drawer__content">{children}</div>
      </div>
    </>
  );
}

/* ── Sticky Header ────────────────────────────────────────────────────── */
export interface StickyHeaderProps {
  children: ReactNode;
  scrollThreshold?: number;
}

/** Header that sticks to top on mobile scroll. */
export function StickyHeader({
  children,
  scrollThreshold = 50,
}: StickyHeaderProps) {
  const [isSticky, setIsSticky] = useState(false);

  React.useEffect(() => {
    const handleScroll = () => {
      setIsSticky(window.scrollY > scrollThreshold);
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [scrollThreshold]);

  return (
    <header
      className={`ds-sticky-header ${isSticky ? "ds-sticky-header--stuck" : ""}`}
    >
      {children}
    </header>
  );
}
