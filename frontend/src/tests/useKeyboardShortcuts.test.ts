/**
 * Unit tests for useKeyboardShortcuts helpers.
 *
 * Because vitest is configured with environment: "node" (no JSDOM) we cannot
 * mount React hooks.  Instead we extract and test the pure helper logic that
 * underpins the hook:
 *
 *   1. isTypingTarget — the guard that suppresses shortcuts in text fields
 *   2. Key-matching logic — case-insensitive, special chars
 *   3. Modifier-key filtering — Ctrl/Cmd/Alt combos must NOT fire shortcuts
 *
 * All assertions use plain objects that mirror the shape of real DOM/Event
 * objects, so no browser globals are required.
 */

import { describe, it, expect, vi } from "vitest";

/* ─────────────────────────────────────────────────────────────────
   Inline copy of isTypingTarget from useKeyboardShortcuts.ts
   (kept in sync manually — the source of truth is the hook file)
───────────────────────────────────────────────────────────────── */
function isTypingTarget(event: { target: { tagName: string; isContentEditable?: boolean } | null }): boolean {
  const target = event.target;
  if (!target) return false;

  const tag = target.tagName.toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  if (target.isContentEditable) return true;

  return false;
}

/* ─────────────────────────────────────────────────────────────────
   Inline copy of the key-matching predicate
───────────────────────────────────────────────────────────────── */
function keyMatches(pressedKey: string, shortcutKey: string): boolean {
  return (
    pressedKey === shortcutKey ||
    pressedKey.toLowerCase() === shortcutKey.toLowerCase()
  );
}

/* ─────────────────────────────────────────────────────────────────
   Inline copy of the modifier check
───────────────────────────────────────────────────────────────── */
function hasModifier(event: { ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean }): boolean {
  return Boolean(event.ctrlKey || event.metaKey || event.altKey);
}

/* ═══════════════════════════════════════════════════════════════════
   isTypingTarget
═══════════════════════════════════════════════════════════════════ */
describe("isTypingTarget", () => {
  it("returns true for <input>", () => {
    expect(isTypingTarget({ target: { tagName: "INPUT" } })).toBe(true);
  });

  it("returns true for <TEXTAREA> (uppercase tag)", () => {
    expect(isTypingTarget({ target: { tagName: "TEXTAREA" } })).toBe(true);
  });

  it("returns true for <select>", () => {
    expect(isTypingTarget({ target: { tagName: "SELECT" } })).toBe(true);
  });

  it("returns true for a contenteditable element", () => {
    expect(
      isTypingTarget({ target: { tagName: "DIV", isContentEditable: true } }),
    ).toBe(true);
  });

  it("returns false for a regular <button>", () => {
    expect(isTypingTarget({ target: { tagName: "BUTTON" } })).toBe(false);
  });

  it("returns false for a <div> without contenteditable", () => {
    expect(
      isTypingTarget({ target: { tagName: "DIV", isContentEditable: false } }),
    ).toBe(false);
  });

  it("returns false when target is null", () => {
    expect(isTypingTarget({ target: null })).toBe(false);
  });

  it("returns false for <main>", () => {
    expect(isTypingTarget({ target: { tagName: "MAIN" } })).toBe(false);
  });
});

/* ═══════════════════════════════════════════════════════════════════
   keyMatches
═══════════════════════════════════════════════════════════════════ */
describe("keyMatches", () => {
  it('matches "d" against shortcut "d" (exact lowercase)', () => {
    expect(keyMatches("d", "d")).toBe(true);
  });

  it('matches "D" against shortcut "d" (uppercase press)', () => {
    expect(keyMatches("D", "d")).toBe(true);
  });

  it('matches "d" against shortcut "D" (uppercase definition)', () => {
    expect(keyMatches("d", "D")).toBe(true);
  });

  it('matches "/" exactly (special char)', () => {
    expect(keyMatches("/", "/")).toBe(true);
  });

  it('matches "?" exactly (Shift+/ but represented as "?")', () => {
    expect(keyMatches("?", "?")).toBe(true);
  });

  it('does NOT match "a" against shortcut "d"', () => {
    expect(keyMatches("a", "d")).toBe(false);
  });

  it('does NOT match "w" against shortcut "d"', () => {
    expect(keyMatches("w", "d")).toBe(false);
  });

  it("handles empty-string shortcut key gracefully", () => {
    expect(keyMatches("", "")).toBe(true);
    expect(keyMatches("d", "")).toBe(false);
  });
});

/* ═══════════════════════════════════════════════════════════════════
   hasModifier
═══════════════════════════════════════════════════════════════════ */
describe("hasModifier", () => {
  it("returns false when no modifier keys are pressed", () => {
    expect(hasModifier({ ctrlKey: false, metaKey: false, altKey: false })).toBe(
      false,
    );
  });

  it("returns true when Ctrl is pressed", () => {
    expect(hasModifier({ ctrlKey: true, metaKey: false, altKey: false })).toBe(
      true,
    );
  });

  it("returns true when Meta (Cmd) is pressed", () => {
    expect(hasModifier({ ctrlKey: false, metaKey: true, altKey: false })).toBe(
      true,
    );
  });

  it("returns true when Alt is pressed", () => {
    expect(hasModifier({ ctrlKey: false, metaKey: false, altKey: true })).toBe(
      true,
    );
  });

  it("returns true when multiple modifiers are pressed simultaneously", () => {
    expect(hasModifier({ ctrlKey: true, metaKey: true, altKey: false })).toBe(
      true,
    );
  });

  it("returns false when modifier keys are undefined (default falsy)", () => {
    expect(hasModifier({})).toBe(false);
  });
});

/* ═══════════════════════════════════════════════════════════════════
   End-to-end shortcut dispatch simulation
   (pure TS, no DOM — simulates the logic inside the keydown handler)
═══════════════════════════════════════════════════════════════════ */
describe("shortcut dispatch simulation", () => {
  interface MockEvent {
    key: string;
    ctrlKey?: boolean;
    metaKey?: boolean;
    altKey?: boolean;
    target: { tagName: string; isContentEditable?: boolean } | null;
    defaultPrevented?: boolean;
    preventDefault?: () => void;
  }

  interface Shortcut {
    key: string;
    handler: () => void;
  }

  function dispatchShortcut(event: MockEvent, shortcuts: Shortcut[]): boolean {
    if (hasModifier(event)) return false;
    if (isTypingTarget(event)) return false;

    for (const shortcut of shortcuts) {
      if (keyMatches(event.key, shortcut.key)) {
        shortcut.handler();
        return true;
      }
    }
    return false;
  }

  it("fires the deposit handler when D is pressed outside an input", () => {
    const depositHandler = vi.fn();
    const shortcuts: Shortcut[] = [
      { key: "d", handler: depositHandler },
      { key: "w", handler: vi.fn() },
    ];

    const event: MockEvent = {
      key: "d",
      target: { tagName: "BODY" },
    };

    const fired = dispatchShortcut(event, shortcuts);
    expect(fired).toBe(true);
    expect(depositHandler).toHaveBeenCalledTimes(1);
  });

  it("does NOT fire when D is pressed inside an input field", () => {
    const depositHandler = vi.fn();
    const shortcuts: Shortcut[] = [{ key: "d", handler: depositHandler }];

    const event: MockEvent = {
      key: "d",
      target: { tagName: "INPUT" },
    };

    const fired = dispatchShortcut(event, shortcuts);
    expect(fired).toBe(false);
    expect(depositHandler).not.toHaveBeenCalled();
  });

  it("does NOT fire when Ctrl+D is pressed (browser shortcut collision guard)", () => {
    const depositHandler = vi.fn();
    const shortcuts: Shortcut[] = [{ key: "d", handler: depositHandler }];

    const event: MockEvent = {
      key: "d",
      ctrlKey: true,
      target: { tagName: "BODY" },
    };

    const fired = dispatchShortcut(event, shortcuts);
    expect(fired).toBe(false);
    expect(depositHandler).not.toHaveBeenCalled();
  });

  it("fires the withdraw handler when W is pressed", () => {
    const withdrawHandler = vi.fn();
    const shortcuts: Shortcut[] = [
      { key: "d", handler: vi.fn() },
      { key: "w", handler: withdrawHandler },
    ];

    dispatchShortcut({ key: "W", target: { tagName: "MAIN" } }, shortcuts);
    expect(withdrawHandler).toHaveBeenCalledTimes(1);
  });

  it("fires the help handler when ? is pressed", () => {
    const helpHandler = vi.fn();
    const shortcuts: Shortcut[] = [{ key: "?", handler: helpHandler }];

    dispatchShortcut({ key: "?", target: { tagName: "BODY" } }, shortcuts);
    expect(helpHandler).toHaveBeenCalledTimes(1);
  });

  it("fires the search-focus handler when / is pressed", () => {
    const searchHandler = vi.fn();
    const shortcuts: Shortcut[] = [{ key: "/", handler: searchHandler }];

    dispatchShortcut({ key: "/", target: { tagName: "BODY" } }, shortcuts);
    expect(searchHandler).toHaveBeenCalledTimes(1);
  });

  it("fires the harvest handler when H is pressed", () => {
    const harvestHandler = vi.fn();
    const shortcuts: Shortcut[] = [{ key: "h", handler: harvestHandler }];

    dispatchShortcut({ key: "h", target: { tagName: "BODY" } }, shortcuts);
    expect(harvestHandler).toHaveBeenCalledTimes(1);
  });

  it("does NOT fire when D is pressed inside a contenteditable", () => {
    const depositHandler = vi.fn();
    const shortcuts: Shortcut[] = [{ key: "d", handler: depositHandler }];

    const event: MockEvent = {
      key: "d",
      target: { tagName: "DIV", isContentEditable: true },
    };

    const fired = dispatchShortcut(event, shortcuts);
    expect(fired).toBe(false);
    expect(depositHandler).not.toHaveBeenCalled();
  });

  it("fires only the first matching shortcut (no duplicate dispatch)", () => {
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    // Two shortcuts that both claim "d" — only the first should fire.
    const shortcuts: Shortcut[] = [
      { key: "d", handler: handler1 },
      { key: "d", handler: handler2 },
    ];

    dispatchShortcut({ key: "d", target: { tagName: "BODY" } }, shortcuts);
    expect(handler1).toHaveBeenCalledTimes(1);
    expect(handler2).not.toHaveBeenCalled();
  });
});
