/**
 * Swagger UI and OpenAPI Routes — Issue #868
 *
 * Hosts Swagger UI at /api/docs with integrated OpenAPI 3.1 specification.
 *
 * Routes:
 *   GET  /api/docs         — Swagger UI (interactive API explorer)
 *   GET  /api/docs/spec    — OpenAPI 3.1 JSON specification
 *   GET  /api/docs/yaml    — OpenAPI 3.1 YAML specification
 */

import { Router, Request, Response } from "express";

export const swaggerRouter = Router();

/**
 * OpenAPI 3.1 specification covering all v1 endpoints.
 * Updated with complete request/response schemas, examples, and security schemes.
 */
const openApiSpec = {
  openapi: "3.1.0",
  info: {
    title: "Aura Vault Protocol API",
    version: "1.0.0",
    description: "REST API for Stellar vault operations with comprehensive request validation and graceful degradation",
    contact: {
      name: "Aura Vault Team",
      url: "https://auravault.xyz",
    },
    license: {
      name: "Apache 2.0",
      url: "https://www.apache.org/licenses/LICENSE-2.0.html",
    },
  },
  servers: [
    {
      url: "http://localhost:3001",
      description: "Local development",
    },
    {
      url: "https://api-testnet.auravault.xyz",
      description: "Stellar Testnet",
    },
    {
      url: "https://api.auravault.xyz",
      description: "Stellar Mainnet",
    },
  ],
  tags: [
    {
      name: "Auth",
      description: "Wallet-based authentication and session management",
    },
    {
      name: "Vault",
      description: "Vault operations (deposit, withdraw, harvest)",
    },
    {
      name: "Portfolio",
      description: "User vault positions and portfolio management",
    },
    {
      name: "Health",
      description: "Service health checks and status monitoring",
    },
  ],
  paths: {
    "/api/auth/login": {
      post: {
        tags: ["Auth"],
        summary: "Authenticate with wallet address",
        description: "Login using a Stellar public key to obtain JWT tokens",
        operationId: "login",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["walletAddress"],
                properties: {
                  walletAddress: {
                    type: "string",
                    pattern: "^G[A-Z2-7]{55}$",
                    description: "Stellar public key (G-address, 56 characters)",
                    example: "GABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCDEFGHIJKLMNOPQRST",
                  },
                  deviceId: {
                    type: "string",
                    description: "Optional device identifier for multi-device sessions",
                    example: "device-uuid-1234",
                  },
                  tier: {
                    type: "string",
                    enum: ["free", "paid"],
                    default: "free",
                    description: "User tier for rate limiting",
                  },
                },
              },
              examples: {
                basic: {
                  value: {
                    walletAddress: "GABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCDEFGHIJKLMNOPQRST",
                  },
                },
                withDevice: {
                  value: {
                    walletAddress: "GABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCDEFGHIJKLMNOPQRST",
                    deviceId: "device-uuid-1234",
                    tier: "free",
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Authentication successful, tokens issued",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: { type: "boolean", example: true },
                    data: {
                      type: "object",
                      properties: {
                        accessToken: {
                          type: "string",
                          description: "JWT access token (15 min expiry)",
                        },
                        refreshToken: {
                          type: "string",
                          description: "JWT refresh token (30 days expiry)",
                        },
                        expiresIn: {
                          type: "number",
                          description: "Access token TTL in seconds",
                          example: 900,
                        },
                      },
                    },
                    meta: {
                      type: "object",
                      properties: {
                        requestId: { type: "string", format: "uuid" },
                        timestamp: { type: "string", format: "date-time" },
                        version: { type: "string", example: "1.0.0" },
                      },
                    },
                  },
                },
              },
            },
          },
          "400": {
            description: "Validation error",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/ValidationError",
                },
              },
            },
          },
          "429": {
            description: "Rate limit exceeded (20 req per 15 min for auth endpoints)",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/RateLimitError",
                },
              },
            },
          },
        },
      },
    },
    "/api/v1/vault/deposit": {
      post: {
        tags: ["Vault"],
        summary: "Submit vault deposit transaction",
        description: "Submit a signed deposit transaction XDR to the vault",
        operationId: "depositToVault",
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["signedXdr", "address"],
                properties: {
                  signedXdr: {
                    type: "string",
                    description: "Base64-encoded Stellar TransactionEnvelope XDR",
                    example: "AAAAAgAAAABnATrgvV2Tz...",
                  },
                  address: {
                    type: "string",
                    pattern: "^G[A-Z2-7]{55}$",
                    description: "Depositor Stellar public key",
                    example: "GABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789ABCDEFGHIJKLMNOPQRST",
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Deposit transaction submitted successfully",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    success: { type: "boolean", example: true },
                    data: {
                      type: "object",
                      properties: {
                        operation: { type: "string", example: "deposit" },
                        address: { type: "string" },
                        hash: { type: "string", description: "Transaction hash" },
                        ledger: { type: "number" },
                        envelopeXdr: { type: "string" },
                        resultXdr: { type: "string" },
                      },
                    },
                  },
                },
              },
            },
          },
          "400": {
            description: "Validation or XDR parsing error",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/ValidationError",
                },
              },
            },
          },
          "401": {
            description: "Unauthorized - invalid or missing JWT token",
          },
          "422": {
            description: "Transaction failed on Horizon",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/TransactionError",
                },
              },
            },
          },
          "503": {
            description: "Service unavailable - degraded mode (cached responses or error)",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/ServiceUnavailableError",
                },
              },
            },
          },
        },
      },
    },
    "/api/v1/vault/withdraw": {
      post: {
        tags: ["Vault"],
        summary: "Submit vault withdrawal transaction",
        description: "Submit a signed withdrawal transaction XDR to burn shares",
        operationId: "withdrawFromVault",
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["signedXdr", "address", "shares"],
                properties: {
                  signedXdr: {
                    type: "string",
                    description: "Base64-encoded Stellar TransactionEnvelope XDR",
                  },
                  address: {
                    type: "string",
                    pattern: "^G[A-Z2-7]{55}$",
                    description: "Withdrawer Stellar public key",
                  },
                  shares: {
                    type: "string",
                    pattern: "^\\d+(\\.\\d{1,7})?$",
                    description: "Amount of shares to burn (up to 7 decimal places)",
                    example: "1000.5",
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Withdrawal transaction submitted successfully",
          },
          "400": {
            description: "Validation error",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/ValidationError",
                },
              },
            },
          },
          "401": {
            description: "Unauthorized",
          },
          "422": {
            description: "Transaction failed",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/TransactionError",
                },
              },
            },
          },
          "503": {
            description: "Service unavailable",
          },
        },
      },
    },
    "/api/v1/vault/harvest": {
      post: {
        tags: ["Vault"],
        summary: "Submit vault harvest transaction",
        description: "Submit a signed harvest transaction to inject yield",
        operationId: "harvestVault",
        security: [{ BearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["signedXdr", "yieldAmount"],
                properties: {
                  signedXdr: {
                    type: "string",
                    description: "Base64-encoded Stellar TransactionEnvelope XDR",
                  },
                  yieldAmount: {
                    type: "string",
                    pattern: "^\\d+(\\.\\d{1,7})?$",
                    description: "Amount of yield to inject (up to 7 decimal places)",
                    example: "500.25",
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Harvest transaction submitted successfully",
          },
          "400": {
            description: "Validation error",
          },
          "401": {
            description: "Unauthorized",
          },
          "422": {
            description: "Transaction failed",
          },
          "503": {
            description: "Service unavailable",
          },
        },
      },
    },
    "/api/health": {
      get: {
        tags: ["Health"],
        summary: "Health check endpoint",
        description: "Returns service health status and dependencies",
        operationId: "healthCheck",
        responses: {
          "200": {
            description: "Service status",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    status: {
                      type: "string",
                      enum: ["ok", "degraded", "starting"],
                      description: "Overall service status",
                    },
                    timestamp: {
                      type: "string",
                      format: "date-time",
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      BearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description: "JWT access token obtained from POST /api/auth/login",
      },
    },
    schemas: {
      ValidationError: {
        type: "object",
        properties: {
          success: { type: "boolean", example: false },
          error: {
            type: "object",
            properties: {
              code: { type: "string", example: "VALIDATION_ERROR" },
              message: { type: "string" },
              details: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    field: { type: "string" },
                    message: { type: "string" },
                    code: { type: "string" },
                  },
                },
              },
            },
          },
          meta: {
            type: "object",
            properties: {
              requestId: { type: "string", format: "uuid" },
              timestamp: { type: "string", format: "date-time" },
            },
          },
        },
      },
      TransactionError: {
        type: "object",
        properties: {
          success: { type: "boolean", example: false },
          error: {
            type: "object",
            properties: {
              code: { type: "string", example: "TRANSACTION_FAILED" },
              message: { type: "string", description: "User-friendly error message" },
              details: {
                type: "object",
                properties: {
                  resultCodes: {
                    type: "object",
                    description: "Stellar transaction result codes",
                  },
                },
              },
            },
          },
        },
      },
      RateLimitError: {
        type: "object",
        properties: {
          error: { type: "string", example: "Rate limit exceeded" },
          retryAfter: { type: "number", description: "Seconds to retry" },
        },
      },
      ServiceUnavailableError: {
        type: "object",
        properties: {
          success: { type: "boolean", example: false },
          error: {
            type: "object",
            properties: {
              code: { type: "string", example: "SERVICE_UNAVAILABLE" },
              message: { type: "string", description: "Degraded mode message" },
            },
          },
        },
      },
    },
  },
  security: [],
};

// ── GET /api/docs ─────────────────────────────────────────────────────────────
// Swagger UI HTML interface

swaggerRouter.get("/", (req: Request, res: Response): void => {
  const specUrl = req.baseUrl + "/spec";

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Aura Vault API - Swagger UI</title>
        <meta charset="utf-8"/>
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@4.15.5/swagger-ui.css">
      </head>
      <body>
        <div id="swagger-ui"></div>
        <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@4.15.5/swagger-ui-bundle.js" charset="UTF-8"></script>
        <script>
          window.onload = () => {
            const ui = SwaggerUIBundle({
              url: "${specUrl}",
              dom_id: '#swagger-ui',
              deepLinking: true,
              presets: [
                SwaggerUIBundle.presets.apis,
                SwaggerUIBundle.SwaggerUIStandalonePreset
              ],
              plugins: [
                SwaggerUIBundle.plugins.DownloadUrl
              ],
              layout: "BaseLayout",
              defaultModelsExpandDepth: 1,
              defaultModelExpandDepth: 1,
            });
            window.ui = ui;
          };
        </script>
      </body>
    </html>
  `);
});

// ── GET /api/docs/spec ────────────────────────────────────────────────────────
// OpenAPI JSON specification

swaggerRouter.get("/spec", (req: Request, res: Response): void => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=3600"); // Cache for 1 hour
  res.json(openApiSpec);
});

// ── GET /api/docs/yaml ────────────────────────────────────────────────────────
// OpenAPI YAML specification

swaggerRouter.get("/yaml", (req: Request, res: Response): void => {
  // Convert JSON spec to YAML format
  const yaml = jsonToYaml(openApiSpec);
  res.setHeader("Content-Type", "application/x-yaml; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.send(yaml);
});

// ── Helper: Convert JSON to YAML ──────────────────────────────────────────────

/**
 * Simple JSON to YAML converter for OpenAPI spec.
 * Handles objects, arrays, strings, numbers, booleans.
 */
function jsonToYaml(obj: unknown, indent = 0): string {
  const indentStr = "  ".repeat(indent);
  const nextIndent = "  ".repeat(indent + 1);

  if (obj === null || obj === undefined) {
    return "null";
  }

  if (typeof obj === "boolean") {
    return obj ? "true" : "false";
  }

  if (typeof obj === "number") {
    return String(obj);
  }

  if (typeof obj === "string") {
    // Escape special characters
    if (obj.includes("\n") || obj.includes(":") || obj.includes("#")) {
      const escaped = obj.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      return `"${escaped}"`;
    }
    return obj;
  }

  if (Array.isArray(obj)) {
    if (obj.length === 0) {
      return "[]";
    }
    const items = obj
      .map((item) => {
        const itemYaml = jsonToYaml(item, indent + 1);
        return `${nextIndent}- ${itemYaml}`;
      })
      .join("\n");
    return "\n" + items;
  }

  if (typeof obj === "object") {
    const entries = Object.entries(obj).filter(([, v]) => v !== undefined);
    if (entries.length === 0) {
      return "{}";
    }
    const pairs = entries
      .map(([key, value]) => {
        const valueYaml = jsonToYaml(value, indent + 1);
        if (valueYaml.includes("\n")) {
          return `${nextIndent}${key}:${valueYaml}`;
        }
        return `${nextIndent}${key}: ${valueYaml}`;
      })
      .join("\n");
    return "\n" + pairs;
  }

  return String(obj);
}
