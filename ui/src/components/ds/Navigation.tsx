import { createContext, useContext, useState, ReactNode, KeyboardEvent } from 'react';

// ── Tabs ──────────────────────────────────────────────────────────────────
interface TabsCtx { active: string; setActive: (id: string) => void; }
const TabsContext = createContext<TabsCtx>({ active: '', setActive: () => {} });

export interface TabsProps { defaultTab?: string; onChange?: (id: string) => void; children: ReactNode; }
export function Tabs({ defaultTab = '', onChange, children }: TabsProps) {
  const [active, setActiveState] = useState(defaultTab);
  const setActive = (id: string) => { setActiveState(id); onChange?.(id); };
  return (
    <TabsContext.Provider value={{ active, setActive }}>
      <div className="ds-tabs">{children}</div>
    </TabsContext.Provider>
  );
}

export interface TabListProps { children: ReactNode; 'aria-label'?: string; }
export function TabList({ children, 'aria-label': ariaLabel }: TabListProps) {
  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const tabs = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)'));
    const idx  = tabs.indexOf(document.activeElement as HTMLButtonElement);
    if (idx < 0) return;

    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const nextIndex = e.key === 'ArrowRight' ? (idx + 1) % tabs.length : (idx - 1 + tabs.length) % tabs.length;
      const nextTab = tabs[nextIndex];
      nextTab.focus();
      nextTab.click();
    }
    if (e.key === 'Home') { e.preventDefault(); tabs[0].focus(); tabs[0].click(); }
    if (e.key === 'End')  { e.preventDefault(); tabs[tabs.length - 1].focus(); tabs[tabs.length - 1].click(); }
  };
  return <div className="ds-tablist" role="tablist" aria-label={ariaLabel} onKeyDown={handleKeyDown}>{children}</div>;
}

export interface TabProps { id: string; children: ReactNode; disabled?: boolean; }
export function Tab({ id, children, disabled }: TabProps) {
  const { active, setActive } = useContext(TabsContext);
  const isSelected = active === id;
  return (
    <button
      role="tab"
      id={`tab-${id}`}
      aria-selected={isSelected}
      aria-controls={`panel-${id}`}
      className={`ds-tab${isSelected ? ' ds-tab--active' : ''}`}
      tabIndex={isSelected ? 0 : -1}
      disabled={disabled}
      onClick={() => !disabled && setActive(id)}
    >
      {children}
    </button>
  );
}

export interface TabPanelsProps { children: ReactNode; }
export function TabPanels({ children }: TabPanelsProps) {
  return <div className="ds-tabpanels">{children}</div>;
}

export interface TabPanelProps { id: string; children: ReactNode; }
export function TabPanel({ id, children }: TabPanelProps) {
  const { active } = useContext(TabsContext);
  if (active !== id) return null;
  return (
    <div id={`panel-${id}`} role="tabpanel" aria-labelledby={`tab-${id}`} className="ds-tabpanel" tabIndex={0}>
      {children}
    </div>
  );
}

// ── Breadcrumb ────────────────────────────────────────────────────────────
export interface BreadcrumbItem { label: string; href?: string; }
export interface BreadcrumbProps { items: BreadcrumbItem[]; 'aria-label'?: string; }
export function Breadcrumb({ items, 'aria-label': ariaLabel = 'Breadcrumb' }: BreadcrumbProps) {
  return (
    <nav aria-label={ariaLabel} className="ds-breadcrumb">
      <ol>
        {items.map((item, i) => {
          const isCurrent = i === items.length - 1;
          return (
            <li key={i} className="ds-breadcrumb__item">
              {i > 0 && <span className="ds-breadcrumb__sep" aria-hidden="true">/</span>}
              {isCurrent ? (
                <span className="ds-breadcrumb__current" aria-current="page">{item.label}</span>
              ) : item.href ? (
                <a href={item.href} className="ds-breadcrumb__link">{item.label}</a>
              ) : (
                <span className="ds-breadcrumb__link">{item.label}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

// ── Pagination ────────────────────────────────────────────────────────────
export interface PaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  siblingCount?: number;
  'aria-label'?: string;
}

function range(start: number, end: number) {
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}

export function Pagination({ currentPage, totalPages, onPageChange, siblingCount = 1, 'aria-label': ariaLabel = 'Pagination' }: PaginationProps) {
  if (totalPages <= 1) return null;
  const left  = Math.max(1, currentPage - siblingCount);
  const right = Math.min(totalPages, currentPage + siblingCount);
  const pages: (number | '...')[] = [];
  if (left > 1) { pages.push(1); if (left > 2) pages.push('...'); }
  pages.push(...range(left, right));
  if (right < totalPages) { if (right < totalPages - 1) pages.push('...'); pages.push(totalPages); }

  return (
    <nav aria-label={ariaLabel}>
      <div className="ds-pagination">
        <button className="ds-page-btn" onClick={() => onPageChange(currentPage - 1)} disabled={currentPage <= 1} aria-label="Previous page">‹</button>
        {pages.map((p, i) =>
          p === '...' ? (
            <span key={`el-${i}`} className="ds-page-ellipsis" aria-hidden="true">…</span>
          ) : (
            <button
              key={p}
              className="ds-page-btn"
              onClick={() => onPageChange(p as number)}
              aria-current={p === currentPage ? 'page' : undefined}
              aria-label={`Page ${p}`}
            >{p}</button>
          )
        )}
        <button className="ds-page-btn" onClick={() => onPageChange(currentPage + 1)} disabled={currentPage >= totalPages} aria-label="Next page">›</button>
      </div>
    </nav>
  );
}
