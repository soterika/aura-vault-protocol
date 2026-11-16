#!/usr/bin/env python3
"""
Aura Vault Protocol — Real-Time Event Streaming Client (Python)

Subscribes to live contract events (deposit, withdraw, harvest, pause)
over Server-Sent Events (SSE) with Bearer token authentication, event filtering,
gap-free reconnection, and structured JSON parsing.

Requirements:
    pip install requests sseclient-py

Usage:
    python client.py
    # or with environment variables:
    AURA_API_URL=https://api-testnet.auravault.finance AURA_ACCESS_TOKEN=<token> python client.py
"""

import json
import logging
import os
import sys
import time
import requests
from sseclient import SSEClient

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("AuraVaultClient")

BASE_URL = os.getenv("AURA_API_URL", "https://api-testnet.auravault.finance")
STREAM_URL = f"{BASE_URL}/api/events/stream"
ACCESS_TOKEN = os.getenv("AURA_ACCESS_TOKEN", "test_token_replace_me")
EVENT_TYPES = os.getenv("AURA_EVENT_TYPES", "deposit,withdraw,harvest,paused,unpaused")


def handle_connected(payload: dict) -> None:
    logger.info("Connected to Aura Vault stream. Client ID: %s", payload.get("clientId"))
    logger.info("Subscribed types: %s", ", ".join(payload.get("subscribedTypes", [])))


def handle_deposit(payload: dict) -> None:
    logger.info(
        "💰 [DEPOSIT] Caller: %s | Amount: %s | Shares: %s | Ledger: %s",
        payload.get("caller"),
        payload.get("amount"),
        payload.get("newShares"),
        payload.get("ledger"),
    )


def handle_withdraw(payload: dict) -> None:
    logger.info(
        "💸 [WITHDRAW] Caller: %s | Amount: %s | Burned: %s | Remaining: %s",
        payload.get("caller"),
        payload.get("amount"),
        payload.get("sharesBurned"),
        payload.get("remainingShares"),
    )


def handle_harvest(payload: dict) -> None:
    logger.info(
        "🌾 [HARVEST] Keeper: %s | Compounded: %s | Fee: %s | APY: %s%%",
        payload.get("caller"),
        payload.get("harvestedAmount"),
        payload.get("feeAmount"),
        payload.get("apy"),
    )


def handle_paused(payload: dict) -> None:
    logger.warning(
        "⚠️  [CIRCUIT BREAKER PAUSE] Admin: %s | Reason: %s",
        payload.get("admin"),
        payload.get("reason"),
    )


def handle_unpaused(payload: dict) -> None:
    logger.info("✅ [UNPAUSED] Vault unpaused by admin: %s", payload.get("admin"))


DISPATCHER = {
    "connected": handle_connected,
    "deposit": handle_deposit,
    "withdraw": handle_withdraw,
    "harvest": handle_harvest,
    "paused": handle_paused,
    "unpaused": handle_unpaused,
}


def stream_events() -> None:
    headers = {
        "Authorization": f"Bearer {ACCESS_TOKEN}",
        "Accept": "text/event-stream",
    }
    params = {
        "types": EVENT_TYPES,
    }

    last_event_id = None
    backoff = 1.0
    max_backoff = 30.0

    logger.info("Starting Aura Vault SSE Client...")
    logger.info("Connecting to %s", STREAM_URL)

    while True:
        try:
            req_headers = dict(headers)
            if last_event_id:
                req_headers["Last-Event-ID"] = last_event_id

            response = requests.get(
                STREAM_URL,
                headers=req_headers,
                params=params,
                stream=True,
                timeout=(10, 60),
            )

            if response.status_code == 401:
                logger.error("Authentication failed: token expired or invalid (HTTP 401).")
                sys.exit(1)
            elif response.status_code == 429:
                logger.warning("Rate limit hit (HTTP 429). Waiting 15 seconds...")
                time.sleep(15)
                continue

            response.raise_for_status()
            client = SSEClient(response)
            backoff = 1.0  # Reset backoff on successful connection

            for event in client.events():
                if event.id:
                    last_event_id = event.id

                event_type = event.event or "message"
                if event_type == "heartbeat":
                    continue  # Keepalive ping

                if not event.data:
                    continue

                try:
                    payload = json.loads(event.data)
                except json.JSONDecodeError:
                    logger.warning("Could not decode event JSON: %s", event.data)
                    continue

                handler = DISPATCHER.get(event_type)
                if handler:
                    handler(payload)
                else:
                    logger.debug("Received unhandled event [%s]: %s", event_type, payload)

        except requests.exceptions.RequestException as exc:
            logger.warning("Connection lost (%s). Reconnecting in %.1fs...", exc, backoff)
            time.sleep(backoff)
            backoff = min(backoff * 2, max_backoff)
        except KeyboardInterrupt:
            logger.info("Shutting down SSE client on user interrupt.")
            break


if __name__ == "__main__":
    stream_events()
