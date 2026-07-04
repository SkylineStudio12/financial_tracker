/**
 * Shared form styling — token-based utility strings only, so the design
 * phase can restyle every form from here without touching form logic.
 */
export const fieldClass =
  "bg-surface border border-edge rounded-md px-2 py-1.5 text-sm text-fg w-full";
export const labelClass = "flex flex-col gap-1 text-xs text-fg-muted";
export const primaryButtonClass =
  "rounded-md bg-surface-raised border border-edge px-3 py-1.5 text-sm text-fg hover:border-accent disabled:opacity-50";
export const ghostButtonClass = "px-2 py-1.5 text-sm text-fg-muted hover:text-fg";
export const errorClass = "text-sm text-negative";
export const toggleOnClass =
  "rounded-md border border-accent bg-surface-raised px-3 py-1.5 text-sm text-fg";
export const toggleOffClass =
  "rounded-md border border-edge px-3 py-1.5 text-sm text-fg-muted hover:text-fg";
