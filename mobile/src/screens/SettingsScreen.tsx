import React, { useState } from "react";
import { View, Text, StyleSheet, Switch, ScrollView } from "react-native";

export function SettingsScreen() {
  const [biometrics, setBiometrics] = useState(false);
  const [notifications, setNotifications] = useState(true);
  const [slippage, setSlippage] = useState(0.5);

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.heading}>Settings</Text>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Security</Text>
        <View style={styles.row}>
          <Text style={styles.label}>Biometric Authentication</Text>
          <Switch
            value={biometrics}
            onValueChange={setBiometrics}
            trackColor={{ false: "#3f3f46", true: "#4f46e5" }}
            accessibilityLabel="Toggle biometric authentication"
          />
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Notifications</Text>
        <View style={styles.row}>
          <Text style={styles.label}>Push Notifications</Text>
          <Switch
            value={notifications}
            onValueChange={setNotifications}
            trackColor={{ false: "#3f3f46", true: "#4f46e5" }}
            accessibilityLabel="Toggle push notifications"
          />
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Slippage Tolerance</Text>
        <View style={styles.slippageRow}>
          {[0.1, 0.5, 1.0, 3.0].map((val) => (
            <Text
              key={val}
              style={[styles.slippageOption, slippage === val && styles.slippageActive]}
              onPress={() => setSlippage(val)}
              accessibilityRole="button"
            >
              {val}%
            </Text>
          ))}
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000", padding: 16 },
  heading: { fontSize: 24, fontWeight: "700", color: "#fff", marginTop: 48, marginBottom: 24 },
  section: { marginBottom: 24 },
  sectionTitle: { fontSize: 12, color: "#71717a", textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#27272a" },
  label: { fontSize: 16, color: "#fff" },
  slippageRow: { flexDirection: "row", gap: 8 },
  slippageOption: { paddingVertical: 8, paddingHorizontal: 16, borderRadius: 8, backgroundColor: "#27272a", color: "#a1a1aa", fontSize: 14, overflow: "hidden" },
  slippageActive: { backgroundColor: "#4f46e5", color: "#fff" },
});
