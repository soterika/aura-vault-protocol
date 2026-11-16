"use client";

/**
 * useAddressBook — Issue #258
 *
 * Manages a list of labelled Stellar addresses persisted to localStorage.
 *
 * Rules:
 *   - Max 50 entries (MAX_ENTRIES). Adding beyond this returns an error.
 *   - Addresses are validated with StrKey.isValidEd25519PublicKey from
 *     @stellar/stellar-sdk before being stored.
 *   - Each entry has a stable UUID (crypto.randomUUID) so edits and deletes
 *     are key-stable even if the address or label changes.
 *   - Import merges with existing entries (deduplicates by address).
 *     Entries that fail validation are silently skipped.
 *   - Export produces a JSON file the user can download and re-import.
 */

import { useState, useCallback, useEffect } from "react";
import { StrKey } from "@stellar/stellar-sdk";

export const MAX_ENTRIES = 50;
const STORAGE_KEY = "aura_address_book";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AddressEntry {
  id:      string;   // stable UUID
  label:   string;   // user-defined name, e.g. "Treasury"
  address: string;   // Stellar G-address
}

export type AddressBookError =
  | "INVALID_ADDRESS"
  | "DUPLICATE_ADDRESS"
  | "LIMIT_REACHED"
  | "LABEL_REQUIRED"
  | "ADDRESS_REQUIRED";

export interface AddressBookResult {
  ok:    true;
  entry: AddressEntry;
}

export interface AddressBookFailure {
  ok:    false;
  error: AddressBookError;
}

// ── Persistence helpers ───────────────────────────────────────────────────────

function load(): AddressEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    // Filter to well-shaped objects only
    return (parsed as unknown[]).filter(
      (e): e is AddressEntry =>
        typeof e === "object" &&
        e !== null &&
        typeof (e as AddressEntry).id      === "string" &&
        typeof (e as AddressEntry).label   === "string" &&
        typeof (e as AddressEntry).address === "string"
    );
  } catch {
    return [];
  }
}

function save(entries: AddressEntry[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useAddressBook() {
  const [entries, setEntries] = useState<AddressEntry[]>([]);

  // Hydrate from localStorage on mount (avoids SSR mismatch)
  useEffect(() => {
    setEntries(load());
  }, []);

  // ── Persist on every change ────────────────────────────────────────────────
  useEffect(() => {
    save(entries);
  }, [entries]);

  // ── Validation helper ──────────────────────────────────────────────────────
  const validate = useCallback(
    (label: string, address: string): AddressBookError | null => {
      if (!label.trim())   return "LABEL_REQUIRED";
      if (!address.trim()) return "ADDRESS_REQUIRED";
      if (!StrKey.isValidEd25519PublicKey(address)) return "INVALID_ADDRESS";
      return null;
    },
    []
  );

  // ── Add ────────────────────────────────────────────────────────────────────
  const add = useCallback(
    (label: string, address: string): AddressBookResult | AddressBookFailure => {
      const err = validate(label, address);
      if (err) return { ok: false, error: err };

      if (entries.length >= MAX_ENTRIES) return { ok: false, error: "LIMIT_REACHED" };

      if (entries.some((e) => e.address === address))
        return { ok: false, error: "DUPLICATE_ADDRESS" };

      const entry: AddressEntry = {
        id:      crypto.randomUUID(),
        label:   label.trim(),
        address: address.trim(),
      };
      setEntries((prev) => [...prev, entry]);
      return { ok: true, entry };
    },
    [entries, validate]
  );

  // ── Update ─────────────────────────────────────────────────────────────────
  const update = useCallback(
    (
      id: string,
      label: string,
      address: string
    ): AddressBookResult | AddressBookFailure => {
      const err = validate(label, address);
      if (err) return { ok: false, error: err };

      const duplicate = entries.find((e) => e.address === address && e.id !== id);
      if (duplicate) return { ok: false, error: "DUPLICATE_ADDRESS" };

      let updated: AddressEntry | undefined;
      setEntries((prev) =>
        prev.map((e) => {
          if (e.id !== id) return e;
          updated = { id, label: label.trim(), address: address.trim() };
          return updated;
        })
      );

      if (!updated) return { ok: false, error: "INVALID_ADDRESS" };
      return { ok: true, entry: updated };
    },
    [entries, validate]
  );

  // ── Delete ─────────────────────────────────────────────────────────────────
  const remove = useCallback((id: string): void => {
    setEntries((prev) => prev.filter((e) => e.id !== id));
  }, []);

  // ── Search ─────────────────────────────────────────────────────────────────
  const search = useCallback(
    (query: string): AddressEntry[] => {
      if (!query.trim()) return entries;
      const q = query.toLowerCase();
      return entries.filter(
        (e) =>
          e.label.toLowerCase().includes(q) ||
          e.address.toLowerCase().includes(q)
      );
    },
    [entries]
  );

  // ── Export ─────────────────────────────────────────────────────────────────
  const exportJSON = useCallback((): void => {
    const json  = JSON.stringify(entries, null, 2);
    const blob  = new Blob([json], { type: "application/json" });
    const url   = URL.createObjectURL(blob);
    const a     = document.createElement("a");
    a.href      = url;
    a.download  = "aura-address-book.json";
    a.click();
    URL.revokeObjectURL(url);
  }, [entries]);

  // ── Import ─────────────────────────────────────────────────────────────────
  /**
   * Merges a JSON file's contents into the existing address book.
   * Entries that fail validation or are duplicates are skipped.
   * Returns the number of entries actually added.
   */
  const importJSON = useCallback(
    (file: File): Promise<number> => {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          try {
            const parsed = JSON.parse(reader.result as string) as unknown;
            if (!Array.isArray(parsed)) {
              reject(new Error("File must contain a JSON array"));
              return;
            }

            let added = 0;
            setEntries((prev) => {
              const next = [...prev];
              for (const item of parsed as unknown[]) {
                if (
                  typeof item !== "object" ||
                  item === null ||
                  typeof (item as AddressEntry).label   !== "string" ||
                  typeof (item as AddressEntry).address !== "string"
                ) continue;

                const { label, address } = item as AddressEntry;
                if (!StrKey.isValidEd25519PublicKey(address)) continue;
                if (next.some((e) => e.address === address))  continue;
                if (next.length >= MAX_ENTRIES)                break;

                next.push({
                  id:      crypto.randomUUID(),
                  label:   label.trim(),
                  address: address.trim(),
                });
                added++;
              }
              return next;
            });
            resolve(added);
          } catch {
            reject(new Error("Invalid JSON file"));
          }
        };
        reader.onerror = () => reject(new Error("Failed to read file"));
        reader.readAsText(file);
      });
    },
    []
  );

  return {
    entries,
    atLimit: entries.length >= MAX_ENTRIES,
    add,
    update,
    remove,
    search,
    exportJSON,
    importJSON,
    isValid: (address: string) => StrKey.isValidEd25519PublicKey(address),
  };
}
