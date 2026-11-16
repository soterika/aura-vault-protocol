/**
 * Aura Vault Protocol — Real-time Event Streaming Client (JavaScript / Node.js)
 *
 * Demonstrates subscribing to live vault events over Server-Sent Events (SSE).
 *
 * Usage:
 *   node client.js
 *
 * Dependencies:
 *   npm install eventsource
 */

const EventSource = require("eventsource");

const BASE_URL = process.env.AURA_API_URL || "https://api-testnet.auravault.finance";
const ACCESS_TOKEN = process.env.AURA_ACCESS_TOKEN || "test_token_replace_me";
const EVENT_TYPES = process.env.AURA_EVENT_TYPES || "deposit,withdraw,harvest,paused,unpaused";

const streamUrl = `${BASE_URL}/api/events/stream?types=${encodeURIComponent(EVENT_TYPES)}`;

console.log("-----------------------------------------------------------------");
console.log("🌟 Aura Vault Protocol — Real-Time Event Stream (Node.js)");
console.log(`🌐 Stream URL: ${streamUrl}`);
console.log("-----------------------------------------------------------------");

// Configure EventSource with Bearer authorization header
const eventSource = new EventSource(streamUrl, {
  headers: {
    Authorization: `Bearer ${ACCESS_TOKEN}`,
    Accept: "text/event-stream",
  },
});

let lastEventId = null;

// Initial handshake
eventSource.addEventListener("connected", (event) => {
  const data = JSON.parse(event.data);
  console.log(`[CONNECTED] Client ID: ${data.clientId} at ${data.connectedAt}`);
  console.log(`            Subscribed to: ${data.subscribedTypes.join(", ")}`);
});

// Deposit events
eventSource.addEventListener("deposit", (event) => {
  lastEventId = event.lastEventId || event.id;
  const data = JSON.parse(event.data);
  console.log("-----------------------------------------------------------------");
  console.log("💰 [EVENT: DEPOSIT]");
  console.log(`   Caller:         ${data.caller}`);
  console.log(`   Amount:         ${data.amount} base units`);
  console.log(`   Shares Minted:  ${data.newShares}`);
  console.log(`   Total Shares:   ${data.newTotalShares}`);
  console.log(`   Total Assets:   ${data.newTotalDeposited}`);
  console.log(`   Ledger:         ${data.ledger}`);
  console.log(`   Tx Hash:        ${data.txHash}`);
});

// Withdrawal events
eventSource.addEventListener("withdraw", (event) => {
  lastEventId = event.lastEventId || event.id;
  const data = JSON.parse(event.data);
  console.log("-----------------------------------------------------------------");
  console.log("💸 [EVENT: WITHDRAW]");
  console.log(`   Caller:         ${data.caller}`);
  console.log(`   Amount:         ${data.amount} base units`);
  console.log(`   Shares Burned:  ${data.sharesBurned}`);
  console.log(`   Remaining:      ${data.remainingShares}`);
  console.log(`   Ledger:         ${data.ledger}`);
});

// Harvest events
eventSource.addEventListener("harvest", (event) => {
  lastEventId = event.lastEventId || event.id;
  const data = JSON.parse(event.data);
  console.log("-----------------------------------------------------------------");
  console.log("🌾 [EVENT: HARVEST]");
  console.log(`   Keeper:         ${data.caller}`);
  console.log(`   Compounded:     ${data.harvestedAmount}`);
  console.log(`   Fee Collected:  ${data.feeAmount}`);
  console.log(`   Share Price:    ${data.currentSharePrice}`);
  console.log(`   New APY:        ${data.apy}%`);
});

// Emergency circuit breaker pause events
eventSource.addEventListener("paused", (event) => {
  const data = JSON.parse(event.data);
  console.warn("⚠️  [EVENT: PAUSED]");
  console.warn(`   Admin:          ${data.admin}`);
  console.warn(`   Reason:         ${data.reason}`);
  console.warn(`   Countdown:      ${data.countdownSeconds || "N/A"} seconds`);
});

eventSource.addEventListener("unpaused", (event) => {
  const data = JSON.parse(event.data);
  console.log("✅ [EVENT: UNPAUSED]");
  console.log(`   Admin:          ${data.admin}`);
});

// Keepalive heartbeat
eventSource.addEventListener("heartbeat", (event) => {
  const data = JSON.parse(event.data);
  // Optional debug logging for ping
  // console.debug(`[HEARTBEAT] Ping at ${new Date(data.timestamp).toISOString()}`);
});

// Error handling & reconnection
eventSource.onerror = (err) => {
  if (eventSource.readyState === EventSource.CONNECTING) {
    console.log(`[DISCONNECTED] Reconnecting to stream... (Last-Event-ID: ${lastEventId || "none"})`);
  } else {
    console.error("[ERROR] EventSource error:", err);
  }
};

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\nClosing SSE stream connection...");
  eventSource.close();
  process.exit(0);
});
