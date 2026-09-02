# Webhook Integration Guide

Aura Vault emits signed webhook events for every significant vault operation. This guide covers all event types, payload schemas, signature verification, retry behaviour, and local development tooling.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Registering an Endpoint](#2-registering-an-endpoint)
3. [Event Types](#3-event-types)
4. [Full Payload Examples](#4-full-payload-examples)
5. [HMAC-SHA256 Signature Verification](#5-hmac-sha256-signature-verification)
6. [Retry Behaviour and Idempotency](#6-retry-behaviour-and-idempotency)
7. [Rate Limiting](#7-rate-limiting)
8. [Test Endpoint for Development](#8-test-endpoint-for-development)
9. [Delivery Management API](#9-delivery-management-api)
10. [Security Best Practices](#10-security-best-practices)

---

## 1. Overview

The webhook system is implemented in `backend/src/webhook.ts` and mounted at `/api/webhooks`.

**How it works**

1. A vault operation fires on the Soroban contract (deposit, withdraw, harvest, etc.).
2. The backend indexer picks up the on-chain event and calls `dispatchEvent()`.
3. The system delivers a signed HTTP POST to every registered endpoint that subscribes to that event type.
4. Failed deliveries are retried with exponential backoff for up to 24 hours.

**Request headers sent with every delivery**

| Header | Description |
|--------|-------------|
| `Content-Type` | `application/json` |
| `X-Aura-Signature` | `sha256=<hmac-hex>` — HMAC-SHA256 of the raw request body |
| `X-Aura-Event` | Event type (e.g. `deposit`) |
| `X-Aura-Delivery` | Unique delivery UUID for idempotency |

**Your endpoint must return a `2xx` status within 10 seconds** to be considered a successful delivery. Any other status code or a timeout triggers a retry.

---

## 2. Registering an Endpoint

```http
POST /api/webhooks
Content-Type: application/json

{
  "url": "https://your-server.example.com/webhooks/aura",
  "secret": "<random 32+ byte string>",
  "events": ["deposit", "withdraw", "harvest"]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `url` | string | ✓ | HTTPS endpoint URL to receive events |
| `secret` | string | ✓ | Shared secret used to compute HMAC signatures |
| `events` | array | — | Event types to subscribe to. Empty array or omitted = subscribe to all |

**Response**

```json
{
  "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "url": "https://your-server.example.com/webhooks/aura",
  "events": ["deposit", "withdraw", "harvest"],
  "createdAt": "2026-08-28T16:30:00.000Z"
}
```

The `id` returned is your endpoint ID — save it to manage or delete the endpoint later.

---

## 3. Event Types

| Event type | Trigger |
|------------|---------|
| `deposit` | A caller deposits underlying tokens into the vault and receives shares |
| `withdraw` | A caller burns shares and redeems underlying tokens |
| `harvest` | A keeper injects yield tokens, increasing the share exchange rate |
| `pause` | The admin pauses all mutating vault operations |
| `unpause` | The admin resumes vault operations |
| `upgrade` | The contract Wasm is upgraded to a new hash |
| `suspicious` | The flash-loan balance guard fires — actual token balance differs from tracked state |

---

## 4. Full Payload Examples

Every webhook payload has the following envelope:

```json
{
  "id": "<event-uuid>",
  "type": "<event-type>",
  "payload": { ... },
  "createdAt": "<ISO-8601 timestamp>"
}
```

### `deposit`

```json
{
  "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "type": "deposit",
  "payload": {
    "caller": "GABC1234EXAMPLESTELLARADDRESS567890XYZXYZ",
    "amount": 1000000,
    "sharesMinted": 987654,
    "totalAssetsAfter": 52000000,
    "totalSharesAfter": 51342876,
    "txHash": "7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b",
    "ledger": 1234567
  },
  "createdAt": "2026-08-28T16:30:00.000Z"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `caller` | string | Stellar address of the depositor |
| `amount` | number | Underlying tokens deposited (raw integer, 7 decimal places) |
| `sharesMinted` | number | Vault shares issued to the caller |
| `totalAssetsAfter` | number | Total underlying tokens in the vault after this deposit |
| `totalSharesAfter` | number | Total shares outstanding after this deposit |
| `txHash` | string | Stellar transaction hash |
| `ledger` | number | Ledger sequence number |

### `withdraw`

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "type": "withdraw",
  "payload": {
    "caller": "GABC1234EXAMPLESTELLARADDRESS567890XYZXYZ",
    "sharesBurned": 500000,
    "tokensRedeemed": 510234,
    "totalAssetsAfter": 51489766,
    "totalSharesAfter": 50842876,
    "txHash": "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b",
    "ledger": 1234568
  },
  "createdAt": "2026-08-28T16:31:00.000Z"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `caller` | string | Stellar address of the withdrawer |
| `sharesBurned` | number | Shares redeemed and burned |
| `tokensRedeemed` | number | Underlying tokens returned to caller (includes accrued yield) |
| `totalAssetsAfter` | number | Vault total after withdrawal |
| `totalSharesAfter` | number | Total shares outstanding after burn |

### `harvest`

```json
{
  "id": "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
  "type": "harvest",
  "payload": {
    "keeper": "GKEEPER1EXAMPLESTELLARADDRESS567890XYZXYZ",
    "yieldAmount": 100000,
    "totalAssetsAfter": 52100000,
    "totalSharesUnchanged": 51342876,
    "newExchangeRate": "1.014682",
    "txHash": "3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d",
    "ledger": 1234570
  },
  "createdAt": "2026-08-28T16:32:00.000Z"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `keeper` | string | Address of the keeper that triggered the harvest |
| `yieldAmount` | number | Yield tokens injected into the vault |
| `totalAssetsAfter` | number | Vault total after yield injection |
| `totalSharesUnchanged` | number | Total shares (harvest never mints new shares) |
| `newExchangeRate` | string | Updated share-to-asset exchange rate (decimal string) |

### `pause`

```json
{
  "id": "9f7b5a3c-2d8e-4f1a-b6c9-0e4d2a8f3b7c",
  "type": "pause",
  "payload": {
    "admin": "GADMIN1EXAMPLESTELLARADDRESS567890XYZXYZ",
    "txHash": "5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f",
    "ledger": 1234580,
    "reason": "Emergency pause — investigating anomalous balance"
  },
  "createdAt": "2026-08-28T16:40:00.000Z"
}
```

### `unpause`

```json
{
  "id": "2e4a6c8e-0b2d-4f6a-8c0e-2a4b6c8d0e2f",
  "type": "unpause",
  "payload": {
    "admin": "GADMIN1EXAMPLESTELLARADDRESS567890XYZXYZ",
    "txHash": "7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b",
    "ledger": 1234590
  },
  "createdAt": "2026-08-28T17:00:00.000Z"
}
```

### `suspicious`

Fires when the flash-loan balance guard detects that the vault's actual on-chain token balance differs from its internally tracked state. **Treat this event as a critical alert.**

```json
{
  "id": "b3c4d5e6-f7a8-9b0c-1d2e-3f4a5b6c7d8e",
  "type": "suspicious",
  "payload": {
    "observedBalance": 50000000,
    "trackedBalance": 52000000,
    "discrepancy": -2000000,
    "caller": "GATTACKER1EXAMPLESTELLARADDRESS567890",
    "txHash": "9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d",
    "ledger": 1234599
  },
  "createdAt": "2026-08-28T17:05:00.000Z"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `observedBalance` | number | Actual token balance reported by the SEP-41 contract |
| `trackedBalance` | number | Balance tracked in vault storage (`total_assets`) |
| `discrepancy` | number | `observedBalance - trackedBalance` (negative = balance was drained) |
| `caller` | string | Address that triggered the guarded operation |

---

## 5. HMAC-SHA256 Signature Verification

Every request includes an `X-Aura-Signature` header of the form:

```
sha256=<hex-encoded HMAC-SHA256 of the raw request body>
```

**Always verify this signature before processing an event.** Use a constant-time comparison function to prevent timing attacks.

### JavaScript / Node.js

```javascript
const crypto = require("crypto");

function verifySignature(secret, rawBody, signatureHeader) {
  // signatureHeader is the full "sha256=abc123..." string
  const expected = "sha256=" + crypto
    .createHmac("sha256", secret)
    .update(rawBody)          // rawBody must be the raw bytes / Buffer
    .digest("hex");

  // Use timingSafeEqual to prevent timing attacks
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);

  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// Express example
app.post("/webhooks/aura", express.raw({ type: "application/json" }), (req, res) => {
  const signature = req.headers["x-aura-signature"];
  const isValid = verifySignature(process.env.WEBHOOK_SECRET, req.body, signature);

  if (!isValid) {
    return res.status(401).json({ error: "Invalid signature" });
  }

  const event = JSON.parse(req.body);
  console.log("Received event:", event.type, event.id);

  // Acknowledge immediately; process asynchronously
  res.status(200).json({ received: true });

  processEvent(event).catch(console.error);
});
```

### Python

```python
import hashlib
import hmac
from flask import Flask, request, jsonify

app = Flask(__name__)
WEBHOOK_SECRET = os.environ["WEBHOOK_SECRET"]

def verify_signature(secret: str, raw_body: bytes, signature_header: str) -> bool:
    """Constant-time HMAC-SHA256 verification."""
    expected = "sha256=" + hmac.new(
        secret.encode("utf-8"),
        raw_body,
        hashlib.sha256,
    ).hexdigest()
    return hmac.compare_digest(expected, signature_header)

@app.route("/webhooks/aura", methods=["POST"])
def handle_webhook():
    signature = request.headers.get("X-Aura-Signature", "")
    raw_body = request.get_data()  # read raw bytes before parsing JSON

    if not verify_signature(WEBHOOK_SECRET, raw_body, signature):
        return jsonify({"error": "Invalid signature"}), 401

    event = request.get_json()
    print(f"Received event: {event['type']} ({event['id']})")

    # Return 200 immediately; process in a background task
    process_event.delay(event)  # e.g. Celery task
    return jsonify({"received": True}), 200

def process_event(event: dict):
    handlers = {
        "deposit":    handle_deposit,
        "withdraw":   handle_withdraw,
        "harvest":    handle_harvest,
        "pause":      handle_pause,
        "unpause":    handle_unpause,
        "upgrade":    handle_upgrade,
        "suspicious": handle_suspicious,
    }
    handler = handlers.get(event["type"])
    if handler:
        handler(event)
```

### Go

```go
package main

import (
    "crypto/hmac"
    "crypto/sha256"
    "encoding/hex"
    "encoding/json"
    "fmt"
    "io"
    "net/http"
    "os"
    "strings"
)

func verifySignature(secret string, body []byte, signatureHeader string) bool {
    mac := hmac.New(sha256.New, []byte(secret))
    mac.Write(body)
    expected := "sha256=" + hex.EncodeToString(mac.Sum(nil))
    // hmac.Equal does constant-time comparison
    return hmac.Equal([]byte(expected), []byte(signatureHeader))
}

type WebhookEvent struct {
    ID        string                 `json:"id"`
    Type      string                 `json:"type"`
    Payload   map[string]interface{} `json:"payload"`
    CreatedAt string                 `json:"createdAt"`
}

func webhookHandler(w http.ResponseWriter, r *http.Request) {
    body, err := io.ReadAll(r.Body)
    if err != nil {
        http.Error(w, "cannot read body", http.StatusBadRequest)
        return
    }

    signature := r.Header.Get("X-Aura-Signature")
    secret := os.Getenv("WEBHOOK_SECRET")

    if !verifySignature(secret, body, signature) {
        http.Error(w, "invalid signature", http.StatusUnauthorized)
        return
    }

    var event WebhookEvent
    if err := json.Unmarshal(body, &event); err != nil {
        http.Error(w, "invalid json", http.StatusBadRequest)
        return
    }

    fmt.Printf("Received event: %s (%s)\n", event.Type, event.ID)

    // Acknowledge immediately; process asynchronously
    w.Header().Set("Content-Type", "application/json")
    w.WriteHeader(http.StatusOK)
    w.Write([]byte(`{"received":true}`))

    go processEvent(event)
}

func processEvent(event WebhookEvent) {
    switch event.Type {
    case "deposit":
        // handle deposit
    case "withdraw":
        // handle withdraw
    case "harvest":
        // handle harvest
    case "suspicious":
        // page on-call immediately
    }
}

func main() {
    http.HandleFunc("/webhooks/aura", webhookHandler)
    http.ListenAndServe(":8080", nil)
}
```

---

## 6. Retry Behaviour and Idempotency

### Retry schedule

When your endpoint returns a non-2xx status code or does not respond within 10 seconds, the system retries with exponential backoff:

| Attempt | Delay after previous failure |
|---------|------------------------------|
| 1 | 10 seconds |
| 2 | 30 seconds |
| 3 | 1 minute |
| 4 | 5 minutes |
| 5 | 15 minutes |
| 6 | 1 hour |
| 7 | 3 hours |
| 8 | 6 hours |

After 8 attempts the delivery is marked `failed`. No further retries occur. The total retry window is **24 hours** from the original event creation time.

### Idempotency

The same event may be delivered more than once (e.g., your endpoint timed out but still processed the request). Use the `X-Aura-Delivery` header — a unique UUID per delivery attempt — and the `event.id` — a stable UUID per event — to deduplicate:

```javascript
// Use event.id as the idempotency key in your database
const existing = await db.events.findOne({ externalId: event.id });
if (existing) {
  return res.status(200).json({ received: true, duplicate: true });
}
await db.events.create({ externalId: event.id, type: event.type, ... });
```

**Do not use `X-Aura-Delivery` as the idempotency key** — a new `X-Aura-Delivery` UUID is generated for each delivery attempt of the same event. Use `event.id` instead.

### Handling delivery failures in your endpoint

Best practices to avoid triggering retries unnecessarily:

1. **Return 200 immediately** after validating the signature. Process the event asynchronously (queue it to a worker).
2. **Never return 5xx on signature validation failure** — return 401 instead. A 5xx will cause a retry, wasting quota.
3. **Set a generous processing timeout** in your worker — the webhook system only waits 10 s for an HTTP 2xx acknowledgement, not for business logic to complete.

---

## 7. Rate Limiting

The system enforces a rate limit of **100 deliveries per 60 seconds** per registered endpoint. If your endpoint is hit more than 100 times in a 60-second window, excess deliveries are queued and re-attempted after the window resets. They are not dropped.

This limit exists to protect your endpoint from burst traffic during high vault activity (e.g., a whale deposit triggering many downstream notifications). If you expect higher throughput, contact the team to raise the limit.

---

## 8. Test Endpoint for Development

### Local testing with ngrok

Expose your local server to the internet for end-to-end testing without deploying:

```bash
# Start your webhook receiver
node webhook-receiver.js   # or equivalent

# Expose it publicly
ngrok http 8080
# Note the https URL: e.g. https://abc123.ngrok.io

# Register your ngrok URL as a webhook endpoint
curl -X POST http://localhost:3001/api/webhooks \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://abc123.ngrok.io/webhooks/aura",
    "secret": "dev-test-secret-minimum-32-bytes-long",
    "events": ["deposit", "withdraw", "harvest", "suspicious"]
  }'
```

### Manual event delivery with curl

Test your receiver by POSTing a signed payload directly:

```bash
# Compute the signature
BODY='{"id":"test-event-id","type":"deposit","payload":{"caller":"GTEST...","amount":1000000,"sharesMinted":1000000},"createdAt":"2026-08-28T16:30:00.000Z"}'
SECRET="dev-test-secret-minimum-32-bytes-long"
SIG="sha256=$(echo -n "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | awk '{print $2}')"

curl -X POST http://localhost:8080/webhooks/aura \
  -H "Content-Type: application/json" \
  -H "X-Aura-Signature: $SIG" \
  -H "X-Aura-Event: deposit" \
  -H "X-Aura-Delivery: $(uuidgen)" \
  -d "$BODY"
```

### Signature verification utility endpoint

The backend exposes a utility endpoint to verify an HMAC signature without registering an endpoint:

```http
POST /api/webhooks/verify
Content-Type: application/json

{
  "secret": "your-webhook-secret",
  "body": "{\"id\":\"...\",\"type\":\"deposit\",...}",
  "signature": "sha256=abc123..."
}
```

Response:
```json
{ "valid": true }
```

This endpoint is intended for local development only. Do not expose it to the public internet in production.

---

## 9. Delivery Management API

### List registered endpoints

```http
GET /api/webhooks
```

```json
[
  {
    "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "url": "https://your-server.example.com/webhooks/aura",
    "events": ["deposit", "withdraw"],
    "createdAt": "2026-08-28T16:30:00.000Z"
  }
]
```

### Get a specific endpoint

```http
GET /api/webhooks/:id
```

### Update an endpoint

```http
PATCH /api/webhooks/:id
Content-Type: application/json

{
  "url": "https://new-url.example.com/webhooks/aura",
  "events": ["deposit", "withdraw", "harvest", "suspicious"]
}
```

### Delete an endpoint

```http
DELETE /api/webhooks/:id
```

Returns `204 No Content`.

### View delivery history for an endpoint

```http
GET /api/webhooks/:id/deliveries
```

```json
[
  {
    "id": "d1e2f3a4-b5c6-7890-defg-hi1234567890",
    "endpointId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "eventId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    "status": "success",
    "attempts": 1,
    "nextRetryAt": null,
    "lastStatusCode": 200,
    "createdAt": "2026-08-28T16:30:01.000Z",
    "updatedAt": "2026-08-28T16:30:01.452Z"
  },
  {
    "id": "e2f3a4b5-c6d7-8901-efgh-ij2345678901",
    "endpointId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "eventId": "550e8400-e29b-41d4-a716-446655440000",
    "status": "pending",
    "attempts": 2,
    "nextRetryAt": "2026-08-28T16:35:00.000Z",
    "lastStatusCode": 503,
    "createdAt": "2026-08-28T16:31:00.000Z",
    "updatedAt": "2026-08-28T16:31:31.000Z"
  }
]
```

**Delivery statuses**

| Status | Meaning |
|--------|---------|
| `pending` | In progress — either initial attempt or waiting for next retry |
| `success` | Endpoint returned 2xx |
| `failed` | All retry attempts exhausted (24-hour window expired) |

---

## 10. Security Best Practices

1. **Always verify the HMAC signature** before processing any event. An unverified webhook is an unauthenticated HTTP POST from anyone.

2. **Use a strong, random secret** of at least 32 bytes. Generate one with:
   ```bash
   openssl rand -hex 32
   ```

3. **Rotate secrets periodically**. Update your registered endpoint with a `PATCH /api/webhooks/:id` call. Keep the old secret active for a short overlap period to avoid dropped deliveries during rotation.

4. **Validate the `type` field** before acting. Only process event types you explicitly handle; log and discard unknown types.

5. **Enforce timestamp freshness** for high-security environments. Check that `event.createdAt` is within an acceptable clock-skew window (e.g., ±5 minutes) to prevent replay attacks.

6. **Respond asynchronously**. Acknowledge the webhook with `200 OK` immediately, then process the event in a background queue. Long-running handlers that exceed 10 s will trigger a retry.

7. **Treat `suspicious` events as critical alerts**. Wire this event type directly to your on-call alerting system (PagerDuty, OpsGenie, etc.). A `suspicious` event means the flash-loan balance guard fired and vault operations have been halted.

8. **Use HTTPS only** for your webhook receiver URL. The system rejects `http://` URLs at registration time.

9. **Do not log the raw request body** in production logs — it may contain wallet addresses and financial data. Log only the `event.id`, `event.type`, and `X-Aura-Delivery` header.

10. **Implement a dead-letter queue** for events that fail all retries. The system does not re-queue events after the 24-hour window; you are responsible for recovering missed events from the delivery history API (`GET /api/webhooks/:id/deliveries`).
