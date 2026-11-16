import type { ElementType } from "react";

export interface DragEndEvent { active: { id: string }; over: { id: string } | null; }
export interface DragStartEvent { active: { id: string }; }
export const DndContext: ElementType = () => null;
export const DragOverlay: ElementType = () => null;
export const closestCenter: unknown = null;
export const KeyboardSensor: unknown = null;
export const PointerSensor: unknown = null;
export function useSensor(_s: unknown, _o?: unknown): unknown { return null; }
export function useSensors(..._s: unknown[]): unknown { return null; }
export function defaultDropAnimationSideEffects(_o: unknown): unknown { return null; }
