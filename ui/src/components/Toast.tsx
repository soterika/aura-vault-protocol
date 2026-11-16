import { useEffect } from "react";

export interface ToastMessage {
  type: "success" | "error" | "info";
  text: string;
}

interface Props {
  message: ToastMessage;
  onDismiss: () => void;
  duration?: number;
}

export function Toast({ message, onDismiss, duration = 4000 }: Props) {
  useEffect(() => {
    const t = setTimeout(onDismiss, duration);
    return () => clearTimeout(t);
  }, [message, duration, onDismiss]);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className={`toast toast--${message.type}`}
    >
      <span className="toast-text">{message.text}</span>
      <button
        className="toast-close"
        onClick={onDismiss}
        aria-label="Dismiss notification"
      >
        ×
      </button>
    </div>
  );
}
