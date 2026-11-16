import { forwardRef, type InputHTMLAttributes, type ReactNode } from "react";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
  leftAddon?: ReactNode;
  rightAddon?: ReactNode;
}

/**
 * Accessible text input with label, error, hint, and addon support.
 * Uses aria-describedby for error/hint association.
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, error, hint, leftAddon, rightAddon, id, className = "", ...props },
  ref
) {
  const inputId = id ?? `input-${Math.random().toString(36).slice(2, 7)}`;
  const errorId = `${inputId}-error`;
  const hintId  = `${inputId}-hint`;
  const describedBy = [error ? errorId : "", hint ? hintId : ""].filter(Boolean).join(" ") || undefined;

  return (
    <div className="ds-field">
      {label && <label htmlFor={inputId} className="ds-field__label">{label}</label>}
      <div className={`ds-input-wrap${leftAddon ? " ds-input-wrap--left" : ""}${rightAddon ? " ds-input-wrap--right" : ""}`}>
        {leftAddon  && <span className="ds-input-addon ds-input-addon--left"  aria-hidden="true">{leftAddon}</span>}
        <input
          ref={ref}
          id={inputId}
          className={`ds-input${error ? " ds-input--error" : ""} ${className}`}
          aria-invalid={!!error}
          aria-describedby={describedBy}
          {...props}
        />
        {rightAddon && <span className="ds-input-addon ds-input-addon--right" aria-hidden="true">{rightAddon}</span>}
      </div>
      {hint  && !error && <p id={hintId}  className="ds-field__hint">{hint}</p>}
      {error && <p id={errorId} role="alert" className="ds-field__error">{error}</p>}
    </div>
  );
});
