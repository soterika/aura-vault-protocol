/**
 * Barrel export for all custom SWR hooks.
 *
 * Import hooks from this file rather than from individual hook files so that
 * the public API is stable even if the internal file layout changes.
 *
 * @example
 * import { useVaultStats, useUserPosition } from "../hooks";
 */
export { useVaultStats } from "./useVaultStats";
export type { UseVaultStatsResult } from "./useVaultStats";

export { useUserPosition } from "./useUserPosition";
export type { UseUserPositionResult } from "./useUserPosition";
