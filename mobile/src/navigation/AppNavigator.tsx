import React from "react";
import { NavigationContainer, LinkingOptions } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { HomeScreen } from "../screens/HomeScreen";
import { DepositScreen } from "../screens/DepositScreen";
import { SettingsScreen } from "../screens/SettingsScreen";

export type RootStackParamList = {
  Home: undefined;
  Deposit: { amount?: string; token?: string } | undefined;
  Vault: undefined;
  Leaderboard: undefined;
  Withdraw: undefined;
  Settings: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

const linking: LinkingOptions<RootStackParamList> = {
  prefixes: [
    "aura://",
    "aura-vault://",
    "https://app.auravault.io",
    "https://auravault.app",
  ],
  config: {
    screens: {
      Home: "",
      Deposit: "deposit",
      Vault: "vault",
      Leaderboard: "leaderboard",
      Withdraw: "withdraw",
      Settings: "settings",
    },
  },
};

export function AppNavigator() {
  return (
    <NavigationContainer linking={linking}>
      <Stack.Navigator
        screenOptions={{
          headerStyle: { backgroundColor: "#000" },
          headerTintColor: "#fff",
          headerTitleStyle: { fontWeight: "600" },
          contentStyle: { backgroundColor: "#000" },
        }}
      >
        <Stack.Screen name="Home" component={HomeScreen} options={{ headerShown: false }} />
        <Stack.Screen name="Deposit" component={DepositScreen} options={{ title: "Deposit" }} />
        <Stack.Screen name="Settings" component={SettingsScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
