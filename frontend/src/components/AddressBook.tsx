"use client";

/**
 * AddressBook — Issue #258
 *
 * Full CRUD address book UI:
 *   - List of saved addresses with label, truncated address, edit + delete
 *   - Add / edit form with Stellar address validation
 *   - Search bar (filters label and address)
 *   - Import (JSON file picker) and Export (downloads JSON)
 *   - Warning banner when approaching / at the 50-entry limit
 */

import { useState, useRef, useId } from "react";
import { Pencil, Trash2, Plus, Download, Upload, Search, AlertTriangle, CheckCircle } from "lucide-react";
import { useAddressBook, MAX_ENTRIES, type AddressEntry } from "@/lib/useAddressBook";

// ── Helpers ───────────────────────────────────────────────────────────────────

function truncate(addr: string) {
  return `${addr.slice(0, 8)}…${addr.slice(-6)}`;
}

const ERROR_MESSAGES: Record<string, string> = {
  INVALID_ADDRESS:   "Not a valid Stellar address (must start with G, 56 chars)",
  DUPLICATE_ADDRESS: "This address is already in your address book",
  LIMIT_REACHED:     `Address book is full (max ${MAX_ENTRIES} entries)`,
  LABEL_REQUIRED:    "Label is required",
  ADDRESS_REQUIRED:  "Address is required",
};

// ── Sub-component: AddressForm ────────────────────────────────────────────────

interface AddressFormProps {
  initial?: AddressEntry;
  onSave:   (label: string, address: string) => string | null; // returns error msg or null
  onCancel: () => void;
}

function AddressForm({ initial, onSave, onCancel }: AddressFormProps) {
  const [label,   setLabel]   = useState(initial?.label   ?? "");
  const [address, setAddress] = useState(initial?.address ?? "");
  const [error,   setError]   = useState<string | null>(null);
  const labelId = useId();
  const addrId  = useId();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const err = onSave(label, address);
    if (err) setError(err);
  }

  const inputCls =
    "w-full rounded-xl border border-zinc-300 bg-white px-3 py-2.5 text-sm " +
    "focus:outline-none focus:ring-2 focus:ring-zinc-900 min-h-[44px] " +
    "dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 dark:focus:ring-zinc-100";

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-700">
      <div className="flex flex-col gap-1">
        <label htmlFor={labelId} className="text-xs font-medium text-zinc-500">Label</label>
        <input
          id={labelId}
          type="text"
          placeholder="e.g. Treasury"
          value={label}
          maxLength={40}
          onChange={(e) => { setLabel(e.target.value); setError(null); }}
          className={inputCls}
          autoFocus
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={addrId} className="text-xs font-medium text-zinc-500">Stellar Address</label>
        <input
          id={addrId}
          type="text"
          placeholder="GABC…XYZ"
          value={address}
          maxLength={56}
          onChange={(e) => { setAddress(e.target.value.trim()); setError(null); }}
          className={`${inputCls} font-mono`}
          spellCheck={false}
          autoCapitalize="none"
          autoCorrect="off"
        />
      </div>

      {error && (
        <p role="alert" className="flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400">
          <AlertTriangle size={13} aria-hidden="true" />
          {error}
        </p>
      )}

      <div className="flex gap-2 pt-1">
        <button
          type="submit"
          className="flex-1 min-h-[44px] rounded-xl bg-zinc-900 text-sm font-semibold text-white
            hover:bg-zinc-700 transition-colors dark:bg-zinc-100 dark:text-black dark:hover:bg-zinc-300"
        >
          {initial ? "Save Changes" : "Add Address"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 min-h-[44px] rounded-xl border border-zinc-300 text-sm font-semibold
            hover:bg-zinc-50 transition-colors dark:border-zinc-600 dark:hover:bg-zinc-800"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function AddressBook() {
  const book = useAddressBook();

  const [query,       setQuery]       = useState("");
  const [showForm,    setShowForm]    = useState(false);
  const [editTarget,  setEditTarget]  = useState<AddressEntry | null>(null);
  const [deleteId,    setDeleteId]    = useState<string | null>(null);
  const [importMsg,   setImportMsg]   = useState<string | null>(null);
  const fileInputRef                  = useRef<HTMLInputElement>(null);

  const filtered = book.search(query);

  // ── CRUD callbacks ─────────────────────────────────────────────────────────

  function handleAdd(label: string, address: string): string | null {
    const result = book.add(label, address);
    if (!result.ok) return ERROR_MESSAGES[result.error] ?? result.error;
    setShowForm(false);
    return null;
  }

  function handleUpdate(label: string, address: string): string | null {
    if (!editTarget) return null;
    const result = book.update(editTarget.id, label, address);
    if (!result.ok) return ERROR_MESSAGES[result.error] ?? result.error;
    setEditTarget(null);
    return null;
  }

  function handleDelete(id: string) {
    book.remove(id);
    setDeleteId(null);
  }

  // ── Import ─────────────────────────────────────────────────────────────────

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = ""; // reset so the same file can be re-selected
    try {
      const added = await book.importJSON(file);
      setImportMsg(`Imported ${added} address${added !== 1 ? "es" : ""}`);
      setTimeout(() => setImportMsg(null), 3000);
    } catch (err) {
      setImportMsg(err instanceof Error ? err.message : "Import failed");
      setTimeout(() => setImportMsg(null), 4000);
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-4">

      {/* ── Limit warning ── */}
      {book.entries.length >= MAX_ENTRIES - 5 && (
        <div
          role="status"
          className={`flex items-center gap-2 rounded-xl px-4 py-3 text-sm
            ${book.atLimit
              ? "bg-red-50 text-red-700 border border-red-200 dark:bg-red-950/30 dark:text-red-400 dark:border-red-900"
              : "bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-900"
            }`}
        >
          <AlertTriangle size={16} aria-hidden="true" />
          {book.atLimit
            ? `Address book full (${MAX_ENTRIES}/${MAX_ENTRIES}). Delete an entry to add more.`
            : `${book.entries.length}/${MAX_ENTRIES} addresses saved.`}
        </div>
      )}

      {/* ── Toolbar: search + actions ── */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Search */}
        <div className="relative flex-1 min-w-[160px]">
          <Search
            size={15}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none"
            aria-hidden="true"
          />
          <input
            type="search"
            placeholder="Search label or address…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full min-h-[44px] rounded-xl border border-zinc-300 pl-9 pr-3 py-2 text-sm
              focus:outline-none focus:ring-2 focus:ring-zinc-900
              dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
            aria-label="Search address book"
          />
        </div>

        {/* Import */}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="flex min-h-[44px] items-center gap-1.5 rounded-xl border border-zinc-300 px-3 text-sm
            font-medium hover:bg-zinc-50 transition-colors dark:border-zinc-600 dark:hover:bg-zinc-800"
          aria-label="Import addresses from JSON"
        >
          <Upload size={15} aria-hidden="true" />
          Import
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          onChange={handleImport}
          className="sr-only"
          aria-hidden="true"
          tabIndex={-1}
        />

        {/* Export */}
        <button
          type="button"
          onClick={book.exportJSON}
          disabled={book.entries.length === 0}
          className="flex min-h-[44px] items-center gap-1.5 rounded-xl border border-zinc-300 px-3 text-sm
            font-medium hover:bg-zinc-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed
            dark:border-zinc-600 dark:hover:bg-zinc-800"
          aria-label="Export addresses as JSON"
        >
          <Download size={15} aria-hidden="true" />
          Export
        </button>

        {/* Add */}
        {!showForm && !editTarget && (
          <button
            type="button"
            onClick={() => { setShowForm(true); setEditTarget(null); }}
            disabled={book.atLimit}
            className="flex min-h-[44px] items-center gap-1.5 rounded-xl bg-zinc-900 px-3 text-sm
              font-semibold text-white hover:bg-zinc-700 transition-colors
              disabled:opacity-40 disabled:cursor-not-allowed
              dark:bg-zinc-100 dark:text-black dark:hover:bg-zinc-300"
            aria-label="Add new address"
          >
            <Plus size={15} aria-hidden="true" />
            Add
          </button>
        )}
      </div>

      {/* ── Import feedback ── */}
      {importMsg && (
        <p role="status" className="flex items-center gap-1.5 text-sm text-emerald-600 dark:text-emerald-400">
          <CheckCircle size={14} aria-hidden="true" />
          {importMsg}
        </p>
      )}

      {/* ── Add form ── */}
      {showForm && (
        <AddressForm
          onSave={handleAdd}
          onCancel={() => setShowForm(false)}
        />
      )}

      {/* ── Entry list ── */}
      {filtered.length === 0 && !showForm && (
        <p className="text-sm text-zinc-500 py-2">
          {book.entries.length === 0
            ? "No saved addresses yet. Add one to get started."
            : "No addresses match your search."}
        </p>
      )}

      <ul className="flex flex-col gap-2" aria-label="Saved addresses">
        {filtered.map((entry) => (
          <li
            key={entry.id}
            className="rounded-xl border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900"
          >
            {editTarget?.id === entry.id ? (
              <div className="p-3">
                <AddressForm
                  initial={editTarget}
                  onSave={handleUpdate}
                  onCancel={() => setEditTarget(null)}
                />
              </div>
            ) : (
              <div className="flex items-center gap-3 px-4 py-3">
                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-100 truncate">
                    {entry.label}
                  </p>
                  <p
                    className="font-mono text-xs text-zinc-500 truncate"
                    title={entry.address}
                  >
                    {truncate(entry.address)}
                  </p>
                </div>

                {/* Edit */}
                <button
                  type="button"
                  onClick={() => { setEditTarget(entry); setShowForm(false); }}
                  className="flex min-h-[44px] min-w-[44px] items-center justify-center
                    rounded-xl text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 transition-colors
                    dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
                  aria-label={`Edit ${entry.label}`}
                >
                  <Pencil size={15} aria-hidden="true" />
                </button>

                {/* Delete — two-step confirm */}
                {deleteId === entry.id ? (
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => handleDelete(entry.id)}
                      className="min-h-[44px] rounded-xl bg-red-600 px-2.5 text-xs font-semibold
                        text-white hover:bg-red-700 transition-colors"
                      aria-label={`Confirm delete ${entry.label}`}
                    >
                      Delete
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteId(null)}
                      className="min-h-[44px] rounded-xl border border-zinc-300 px-2.5 text-xs
                        font-semibold hover:bg-zinc-50 transition-colors
                        dark:border-zinc-600 dark:hover:bg-zinc-800"
                      aria-label="Cancel delete"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setDeleteId(entry.id)}
                    className="flex min-h-[44px] min-w-[44px] items-center justify-center
                      rounded-xl text-zinc-400 hover:bg-red-50 hover:text-red-600 transition-colors
                      dark:hover:bg-red-950/30 dark:hover:text-red-400"
                    aria-label={`Delete ${entry.label}`}
                  >
                    <Trash2 size={15} aria-hidden="true" />
                  </button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
