import type { Request, Response, NextFunction } from "express";
import { logger } from "../logger.js";

export interface ApiError extends Error {
  statusCode?: number;
  isOperational?: boolean;
  userMessage?: string;
}

const errorMessages: Record<string, string> = {
  INVALID_WALLET_ADDRESS: "The wallet address provided is not valid. Please check and try again.",
  INSUFFICIENT_BALANCE: "Your account doesn't have enough balance for this transaction.",
  TRANSACTION_FAILED: "The transaction couldn't be completed. Please try again.",
  NETWORK_ERROR: "Network connection error. Please check your internet and try again.",
  RATE_LIMIT_EXCEEDED: "Too many requests. Please wait a moment and try again.",
  UNAUTHORIZED: "You don't have permission to perform this action.",
  NOT_FOUND: "The requested resource was not found.",
  INVALID_INPUT: "The information you provided is not valid. Please check and try again.",
  TIMEOUT: "The request took too long. Please try again.",
  SERVICE_UNAVAILABLE: "The service is temporarily unavailable. Please try again later.",
  REFRESH_TOKEN_EXPIRED: "Your session has expired. Please log in again.",
  INVALID_TOKEN: "Invalid authentication token. Please log in again.",
};

export function createApiError(
  code: string,
  statusCode: number = 400,
  userMessage?: string
): ApiError {
  const error = new Error(code) as ApiError;
  error.statusCode = statusCode;
  error.isOperational = true;
  error.userMessage = userMessage || errorMessages[code] || "An error occurred. Please try again.";
  return error;
}

export function errorHandler(
  err: Error | ApiError,
  req: Request,
  res: Response,
  _next: NextFunction
) {
  const apiError = err as ApiError;
  const statusCode = apiError.statusCode || 500;
  const userMessage =
    apiError.userMessage ||
    errorMessages[err.message] ||
    "An unexpected error occurred. Please try again.";

  logger.error(
    {
      err: {
        message: err.message,
        statusCode,
        stack: err.stack,
      },
      correlationId:
        (req as Request & { correlationId?: string }).correlationId ?? "unknown",
    },
    "Request error"
  );

  const response = {
    success: false,
    error: {
      code: err.message,
      message: userMessage,
      ...(process.env.NODE_ENV === "development" && { details: err.message }),
    },
    meta: {
      requestId: (req as Request & { requestId?: string }).requestId ?? "unknown",
      timestamp: new Date().toISOString(),
      version: "1.0.0",
    },
  };

  res.status(statusCode).json(response);
}

export async function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
