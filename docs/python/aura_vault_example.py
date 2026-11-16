"""Runnable Aura Vault REST and Soroban example for Python 3.11+.

Required environment variables:
  AURA_API_URL       Backend base URL, e.g. https://api.example.com
  AURA_CONTRACT_ID   Deployed Soroban vault contract id
  AURA_SECRET        Testnet Stellar secret seed (never use a production key here)
Optional:
  SOROBAN_RPC_URL    Defaults to Stellar Testnet RPC
  STELLAR_NETWORK    "testnet" (default) or "public"
  AURA_SHARES        Share amount to use for the yield estimate
  AURA_DEPOSIT       Underlying token amount in the token's smallest units
"""

from __future__ import annotations

import os
import time
from typing import Any

import requests
from stellar_sdk import Address, AssembledTransaction, Contract, Keypair, Network, SorobanServer, TransactionBuilder, scval

API_URL = os.environ["AURA_API_URL"].rstrip("/")
CONTRACT_ID = os.environ["AURA_CONTRACT_ID"]
RPC_URL = os.getenv("SOROBAN_RPC_URL", "https://soroban-testnet.stellar.org")
NETWORK = os.getenv("STELLAR_NETWORK", "testnet")
NETWORK_PASSPHRASE = Network.PUBLIC_NETWORK_PASSPHRASE if NETWORK == "public" else Network.TESTNET_NETWORK_PASSPHRASE
SESSION = requests.Session()


def request_json(method: str, url: str, **kwargs: Any) -> dict[str, Any]:
    """Retry transient network, 429, and server failures with bounded backoff."""
    for attempt in range(4):
        try:
            response = SESSION.request(method, url, timeout=(5, 20), **kwargs)
            response.raise_for_status()
            return response.json()
        except (requests.Timeout, requests.ConnectionError, requests.HTTPError) as exc:
            retryable = not isinstance(exc, requests.HTTPError) or (
                exc.response is not None
                and (exc.response.status_code == 429 or exc.response.status_code >= 500)
            )
            if not retryable or attempt == 3:
                raise
            time.sleep(0.5 * (2**attempt))
    raise RuntimeError("request failed")


def authenticate(keypair: Keypair) -> str:
    challenge = request_json(
        "POST", f"{API_URL}/api/auth/challenge", json={"address": keypair.public_key}
    )["data"]["challenge"]
    signature = keypair.sign(challenge.encode("utf-8")).hex()
    result = request_json(
        "POST",
        f"{API_URL}/api/auth/verify",
        json={"address": keypair.public_key, "challenge": challenge, "signature": signature},
    )
    return result["data"]["accessToken"]


def read_stats() -> dict[str, Any]:
    return request_json("GET", f"{API_URL}/api/v1/vault/stats")["data"]


def estimate_yield(shares: str, share_price: str) -> float:
    """Estimate share value in underlying units; this is not a yield guarantee."""
    return float(shares) * float(share_price)


def submit_deposit(keypair: Keypair, amount: int) -> str:
    """Build, simulate, authorize, sign, and submit a Soroban deposit call."""
    server = SorobanServer(RPC_URL)
    try:
        source = server.load_account(keypair.public_key)
        builder = (
            TransactionBuilder(source, NETWORK_PASSPHRASE, base_fee=100)
            .append_operation(
                Contract(CONTRACT_ID).call(
                    "deposit", Address(keypair.public_key), scval.to_int128(amount)
                )
            )
            .set_timeout(180)
        )
        assembled = AssembledTransaction(
            transaction_builder=builder,
            server=server,
            transaction_signer=keypair,
        )
        assembled.simulate().authorize(signer=keypair).sign_and_submit()
        return assembled.built_transaction.hash_hex()
    finally:
        server.close()


def wait_for_confirmation(tx_hash: str, timeout_seconds: int = 180) -> None:
    """Poll Soroban RPC until the transaction succeeds, fails, or times out."""
    server = SorobanServer(RPC_URL)
    deadline = time.monotonic() + timeout_seconds
    try:
        while time.monotonic() < deadline:
            result = server.get_transaction(tx_hash)
            status = getattr(result, "status", None)
            if status == "SUCCESS":
                return
            if status == "FAILED":
                raise RuntimeError(f"Transaction {tx_hash} failed: {result}")
            time.sleep(3)
        raise TimeoutError(f"Transaction {tx_hash} was not confirmed in time")
    finally:
        server.close()


def main() -> None:
    keypair = Keypair.from_secret(os.environ["AURA_SECRET"])
    SESSION.headers.update({"Authorization": f"Bearer {authenticate(keypair)}"})
    stats = read_stats()
    shares = os.getenv("AURA_SHARES", "1")
    print(f"Vault share price: {stats['sharePrice']}")
    print(f"Estimated value of {shares} shares: {estimate_yield(shares, stats['sharePrice']):.7f}")

    amount = int(os.getenv("AURA_DEPOSIT", "0"))
    if amount <= 0:
        print("Set AURA_DEPOSIT to a positive smallest-unit amount to submit a deposit.")
        return
    tx_hash = submit_deposit(keypair, amount)
    print(f"Submitted deposit: {tx_hash}")
    wait_for_confirmation(tx_hash)
    print("Deposit confirmed")


if __name__ == "__main__":
    main()
