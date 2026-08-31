import { useState, useId, useCallback, useRef } from "react";
import type { ToastMessage } from "./Toast";
import { Skeleton } from "./Skeleton";
import { ErrorMessage } from "./ErrorMessage";
import { translateError, type UserError } from "../lib/errors";
import { useInlineLiveRegion } from "./LiveRegion";

interface Props {
  onToast: (msg: ToastMessage) => void;
}

export function WithdrawForm({ onToast }: Props) {
  const id = useId();
  const [shares, setShares] = useState("");
  const [fieldError, setFieldError] = useState("");
  const [txError, setTxError] = useState<UserError | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { announce, regionProps } = useInlineLiveRegion("polite");

  const validate = (val: string) => {
    if (!val || isNaN(Number(val)) || Number(val) <= 0) return "Enter a valid share amount greater than 0.";
    return "";
  };

  const submit = useCallback(async () => {
    setTxError(null);
    setLoading(true);
    announce("Processing withdrawal, please wait.");
    try {
      await new Promise((r) => setTimeout(r, 100));
      setShares("");
      announce(`Withdrew ${shares} shares successfully.`);
      onToast({ type: "success", text: `Withdrew ${shares} shares successfully.` });
      inputRef.current?.focus();
    } catch (err) {
      setTxError(translateError(err));
      announce("Withdrawal failed. See error message below.");
    } finally {
      setLoading(false);
    }
  }, [shares, announce, onToast]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const err = validate(shares);
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
      <div {...regionProps} />

      <h2 id={`${id}-title`} className="form-title">Withdraw</h2>
      {loading ? (
        <Skeleton rows={3} />
      ) : (
        <form onSubmit={handleSubmit} noValidate>
          <div className="field">
            <label htmlFor={`${id}-shares`}>Shares</label>
            <input
  ref={inputRef}
  id={`${id}-shares`}
  type="number"
  min="0"
  step="any"
  value={shares}
  onChange={(e) => { setShares(e.target.value); if (fieldError) setFieldError(""); }}
  aria-label="Shares"
  aria-describedby={fieldError ? `${id}-err` : `${id}-hint`}
  aria-invalid={!!fieldError}
  aria-required="true"
  placeholder="0.00"
  className="input"
  autoComplete="off"
/>
            <p id={`${id}-hint`} className="field-hint" aria-hidden={!!fieldError}>
              Enter the number of vault shares to redeem for underlying tokens.
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
            Withdraw
          </button>
        </form>
      )}
    </section>
  );
}
