import type { CSSProperties } from "react";

export type EntryType = "standard" | "transfer" | "salary";

export const SEGMENT_MIN_WIDTH_REM = 9;
export const SEGMENT_GRID_STYLE = {
  gridTemplateColumns: `repeat(auto-fit, minmax(${SEGMENT_MIN_WIDTH_REM}rem, 1fr))`,
} satisfies CSSProperties;

export type TypeChangeDecision =
  | { kind: "noop" }
  | { kind: "select"; type: EntryType }
  | { kind: "confirm"; type: EntryType };

export function decideEntryTypeChange(
  current: EntryType,
  requested: unknown,
  dirty: boolean,
): TypeChangeDecision {
  if (requested !== "standard" && requested !== "transfer" && requested !== "salary") {
    return { kind: "noop" };
  }
  if (requested === current) return { kind: "noop" };
  return dirty ? { kind: "confirm", type: requested } : { kind: "select", type: requested };
}
