# Aura Vault — Mobile App

React Native mobile client for the Aura Vault Protocol, built with Expo 52 and React Native 0.76.

---

## Table of Contents

1. [Overview](#1-overview)
2. [App Setup and Build](#2-app-setup-and-build)
3. [Project Structure](#3-project-structure)
4. [Wallet Connection on Mobile (Deep Link Handling)](#4-wallet-connection-on-mobile-deep-link-handling)
5. [Push Notification Setup (FCM / APNs)](#5-push-notification-setup-fcm--apns)
6. [Biometric Authentication](#6-biometric-authentication)
7. [Offline Queue and Data Caching](#7-offline-queue-and-data-caching)
8. [Backend API Integration](#8-backend-api-integration)
9. [App Store / Play Store Submission Checklist](#9-app-store--play-store-submission-checklist)
10. [Troubleshooting](#10-troubleshooting)

---

## 1. Overview

The mobile app gives users native iOS and Android access to their Aura Vault positions. It connects to the same backend API as the web frontend (`backend/` — port 3001) and interacts with the Stellar Soroban contract through that API layer rather than directly via the Soroban RPC.

**Key capabilities**

| Feature | Implementation |
|---------|---------------|
| View TVL and share balance | Backend REST API + React Query |
| Deposit / Withdraw | Backend API calls, optimistic UI |
| Biometric gate | `expo-local-authentication` (Face ID, Touch ID, Android biometrics) |
| JWT session storage | `expo-secure-store` (hardware-backed key store) |
| Push notifications | `expo-notifications` (Expo Push + APNs / FCM) |
| Deep links | `expo-linking` + React Navigation linking config |
| Offline queueing | `expo-secure-store`-backed pending transaction queue |

**App identifiers**

| Platform | Value |
|----------|-------|
| iOS bundle ID | `com.auravault.app` |
| Android package | `com.auravault.app` |
| Expo slug | `aura-vault` |
| URL scheme | `aura-vault://` |
| Universal link domain | `https://auravault.app` |

---

## 2. App Setup and Build

### Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Node.js | 18 LTS or 20 LTS | [nodejs.org](https://nodejs.org/) |
| Expo CLI | Latest | `npm install -g expo-cli` |
| EAS CLI | Latest | `npm install -g eas-cli` |
| Xcode | 15+ | Mac App Store (iOS builds only) |
| Android Studio | Hedgehog+ | [developer.android.com](https://developer.android.com/studio) |
| CocoaPods | 1.14+ | `sudo gem install cocoapods` (iOS only) |

### Local development setup

```bash
cd mobile
npm install

# iOS (macOS only)
npx pod-install          # install native iOS dependencies

# Start Expo dev server
npm start                # opens Expo Dev Tools
npm run ios              # run on iOS Simulator
npm run android          # run on Android Emulator
```

### Environment variables

Create `mobile/.env.local`:

```bash
EXPO_PUBLIC_API_URL=http://localhost:3001
# For physical device testing, use your machine's LAN IP:
# EXPO_PUBLIC_API_URL=http://192.168.1.x:3001
```

Expo reads variables prefixed with `EXPO_PUBLIC_` at build time and injects them into the bundle. Never store secrets here — use `expo-secure-store` for runtime secrets.

### Building release binaries

Aura Vault uses [EAS Build](https://docs.expo.dev/build/introduction/) for all release builds.

```bash
# Log in to Expo account
eas login

# Configure EAS (first time only — generates eas.json)
eas build:configure

# iOS release build (requires Apple Developer account)
npm run build:ios        # alias: eas build --platform ios

# Android release build
npm run build:android    # alias: eas build --platform android

# Build both platforms
eas build --platform all
```

### Running tests

```bash
cd mobile
npm test                 # Jest + @testing-library/react-native
```

---

## 3. Project Structure

```
mobile/
├── app.json               # Expo configuration (scheme, bundle IDs, plugins)
├── package.json
└── src/
    ├── index.tsx          # App entry point
    ├── navigation/
    │   └── AppNavigator.tsx   # React Navigation + deep link config
    ├── screens/
    │   ├── HomeScreen.tsx     # Dashboard: TVL, deposit/withdraw actions
    │   └── SettingsScreen.tsx # Biometrics toggle, notifications, slippage
    └── services/
        ├── auth.ts            # Login, token refresh, biometric auth
        └── offline.ts         # Offline transaction queue + data cache
```

**Screen map**

```
aura-vault://           → HomeScreen
aura-vault://deposit    → Deposit (pending implementation)
aura-vault://withdraw   → Withdraw (pending implementation)
aura-vault://settings   → SettingsScreen
```

---

## 4. Wallet Connection on Mobile (Deep Link Handling)

### How it works

The app uses React Navigation's [deep linking](https://reactnavigation.org/docs/deep-linking/) support, configured in `AppNavigator.tsx`. Two URL prefixes are registered:

- Custom scheme: `aura-vault://`
- Universal links: `https://auravault.app`

```typescript
// mobile/src/navigation/AppNavigator.tsx
const linking: LinkingOptions<RootStackParamList> = {
  prefixes: ["aura-vault://", "https://auravault.app"],
  config: {
    screens: {
      Home:     "",
      Deposit:  "deposit",
      Withdraw: "withdraw",
      Settings: "settings",
    },
  },
};
```

### Registering the custom scheme (app.json)

The `scheme` field in `app.json` registers `aura-vault://` at the OS level:

```json
{
  "expo": {
    "scheme": "aura-vault",
    ...
  }
}
```

No additional native configuration is needed — Expo handles the `Info.plist` and `AndroidManifest.xml` entries during the build.

### Universal links (HTTPS)

Universal links require:

1. A valid `apple-app-site-association` (AASA) file served from `https://auravault.app/.well-known/apple-app-site-association`.
2. An `assetlinks.json` file at `https://auravault.app/.well-known/assetlinks.json` for Android.

Example AASA file:
```json
{
  "applinks": {
    "apps": [],
    "details": [
      {
        "appID": "<TEAM_ID>.com.auravault.app",
        "paths": ["*"]
      }
    ]
  }
}
```

Example `assetlinks.json`:
```json
[{
  "relation": ["delegate_permission/common.handle_all_urls"],
  "target": {
    "namespace": "android_app",
    "package_name": "com.auravault.app",
    "sha256_cert_fingerprints": ["<YOUR_RELEASE_KEYSTORE_SHA256>"]
  }
}]
```

### Triggering a deep link in development

```bash
# iOS Simulator
xcrun simctl openurl booted "aura-vault://deposit"

# Android Emulator
adb shell am start -W -a android.intent.action.VIEW -d "aura-vault://deposit" com.auravault.app

# Physical device (via Expo Go)
npx uri-scheme open "aura-vault://deposit" --ios
npx uri-scheme open "aura-vault://deposit" --android
```

### Handling incoming links programmatically

Use `expo-linking` to listen for links at runtime:

```typescript
import * as Linking from "expo-linking";
import { useEffect } from "react";

export function useLinkHandler() {
  useEffect(() => {
    // Handle links received while the app is already open
    const subscription = Linking.addEventListener("url", ({ url }) => {
      const parsed = Linking.parse(url);
      // parsed.path === "deposit" | "withdraw" | "settings"
      console.log("Incoming link:", parsed);
    });

    // Handle the link that launched the app from a cold start
    Linking.getInitialURL().then((url) => {
      if (url) console.log("Launch URL:", url);
    });

    return () => subscription.remove();
  }, []);
}
```

---

## 5. Push Notification Setup (FCM / APNs)

The app uses `expo-notifications` for push notifications. Expo's push service acts as a unified gateway to both FCM (Android) and APNs (iOS).

### Configure credentials

```bash
# iOS — uploads APNs key to Expo
eas credentials --platform ios

# Android — uploads FCM service account JSON to Expo
eas credentials --platform android
```

### Request permission and register device

```typescript
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function registerForPushNotifications(): Promise<string | null> {
  // Ask for permission
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== "granted") {
    console.warn("Push notification permission denied");
    return null;
  }

  // Get the Expo Push Token
  const token = (await Notifications.getExpoPushTokenAsync()).data;

  // Android requires an explicit notification channel
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("vault-alerts", {
      name: "Vault Alerts",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#4f46e5",
    });
  }

  return token;
}
```

### Send a push notification from the backend

Register the device token with the backend after login, then use the Expo push API:

```typescript
// backend: send notification to a device
const message = {
  to: expoPushToken,           // "ExponentPushToken[xxxxxx]"
  sound: "default",
  title: "Harvest Complete",
  body: "Your vault yield has been compounded.",
  data: { type: "harvest", amount: 1234.56 },
};

await fetch("https://exp.host/--/api/v2/push/send", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Accept: "application/json",
    "Accept-Encoding": "gzip, deflate",
  },
  body: JSON.stringify(message),
});
```

### Notification event types

| Event | When sent |
|-------|-----------|
| `deposit_confirmed` | Deposit transaction confirmed on Stellar |
| `withdraw_confirmed` | Withdrawal transaction confirmed |
| `harvest_complete` | Keeper harvest increases share value |
| `vault_paused` | Admin pauses the contract |
| `suspicious_activity` | Flash loan guard triggered |

### Handle notifications in the app

```typescript
import * as Notifications from "expo-notifications";
import { useEffect } from "react";
import { useNavigation } from "@react-navigation/native";

export function useNotificationHandler() {
  const navigation = useNavigation();

  useEffect(() => {
    // Notification received while app is foregrounded
    const foreground = Notifications.addNotificationReceivedListener((notification) => {
      console.log("Notification received:", notification);
    });

    // User tapped a notification
    const response = Notifications.addNotificationResponseReceivedListener((res) => {
      const data = res.notification.request.content.data;
      if (data?.type === "harvest") {
        navigation.navigate("Home");
      }
    });

    return () => {
      foreground.remove();
      response.remove();
    };
  }, [navigation]);
}
```

---

## 6. Biometric Authentication

Biometric auth is implemented in `mobile/src/services/auth.ts` using `expo-local-authentication`. It acts as a second factor — the user must already hold a valid JWT in `expo-secure-store` before biometric auth is checked.

### Flow

```
App launch
    │
    ▼
SecureStore.getItemAsync("aura_access_token")
    │ found                        │ not found
    ▼                              ▼
authenticateWithBiometrics()    → Navigate to login screen
    │ success                      │ failure
    ▼                              ▼
Show dashboard               Show fallback (passcode / PIN)
```

### Implementation

```typescript
// mobile/src/services/auth.ts
import * as LocalAuthentication from "expo-local-authentication";

export async function authenticateWithBiometrics(): Promise<boolean> {
  // Check hardware support
  const hasHardware = await LocalAuthentication.hasHardwareAsync();
  if (!hasHardware) return false;

  // Check enrolled biometrics (Face ID / fingerprint)
  const isEnrolled = await LocalAuthentication.isEnrolledAsync();
  if (!isEnrolled) return false;

  // Prompt the user
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: "Authenticate to access Aura Vault",
    fallbackLabel: "Use passcode",   // shown when biometric fails
    cancelLabel: "Cancel",
    disableDeviceFallback: false,    // allow device PIN as fallback
  });

  return result.success;
}
```

### Supported authentication types

`expo-local-authentication` automatically selects the best available method:

| iOS | Android |
|-----|---------|
| Face ID | Fingerprint |
| Touch ID | Face unlock |
| — | Iris |

Query available types programmatically:

```typescript
const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
// Returns array of LocalAuthentication.AuthenticationType values:
// FINGERPRINT = 1, FACIAL_RECOGNITION = 2, IRIS = 3
```

### iOS configuration

The `NSFaceIDUsageDescription` key is already set in `app.json`:

```json
"ios": {
  "infoPlist": {
    "NSFaceIDUsageDescription": "Authenticate with Face ID to access your vault"
  }
}
```

This string appears in the iOS permission dialog. Customize it for your App Store submission.

### Android configuration

The required permissions are declared in `app.json`:

```json
"android": {
  "permissions": ["USE_BIOMETRIC", "USE_FINGERPRINT"]
}
```

### Secure token storage

JWTs are stored in the device's hardware-backed secure storage, never in AsyncStorage or plaintext:

```typescript
import * as SecureStore from "expo-secure-store";

// Store token after login
await SecureStore.setItemAsync("aura_access_token", accessToken);
await SecureStore.setItemAsync("aura_refresh_token", refreshToken);

// Retrieve token before API calls
const token = await SecureStore.getItemAsync("aura_access_token");

// Clear on logout
await SecureStore.deleteItemAsync("aura_access_token");
await SecureStore.deleteItemAsync("aura_refresh_token");
```

---

## 7. Offline Queue and Data Caching

`mobile/src/services/offline.ts` provides two capabilities:

1. **Offline transaction queue** — Transactions submitted while offline are persisted in `expo-secure-store` and replayed when connectivity is restored.
2. **Short-lived data cache** — Balance and TVL reads are cached for up to 5 minutes to reduce API calls on flaky connections.

### Queue a transaction

```typescript
import { queueTransaction, getQueue, clearQueue } from "./services/offline";

// Queue a deposit when offline
await queueTransaction({
  type: "deposit",
  params: { amount: 1_000_000 },
});

// On reconnect: replay all pending transactions
const pending = await getQueue();
for (const tx of pending) {
  await submitTransaction(tx);  // your API call
}
await clearQueue();
```

### Cache data reads

```typescript
import { cacheData, getCachedData } from "./services/offline";

// Cache TVL for 5 minutes (default)
await cacheData("tvl", totalValueLocked);

// Read from cache (returns null if expired)
const cached = await getCachedData<number>("tvl");
if (cached !== null) {
  setTVL(cached);
} else {
  const fresh = await fetchTVL();
  setTVL(fresh);
  await cacheData("tvl", fresh);
}
```

---

## 8. Backend API Integration

The mobile app calls the same REST API as the web frontend. Base URL is configured via `EXPO_PUBLIC_API_URL`.

### Authentication headers

After login, attach the JWT to every authenticated request:

```typescript
import { getAccessToken, refreshTokens } from "./services/auth";

async function apiRequest(path: string, options: RequestInit = {}): Promise<Response> {
  const token = await getAccessToken();
  const res = await fetch(`${process.env.EXPO_PUBLIC_API_URL}${path}`, {
    ...options,
    headers: {
      ...options.headers,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  // Auto-refresh on 401
  if (res.status === 401) {
    const refreshed = await refreshTokens();
    if (refreshed) return apiRequest(path, options);  // retry once
  }

  return res;
}
```

### Key endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/auth/login` | Authenticate with wallet address |
| `POST` | `/api/auth/refresh` | Refresh access token |
| `POST` | `/api/auth/logout` | Invalidate tokens |
| `GET` | `/api/portfolio` | User's vault positions |
| `GET` | `/api/yield/apy` | Current APY |
| `POST` | `/api/queue/deposit` | Queue a deposit transaction |
| `POST` | `/api/queue/withdraw` | Queue a withdrawal transaction |

Full API reference: [docs/api-reference.md](../docs/api-reference.md)

### React Query setup

The app uses `@tanstack/react-query` for caching and background refetching:

```typescript
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,   // 30 seconds
      retry: 2,
    },
  },
});

// Wrap your app root
export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppNavigator />
    </QueryClientProvider>
  );
}
```

---

## 9. App Store / Play Store Submission Checklist

Complete all items before submitting a release build.

### General

- [ ] `app.json` version (`version`) and build number (`ios.buildNumber` / `android.versionCode`) incremented
- [ ] All placeholder assets replaced: `assets/icon.png` (1024×1024), `assets/splash.png` (2048×2048), `assets/adaptive-icon.png` (1024×1024)
- [ ] `EXPO_PUBLIC_API_URL` points to the production backend URL (not localhost)
- [ ] EAS `production` build profile is configured in `eas.json`
- [ ] Release build tested on a physical device (not just simulator)
- [ ] All console.log / debug output removed or gated behind `__DEV__`

### Security

- [ ] Biometric authentication works on both iOS and Android physical devices
- [ ] JWT tokens are stored exclusively in `expo-secure-store` (verify no AsyncStorage usage for tokens)
- [ ] Network requests use HTTPS only in production
- [ ] Certificate pinning configured for the backend API domain (recommended)
- [ ] Deep link handling validated — no unintentional screen access via malformed URLs

### iOS — Apple App Store

- [ ] Apple Developer account active and app ID registered (`com.auravault.app`)
- [ ] APNs push notification key uploaded to Expo (`eas credentials --platform ios`)
- [ ] `NSFaceIDUsageDescription` set in `app.json` infoPlist
- [ ] App Store Connect listing created with screenshots, description, keywords, and age rating
- [ ] Privacy policy URL added to App Store Connect listing
- [ ] Export compliance (encryption) declaration completed
- [ ] TestFlight build approved before final submission
- [ ] All App Store Review Guidelines reviewed, especially [Section 3 (Business)](https://developer.apple.com/app-store/review/guidelines/#business) for DeFi apps

### Android — Google Play Store

- [ ] Google Play Developer account active
- [ ] FCM service account JSON uploaded to Expo (`eas credentials --platform android`)
- [ ] Release keystore generated and backed up securely — **this cannot be recovered if lost**
- [ ] `assetlinks.json` deployed at `https://auravault.app/.well-known/assetlinks.json` for App Links
- [ ] Target API level ≥ 34 (Android 14) set in `app.json`
- [ ] Play Console listing created with store listing, graphics, and content rating
- [ ] Data safety form completed in Play Console
- [ ] Internal / Closed Testing track approved before production rollout
- [ ] [Google Play Financial Services Policy](https://support.google.com/googleplay/android-developer/answer/9900672) reviewed

### Post-submission

- [ ] Monitoring alerts configured for crash rate and ANR rate
- [ ] Sentry or equivalent error tracking initialized in the release build
- [ ] Push notification delivery tested end-to-end in production environment

---

## 10. Troubleshooting

### Metro bundler won't start

```bash
cd mobile
npx expo start --clear     # clear Metro cache
```

### iOS simulator: "Expo Go is not supported"

Use a development build instead of Expo Go when native modules are required:

```bash
eas build --profile development --platform ios
```

### Face ID not prompting on iOS Simulator

Face ID must be explicitly enrolled in the simulator:
**Simulator → Features → Face ID → Enrolled**, then **Features → Face ID → Matching Face**.

### Android: biometric dialog crashes

Ensure `USE_BIOMETRIC` and `USE_FINGERPRINT` permissions are in `app.json` and that the emulator has a fingerprint enrolled (**Settings → Security → Fingerprint**).

### Deep links not opening the app

1. Confirm the `scheme` field in `app.json` matches the URL prefix.
2. On Android, verify the app is installed and run `adb shell pm dump com.auravault.app | grep schemes`.
3. On iOS, make sure the URL scheme is registered: **Settings → Privacy → Aura Vault → Open Links**.

### Push notifications not received on Android

Ensure the correct FCM project is linked. Run `eas credentials --platform android` and verify the package name matches `com.auravault.app`.

### SecureStore throws on web / simulator

`expo-secure-store` requires a physical device or a simulator with security enabled. On web, it falls back to `localStorage` — never use this for production token storage.
