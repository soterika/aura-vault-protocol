import type { ElementType } from "react";

export const SortableContext: ElementType = () => null;
export const verticalListSortingStrategy: unknown = null;
export const rectSortingStrategy: unknown = null;
export function useSortable(_o: { id: string }) {
  return {
    attributes: {} as Record<string, unknown>,
    listeners: {} as Record<string, unknown>,
    setNodeRef: (_el: HTMLElement | null) => {},
    setActivatorNodeRef: (_el: HTMLElement | null) => {},
    transform: null as unknown,
    transition: undefined as string | undefined,
    isDragging: false,
  };
}
export function arrayMove<T>(arr: T[], from: number, to: number): T[] {
  const result = [...arr];
  const [removed] = result.splice(from, 1);
  result.splice(to, 0, removed);
  return result;
}
export const sortableKeyboardCoordinates: unknown = null;
