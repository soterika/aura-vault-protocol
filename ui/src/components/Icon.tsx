/**
 * Icon — Issue #1003
 *
 * Canonical wrapper component for all icons in the design system.
 *
 * Usage:
 *   <Icon name="Home" />                          // 24×24, decorative
 *   <Icon name="Home" size={16} />                // 16px inline variant
 *   <Icon name="Home" aria-label="Home" />        // meaningful icon
 *   <Icon name="Home" className="text-blue-500" /> // colour via Tailwind
 *
 * All icons are sourced exclusively from `./Icons` — a single import source
 * enforcing consistent 1.5px stroke weight and viewBox="0 0 24 24".
 */

import type { SVGProps } from "react";
import { Icons } from "./Icons";

// Re-export for consumers who want named icon components directly
export * from "./Icons";
export type { IconProps, IconSize } from "./Icons";

/** The union of all available icon names */
export type IconName = keyof typeof Icons;

export interface IconComponentProps extends SVGProps<SVGSVGElement> {
  /** Name of the icon to render — must be a key of the Icons map */
  name: IconName;
  /**
   * Size in pixels. Pass a number for arbitrary sizes.
   * Predefined shortcuts:
   *   - 16  → inline / small (xs)
   *   - 20  → compact (sm)
   *   - 24  → standard / default (md)
   *   - 32  → large (lg)
   */
  size?: 16 | 20 | 24 | 32 | number;
  /**
   * Accessible label for meaningful (non-decorative) icons.
   * When omitted the icon is marked aria-hidden="true".
   */
  "aria-label"?: string;
}

/**
 * `<Icon>` — single entry point for all icons in the app.
 *
 * Uses `aria-hidden="true"` by default. Provide `aria-label` when the icon
 * conveys meaning that is not already expressed by adjacent visible text.
 *
 * @example
 * // Decorative (no label needed)
 * <Icon name="Home" />
 *
 * // Standalone icon button — provide label
 * <button aria-label="Close">
 *   <Icon name="X" aria-label="Close dialog" />
 * </button>
 */
export function Icon({
  name,
  size = 24,
  "aria-label": ariaLabel,
  ...rest
}: IconComponentProps) {
  const IconComponent = Icons[name];
  return (
    <IconComponent
      size={size}
      label={ariaLabel}
      {...rest}
    />
  );
}

export default Icon;
