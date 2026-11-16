import React from "react";

export interface IconProps extends React.SVGProps<SVGSVGElement> {
  size?: number;
  className?: string;
  label?: string;
}

/**
 * Inline SVG Icon: Aura Vault Protocol Logo
 */
export function AuraLogoIcon({ size = 24, className = "", label, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? "img" : undefined}
      {...props}
    >
      <rect width="32" height="32" rx="8" fill="currentColor" fillOpacity="0.1" />
      <path
        d="M16 6L25 11.2V21.6L16 26.8L7 21.6V11.2L16 6Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <circle cx="16" cy="16" r="4" fill="currentColor" />
    </svg>
  );
}

/**
 * Inline SVG Icon: Freighter Wallet
 */
export function FreighterIcon({ size = 20, className = "", label, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? "img" : undefined}
      {...props}
    >
      <circle cx="12" cy="12" r="10" fill="#4B32C3" />
      <path
        d="M12 6L14.5 10.5H19L15.5 13.5L17 18L12 15L7 18L8.5 13.5L5 10.5H9.5L12 6Z"
        fill="white"
      />
    </svg>
  );
}

/**
 * Inline SVG Icon: MetaMask Wallet
 */
export function MetaMaskIcon({ size = 20, className = "", label, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? "img" : undefined}
      {...props}
    >
      <path
        d="M21.5 5.5L13.5 11.5L15 7.5L21.5 5.5Z"
        fill="#E2761B"
        stroke="#E2761B"
        strokeWidth="0.5"
      />
      <path
        d="M2.5 5.5L10.4 11.6L9 7.5L2.5 5.5Z"
        fill="#E4761B"
        stroke="#E4761B"
        strokeWidth="0.5"
      />
      <path
        d="M18.8 16.5L16.5 20.2L21 21.5L22.2 16.4L18.8 16.5Z"
        fill="#E4761B"
        stroke="#E4761B"
        strokeWidth="0.5"
      />
      <path
        d="M1.8 16.4L3 21.5L7.5 20.2L5.2 16.5L1.8 16.4Z"
        fill="#E4761B"
        stroke="#E4761B"
        strokeWidth="0.5"
      />
      <path
        d="M7.2 10.5L9 14.5L5.5 14.3L7.2 10.5Z"
        fill="#D7C1B3"
      />
      <path
        d="M16.8 10.5L15 14.5L18.5 14.3L16.8 10.5Z"
        fill="#D7C1B3"
      />
      <path
        d="M9 14.5L12 17.5L15 14.5L16.8 10.5L12 8.5L7.2 10.5L9 14.5Z"
        fill="#233447"
      />
    </svg>
  );
}

/**
 * Inline SVG Icon: Coinbase Wallet
 */
export function CoinbaseIcon({ size = 20, className = "", label, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? "img" : undefined}
      {...props}
    >
      <circle cx="12" cy="12" r="10" fill="#0052FF" />
      <rect x="7" y="7" width="10" height="10" rx="3" fill="white" />
      <circle cx="12" cy="12" r="2.5" fill="#0052FF" />
    </svg>
  );
}

/**
 * Inline SVG Icon: WalletConnect
 */
export function WalletConnectIcon({ size = 20, className = "", label, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? "img" : undefined}
      {...props}
    >
      <circle cx="12" cy="12" r="10" fill="#3B99FC" />
      <path
        d="M8.2 10.2C10.3 8.1 13.7 8.1 15.8 10.2L16.3 10.7C16.5 10.9 16.5 11.2 16.3 11.4L15.3 12.4C15.2 12.5 15 12.5 14.9 12.4L14.2 11.7C13 10.5 11 10.5 9.8 11.7L9.1 12.4C9 12.5 8.8 12.5 8.7 12.4L7.7 11.4C7.5 11.2 7.5 10.9 7.7 10.7L8.2 10.2ZM17.8 12.2L18.7 13.1C18.9 13.3 18.9 13.6 18.7 13.8L15.6 16.9C15.4 17.1 15.1 17.1 14.9 16.9L12.5 14.5C12.4 14.4 12.3 14.4 12.2 14.4C12.1 14.4 12 14.4 11.9 14.5L9.5 16.9C9.3 17.1 9 17.1 8.8 16.9L5.7 13.8C5.5 13.6 5.5 13.3 5.7 13.1L6.6 12.2C6.8 12 7.1 12 7.3 12.2L9.7 14.6C9.8 14.7 10 14.7 10.1 14.6L12.5 12.2C12.7 12 13 12 13.2 12.2L15.6 14.6C15.7 14.7 15.9 14.7 16 14.6L18.4 12.2C18.2 12 18 12 17.8 12.2Z"
        fill="white"
      />
    </svg>
  );
}

/**
 * SVG Sprite Sheet Icon Component
 * Loads symbols from /sprite.svg
 */
export function SpriteIcon({
  name,
  size = 20,
  className = "",
  label,
  ...props
}: IconProps & { name: string }) {
  return (
    <svg
      width={size}
      height={size}
      className={className}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? "img" : undefined}
      {...props}
    >
      <use href={`/sprite.svg#icon-${name}`} />
    </svg>
  );
}

/**
 * Helper to render wallet icon by wallet type string
 */
export function WalletIcon({ type, size = 18 }: { type: string; size?: number }) {
  const normalized = type.toLowerCase();
  switch (normalized) {
    case "freighter":
      return <FreighterIcon size={size} />;
    case "metamask":
      return <MetaMaskIcon size={size} />;
    case "coinbase":
      return <CoinbaseIcon size={size} />;
    case "walletconnect":
      return <WalletConnectIcon size={size} />;
    default:
      return <SpriteIcon name="wallet" size={size} />;
  }
}
