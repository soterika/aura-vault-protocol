# Python Integration Guide — Aura Vault Backend API

This guide covers interacting with the Aura Vault backend API from Python. It includes both the off-chain REST API (TypeScript/Express backend) and the on-chain Soroban contract interface via `stellar-sdk`.

---

## Table of Contents

- [Installation & Setup](#installation--setup)
- [Authentication with Stellar Signature](#authentication-with-stellar-signature)
- [Synchronous Client](#synchronous-client)
  - [Deposit](#deposit)
  - [Withdraw](#withdraw)
  - [Harvest](#harvest)
  - [Portfolio Data](#portfolio-data)
- [Async Client with aiohttp](#async-client-with-aiohttp)
- [Error Handling](#error-handling)
- [Complete Working Example](#complete-working-example)
- [Contract Error Codes Reference](#contract-error-codes-reference)

---

## Installation & Setup

### Requirements

```
Python >= 3.10
```

### Install dependencies

```bash
pip install stellar-sdk==10.0.0 requests==2.32.3 aiohttp==3.9.5
```

Or with a `requirements.txt`:

```
stellar-sdk==10.0.0
requests==2.32.3
aiohttp==3.9.5
```

```bash
pip install -r requirements.txt
```

### Configuration

```python
# config.py
import os

# Soroban / Stellar
CONTRACT_ID  = os.environ["AURA_CONTRACT_ID"]   # e.g. CABC...XYZ
TOKEN_ID     = os.environ["AURA_TOKEN_ID"]       # SEP-41 underlying token contract
NETWORK_URL  = os.environ.get(
    "SOROBAN_RPC_URL",
    "https://soroban-testnet.stellar.org"
)
NETWORK_PASSPHRASE = os.environ.get(
    "STELLAR_NETWORK",
    "Test SDF Network ; September 2015"   # testnet
    # "Public Global Stellar Network ; September 2015"  # mainnet
)

# Backend REST API
API_BASE_URL = os.environ.get("API_BASE_URL", "https://api.auravault.example")
```

> Store secrets in environment variables or a secrets manager — never hardcode keypairs in source.

---

## Authentication with Stellar Signature

The backend API uses Stellar keypair authentication. The client signs a time-based challenge to prove ownership of the Stellar address without transmitting the private key.

```python
# auth.py
import time
import hashlib
import hmac
import requests
from stellar_sdk import Keypair

API_BASE_URL = "https://api.auravault.example"


def get_auth_headers(keypair: Keypair) -> dict:
    """
    Returns HTTP headers that authenticate the request as `keypair.public_key`.

    The backend verifies the Ed25519 signature over the canonical payload:
        "{address}:{timestamp}"
    where timestamp is Unix time in seconds (integer).
    """
    address   = keypair.public_key
    timestamp = str(int(time.time()))
    payload   = f"{address}:{timestamp}".encode()

    # Ed25519 sign via stellar-sdk
    signature = keypair.sign(payload).hex()

    return {
        "X-Stellar-Address":   address,
        "X-Stellar-Timestamp": timestamp,
        "X-Stellar-Signature": signature,
        "Content-Type":        "application/json",
    }


def authenticate(keypair: Keypair) -> str:
    """
    Exchanges a signed challenge for a short-lived JWT bearer token.
    Returns the token string.
    """
    headers = get_auth_headers(keypair)
    resp = requests.post(
        f"{API_BASE_URL}/api/auth/login",
        headers=headers,
        timeout=10,
    )
    resp.raise_for_status()
    data = resp.json()
    return data["token"]   # JWT, valid for 24 h
```

---

## Synchronous Client

```python
# client.py
from __future__ import annotations

import requests
from stellar_sdk import Keypair

from auth import authenticate


class AuraVaultClient:
    """
    Thin synchronous wrapper around the Aura Vault backend REST API.
    One instance per keypair / session.
    """

    def __init__(self, keypair: Keypair, base_url: str = "https://api.auravault.example"):
        self._keypair  = keypair
        self._base_url = base_url.rstrip("/")
        self._session  = requests.Session()
        self._session.headers.update({"Content-Type": "application/json"})
        self._token: str | None = None

    # ------------------------------------------------------------------
    # Auth helpers
    # ------------------------------------------------------------------

    def _ensure_authenticated(self) -> None:
        if not self._token:
            self._token = authenticate(self._keypair)
            self._session.headers.update({"Authorization": f"Bearer {self._token}"})

    def _post(self, path: str, body: dict) -> dict:
        self._ensure_authenticated()
        resp = self._session.post(f"{self._base_url}{path}", json=body, timeout=30)
        resp.raise_for_status()
        return resp.json()

    def _get(self, path: str, params: dict | None = None) -> dict:
        self._ensure_authenticated()
        resp = self._session.get(f"{self._base_url}{path}", params=params, timeout=30)
        resp.raise_for_status()
        return resp.json()

    # ------------------------------------------------------------------
    # Vault operations
    # ------------------------------------------------------------------

    def deposit(self, amount: int) -> dict:
        """
        Deposit `amount` (in the vault's underlying token base units) into the vault.
        Returns the backend job response including the pending Stellar transaction hash.

        Args:
            amount: Token amount in base units (e.g. 1_000_000 = 1.0 XLM-equivalent)

        Returns:
            {"jobId": "...", "txHash": "...", "status": "pending", "sharesEstimate": ...}
        """
        if amount <= 0:
            raise ValueError(f"amount must be positive, got {amount}")
        return self._post("/api/vault/deposit", {
            "address": self._keypair.public_key,
            "amount":  amount,
        })

    def withdraw(self, shares: int) -> dict:
        """
        Burn `shares` vault shares and redeem the underlying tokens.

        Args:
            shares: Number of shares to burn (must be ≤ caller's balance)

        Returns:
            {"jobId": "...", "txHash": "...", "status": "pending", "underlyingEstimate": ...}
        """
        if shares <= 0:
            raise ValueError(f"shares must be positive, got {shares}")
        return self._post("/api/vault/withdraw", {
            "address": self._keypair.public_key,
            "shares":  shares,
        })

    def harvest(self, yield_amount: int) -> dict:
        """
        Inject yield into the vault (keeper / admin only).
        Increases the exchange rate for all existing shareholders without minting new shares.

        Args:
            yield_amount: Amount of yield tokens to inject

        Returns:
            {"jobId": "...", "txHash": "...", "status": "pending"}
        """
        if yield_amount <= 0:
            raise ValueError(f"yield_amount must be positive, got {yield_amount}")
        return self._post("/api/vault/harvest", {
            "address":     self._keypair.public_key,
            "yieldAmount": yield_amount,
        })

    # ------------------------------------------------------------------
    # Portfolio data
    # ------------------------------------------------------------------

    def get_portfolio(self) -> dict:
        """
        Fetch the caller's current portfolio position.

        Returns:
            {
                "address":        "G...",
                "shares":         1500000,
                "underlyingValue": 1623000,
                "sharePrice":     1.082,
                "yieldEarned":    123000,
                "depositedAt":    "2026-01-15T10:00:00Z",
                "lastHarvestAt":  "2026-08-27T06:00:00Z"
            }
        """
        return self._get(f"/api/portfolio/{self._keypair.public_key}")

    def get_vault_stats(self) -> dict:
        """
        Fetch global vault statistics.

        Returns:
            {
                "totalAssets":  50000000,
                "totalShares":  48000000,
                "sharePrice":   1.041667,
                "apy":          12.5,
                "depositorCount": 142
            }
        """
        return self._get("/api/vault/stats")

    def get_transaction_history(self, limit: int = 20, offset: int = 0) -> dict:
        """
        Fetch paginated transaction history for the caller's address.

        Args:
            limit:  Number of records per page (max 100)
            offset: Pagination offset

        Returns:
            {
                "transactions": [
                    {
                        "id":        "...",
                        "type":      "deposit" | "withdraw" | "harvest",
                        "amount":    1000000,
                        "shares":    1000000,
                        "txHash":    "...",
                        "status":    "confirmed",
                        "createdAt": "2026-08-01T12:00:00Z"
                    },
                    ...
                ],
                "total": 5,
                "limit": 20,
                "offset": 0
            }
        """
        return self._get(
            f"/api/portfolio/{self._keypair.public_key}/transactions",
            params={"limit": limit, "offset": offset},
        )

    def get_yield_breakdown(self) -> dict:
        """
        Fetch yield history and breakdown for the caller's position.

        Returns:
            {
                "totalYieldEarned": 123000,
                "yieldByPeriod": [
                    {"period": "2026-08", "yield": 45000, "apy": 11.2},
                    {"period": "2026-07", "yield": 41000, "apy": 10.8},
                    ...
                ]
            }
        """
        return self._get(f"/api/portfolio/{self._keypair.public_key}/yield")
```

---

## Async Client with aiohttp

For high-throughput scripts, batch portfolio queries, or keeper bots that monitor multiple addresses:

```python
# async_client.py
from __future__ import annotations

import asyncio
import time
from typing import Any

import aiohttp
from stellar_sdk import Keypair


class AsyncAuraVaultClient:
    """
    Async wrapper around the Aura Vault REST API using aiohttp.
    Use as an async context manager:

        async with AsyncAuraVaultClient(keypair) as client:
            stats = await client.get_vault_stats()
    """

    def __init__(
        self,
        keypair: Keypair,
        base_url: str = "https://api.auravault.example",
        timeout: float = 30.0,
    ):
        self._keypair  = keypair
        self._base_url = base_url.rstrip("/")
        self._timeout  = aiohttp.ClientTimeout(total=timeout)
        self._session: aiohttp.ClientSession | None = None
        self._token: str | None = None

    # ------------------------------------------------------------------
    # Context manager
    # ------------------------------------------------------------------

    async def __aenter__(self) -> "AsyncAuraVaultClient":
        self._session = aiohttp.ClientSession(timeout=self._timeout)
        await self._authenticate()
        return self

    async def __aexit__(self, *_: Any) -> None:
        if self._session:
            await self._session.close()

    # ------------------------------------------------------------------
    # Auth
    # ------------------------------------------------------------------

    async def _authenticate(self) -> None:
        address   = self._keypair.public_key
        timestamp = str(int(time.time()))
        payload   = f"{address}:{timestamp}".encode()
        signature = self._keypair.sign(payload).hex()

        headers = {
            "X-Stellar-Address":   address,
            "X-Stellar-Timestamp": timestamp,
            "X-Stellar-Signature": signature,
        }
        async with self._session.post(               # type: ignore[union-attr]
            f"{self._base_url}/api/auth/login",
            headers=headers,
        ) as resp:
            resp.raise_for_status()
            data = await resp.json()
            self._token = data["token"]

    def _auth_header(self) -> dict:
        return {"Authorization": f"Bearer {self._token}"}

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    async def _post(self, path: str, body: dict) -> dict:
        async with self._session.post(               # type: ignore[union-attr]
            f"{self._base_url}{path}",
            json=body,
            headers=self._auth_header(),
        ) as resp:
            resp.raise_for_status()
            return await resp.json()

    async def _get(self, path: str, params: dict | None = None) -> dict:
        async with self._session.get(                # type: ignore[union-attr]
            f"{self._base_url}{path}",
            params=params,
            headers=self._auth_header(),
        ) as resp:
            resp.raise_for_status()
            return await resp.json()

    # ------------------------------------------------------------------
    # Vault operations (same signatures as sync client)
    # ------------------------------------------------------------------

    async def deposit(self, amount: int) -> dict:
        return await self._post("/api/vault/deposit", {
            "address": self._keypair.public_key,
            "amount":  amount,
        })

    async def withdraw(self, shares: int) -> dict:
        return await self._post("/api/vault/withdraw", {
            "address": self._keypair.public_key,
            "shares":  shares,
        })

    async def harvest(self, yield_amount: int) -> dict:
        return await self._post("/api/vault/harvest", {
            "address":     self._keypair.public_key,
            "yieldAmount": yield_amount,
        })

    async def get_portfolio(self) -> dict:
        return await self._get(f"/api/portfolio/{self._keypair.public_key}")

    async def get_vault_stats(self) -> dict:
        return await self._get("/api/vault/stats")

    async def get_transaction_history(
        self, limit: int = 20, offset: int = 0
    ) -> dict:
        return await self._get(
            f"/api/portfolio/{self._keypair.public_key}/transactions",
            params={"limit": limit, "offset": offset},
        )


# ------------------------------------------------------------------
# Example: batch portfolio query for multiple addresses
# ------------------------------------------------------------------

async def batch_portfolio_query(
    admin_keypair: Keypair,
    addresses: list[str],
) -> list[dict]:
    """
    Concurrently fetch portfolio data for a list of addresses.
    Uses the admin keypair to authenticate; the backend returns
    public portfolio data for each address.
    """
    async with AsyncAuraVaultClient(admin_keypair) as client:
        tasks = [
            client._get(f"/api/portfolio/{addr}")
            for addr in addresses
        ]
        results = await asyncio.gather(*tasks, return_exceptions=True)

    portfolios = []
    for addr, result in zip(addresses, results):
        if isinstance(result, Exception):
            print(f"[WARN] Failed to fetch portfolio for {addr}: {result}")
        else:
            portfolios.append(result)
    return portfolios


# ------------------------------------------------------------------
# Example: keeper harvest loop
# ------------------------------------------------------------------

async def keeper_harvest_loop(
    keeper_keypair: Keypair,
    yield_per_cycle: int,
    interval_seconds: int = 3600,
) -> None:
    """
    Continuously harvests yield at a fixed interval.
    Suitable for running as a long-lived keeper bot.
    """
    print(f"Keeper bot started. Harvesting {yield_per_cycle} every {interval_seconds}s.")
    while True:
        try:
            async with AsyncAuraVaultClient(keeper_keypair) as client:
                stats = await client.get_vault_stats()
                print(f"  Vault total assets: {stats['totalAssets']:,}")
                print(f"  Share price:        {stats['sharePrice']:.6f}")

                result = await client.harvest(yield_per_cycle)
                print(f"  Harvest submitted:  jobId={result['jobId']}")

        except aiohttp.ClientResponseError as exc:
            print(f"  [ERROR] API error {exc.status}: {exc.message}")
        except Exception as exc:  # noqa: BLE001
            print(f"  [ERROR] Unexpected: {exc}")

        await asyncio.sleep(interval_seconds)


if __name__ == "__main__":
    import os

    keeper_kp = Keypair.from_secret(os.environ["KEEPER_SECRET"])
    asyncio.run(keeper_harvest_loop(keeper_kp, yield_per_cycle=50_000))
```

---

## Error Handling

### HTTP error mapping

```python
# errors.py
import requests
from requests.exceptions import HTTPError


class AuraVaultError(Exception):
    """Base class for all Aura Vault client errors."""


class AuthenticationError(AuraVaultError):
    """Raised when the server returns 401 Unauthorized."""


class InsufficientSharesError(AuraVaultError):
    """Raised when trying to withdraw more shares than the caller holds."""


class VaultPausedError(AuraVaultError):
    """Raised when a mutating operation is attempted on a paused vault."""


class RateLimitError(AuraVaultError):
    """Raised when the API rate limit is exceeded (429 Too Many Requests)."""


# Map HTTP status codes → exception types
_HTTP_ERROR_MAP: dict[int, type[AuraVaultError]] = {
    401: AuthenticationError,
    429: RateLimitError,
}

# Map backend error codes → exception types
_BACKEND_ERROR_MAP: dict[str, type[AuraVaultError]] = {
    "INSUFFICIENT_SHARES":  InsufficientSharesError,
    "VAULT_PAUSED":         VaultPausedError,
    "ZERO_AMOUNT":          AuraVaultError,
    "MATH_OVERFLOW":        AuraVaultError,
    "BALANCE_MISMATCH":     AuraVaultError,
}


def raise_for_response(exc: HTTPError) -> None:
    """Convert a requests.HTTPError into a typed AuraVaultError."""
    status = exc.response.status_code if exc.response is not None else 0
    if status in _HTTP_ERROR_MAP:
        raise _HTTP_ERROR_MAP[status](str(exc)) from exc

    # Try to parse the JSON error body
    try:
        body = exc.response.json() if exc.response is not None else {}
        code = body.get("code", "")
        msg  = body.get("message", str(exc))
    except Exception:  # noqa: BLE001
        code, msg = "", str(exc)

    if code in _BACKEND_ERROR_MAP:
        raise _BACKEND_ERROR_MAP[code](msg) from exc

    raise AuraVaultError(f"HTTP {status}: {msg}") from exc
```

### Deposit with retry and error handling

```python
import time
import requests
from stellar_sdk import Keypair
from client import AuraVaultClient
from errors import (
    AuraVaultError, VaultPausedError, RateLimitError, raise_for_response
)


def deposit_with_retry(
    keypair: Keypair,
    amount: int,
    max_retries: int = 3,
    backoff_base: float = 2.0,
) -> dict | None:
    """
    Attempt a deposit up to `max_retries` times with exponential backoff.
    Returns the response dict on success, or None if all retries failed.
    """
    client = AuraVaultClient(keypair)

    for attempt in range(1, max_retries + 1):
        try:
            result = client.deposit(amount)
            print(f"Deposit OK: jobId={result['jobId']}, txHash={result['txHash']}")
            return result

        except requests.HTTPError as exc:
            try:
                raise_for_response(exc)
            except VaultPausedError:
                print("Vault is paused. Aborting — no retry.")
                return None
            except RateLimitError:
                wait = backoff_base ** attempt
                print(f"Rate limited. Waiting {wait:.0f}s before retry {attempt}/{max_retries}.")
                time.sleep(wait)
            except AuraVaultError as vault_exc:
                print(f"Vault error: {vault_exc}")
                return None

        except Exception as exc:  # noqa: BLE001
            wait = backoff_base ** attempt
            print(f"Unexpected error on attempt {attempt}: {exc}. Retrying in {wait:.0f}s.")
            time.sleep(wait)

    print(f"Deposit failed after {max_retries} attempts.")
    return None
```

---

## Complete Working Example

```python
#!/usr/bin/env python3
"""
end_to_end.py — demonstrates deposit → check portfolio → withdraw.
Requires environment variables: AURA_USER_SECRET, AURA_CONTRACT_ID,
AURA_TOKEN_ID, API_BASE_URL (optional, defaults to testnet).
"""

import os
from stellar_sdk import Keypair
from client import AuraVaultClient

# Load keypair from environment
user_keypair = Keypair.from_secret(os.environ["AURA_USER_SECRET"])
print(f"Operating as: {user_keypair.public_key}")

client = AuraVaultClient(user_keypair)

# 1. Check vault stats before deposit
stats = client.get_vault_stats()
print(f"\nVault stats:")
print(f"  Total assets : {stats['totalAssets']:>15,}")
print(f"  Total shares : {stats['totalShares']:>15,}")
print(f"  Share price  : {stats['sharePrice']:>15.6f}")
print(f"  APY          : {stats.get('apy', 'n/a')} %")

# 2. Deposit 10 tokens (base units)
DEPOSIT_AMOUNT = 10_000_000   # 10.0 tokens with 6 decimal places
print(f"\nDepositing {DEPOSIT_AMOUNT:,} base units...")
deposit_result = client.deposit(DEPOSIT_AMOUNT)
print(f"  Job ID    : {deposit_result['jobId']}")
print(f"  TX Hash   : {deposit_result['txHash']}")
print(f"  Est shares: {deposit_result.get('sharesEstimate', 'pending'):,}")

# 3. Fetch updated portfolio
portfolio = client.get_portfolio()
print(f"\nPortfolio after deposit:")
print(f"  Shares          : {portfolio['shares']:>15,}")
print(f"  Underlying value: {portfolio['underlyingValue']:>15,}")
print(f"  Yield earned    : {portfolio['yieldEarned']:>15,}")

# 4. Fetch transaction history
history = client.get_transaction_history(limit=5)
print(f"\nLast {len(history['transactions'])} transactions:")
for tx in history["transactions"]:
    print(f"  [{tx['createdAt']}] {tx['type']:8s} "
          f"amount={tx['amount']:>12,}  shares={tx['shares']:>12,}  "
          f"status={tx['status']}")

# 5. Withdraw half the shares
half_shares = portfolio["shares"] // 2
if half_shares > 0:
    print(f"\nWithdrawing {half_shares:,} shares...")
    withdraw_result = client.withdraw(half_shares)
    print(f"  Job ID    : {withdraw_result['jobId']}")
    print(f"  TX Hash   : {withdraw_result['txHash']}")
else:
    print("\nNo shares to withdraw.")
```

---

## Contract Error Codes Reference

These error codes are returned by the Soroban contract and surfaced in the backend API error body when an on-chain transaction reverts.

| Code | Variant | Typical Trigger |
|---|---|---|
| 1 | `NotInitialized` | Vault not yet initialized |
| 2 | `AlreadyInitialized` | `initialize` called more than once |
| 3 | `InsufficientShares` | Withdraw amount exceeds caller's balance |
| 4 | `InsufficientUnderlying` | Vault cannot cover redemption |
| 5 | `ZeroAmount` | Zero input, or share mint rounds to zero |
| 6 | `MathOverflow` | Arithmetic overflow in share formula |
| 7 | `InvalidAddress` | Reserved — future address validation |
| 8 | `ZeroShares` | Harvest called when `total_shares == 0` |
| 9 | `UpgradeUnauthorized` | Caller is not the admin |
| 10 | `StorageLayoutMismatch` | Layout version mismatch on upgrade |
| 11 | `VaultPaused` | Mutating operation while vault is paused |
| 12 | `BalanceMismatch` | Flash loan guard: actual balance ≠ tracked state |
| 13 | `HarvestUnauthorized` | Harvest caller is not the admin |

The backend maps contract errors to HTTP 422 with `{"code": "<VARIANT_NAME>", "message": "..."}`.
