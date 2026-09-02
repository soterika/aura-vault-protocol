import {
  useState, useRef, useEffect, useId,
  type SelectHTMLAttributes, type ReactNode, type InputHTMLAttributes,
} from "react";

/* ── Select ───────────────────────────────────────────────────────── */
export interface SelectOption { value: string; label: string; disabled?: boolean; }
export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "size"> {
  label?: string;
  error?: string;
  hint?: string;
  options: SelectOption[];
  placeholder?: string;
}

/** Accessible native select with label/error support. */
export function Select({ label, error, hint, options, placeholder, id, className = "", ...props }: SelectProps) {
  const uid = id ?? `select-${useId()}`;
  const errorId = `${uid}-error`;
  const hintId  = `${uid}-hint`;
  const described = [error ? errorId : "", hint ? hintId : ""].filter(Boolean).join(" ") || undefined;

  return (
    <div className="ds-field">
      {label && <label htmlFor={uid} className="ds-field__label">{label}</label>}
      <select
        id={uid} className={`ds-select${error ? " ds-select--error" : ""} ${className}`}
        aria-invalid={!!error} aria-describedby={described} {...props}
      >
        {placeholder && <option value="" disabled>{placeholder}</option>}
        {options.map(o => (
          <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>
        ))}
      </select>
      {hint  && !error && <p id={hintId}  className="ds-field__hint">{hint}</p>}
      {error && <p id={errorId} role="alert" className="ds-field__error">{error}</p>}
    </div>
  );
}

/* ── Checkbox ─────────────────────────────────────────────────────── */
export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label: string;
  error?: string;
}

/** Accessible checkbox with associated label. */
export function Checkbox({ label, error, id, className = "", ...props }: CheckboxProps) {
  const uid = id ?? `cb-${useId()}`;
  return (
    <div className={`ds-checkbox-wrap ${className}`}>
      <input type="checkbox" id={uid} className="ds-checkbox" aria-invalid={!!error} {...props} />
      <label htmlFor={uid} className="ds-checkbox__label">{label}</label>
      {error && <p role="alert" className="ds-field__error">{error}</p>}
    </div>
  );
}

/* ── Switch ───────────────────────────────────────────────────────── */
export interface SwitchProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "role"> {
  label: string;
}

/** Toggle switch using a checkbox with role="switch". */
export function Switch({ label, id, ...props }: SwitchProps) {
  const uid = id ?? `sw-${useId()}`;
  return (
    <div className="ds-switch-wrap">
      <input type="checkbox" role="switch" id={uid} className="ds-switch" {...props} />
      <label htmlFor={uid} className="ds-switch__label">{label}</label>
    </div>
  );
}

/* ── Tooltip ──────────────────────────────────────────────────────── */
export interface TooltipProps {
  content: string;
  children: ReactNode;
  placement?: "top" | "bottom" | "left" | "right";
}

/** Hover/focus tooltip using aria-describedby. */
export function Tooltip({ content, children, placement = "top" }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const id = useId();

  return (
    <span
      className="ds-tooltip-wrap"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocus={() => setVisible(true)}
      onBlur={() => setVisible(false)}
    >
      {/* Pass aria-describedby to child via wrapper — child must be focusable */}
      <span aria-describedby={id}>{children}</span>
      <span
        id={id}
        role="tooltip"
        className={`ds-tooltip ds-tooltip--${placement}${visible ? " ds-tooltip--visible" : ""}`}
      >
        {content}
      </span>
    </span>
  );
}

/* ── Alert ────────────────────────────────────────────────────────── */
export type AlertVariant = "info" | "success" | "warning" | "error";
export interface AlertProps {
  variant?: AlertVariant;
  title?: string;
  children: ReactNode;
  onDismiss?: () => void;
}

const alertIcons: Record<AlertVariant, string> = {
  info: "ℹ", success: "✓", warning: "⚠", error: "✕",
};

/** Banner alert with optional dismiss. Uses role="alert" or role="status". */
export function Alert({ variant = "info", title, children, onDismiss }: AlertProps) {
  return (
    <div
      className={`ds-alert ds-alert--${variant}`}
      role={variant === "error" || variant === "warning" ? "alert" : "status"}
    >
      <span className="ds-alert__icon" aria-hidden="true">{alertIcons[variant]}</span>
      <div className="ds-alert__body">
        {title && <strong className="ds-alert__title">{title}</strong>}
        <span className="ds-alert__content">{children}</span>
      </div>
      {onDismiss && (
        <button className="ds-alert__dismiss" onClick={onDismiss} aria-label="Dismiss alert">×</button>
      )}
    </div>
  );
}

/* ── ProgressBar ──────────────────────────────────────────────────── */
export interface ProgressBarProps {
  value: number;   // 0–100
  max?: number;
  label?: string;
  showValue?: boolean;
  variant?: "default" | "success" | "warning" | "error";
}

/** Accessible progress bar with aria-valuenow/min/max. */
export function ProgressBar({ value, max = 100, label, showValue = false, variant = "default" }: ProgressBarProps) {
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  return (
    <div className="ds-progress">
      {(label || showValue) && (
        <div className="ds-progress__header">
          {label    && <span className="ds-progress__label">{label}</span>}
          {showValue && <span className="ds-progress__value">{Math.round(pct)}%</span>}
        </div>
      )}
      <div
        className={`ds-progress__track ds-progress__track--${variant}`}
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-label={label ?? "Progress"}
      >
        <div className="ds-progress__fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/* ── Tabs ─────────────────────────────────────────────────────────── */
export interface TabItem {
  id: string;
  label: string;
  content: ReactNode;
  disabled?: boolean;
}

export interface TabsProps {
  items: TabItem[];
  defaultTab?: string;
  onChange?: (id: string) => void;
}

/** Accessible tab set with ARIA roles and keyboard navigation. */
export function Tabs({ items, defaultTab, onChange }: TabsProps) {
  const [active, setActive] = useState(defaultTab ?? items[0]?.id ?? "");
  const tabsRef = useRef<HTMLDivElement>(null);
  const baseId = useId();

  const select = (id: string) => {
    setActive(id);
    onChange?.(id);
  };

  // Arrow key navigation
  const onKeyDown = (e: React.KeyboardEvent, idx: number) => {
    const enabled = items.filter(t => !t.disabled);
    const cur = enabled.findIndex(t => t.id === items[idx].id);
    if (e.key === "ArrowRight") {
      const next = enabled[(cur + 1) % enabled.length];
      select(next.id);
      (tabsRef.current?.querySelector(`#${baseId}-tab-${next.id}`) as HTMLElement)?.focus();
    }
    if (e.key === "ArrowLeft") {
      const prev = enabled[(cur - 1 + enabled.length) % enabled.length];
      select(prev.id);
      (tabsRef.current?.querySelector(`#${baseId}-tab-${prev.id}`) as HTMLElement)?.focus();
    }
  };

  const panel = items.find(t => t.id === active);

  return (
    <div className="ds-tabs" ref={tabsRef}>
      <div role="tablist" className="ds-tabs__list">
        {items.map((tab, idx) => (
          <button
            key={tab.id}
            id={`${baseId}-tab-${tab.id}`}
            role="tab"
            aria-selected={active === tab.id}
            aria-controls={`${baseId}-panel-${tab.id}`}
            aria-disabled={tab.disabled}
            tabIndex={active === tab.id ? 0 : -1}
            className={`ds-tab${active === tab.id ? " ds-tab--active" : ""}${tab.disabled ? " ds-tab--disabled" : ""}`}
            onClick={() => !tab.disabled && select(tab.id)}
            onKeyDown={(e) => onKeyDown(e, idx)}
            disabled={tab.disabled}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {panel && (
        <div
          id={`${baseId}-panel-${panel.id}`}
          role="tabpanel"
          aria-labelledby={`${baseId}-tab-${panel.id}`}
          className="ds-tabs__panel"
        >
          {panel.content}
        </div>
      )}
    </div>
  );
}
