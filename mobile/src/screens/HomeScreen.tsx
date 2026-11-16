import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from "react-native";

export function HomeScreen({ navigation }: { navigation: any }) {
  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Aura Vault</Text>
        <Text style={styles.subtitle}>DeFi Yield Protocol</Text>
      </View>

      <View style={styles.balanceCard}>
        <Text style={styles.balanceLabel}>Total Value Locked</Text>
        <Text style={styles.balanceValue}>$0.00</Text>
      </View>

      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.actionButton, styles.depositButton]}
          onPress={() => navigation.navigate("Deposit")}
          accessibilityRole="button"
          accessibilityLabel="Deposit funds"
        >
          <Text style={styles.actionButtonText}>Deposit</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionButton, styles.withdrawButton]}
          onPress={() => navigation.navigate("Withdraw")}
          accessibilityRole="button"
          accessibilityLabel="Withdraw funds"
        >
          <Text style={styles.actionButtonText}>Withdraw</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        style={styles.settingsLink}
        onPress={() => navigation.navigate("Settings")}
        accessibilityRole="button"
      >
        <Text style={styles.settingsLinkText}>Settings</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  header: { padding: 24, paddingTop: 60 },
  title: { fontSize: 28, fontWeight: "700", color: "#fff" },
  subtitle: { fontSize: 14, color: "#a1a1aa", marginTop: 4 },
  balanceCard: {
    margin: 16,
    padding: 24,
    borderRadius: 16,
    backgroundColor: "#18181b",
    borderWidth: 1,
    borderColor: "#27272a",
  },
  balanceLabel: { fontSize: 12, color: "#71717a", textTransform: "uppercase", letterSpacing: 1 },
  balanceValue: { fontSize: 32, fontWeight: "700", color: "#fff", marginTop: 8 },
  actions: { flexDirection: "row", gap: 12, paddingHorizontal: 16 },
  actionButton: { flex: 1, padding: 16, borderRadius: 12, alignItems: "center" },
  depositButton: { backgroundColor: "#4f46e5" },
  withdrawButton: { backgroundColor: "#27272a" },
  actionButtonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  settingsLink: { padding: 16, alignItems: "center" },
  settingsLinkText: { color: "#6366f1", fontSize: 14, fontWeight: "500" },
});
