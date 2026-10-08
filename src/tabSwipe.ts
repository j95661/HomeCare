import type { ViewName } from "./types";

/** Bottom tabs, left to right. */
export const TAB_ORDER = ["home", "calendar", "messages", "more"] as const;

export type MainTab = (typeof TAB_ORDER)[number];

const SWIPE_DISTANCE = 70;

export function isMainTab(view: string): view is MainTab {
  return (TAB_ORDER as readonly string[]).includes(view);
}

/** Typing, picking a color, and open dialogs keep their own gestures. */
export function swipeStartsOnControl(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return true;
  return Boolean(target.closest("input, textarea, select, .modal-back"));
}

/** A sideways swipe. Left moves toward More. Right moves toward Home. */
export function swipeAxis(dx: number, dy: number): "left" | "right" | null {
  if (Math.abs(dx) < SWIPE_DISTANCE) return null;
  if (Math.abs(dx) < Math.abs(dy) * 1.5) return null;
  return dx < 0 ? "left" : "right";
}

/** The neighboring tab, or null at either end and on screens that are not tabs. */
export function tabInDirection(view: ViewName, axis: "left" | "right"): MainTab | null {
  const index = TAB_ORDER.indexOf(view as MainTab);
  if (index < 0) return null;
  const next = axis === "left" ? index + 1 : index - 1;
  if (next < 0 || next >= TAB_ORDER.length) return null;
  return TAB_ORDER[next];
}
