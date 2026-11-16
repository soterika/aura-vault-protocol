# Real-Time Event Streaming (SSE) Client Examples

This directory contains standalone example client implementations in JavaScript (Node.js) and Python demonstrating how to subscribe to live vault events from the Aura Vault backend using **Server-Sent Events (SSE)**.

## Endpoint

- **Path**: `GET /api/events/stream`
- **Protocol**: Server-Sent Events (SSE)
- **Content-Type**: `text/event-stream; charset=utf-8`

---

## JavaScript / Node.js Client

### Installation

```bash
npm install eventsource
```

### Running the Client

```bash
export AURA_API_URL="https://api-testnet.auravault.finance"
export AURA_ACCESS_TOKEN="<your-jwt-token>"
node client.js
```

---

## Python Client

### Installation

```bash
pip install requests sseclient-py
```

### Running the Client

```bash
export AURA_API_URL="https://api-testnet.auravault.finance"
export AURA_ACCESS_TOKEN="<your-jwt-token>"
python client.py
```

---

## Supported Events

| Event Name | Description | Key Payload Fields |
|---|---|---|
| `connected` | Initial connection handshake | `clientId`, `connectedAt`, `subscribedTypes` |
| `deposit` | User deposits tokens & receives shares | `caller`, `amount`, `newShares`, `newTotalShares`, `txHash` |
| `withdraw` | User redeems shares for tokens | `caller`, `amount`, `sharesBurned`, `remainingShares` |
| `harvest` | Automated keeper compounds yield | `caller`, `harvestedAmount`, `feeAmount`, `apy` |
| `paused` | Emergency circuit-breaker pause | `admin`, `reason`, `countdownSeconds` |
| `unpaused` | Vault resumed by admin | `admin` |
| `heartbeat` | Keep-alive ping (every 15s) | `timestamp`, `activeConnections` |
