import type { Request, Response } from "express";

export type TimeRange = "7d" | "30d" | "90d" | "all";
export type AlertDirection = "above" | "below" | "either";
export type AlertChannel = "toast" | "email";

export interface SharePriceAlert {
  id: string;
  threshold: number; // 1% to 50%
  direction: AlertDirection;
  channels: AlertChannel[];
  email?: string;
  initialPrice?: number;
  lastCheckedPrice?: number;
  lastTriggeredAt?: string | null;
  active: boolean;
  createdAt: string;
}

export interface UserPreferences {
  default_history_range: TimeRange;
  currency?: string;
  language?: string;
  emailNotifications?: boolean;
  pushNotifications?: boolean;
  harvestAlerts?: boolean;
  priceAlerts: SharePriceAlert[];
}

const VALID_RANGES: TimeRange[] = ["7d", "30d", "90d", "all"];
const VALID_DIRECTIONS: AlertDirection[] = ["above", "below", "either"];
const VALID_CHANNELS: AlertChannel[] = ["toast", "email"];

// In-memory store keyed by wallet address — replace with DB in production
export const preferencesStore = new Map<string, UserPreferences>();

export function getPreferences(req: Request, res: Response): void {
  const userId = ((req as any).user?.sub as string) || "anonymous";
  const prefs = preferencesStore.get(userId) ?? {
    default_history_range: "30d" as TimeRange,
    priceAlerts: [],
  };
  res.json(prefs);
}

export function updatePreferences(req: Request, res: Response): void {
  const userId = ((req as any).user?.sub as string) || "anonymous";
  const body = (req.body ?? {}) as Partial<UserPreferences> & {
    alerts?: any[];
    sharePriceAlerts?: any[];
  };

  const {
    default_history_range,
    currency,
    language,
    emailNotifications,
    pushNotifications,
    harvestAlerts,
  } = body;

  if (
    default_history_range !== undefined &&
    !VALID_RANGES.includes(default_history_range)
  ) {
    res.status(400).json({
      error: `default_history_range must be one of: ${VALID_RANGES.join(", ")}`,
    });
    return;
  }

  const rawAlerts = body.priceAlerts ?? body.sharePriceAlerts ?? body.alerts;

  if (rawAlerts !== undefined) {
    if (!Array.isArray(rawAlerts)) {
      res.status(400).json({ error: "priceAlerts must be an array" });
      return;
    }

    for (let i = 0; i < rawAlerts.length; i++) {
      const alert = rawAlerts[i];
      const threshold = Number(alert.threshold);
      if (isNaN(threshold) || threshold < 1 || threshold > 50) {
        res.status(400).json({
          error: "Threshold percentage must be between 1% and 50%",
        });
        return;
      }

      if (!VALID_DIRECTIONS.includes(alert.direction)) {
        res.status(400).json({
          error: "Direction must be 'above', 'below', or 'either'",
        });
        return;
      }

      const channels: string[] = Array.isArray(alert.channels)
        ? alert.channels
        : alert.channel === "both"
        ? ["toast", "email"]
        : [alert.channel];

      const validChannels =
        channels.length > 0 &&
        channels.every((ch) => VALID_CHANNELS.includes(ch as AlertChannel));

      if (!validChannels) {
        res.status(400).json({
          error: "Notification channel must be in-app toast and/or email",
        });
        return;
      }
    }
  }

  const current = preferencesStore.get(userId) ?? {
    default_history_range: "30d" as TimeRange,
    priceAlerts: [],
  };

  const formattedAlerts: SharePriceAlert[] =
    rawAlerts !== undefined
      ? rawAlerts.map((a: any) => ({
          id:
            a.id ||
            `alert-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
          threshold: Number(a.threshold),
          direction: a.direction,
          channels: Array.isArray(a.channels)
            ? a.channels
            : a.channel === "both"
            ? ["toast", "email"]
            : [a.channel || "toast"],
          email: a.email,
          initialPrice:
            typeof a.initialPrice === "number" ? a.initialPrice : undefined,
          lastCheckedPrice:
            typeof a.lastCheckedPrice === "number" ? a.lastCheckedPrice : undefined,
          lastTriggeredAt: a.lastTriggeredAt ?? null,
          active: a.active !== false,
          createdAt: a.createdAt || new Date().toISOString(),
        }))
      : current.priceAlerts ?? [];

  const updated: UserPreferences = {
    ...current,
    ...(default_history_range !== undefined ? { default_history_range } : {}),
    ...(currency !== undefined ? { currency } : {}),
    ...(language !== undefined ? { language } : {}),
    ...(emailNotifications !== undefined ? { emailNotifications } : {}),
    ...(pushNotifications !== undefined ? { pushNotifications } : {}),
    ...(harvestAlerts !== undefined ? { harvestAlerts } : {}),
    priceAlerts: formattedAlerts,
  };

  preferencesStore.set(userId, updated);
  res.json(updated);
}
