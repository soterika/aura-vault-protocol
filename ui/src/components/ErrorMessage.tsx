import type { UserError } from "../lib/errors";

interface Props {
  error: UserError;
  onRetry?: () => void;
  onDismiss?: () => void;
}

export function ErrorMessage({ error, onRetry, onDismiss }: Props) {
  return (
    <div role="alert" aria-live="assertive" className={`error-msg error-msg--${error.severity}`}>
      <div className="error-msg__body">
        <p className="error-msg__text">{error.message}</p>
        {error.action && <p className="error-msg__action">{error.action}</p>}
      </div>
      <div className="error-msg__controls">
        {error.retryable && onRetry && (
          <button className="btn-link" onClick={onRetry}>
            Retry
          </button>
        )}
        {onDismiss && (
          <button className="btn-link btn-link--muted" onClick={onDismiss} aria-label="Dismiss error">
            Dismiss
          </button>
        )}
      </div>
    </div>
  );
}
