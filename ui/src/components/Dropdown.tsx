/**
 * Dropdown — Issue #1004
 *
 * Accessible dropdown menu following the WAI-ARIA Menu Button pattern:
 * https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/
 *
 * Keyboard behaviour:
 * - Enter / Space / ArrowDown on trigger: opens menu, focuses first item
 * - ArrowUp on trigger: opens menu, focuses last item
 * - ArrowDown / ArrowUp: navigate between menu items
 * - Home: focus first item
 * - End: focus last item
 * - Enter: select focused item, close menu
 * - Escape / Tab: close menu, return focus to trigger
 * - Typeahead: first match for typed character
 *
 * Screen reader: role="menu" + role="menuitem" + aria-haspopup + aria-expanded
 */

import {
  useRef,
  useState,
  useCallback,
  useId,
  type KeyboardEvent,
  type ReactNode,
} from "react";

export interface DropdownItem {
  /** Unique key for this item */
  key: string;
  /** Display label */
  label: string;
  /** Whether the item is disabled */
  disabled?: boolean;
  /** Optional icon or leading element */
  icon?: ReactNode;
}

export interface DropdownProps {
  /** The trigger element label */
  triggerLabel: ReactNode;
  /** Menu items */
  items: DropdownItem[];
  /** Called when an item is selected */
  onSelect: (key: string) => void;
  /** Optional extra class on the wrapper */
  className?: string;
  /** Placement hint (CSS handled externally) */
  placement?: "bottom-start" | "bottom-end";
}

export function Dropdown({
  triggerLabel,
  items,
  onSelect,
  className = "",
}: DropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);
  const menuId = useId();
  const triggerId = useId();

  const enabledItems = items.filter((i) => !i.disabled);

  const openMenu = useCallback((startIndex = 0) => {
    setIsOpen(true);
    setFocusedIndex(startIndex);
    // Let the DOM update before focusing
    requestAnimationFrame(() => {
      const items = menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])');
      items?.[startIndex]?.focus();
    });
  }, []);

  const closeMenu = useCallback((returnFocus = true) => {
    setIsOpen(false);
    setFocusedIndex(-1);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  const selectItem = useCallback(
    (key: string) => {
      onSelect(key);
      closeMenu(true);
    },
    [onSelect, closeMenu]
  );

  // ── Trigger keyboard handler ──────────────────────────────────────────────

  function handleTriggerKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    switch (e.key) {
      case "Enter":
      case " ":
      case "ArrowDown":
        e.preventDefault();
        openMenu(0);
        break;
      case "ArrowUp":
        e.preventDefault();
        openMenu(enabledItems.length - 1);
        break;
    }
  }

  // ── Menu keyboard handler ─────────────────────────────────────────────────

  function handleMenuKeyDown(e: KeyboardEvent<HTMLUListElement>) {
    const menuItems = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? []
    );
    const count = menuItems.length;
    if (count === 0) return;

    const current = menuItems.findIndex((el) => el === document.activeElement);

    switch (e.key) {
      case "ArrowDown": {
        e.preventDefault();
        const next = (current + 1) % count;
        menuItems[next].focus();
        setFocusedIndex(next);
        break;
      }
      case "ArrowUp": {
        e.preventDefault();
        const prev = (current - 1 + count) % count;
        menuItems[prev].focus();
        setFocusedIndex(prev);
        break;
      }
      case "Home":
        e.preventDefault();
        menuItems[0].focus();
        setFocusedIndex(0);
        break;
      case "End":
        e.preventDefault();
        menuItems[count - 1].focus();
        setFocusedIndex(count - 1);
        break;
      case "Escape":
        e.preventDefault();
        closeMenu(true);
        break;
      case "Tab":
        // Tab closes without selecting and moves focus naturally
        closeMenu(false);
        break;
      case "Enter":
      case " ": {
        e.preventDefault();
        const activeItem = menuItems[current];
        if (activeItem) {
          const key = activeItem.dataset.key ?? "";
          selectItem(key);
        }
        break;
      }
      default: {
        // Typeahead: find first item starting with typed character
        if (e.key.length === 1) {
          const char = e.key.toLowerCase();
          const match = menuItems.findIndex((el) =>
            el.textContent?.trim().toLowerCase().startsWith(char)
          );
          if (match !== -1) {
            menuItems[match].focus();
            setFocusedIndex(match);
          }
        }
      }
    }
  }

  // ── Click-outside to close ─────────────────────────────────────────────────
  // (handled via onBlur on the wrapper in a real impl; simplified here)

  return (
    <div className={`dropdown-wrapper relative inline-block ${className}`}>
      {/* Trigger button */}
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls={menuId}
        className="dropdown-trigger"
        onClick={() => (isOpen ? closeMenu() : openMenu(0))}
        onKeyDown={handleTriggerKeyDown}
      >
        {triggerLabel}
        {/* Visual caret */}
        <span aria-hidden="true" className="ml-1 text-xs">
          {isOpen ? "▲" : "▼"}
        </span>
      </button>

      {/* Menu */}
      {isOpen && (
        <ul
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-labelledby={triggerId}
          className="dropdown-menu absolute z-50 mt-1 min-w-[10rem] rounded-lg border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-800 focus:outline-none"
          onKeyDown={handleMenuKeyDown}
        >
          {items.map((item) => (
            <li key={item.key} role="none">
              <button
                type="button"
                role="menuitem"
                data-key={item.key}
                aria-disabled={item.disabled ? "true" : undefined}
                tabIndex={-1}
                disabled={item.disabled}
                className={[
                  "flex w-full items-center gap-2 px-4 py-2 text-sm",
                  "text-zinc-700 dark:text-zinc-300",
                  "hover:bg-zinc-50 dark:hover:bg-zinc-700",
                  "focus:bg-zinc-50 dark:focus:bg-zinc-700 focus:outline-none",
                  item.disabled ? "opacity-40 cursor-not-allowed" : "cursor-pointer",
                ].join(" ")}
                onClick={() => !item.disabled && selectItem(item.key)}
              >
                {item.icon && <span aria-hidden="true">{item.icon}</span>}
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default Dropdown;
