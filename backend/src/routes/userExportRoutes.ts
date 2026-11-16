import { Router, type Request, type Response } from "express";
import { authenticate } from "../middleware/authMiddleware.js";
import { userRateLimiter } from "../middleware/rateLimitMiddleware.js";
import {
  downloadUserExport,
  ExportEmailRequiredError,
  ExportRateLimitError,
  requestUserExport,
} from "../services/userExportService.js";
import { logger } from "../logger.js";

export const userExportRouter = Router();

userExportRouter.get(
  "/",
  authenticate,
  userRateLimiter(),
  async (req: Request, res: Response): Promise<void> => {
    const walletAddress = (req as Request & { user?: { sub?: string } }).user?.sub;
    if (!walletAddress) {
      res.status(401).json({ error: "Authenticated wallet is missing" });
      return;
    }
    try {
      const job = await requestUserExport(walletAddress);
      res.status(202).json(job);
    } catch (err) {
      if (err instanceof ExportRateLimitError) {
        res.status(429).json({ error: "One export is allowed per user every 24 hours" });
        return;
      }
      if (err instanceof ExportEmailRequiredError) {
        res.status(400).json({ error: "Add an active email alert subscription before requesting an export" });
        return;
      }
      logger.error({ err, walletAddress }, "Failed to queue GDPR data export");
      res.status(500).json({ error: "Failed to queue data export" });
    }
  }
);

userExportRouter.get(
  "/:id/download",
  async (req: Request, res: Response): Promise<void> => {
    const result = await downloadUserExport(
      String(req.params.id),
      String(req.query.token ?? "")
    );
    if (result.status === "pending") {
      res.status(409).json({ error: "Export is not ready" });
      return;
    }
    if (result.status === "failed") {
      res.status(500).json({ error: "Export generation failed" });
      return;
    }
    if (result.status !== "ready" || !result.data) {
      res.status(404).json({ error: "Export not found or download link expired" });
      return;
    }

    res
      .set("Content-Type", "application/json; charset=utf-8")
      .set("Cache-Control", "private, no-store")
      .set("Content-Disposition", 'attachment; filename="aura-vault-data-export.json"')
      .send(result.data);
  }
);