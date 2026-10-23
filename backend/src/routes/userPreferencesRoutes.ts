import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { getWritePool } from "../db.js";
import { logger } from "../logger.js";

export const userPreferencesRouter = Router();

const widgetSchema = z.object({
  id: z.enum(["hero", "apy", "depositors", "last-harvest", "user-position", "referral"]),
  label: z.string().max(80),
  visible: z.boolean(),
}).strict();

const stellarAddress = /^G[A-Z2-7]{55}$/;
const dashboardSchema = z.object({
  dashboardWidgets: z.array(widgetSchema).max(12).optional(),
  addressAliases: z.record(z.string().regex(stellarAddress), z.string().trim().min(1).max(64).nullable()).optional(),
}).strict().refine((value) => value.dashboardWidgets !== undefined || value.addressAliases !== undefined);

function userId(req: Request): string | null {
  const id = (req as Request & { user?: { sub?: unknown } }).user?.sub;
  return typeof id === "string" && id.length > 0 ? id : null;
}

userPreferencesRouter.get("/", async (req: Request, res: Response): Promise<void> => {
  const id = userId(req);
  if (!id) { res.status(401).json({ error: "Missing authenticated user" }); return; }
  try {
    const result = await getWritePool().query<{ preferences: Record<string, unknown> }>(
      "SELECT preferences FROM user_preferences WHERE user_id = $1",
      [id],
    );
    res.json({ preferences: result.rows[0]?.preferences ?? {} });
  } catch (error) {
    logger.error({ error }, "[userPreferences] read failed");
    res.status(500).json({ error: "Unable to load user preferences" });
  }
});

userPreferencesRouter.put("/", async (req: Request, res: Response): Promise<void> => {
  const id = userId(req);
  if (!id) { res.status(401).json({ error: "Missing authenticated user" }); return; }
  const parsed = dashboardSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid user preferences", details: parsed.error.issues });
    return;
  }
  try {
    const updates = {
      ...(parsed.data.dashboardWidgets ? { dashboardWidgets: parsed.data.dashboardWidgets } : {}),
      ...(parsed.data.addressAliases ? { addressAliases: parsed.data.addressAliases } : {}),
    };
    const result = await getWritePool().query<{ preferences: Record<string, unknown> }>(
      `INSERT INTO user_preferences (user_id, preferences)
       VALUES ($1, $2::jsonb)
       ON CONFLICT (user_id) DO UPDATE
       SET preferences = user_preferences.preferences || EXCLUDED.preferences,
           updated_at = NOW()
       RETURNING preferences`,
      [id, JSON.stringify(updates)],
    );
    res.json({ preferences: result.rows[0]?.preferences ?? {} });
  } catch (error) {
    logger.error({ error }, "[userPreferences] write failed");
    res.status(500).json({ error: "Unable to save user preferences" });
  }
});
