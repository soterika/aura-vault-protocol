# Mobile App Developer Guide — React Native / Expo

This guide walks you through setting up, running, and extending the Aura Vault mobile app. It is written for developers who are new to the project.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Project Structure](#2-project-structure)
3. [Environment Setup](#3-environment-setup)
4. [Running the App](#4-running-the-app)
5. [Architecture Overview](#5-architecture-overview)
6. [API Authentication from Mobile](#6-api-authentication-from-mobile)
7. [Wallet Integration](#7-wallet-integration)
8. [Push Notifications](#8-push-notifications)
9. [Offline Support](#9-offline-support)
10. [Testing](#10-testing)
11. [Release & App Store Submission](#11-release--app-store-submission)
12. [Troubleshooting](#12-troubleshooting)

---

## 1. Prerequisites

Install the following tools before starting:

| Tool | Version | Install |
|---|---|---|
| Node.js | 22 LTS | https://nodejs.org |
| npm | 10+ | Bundled with Node |
| Expo CLI | latest | `npm install -g expo-cli` |
| EAS CLI | latest | `npm install -g eas-cli` |
| Watchman (macOS) | latest | `brew install watchman` |
| Xcode (iOS, macOS only) | 15+ | Mac App Store |
| Android Studio (Android) | latest | https://developer.android.com/studio |
| Java JDK (Android) | 17 | Bundled with Android Studio |

### iOS Simulator (macOS only)

After installing Xcode, install a simulator:

```
Xcode → Settings → Platforms → iOS 17 → Download
```

Open the simulator:
```bash
open -a Simulator
```

### Android Emulator

In Android Studio:
```
Tools → Device Manager → Create Device → Pixel 8 → API 34 → Finish
```

Start the emulator from Device Manager or:
```bash
$ANDROID_HOME/emulator/emulator -avd Pixel_8_API_34
```

### Verify setup

```bash
node --version    # v22.x.x
npx expo --version
npx eas --version
```

---

## 2. Project Structure

```
mobile/
├── app.json                 # Expo config (bundle IDs, permissions, plugins)
├── package.json             # Dependencies
└── src/
    ├── index.tsx            # App entry point — renders AppNavigator
    ├── navigation/
    │   └── AppNavigator.tsx # React Navigation stack + deep link config
    ├── screens/
    │   ├── HomeScreen.tsx   # Dashboard: TVL, Deposit, Withdraw buttons
    │   └── SettingsScreen.tsx # User preferences
    └── services/
        ├── auth.ts          # Login, logout, token refresh, biometric auth
        └── offline.ts       # Offline queue for failed requests
```

### Key dependencies (`mobile/package.json`)

| Package | Purpose |
|---|---|
| `expo ~52` | Managed workflow runtime |
| `expo-secure-store` | Encrypted token storage (Keychain / Keystore) |
| `expo-local-authentication` | Face ID / fingerprint biometric auth |
| `expo-notifications` | Push notification registration and handling |
| `expo-linking` | Deep link parsing |
| `@react-navigation/native` + `native-stack` | Screen navigation |
| `@tanstack/react-query` | Server state management and caching |

---

## 3. Environment Setup

### 3.1 Install dependencies

```bash
cd mobile
npm install
```

### 3.2 Configure environment variables

The app reads `EXPO_PUBLIC_*` variables at build time. Create a `.env` file in `mobile/`:

```bash
# mobile/.env
EXPO_PUBLIC_API_URL=http://localhost:3001
```

For staging/production, set the variable in your EAS build profile (see [Section 11](#11-release--app-store-submission)).

> **Security:** Never put secrets (JWT keys, API keys) in `EXPO_PUBLIC_*` variables — they are embedded in the bundle and visible to anyone who unpacks it. Tokens are fetched at runtime and stored in `expo-secure-store`.

### 3.3 Start the backend

The mobile app communicates with the same backend API as the web frontend. Start it locally:

```bash
cd backend
cp .env.example .env   # fill in DATABASE_URL and JWT_SECRET at minimum
npm install
npm run dev            # listens on :3001
```

### 3.4 iOS-specific: install CocoaPods

```bash
cd mobile/ios    # only exists after `npx expo prebuild`
pod install
```

---

## 4. Running the App

### Start the Expo dev server

```bash
cd mobile
npx expo start
```

This opens the **Expo DevTools** in your browser and prints a QR code.

### Run on a device or simulator

| Target | Command |
|---|---|
| iOS Simulator | Press `i` in the terminal, or `npx expo start --ios` |
| Android Emulator | Press `a` in the terminal, or `npx expo start --android` |
| Physical device | Install **Expo Go** (iOS / Android) and scan the QR code |

> **Note:** Biometric authentication and push notifications do not work inside Expo Go. Use a [development build](#development-build) for those features.

### Development build (recommended for full feature testing)

A development build is a native binary with the Expo dev client embedded, enabling all native modules:

```bash
# Build locally (requires Xcode / Android Studio)
npx expo run:ios
npx expo run:android

# Or build in the cloud with EAS
eas build --profile development --platform ios
eas build --profile development --platform android
```

---

## 5. Architecture Overview

```
┌─────────────────────────────────┐
│         AppNavigator            │  React Navigation (native stack)
│  Home → Deposit / Withdraw      │  Deep links: aura-vault://<screen>
│  Settings                       │
└──────────────┬──────────────────┘
               │
┌──────────────▼──────────────────┐
│       Screen Components         │  React + hooks
│  useQuery (TanStack Query)       │  Server state
│  SecureStore tokens             │  Auth state
└──────────────┬──────────────────┘
               │ fetch()
┌──────────────▼──────────────────┐
│   services/auth.ts              │  Login, refresh, logout, biometrics
│   services/offline.ts           │  Offline queue
└──────────────┬──────────────────┘
               │ HTTPS REST
┌──────────────▼──────────────────┐
│   Backend API (:3001)           │  Express / JWT / Redis
│   POST /api/auth/login          │
│   POST /api/auth/refresh        │
│   GET  /api/v1/vault/stats      │
└─────────────────────────────────┘
```

### State management

- **Server state** — `@tanstack/react-query` handles fetching, caching, and background refetching of API data.
- **Auth state** — tokens are stored in `expo-secure-store` (encrypted, hardware-backed on supported devices). No in-memory state is relied on for auth.
- **Navigation state** — `@react-navigation/native` with a native stack navigator for smooth platform-native transitions.

---

## 6. API Authentication from Mobile

Authentication flow is implemented in `mobile/src/services/auth.ts`.

### 6.1 Login

```typescript
import { login } from './services/auth';

const success = await login('GABC...XYZ');  // Stellar wallet address
```

Internally this calls `POST /api/auth/login`:

```bash
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{ "walletAddress": "GABC...XYZ", "deviceId": "mobile" }'
```

Response:
```json
{
  "success": true,
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiJ9...",
    "refreshToken": "eyJhbGciOiJIUzI1NiJ9...",
    "expiresIn": 900
  }
}
```

Both tokens are stored in `expo-secure-store`:
- `aura_access_token` — 15-minute JWT, sent as `Authorization: Bearer <token>` on every API request
- `aura_refresh_token` — 30-day JWT used to obtain a new access token

### 6.2 Authenticated requests

```typescript
import { getAccessToken, refreshTokens } from './services/auth';

async function apiFetch(path: string) {
  let token = await getAccessToken();

  const res = await fetch(`${API_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (res.status === 401) {
    // Access token expired — attempt refresh
    const refreshed = await refreshTokens();
    if (!refreshed) {
      // Refresh also expired — redirect to login
      return null;
    }
    token = await getAccessToken();
    return fetch(`${API_URL}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  }

  return res;
}
```

### 6.3 Token refresh

Refresh tokens are automatically rotated on use — the old refresh token is invalidated and a new pair is issued:

```typescript
import { refreshTokens } from './services/auth';

const success = await refreshTokens();  // returns false if refresh token expired
```

### 6.4 Biometric authentication

Before displaying sensitive vault data, gate the screen with biometric auth:

```typescript
import { authenticateWithBiometrics } from './services/auth';

const authenticated = await authenticateWithBiometrics();
if (!authenticated) {
  navigation.goBack();
}
```

This uses Face ID on iOS and fingerprint / face unlock on Android via `expo-local-authentication`. Falls back gracefully if hardware is unavailable.

### 6.5 Logout

```typescript
import { logout } from './services/auth';

await logout();
// Calls POST /api/auth/logout to blacklist the access token server-side
// Deletes both tokens from SecureStore
```

---

## 7. Wallet Integration

The mobile app supports two wallet interaction patterns depending on whether the user has a mobile-native Stellar wallet installed.

### 7.1 Deep link flow (recommended)

The app uses `expo-linking` and a custom URL scheme (`aura-vault://`) to request transaction signing from an external wallet app:

```typescript
import * as Linking from 'expo-linking';

// Build a deep link to the wallet with the XDR transaction payload
const xdr = 'AAAAAgAAAAA...';  // base64-encoded Stellar XDR
const walletUrl = `freighter://sign?xdr=${encodeURIComponent(xdr)}&callback=aura-vault://signed`;

await Linking.openURL(walletUrl);
```

The wallet app signs the transaction and redirects back to `aura-vault://signed?signedXdr=<xdr>`. Handle the incoming link in `AppNavigator.tsx`:

```typescript
// AppNavigator.tsx — already configured
const linking: LinkingOptions<RootStackParamList> = {
  prefixes: ['aura-vault://', 'https://auravault.app'],
  config: {
    screens: {
      Home: '',
      Deposit: 'deposit',
      Withdraw: 'withdraw',
      Settings: 'settings',
    },
  },
};
```

Listen for the signed XDR callback:

```typescript
import * as Linking from 'expo-linking';
import { useEffect } from 'react';

useEffect(() => {
  const subscription = Linking.addEventListener('url', ({ url }) => {
    const { queryParams } = Linking.parse(url);
    if (queryParams?.signedXdr) {
      submitTransaction(queryParams.signedXdr as string);
    }
  });
  return () => subscription.remove();
}, []);
```

### 7.2 WalletConnect / in-app signing (future)

For wallets that support WalletConnect, the signed XDR can be obtained without leaving the app. This integration is planned but not yet implemented.

### 7.3 Freighter mobile pairing

Freighter's mobile app supports deep link pairing. Initiate via:

```
freighter://connect?callback=aura-vault://connected&appName=AuraVault&appUrl=https://auravault.app
```

On successful pairing, Freighter redirects to `aura-vault://connected?publicKey=GABC...XYZ`.

---

## 8. Push Notifications

Push notifications are handled by `expo-notifications`. The app requests permission and registers a device token at login.

### 8.1 Register for notifications

```typescript
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';

async function registerForPushNotifications(): Promise<string | null> {
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') return null;

  const token = (
    await Notifications.getExpoPushTokenAsync({
      projectId: Constants.expoConfig?.extra?.eas?.projectId,
    })
  ).data;

  return token;
}
```

### 8.2 Send the token to the backend

After obtaining the push token, register it with the API:

```typescript
const pushToken = await registerForPushNotifications();
if (pushToken) {
  await fetch(`${API_URL}/api/users/preferences`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${await getAccessToken()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ pushToken }),
  });
}
```

### 8.3 Handle incoming notifications

```typescript
import * as Notifications from 'expo-notifications';

// Configure how notifications are presented while the app is foregrounded
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: false,
    shouldSetBadge: true,
  }),
});

// Navigate on notification tap
Notifications.addNotificationResponseReceivedListener((response) => {
  const screen = response.notification.request.content.data?.screen as string;
  if (screen) navigation.navigate(screen as any);
});
```

### 8.4 Notification categories

| Event | Title | Body |
|---|---|---|
| Harvest completed | "Yield harvested 🌾" | "Your vault earned +X% APY" |
| Deposit confirmed | "Deposit confirmed ✅" | "X XLM deposited successfully" |
| Withdrawal ready | "Withdrawal ready 💸" | "X XLM is ready to claim" |
| Vault paused | "Vault paused ⚠️" | "Operations temporarily halted" |

---

## 9. Offline Support

`mobile/src/services/offline.ts` provides a simple request queue that stores failed API calls when the device is offline and replays them on reconnection.

```typescript
import { queueRequest, flushQueue } from './services/offline';

// Queue a failed request
await queueRequest({
  url: `${API_URL}/api/v1/vault/stats`,
  method: 'GET',
  headers: { Authorization: `Bearer ${token}` },
});

// Flush queue when connectivity is restored
NetInfo.addEventListener((state) => {
  if (state.isConnected) flushQueue();
});
```

---

## 10. Testing

### Unit tests

```bash
cd mobile
npm test
```

Tests use **Jest** and **@testing-library/react-native**. Test files live next to the files they test (`auth.test.ts`, etc.) or in `__tests__/`.

### Example: testing login

```typescript
// services/auth.test.ts
import { login } from './auth';

global.fetch = jest.fn(() =>
  Promise.resolve({
    ok: true,
    json: () => Promise.resolve({
      accessToken: 'test-access',
      refreshToken: 'test-refresh',
    }),
  } as Response)
);

it('stores tokens on successful login', async () => {
  const result = await login('GABC...XYZ');
  expect(result).toBe(true);
});
```

### E2E tests (Detox — planned)

Detox E2E tests are planned. The configuration will live in `mobile/e2e/`.

---

## 11. Release & App Store Submission

Releases use **EAS Build** and **EAS Submit**.

### 11.1 Configure EAS

```bash
cd mobile
eas login                  # authenticate with your Expo account
eas build:configure        # creates eas.json
```

`eas.json` build profiles:

```json
{
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal"
    },
    "preview": {
      "distribution": "internal",
      "env": {
        "EXPO_PUBLIC_API_URL": "https://api-staging.auravault.app"
      }
    },
    "production": {
      "env": {
        "EXPO_PUBLIC_API_URL": "https://api.auravault.app"
      }
    }
  }
}
```

### 11.2 Build for production

```bash
# iOS (requires Apple Developer account)
eas build --profile production --platform ios

# Android (requires Google Play account)
eas build --profile production --platform android
```

Build output:
- iOS: `.ipa` file
- Android: `.aab` (App Bundle)

### 11.3 Submit to stores

```bash
# App Store Connect
eas submit --platform ios --latest

# Google Play
eas submit --platform android --latest
```

### 11.4 App store metadata

| Field | Value |
|---|---|
| iOS Bundle ID | `com.auravault.app` |
| Android Package | `com.auravault.app` |
| App name | `Aura Vault` |
| Category | Finance |
| Minimum iOS | 16.0 |
| Minimum Android | API 26 (Android 8.0) |

### 11.5 Required permissions

| Permission | Platform | Reason |
|---|---|---|
| Face ID / Touch ID | iOS | Biometric authentication |
| Biometrics (USE_BIOMETRIC, USE_FINGERPRINT) | Android | Biometric authentication |
| Push notifications | iOS + Android | Harvest and transaction alerts |

---

## 12. Troubleshooting

### `Metro bundler` not starting

```bash
# Clear Metro cache
npx expo start --clear
```

### iOS build fails with CocoaPods error

```bash
cd mobile
npx expo prebuild --clean
cd ios && pod install --repo-update
```

### Android build fails with Gradle error

```bash
cd mobile/android
./gradlew clean
```

### Biometric auth not working

Biometrics require a **development build** — they do not work inside Expo Go. Run:
```bash
npx expo run:ios    # or run:android
```

### API requests failing on physical device

Your phone cannot reach `localhost`. Set `EXPO_PUBLIC_API_URL` to your machine's LAN IP:

```bash
# Find your IP
ipconfig getifaddr en0   # macOS
ip addr show             # Linux

# Update mobile/.env
EXPO_PUBLIC_API_URL=http://192.168.1.42:3001
```

Make sure your backend binds to `0.0.0.0` (it does by default with Express).

### Expo Go QR code not scanning

Ensure your phone and development machine are on the same Wi-Fi network. If behind a VPN, disable it or use tunnel mode:
```bash
npx expo start --tunnel
```

### `SecureStore` errors on Android emulator

The Android emulator does not have a hardware keystore. SecureStore falls back to software encryption automatically — this is expected behavior and safe for development.

---

## Related Documentation

- [API Reference](./api-reference.md)
- [Wallet Integration Guide](./wallet-integration.md)
- [Getting Started (Backend)](./getting-started.md)
- [OpenAPI Spec](./openapi.yaml)
