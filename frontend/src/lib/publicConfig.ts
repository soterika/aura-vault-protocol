/**
 * Public frontend configuration validator — Issue #1468
 *
 * Validates NEXT_PUBLIC_* settings at build/startup time and produces
 * actionable diagnostics naming the offending variable without ever echoing
 * raw values or embedded URL credentials.
 */

export const VALID_STELLAR_NETWORKS = [
  "testnet",
  "futurenet",
  "mainnet",
  "standalone",
] as const;

export type StellarNetwork = (typeof VALID_STELLAR_NETWORKS)[number];

export interface PublicConfigDiagnostic {
  variable: string;
  level: "error" | "warning";
  message: string;
}

export interface PublicConfigResult {
  valid: boolean;
  diagnostics: PublicConfigDiagnostic[];
  resolved: {
    network: StellarNetwork;
    apiUrl: string | null;
    wsUrl: string | null;
    explorerUrl: string | null;
    adminAddress: string | null;
  };
}

const STELLAR_PUBLIC_KEY_RE = /^G[A-Z2-7]{55}$/;

function validateUrlVar(
  variable: string,
  raw: string | undefined,
  allowedProtocols: readonly string[],
  required: boolean,
  diagnostics: PublicConfigDiagnostic[]
): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) {
    if (required) {
      diagnostics.push({
        variable,
        level: "error",
        message: `${variable} is missing or empty. Set it to a valid ${allowedProtocols.join(" or ")} URL (e.g. https://api.example.com).`,
      });
    }
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    diagnostics.push({
      variable,
      level: "error",
      message: `${variable} is malformed. Provide a valid ${allowedProtocols.join(" or ")} URL without whitespace or invalid characters.`,
    });
    return null;
  }

  if (parsed.username || parsed.password) {
    diagnostics.push({
      variable,
      level: "error",
      message: `${variable} must not contain embedded credentials (username/password). Remove userinfo from the URL.`,
    });
    return null;
  }

  if (!allowedProtocols.includes(parsed.protocol)) {
    diagnostics.push({
      variable,
      level: "error",
      message: `${variable} has unsupported protocol "${parsed.protocol}". Expected ${allowedProtocols.join(" or ")}.`,
    });
    return null;
  }

  return parsed.origin + parsed.pathname.replace(/\/+$/, "");
}

export function validatePublicConfig(
  env: Record<string, string | undefined> = process.env,
  options: { requireApiUrl?: boolean } = {}
): PublicConfigResult {
  const diagnostics: PublicConfigDiagnostic[] = [];
  const requireApiUrl = options.requireApiUrl ?? false;

  // 1. NEXT_PUBLIC_STELLAR_NETWORK
  const rawNetwork = env.NEXT_PUBLIC_STELLAR_NETWORK?.trim();
  let network: StellarNetwork = "testnet";
  if (!rawNetwork) {
    diagnostics.push({
      variable: "NEXT_PUBLIC_STELLAR_NETWORK",
      level: "warning",
      message:
        'NEXT_PUBLIC_STELLAR_NETWORK is not set; defaulting to "testnet".',
    });
  } else {
    const normalized = rawNetwork.toLowerCase();
    if ((VALID_STELLAR_NETWORKS as readonly string[]).includes(normalized)) {
      network = normalized as StellarNetwork;
    } else {
      diagnostics.push({
        variable: "NEXT_PUBLIC_STELLAR_NETWORK",
        level: "error",
        message: `NEXT_PUBLIC_STELLAR_NETWORK is invalid. Expected one of: ${VALID_STELLAR_NETWORKS.join(", ")}.`,
      });
    }
  }

  // 2. NEXT_PUBLIC_API_URL
  const apiUrl = validateUrlVar(
    "NEXT_PUBLIC_API_URL",
    env.NEXT_PUBLIC_API_URL,
    ["http:", "https:"],
    requireApiUrl,
    diagnostics
  );

  // 3. NEXT_PUBLIC_WS_URL (optional)
  const wsUrl = validateUrlVar(
    "NEXT_PUBLIC_WS_URL",
    env.NEXT_PUBLIC_WS_URL,
    ["ws:", "wss:"],
    false,
    diagnostics
  );

  // 4. NEXT_PUBLIC_STELLAR_EXPLORER_URL (optional)
  const explorerUrl = validateUrlVar(
    "NEXT_PUBLIC_STELLAR_EXPLORER_URL",
    env.NEXT_PUBLIC_STELLAR_EXPLORER_URL,
    ["http:", "https:"],
    false,
    diagnostics
  );

  // 5. NEXT_PUBLIC_ADMIN_ADDRESS (optional Stellar G... public key)
  const rawAdmin = env.NEXT_PUBLIC_ADMIN_ADDRESS?.trim();
  let adminAddress: string | null = null;
  if (rawAdmin) {
    if (STELLAR_PUBLIC_KEY_RE.test(rawAdmin)) {
      adminAddress = rawAdmin;
    } else {
      diagnostics.push({
        variable: "NEXT_PUBLIC_ADMIN_ADDRESS",
        level: "error",
        message:
          "NEXT_PUBLIC_ADMIN_ADDRESS is malformed. Expected a 56-character Stellar public key starting with 'G'.",
      });
    }
  }

  const hasErrors = diagnostics.some((d) => d.level === "error");
  return {
    valid: !hasErrors,
    diagnostics,
    resolved: {
      network,
      apiUrl,
      wsUrl,
      explorerUrl,
      adminAddress,
    },
  };
}

export function assertPublicConfig(
  env: Record<string, string | undefined> = process.env,
  options: { requireApiUrl?: boolean } = {}
): PublicConfigResult {
  const result = validatePublicConfig(env, options);
  if (!result.valid) {
    const errors = result.diagnostics
      .filter((d) => d.level === "error")
      .map((d) => `- [${d.variable}] ${d.message}`)
      .join("\n");
    throw new Error(`Invalid public frontend configuration:\n${errors}`);
  }
  return result;
}
