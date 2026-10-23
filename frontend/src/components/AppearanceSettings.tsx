"use client";

import { useEffect, useState } from "react";
import { applyAppearance, DEFAULT_APPEARANCE, type Appearance } from "@/lib/appearance";

const DEFAULTS = DEFAULT_APPEARANCE;
const SWATCHES = ["#4338ca", "#0369a1", "#047857", "#b45309", "#be123c", "#7e22ce"];
const API = process.env.NEXT_PUBLIC_API_URL ?? "";

export function AppearanceSettings() {
  const [appearance, setAppearance] = useState<Appearance>(DEFAULTS);
  const [customHex, setCustomHex] = useState(DEFAULTS.accentColor);
  const [status, setStatus] = useState("");

  useEffect(() => {
    let active = true;
    const token = localStorage.getItem("aura_access_token");
    if (!token) return;
    void fetch(`${API}/api/users/preferences`, { headers: { Authorization: `Bearer ${token}` } })
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => {
        const stored = payload?.preferences?.appearance ?? payload?.data?.preferences?.appearance;
        if (active && stored && /^#[0-9a-fA-F]{6}$/.test(stored.accentColor) && ["small", "medium", "large"].includes(stored.fontSize)) {
          const next = { ...DEFAULTS, ...stored } as Appearance;
          setAppearance(next);
          setCustomHex(next.accentColor);
          applyAppearance(next, true);
        }
      }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  function update(next: Appearance) {
    setAppearance(next);
    setCustomHex(next.accentColor);
    applyAppearance(next, true);
  }

  async function save(value: Appearance = appearance) {
    const token = localStorage.getItem("aura_access_token");
    if (!token) { setStatus("Connect and authenticate a wallet to save appearance preferences."); return; }
    try {
      const response = await fetch(`${API}/api/users/preferences`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ appearance: value }),
      });
      if (!response.ok) throw new Error("save failed");
      setStatus("Appearance preferences saved.");
    } catch { setStatus("Unable to save appearance preferences. Please try again."); }
  }

  function reset() {
    update(DEFAULTS);
    void save(DEFAULTS);
  }

  return (
    <div className="mt-4 border-t border-zinc-100 pt-4 dark:border-zinc-800">
      <h3 className="mb-3 text-sm font-semibold">Personalize appearance</h3>
      <fieldset>
        <legend className="mb-2 text-xs text-zinc-500">Accent colour</legend>
        <div className="flex flex-wrap items-center gap-2">
          {SWATCHES.map((color) => <button key={color} type="button" aria-label={`Use accent ${color}`} aria-pressed={appearance.accentColor === color} onClick={() => update({ ...appearance, accentColor: color })} className="h-8 w-8 rounded-full border-2 border-white ring-1 ring-zinc-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2" style={{ backgroundColor: color }} />)}
          <label className="ml-2 flex items-center gap-2 text-xs text-zinc-500">Custom hex
          <input aria-label="Custom accent colour" value={customHex} pattern="#[0-9a-fA-F]{6}" onChange={(event) => { const value = event.target.value; if (/^#[0-9a-fA-F]{0,6}$/.test(value)) { setCustomHex(value); if (value.length === 7) update({ ...appearance, accentColor: value }); } }} className="w-24 rounded border border-zinc-300 bg-transparent px-2 py-1 font-mono dark:border-zinc-700" />
          </label>
        </div>
      </fieldset>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="text-xs text-zinc-500">Font size
          <select value={appearance.fontSize} onChange={(event) => update({ ...appearance, fontSize: event.target.value as Appearance["fontSize"] })} className="mt-1 block w-full rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700">
            <option value="small">Small</option><option value="medium">Medium</option><option value="large">Large</option>
          </select>
        </label>
        <label className="flex items-center justify-between gap-3 self-end rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-700">
          Compact mode <input type="checkbox" checked={appearance.compactMode} onChange={(event) => update({ ...appearance, compactMode: event.target.checked })} />
        </label>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={() => void save()} className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white">Save appearance</button>
        <button type="button" onClick={reset} className="rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700">Reset to defaults</button>
        {status && <p role="status" className="basis-full text-xs text-zinc-500">{status}</p>}
      </div>
    </div>
  );
}
