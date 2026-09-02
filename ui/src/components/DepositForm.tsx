import { useState, useId, useCallback, useRef } from "react";
import type { ToastMessage } from "./Toast";
import { Skeleton } from "./Skeleton";
import { ErrorMessage } from "./ErrorMessage";
import { translateError, type UserError } from "../lib/errors";
import { useInlineLiveRegion } from "./LiveRegion";

interface Props {
  onToast: (msg: ToastMessage) => void;
}

export function DepositForm({ onToast }: Props) {
  const id = useId();
  const [amount, setAmount] = useState("");
  const [fieldError, setFieldError] = useState("");
  const [txError, setTxError] = useState<UserError | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { announce, regionProps } = useInlineLiveRegion("polite");

  const validate = (val: string) => {
    if (!val || isNaN(Number(val)) || Number(val) <= 0) return "Enter a valid amount greater than 0.";
    return "";
  };

  const submit = useCallback(async () => {
    setTxError(null);
    setLoading(true);
    announce("Processing deposit, please wait.");
    try {
      // Simulate async contract call — replace with actual Soroban invocation
      await new Promise((r) => setTimeout(r, 1200));
      setAmount("");
      announce(`Deposited ${amount} tokens successfully.`);
      onToast({ type: "success", text: `Deposited ${amount} tokens successfully.` });
      inputRef.current?.focus();
    } catch (err) {
      setTxError(translateError(err));
      announce("Deposit failed. See error message below.");
    } finally {
      setLoading(false);
    }
  }, [amount, announce, onToast]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const err = validate(amount);
    if (err) {
      setFieldError(err);
      inputRef.current?.focus();
      return;
    }
    setFieldError("");
    submit();
  };

  return (
    <section aria-labelledby={`${id}-title`} className="vault-form">
      {/* Screen reader live region */}
      <div {...regionProps} />

      <h2 id={`${id}-title`} className="form-title">Deposit</h2>
      {loading ? (
        <Skeleton rows={3} />
      ) : (
        <form onSubmit={handleSubmit} noValidate>
          <div className="field">
            <label htmlFor={`${id}-amount`}>Amount</label>
            <input
              ref={inputRef}
              id={`${id}-amount`}
              type="number"
              min="0"
              step="any"
              value={amount}
              onChange={(e) => { setAmount(e.target.value); if (fieldError) setFieldError(""); }}
              aria-describedby={fieldError ? `${id}-err` : `${id}-hint`}
              aria-invalid={!!fieldError}
              aria-required="true"
              placeholder="0.00"
              className="input"
              autoComplete="off"
            />
            <p id={`${id}-hint`} className="field-hint" aria-hidden={!!fieldError}>
              Enter the token amount to deposit into the vault.
            </p>
            {fieldError && (
              <p id={`${id}-err`} role="alert" className="field-error">
                {fieldError}
              </p>
            )}
          </div>

          {txError && (
            <ErrorMessage
              error={txError}
              onRetry={submit}
              onDismiss={() => setTxError(null)}
            />
          )}

          <button type="submit" className="btn btn--primary" aria-busy={loading}>
            Deposit
          </button>
        </form>
      )}
    </section>
  );
}
