/**
 * validateXdr middleware — ensures `signedXdr` in the request body is a
 * well-formed Stellar TransactionEnvelope before the route handler runs.
 *
 * Responds with 400 and a structured error on failure so the route handler
 * only deals with valid XDR.
 */

import { Request, Response, NextFunction, RequestHandler } from "express";
import { parseSignedXdr, XdrValidationError } from "../services/vaultService.js";

export function validateXdr(): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const { signedXdr } = req.body ?? {};

    if (!signedXdr) {
      res.status(400).json({
        error: "signedXdr is required",
        code: "MISSING_FIELD",
      });
      return;
    }

    if (typeof signedXdr !== "string") {
      res.status(400).json({
        error: "signedXdr must be a string",
        code: "INVALID_TYPE",
      });
      return;
    }

    try {
      parseSignedXdr(signedXdr);
    } catch (err) {
      if (err instanceof XdrValidationError) {
        res.status(400).json({
          error: err.message,
          code: err.code,
        });
        return;
      }
      // Unexpected parse error — pass through to global error handler
      next(err);
      return;
    }

    next();
  };
}
