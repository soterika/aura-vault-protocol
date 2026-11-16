/**
 * SortableDashboardGrid — drag-and-drop reorderable dashboard.
 *
 * Issue #498: configurable dashboard widget layout with drag-and-drop.
 *
 * Features:
 *  - Drag-and-drop via @dnd-kit/sortable
 *  - Keyboard reordering: focus a widget handle, then use arrow keys
 *  - Smooth 60fps drag animation via CSS transitions + dnd-kit transform
 *  - Hidden widgets are skipped; only visible ones are rendered
 *  - Layout persisted to localStorage via useWidgetLayout
 */

"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragStartEvent,
  DragOverlay,
  defaultDropAnimationSideEffects,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import { HeroCard } from "./HeroCard";
import { ApyCard, DepositorCountCard, LastHarvestCard } from "./MetricCards";
import { UserPositionCard, type UserPosition } from "./UserPositionCard";
import { HarvestButton } from "@/components/HarvestButton";
import { ReferralWidget } from "./ReferralWidget";
import {
  useWidgetLayout,
  type WidgetId,
  type WidgetDescriptor,
} from "@/lib/useWidgetLayout";
import VaultPauseBanner from "@/components/VaultPauseBanner";
import AdminPauseControls from "@/components/AdminPauseControls";
import VaultActions from "@/components/VaultActions";
import { useVaultPause } from "@/lib/useVaultPause";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface VaultStats {
  tvl: string;
  tvlChange24h: number;
  sharePrice: string;
  apy7d: number | null;
  depositorCount: number | null;
  lastHarvestAt: number | null;
  lastHarvestAmount: string | null;
  /** Total vault shares — used to gate the keeper harvest button */
  totalShares: number;
}

interface SortableWidgetProps {
  widget: WidgetDescriptor;
  stats: VaultStats | null;
  position: UserPosition | null;
  loading: boolean;
  /** Connected wallet address (may be undefined) */
  walletAddress?: string;
  /** True while this specific item is being dragged */
  isDragging: boolean;
  /** Called after a successful harvest to trigger a stats refresh */
  onRefresh?: () => void;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function fmtUsd(raw: string | number): string {
  const n = typeof raw === "string" ? parseFloat(raw) : raw;
  if (isNaN(n)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

function fmtSharePrice(raw: string | number): string {
  const n = typeof raw === "string" ? parseFloat(raw) : raw;
  if (isNaN(n)) return "—";
  return n.toFixed(6);
}

// ─── Widget renderer ───────────────────────────────────────────────────────────

function WidgetContent({
  id,
  stats,
  position,
  loading,
  onRefresh,
  walletAddress,
}: {
  id: WidgetId;
  stats: VaultStats | null;
  position: UserPosition | null;
  loading: boolean;
  /** Called after a successful harvest to trigger a stats refresh */
  onRefresh?: () => void;
  walletAddress?: string;
}) {
  switch (id) {
    case "hero":
      return (
        <HeroCard
          tvl={stats?.tvl ?? "—"}
          sharePrice={stats?.sharePrice ?? "—"}
          tvlChange24h={stats?.tvlChange24h}
          isLoading={loading}
        />
      );
    case "apy":
      return <ApyCard apy7d={stats?.apy7d ?? null} isLoading={loading} />;
    case "depositors":
      return (
        <DepositorCountCard
          count={stats?.depositorCount ?? null}
          isLoading={loading}
        />
      );
    case "last-harvest":
      return (
        <div className="flex flex-col gap-3">
          <LastHarvestCard
            lastHarvestAt={stats?.lastHarvestAt ?? null}
            lastHarvestAmount={stats?.lastHarvestAmount ?? null}
            isLoading={loading}
          />
          <HarvestButton
            totalShares={stats?.totalShares ?? 0}
            onHarvestComplete={onRefresh}
          />
        </div>
      );
    case "user-position":
      return <UserPositionCard position={position} isLoading={loading} />;
    case "referral":
      return <ReferralWidget address={walletAddress} isLoading={loading} />;
    default:
      return null;
  }
}

// ─── Sortable item wrapper ─────────────────────────────────────────────────────

function SortableWidget({
  widget,
  stats,
  position,
  loading,
  isDragging,
  onRefresh,
  walletAddress,
}: SortableWidgetProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging: isSelfDragging,
  } = useSortable({ id: widget.id });

  const style: React.CSSProperties = {
    // CSS.Transform.toString produces `translate3d(x, y, 0) scaleX(s) scaleY(s)`
    // which drives smooth 60fps animation via GPU compositing
    transform: CSS.Transform.toString(transform),
    transition: transition ?? "transform 200ms cubic-bezier(0.25, 1, 0.5, 1)",
    opacity: isSelfDragging ? 0.4 : 1,
    // Promote to its own layer during drag for 60fps performance
    willChange: isDragging ? "transform" : "auto",
    position: "relative",
    zIndex: isSelfDragging ? 1 : "auto",
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="group motion-reduce:[&_*]:!transition-none"
      data-testid={`sortable-widget-${widget.id}`}
    >
      {/* Drag handle — shows on hover/focus */}
      <button
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-label={`Drag to reorder ${widget.label} widget. Use arrow keys to reorder with keyboard.`}
        aria-roledescription="sortable"
        className={[
          "absolute top-2 right-2 z-10 hidden rounded-md p-1.5 md:inline-flex",
          "text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200",
          "opacity-0 group-hover:opacity-100 focus:opacity-100",
          "transition-opacity duration-150",
          "focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1",
          "cursor-grab active:cursor-grabbing",
        ].join(" ")}
        tabIndex={0}
      >
        {/* Grip icon (6 dots) */}
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="currentColor"
          aria-hidden="true"
        >
          <circle cx="5" cy="4" r="1.5" />
          <circle cx="11" cy="4" r="1.5" />
          <circle cx="5" cy="8" r="1.5" />
          <circle cx="11" cy="8" r="1.5" />
          <circle cx="5" cy="12" r="1.5" />
          <circle cx="11" cy="12" r="1.5" />
        </svg>
      </button>

      <WidgetContent
        id={widget.id}
        stats={stats}
        position={position}
        loading={loading}
        onRefresh={onRefresh}
        walletAddress={walletAddress}
      />
    </div>
  );
}

// ─── Main component ─────────────────────────────────────────────────────────────

export function SortableDashboardGrid() {
  const { widgets, setOrder } = useWidgetLayout();
  const [stats, setStats] = useState<VaultStats | null>(null);
  const [position, setPosition] = useState<UserPosition | null>(null);
  const [loading, setLoading] = useState(true);
  const [liveMsg, setLiveMsg] = useState("");
  const [activeId, setActiveId] = useState<WidgetId | null>(null);
  const [connectedAddress, setConnectedAddress] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // Derive wallet address from the user position (set when wallet is connected)
  const walletAddress = position?.address || undefined;
  // Vault pause state — shared down to VaultActions and AdminPauseControls.
  const { isPaused, refresh: refreshPauseState } = useVaultPause();

  // Only render visible widgets
  const visibleWidgets = widgets.filter((w) => w.visible);

  // ── dnd-kit sensors ──────────────────────────────────────────────────────────
  // PointerSensor: mouse/touch drag
  // KeyboardSensor with sortableKeyboardCoordinates: arrow key reordering
  const sensors = useSensors(
    useSensor(PointerSensor, {
      // Require 8px movement before starting drag (prevents accidental drags)
      activationConstraint: { distance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // ── Drag handlers ────────────────────────────────────────────────────────────
  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(event.active.id as WidgetId);
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveId(null);
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const oldIndex = visibleWidgets.findIndex((w) => w.id === active.id);
      const newIndex = visibleWidgets.findIndex((w) => w.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return;

      // Reorder visible widgets, then merge back into full widget list
      // (maintaining hidden widgets at their original positions)
      const reorderedVisible = arrayMove(visibleWidgets, oldIndex, newIndex);
      const hiddenWidgets = widgets.filter((w) => !w.visible);

      // Rebuild: walk full widget list, replace visible slots in new order
      const visibleIter = reorderedVisible[Symbol.iterator]();
      const next = widgets.map((w) =>
        w.visible ? visibleIter.next().value : w
      ).filter((w): w is import("@/lib/useWidgetLayout").WidgetDescriptor => w !== undefined);

      setOrder(next);

      // Announce reorder to screen readers
      const movedWidget = reorderedVisible[newIndex];
      setLiveMsg(
        `${movedWidget.label} moved to position ${newIndex + 1} of ${reorderedVisible.length}`
      );
      setTimeout(() => setLiveMsg(""), 3000);

      // Suppress TS unused variable warning
      void hiddenWidgets;
    },
    [visibleWidgets, widgets, setOrder]
  );

  // ── Data fetching ────────────────────────────────────────────────────────────
  const fetchStats = useCallback(async () => {
    try {
      const [assetsRes, apyRes, metricsRes] = await Promise.allSettled([
        fetch("/api/vault/total_assets"),
        fetch("/api/vault/apy"),
        fetch("/api/vault/metrics"),
      ]);
      const assets =
        assetsRes.status === "fulfilled" && assetsRes.value.ok
          ? await assetsRes.value.json()
          : {};
      const apyData =
        apyRes.status === "fulfilled" && apyRes.value.ok
          ? await apyRes.value.json()
          : {};
      const metrics =
        metricsRes.status === "fulfilled" && metricsRes.value.ok
          ? await metricsRes.value.json()
          : {};

      setStats({
        tvl: fmtUsd(assets.total ?? metrics.tvl ?? "0"),
        tvlChange24h: metrics.tvlChange24h ?? 0,
        sharePrice: fmtSharePrice(assets.pricePerShare ?? "1"),
        apy7d: parseFloat(apyData.apy7d ?? apyData.apy ?? "0") || null,
        depositorCount: metrics.totalUsers ?? metrics.depositorCount ?? null,
        lastHarvestAt: metrics.lastHarvestAt ?? null,
        lastHarvestAmount: metrics.lastHarvestAmount ?? null,
        totalShares: metrics.totalShares ?? assets.totalShares ?? 0,
      });

      if (assets.userBalance && assets.userShares) {
        setPosition({
          underlyingBalance: `${parseFloat(assets.userBalance).toLocaleString()} USDC`,
          shares: parseFloat(assets.userShares).toLocaleString(),
          sharePrice: fmtSharePrice(assets.pricePerShare ?? "1"),
          address: assets.walletAddress ?? "",
        });
      }
    } catch {
      // Fail silently — cards show "—" fallback
    } finally {
      setLoading(false);
    }
  }, []);

  // ── WebSocket live updates ───────────────────────────────────────────────────
  useEffect(() => {
    const wsUrl =
      typeof window !== "undefined"
        ? (process.env.NEXT_PUBLIC_WS_URL ??
          `ws://${window.location.host}/api/ws/vault`)
        : null;
    if (!wsUrl) return;

    let ws: WebSocket;
    let reconnectTimer: ReturnType<typeof setTimeout>;

    function connect() {
      ws = new WebSocket(wsUrl!);
      wsRef.current = ws;
      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data as string);
          if (msg.type === "vault_update") {
            setStats((prev) =>
              prev
                ? {
                    ...prev,
                    tvl: msg.tvl ? fmtUsd(msg.tvl) : prev.tvl,
                    sharePrice: msg.pricePerShare
                      ? fmtSharePrice(msg.pricePerShare)
                      : prev.sharePrice,
                    apy7d: msg.apy7d ?? prev.apy7d,
                  }
                : prev
            );
            setLiveMsg("Vault data updated");
            setTimeout(() => setLiveMsg(""), 3000);
          }
        } catch {
          // ignore malformed frames
        }
      };
      ws.onclose = () => {
        reconnectTimer = setTimeout(connect, 5000);
      };
    }

    connect();
    return () => {
      ws?.close();
      clearTimeout(reconnectTimer);
    };
  }, []);

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 30_000);
    return () => clearInterval(interval);
  }, [fetchStats]);

  // ── Wallet address detection ─────────────────────────────────────────────────
  // WalletConnect persists the connected wallet state to localStorage.
  // We read it so AdminPauseControls can compare against NEXT_PUBLIC_ADMIN_ADDRESS.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = localStorage.getItem("walletState");
      if (raw) {
        const parsed = JSON.parse(raw) as { address?: string };
        if (parsed?.address) setConnectedAddress(parsed.address);
      }
    } catch {
      // ignore parse errors
    }
  }, []);

  // ── Active drag overlay widget ───────────────────────────────────────────────
  const activeWidget = activeId
    ? widgets.find((w) => w.id === activeId)
    : null;

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <main
      className="w-full max-w-4xl mx-auto px-4 py-8"
      aria-label="Vault dashboard"
    >
      {/* Screen-reader live region */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {liveMsg}
      </div>

      {/* Vault pause banner — shown prominently when vault is paused */}
      <VaultPauseBanner isPaused={isPaused} className="mb-6" />

      {/* Page heading */}
      <div className="mb-8">
        <h1 className="text-[length:var(--text-2xl)] font-[var(--font-semibold)] tracking-tight text-[var(--color-text)]">
          Dashboard
        </h1>
        <p className="text-[length:var(--text-sm)] text-[var(--color-text-muted)] mt-1">
          Real-time overview of the Aura yield vault.{" "}
          <span className="text-xs text-zinc-400">
            Drag widgets to reorder, or use arrow keys when focused on the grip
            handle.
          </span>
        </p>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={visibleWidgets.map((w) => w.id)}
          strategy={verticalListSortingStrategy}
        >
          {/*
            Responsive grid:
              mobile  → 1 column  (grid-cols-1)
              ≥768px  → 2 columns (md:grid-cols-2)
          */}
          <div
            className="grid grid-cols-1 md:grid-cols-2 gap-5"
            role="region"
            aria-label="Vault metrics — drag to reorder"
          >
            {visibleWidgets.map((widget) => (
              <SortableWidget
                key={widget.id}
                widget={widget}
                stats={stats}
                position={position}
                loading={loading}
                isDragging={activeId !== null}
                onRefresh={fetchStats}
                walletAddress={walletAddress}
              />
            ))}
          </div>
        </SortableContext>

        {/*
          DragOverlay renders the dragged item at cursor position.
          drop animation uses spring physics for a natural 60fps feel.
        */}
        <DragOverlay
          dropAnimation={{
            sideEffects: defaultDropAnimationSideEffects({
              styles: { active: { opacity: "0.4" } },
            }),
            duration: 200,
            easing: "cubic-bezier(0.25, 1, 0.5, 1)",
          }}
        >
          {activeWidget ? (
            <div
              className="shadow-2xl rounded-xl ring-2 ring-blue-500 opacity-95 rotate-1 scale-[1.02]"
              aria-hidden="true"
            >
              <WidgetContent
                id={activeWidget.id}
                stats={stats}
                position={position}
                loading={loading}
                walletAddress={walletAddress}
              />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {visibleWidgets.length === 0 && (
        <div className="text-center py-16 text-zinc-400">
          <p className="text-sm">All widgets are hidden.</p>
          <p className="text-xs mt-1">
            Go to{" "}
            <a href="/settings" className="text-blue-500 underline">
              Settings
            </a>{" "}
            to show widgets.
          </p>
        </div>
      )}

      {/* Vault action buttons — disabled when vault is paused */}
      <section
        aria-labelledby="actions-heading"
        className="mt-8"
      >
        <h2
          id="actions-heading"
          className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500"
        >
          Actions
        </h2>
        <VaultActions isPaused={isPaused} />
      </section>

      {/* Admin-only pause / unpause control */}
      <div className="mt-6">
        <AdminPauseControls
          isPaused={isPaused}
          connectedAddress={connectedAddress}
          onToggle={refreshPauseState}
        />
      </div>
    </main>
  );
}
