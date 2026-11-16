import type { Request, Response } from "express";

export interface Announcement {
  id: string;
  type: "info" | "warning" | "critical";
  title: string;
  message?: string;
  createdAt: string;
}

// In-memory store — replace with DB in production
const store: Announcement[] = [
  {
    id: "ann-001",
    type: "info",
    title: "Welcome to Aura Vault",
    message: "Deposits and withdrawals are live on Stellar testnet.",
    createdAt: new Date().toISOString(),
  },
];

export function getAnnouncements(_req: Request, res: Response): void {
  res.json(store);
}

export function createAnnouncement(req: Request, res: Response): void {
  const { type, title, message } = req.body as Partial<Announcement>;
  if (!type || !title) {
    res.status(400).json({ error: "type and title are required" });
    return;
  }
  const allowed = ["info", "warning", "critical"];
  if (!allowed.includes(type)) {
    res
      .status(400)
      .json({ error: `type must be one of: ${allowed.join(", ")}` });
    return;
  }
  const ann: Announcement = {
    id: `ann-${Date.now()}`,
    type,
    title,
    message,
    createdAt: new Date().toISOString(),
  };
  store.push(ann);
  res.status(201).json(ann);
}
