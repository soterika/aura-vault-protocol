import { useState, useEffect, useCallback, useId } from "react";

interface OnboardingStep {
  title: string;
  description: string;
  icon: string;
}

interface Props {
  onComplete: () => void;
}

const STORAGE_KEY = "aura_vault_onboarding_completed";

const steps: OnboardingStep[] = [
  {
    title: "Welcome to Aura Vault",
    description:
      "Aura Vault is a decentralized yield protocol. Deposit tokens, earn yield, and harvest rewards — all on-chain with full transparency.",
    icon: "🏦",
  },
  {
    title: "Deposit & Earn",
    description:
      "Use the Deposit tab to add tokens to the vault. Your deposit starts accruing yield immediately through the protocol's strategy.",
    icon: "💰",
  },
  {
    title: "Withdraw Anytime",
    description:
      "Need your tokens back? Switch to Withdraw to reclaim your balance plus any earned yield. No lock-up periods.",
    icon: "🔓",
  },
  {
    title: "Harvest Rewards",
    description:
      "The Harvest tab lets you claim accumulated rewards. Harvest regularly to compound your gains or transfer to your wallet.",
    icon: "🌾",
  },
  {
    title: "Stay Secure",
    description:
      "Never share your private keys. Verify contract addresses before transacting. Bookmark this page to avoid phishing sites. Review all transaction details before signing.",
    icon: "🛡️",
  },
];

export function OnboardingFlow({ onComplete }: Props) {
  const id = useId();
  const [step, setStep] = useState(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Small delay so the entrance animation plays
    const t = setTimeout(() => setVisible(true), 50);
    return () => clearTimeout(t);
  }, []);

  const finish = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_KEY, "true");
    } catch {
      // Storage unavailable — silently continue
    }
    setVisible(false);
    // Wait for exit animation
    setTimeout(onComplete, 300);
  }, [onComplete]);

  const next = () => {
    if (step < steps.length - 1) {
      setStep((s) => s + 1);
    } else {
      finish();
    }
  };

  const prev = () => {
    if (step > 0) setStep((s) => s - 1);
  };

  const current = steps[step];
  const isLast = step === steps.length - 1;
  const progress = ((step + 1) / steps.length) * 100;

  return (
    <div
      className={`onboarding-overlay${visible ? " onboarding-overlay--visible" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${id}-title`}
    >
      <div className="onboarding-card">
        {/* Progress bar */}
        <div className="onboarding-progress">
          <div
            className="onboarding-progress__fill"
            style={{ width: `${progress}%` }}
            role="progressbar"
            aria-valuenow={step + 1}
            aria-valuemin={1}
            aria-valuemax={steps.length}
            aria-label={`Step ${step + 1} of ${steps.length}`}
          />
        </div>

        {/* Step indicator */}
        <div className="onboarding-steps" aria-hidden="true">
          {steps.map((_, i) => (
            <button
              key={i}
              className={`onboarding-dot${i === step ? " onboarding-dot--active" : ""}${i < step ? " onboarding-dot--done" : ""}`}
              onClick={() => setStep(i)}
              tabIndex={-1}
              aria-label={`Go to step ${i + 1}`}
            />
          ))}
        </div>

        {/* Content */}
        <div className="onboarding-content" key={step}>
          <span className="onboarding-icon" aria-hidden="true">
            {current.icon}
          </span>
          <h2 id={`${id}-title`} className="onboarding-title">
            {current.title}
          </h2>
          <p className="onboarding-desc">{current.description}</p>
        </div>

        {/* Actions */}
        <div className="onboarding-actions">
          <button
            type="button"
            className="btn-link btn-link--muted"
            onClick={finish}
          >
            Skip
          </button>

          <div className="onboarding-nav">
            {step > 0 && (
              <button type="button" className="btn btn--ghost" onClick={prev}>
                Back
              </button>
            )}
            <button type="button" className="btn btn--primary" onClick={next}>
              {isLast ? "Get Started" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Returns true if onboarding has been completed (or skipped) before */
export function hasCompletedOnboarding(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

/** Reset onboarding state (useful for testing / settings) */
export function resetOnboarding(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
