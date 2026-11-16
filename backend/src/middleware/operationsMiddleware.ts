import type { Request, Response, NextFunction } from "express";
import type { TokenPayload } from "../auth.js";

/** Allows a signed operations role claim or an authenticated subject on the explicit operations allowlist. */
export function requireOperations(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const user = (req as Request & { user?: TokenPayload }).user;
  const configuredOperationsUsers = (process.env.OPERATIONS_USER_IDS ?? "")
    .split(",")
    .map((userId) => userId.trim())
    .filter(Boolean);
  if (user?.role !== "operations" && (!user?.sub || !configuredOperationsUsers.includes(user.sub))) {
    res.status(403).json({ error: "Operations access required" });
    return;
  }
  next();
}
