"use client";

import React, { useEffect, useState, useCallback } from 'react';
import { useLocale, useTranslations } from "next-intl";
import VaultHealthScore from './VaultHealthScore';
import { EmptyState } from './EmptyState';
import PortfolioPanel from '@/components/PortfolioPanel';

interface VaultBalance {
  usd: number;
  xlm: number;
  lastUpdated: number;
}

interface VaultMetrics {
  apy: number;
  tvl: number;
  totalUsers: number;
  tvlChange24h: number;
}

interface Transaction {
  id: string;
  type: 'deposit' | 'withdraw' | 'reward';
  amount: number;
  timestamp: number;
  status: 'completed' | 'pending' | 'failed';
}

interface WalletInfo {
  address: string;
  connected: boolean;
  network: string;
}

const VaultOverviewDashboard: React.FC = () => {
  const t = useTranslations("dashboard");
  const locale = useLocale();
  const [vaultBalance, setVaultBalance] = useState<VaultBalance>({
    usd: 0,
    xlm: 0,
    lastUpdated: Date.now(),
  });
  const [vaultMetrics, setVaultMetrics] = useState<VaultMetrics>({
    apy: 0,
    tvl: 0,
    totalUsers: 0,
    tvlChange24h: 0,
  });
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [walletInfo, setWalletInfo] = useState<WalletInfo>({
    address: '',
    connected: false,
    network: 'Stellar',
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch vault balance with WebSocket support for real-time updates
  const fetchVaultBalance = useCallback(async () => {
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/vault/balance`, {
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) throw new Error('Failed to fetch balance');

      const data = await response.json();
      setVaultBalance({
        usd: data.usd || 0,
        xlm: data.xlm || 0,
        lastUpdated: Date.now(),
      });
      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      setError(message);
      console.error('Error fetching vault balance:', err);
    }
  }, []);

  // Fetch vault metrics
  const fetchVaultMetrics = useCallback(async () => {
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/vault/metrics`, {
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) throw new Error('Failed to fetch metrics');

      const data = await response.json();
      setVaultMetrics({
        apy: data.apy || 0,
        tvl: data.tvl || 0,
        totalUsers: data.totalUsers || 0,
        tvlChange24h: data.tvlChange24h || 0,
      });
    } catch (err) {
      console.error('Error fetching vault metrics:', err);
    }
  }, []);

  // Fetch recent transactions
  const fetchTransactions = useCallback(async () => {
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/vault/transactions?limit=10`, {
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) throw new Error('Failed to fetch transactions');

      const data = await response.json();
      setTransactions(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Error fetching transactions:', err);
    }
  }, []);

  // Fetch wallet info
  const fetchWalletInfo = useCallback(async () => {
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/wallet/info`, {
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) throw new Error('Failed to fetch wallet info');

      const data = await response.json();
      setWalletInfo({
        address: data.address || '',
        connected: data.connected || false,
        network: data.network || 'Stellar',
      });
    } catch (err) {
      console.error('Error fetching wallet info:', err);
    }
  }, []);

  // Setup WebSocket for real-time updates
  useEffect(() => {
    let websocket: WebSocket | null = null;

    const setupWebSocket = () => {
      try {
        const wsUrl = process.env.NEXT_PUBLIC_API_URL?.replace('http', 'ws') || 'ws://localhost:3001';
        websocket = new WebSocket(`${wsUrl}/api/vault/balance-stream`);

        websocket.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === 'balance-update') {
              setVaultBalance({
                usd: data.usd || 0,
                xlm: data.xlm || 0,
                lastUpdated: Date.now(),
              });
            }
          } catch (err) {
            console.error('Error parsing WebSocket message:', err);
          }
        };

        websocket.onerror = (err) => {
          console.error('WebSocket error:', err);
        };

        websocket.onclose = () => {
          setTimeout(setupWebSocket, 5000);
        };
      } catch (err) {
        console.error('Failed to setup WebSocket:', err);
      }
    };

    setupWebSocket();

    return () => {
      if (websocket && websocket.readyState === WebSocket.OPEN) {
        websocket.close();
      }
    };
  }, []);

  // Initial data fetch
  useEffect(() => {
    const loadData = async () => {
      setIsLoading(true);
      try {
        await Promise.all([
          fetchVaultBalance(),
          fetchVaultMetrics(),
          fetchTransactions(),
          fetchWalletInfo(),
        ]);
      } finally {
        setIsLoading(false);
      }
    };

    loadData();

    // Refresh metrics every 30 seconds
    const metricsInterval = setInterval(() => {
      fetchVaultMetrics();
      fetchTransactions();
    }, 30000);

    return () => clearInterval(metricsInterval);
  }, [fetchVaultBalance, fetchVaultMetrics, fetchTransactions, fetchWalletInfo]);

  const formatCurrency = (value: number): string => {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };

  const formatDate = (timestamp: number): string => {
    return new Date(timestamp).toLocaleDateString(locale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (isLoading) {
    return (
      <div className="w-full h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800">
        <div className="animate-pulse flex flex-col gap-4">
          <div className="h-12 w-48 bg-slate-200 dark:bg-slate-700 rounded-lg"></div>
          <div className="h-8 w-32 bg-slate-200 dark:bg-slate-700 rounded-lg"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800 px-4 py-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex flex-col gap-2 mb-12">
          <h1 className="text-4xl font-bold text-slate-900 dark:text-white">
            {t("title")}
          </h1>
          <p className="text-lg text-slate-600 dark:text-slate-400">
            {walletInfo.connected ? t("connected", {address: `${walletInfo.address.slice(0, 10)}...`}) : t("wallet_not_connected")}
          </p>
        </div>

        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 mb-8">
            <p className="text-red-700 dark:text-red-300">{error}</p>
          </div>
        )}

        {/* Balance Card */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <div className="bg-white dark:bg-slate-800 rounded-lg shadow-lg p-6">
            <h2 className="text-sm font-semibold text-slate-600 dark:text-slate-400 mb-2">
              {t("vault_balance")}
            </h2>
            <p className="text-3xl font-bold text-slate-900 dark:text-white mb-1">
              {formatCurrency(vaultBalance.usd)}
            </p>
            <p className="text-sm text-slate-500 dark:text-slate-500">
              {vaultBalance.xlm.toFixed(2)} XLM
            </p>
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-2">
              {t("updated", {time: new Date(vaultBalance.lastUpdated).toLocaleTimeString(locale)})}
            </p>
          </div>

          <div className="bg-white dark:bg-slate-800 rounded-lg shadow-lg p-6">
            <h2 className="text-sm font-semibold text-slate-600 dark:text-slate-400 mb-2">
              {t("apy")}
            </h2>
            <p className="text-3xl font-bold text-green-600 dark:text-green-400">
              {vaultMetrics.apy.toFixed(2)}%
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-500 mt-3">
              {t("current_yield")}
            </p>
          </div>

          <div className="bg-white dark:bg-slate-800 rounded-lg shadow-lg p-6">
            <h2 className="text-sm font-semibold text-slate-600 dark:text-slate-400 mb-2">
              {t("tvl")}
            </h2>
            <p className="text-3xl font-bold text-slate-900 dark:text-white mb-1">
              {formatCurrency(vaultMetrics.tvl)}
            </p>
            <p className={`text-sm ${vaultMetrics.tvlChange24h >= 0 ? 'text-green-600' : 'text-red-600'} dark:text-opacity-80`}>
              {vaultMetrics.tvlChange24h >= 0 ? '+' : ''}{vaultMetrics.tvlChange24h.toFixed(2)}% (24h)
            </p>
          </div>

          <div className="bg-white dark:bg-slate-800 rounded-lg shadow-lg p-6">
            <h2 className="text-sm font-semibold text-slate-600 dark:text-slate-400 mb-2">
              {t("total_users")}
            </h2>
            <p className="text-3xl font-bold text-slate-900 dark:text-white">
              {vaultMetrics.totalUsers.toLocaleString()}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-500 mt-3">
              {t("active_participants")}
            </p>
          </div>
        </div>

        {/* Vault Health Score */}
        <div className="mb-8">
          <VaultHealthScore />
        </div>

        {/* Recent Transactions */}
        <div className="bg-white dark:bg-slate-800 rounded-lg shadow-lg overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700">
            <h2 className="text-xl font-bold text-slate-900 dark:text-white">
              {t("recent_transactions")}
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50">
                  <th className="px-6 py-3 text-left text-sm font-semibold text-slate-600 dark:text-slate-400">
                    {t("type")}
                  </th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-slate-600 dark:text-slate-400">
                    {t("amount")}
                  </th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-slate-600 dark:text-slate-400">
                    {t("date")}
                  </th>
                  <th className="px-6 py-3 text-left text-sm font-semibold text-slate-600 dark:text-slate-400">
                    {t("status")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {transactions.length > 0 ? (
                  transactions.map((tx) => (
                    <tr key={tx.id} className="border-b border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-900/50 transition-colors">
                      <td className="px-6 py-4 text-sm font-medium text-slate-900 dark:text-white">
                        <span className="capitalize">{tx.type}</span>
                      </td>
                      <td className="px-6 py-4 text-sm font-semibold text-slate-900 dark:text-white">
                        {tx.type === 'withdraw' ? '-' : '+'}{formatCurrency(tx.amount)}
                      </td>
                      <td className="px-6 py-4 text-sm text-slate-600 dark:text-slate-400">
                        {formatDate(tx.timestamp)}
                      </td>
                      <td className="px-6 py-4 text-sm">
                        <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                          tx.status === 'completed' ? 'bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300' :
                          tx.status === 'pending' ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300' :
                          'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300'
                        }`}>
                          {t(`transaction_status.${tx.status}`)}
                        </span>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4}>
                      <EmptyState variant="no-transactions" className="py-4" />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Portfolio export */}
      <div className="mt-8">
        <PortfolioPanel />
      </div>
    </div>
  );
};

export default VaultOverviewDashboard;
