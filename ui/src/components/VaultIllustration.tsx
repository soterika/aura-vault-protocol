/**
 * VaultIllustration — abstract vault / growth SVG motif for the empty state.
 *
 * The illustration depicts a stylised vault door with upward-trending growth
 * lines, communicating "your funds are secure and growing".
 */
export function VaultIllustration({
  className,
  width = 200,
  height = 180,
}: {
  className?: string;
  width?: number;
  height?: number;
}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 200 180"
      width={width}
      height={height}
      className={className}
      aria-label="Abstract illustration of a vault with upward growth lines, representing secure and growing yield"
      role="img"
      focusable="false"
    >
      {/* Glow / ambient background */}
      <defs>
        <radialGradient id="vaultGlow" cx="50%" cy="60%" r="50%">
          <stop offset="0%" stopColor="#7c83fd" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#7c83fd" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="vaultBody" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#2a2e45" />
          <stop offset="100%" stopColor="#1a1d27" />
        </linearGradient>
        <linearGradient id="growthLine" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0%" stopColor="#4caf84" stopOpacity="0.6" />
          <stop offset="100%" stopColor="#7c83fd" />
        </linearGradient>
        <filter id="glow">
          <feGaussianBlur stdDeviation="2" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Ambient glow */}
      <ellipse cx="100" cy="110" rx="80" ry="60" fill="url(#vaultGlow)" />

      {/* Vault body */}
      <rect
        x="40"
        y="50"
        width="120"
        height="100"
        rx="10"
        ry="10"
        fill="url(#vaultBody)"
        stroke="#7c83fd"
        strokeWidth="1.5"
        strokeOpacity="0.5"
      />

      {/* Vault door circle — outer ring */}
      <circle
        cx="100"
        cy="100"
        r="36"
        fill="none"
        stroke="#7c83fd"
        strokeWidth="2"
        strokeOpacity="0.6"
      />

      {/* Vault door circle — inner ring */}
      <circle
        cx="100"
        cy="100"
        r="24"
        fill="#22263a"
        stroke="#7c83fd"
        strokeWidth="1.5"
        strokeOpacity="0.4"
      />

      {/* Vault handle / dial spokes */}
      {[0, 60, 120, 180, 240, 300].map((angle) => {
        const rad = (angle * Math.PI) / 180;
        return (
          <line
            key={angle}
            x1={100 + 18 * Math.cos(rad)}
            y1={100 + 18 * Math.sin(rad)}
            x2={100 + 24 * Math.cos(rad)}
            y2={100 + 24 * Math.sin(rad)}
            stroke="#7c83fd"
            strokeWidth="1.5"
            strokeOpacity="0.7"
          />
        );
      })}

      {/* Vault dial centre */}
      <circle cx="100" cy="100" r="5" fill="#7c83fd" fillOpacity="0.8" />

      {/* Growth chart — rising line */}
      <polyline
        points="52,138 68,128 82,134 96,116 112,120 126,104 140,96 155,80"
        fill="none"
        stroke="url(#growthLine)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        filter="url(#glow)"
      />

      {/* Growth chart — arrow head */}
      <polyline
        points="149,76 155,80 151,86"
        fill="none"
        stroke="url(#growthLine)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Sparkles / stars */}
      <circle cx="162" cy="54" r="2.5" fill="#7c83fd" fillOpacity="0.9" />
      <circle cx="38"  cy="70" r="1.8" fill="#4caf84" fillOpacity="0.7" />
      <circle cx="170" cy="90" r="1.5" fill="#4caf84" fillOpacity="0.6" />
    </svg>
  );
}
