import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
} from "react-native";
import {
  validateDeepLinkAmount,
  validateDeepLinkToken,
  SupportedToken,
} from "../utils/deepLinkValidation";

export interface DepositScreenProps {
  route?: {
    params?: {
      amount?: string;
      token?: string;
    };
  };
  navigation?: any;
  maxBalance?: number;
}

const DEFAULT_MAX_BALANCE = 10000;

export function DepositScreen({
  route,
  maxBalance = DEFAULT_MAX_BALANCE,
}: DepositScreenProps) {
  const paramAmount = route?.params?.amount;
  const paramToken = route?.params?.token;

  const [token, setToken] = useState<SupportedToken>(() =>
    validateDeepLinkToken(paramToken)
  );
  const [amount, setAmount] = useState<string>(() => {
    const result = validateDeepLinkAmount(paramAmount, maxBalance);
    return result.valid ? result.amount : "";
  });
  const [error, setError] = useState<string | undefined>(() => {
    const result = validateDeepLinkAmount(paramAmount, maxBalance);
    return result.valid ? undefined : result.error;
  });

  useEffect(() => {
    setToken(validateDeepLinkToken(paramToken));
    const result = validateDeepLinkAmount(paramAmount, maxBalance);
    if (result.valid) {
      setAmount(result.amount);
      setError(undefined);
    } else {
      setAmount("");
      setError(result.error);
    }
  }, [paramAmount, paramToken, maxBalance]);

  const handleAmountChange = (value: string) => {
    setAmount(value);
    if (value.trim() === "") {
      setError(undefined);
      return;
    }
    const result = validateDeepLinkAmount(value, maxBalance);
    setError(result.valid ? undefined : result.error);
  };

  const isSubmitDisabled = !amount || Boolean(error);

  return (
    <ScrollView style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.heading}>Deposit to Aura Vault</Text>
        <Text style={styles.subtext}>
          Available balance: {maxBalance} {token}
        </Text>

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Token</Text>
          <View style={styles.tokenBadge}>
            <Text style={styles.tokenText}>{token}</Text>
          </View>
        </View>

        <View style={styles.fieldGroup}>
          <Text style={styles.label}>Amount</Text>
          <TextInput
            style={[styles.input, error ? styles.inputError : null]}
            value={amount}
            onChangeText={handleAmountChange}
            placeholder="0.00"
            placeholderTextColor="#71717a"
            keyboardType="decimal-pad"
            accessibilityLabel="Deposit amount"
            testID="deposit-amount-input"
          />
          {error ? (
            <Text style={styles.errorText} testID="deposit-amount-error">
              {error}
            </Text>
          ) : null}
        </View>

        <TouchableOpacity
          style={[
            styles.submitButton,
            isSubmitDisabled ? styles.submitButtonDisabled : null,
          ]}
          disabled={isSubmitDisabled}
          accessibilityRole="button"
          accessibilityLabel="Confirm Deposit"
          testID="deposit-submit-button"
        >
          <Text style={styles.submitButtonText}>Deposit {token}</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  card: {
    margin: 16,
    padding: 20,
    borderRadius: 16,
    backgroundColor: "#18181b",
    borderWidth: 1,
    borderColor: "#27272a",
  },
  heading: { fontSize: 22, fontWeight: "700", color: "#fff" },
  subtext: { fontSize: 13, color: "#a1a1aa", marginTop: 4, marginBottom: 20 },
  fieldGroup: { marginBottom: 16 },
  label: { fontSize: 12, color: "#a1a1aa", marginBottom: 6, textTransform: "uppercase" },
  tokenBadge: {
    alignSelf: "flex-start",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: "#27272a",
  },
  tokenText: { color: "#fff", fontWeight: "600", fontSize: 14 },
  input: {
    backgroundColor: "#09090b",
    borderWidth: 1,
    borderColor: "#27272a",
    borderRadius: 10,
    padding: 14,
    color: "#fff",
    fontSize: 18,
  },
  inputError: { borderColor: "#ef4444" },
  errorText: { color: "#ef4444", fontSize: 13, marginTop: 6 },
  submitButton: {
    marginTop: 8,
    backgroundColor: "#4f46e5",
    padding: 16,
    borderRadius: 12,
    alignItems: "center",
  },
  submitButtonDisabled: { opacity: 0.5 },
  submitButtonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
});
