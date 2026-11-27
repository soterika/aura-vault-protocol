# Analytics Integration

Event tracking specification for the Aura Vault Protocol frontend.

---

## Consent & GDPR Compliance

All analytics collection requires explicit user opt-in before any event is sent.
Consent state is stored in `localStorage` under the key `aura_analytics_consent` and
checked on every page load before the analytics SDK is initialised.

```ts
// analytics/consent.ts
export type ConsentState = 'granted' | 'denied' | 'pending';

export function getConsent(): ConsentState {
  const raw = localStorage.getItem('aura_analytics_consent');
  if (raw === 'granted' || raw === 'denied') return raw;
  return 'pending';
}

export function setConsent(state: 'granted' | 'denied'): void {
  localStorage.setItem('aura_analytics_consent', state);
  // Re-initialise or tear down SDK based on new state
  state === 'granted' ? initAnalytics() : teardownAnalytics();
}
```

Do not load the analytics SDK bundle until consent is `granted`.

---

## Initialisation

```ts
// analytics/index.ts
import { getConsent } from './consent';

export function initAnalytics(): void {
  if (getConsent() !== 'granted') return;

  // Replace with your chosen SDK (e.g. Segment, PostHog, Plausible)
  analytics.load(process.env.ANALYTICS_WRITE_KEY);
  analytics.page(); // record initial page view
}
```

Call `initAnalytics()` once at app bootstrap.

---

## Page Views

Page views are tracked automatically on every route change.

```ts
analytics.page({
  title: document.title,
  url: window.location.href,
  path: window.location.pathname,
});
```

---

## Event Catalogue

All events follow the schema `{ event: string, properties: Record<string, unknown> }`.
Properties must never include wallet private keys, seed phrases, or raw addresses beyond
the first 6 / last 4 characters.

### Wallet

| Event | When | Properties |
|---|---|---|
| `Wallet Connected` | User connects wallet | `wallet_type`, `network` |
| `Wallet Disconnected` | User disconnects | `wallet_type` |

### Vault Actions

| Event | When | Properties |
|---|---|---|
| `Deposit Initiated` | User clicks Deposit | `amount_raw` (i128 string), `network` |
| `Deposit Confirmed` | Transaction confirmed | `amount_raw`, `shares_minted`, `tx_hash` |
| `Deposit Failed` | Transaction rejected/failed | `amount_raw`, `error_code`, `error_name` |
| `Withdraw Initiated` | User clicks Withdraw | `shares_raw` (i128 string), `network` |
| `Withdraw Confirmed` | Transaction confirmed | `shares_raw`, `amount_redeemed`, `tx_hash` |
| `Withdraw Failed` | Transaction rejected/failed | `shares_raw`, `error_code`, `error_name` |
| `Harvest Triggered` | Keeper calls harvest | `yield_amount`, `tx_hash` |

### Navigation

| Event | When | Properties |
|---|---|---|
| `Page Viewed` | Every route change | `page_name`, `referrer` |
| `Docs Opened` | User opens docs | `section` |

---

## Custom User Properties

Set once after wallet connect; update on network switch.

```ts
analytics.identify(maskedAddress, {
  wallet_type: 'freighter',
  network: 'mainnet',
  first_seen: new Date().toISOString(),
});

// maskedAddress = `${addr.slice(0,6)}...${addr.slice(-4)}`
```

---

## A/B Testing

Feature flags and experiment assignment are tracked as user traits so that
downstream analysis can segment by variant.

```ts
analytics.identify(maskedAddress, {
  experiment_deposit_flow: 'variant_b', // set by your feature flag SDK
});
```

Track conversion per variant using the standard event catalogue above.

---

## Performance Budget

- Analytics SDK must be loaded with `defer` or dynamic `import()` — never block the critical path.
- Total analytics payload per session must stay under 20 KB transferred.
- Use batching (flush interval ≤ 5 s) to minimise network requests.

---

## Portfolio Export Field Semantics

The Portfolio Analyzer (`frontend/src/components/PortfolioAnalyzer.tsx`, using `parseAddressCsv` from `frontend/src/lib/portfolioCsv.ts`) exports position analysis results as a UTF-8 CSV file with a UTF-8 BOM (`\uFEFF`), CRLF (`\r\n`) line endings, and MIME type `text/csv;charset=utf-8`.

### Filename & Timestamp Format

- **Filename pattern:** `aura-position-analysis-YYYY-MM-DD.csv`
- **Timestamp format & time zone:** `YYYY-MM-DD` (ISO 8601 calendar date in **UTC**, derived from `new Date().toISOString().slice(0, 10)`). Individual rows do not include a timestamp column.

### Column Definitions

The header row is `address,shares,estimated_value,estimated_yield,error` (unquoted). Every data cell is double-quoted (`"..."`), with any internal double quotes escaped as `""`.

| Column | Units | Decimal Representation | Blank / Unavailable | Notes |
|---|---|---|---|---|
| `address` | Stellar public key (`G...`, 56-char StrKey) | N/A (string) | Never blank for valid input | Deduplicated address from the uploaded CSV |
| `shares` | Vault shares (`10^7` stroops per share) | Locale-formatted integer + `.` + 7 fractional digits | `"—"` (em-dash, `U+2014`) | Formatted by `formatTokens()` |
| `estimated_value` | Underlying vault asset (`10^7` stroops per unit) | Locale-formatted integer + `.` + 7 fractional digits | `"—"` (em-dash, `U+2014`) | Computed from `shares` and current vault `sharePrice` |
| `estimated_yield` | Underlying vault asset / year (`10^7` stroops per unit) | Locale-formatted integer + `.` + 7 fractional digits | `"—"` (em-dash, `U+2014`) | Annualized estimate from latest 30-day APY (`apy30d`), not realized return |
| `error` | N/A (string) | N/A (string) | `""` (empty string) | Populated when address validation or balance lookup fails |

### Example Exported CSV

```csv
address,shares,estimated_value,estimated_yield,error
"GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN","1,250.0000000","1,312.5000000","65.6250000",""
"GBINVALIDADDRESS0000000000000000000000000000000000000000","—","—","—","Invalid Stellar address"
```
