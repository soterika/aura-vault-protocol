import * as SecureStore from "expo-secure-store";
import * as LocalAuthentication from "expo-local-authentication";

const API_URL = process.env.EXPO_PUBLIC_API_URL || "http://localhost:3001";
const ACCESS_TOKEN_KEY = "aura_access_token";
const REFRESH_TOKEN_KEY = "aura_refresh_token";

export async function login(walletAddress: string): Promise<boolean> {
  const res = await fetch(`${API_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ walletAddress, deviceId: "mobile" }),
  });
  if (!res.ok) return false;
  const { accessToken, refreshToken } = await res.json();
  await SecureStore.setItemAsync(ACCESS_TOKEN_KEY, accessToken);
  await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, refreshToken);
  return true;
}

export async function getAccessToken(): Promise<string | null> {
  return SecureStore.getItemAsync(ACCESS_TOKEN_KEY);
}

export async function refreshTokens(): Promise<boolean> {
  const refreshToken = await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
  if (!refreshToken) return false;
  const res = await fetch(`${API_URL}/api/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  });
  if (!res.ok) return false;
  const data = await res.json();
  await SecureStore.setItemAsync(ACCESS_TOKEN_KEY, data.accessToken);
  await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, data.refreshToken);
  return true;
}

export async function logout(): Promise<void> {
  const token = await getAccessToken();
  const refreshToken = await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
  if (token) {
    await fetch(`${API_URL}/api/auth/logout`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    }).catch(() => {});
  }
  await SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY);
  await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
}

export async function authenticateWithBiometrics(): Promise<boolean> {
  const hasHardware = await LocalAuthentication.hasHardwareAsync();
  if (!hasHardware) return false;
  const isEnrolled = await LocalAuthentication.isEnrolledAsync();
  if (!isEnrolled) return false;
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: "Authenticate to access Aura Vault",
    fallbackLabel: "Use passcode",
  });
  return result.success;
}
