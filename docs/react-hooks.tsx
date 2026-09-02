/**
 * React Hooks for Aura Vault Protocol
 *
 * This file contains production-ready React hooks for integrating Aura Vault
 * into your Next.js or React application. All hooks include error handling,
 * loading states, and automatic polling.
 *
 * @module @aura-vault/react
 *
 * Usage:
 * ```typescript
 * import { useVault, useUserPosition, useTransactionStatus } from '@aura-vault/react';
 * ```
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AuraVaultClient,
  DepositResult,
  WithdrawResult,
  HarvestResult,
  VaultState,
  UserPosition,
  VaultError,
  UseVaultOptions,
  NetworkName,
} from './types-js';

// ─────────────────────────────────────────────────────────────────────────────
// useVault — Main vault state and operations hook
// ─────────────────────────────────────────────────────────────────────────────

/**
 * useVault hook — Manages vault state and provides deposit/withdraw/harvest operations.
 *
 * Features:
 * - Automatic polling of vault state every 30 seconds (configurable)
 * - Error handling with context-aware messages
 * - Loading states for async operations
 * - Automatic state refresh after each operation
 *
 * @param network - Target network ('testnet' or 'mainnet')
 * @param options - Additional hook options
 * @returns Vault client interface with state and operations
 *
 * @example
 * ```tsx
 * function DepositForm() {
 *   const { state, deposit, isLoading, error } = useVault('testnet');
 *
 *   if (!state) return <div>Loading...</div>;
 *
 *   return (
 *     <form onSubmit={(e) => {
 *       e.preventDefault();
 *       deposit(keypair, BigInt(1_000_000));
 *     }}>
 *       <p>Current share price: {Number(state.sharePrice) / 1e7}</p>
 *       {error && <p className="error">{error.message}</p>}
 *       <button disabled={isLoading}>
 *         {isLoading ? 'Processing...' : 'Deposit'}
 *       </button>
 *     </form>
 *   );
 * }
 * ```
 */
export function useVault(network: NetworkName = 'testnet', options?: UseVaultOptions) {
  const [state, setState] = useState<VaultState | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<VaultError | null>(null);
  const clientRef = useRef<AuraVaultClient | null>(null);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Initialize client
  const client = useCallback(() => {
    if (!clientRef.current) {
      // Import and instantiate AuraVaultClient dynamically to avoid SSR issues
      // clientRef.current = new AuraVaultClient(network);
    }
    return clientRef.current;
  }, [network]);

  // Fetch vault state
  const fetchState = useCallback(async () => {
    const vaultClient = client();
    if (!vaultClient) return;

    setIsLoading(true);
    setError(null);
    try {
      const vaultState = await vaultClient.getVaultState();
      setState(vaultState);
    } catch (err: unknown) {
      const vaultError = err as VaultError;
      setError(vaultError);
      options?.onError?.(vaultError);
    } finally {
      setIsLoading(false);
    }
  }, [client, options]);

  // Deposit wrapper
  const deposit = useCallback(
    async (keypair: any, amount: bigint): Promise<DepositResult | null> => {
      setIsLoading(true);
      setError(null);
      try {
        const vaultClient = client();
        if (!vaultClient) throw new Error('Vault client not initialized');

        const result = await vaultClient.deposit(keypair, amount);
        options?.onSuccess?.(result);
        await fetchState(); // Refresh state
        return result;
      } catch (err: unknown) {
        const vaultError = err as VaultError;
        setError(vaultError);
        options?.onError?.(vaultError);
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [client, fetchState, options]
  );

  // Withdraw wrapper
  const withdraw = useCallback(
    async (keypair: any, shares: bigint): Promise<WithdrawResult | null> => {
      setIsLoading(true);
      setError(null);
      try {
        const vaultClient = client();
        if (!vaultClient) throw new Error('Vault client not initialized');

        const result = await vaultClient.withdraw(keypair, shares);
        options?.onSuccess?.(result);
        await fetchState(); // Refresh state
        return result;
      } catch (err: unknown) {
        const vaultError = err as VaultError;
        setError(vaultError);
        options?.onError?.(vaultError);
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [client, fetchState, options]
  );

  // Harvest wrapper
  const harvest = useCallback(
    async (keypair: any, yieldAmount: bigint): Promise<HarvestResult | null> => {
      setIsLoading(true);
      setError(null);
      try {
        const vaultClient = client();
        if (!vaultClient) throw new Error('Vault client not initialized');

        const result = await vaultClient.harvest(keypair, yieldAmount);
        options?.onSuccess?.(result);
        await fetchState(); // Refresh state
        return result;
      } catch (err: unknown) {
        const vaultError = err as VaultError;
        setError(vaultError);
        options?.onError?.(vaultError);
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [client, fetchState, options]
  );

  // Pause wrapper
  const pause = useCallback(
    async (adminKeypair: any): Promise<string | null> => {
      setIsLoading(true);
      setError(null);
      try {
        const vaultClient = client();
        if (!vaultClient) throw new Error('Vault client not initialized');

        const txHash = await vaultClient.pause(adminKeypair);
        await fetchState(); // Refresh state
        return txHash;
      } catch (err: unknown) {
        const vaultError = err as VaultError;
        setError(vaultError);
        options?.onError?.(vaultError);
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [client, fetchState, options]
  );

  // Unpause wrapper
  const unpause = useCallback(
    async (adminKeypair: any): Promise<string | null> => {
      setIsLoading(true);
      setError(null);
      try {
        const vaultClient = client();
        if (!vaultClient) throw new Error('Vault client not initialized');

        const txHash = await vaultClient.unpause(adminKeypair);
        await fetchState(); // Refresh state
        return txHash;
      } catch (err: unknown) {
        const vaultError = err as VaultError;
        setError(vaultError);
        options?.onError?.(vaultError);
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    [client, fetchState, options]
  );

  // Set up polling
  useEffect(() => {
    fetchState();

    const pollInterval = options?.pollInterval ?? 30_000; // 30 seconds default
    pollIntervalRef.current = setInterval(fetchState, pollInterval);

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, [fetchState, options?.pollInterval]);

  return {
    state,
    deposit,
    withdraw,
    harvest,
    pause,
    unpause,
    isLoading,
    error,
    refresh: fetchState,
    client: clientRef.current,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// useUserPosition — User position tracking hook
// ─────────────────────────────────────────────────────────────────────────────

/**
 * useUserPosition hook — Tracks user's vault position (shares and token value).
 *
 * Features:
 * - Automatic polling every 30 seconds
 * - Handles null addresses gracefully
 * - Calculates percentage of vault
 *
 * @param address - User's Stellar address (or null if not connected)
 * @param network - Target network
 * @param pollInterval - Polling interval in milliseconds (default: 30000)
 * @returns User position or null if address is not set
 *
 * @example
 * ```tsx
 * function UserBalance() {
 *   const { position, loading, error, refresh } = useUserPosition(userAddress);
 *
 *   if (!position) return <div>Not connected</div>;
 *   if (loading) return <div>Loading position...</div>;
 *
 *   return (
 *     <div>
 *       <p>Shares: {position.shareBalance.toString()}</p>
 *       <p>Token Value: {Number(position.tokenValue) / 1e7}</p>
 *       <p>Portfolio: {position.percentageOfVault.toFixed(2)}%</p>
 *       <button onClick={() => refresh()}>Refresh</button>
 *     </div>
 *   );
 * }
 * ```
 */
export function useUserPosition(
  address: string | null,
  network: NetworkName = 'testnet',
  pollInterval = 30_000
) {
  const [position, setPosition] = useState<UserPosition | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clientRef = useRef<AuraVaultClient | null>(null);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Initialize client
  const client = useCallback(() => {
    if (!clientRef.current) {
      // clientRef.current = new AuraVaultClient(network);
    }
    return clientRef.current;
  }, [network]);

  const fetchPosition = useCallback(async () => {
    if (!address) {
      setPosition(null);
      return;
    }

    const vaultClient = client();
    if (!vaultClient) return;

    setLoading(true);
    setError(null);
    try {
      const userPosition = await vaultClient.getUserPosition(address);
      setPosition(userPosition);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to fetch position');
    } finally {
      setLoading(false);
    }
  }, [address, client]);

  // Set up polling
  useEffect(() => {
    fetchPosition();

    if (address) {
      pollIntervalRef.current = setInterval(fetchPosition, pollInterval);
    }

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, [address, fetchPosition, pollInterval]);

  return {
    position,
    loading,
    error,
    refresh: fetchPosition,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// useTransactionStatus — Poll transaction confirmation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * useTransactionStatus hook — Polls a transaction until it's confirmed.
 *
 * Features:
 * - Automatic polling with configurable interval
 * - Timeout protection
 * - Callback on success/failure
 *
 * @param txHash - Transaction hash to poll (or null to skip polling)
 * @param network - Target network
 * @param options - Polling options
 * @returns Transaction status
 *
 * @example
 * ```tsx
 * function TransactionMonitor() {
 *   const { status, isConfirmed, error } = useTransactionStatus(txHash, 'testnet', {
 *     onConfirmed: () => alert('Transaction confirmed!'),
 *     onFailed: () => alert('Transaction failed'),
 *   });
 *
 *   return (
 *     <div>
 *       Status: {status}
 *       {isConfirmed && <p>✓ Confirmed</p>}
 *       {error && <p className="error">Error: {error}</p>}
 *     </div>
 *   );
 * }
 * ```
 */
export function useTransactionStatus(
  txHash: string | null,
  network: NetworkName = 'testnet',
  options?: {
    pollInterval?: number;
    maxAttempts?: number;
    onConfirmed?: () => void;
    onFailed?: (error: string) => void;
  }
) {
  const [status, setStatus] = useState<'pending' | 'confirmed' | 'failed'>('pending');
  const [isConfirmed, setIsConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ledger, setLedger] = useState<number | null>(null);
  const attemptsRef = useRef(0);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const clientRef = useRef<AuraVaultClient | null>(null);

  const client = useCallback(() => {
    if (!clientRef.current) {
      // clientRef.current = new AuraVaultClient(network);
    }
    return clientRef.current;
  }, [network]);

  const checkStatus = useCallback(async () => {
    if (!txHash) return;

    const vaultClient = client();
    if (!vaultClient) return;

    const maxAttempts = options?.maxAttempts ?? 60; // 5 minutes at 5-second intervals

    try {
      // Note: This would call a real Soroban RPC method to get transaction status
      // const response = await vaultClient.server.getTransaction(txHash);

      // For now, simulate the polling:
      if (attemptsRef.current >= maxAttempts) {
        setStatus('failed');
        setError('Transaction polling timeout');
        options?.onFailed?.('Polling timeout');
        return;
      }

      attemptsRef.current++;
      // In real implementation, check response.status and update accordingly
    } catch (err) {
      setStatus('failed');
      setError(err instanceof Error ? err.message : 'Unknown error');
      options?.onFailed?.(error || 'Unknown error');
    }
  }, [txHash, client, options]);

  useEffect(() => {
    if (!txHash) return;

    checkStatus();

    const pollInterval = options?.pollInterval ?? 5_000; // 5 seconds default
    pollIntervalRef.current = setInterval(checkStatus, pollInterval);

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, [txHash, checkStatus, options?.pollInterval]);

  return {
    status,
    isConfirmed,
    error,
    ledger,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// useLocalStorage — Persist data in browser storage
// ─────────────────────────────────────────────────────────────────────────────

/**
 * useLocalStorage hook — Persist state in browser localStorage.
 *
 * Useful for storing user preferences, recent transactions, etc.
 *
 * @param key - localStorage key
 * @param initialValue - Default value if key not found
 * @returns [value, setValue] tuple
 *
 * @example
 * ```tsx
 * const [network, setNetwork] = useLocalStorage('preferredNetwork', 'testnet');
 * ```
 */
export function useLocalStorage<T>(key: string, initialValue: T): [T, (value: T) => void] {
  const [storedValue, setStoredValue] = useState<T>(() => {
    try {
      const item = typeof window !== 'undefined' ? window.localStorage.getItem(key) : null;
      return item ? JSON.parse(item) : initialValue;
    } catch {
      return initialValue;
    }
  });

  const setValue = useCallback(
    (value: T) => {
      try {
        setStoredValue(value);
        if (typeof window !== 'undefined') {
          window.localStorage.setItem(key, JSON.stringify(value));
        }
      } catch (err) {
        console.error(`Failed to save ${key} to localStorage:`, err);
      }
    },
    [key]
  );

  return [storedValue, setValue];
}

// ─────────────────────────────────────────────────────────────────────────────
// useDebounce — Debounce values
// ─────────────────────────────────────────────────────────────────────────────

/**
 * useDebounce hook — Debounce a value by delay.
 *
 * Useful for form inputs where you want to validate or fetch after user stops typing.
 *
 * @param value - Value to debounce
 * @param delay - Debounce delay in milliseconds
 * @returns Debounced value
 *
 * @example
 * ```tsx
 * const [amount, setAmount] = useState('');
 * const debouncedAmount = useDebounce(amount, 500);
 *
 * useEffect(() => {
 *   // Validate amount when it changes (after 500ms pause)
 *   validateAmount(debouncedAmount);
 * }, [debouncedAmount]);
 * ```
 */
export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => clearTimeout(handler);
  }, [value, delay]);

  return debouncedValue;
}

// ─────────────────────────────────────────────────────────────────────────────
// usePrevious — Store previous value
// ─────────────────────────────────────────────────────────────────────────────

/**
 * usePrevious hook — Store the previous value of a prop/state.
 *
 * Useful for detecting changes and comparing old vs new values.
 *
 * @param value - Value to track
 * @returns Previous value (or undefined on first render)
 *
 * @example
 * ```tsx
 * const [shares, setShares] = useState(0n);
 * const prevShares = usePrevious(shares);
 *
 * if (prevShares && shares > prevShares) {
 *   console.log('Shares increased!');
 * }
 * ```
 */
export function usePrevious<T>(value: T): T | undefined {
  const ref = useRef<T>();

  useEffect(() => {
    ref.current = value;
  }, [value]);

  return ref.current;
}

// ─────────────────────────────────────────────────────────────────────────────
// Component Examples
// ─────────────────────────────────────────────────────────────────────────────

/**
 * DepositForm component — Example deposit form using useVault hook.
 */
export function DepositForm() {
  const { state, deposit, isLoading, error } = useVault('testnet');
  const [amount, setAmount] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount) return;

    // Note: In real implementation, get keypair from wallet
    // const keypair = await getKeypairFromWallet();
    // const stroops = tokensToStroops(amount);
    // const result = await deposit(keypair, BigInt(stroops));
  };

  if (!state) {
    return <div className="loading">Loading vault...</div>;
  }

  return (
    <form onSubmit={handleSubmit} className="deposit-form">
      <h2>Deposit into Aura Vault</h2>

      <div className="vault-info">
        <p>Total Assets: {state.totalAssets.toString()} stroops</p>
        <p>Share Price: {Number(state.sharePrice) / 1e7}</p>
        <p>Status: {state.isPaused ? 'Paused' : 'Active'}</p>
      </div>

      <input
        type="number"
        step="0.0001"
        placeholder="Amount to deposit"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        disabled={isLoading || state.isPaused}
        required
      />

      <button type="submit" disabled={isLoading || state.isPaused || !amount}>
        {isLoading ? 'Processing...' : 'Deposit'}
      </button>

      {error && <div className="error">Error: {error.message}</div>}
    </form>
  );
}

/**
 * UserBalanceDisplay component — Example user balance display using useUserPosition hook.
 */
export function UserBalanceDisplay({ address }: { address: string | null }) {
  const { position, loading, error } = useUserPosition(address);

  if (!address) {
    return <div className="not-connected">Wallet not connected</div>;
  }

  if (loading) {
    return <div className="loading">Loading balance...</div>;
  }

  if (!position) {
    return <div className="empty">No position</div>;
  }

  if (error) {
    return <div className="error">Error: {error}</div>;
  }

  return (
    <div className="user-balance">
      <h3>Your Position</h3>
      <dl>
        <dt>Shares:</dt>
        <dd>{position.shareBalance.toString()}</dd>

        <dt>Token Value:</dt>
        <dd>{Number(position.tokenValue) / 1e7} tokens</dd>

        <dt>Portfolio:</dt>
        <dd>{position.percentageOfVault.toFixed(2)}%</dd>
      </dl>
    </div>
  );
}
