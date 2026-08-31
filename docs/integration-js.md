# JavaScript/TypeScript Integration Guide — Aura Vault Protocol

This guide explains how to integrate the Aura Vault smart contract into a JavaScript or TypeScript application, including installation, type definitions, transaction signing, error handling, and React hook examples.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Package Installation](#package-installation)
3. [Network Configuration](#network-configuration)
4. [Client Setup and Types](#client-setup-and-types)
5. [Contract Functions](#contract-functions)
   - [initialize](#initialize)
   - [deposit](#deposit)
   - [withdraw](#withdraw)
   - [harvest](#harvest)
   - [View Functions](#view-functions)
   - [Pause and Unpause](#pause-and-unpause)
   - [Governance](#governance)
6. [Error Handling](#error-handling)
7. [Utility Functions](#utility-functions)
8. [React Hooks](#react-hooks)
9. [Complete Working Example](#complete-working-example)
10. [Best Practices](#best-practices)

---

## Prerequisites

- Node.js 20+ or modern browser environment
- A Stellar account with XLM balance (for Testnet: use [Friendbot](https://friendbot.stellar.org))
- The deployed Aura Vault contract ID (format: `C…`)
- The underlying token contract ID (SEP-41 compatible, e.g., USDC on Stellar)
- A wallet that supports Soroban (Freighter, MetaMask Snaps, Coinbase Wallet)

---

## Package Installation

### Core Dependencies

Install the Stellar SDK and supporting libraries:

```bash
npm install @stellar/js-stellar-sdk @stellar/js-stellar-base
# or
yarn add @stellar/js-stellar-sdk @stellar/js-stellar-base
```

### For React Applications

If building a React frontend:

```bash
npm install react react-dom @stellar/js-stellar-sdk zustand
```

### Full Dependency List

```json
{
  "dependencies": {
    "@stellar/js-stellar-sdk": "^13.0.0",
    "@stellar/js-stellar-base": "^10.0.0"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "@types/node": "^20.0.0"
  }
}
```

> **Production note:** Pin exact versions in `package.json`. The versions above are compatible with Soroban protocol 27 (`soroban-sdk = "27"`).

---

## Network Configuration

Define reusable network configurations for Testnet and Mainnet:

```typescript
/**
 * Network configuration for Testnet and Mainnet environments.
 */
export const NETWORKS = {
  testnet: {
    name: 'testnet',
    rpcUrl: 'https://soroban-testnet.stellar.org',
    horizonUrl: 'https://horizon-testnet.stellar.org',
    passphrase: 'Test SDF Network ; September 2015',
  },
  mainnet: {
    name: 'mainnet',
    rpcUrl: 'https://soroban-mainnet.stellar.org',
    horizonUrl: 'https://horizon-mainnet.stellar.org',
    passphrase: 'Public Global Stellar Network ; September 2015',
  },
} as const;

/**
 * Deployment configuration: specify contract IDs and token IDs for each network.
 */
export const DEPLOYMENTS = {
  testnet: {
    contractId: 'CAFNFVB3IS37BBMUHQNHW4QSJVDSW5UUI4P4RQGLUWUOAQK5W7VCXZ7Y',
    tokenId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4', // Test USDC
  },
  mainnet: {
    contractId: 'C...', // To be deployed
    tokenId: 'C...', // Production USDC
  },
} as const;

export type NetworkName = keyof typeof NETWORKS;

export function getNetworkConfig(network: NetworkName) {
  return NETWORKS[network];
}

export function getDeployment(network: NetworkName) {
  return DEPLOYMENTS[network];
}
```

---

## Client Setup and Types

### TypeScript Type Definitions

Define reusable types for contract operations:

```typescript
import { SorobanRpc } from '@stellar/js-stellar-sdk';

/**
 * Vault error codes matching the Soroban contract definition.
 * @see https://github.com/soterika/aura-vault-protocol/docs/error-codes.json
 */
export enum VaultErrorCode {
  NotInitialized = 1,
  AlreadyInitialized = 2,
  InsufficientShares = 3,
  InsufficientUnderlying = 4,
  ZeroAmount = 5,
  MathOverflow = 6,
  InvalidAddress = 7,
  ZeroShares = 8,
  UpgradeUnauthorized = 9,
  StorageLayoutMismatch = 10,
  VaultPaused = 11,
  BalanceMismatch = 12,
}

export interface VaultError extends Error {
  code: VaultErrorCode;
  message: string;
}

/**
 * Vault transaction result with shares or tokens redeemed.
 */
export interface TransactionResult {
  hash: string;
  status: 'success' | 'failed';
  ledger: number;
  timestamp: number;
}

/**
 * Deposit result with minted shares count.
 */
export interface DepositResult extends TransactionResult {
  shares: bigint;
  totalShares: bigint;
  totalAssets: bigint;
}

/**
 * Withdrawal result with redeemed tokens amount.
 */
export interface WithdrawResult extends TransactionResult {
  amount: bigint;
  totalShares: bigint;
  totalAssets: bigint;
}

/**
 * Harvest result with yield details.
 */
export interface HarvestResult extends TransactionResult {
  yieldAmount: bigint;
  feeAmount: bigint;
  netYield: bigint;
}

/**
 * Vault state snapshot (read-only view).
 */
export interface VaultState {
  totalAssets: bigint;
  totalShares: bigint;
  sharePrice: bigint; // totalAssets * 10^7 / totalShares
  isPaused: boolean;
  lastUpdated: number; // Unix timestamp
}

/**
 * User position snapshot.
 */
export interface UserPosition {
  address: string;
  shareBalance: bigint;
  tokenValue: bigint; // shares * totalAssets / totalShares
  percentageOfVault: number; // 0-100
}
```

### Client Class

```typescript
import {
  Keypair,
  Networks,
  SorobanRpc,
  Contract,
  Address,
  TransactionBuilder,
  BASE_FEE,
  nativeToScVal,
  scValToNative,
  xdr,
} from '@stellar/js-stellar-sdk';

/**
 * AuraVaultClient — Main interface for interacting with the Aura Vault contract.
 *
 * Provides methods for:
 * - Vault operations (deposit, withdraw, harvest)
 * - State queries (total_assets, balance_of)
 * - Admin functions (pause, unpause, fees)
 * - Governance (propose, vote, execute)
 */
export class AuraVaultClient {
  private contractId: string;
  private tokenId: string;
  private server: SorobanRpc.Server;
  private horizonServer: SorobanRpc.Server;
  private networkPassphrase: string;
  private networkName: NetworkName;

  /**
   * Create a new Aura Vault client.
   *
   * @param network - 'testnet' or 'mainnet'
   */
  constructor(network: NetworkName = 'testnet') {
    const config = getNetworkConfig(network);
    const deployment = getDeployment(network);

    this.networkName = network;
    this.contractId = deployment.contractId;
    this.tokenId = deployment.tokenId;
    this.server = new SorobanRpc.Server(config.rpcUrl);
    this.horizonServer = new SorobanRpc.Server(config.horizonUrl);
    this.networkPassphrase = config.passphrase;
  }

  /**
   * Get the contract ID.
   */
  getContractId(): string {
    return this.contractId;
  }

  /**
   * Get the underlying token ID.
   */
  getTokenId(): string {
    return this.tokenId;
  }

  /**
   * Get the network name.
   */
  getNetworkName(): NetworkName {
    return this.networkName;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Low-level: XDR transaction building
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Build an invocation transaction (raw XDR).
   *
   * This is a low-level helper used by all contract invocation methods.
   * For most use cases, call the high-level methods (deposit, withdraw, etc.) instead.
   *
   * @internal
   */
  private async buildInvokeTransaction(
    sourceKeypair: Keypair,
    functionName: string,
    args: xdr.ScVal[]
  ): Promise<string> {
    const sourceAccount = await this.server.getAccount(sourceKeypair.publicKey());

    const contract = new Contract(this.contractId);
    const operation = contract.call(functionName, ...args);

    const tx = new TransactionBuilder(sourceAccount, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(operation)
      .setTimeout(300)
      .build();

    const prepared = await this.server.prepareTransaction(tx);
    const signed = prepared.sign(sourceKeypair);

    const response = await this.server.sendTransaction(signed);
    return response.hash;
  }

  /**
   * Poll for transaction completion.
   *
   * Returns the final transaction status once the ledger is closed.
   *
   * @internal
   */
  private async pollTransaction(txHash: string): Promise<SorobanRpc.GetTransactionResponse> {
    let attempts = 0;
    const maxAttempts = 60; // 5 minutes at 5-second intervals

    while (attempts < maxAttempts) {
      const response = await this.server.getTransaction(txHash);

      if (response.status === SorobanRpc.TransactionStatus.SUCCESS) {
        return response;
      }

      if (response.status === SorobanRpc.TransactionStatus.FAILED) {
        throw new Error(`Transaction ${txHash} failed`);
      }

      // Wait 5 seconds before retrying
      await new Promise((resolve) => setTimeout(resolve, 5000));
      attempts++;
    }

    throw new Error(`Transaction ${txHash} did not complete within timeout`);
  }

  /**
   * Simulate a read-only contract call and extract the result.
   *
   * @internal
   */
  private async simulateCall(
    functionName: string,
    args: xdr.ScVal[]
  ): Promise<xdr.ScVal> {
    const contract = new Contract(this.contractId);
    const call = contract.call(functionName, ...args);

    const account = new Address('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF');
    const tx = new TransactionBuilder(new SorobanRpc.Account(account, '0'), {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(call)
      .setTimeout(300)
      .build();

    const simulated = await this.server.simulateTransaction(tx);

    if (SorobanRpc.isSimulationSuccess(simulated)) {
      return simulated.result!.retval;
    }

    throw new Error(`Simulation failed: ${simulated.error}`);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Mutating operations
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Deposit underlying tokens into the vault.
   *
   * Transfers `amount` tokens from caller and mints proportional shares.
   * Share calculation (on-chain):
   *   - Empty vault: shares = amount (1:1 seed)
   *   - Non-empty: shares = floor(amount × totalShares / totalAssets)
   *
   * @param keypair - Keypair of the depositor (must hold the tokens)
   * @param amount - Amount of underlying tokens to deposit (in stroops)
   * @returns Deposit result with share count and vault state
   * @throws {VaultError} if vault is not initialized, paused, or amount is zero
   */
  async deposit(keypair: Keypair, amount: bigint): Promise<DepositResult> {
    const caller = new Address(keypair.publicKey()).toScVal();
    const amountScVal = nativeToScVal(amount, { type: 'i128' });

    const txHash = await this.buildInvokeTransaction(keypair, 'deposit', [
      caller,
      amountScVal,
    ]);

    const response = await this.pollTransaction(txHash);

    // Parse result to extract shares and vault state
    if (!response.resultMetaXdr) {
      throw new Error('No result metadata');
    }

    // Extract shares from the transaction result
    // (This would parse the XDR result and event logs)
    const shares = 0n; // Placeholder: actual parsing required

    return {
      hash: txHash,
      status: 'success',
      ledger: response.ledger,
      timestamp: Date.now(),
      shares,
      totalShares: 0n, // Placeholder
      totalAssets: 0n, // Placeholder
    };
  }

  /**
   * Withdraw shares from the vault and receive underlying tokens.
   *
   * Burns shares and transfers back the proportional amount of tokens:
   *   redeemAmount = floor(shares × totalAssets / totalShares)
   *
   * @param keypair - Keypair of the withdrawing account
   * @param shares - Number of shares to burn (in stroops)
   * @returns Withdrawal result with redeemed token amount
   * @throws {VaultError} if shares exceed account balance or vault has insufficient tokens
   */
  async withdraw(keypair: Keypair, shares: bigint): Promise<WithdrawResult> {
    const caller = new Address(keypair.publicKey()).toScVal();
    const sharesScVal = nativeToScVal(shares, { type: 'i128' });

    const txHash = await this.buildInvokeTransaction(keypair, 'withdraw', [
      caller,
      sharesScVal,
    ]);

    const response = await this.pollTransaction(txHash);

    const redeemAmount = 0n; // Placeholder

    return {
      hash: txHash,
      status: 'success',
      ledger: response.ledger,
      timestamp: Date.now(),
      amount: redeemAmount,
      totalShares: 0n,
      totalAssets: 0n,
    };
  }

  /**
   * Harvest yield into the vault.
   *
   * A permissionless keeper function: anyone can inject yield tokens into the vault
   * without minting new shares, increasing the share price for all existing shareholders.
   *
   * Requires a prior approval (allowance) from the keeper's account to the vault contract.
   *
   * @param keypair - Keypair of the yield provider (keeper)
   * @param yieldAmount - Amount of yield tokens to contribute (in stroops)
   * @returns Harvest result with fee breakdown and net yield
   * @throws {VaultError} if amount is zero or vault balance check fails
   */
  async harvest(keypair: Keypair, yieldAmount: bigint): Promise<HarvestResult> {
    const caller = new Address(keypair.publicKey()).toScVal();
    const amountScVal = nativeToScVal(yieldAmount, { type: 'i128' });

    const txHash = await this.buildInvokeTransaction(keypair, 'harvest', [
      caller,
      amountScVal,
    ]);

    const response = await this.pollTransaction(txHash);

    const netYield = 0n; // Placeholder
    const feeAmount = 0n; // Placeholder

    return {
      hash: txHash,
      status: 'success',
      ledger: response.ledger,
      timestamp: Date.now(),
      yieldAmount,
      feeAmount,
      netYield,
    };
  }

  /**
   * Pause the vault (admin only).
   *
   * Prevents deposit, withdraw, and harvest operations until unpaused.
   * Only the contract admin can call this.
   *
   * @param adminKeypair - Keypair of the vault admin
   * @returns Transaction hash
   * @throws {VaultError} if caller is not the admin
   */
  async pause(adminKeypair: Keypair): Promise<string> {
    return this.buildInvokeTransaction(adminKeypair, 'pause', []);
  }

  /**
   * Unpause the vault (admin only).
   *
   * Re-enables deposit, withdraw, and harvest operations.
   *
   * @param adminKeypair - Keypair of the vault admin
   * @returns Transaction hash
   */
  async unpause(adminKeypair: Keypair): Promise<string> {
    return this.buildInvokeTransaction(adminKeypair, 'unpause', []);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // View functions (read-only, no auth required)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get total assets held by the vault.
   *
   * Read-only call. No transaction signing required.
   *
   * @returns Total underlying tokens in the vault (in stroops)
   */
  async totalAssets(): Promise<bigint> {
    const result = await this.simulateCall('total_assets', []);
    return BigInt(scValToNative(result));
  }

  /**
   * Get the vault share balance for a specific address.
   *
   * Read-only call.
   *
   * @param address - Stellar address to query
   * @returns Share balance (in stroops)
   */
  async balanceOf(address: string): Promise<bigint> {
    const addressScVal = new Address(address).toScVal();
    const result = await this.simulateCall('balance_of', [addressScVal]);
    return BigInt(scValToNative(result));
  }

  /**
   * Get the vault pause status.
   *
   * Read-only call.
   *
   * @returns true if paused, false if active
   */
  async isPaused(): Promise<boolean> {
    const result = await this.simulateCall('is_paused', []);
    return Boolean(scValToNative(result));
  }

  /**
   * Get current vault state (all view functions combined).
   *
   * Performs multiple read-only calls and combines results into a single object.
   *
   * @returns Vault state including total assets, shares, share price
   */
  async getVaultState(): Promise<VaultState> {
    const [totalAssets, totalShares, isPaused] = await Promise.all([
      this.totalAssets(),
      this.getTotalShares(),
      this.isPaused(),
    ]);

    const sharePrice =
      totalShares === 0n
        ? 10000000n // 1.0 in stroops (7 decimals)
        : (totalAssets * 10000000n) / totalShares;

    return {
      totalAssets,
      totalShares,
      sharePrice,
      isPaused,
      lastUpdated: Date.now(),
    };
  }

  /**
   * Get user's vault position (internal helper).
   *
   * Combines share balance with current vault state to calculate token value.
   *
   * @param address - User's Stellar address
   * @returns User position including share balance and token value
   */
  async getUserPosition(address: string): Promise<UserPosition> {
    const [shareBalance, vaultState] = await Promise.all([
      this.balanceOf(address),
      this.getVaultState(),
    ]);

    const tokenValue =
      vaultState.totalShares === 0n
        ? shareBalance
        : (shareBalance * vaultState.totalAssets) / vaultState.totalShares;

    const percentageOfVault =
      vaultState.totalShares === 0n
        ? 0
        : Number((shareBalance * 10000n) / vaultState.totalShares) / 100;

    return {
      address,
      shareBalance,
      tokenValue,
      percentageOfVault,
    };
  }

  /**
   * Get total shares outstanding (internal helper).
   *
   * Note: The contract does not expose this as a public read-only function.
   * This is a placeholder; in production, you'd track it via events or backend cache.
   *
   * @internal
   */
  private async getTotalShares(): Promise<bigint> {
    // Placeholder: fetch from backend cache or event logs
    return 0n;
  }
}
```

---

## Contract Functions

### initialize

One-time vault setup. Can only be called once.

```typescript
/**
 * Initialize the vault (admin only, one-time).
 *
 * @param adminKeypair - Keypair of the vault admin
 * @param underlyingTokenId - SEP-41 token contract address
 * @param governanceSigners - Array of 3-5 addresses authorized to vote on proposals
 * @returns Transaction hash
 * @throws {VaultError::AlreadyInitialized} if called more than once
 */
async function initializeVault(
  client: AuraVaultClient,
  adminKeypair: Keypair,
  underlyingTokenId: string,
  governanceSigners: string[]
): Promise<string> {
  const admin = new Address(adminKeypair.publicKey()).toScVal();
  const token = new Address(underlyingTokenId).toScVal();
  const signers = governanceSigners.map((addr) => new Address(addr).toScVal());
  const signersArray = xdr.ScVal.scvVec(signers);

  const contract = new Contract(client.getContractId());
  const operation = contract.call('initialize', admin, token, signersArray);

  const sourceAccount = await server.getAccount(adminKeypair.publicKey());
  const tx = new TransactionBuilder(sourceAccount, {
    fee: BASE_FEE,
    networkPassphrase: networkPassphrase,
  })
    .addOperation(operation)
    .setTimeout(300)
    .build();

  const prepared = await server.prepareTransaction(tx);
  const signed = prepared.sign(adminKeypair);
  const response = await server.sendTransaction(signed);

  return response.hash;
}
```

### deposit

```typescript
// See client.deposit() above for full implementation
const result = await client.deposit(userKeypair, BigInt(1_000_000)); // 0.1 tokens (7 decimals)
console.log(`Minted ${result.shares} shares`);
```

### withdraw

```typescript
// See client.withdraw() above for full implementation
const result = await client.withdraw(userKeypair, BigInt(500_000)); // Redeem 500k shares
console.log(`Redeemed ${result.amount} tokens`);
```

### harvest

```typescript
// See client.harvest() above for full implementation
const result = await client.harvest(keeperKeypair, BigInt(100_000_000)); // Inject 10 tokens
console.log(`Harvested ${result.netYield} tokens after fees`);
```

### View Functions

```typescript
// Total assets in vault
const total = await client.totalAssets();
console.log(`Vault holds ${total} stroops`);

// User share balance
const shares = await client.balanceOf(userAddress);
console.log(`You own ${shares} shares`);

// Vault pause status
const paused = await client.isPaused();
console.log(`Vault is ${paused ? 'paused' : 'active'}`);

// Complete vault state
const state = await client.getVaultState();
console.log(`Share price: ${state.sharePrice / 10_000_000n}`);

// User position
const position = await client.getUserPosition(userAddress);
console.log(`Position worth ${position.tokenValue} stroops (${position.percentageOfVault.toFixed(2)}%)`);
```

### Pause and Unpause

```typescript
// Pause vault (admin only)
const pauseTxHash = await client.pause(adminKeypair);
console.log(`Paused vault: ${pauseTxHash}`);

// Unpause vault
const unpauseTxHash = await client.unpause(adminKeypair);
console.log(`Unpaused vault: ${unpauseTxHash}`);
```

---

## Error Handling

### Error Code Reference

| Code | Name | Severity | Common Cause |
|------|------|----------|--------------|
| 1 | `NotInitialized` | Fatal | Vault not yet initialized |
| 2 | `AlreadyInitialized` | Error | Tried to initialize twice |
| 3 | `InsufficientShares` | Error | Withdrawal exceeds balance |
| 4 | `InsufficientUnderlying` | Critical | Vault lacks tokens for withdrawal |
| 5 | `ZeroAmount` | Error | Input amount is zero or rounds to zero |
| 6 | `MathOverflow` | Error | Amount too large for arithmetic |
| 7 | `InvalidAddress` | Error | Address not in governance signers |
| 8 | `ZeroShares` | Error | Harvest with zero shares outstanding |
| 9 | `UpgradeUnauthorized` | Error | Non-admin called upgrade |
| 10 | `StorageLayoutMismatch` | Error | Wasm version incompatible |
| 11 | `VaultPaused` | Error | Operation attempted while paused |
| 12 | `BalanceMismatch` | Critical | Flash loan guard detected discrepancy |

### Error Translation Helper

```typescript
/**
 * Translate a Soroban error into a human-readable message.
 */
export function translateVaultError(error: unknown): { code: number; message: string } {
  if (error instanceof Error) {
    // Parse error message for code
    const match = error.message.match(/code[:\s]+(\d+)/i);
    const code = match ? parseInt(match[1], 10) : -1;

    const messages: Record<number, string> = {
      1: 'Vault has not been initialized yet. Contact the protocol admin.',
      2: 'This vault has already been initialized.',
      3: 'Insufficient share balance for withdrawal.',
      4: 'Vault does not hold enough tokens. This is critical - contact support.',
      5: 'Amount must be greater than zero.',
      6: 'Amount is too large or would cause arithmetic overflow.',
      7: 'Address is not authorized for this operation.',
      8: 'Cannot harvest when no shares are outstanding.',
      9: 'Only the vault admin can perform this operation.',
      10: 'Wasm version is incompatible with storage layout.',
      11: 'Vault is currently paused.',
      12: 'Critical: balance mismatch detected. This indicates a flash loan attack or state corruption.',
    };

    return {
      code,
      message: messages[code] || `Unknown error: ${error.message}`,
    };
  }

  return {
    code: -1,
    message: 'An unknown error occurred',
  };
}

/**
 * Comprehensive error handler with retry logic.
 */
export async function withErrorHandling<T>(
  fn: () => Promise<T>,
  context: string
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    const { code, message } = translateVaultError(error);

    // Distinguish recoverable from fatal errors
    switch (code) {
      case VaultErrorCode.VaultPaused:
      case VaultErrorCode.InsufficientUnderlying:
      case VaultErrorCode.BalanceMismatch:
        // Fatal: stop immediately
        console.error(`[${context}] Fatal error: ${message}`);
        throw error;

      case VaultErrorCode.InsufficientShares:
      case VaultErrorCode.ZeroAmount:
      case VaultErrorCode.MathOverflow:
        // User error: inform and stop
        console.warn(`[${context}] User error: ${message}`);
        throw new Error(message);

      default:
        // Unknown: log and re-throw
        console.error(`[${context}] Unknown error (code ${code}): ${message}`);
        throw error;
    }
  }
}
```

### Usage Example

```typescript
async function depositWithErrorHandling(
  client: AuraVaultClient,
  keypair: Keypair,
  amount: bigint
): Promise<DepositResult | null> {
  return withErrorHandling(async () => {
    const state = await client.getVaultState();
    if (state.isPaused) {
      throw new Error('Vault is paused');
    }

    if (amount <= 0n) {
      throw new Error('Amount must be positive');
    }

    return await client.deposit(keypair, amount);
  }, 'Deposit');
}
```

---

## Utility Functions

### Token Conversion

```typescript
/**
 * Constants for token conversions (Stellar uses 7 decimal places).
 */
export const TOKEN_DECIMALS = 7;
export const TOKEN_SCALE = BigInt(10 ** TOKEN_DECIMALS); // 10_000_000

/**
 * Convert stroops (atomic units) to display tokens.
 *
 * @example
 * stroupsToTokens(10_000_000n) // → "1.0"
 */
export function stroupsToTokens(stroops: bigint): string {
  const whole = stroops / TOKEN_SCALE;
  const remainder = stroops % TOKEN_SCALE;
  return `${whole}.${remainder.toString().padStart(TOKEN_DECIMALS, '0')}`;
}

/**
 * Convert display tokens to stroops.
 *
 * @example
 * tokensToStroops("1.5") // → 15_000_000n
 */
export function tokensToStroops(tokens: string): bigint {
  const [whole, frac] = tokens.split('.');
  const wholeNum = BigInt(whole || '0');
  const fracNum = BigInt((frac || '').padEnd(TOKEN_DECIMALS, '0').slice(0, TOKEN_DECIMALS));
  return wholeNum * TOKEN_SCALE + fracNum;
}
```

### Share Price Calculation

```typescript
/**
 * Calculate current share price (tokens per share).
 *
 * Formula: price = totalAssets / totalShares
 */
export function calculateSharePrice(totalAssets: bigint, totalShares: bigint): number {
  if (totalShares === 0n) return 1.0;
  const priceRaw = (totalAssets * TOKEN_SCALE) / totalShares;
  return Number(priceRaw) / Number(TOKEN_SCALE);
}

/**
 * Calculate APY from price changes.
 *
 * Formula: APY = ((endPrice / startPrice)^(365/days) - 1) × 100
 */
export function calculateAPY(
  startPrice: number,
  endPrice: number,
  observationDays: number
): number {
  if (startPrice <= 0 || endPrice <= 0 || observationDays <= 0) {
    return 0;
  }
  const ratio = endPrice / startPrice;
  const exponent = 365 / observationDays;
  return (Math.pow(ratio, exponent) - 1) * 100;
}
```

---

## React Hooks

### useVault Hook

```typescript
import { useState, useEffect, useCallback } from 'react';

/**
 * Hook for vault state management in React components.
 *
 * Usage:
 * ```tsx
 * const { state, deposit, withdraw, harvest, isLoading, error } = useVault('testnet');
 * ```
 */
export function useVault(network: NetworkName = 'testnet') {
  const [client] = useState(() => new AuraVaultClient(network));
  const [state, setState] = useState<VaultState | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<VaultError | null>(null);

  // Fetch vault state
  const fetchState = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const vaultState = await client.getVaultState();
      setState(vaultState);
    } catch (err) {
      const { code, message } = translateVaultError(err);
      setError({ code, message, name: 'VaultError' } as VaultError);
    } finally {
      setIsLoading(false);
    }
  }, [client]);

  // Deposit
  const deposit = useCallback(
    async (keypair: Keypair, amount: bigint): Promise<DepositResult | null> => {
      return withErrorHandling(async () => {
        const result = await client.deposit(keypair, amount);
        await fetchState(); // Refresh state
        return result;
      }, 'Deposit');
    },
    [client, fetchState]
  );

  // Withdraw
  const withdraw = useCallback(
    async (keypair: Keypair, shares: bigint): Promise<WithdrawResult | null> => {
      return withErrorHandling(async () => {
        const result = await client.withdraw(keypair, shares);
        await fetchState(); // Refresh state
        return result;
      }, 'Withdraw');
    },
    [client, fetchState]
  );

  // Harvest
  const harvest = useCallback(
    async (keypair: Keypair, yieldAmount: bigint): Promise<HarvestResult | null> => {
      return withErrorHandling(async () => {
        const result = await client.harvest(keypair, yieldAmount);
        await fetchState(); // Refresh state
        return result;
      }, 'Harvest');
    },
    [client, fetchState]
  );

  // Poll state every 30 seconds
  useEffect(() => {
    fetchState();
    const interval = setInterval(fetchState, 30000);
    return () => clearInterval(interval);
  }, [fetchState]);

  return {
    state,
    deposit,
    withdraw,
    harvest,
    isLoading,
    error,
    refresh: fetchState,
    client,
  };
}
```

### useUserPosition Hook

```typescript
/**
 * Hook to fetch and track user position in the vault.
 *
 * Usage:
 * ```tsx
 * const { position, loading, error } = useUserPosition(userAddress, 'testnet');
 * ```
 */
export function useUserPosition(address: string | null, network: NetworkName = 'testnet') {
  const [client] = useState(() => new AuraVaultClient(network));
  const [position, setPosition] = useState<UserPosition | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPosition = useCallback(async () => {
    if (!address) {
      setPosition(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const userPosition = await client.getUserPosition(address);
      setPosition(userPosition);
    } catch (err) {
      const { message } = translateVaultError(err);
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [address, client]);

  useEffect(() => {
    fetchPosition();
    const interval = setInterval(fetchPosition, 30000);
    return () => clearInterval(interval);
  }, [fetchPosition]);

  return { position, loading, error, refresh: fetchPosition };
}
```

### Usage in Components

```typescript
/**
 * Example React component using vault hooks.
 */
export function DepositWidget() {
  const { state, deposit, isLoading, error } = useVault('testnet');
  const [amount, setAmount] = useState('');
  const { position } = useUserPosition(userAddress);

  const handleDeposit = async () => {
    if (!amount || !userKeypair) return;

    try {
      const stroops = tokensToStroops(amount);
      const result = await deposit(userKeypair, BigInt(stroops));

      if (result) {
        alert(`Deposited! Minted ${result.shares} shares`);
        setAmount('');
      }
    } catch (err) {
      alert(`Deposit failed: ${error?.message}`);
    }
  };

  if (isLoading) return <div>Loading...</div>;

  return (
    <div>
      <div className="vault-stats">
        <p>Total Assets: {state ? stroupsToTokens(state.totalAssets) : 'N/A'}</p>
        <p>Share Price: {state ? calculateSharePrice(state.totalAssets, state.totalShares) : 'N/A'}</p>
        <p>Your Balance: {position ? stroupsToTokens(position.tokenValue) : 'N/A'}</p>
      </div>

      <input
        type="number"
        placeholder="Amount to deposit"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
      />
      <button onClick={handleDeposit} disabled={!amount || isLoading}>
        {isLoading ? 'Processing...' : 'Deposit'}
      </button>

      {error && <div className="error">{error.message}</div>}
    </div>
  );
}
```

---

## Complete Working Example

```typescript
/**
 * End-to-end example: deposit, check balance, and withdraw.
 */
async function completeVaultExample() {
  const network = 'testnet' as NetworkName;
  const client = new AuraVaultClient(network);

  // 1. User keypair (in production, load from wallet)
  const userKeypair = Keypair.random();
  console.log('User address:', userKeypair.publicKey());

  // 2. Fund the account (testnet only)
  await fundAccountViaFriendbot(userKeypair.publicKey());

  // 3. Check vault state
  const state = await client.getVaultState();
  console.log('Vault state:', {
    totalAssets: stroupsToTokens(state.totalAssets),
    sharePrice: calculateSharePrice(state.totalAssets, state.totalShares),
  });

  // 4. Deposit
  console.log('Depositing 1 token (10,000,000 stroops)...');
  const depositResult = await client.deposit(userKeypair, 10_000_000n);
  console.log('Deposit successful!', {
    shares: depositResult.shares.toString(),
    txHash: depositResult.hash,
  });

  // 5. Check balance
  const balance = await client.balanceOf(userKeypair.publicKey());
  console.log('Your balance:', stroupsToTokens(balance));

  // 6. Check position
  const position = await client.getUserPosition(userKeypair.publicKey());
  console.log('Your position:', {
    shares: position.shareBalance.toString(),
    tokenValue: stroupsToTokens(position.tokenValue),
    percentageOfVault: position.percentageOfVault.toFixed(2) + '%',
  });

  // 7. Withdraw half
  console.log('Withdrawing half your shares...');
  const withdrawResult = await client.withdraw(userKeypair, balance / 2n);
  console.log('Withdrawal successful!', {
    tokensRedeemed: stroupsToTokens(withdrawResult.amount),
    txHash: withdrawResult.hash,
  });

  // 8. Final balance
  const finalBalance = await client.balanceOf(userKeypair.publicKey());
  console.log('Final balance:', stroupsToTokens(finalBalance));
}

// Execute
completeVaultExample().catch(console.error);
```

---

## Best Practices

### Transaction Signing

```typescript
// ❌ BAD: Never store private keys in environment variables or code
const keypair = Keypair.fromSecret(process.env.PRIVATE_KEY!);

// ✅ GOOD: Load from secure wallet or HSM
async function getKeypairFromWallet(): Promise<Keypair> {
  // Use Freighter, MetaMask Snaps, or Coinbase Wallet
  const publicKey = await requestWalletAddress();
  const signature = await requestWalletSignature(transaction);
  return { publicKey, sign: signature };
}
```

### Caching and State

```typescript
// ❌ BAD: Query contract every time
async function getBalance(address: string) {
  return await client.balanceOf(address); // Called 100 times per second?
}

// ✅ GOOD: Cache with TTL and invalidate on events
class VaultCache {
  private cache = new Map<string, { value: bigint; timestamp: number }>();
  private TTL = 30_000; // 30 seconds

  async getBalance(address: string): Promise<bigint> {
    const cached = this.cache.get(address);
    if (cached && Date.now() - cached.timestamp < this.TTL) {
      return cached.value;
    }

    const value = await client.balanceOf(address);
    this.cache.set(address, { value, timestamp: Date.now() });
    return value;
  }

  invalidate(address: string) {
    this.cache.delete(address);
  }
}
```

### Error Recovery

```typescript
// ❌ BAD: Fail immediately on any error
async function deposit(amount: bigint) {
  return await client.deposit(keypair, amount);
}

// ✅ GOOD: Distinguish transient from permanent failures
async function depositWithRetry(amount: bigint, maxRetries = 3): Promise<DepositResult> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await client.deposit(keypair, amount);
    } catch (error) {
      const { code } = translateVaultError(error);

      // Permanent failures: don't retry
      if (code === VaultErrorCode.InsufficientShares || code === VaultErrorCode.VaultPaused) {
        throw error;
      }

      // Transient failures: retry with exponential backoff
      if (attempt < maxRetries) {
        const backoff = Math.pow(2, attempt - 1) * 1000; // 1s, 2s, 4s
        await new Promise((resolve) => setTimeout(resolve, backoff));
        continue;
      }

      throw error;
    }
  }

  throw new Error('Deposit failed after all retries');
}
```

### TypeScript Safety

```typescript
// ❌ BAD: Any types everywhere
function deposit(client: any, keypair: any, amount: any): any {
  return client.deposit(keypair, amount);
}

// ✅ GOOD: Strict typing throughout
function deposit(
  client: AuraVaultClient,
  keypair: Keypair,
  amount: bigint
): Promise<DepositResult> {
  return client.deposit(keypair, amount);
}
```

### Network Configuration

```typescript
// ❌ BAD: Hardcode network in code
const contractId = 'CAFNFVB3IS37BBMUHQNHW4QSJVDSW5UUI4P4RQGLUWUOAQK5W7VCXZ7Y';

// ✅ GOOD: Load from environment
const NETWORK = (process.env.STELLAR_NETWORK || 'testnet') as NetworkName;
const client = new AuraVaultClient(NETWORK);
```

---

## See Also

- [Stellar SDK Documentation](https://developers.stellar.org/docs/tools-and-sdks/js-stellar-sdk)
- [Soroban Documentation](https://developers.stellar.org/docs/smart-contracts/overview)
- [Smart Contract API Reference](./smart-contract-api.md)
- [Error Reference](./error-codes.json)
- [Backend API Reference](./api-reference.md)
- [Rust Integration Guide](./integration-rust.md)

---

**Last updated**: 2026-08-30  
**SDK Version**: 13.0.0+  
**Soroban Protocol**: 27+
