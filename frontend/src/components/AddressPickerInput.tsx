"use client";

/**
 * AddressPickerInput — Issue #258
 *
 * A controlled text input for Stellar addresses that shows a searchable
 * dropdown of saved address-book entries when the user types or focuses.
 *
 * Props:
 *   value        — current address string (controlled)
 *   onChange     — called with the new address string
 *   placeholder  — input placeholder (default: "GABC…XYZ")
 *   id / label   — forwarded to the <input> for accessibility
 *   error        — validation error message to display below the input
 *   disabled     — disables the input
 *
 * Keyboard:
 *   ArrowDown / ArrowUp — move through suggestions
 *   Enter               — select highlighted suggestion
 *   Escape              — close dropdown
 *   Tab                 — close dropdown, move focus
 */

import {
  useState,
  useRef,
  useCallback,
  useId,
  type KeyboardEvent,
  type ChangeEvent,
} from "react";
import { ChevronDown, BookUser } from "lucide-react";
import { useAddressBook, type AddressEntry } from "@/lib/useAddressBook";

interface Props {
  value:        string;
  onChange:     (address: string) => void;
  placeholder?: string;
  id?:          string;
  label?:       string;
  error?:       string | null;
  disabled?:    boolean;
}

function truncate(addr: string) {
  return `${addr.slice(0, 8)}…${addr.slice(-6)}`;
}

export default function AddressPickerInput({
  value,
  onChange,
  placeholder = "GABC…XYZ",
  id,
  label = "Recipient address",
  error,
  disabled = false,
}: Props) {
  const book                            = useAddressBook();
  const [open,        setOpen]          = useState(false);
  const [highlighted, setHighlighted]   = useState(-1);
  const inputRef                        = useRef<HTMLInputElement>(null);
  const listRef                         = useRef<HTMLUListElement>(null);
  const genId                           = useId();
  const inputId                         = id ?? genId;
  const listboxId                       = `${inputId}-listbox`;

  // Filter entries by current input value
  const suggestions: AddressEntry[] = value.trim()
    ? book.search(value)
    : book.entries;

  const showDropdown = open && suggestions.length > 0;

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      onChange(e.target.value.trim());
      setOpen(true);
      setHighlighted(-1);
    },
    [onChange]
  );

  const handleSelect = useCallback(
    (entry: AddressEntry) => {
      onChange(entry.address);
      setOpen(false);
      setHighlighted(-1);
      inputRef.current?.focus();
    },
    [onChange]
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (!showDropdown) {
        if (e.key === "ArrowDown") { setOpen(true); setHighlighted(0); e.preventDefault(); }
        return;
      }
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setHighlighted((h) => Math.min(h + 1, suggestions.length - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setHighlighted((h) => Math.max(h - 1, 0));
          break;
        case "Enter":
          if (highlighted >= 0 && suggestions[highlighted]) {
            e.preventDefault();
            handleSelect(suggestions[highlighted]);
          }
          break;
        case "Escape":
        case "Tab":
          setOpen(false);
          setHighlighted(-1);
          break;
      }
    },
    [showDropdown, suggestions, highlighted, handleSelect]
  );

  // ── Render ─────────────────────────────────────────────────────────────────

  const inputCls = [
    "w-full min-h-[44px] rounded-xl border px-3 py-2.5 pr-10 font-mono text-sm",
    "focus:outline-none focus:ring-2 transition-colors",
    error
      ? "border-red-400 focus:ring-red-500 dark:border-red-600"
      : "border-zinc-300 focus:ring-zinc-900 dark:border-zinc-600",
    "bg-white dark:bg-zinc-800 dark:text-zinc-100 dark:focus:ring-zinc-100",
    disabled ? "opacity-50 cursor-not-allowed" : "",
  ].join(" ");

  return (
    <div className="relative flex flex-col gap-1">
      {/* Label */}
      <label htmlFor={inputId} className="text-xs font-medium text-zinc-500">
        <span className="flex items-center gap-1">
          <BookUser size={12} aria-hidden="true" />
          {label}
        </span>
      </label>

      {/* Input wrapper */}
      <div className="relative">
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          inputMode="text"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          onChange={handleChange}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            // Delay close so click on suggestion registers first
            setTimeout(() => setOpen(false), 150);
          }}
          onKeyDown={handleKeyDown}
          aria-label={label}
          aria-autocomplete="list"
          aria-haspopup="listbox"
          aria-expanded={showDropdown}
          aria-controls={showDropdown ? listboxId : undefined}
          aria-activedescendant={
            highlighted >= 0 ? `${listboxId}-opt-${highlighted}` : undefined
          }
          aria-invalid={!!error}
          aria-describedby={error ? `${inputId}-error` : undefined}
          className={inputCls}
        />

        {/* Chevron toggle */}
        {book.entries.length > 0 && (
          <button
            type="button"
            tabIndex={-1}
            onMouseDown={(e) => {
              e.preventDefault(); // prevent input blur
              setOpen((o) => !o);
              setHighlighted(-1);
              inputRef.current?.focus();
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center justify-center
              w-7 h-7 rounded-lg text-zinc-400 hover:text-zinc-700 transition-colors
              dark:hover:text-zinc-200"
            aria-label={open ? "Close address suggestions" : "Open address suggestions"}
          >
            <ChevronDown
              size={16}
              aria-hidden="true"
              className={`transition-transform duration-150 ${open ? "rotate-180" : ""}`}
            />
          </button>
        )}
      </div>

      {/* Error */}
      {error && (
        <p
          id={`${inputId}-error`}
          role="alert"
          className="text-xs text-red-600 dark:text-red-400"
        >
          {error}
        </p>
      )}

      {/* Dropdown */}
      {showDropdown && (
        <ul
          ref={listRef}
          id={listboxId}
          role="listbox"
          aria-label="Saved addresses"
          className="absolute top-full left-0 right-0 z-50 mt-1 max-h-56 overflow-y-auto
            rounded-xl border border-zinc-200 bg-white shadow-lg
            dark:border-zinc-700 dark:bg-zinc-900"
        >
          {suggestions.map((entry, idx) => (
            <li
              key={entry.id}
              id={`${listboxId}-opt-${idx}`}
              role="option"
              aria-selected={value === entry.address}
              onMouseDown={(e) => { e.preventDefault(); handleSelect(entry); }}
              className={[
                "flex cursor-pointer select-none flex-col px-4 py-2.5 text-sm transition-colors",
                highlighted === idx
                  ? "bg-zinc-100 dark:bg-zinc-800"
                  : "hover:bg-zinc-50 dark:hover:bg-zinc-800/60",
                value === entry.address ? "font-semibold" : "",
              ].join(" ")}
            >
              <span className="text-zinc-900 dark:text-zinc-100">{entry.label}</span>
              <span className="font-mono text-xs text-zinc-400">{truncate(entry.address)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
