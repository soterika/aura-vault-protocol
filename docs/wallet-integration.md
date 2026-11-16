# Wallet Integration Guide

> **Issue #853** — Complete Stellar wallet connection and NFT/share interaction flow.

This guide covers everything a contributor needs to understand how wallets connect to the Aura Vault Protocol, how authentication works, how vault shares are minted and tracked, and how the frontend, backend, and Soroban smart contract interact at every step.

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Wallet Connection](#wallet-connection)
4. [Wallet Authentication](#wallet-authentication)
5. [Wallet Address Validation](#wallet-address-validation)
6. [NFT / Share Minting Flow](#nft--share-minting-flow)
7. [Transaction Signing](#transaction-signing)
8. [Transaction Confirmation](#transaction-confirmation)
9. [API Integration](#api-integration)
10. [Error Handling](#error-handling)
11. [Security Considerations](#security-considerations)

---

## Overview

Aura Vault Protocol is built on three layers that must work together for every user action:

| Layer | Technology | Responsibility |
|---|---|---|
| **Frontend** | Next.js (`WalletConnect.tsx`) | Wallet detection, signing, UI state |
| **Backend API** | Express (Node.js) | JWT auth, caching, off-chain data |
| **Smart Contract** | Soroban (Rust) on Stellar | Share minting, withdrawals, yield harvest |

A user interacting with the vault goes through this overall flow:

1. Connect a wallet (Freighter, MetaMask, or Coinbase Wallet).
2. Authenticate with the backend to receive JWT tokens.
3. Read vault state (total assets, share balance) via the backend API.
4. Sign and submit transactions to the Soroban contract on Stellar.
5. Poll Stellar Horizon for confirmation, then refresh UI.

---

## Architecture

### Component Diagram

```
┌─────────────────────────────────────────────────────────┐
│                   Browser / Next.js App                  │
│                                                         │
│  ┌──────────────────────────────────────────────────┐   │
│  │             WalletConnect.tsx                    │   │
│  │  ┌──────────┐  ┌──────────┐  ┌───────────────┐  │   │
│  │  │Freighter │  │MetaMask  │  │Coinbase Wallet│  │   │
│  │  │(Stellar) │  │(EVM)     │  │(EVM)          │  │   │
│  │  └────┬─────┘  └────┬─────┘  └───────┬───────┘  │   │
│  └───────┼─────────────┼────────────────┼──────────┘   │
│          │             │                │               │
│          └─────────────┴────────────────┘               │
│                        │ walletAddress                   │
└────────────────────────┼────────────────────────────────┘
                         │ HTTPS
                         ▼
┌────────────────────────────────────────────────────────┐
│              Express Backend API                        │
│                                                        │
│  POST /api/auth/login      → issues JWT tokens         │
│  POST /api/auth/refresh    → rotates token pair        │
│  GET  /api/v1/vault/stats  → cached vault stats        │
│  GET  /api/vault/total_assets → total deposited        │
│  GET  /api/vault/balance_of   → user share balance     │
└───────────────────────────┬────────────────────────────┘
                            │ Soroban RPC
                            ▼
┌────────────────────────────────────────────────────────┐
│           Soroban Smart Contract (Rust/Wasm)           │
│                                                        │
│  initialize(admin, underlying_token)                   │
│  deposit(caller, amount)  → mints shares               │
│  withdraw(caller, shares) → redeems underlying tokens  │
│  harvest(caller, yield_amount) → adds yield            │
│  total_assets()           → read-only view             │
│  balance_of(address)      → read-only view             │
└────────────────────────────────────────────────────────┘
```

### Sequence Diagram — Full Deposit Flow

```
User        WalletConnect.tsx     Backend API         Soroban Contract
 │                │                    │                    │
 │  click deposit │                    │                    │
 │───────────────>│                    │                    │
 │                │  POST /auth/login  │                    │
 │                │───────────────────>│                    │
 │                │  {accessToken}     │                    │
 │                │<───────────────────│                    │
 │                │                    │                    │
 │                │  buildDepositTx()  │                    │
 │                │──────────────────────────────────────>  │
 │                │  XDR envelope      │                    │
 │                │<──────────────────────────────────────  │
 │                │                    │                    │
 │  sign prompt   │                    │                    │
 │<───────────────│                    │                    │
 │  approve       │                    │                    │
 │───────────────>│                    │                    │
 │                │  submit signed XDR to Horizon           │
 │                │──────────────────────────────────────>  │
 │                │  txHash            │                    │
 │                │<──────────────────────────────────────  │
 │                │                    │                    │
 │                │  poll Horizon until confirmed           │
 │                │──────────────────────────────────────>  │
 │                │  SUCCESS / ledger close                 │
 │                │<──────────────────────────────────────  │
 │                │                    │                    │
 │                │  GET /vault/balance_of                  │
 │                │───────────────────>│                    │
 │                │  {balance}         │                    │
 │                │<───────────────────│                    │
 │  updated UI    │                    │                    │
 │<───────────────│                    │                    │
```

---

## Wallet Connection

The `WalletConnect.tsx` component detects installed wallets on mount and presents a dropdown. Wallet state (address, network, type) is persisted to `localStorage` under the key `aura_wallet_state` so sessions survive page reloads.

### Supported Wallets

| Wallet | Chain | Detection | Key Stored |
|---|---|---|---|
| **Freighter** | Stellar | `window.freighterApi` | Stellar G-address (56 chars) |
| **MetaMask** | EVM (Ethereum) | `window.ethereum` | EVM `0x` address (42 chars) |
| **Coinbase Wallet** | EVM (Ethereum) | `window.coinbaseWalletSDK` | EVM `0x` address (42 chars) |
| **WalletConnect** | — | always shown | Coming soon |

### Freighter Connection Flow

Freighter is the primary wallet for Stellar-native operations (deposits, withdrawals, harvests on Soroban).

```typescript
// From WalletConnect.tsx — connectFreighter()
const api = window.freighterApi;

// 1. Check extension is installed and unlocked
const connected = await api.isConnected();  // throws if not installed

// 2. Get the public key (Stellar G-address)
const address = await api.getPublicKey();   // "GABC...XYZ" (56 chars)

// 3. Get network (TESTNET / PUBLIC / STANDALONE)
const network = await api.getNetwork();

// 4. Persist to localStorage
localStorage.setItem("aura_wallet_state", JSON.stringify({
  address, network, connected: true, walletType: "freighter"
}));
```

Common failure modes:
- Extension not installed → `window.freighterApi` is `undefined`
- Wallet locked → `isConnected()` returns `false`
- User rejection → `getPublicKey()` throws

### MetaMask Connection Flow

MetaMask is used for EVM bridging and authentication from EVM-native users.

```typescript
// From WalletConnect.tsx — connectMetaMask()
const ethereum = window.ethereum;

// 1. Request account access (triggers MetaMask popup)
const accounts = await ethereum.request({ method: "eth_requestAccounts" });
// accounts[0] = "0xAbCd...1234" (42 chars, checksum-cased)

// 2. Get chain ID
const chainId = await ethereum.request({ method: "eth_chainId" });
// "0x1" = Ethereum mainnet, anything else treated as TESTNET

// 3. Persist wallet state
localStorage.setItem("aura_wallet_state", JSON.stringify({
  address: accounts[0], network: chainId === "0x1" ? "ETHEREUM" : "TESTNET",
  connected: true, walletType: "metamask"
}));
```

### Coinbase Wallet Connection Flow

Coinbase Wallet uses the `@coinbase/wallet-sdk` npm package, loaded dynamically to keep the initial bundle small.

```typescript
// From WalletConnect.tsx — connectCoinbase()
const { CoinbaseWalletSDK } = await import("@coinbase/wallet-sdk");

const coinbaseWallet = new CoinbaseWalletSDK({
  appName: "Aura Vault Protocol",
  appLogoUrl: "/logo.png",
});

const provider = coinbaseWallet.makeWeb3Provider();
const accounts = await provider.request({ method: "eth_requestAccounts" });
// accounts[0] = "0xAbCd...1234"
```

### Disconnecting

Disconnecting clears both localStorage keys and resets component state. No on-chain transaction is needed.

```typescript
localStorage.removeItem("aura_wallet_state");
localStorage.removeItem("aura_last_wallet_type");
```

---

## Wallet Authentication

After connecting a wallet, the frontend must authenticate with the Express backend to get JWT tokens. These tokens authorize access to protected API endpoints.

### JWT Flow

```
Frontend                        Backend
   │                               │
   │  POST /api/auth/login         │
   │  { walletAddress,             │
   │    deviceId?,                 │
   │    tier }                     │
   │──────────────────────────────>│
   │                               │  generateTokens(walletAddress, deviceId, tier)
   │                               │  → sessionId = uuidv4()
   │                               │  → signs accessToken (15 min, HS256)
   │                               │  → signs refreshToken (30 days, HS256)
   │                               │  → stores refreshToken in Redis
   │  200 OK                       │
   │  { accessToken,               │
   │    refreshToken,              │
   │    expiresIn: 900 }           │
   │<──────────────────────────────│
   │                               │
   │  (15 min later)               │
   │  POST /api/auth/refresh       │
   │  { refreshToken }             │
   │──────────────────────────────>│
   │                               │  validates + rotates refresh token
   │  200 OK                       │
   │  { accessToken,               │
   │    refreshToken,              │
   │    expiresIn: 900 }           │
   │<──────────────────────────────│
```

### Token Lifetimes

| Token | TTL | Storage Recommendation |
|---|---|---|
| `accessToken` | 15 minutes (900 s) | Memory / React state |
| `refreshToken` | 30 days | `httpOnly` cookie or secure storage |

### Calling Protected Endpoints

Include the access token as a Bearer token in the `Authorization` header:

```http
GET /api/v1/user/portfolio HTTP/1.1
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

The `authenticate` middleware in `authMiddleware.ts` validates the token on every protected route. It also checks the JWT blacklist in Redis, so logged-out tokens are immediately rejected even within their 15-minute window.

### Logout

```http
POST /api/auth/logout HTTP/1.1
Authorization: Bearer <accessToken>
Content-Type: application/json

{ "refreshToken": "<refreshToken>" }
```

This blacklists the access token and deletes the refresh token from Redis. All in-flight requests using the old token will be rejected within milliseconds.

---

## Wallet Address Validation

Two address formats are accepted, corresponding to the two wallet families:

### Stellar G-Address (Freighter)

```
Format:  G + 55 alphanumeric characters (base32 encoded Ed25519 public key)
Length:  56 characters total
Regex:   /^G[A-Z2-7]{55}$/
Example: GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN
```

Validation logic:

```typescript
function isStellarAddress(addr: string): boolean {
  return /^G[A-Z2-7]{55}$/.test(addr);
}
```

The Stellar SDK (`@stellar/stellar-base`) provides `StrKey.isValidEd25519PublicKey(addr)` for checksum-aware validation.

### EVM Address (MetaMask / Coinbase Wallet)

```
Format:  0x + 40 hex characters (EIP-55 checksum-cased)
Length:  42 characters total
Regex:   /^0x[0-9a-fA-F]{40}$/
Example: 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045
```

Validation logic:

```typescript
import { isAddress } from "ethers"; // or viem

function isEVMAddress(addr: string): boolean {
  return isAddress(addr); // validates checksum casing too
}
```

### Backend Validation

The backend's `loginSchema` (in `validation.ts`) accepts any string up to 100 characters for `walletAddress`. Strict format enforcement is left to the contract/chain layer. The rationale: future auth schemes (passkeys, social login) should not require API schema changes.

```typescript
// backend/src/validation.ts
export const loginSchema = z.object({
  walletAddress: z.string().min(1).max(100),
  deviceId: z.string().max(128).optional(),
  tier: z.enum(["free", "paid"]).optional().default("free"),
});
```

---

## NFT / Share Minting Flow

Vault shares are the protocol's equivalent of receipt tokens (similar in concept to ERC-4626 shares). They are minted on-chain by the Soroban contract when a user deposits underlying tokens.

### Share Minting Formula

```
First deposit (empty vault):
  shares_minted = amount  (1:1 seed ratio)

Subsequent deposits:
  shares_minted = floor(amount × total_shares / total_assets)
```

This formula ensures proportional ownership. An attacker cannot manipulate the exchange rate through donation attacks because the contract uses `checked_mul`/`checked_div` and rejects zero-share mints.

### Deposit → Share Mint Sequence

```
1. User calls deposit(caller, amount) on the Soroban contract

2. Contract checks:
   a. Vault is initialized
   b. Vault is not paused
   c. amount > 0
   d. Actual on-chain token balance == total_deposited  ← flash loan guard
   e. Shares to mint > 0  ← inflation attack guard

3. Transfer: underlying token moves from caller → contract
   (SEP-41 token.transfer_from call)

4. State update (CEI ordering):
   total_deposited += amount
   user_shares[caller] += shares_to_mint
   total_shares += shares_to_mint

5. Event emitted:
   { topic: ["deposit"], data: { caller, amount, shares_minted } }
```

### Withdraw → Share Burn Sequence

```
1. User calls withdraw(caller, shares) on the Soroban contract

2. Contract checks:
   a. Vault is initialized and not paused
   b. user_shares[caller] >= shares
   c. Flash loan guard: actual balance == total_deposited

3. Calculate redemption:
   underlying_to_return = floor(shares × total_assets / total_shares)

4. State update (CEI ordering):
   user_shares[caller] -= shares
   total_shares -= shares
   total_deposited -= underlying_to_return

5. Transfer: underlying token moves from contract → caller

6. Event emitted:
   { topic: ["withdraw"], data: { caller, shares, underlying_returned } }
```

### Checking Share Balance (Frontend)

The `PortfolioSection` in `WalletConnect.tsx` fetches share balance directly from the backend API:

```typescript
const [assetsRes, balanceRes] = await Promise.all([
  fetch(`/api/vault/total_assets`),
  fetch(`/api/vault/balance_of?address=${encodeURIComponent(address)}`),
]);

const assets = await assetsRes.json();   // { total: "1050000" }
const balance = await balanceRes.json(); // { balance: "1000" }

// Compute price per share (× 10000 for 4 decimal precision)
const pps = (BigInt(assets.total) * 10000n / BigInt(balance.balance)).toString();
```

---

## Transaction Signing

### Freighter — XDR Signing (Stellar)

All Soroban contract calls are submitted as XDR-encoded Stellar transactions. Freighter signs the transaction envelope.

```typescript
import * as StellarSdk from "@stellar/stellar-sdk";

// 1. Build the Soroban operation
const server = new StellarSdk.SorobanRpc.Server("https://soroban-testnet.stellar.org");
const contract = new StellarSdk.Contract(VAULT_CONTRACT_ID);

const account = await server.getAccount(walletAddress);

const tx = new StellarSdk.TransactionBuilder(account, {
  fee: StellarSdk.BASE_FEE,
  networkPassphrase: StellarSdk.Networks.TESTNET,
})
  .addOperation(
    contract.call(
      "deposit",
      StellarSdk.Address.fromString(walletAddress).toScVal(),
      StellarSdk.xdr.ScVal.scvI128(new StellarSdk.XdrLargeInt("i128", amount))
    )
  )
  .setTimeout(30)
  .build();

// 2. Simulate to get the footprint (read/write ledger keys)
const simResult = await server.simulateTransaction(tx);
const preparedTx = StellarSdk.SorobanRpc.assembleTransaction(tx, simResult).build();

// 3. Sign with Freighter
const { signedXDR } = await window.freighterApi.signTransaction(
  preparedTx.toXDR(),
  { network: "TESTNET" }
);

// 4. Submit to Horizon
const signedTx = StellarSdk.TransactionBuilder.fromXDR(
  signedXDR,
  StellarSdk.Networks.TESTNET
);
const submitResult = await server.sendTransaction(signedTx);
// submitResult.hash = transaction hash for polling
```

### MetaMask — eth_sign (EVM)

For EVM wallets, authentication uses a personal sign challenge rather than a direct on-chain transaction. This is how the wallet proves ownership of the address without requiring a gas-paying transaction.

```typescript
// 1. Create a human-readable message
const message = `Sign in to Aura Vault Protocol\n\nNonce: ${crypto.randomUUID()}\nTimestamp: ${Date.now()}`;

// 2. Request signature via MetaMask
const signature = await window.ethereum.request({
  method: "personal_sign",
  params: [message, accounts[0]],
});
// signature = "0x..." (65-byte ECDSA signature)

// 3. Verify on-chain or in backend using ecrecover
// The recovered address must match accounts[0]
```

> **Note:** For Soroban transactions from an EVM wallet, a bridge or cross-chain messaging layer is required. The current implementation uses Freighter exclusively for Soroban calls. MetaMask/Coinbase Wallet connections authenticate the user with the backend but do not directly submit Soroban transactions.

### Coinbase Wallet — eth_sign

Same flow as MetaMask. Coinbase Wallet implements the same EIP-1193 provider interface:

```typescript
const signature = await provider.request({
  method: "personal_sign",
  params: [message, accounts[0]],
});
```

---

## Transaction Confirmation

### Stellar Horizon Polling

After submitting a signed transaction, the client polls the Stellar Horizon API until the transaction is confirmed (included in a closed ledger) or a timeout occurs.

```typescript
const POLL_INTERVAL_MS = 3_000;  // 3 seconds
const MAX_POLLS = 20;            // 60-second total timeout

async function waitForConfirmation(
  server: StellarSdk.SorobanRpc.Server,
  txHash: string
): Promise<"SUCCESS" | "FAILED" | "TIMEOUT"> {
  for (let i = 0; i < MAX_POLLS; i++) {
    const result = await server.getTransaction(txHash);

    if (result.status === "SUCCESS") return "SUCCESS";
    if (result.status === "FAILED")  return "FAILED";
    // status === "NOT_FOUND" means not yet included — keep polling

    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  return "TIMEOUT";
}
```

Stellar ledgers close every ~5 seconds on average. The backend's `horizonRetryService.ts` handles retry logic with exponential backoff for transient network errors.

### Status Values

| Status | Meaning | Action |
|---|---|---|
| `PENDING` | Submitted, awaiting inclusion | Keep polling |
| `SUCCESS` | Included in a closed ledger | Refresh UI, show success toast |
| `FAILED` | Included but contract rejected | Show error code from result meta |
| `NOT_FOUND` | Not yet seen by Horizon | Keep polling (may still land) |
| `TIMEOUT` | Client-side timeout | Advise user to check later |

### Fee Bump Transactions

If the base fee becomes insufficient during network congestion, the backend's `feeBumpService.ts` can wrap the inner transaction in a fee-bump envelope to re-prioritize it. This is transparent to the frontend — the same polling loop works for fee-bumped transactions.

---

## API Integration

All endpoints are served by the Express backend. The frontend Next.js app proxies `/api/*` to the backend via `next.config.ts` rewrites.

### Base URL

```
Development:  http://localhost:3001
Production:   https://api.auravault.io   (set NEXT_PUBLIC_API_URL)
```

---

### POST /api/auth/login

Authenticates a wallet address and issues a JWT token pair.

**Request**

```http
POST /api/auth/login HTTP/1.1
Content-Type: application/json

{
  "walletAddress": "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
  "deviceId": "device-uuid-v4-here",
  "tier": "free"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `walletAddress` | string (1–100 chars) | Yes | Stellar G-address or EVM `0x` address |
| `deviceId` | string (max 128 chars) | No | Stable device identifier for multi-device session tracking |
| `tier` | `"free"` \| `"paid"` | No | Default: `"free"` |

**Response 200**

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJHQUFaSTRUQ1IzVFk1T0pIQ1RKQzJBNFFTWTZDSldKSDVJQUpUR0tJTjJFUjdMQk5WS09DQ1dOIiwic2Vzc2lvbklkIjoiYWJjZDEyMzQtNTY3OC05YWJjLWRlZjAtMTIzNDU2Nzg5YWJjIiwiZGV2aWNlSWQiOiJkZXZpY2UtdXVpZC12NC1oZXJlIiwidGllciI6ImZyZWUiLCJpYXQiOjE3MjQ5NDU2MDAsImV4cCI6MTcyNDk0NjUwMH0.xyz",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJHQUFaSTRUQ1IzVFk1T0pIQ1RKQzJBNFFTWTZDSldKSDVJQUpUR0tJTjJFUjdMQk5WS09DQ1dOIiwic2Vzc2lvbklkIjoiYWJjZDEyMzQtNTY3OC05YWJjLWRlZjAtMTIzNDU2Nzg5YWJjIiwidHlwZSI6InJlZnJlc2giLCJpYXQiOjE3MjQ5NDU2MDAsImV4cCI6MTcyNzUzNzYwMH0.abc",
  "expiresIn": 900
}
```

**Response 400** — Validation error

```json
{
  "error": "Validation failed: walletAddress — walletAddress is required",
  "details": [
    { "field": "walletAddress", "message": "walletAddress is required" }
  ]
}
```

**Response 429** — Rate limited (auth endpoints have a stricter rate limiter)

```json
{ "error": "Too many requests, please try again later." }
```

---

### POST /api/auth/refresh

Rotates the token pair using a valid refresh token. The old refresh token is invalidated immediately (token rotation).

**Request**

```http
POST /api/auth/refresh HTTP/1.1
Content-Type: application/json

{
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**Response 200**

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...<new>",
  "refreshToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...<new>",
  "expiresIn": 900
}
```

**Response 401** — Expired or unknown refresh token

```json
{ "error": "Invalid or expired refresh token" }
```

---

### GET /api/v1/vault/stats

Returns aggregate vault statistics. Cached in Redis with a 60-second TTL. Cache is invalidated on each harvest event.

**Request**

```http
GET /api/v1/vault/stats HTTP/1.1
```

No authentication required.

**Response 200**

```json
{
  "total_assets": 1050000,
  "total_shares": 1000000,
  "apy": 0.085,
  "last_harvest": "2026-08-29T12:00:00.000Z",
  "cached": true,
  "cache_age_secs": 23,
  "fetched_at": "2026-08-29T16:02:12.004Z"
}
```

| Field | Type | Description |
|---|---|---|
| `total_assets` | number | Total underlying tokens held by the vault |
| `total_shares` | number | Total vault shares in circulation |
| `apy` | number | Annual percentage yield (0–1, e.g. `0.085` = 8.5%) |
| `last_harvest` | string \| null | ISO-8601 timestamp of the most recent harvest, or `null` |
| `cached` | boolean | Whether this response was served from cache |
| `cache_age_secs` | number \| null | Seconds since the cache entry was written (`null` on cache miss) |
| `fetched_at` | string | ISO-8601 timestamp of this response |

**Response 500**

```json
{ "error": "Failed to retrieve vault stats" }
```

---

### GET /api/vault/balance_of

Returns the vault share balance for a specific address. This is the user's ownership stake in the vault — analogous to an NFT balance or ERC-20 balance.

**Request**

```http
GET /api/vault/balance_of?address=GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN HTTP/1.1
```

| Parameter | Type | Required | Description |
|---|---|---|---|
| `address` | string | Yes | Stellar G-address or EVM `0x` address to query |

No authentication required (public read endpoint).

**Response 200**

```json
{
  "balance": "1000"
}
```

`balance` is a string to preserve precision for large `i128` values from the Soroban contract.

**Response 400** — Missing address parameter

```json
{ "error": "address parameter is required" }
```

---

### GET /api/vault/total_assets

Returns the total underlying tokens currently held by the vault. Used by the frontend to calculate price per share.

**Request**

```http
GET /api/vault/total_assets HTTP/1.1
```

No authentication required (public read endpoint).

**Response 200**

```json
{
  "total": "1050000"
}
```

`total` is a string for the same precision reason as `balance` above.

---

## Error Handling

### Frontend Error Pattern

`WalletConnect.tsx` uses a simple local `error` state. Errors are displayed inline below the wallet button and cleared on the next connection attempt.

```typescript
// Error states the component can surface:
"Freighter wallet not found. Please install the extension."
"Freighter is not connected. Please unlock your wallet."
"MetaMask not found. Please install the extension."
"Failed to connect to Freighter"   // generic catch-all
"Failed to connect to MetaMask"
"Failed to connect to Coinbase Wallet"
```

When backend calls fail, the `PortfolioSection` falls back silently to `"—"` placeholders rather than crashing the UI:

```typescript
} catch {
  setData({ totalAssets: "—", shareBalance: "—", pricePerShare: "—" });
}
```

### Soroban Contract Error Codes

The Soroban contract returns typed errors via `VaultError`. These surface as failed transaction result codes:

| Code | Variant | When It Occurs |
|---|---|---|
| 1 | `NotInitialized` | Any call before `initialize()` |
| 2 | `AlreadyInitialized` | Calling `initialize()` a second time |
| 3 | `InsufficientShares` | Withdraw exceeds caller's share balance |
| 4 | `InsufficientUnderlying` | Vault cannot cover the redemption |
| 5 | `ZeroAmount` | Deposit/withdraw of zero, or share mint rounds to zero |
| 6 | `MathOverflow` | Arithmetic overflow in share formula |
| 8 | `ZeroShares` | Harvest called when total shares is zero |
| 11 | `VaultPaused` | Mutating call while vault is paused |
| 12 | `BalanceMismatch` | Flash loan guard triggered |

To parse a failed Soroban transaction, inspect the `resultMetaXdr` field in the Horizon response and decode the `TransactionMeta` to find the `contractError` value.

### HTTP Error Codes

| Status | Meaning | Typical Cause |
|---|---|---|
| 400 | Bad Request | Missing/invalid field in request body |
| 401 | Unauthorized | Missing, expired, or blacklisted JWT |
| 429 | Too Many Requests | Rate limiter triggered |
| 500 | Internal Server Error | Backend or contract call failed |
| 503 | Service Unavailable | Backend temporarily down |

### Retry Strategy

For transient errors (network timeouts, 503s), implement exponential backoff:

```typescript
async function fetchWithRetry(url: string, maxRetries = 3): Promise<Response> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status < 500) return res;  // don't retry 4xx
    } catch {}  // network error — retry
    await new Promise(r => setTimeout(r, 1000 * 2 ** attempt));
  }
  throw new Error("Max retries exceeded");
}
```

---

## Security Considerations

### JWT Best Practices

- Algorithm is pinned to `HS256` to prevent algorithm confusion attacks (e.g. RS256→HS256 downgrade). Never accept `none`.
- `JWT_ISSUER` and `JWT_AUDIENCE` claims can be set via environment variables in production.
- Access tokens are blacklisted immediately on logout (stored in Redis with their remaining TTL).
- Refresh tokens are rotated on every use — a stolen refresh token can only be used once before it is invalidated.

### Wallet Address as User Identity

The backend uses `walletAddress` directly as the user subject (`sub` in JWT). There is no separate username/password. A wallet address is considered proof of identity.

Do not store wallet addresses in logs in plain text — mask them to the first 6 and last 4 characters (e.g. `GAAZI4...CCWN`) the same way the frontend truncates display addresses.

### Flash Loan Guard

Every mutating contract function (`deposit`, `withdraw`, `harvest`) verifies that the vault's actual on-chain token balance equals the tracked `total_deposited` before executing. If they differ, the contract emits a `suspicious` event with the observed vs. tracked amounts and returns `BalanceMismatch` (error code 12). Monitor this event in production.

### CORS and Rate Limiting

The backend uses a strict CORS allowlist configured via `corsOptions` in `securityMiddleware.ts`. Auth endpoints (`/api/auth/login`, `/api/auth/refresh`) have a tighter rate limiter than general API endpoints.

### localStorage Security

Wallet state is persisted to `localStorage` for session restoration. **Do not store JWT tokens in `localStorage`** — use `httpOnly` cookies for refresh tokens in production. Access tokens should live only in memory (React state) and not be persisted across page loads.

### Content Security Policy

Security headers are applied via `applySecurityHeaders()` (Helmet). The frontend's `next.config.ts` should add a `Content-Security-Policy` header that restricts `script-src` to prevent XSS from hijacking the connected wallet.

### Transaction Simulation Before Signing

Always simulate Soroban transactions before presenting them to the user for signing. Simulation (`server.simulateTransaction()`) returns the exact fee, footprint, and any error that would occur on-chain. Never ask a user to sign a transaction that has not been successfully simulated.

---

## Further Reading

- [Smart Contract API Reference](./smart-contract-api.md) — full Soroban contract ABI
- [API Reference](./api-reference.md) — complete backend API documentation
- [Getting Started](./getting-started.md) — local development setup
- [Security](../SECURITY.md) — security model and vulnerability reporting
- [Soroban Tips](./soroban-tips.md) — Soroban-specific development guidance
- [Error Reference](./error-reference.md) — all error codes with remediation steps
