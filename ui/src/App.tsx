import { useState, lazy, Suspense } from "react";
import { Toast } from "./components/Toast";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { OnboardingFlow, hasCompletedOnboarding } from "./components/OnboardingFlow";
import { Skeleton } from "./components/Skeleton";
import type { ToastMessage } from "./components/Toast";

const DepositForm = lazy(() => import("./components/DepositForm").then((m) => ({ default: m.DepositForm })));
const WithdrawForm = lazy(() => import("./components/WithdrawForm").then((m) => ({ default: m.WithdrawForm })));
const HarvestPanel = lazy(() => import("./components/HarvestPanel").then((m) => ({ default: m.HarvestPanel })));
const PerformanceCharts = lazy(() => import("./components/PerformanceCharts").then((m) => ({ default: m.PerformanceCharts })));

type Tab = "deposit" | "withdraw" | "harvest" | "performance";

function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  return (
    <button
      onClick={toggleTheme}
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
      style={{ background:"transparent", border:"none", cursor:"pointer", color:"var(--color-text-muted)", display:"flex", alignItems:"center", padding:"var(--sp-1)" }}
    >
      {theme === "dark" ? <IconSun size="md" /> : <IconMoon size="md" />}
    </button>
  );
}

export default function App() {
  const [tab, setTab] = useState<Tab>("deposit");
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(
    () => !hasCompletedOnboarding()
  );

  const notify = (msg: ToastMessage) => setToast(msg);

  return (
    <ErrorBoundary>
      <div className="app">
        <a href="#main" className="skip-link">
          Skip to main content
        </a>

        <header className="app-header" role="banner">
          <h1>Aura Vault</h1>
        </header>

        <main id="main" className="app-main">
          <nav aria-label="Vault actions">
            <div className="tab-list" role="tablist">
              {(["deposit", "withdraw", "harvest", "performance"] as Tab[]).map((t) => (
                <button
                  key={t}
                  role="tab"
                  aria-selected={tab === t}
                  aria-controls={`panel-${t}`}
                  id={`tab-${t}`}
                  className={`tab-btn${tab === t ? " tab-btn--active" : ""}`}
                  onClick={() => setTab(t)}
                >
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
          </nav>

          <div
            id={`panel-${tab}`}
            role="tabpanel"
            aria-labelledby={`tab-${tab}`}
            className="tab-panel"
          >
            <Suspense fallback={<Skeleton rows={3} />}>
              {tab === "deposit" && <DepositForm onToast={notify} />}
              {tab === "withdraw" && <WithdrawForm onToast={notify} />}
              {tab === "harvest" && <HarvestPanel onToast={notify} />}
              {tab === "performance" && <PerformanceCharts />}
            </Suspense>
          </div>
        </main>

      {toast && <Toast message={toast} onDismiss={() => setToast(null)} />}

      {showOnboarding && (
        <OnboardingFlow onComplete={() => setShowOnboarding(false)} />
      )}
    </div>
    </ErrorBoundary>
  );
}
