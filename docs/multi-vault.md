# Multi-Vault Deployment Architecture

> **Implementation status:** The repository currently deploys independent
> `AuraVault` instances through the Stellar CLI and deployment automation. It
> does not contain an on-chain Soroban vault factory. The EVM-side strategy and
> access-control components described below are separate integrations and are
> not deployed by `aura-factory/` in this repository.

This document describes how multiple Aura Vault instances are deployed, how the supporting contracts interact, how the backend routes requests across vaults, and how the frontend presents vault selection to users.

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Factory Contract Interaction Pattern](#factory-contract-interaction-pattern)
3. [Vault Registry Management](#vault-registry-management)
4. [Per-Vault Configuration Options](#per-vault-configuration-options)
5. [Supporting Contracts](#supporting-contracts)
6. [Backend Multi-Vault Routing](#backend-multi-vault-routing)
7. [Frontend Vault Selector UI](#frontend-vault-selector-ui)
8. [Naming Conventions](#naming-conventions)
9. [Deployment Checklist](#deployment-checklist)

---

## Architecture Overview

A multi-vault deployment consists of:

- **Multiple `AuraVault` contract instances**, each holding a distinct SEP-41 underlying token and maintaining independent share accounting.
- **`AuraStrategy`** (EVM sidechain / Solidity) — deployed once per vault that uses the strategy layer; routes assets between Aave and Compound for yield.
- **`AuraPriceOracle`** (EVM sidechain / Solidity) — shared across vaults; provides normalized Chainlink price feeds for alternate-token harvest conversions.
- **`VaultAccessControl`** (EVM sidechain / Solidity) — shared RBAC contract that grants admin, strategy manager, operator, and support roles across all vaults.
- **Backend API** — a single Express.js service that routes requests to the correct vault contract based on a `vaultId` path parameter.
- **Frontend** — a `VaultComparison` component for selecting a vault and a `VaultDashboard` for interacting with the chosen vault.

```
┌─────────────────────────────────────────────────────┐
│                    Frontend / Mobile                │
│   VaultComparison ─► vault selection ─► VaultDashboard │
└────────────────────────┬────────────────────────────┘
                         │ REST API
                         ▼
┌─────────────────────────────────────────────────────┐
│              Backend API (Express.js)               │
│  /api/v1/vaults            — list all vaults        │
│  /api/v1/vaults/:id/stats  — per-vault stats        │
│  /api/v1/vaults/:id/...    — per-vault actions      │
└────────────────────────┬────────────────────────────┘
                         │ Soroban RPC (per vault)
                         ▼
┌─────────────────────────────────────────────────────┐
│               Stellar Network (Soroban)             │
│  AuraVault (USDC)   AuraVault (XLM)   AuraVault (EURC) │
│  Contract ID: C...  Contract ID: C... Contract ID: C... │
└─────────────────────────────────────────────────────┘
                         │ EVM calls (strategy layer)
                         ▼
┌─────────────────────────────────────────────────────┐
│                EVM Sidechain Contracts               │
│  AuraStrategy (shared or per-vault)                 │
│  AuraPriceOracle (shared)                           │
│  VaultAccessControl (shared)                        │
└─────────────────────────────────────────────────────┘
```

---

## Factory Contract Interaction Pattern

There is no on-chain factory contract for Soroban vault instances. Each `AuraVault` is deployed independently using the standard Stellar CLI deployment pattern. The "factory" is the deployment pipeline in CI/CD.

### Deploying a New Vault

**Step 1 — Build and upload the Wasm (if not already uploaded)**

```bash
cd aura-vault
cargo build --target wasm32-unknown-unknown --release

stellar contract upload \
  --wasm target/wasm32-unknown-unknown/release/aura_vault.wasm \
  --source <deployer-keypair> \
  --network mainnet
# Outputs: <WASM_HASH>
```

The Wasm hash is shared across all vault instances that run the same contract version. You only need to upload once per version.

**Step 2 — Deploy a new vault instance**

```bash
stellar contract deploy \
  --wasm-hash <WASM_HASH> \
  --source <deployer-keypair> \
  --network mainnet
# Outputs: <CONTRACT_ID>
```

**Step 3 — Initialize the vault**

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source <admin-keypair> \
  --network mainnet \
  -- initialize \
  --admin <ADMIN_ADDRESS> \
  --underlying_token <TOKEN_CONTRACT_ID> \
  --signers '[
    {"address": "<SIGNER_1>"},
    {"address": "<SIGNER_2>"},
    {"address": "<SIGNER_3>"}
  ]'
```

**Step 4 — Register in the vault registry** (see [Vault Registry Management](#vault-registry-management))

### Re-using the Same Wasm Hash

All vault instances for the same contract version share the same Wasm hash. This means:
- A `register_yield_token` call on Vault A does not affect Vault B.
- An `upgrade` call must be performed separately on each vault instance.
- Fee configuration (`set_fees`, `set_treasury`) is per-instance.

---

## Vault Registry Management

The vault registry is a configuration file maintained in the repository at `docs/vault-registry.json` (or an equivalent configuration managed by the team). It is the authoritative source for vault metadata and is consumed by the backend at startup.

### Registry Schema

```json
{
  "version": 1,
  "vaults": [
    {
      "id": "usdc-main",
      "name": "USDC Vault",
      "contractId": "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      "underlyingToken": "CBC...",
      "underlyingSymbol": "USDC",
      "underlyingDecimals": 6,
      "network": "mainnet",
      "chainId": "Public Global Stellar Network ; September 2015",
      "status": "active",
      "strategyAddress": "0x...",
      "minDeposit": 1000000,
      "feesBps": 200,
      "deployedAt": "2026-10-15",
      "tags": ["stable", "primary"]
    },
    {
      "id": "xlm-main",
      "name": "XLM Vault",
      "contractId": "CBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
      "underlyingToken": "native",
      "underlyingSymbol": "XLM",
      "underlyingDecimals": 7,
      "network": "mainnet",
      "chainId": "Public Global Stellar Network ; September 2015",
      "status": "active",
      "strategyAddress": "0x...",
      "minDeposit": 10000000,
      "feesBps": 100,
      "deployedAt": "2026-10-15",
      "tags": ["native", "primary"]
    }
  ]
}
```

### Registry Fields

| Field | Type | Description |
|---|---|---|
| `id` | string | Stable identifier used in API paths and frontend routing. Lowercase, hyphenated. |
| `name` | string | Human-readable display name |
| `contractId` | string | Stellar contract ID (starts with `C`) |
| `underlyingToken` | string | SEP-41 token contract ID, or `"native"` for XLM |
| `underlyingSymbol` | string | Token symbol for display |
| `underlyingDecimals` | integer | Decimal places for the token |
| `network` | string | `"mainnet"` or `"testnet"` |
| `status` | string | `"active"`, `"paused"`, or `"deprecated"` |
| `strategyAddress` | string | EVM sidechain strategy contract address (optional) |
| `minDeposit` | integer | Minimum deposit in token's smallest unit |
| `feesBps` | integer | Performance fee in basis points |
| `deployedAt` | string | ISO 8601 deployment date |
| `tags` | string[] | Optional tags for filtering (`"stable"`, `"native"`, `"experimental"`) |

### Adding a New Vault to the Registry

1. Deploy the vault contract (Steps 1–3 above).
2. Add an entry to `docs/vault-registry.json` with `"status": "active"`.
3. Open a PR. CI will validate the registry schema.
4. After merge, the backend picks up the new vault on the next deployment.

### Deprecating a Vault

1. Pause the vault on-chain: `stellar contract invoke --id <CONTRACT_ID> -- pause`
2. Update the registry entry: change `"status"` from `"active"` to `"deprecated"`.
3. The backend will stop accepting new deposits and the frontend will show a deprecation banner.
4. After all users have withdrawn, set `"status": "archived"`.

---

## Per-Vault Configuration Options

Each vault instance is configured independently on-chain. The following settings are per-vault:

### On-Chain Per-Vault Settings

| Setting | Function | Who Can Call | Notes |
|---|---|---|---|
| Admin address | Set via `initialize` | Deployer | Can be changed via governance proposal |
| Underlying token | Set via `initialize` | Deployer | Immutable after initialization |
| Governance signers | Set via `initialize` | Deployer | Can be changed via governance proposal |
| Pause state | `pause()` / `unpause()` | Admin | Per-instance |
| Performance fee (bps) | `set_fees(bps)` | Admin | e.g., `200` = 2% |
| Treasury address | `set_treasury(addr)` | Admin | Receives fee withdrawals |
| Registered yield tokens | `register_yield_token(token)` | Admin | Per-instance whitelist for `harvest_token` |
| Contract Wasm | `upgrade(wasm_hash)` | Admin | Must be done separately per instance |

### Off-Chain Per-Vault Settings (Registry)

| Setting | Location | Notes |
|---|---|---|
| Minimum deposit | `docs/vault-registry.json` → `minDeposit` | Enforced in the frontend and API validation |
| Display name | `docs/vault-registry.json` → `name` | Used in UI |
| Tags | `docs/vault-registry.json` → `tags` | Used for filtering in `VaultComparison` |
| Strategy contract | `docs/vault-registry.json` → `strategyAddress` | Links vault to its EVM strategy |

---

## Supporting Contracts

### AuraStrategy (`contracts/strategy/AuraStrategy.sol`)

`AuraStrategy` deploys vault assets into Aave v2/v3 (primary) or Compound (fallback) for yield generation. One strategy instance can serve one vault.

**Key roles:**

| Role | Description |
|---|---|
| `DEFAULT_ADMIN_ROLE` | Full control: configure protocols, pause, upgrade |
| `STRATEGY_MANAGER_ROLE` | Deploy/redeploy assets, adjust allocations |
| `OPERATOR_ROLE` | Trigger harvests, emergency withdrawals |

**Key parameters per strategy instance:**

| Parameter | Setter Function | Description |
|---|---|---|
| Primary protocol | `setProtocol(Protocol.AAVE)` | Aave or Compound |
| Aave pool address | `setLendingPool(addr)` | Aave v2/v3 pool |
| Compound cToken | `setCompoundToken(addr)` | Fallback protocol token |
| Min tokens for health | `MIN_TOKENS = 5` | Constant — strategy needs ≥ 5 registered tokens |
| Stale harvest threshold | `HARVEST_STALE_THRESHOLD = 48h` | After 48h without harvest, `staleHarvest = true` |

**Health check:**

```solidity
strategy.healthCheck();
// Returns: { isHealthy, hasMinTokens, staleHarvest, protocolBalance }
```

A `staleHarvest` flag indicates the keeper has not run in 48 hours. This should trigger an alert in Grafana.

### AuraPriceOracle (`contracts/oracle/AuraPriceOracle.sol`)

A shared Chainlink oracle with 1-hour on-chain price cache, decimal normalization to 18 dp, primary/fallback feed support, and an emergency pause when price deviation exceeds 5%.

One oracle instance is shared across all vaults that use `harvest_token`.

**Registering a price feed:**

```solidity
oracle.setFeed(
  tokenAddress,
  primaryFeedAddress,   // Chainlink AggregatorV3
  fallbackFeedAddress   // address(0) for no fallback
);
```

**Getting a price:**

```solidity
uint256 price = oracle.getPrice(tokenAddress);
// Returns: price normalized to 18 decimal places
// Gas: ~3k (cache hit), ~45k (cache miss)
```

**Emergency behavior:** If the live price deviates more than 5% from the cached price, the oracle pauses automatically and emits an `EmergencyPaused` event. Only an account with `OPERATOR_ROLE` can unpause.

### VaultAccessControl (`contracts/access/VaultAccessControl.sol`)

Shared RBAC contract used across all vaults and strategy instances. One deployment serves the entire protocol.

**Roles:**

| Role | Granted To | Permissions |
|---|---|---|
| `DEFAULT_ADMIN_ROLE` | Protocol multisig | All privileged operations |
| `STRATEGY_MANAGER_ROLE` | Strategy team accounts | Deploy strategies, adjust allocations |
| `OPERATOR_ROLE` | Keeper bots, ops accounts | Trigger harvests, emergency withdrawals |
| `SUPPORT_ROLE` | Support team accounts | Read user data, perform support actions |

**Batch role grants (for onboarding new operators):**

```solidity
accessControl.batchGrantRoles(
  [OPERATOR_ROLE, OPERATOR_ROLE],
  [keeper1Address, keeper2Address]
);
```

---

## Backend Multi-Vault Routing

The backend Express.js API routes requests to the correct vault based on a `vaultId` path parameter. The vault registry is loaded at startup and cached in memory.

### API Endpoint Structure

```
GET  /api/v1/vaults                  — list all registered vaults
GET  /api/v1/vaults/:id              — get vault metadata from registry
GET  /api/v1/vaults/:id/stats        — get live stats (TVL, APY, shares)
POST /api/v1/vaults/:id/deposit      — submit a deposit transaction
POST /api/v1/vaults/:id/withdraw     — submit a withdrawal transaction
POST /api/v1/vaults/:id/harvest      — trigger a harvest (keeper use)
GET  /api/v1/vaults/:id/positions    — list positions for authenticated user
```

The `:id` parameter corresponds to the `id` field in the vault registry (e.g., `usdc-main`, `xlm-main`).

### How Vault Routing Works

The backend resolves the contract ID from the registry at request time:

```typescript
// Pseudocode — actual implementation in backend/src/routes/vaultRoutes.ts
import vaultRegistry from "../../docs/vault-registry.json";

function getVaultById(id: string) {
  const vault = vaultRegistry.vaults.find(v => v.id === id && v.status === "active");
  if (!vault) throw new ApiError(404, `Vault '${id}' not found`);
  return vault;
}

vaultRouter.get("/:id/stats", async (req, res) => {
  const vault = getVaultById(req.params.id);
  const stats = await getVaultStats(vault.contractId, vault.underlyingDecimals);
  res.json(stats);
});
```

### Caching Strategy

Each vault's stats are cached independently in Redis:

| Cache Key Pattern | TTL | Invalidation Trigger |
|---|---|---|
| `vault:stats:{vaultId}:current` | 60 seconds | Harvest event webhook |
| `vault:positions:{address}` | 30 seconds | Any transaction for that address |
| `vault:apy:{vaultId}` | 5 minutes | APY snapshot update |

Cache keys are namespaced by `vaultId` to prevent cross-vault contamination.

### Health Checks for Multi-Vault

The backend exposes a per-vault health check:

```
GET /api/v1/vaults/:id/health
Response: {
  "vaultId": "usdc-main",
  "contractReachable": true,
  "isPaused": false,
  "lastHarvestAge": 3600,
  "staleHarvest": false,
  "rpcLatencyMs": 145
}
```

---

## Frontend Vault Selector UI

### VaultComparison Component

The `VaultComparison` component renders a sortable comparison table of all active vaults. It is the primary entry point for vault selection.

**Props:**

```typescript
interface VaultInfo {
  id: string;           // vault registry ID, used for routing
  name: string;
  underlyingToken: string;
  apy: number;          // percentage
  tvl: number;          // USD
  fee: number;          // percentage
  minDeposit: number;   // in token units
}

interface VaultComparisonProps {
  vaults: VaultInfo[];
  onDeposit: (vaultId: string) => void;
}
```

**Usage in a page:**

```tsx
import { VaultComparison, VaultInfo } from "@/components/VaultComparison";

export default function VaultsPage() {
  const { data: vaults } = useVaultList(); // fetches /api/v1/vaults

  function handleDeposit(vaultId: string) {
    router.push(`/dashboard?vault=${vaultId}`);
  }

  return <VaultComparison vaults={vaults} onDeposit={handleDeposit} />;
}
```

**Columns displayed:**

| Column | Sortable | Notes |
|---|---|---|
| Vault Name | Yes | Links to vault dashboard |
| Underlying Token | Yes | Displayed as symbol (USDC, XLM, etc.) |
| APY | Yes | Highest value highlighted in green |
| TVL | Yes | Highest value highlighted in green |
| Fee | Yes | Lowest value highlighted in green |
| Min Deposit | Yes | Lowest value highlighted in green |

The best-value cell in each numeric column is highlighted to help users identify the most favorable option.

### VaultDashboard Component

`VaultDashboard` is the single-vault interaction view, shown after vault selection.

**Props:**

```typescript
interface VaultDashboardProps {
  vaultId: string;       // from URL param or VaultComparison selection
}
```

The component fetches vault stats and user positions for the given `vaultId`:

```
GET /api/v1/vaults/{vaultId}/stats
GET /api/v1/vaults/{vaultId}/positions
```

**Key panels:**

- **Stat cards**: TVL, APY, user balance (tokens), user shares, price-per-share
- **Transaction history**: paginated list of deposit/withdraw/harvest events for the connected wallet
- **Vault Actions**: deposit, withdraw, harvest buttons that route to the correct vault contract

### URL Structure for Multi-Vault

```
/                           — landing page
/vaults                     — VaultComparison (all vaults)
/dashboard?vault=usdc-main  — VaultDashboard for USDC vault
/dashboard?vault=xlm-main   — VaultDashboard for XLM vault
/dashboard                  — defaults to the first active vault in the registry
```

The `vault` query parameter is the vault registry `id`. The dashboard reads `searchParams.get("vault")` and passes it to `VaultDashboard` as `vaultId`.

### Deprecated Vault Banner

When a vault's status is `"deprecated"` in the registry, the frontend shows a persistent warning banner:

```
⚠️  This vault is deprecated. Please withdraw your funds and move to [recommended vault].
    Deposits are disabled. Withdrawals remain available.
```

Deposit buttons are disabled for deprecated vaults. Withdrawal remains available until the vault is archived.

### Adding a New Vault to the Frontend

1. Add the vault to the registry (see [Vault Registry Management](#vault-registry-management)).
2. The `/api/v1/vaults` endpoint will include the new vault automatically.
3. The `VaultComparison` component fetches from this endpoint — no frontend code change is needed for a standard vault.
4. If the vault requires custom UI (non-standard token, special harvest flow), create a new entry in the frontend's vault-specific config:

```typescript
// frontend/src/lib/vaultConfig.ts
export const VAULT_OVERRIDES: Record<string, Partial<VaultUIConfig>> = {
  "exotic-vault": {
    warningBanner: "This vault uses an experimental yield strategy.",
    depositLabel: "Stake",
    withdrawLabel: "Unstake",
  },
};
```

---

## Naming Conventions

### Vault ID Format

```
{token-symbol}-{instance-label}
```

Examples:
- `usdc-main` — primary USDC vault
- `xlm-main` — primary XLM vault
- `eurc-main` — primary EURC vault
- `usdc-v2` — second-generation USDC vault (after migration from `usdc-main`)
- `usdc-testnet` — testnet USDC vault

Rules:
- Lowercase only
- Hyphens as separators
- `main` for the primary instance of a given token
- `testnet` suffix for non-production instances
- Version suffix (`v2`, `v3`) only after a vault migration; old vault is deprecated simultaneously

### Stellar Contract ID

Soroban contract IDs are 56-character uppercase strings starting with `C`. Store them in the registry exactly as returned by the Stellar CLI — do not abbreviate.

### EVM Contract Addresses

Store in checksummed format (mixed case, EIP-55). The registry uses lowercase for consistency, but code that passes addresses to contracts must use checksummed form.

### Branch Naming for Vault Deployments

When deploying a new vault, use the branch naming convention:

```
deploy/vault-{vault-id}-{network}
# Examples:
deploy/vault-eurc-main-mainnet
deploy/vault-usdc-v2-testnet
```

---

## Deployment Checklist

Use this checklist when deploying a new vault instance to mainnet.

- [ ] Contract Wasm built and tested against current mainnet state
- [ ] Wasm uploaded; hash recorded in deployment notes
- [ ] New vault instance deployed; contract ID recorded
- [ ] `initialize` called with correct admin, token, and signers
- [ ] Admin address is the governance multisig (not a personal keypair)
- [ ] `set_fees` called with agreed performance fee
- [ ] `set_treasury` called with the treasury address
- [ ] Yield tokens registered via `register_yield_token` (if applicable)
- [ ] Vault entry added to `docs/vault-registry.json` with `"status": "active"`
- [ ] Backend deployed with updated registry
- [ ] `/api/v1/vaults` returns the new vault
- [ ] `/api/v1/vaults/{id}/stats` returns live data
- [ ] Frontend shows new vault in `VaultComparison`
- [ ] Grafana dashboard updated with new vault metrics
- [ ] Keeper bot configured with the new contract ID
- [ ] Smoke test: deposit → harvest → withdraw on testnet replica
- [ ] Incident response contacts confirmed for the new vault
