/** PostgreSQL-backed webhook management routes and event dispatch exports. */

import crypto from "node:crypto";
import { Router, type Request, type Response } from "express";
import {
  createWebhook,
  getWebhook,
  listWebhooks,
  updateWebhook,
  deleteWebhook,
  getDeliveries,
  signPayload,
  dispatchWebhookEvent,
  type VaultEventType,
} from "./services/webhookService.js";
import { successResponse, errorResponse } from "./dto/index.js";
import { logger } from "./logger.js";

export { signPayload, dispatchWebhookEvent };

export const webhookRouter = Router();

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

webhookRouter.post("/", async (req: Request, res: Response): Promise<void> => {
  const { url, secret, events: eventTypes = [] } = req.body as {
    url?: string;
    secret?: string;
    events?: VaultEventType[];
  };
  if (!url || !secret) {
    res.status(400).json({ error: "url and secret required" });
    return;
  }
  if (!isHttpUrl(url)) {
    res.status(400).json(errorResponse("INVALID_URL", "url must be a valid HTTP/HTTPS URL"));
    return;
  }
  try {
    res.status(201).json(successResponse(await createWebhook({ url, secret, eventTypes })));
  } catch (err) {
    logger.error({ err }, "[webhooks] Failed to register webhook");
    res.status(500).json(errorResponse("INTERNAL_ERROR", "Failed to register webhook"));
  }
});

webhookRouter.get("/", async (_req: Request, res: Response): Promise<void> => {
  try {
    res.json(successResponse(await listWebhooks()));
  } catch (err) {
    logger.error({ err }, "[webhooks] Failed to list webhooks");
    res.status(500).json(errorResponse("INTERNAL_ERROR", "Failed to list webhooks"));
  }
});

webhookRouter.get("/:id/deliveries", async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params as { id: string };
  try {
    const webhook = await getWebhook(id);
    if (!webhook) {
      res.status(404).json(errorResponse("NOT_FOUND", "Webhook not found"));
      return;
    }
    res.json(successResponse(await getDeliveries(id)));
  } catch (err) {
    logger.error({ err, id }, "[webhooks] Failed to get delivery log");
    res.status(500).json(errorResponse("INTERNAL_ERROR", "Failed to get delivery log"));
  }
});

webhookRouter.get("/:id", async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params as { id: string };
  try {
    const webhook = await getWebhook(id);
    if (!webhook) {
      res.status(404).json(errorResponse("NOT_FOUND", "Webhook not found"));
      return;
    }
    res.json(successResponse(webhook));
  } catch (err) {
    logger.error({ err, id }, "[webhooks] Failed to get webhook");
    res.status(500).json(errorResponse("INTERNAL_ERROR", "Failed to get webhook"));
  }
});

webhookRouter.patch("/:id", async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params as { id: string };
  const { url, secret, events: eventTypes } = req.body as {
    url?: string;
    secret?: string;
    events?: VaultEventType[];
  };
  if (url && !isHttpUrl(url)) {
    res.status(400).json(errorResponse("INVALID_URL", "url must be a valid HTTP/HTTPS URL"));
    return;
  }
  try {
    const webhook = await updateWebhook(id, { url, secret, eventTypes });
    if (!webhook) {
      res.status(404).json(errorResponse("NOT_FOUND", "Webhook not found"));
      return;
    }
    res.json(successResponse(webhook));
  } catch (err) {
    logger.error({ err, id }, "[webhooks] Failed to update webhook");
    res.status(500).json(errorResponse("INTERNAL_ERROR", "Failed to update webhook"));
  }
});

webhookRouter.delete("/:id", async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params as { id: string };
  try {
    if (!(await deleteWebhook(id))) {
      res.status(404).json(errorResponse("NOT_FOUND", "Webhook not found"));
      return;
    }
    res.status(204).send();
  } catch (err) {
    logger.error({ err, id }, "[webhooks] Failed to delete webhook");
    res.status(500).json(errorResponse("INTERNAL_ERROR", "Failed to delete webhook"));
  }
});

webhookRouter.post("/verify", (req: Request, res: Response): void => {
  const { secret, body, signature } = req.body as {
    secret?: string;
    body?: string;
    signature?: string;
  };
  if (!secret || body === undefined || !signature) {
    res.status(400).json(errorResponse("MISSING_FIELDS", "secret, body, and signature are required"));
    return;
  }
  const expected = signPayload(secret, body);
  const expectedBytes = Buffer.from(expected, "utf8");
  const suppliedBytes = Buffer.from(signature, "utf8");
  const valid = expectedBytes.length === suppliedBytes.length &&
    crypto.timingSafeEqual(expectedBytes, suppliedBytes);
  res.json(successResponse({ valid }));
});
