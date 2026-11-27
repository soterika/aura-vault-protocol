@AGENTS.md

# Frontend Public Configuration Reference

This guide provides the authoritative reference for configuring the Aura Vault Protocol Next.js frontend (`frontend/`). It inventories all active public environment variables (`NEXT_PUBLIC_*`), details their active code references, default fallbacks, build-time versus runtime evaluation characteristics, and non-production network configurations.

---

## 1. Next.js Public Environment Variable Semantics

Next.js distinguishes between client-side and server-side environment variables:

- **Build-Time Inlining (Client-Side):**
  Variables prefixed with `NEXT_PUBLIC_` are statically analyzed by the bundler during `next build` (`npm run build`). Any occurrence of `process.env.NEXT_PUBLIC_*` in client-side code (`"use client"` components, client hooks, and utilities) is inlined as a static string literal directly into the compiled JavaScript bundles. Modifying environment variables after running `npm run build` will **not** affect client-side behavior without a rebuild.
- **Runtime Evaluation (Server-Side):**
  In server components (such as `src/app/layout.tsx`), route handlers (`src/app/api/...`), and server-side initialization scripts (`sentry.server.config.ts`), `process.env` is evaluated dynamically at runtime from the Node.js or Edge runtime process environment.
- **Environment Precedence:**
  Next.js loads variables in the following order of precedence (highest to lowest):
  1. `process.env` (system environment)
  2. `.env.local` (local developer overrides, git-ignored)
  3. `.env.[development|production]` (environment defaults)
  4. `.env` (project baseline)

---

## 2. Public Settings Inventory & Code References

| Setting | Required | Default Value | Active Code References | Build vs. Runtime | Purpose & Network Values |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `NEXT_PUBLIC_STELLAR_NETWORK` | Recommended | `"testnet"` | `src/app/layout.tsx#L31`<br>`src/components/FreighterNetworkBanner.tsx#L73`<br>`src/lib/explorerLinks.ts#L40`<br>`src/components/ExplorerMenu.tsx#L14`<br>`src/app/status/page.tsx#L92` | Build & Runtime | Target Stellar network (`testnet`, `mainnet`, or `futurenet`). Controls network warning banner, Freighter network mismatch enforcement, and block explorer links. |
| `NEXT_PUBLIC_API_URL` | Optional | `""` (relative root) / `"http://localhost:3001"` in hooks | `src/app/status/page.tsx#L18`<br>`src/app/tx/[hash]/page.tsx#L49`<br>`src/app/transactions/page.tsx#L7`<br>`src/lib/useVaultQueries.ts#L35`<br>`src/lib/useContractEvents.ts#L157`<br>`src/lib/useVaultEventInvalidation.ts#L29`<br>`src/components/AdminPauseControls.tsx#L68` | Build & Runtime | Base URL for backend HTTP REST API calls and SSE event streaming. Local: `http://localhost:3001`; Non-production: `https://<api-testnet-host>`. |
| `NEXT_PUBLIC_WS_URL` | Optional | `ws://${window.location.host}/api/ws/vault` | `src/lib/useVaultPause.ts#L134`<br>`src/components/VaultDashboard.tsx#L275`<br>`src/components/dashboard/SortableDashboardGrid.tsx#L370`<br>`src/components/dashboard/DashboardGrid.tsx#L125`<br>`src/components/SharePriceTicker.tsx#L81` | Build-time | WebSocket endpoint for real-time vault pause state, live share prices, and dashboard metrics. Local: `ws://localhost:3001/api/ws/vault`; Non-production: `wss://<api-testnet-host>/api/ws/vault`. |
| `NEXT_PUBLIC_STELLAR_EXPLORER_URL` | Optional | `'https://stellar.expert/explorer/testnet/tx'` | `src/app/tx/[hash]/page.tsx#L46` | Build-time | Base URL override for external Stellar transaction links on transaction details pages. Testnet: `https://stellar.expert/explorer/testnet/tx`; Mainnet: `https://stellar.expert/explorer/public/tx`. |
| `NEXT_PUBLIC_ADMIN_ADDRESS` | Optional | `undefined` | `src/components/AdminPauseControls.tsx#L58`<br>`src/components/dashboard/SortableDashboardGrid.tsx#L424` | Build-time | Stellar public G-address of the authorized vault admin. When connected wallet matches this address, emergency pause/unpause controls render in the UI. |
| `NEXT_PUBLIC_APP_URL` | Optional | `""` (falls back to `window.location.origin`) | `src/lib/referral.ts#L148` | Build & Runtime | Canonical origin URL of the web frontend, used when generating shareable referral URLs during SSR. Testnet: `https://<app-testnet-host>`. |
| `NEXT_PUBLIC_SENTRY_DSN` | Optional | `undefined` (telemetry disabled) | `src/lib/sentry.ts#L17`<br>`sentry.client.config.ts#L9`<br>`sentry.server.config.ts#L7`<br>`sentry.edge.config.ts#L7` | Build & Runtime | Sentry DSN for error reporting and performance tracing. Unset disables tracking without errors. |

---

## 3. Setting Details

### `NEXT_PUBLIC_STELLAR_NETWORK`
- **Purpose:** Configures the target Stellar network that the frontend connects to.
- **Active Code References:**
  - `src/app/layout.tsx`: Reads network on server render; if not `"mainnet"`, renders `<NetworkStatusBanner>` at the top of every page.
  - `src/components/FreighterNetworkBanner.tsx`: Queries `freighterApi.getNetworkDetails()` and triggers a mismatch warning disabling transactions if Freighter is on another network.
  - `src/lib/explorerLinks.ts`: Maps transaction hashes and account IDs to network-specific explorer URLs (`https://stellar.expert/explorer/testnet/...`).
  - `src/app/status/page.tsx`: Maps `"mainnet"` to `"public"` and all other values to `"testnet"` when generating contract links.
- **Values:** `"testnet"` (default), `"mainnet"` (or `"public"`), `"futurenet"`.

### `NEXT_PUBLIC_API_URL`
- **Purpose:** Base URL for backend HTTP REST API requests (vault stats, historical APY rollups, user preferences, and SSE feeds).
- **Active Code References:**
  - `src/app/status/page.tsx:18`, `src/app/tx/[hash]/page.tsx:49`, `src/app/transactions/page.tsx:7`
  - `src/lib/useVaultQueries.ts:35`, `src/lib/useGovernanceQueries.ts:27`
  - `src/lib/useContractEvents.ts:157`, `src/lib/useVaultEventInvalidation.ts:29`
  - `src/components/AdminPauseControls.tsx:68`, `src/components/VaultOverviewDashboard.tsx:64`
- **Defaults:** In UI components defaults to `""` (relative request against current origin); in data hooks and transaction viewer defaults to `"http://localhost:3001"`.

### `NEXT_PUBLIC_WS_URL`
- **Purpose:** Real-time WebSocket connection URL for streaming live vault status, share price updates, and emergency pause toggles.
- **Active Code References:**
  - `src/lib/useVaultPause.ts:134`
  - `src/components/VaultDashboard.tsx:275`
  - `src/components/dashboard/SortableDashboardGrid.tsx:370`
  - `src/components/SharePriceTicker.tsx:81`
- **Defaults:** `ws://${window.location.host}/api/ws/vault`.

### `NEXT_PUBLIC_STELLAR_EXPLORER_URL`
- **Purpose:** Base URL override for external Stellar transaction links on transaction details pages (`/tx/[hash]`).
- **Active Code References:**
  - `src/app/tx/[hash]/page.tsx:46`
- **Defaults:** `'https://stellar.expert/explorer/testnet/tx'`.

### `NEXT_PUBLIC_ADMIN_ADDRESS`
- **Purpose:** Public Stellar G-address of the authorized vault admin.
- **Active Code References:**
  - `src/components/AdminPauseControls.tsx:58`
  - `src/components/dashboard/SortableDashboardGrid.tsx:424`
- **Behavior:** If the connected wallet matches `NEXT_PUBLIC_ADMIN_ADDRESS`, the admin pause/unpause controls render. Otherwise, the component safely returns `null`.

### `NEXT_PUBLIC_APP_URL`
- **Purpose:** Canonical origin URL of the deployed frontend web application.
- **Active Code References:**
  - `src/lib/referral.ts:148`
- **Defaults:** Falls back to `window.location.origin` in the browser; used during SSR where `window` is undefined.

### `NEXT_PUBLIC_SENTRY_DSN`
- **Purpose:** Sentry Data Source Name (DSN) for error capture and performance monitoring.
- **Active Code References:**
  - `src/lib/sentry.ts:17`
  - `sentry.client.config.ts:9`, `sentry.server.config.ts:7`, `sentry.edge.config.ts:7`
- **Defaults:** `undefined` (disables Sentry initialization).

---

## 4. Configuration Examples

### Non-Production Network (Stellar Testnet)

Copy this snippet to `frontend/.env.local`:

```env
# ==============================================================================
# Aura Vault Protocol — Testnet Configuration
# ==============================================================================
NEXT_PUBLIC_STELLAR_NETWORK=testnet
NEXT_PUBLIC_API_URL=https://<api-testnet-host>
NEXT_PUBLIC_WS_URL=wss://<api-testnet-host>/api/ws/vault
NEXT_PUBLIC_STELLAR_EXPLORER_URL=https://stellar.expert/explorer/testnet/tx
NEXT_PUBLIC_ADMIN_ADDRESS=<TESTNET_ADMIN_PUBLIC_KEY_G...>
NEXT_PUBLIC_APP_URL=https://<app-testnet-host>
NEXT_PUBLIC_SENTRY_DSN=https://<public_key>@<org>.ingest.sentry.io/<project_id>
```

### Local Development against Local Backend

```env
# ==============================================================================
# Aura Vault Protocol — Local Development Configuration
# ==============================================================================
NEXT_PUBLIC_STELLAR_NETWORK=testnet
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_WS_URL=ws://localhost:3001/api/ws/vault
NEXT_PUBLIC_STELLAR_EXPLORER_URL=https://stellar.expert/explorer/testnet/tx
NEXT_PUBLIC_ADMIN_ADDRESS=
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

---

## 5. Rendering Against a Non-Production Network

Follow these steps to render and verify the application against Stellar Testnet:

1. **Populate Environment Configuration:**
   Create `frontend/.env.local` using the Testnet configuration snippet above with your target testnet placeholders.
2. **Start the Frontend Application:**
   ```bash
   cd frontend
   npm run dev
   # Accessible at http://localhost:3000
   ```
   *For a production-like testnet build, run `npm run build && npm run start`.*
3. **Verify Non-Production UI Elements:**
   - **Network Status Banner:** An amber banner displays at the top:
     `"You are on Stellar Testnet. Tokens have no real value."` (`src/components/NetworkStatusBanner.tsx`).
   - **Freighter Wallet Validation:** Connect Freighter. If the wallet is pointed to Mainnet, a banner prompts to switch to Testnet and disables transaction buttons (`src/components/FreighterNetworkBanner.tsx`).
   - **Block Explorer Links:** All transaction links (e.g. `/tx/[hash]` and `ExplorerMenu`) route to `https://stellar.expert/explorer/testnet/...`.
   - **Admin Controls:** If `NEXT_PUBLIC_ADMIN_ADDRESS` matches your testnet wallet, admin pause/unpause controls render in the dashboard (`src/components/AdminPauseControls.tsx`).
