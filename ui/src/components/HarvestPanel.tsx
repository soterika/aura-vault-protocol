import { useState, useId, useCallback } from "react";
import type { ToastMessage } from "./Toast";
import { Skeleton } from "./Skeleton";
import { ErrorMessage } from "./ErrorMessage";
import { translateError, type UserError } from "../lib/errors";
import { TermTooltip } from "./Tooltip";

interface Props {
  onToast: (msg: ToastMessage) => void;
}

export function HarvestPanel({ onToast }: Props) {
  const id = useId();
  const [yieldAmt, setYieldAmt] = useState("");
  const [fieldError, setFieldError] = useState("");
  const [txError, setTxError] = useState<UserError | null>(null);
  const [loading, setLoading] = useState(false);

  const validate = (val: string) => {
    if (!val || isNaN(Number(val)) || Number(val) <= 0) return "Enter a valid yield amount greater than 0.";
    return "";
  };

          const submit = useCallback(async () => {
    setTxError(null);
    setLoading(true);

    try {
      await new Promise((r) => setTimeout(r, 100));
      setYieldAmt("");
      onToast({ type: "success", text: `Harvested ${yieldAmt} yield tokens.` });
    } catch (err) {
      setTxError(translateError(err));
    } finally {
      setLoading(false);
    }
  }, [yieldAmt, onToast]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const err = validate(yieldAmt);
    if (err) { setFieldError(err); return; }
    setFieldError("");
    submit();
  };

  return (
    <section aria-labelledby={`${id}-title`} className="vault-form">
      <h2 id={`${id}-title`} className="form-title">
        <TermTooltip term="Harvest" />
      </h2>
      <p className="form-desc">
        As a <TermTooltip term="Keeper" />, inject yield into the vault for all shareholders.
      </p>
            {loading ? (
  <Skeleton rows={3} />
) : (
        <form onSubmit={handleSubmit} noValidate>
          <div className="field">
            <label htmlFor={`${id}-yield`}>Yield Amount</label>
            <input
              id={`${id}-yield`}
              type="number"
              min="0"
              step="any"
              value={yieldAmt}
              onChange={(e) => setYieldAmt(e.target.value)}
              aria-describedby={fieldError ? `${id}-err` : undefined}
              aria-invalid={!!fieldError}
              placeholder="0.00"
              className="input"
            />
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

          <button type="submit" className="btn btn--primary">
            Harvest
          </button>
        </form>
      )}
    </section>
  );
}
