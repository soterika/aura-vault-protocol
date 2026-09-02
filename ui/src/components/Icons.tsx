import type { SVGProps } from "react";

export type IconSize = "xs" | "sm" | "md" | "lg" | "xl";

const sizePx: Record<IconSize, number> = { xs: 12, sm: 16, md: 20, lg: 24, xl: 32 };

export interface IconProps extends SVGProps<SVGSVGElement> {
  size?: IconSize | number;
  /** Accessible label — omit when icon is purely decorative */
  label?: string;
}

function icon(path: string | JSX.Element, displayName: string) {
  function Icon({ size = "md", label, ...props }: IconProps) {
    const px = typeof size === "number" ? size : sizePx[size];
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width={px}
        height={px}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden={label ? undefined : "true"}
        aria-label={label}
        role={label ? "img" : undefined}
        {...props}
      >
        {typeof path === "string" ? <path d={path} /> : path}
      </svg>
    );
  }
  Icon.displayName = displayName;
  return Icon;
}

/* ── Navigation ─────────────────────────────────────────────────── */
export const IconHome       = icon("M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z", "IconHome");
export const IconArrowLeft  = icon("M19 12H5M12 5l-7 7 7 7", "IconArrowLeft");
export const IconArrowRight = icon("M5 12h14M12 5l7 7-7 7", "IconArrowRight");
export const IconArrowUp    = icon("M12 19V5M5 12l7-7 7 7", "IconArrowUp");
export const IconArrowDown  = icon("M12 5v14M5 12l7 7 7-7", "IconArrowDown");
export const IconChevronLeft  = icon("M15 18l-6-6 6-6", "IconChevronLeft");
export const IconChevronRight = icon("M9 18l6-6-6-6", "IconChevronRight");
export const IconChevronUp    = icon("M18 15l-6-6-6 6", "IconChevronUp");
export const IconChevronDown  = icon("M6 9l6 6 6-6", "IconChevronDown");
export const IconMenu       = icon("M3 12h18M3 6h18M3 18h18", "IconMenu");
export const IconX          = icon("M18 6 6 18M6 6l12 12", "IconX");
export const IconExternalLink = icon("M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3", "IconExternalLink");

/* ── Actions ─────────────────────────────────────────────────────── */
export const IconPlus       = icon("M12 5v14M5 12h14", "IconPlus");
export const IconMinus      = icon("M5 12h14", "IconMinus");
export const IconEdit       = icon("M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4z", "IconEdit");
export const IconTrash      = icon("M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6", "IconTrash");
export const IconCopy       = icon("M20 9H11a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2zM5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 0 2 2v1", "IconCopy");
export const IconDownload   = icon("M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3", "IconDownload");
export const IconUpload     = icon("M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12", "IconUpload");
export const IconSearch     = icon("M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z", "IconSearch");
export const IconFilter     = icon("M22 3H2l8 9.46V19l4 2v-8.54z", "IconFilter");
export const IconRefresh    = icon("M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15", "IconRefresh");
export const IconShare      = icon("M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13", "IconShare");
export const IconZoomIn     = icon("M21 21l-4.35-4.35M11 17A6 6 0 1 0 11 5a6 6 0 0 0 0 12zM11 8v6M8 11h6", "IconZoomIn");
export const IconZoomOut    = icon("M21 21l-4.35-4.35M11 17A6 6 0 1 0 11 5a6 6 0 0 0 0 12zM8 11h6", "IconZoomOut");

/* ── Status / Feedback ───────────────────────────────────────────── */
export const IconCheck      = icon("M20 6 9 17l-5-5", "IconCheck");
export const IconCheckCircle= icon(<><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></>, "IconCheckCircle");
export const IconAlertCircle= icon(<><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></>, "IconAlertCircle");
export const IconAlertTriangle = icon("M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01", "IconAlertTriangle");
export const IconInfo       = icon(<><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></>, "IconInfo");
export const IconXCircle    = icon(<><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></>, "IconXCircle");
export const IconLoader     = icon("M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83", "IconLoader");

/* ── Finance / DeFi ──────────────────────────────────────────────── */
export const IconTrendingUp   = icon("M23 6l-9.5 9.5-5-5L1 18M17 6h6v6", "IconTrendingUp");
export const IconTrendingDown = icon("M23 18l-9.5-9.5-5 5L1 6M17 18h6v-6", "IconTrendingDown");
export const IconDollarSign   = icon("M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6", "IconDollarSign");
export const IconWallet       = icon(<><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"/><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"/><path d="M18 12a2 2 0 0 0 0 4h4v-4z"/></>, "IconWallet");
export const IconBarChart     = icon(<><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></>, "IconBarChart");
export const IconPieChart     = icon(<><path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/></>, "IconPieChart");
export const IconActivity     = icon("M22 12h-4l-3 9L9 3l-3 9H2", "IconActivity");
export const IconLayers       = icon("M12 2 2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5", "IconLayers");
export const IconPercent      = icon(<><line x1="19" y1="5" x2="5" y2="19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/></>, "IconPercent");

/* ── User / Account ──────────────────────────────────────────────── */
export const IconUser         = icon(<><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></>, "IconUser");
export const IconUsers        = icon(<><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></>, "IconUsers");
export const IconLogIn        = icon("M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3", "IconLogIn");
export const IconLogOut       = icon("M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9", "IconLogOut");
export const IconShield       = icon("M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z", "IconShield");
export const IconLock         = icon(<><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></>, "IconLock");
export const IconUnlock       = icon(<><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/></>, "IconUnlock");

/* ── System / Settings ───────────────────────────────────────────── */
export const IconSettings     = icon(<><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></>, "IconSettings");
export const IconSun          = icon(<><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></>, "IconSun");
export const IconMoon         = icon("M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z", "IconMoon");
export const IconBell         = icon(<><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></>, "IconBell");
export const IconGlobe        = icon(<><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></>, "IconGlobe");
export const IconCode         = icon("M16 18l6-6-6-6M8 6l-6 6 6 6", "IconCode");
export const IconLink         = icon("M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71", "IconLink");
export const IconEye          = icon(<><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></>, "IconEye");
export const IconEyeOff       = icon(<><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19M1 1l22 22"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/></>, "IconEyeOff");
export const IconHelpCircle   = icon(<><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></>, "IconHelpCircle");

/* ── Convenience: all icons map ──────────────────────────────────── */
export const Icons = {
  Home: IconHome, ArrowLeft: IconArrowLeft, ArrowRight: IconArrowRight,
  ArrowUp: IconArrowUp, ArrowDown: IconArrowDown,
  ChevronLeft: IconChevronLeft, ChevronRight: IconChevronRight,
  ChevronUp: IconChevronUp, ChevronDown: IconChevronDown,
  Menu: IconMenu, X: IconX, ExternalLink: IconExternalLink,
  Plus: IconPlus, Minus: IconMinus, Edit: IconEdit, Trash: IconTrash,
  Copy: IconCopy, Download: IconDownload, Upload: IconUpload,
  Search: IconSearch, Filter: IconFilter, Refresh: IconRefresh,
  Share: IconShare, ZoomIn: IconZoomIn, ZoomOut: IconZoomOut,
  Check: IconCheck, CheckCircle: IconCheckCircle, AlertCircle: IconAlertCircle,
  AlertTriangle: IconAlertTriangle, Info: IconInfo, XCircle: IconXCircle, Loader: IconLoader,
  TrendingUp: IconTrendingUp, TrendingDown: IconTrendingDown,
  DollarSign: IconDollarSign, Wallet: IconWallet,
  BarChart: IconBarChart, PieChart: IconPieChart, Activity: IconActivity,
  Layers: IconLayers, Percent: IconPercent,
  User: IconUser, Users: IconUsers, LogIn: IconLogIn, LogOut: IconLogOut,
  Shield: IconShield, Lock: IconLock, Unlock: IconUnlock,
  Settings: IconSettings, Sun: IconSun, Moon: IconMoon,
  Bell: IconBell, Globe: IconGlobe, Code: IconCode, Link: IconLink,
  Eye: IconEye, EyeOff: IconEyeOff, HelpCircle: IconHelpCircle,
} as const;
