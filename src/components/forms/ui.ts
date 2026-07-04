/**
 * Shared form styling — semantic tokens only (docs/design-tokens.md), so the
 * system restyles every form from globals.css without touching form logic.
 * Forms live in compact density; control height comes from the density var.
 */
export const fieldClass =
  "bg-surface border border-border-input rounded-input px-3 h-[var(--density-control-height)] text-secondary text-text-primary w-full";
export const labelClass = "flex flex-col gap-1 text-caption text-text-muted";
export const primaryButtonClass =
  "rounded-input bg-accent text-accent-foreground px-4 h-[var(--density-control-height)] text-secondary hover:bg-accent-hover disabled:opacity-50";
export const ghostButtonClass =
  "px-2 h-[var(--density-control-height)] text-secondary text-text-muted hover:text-text-primary";
export const errorClass = "text-secondary text-status-negative-text";
export const toggleOnClass =
  "rounded-input bg-accent text-accent-foreground px-3 h-[var(--density-control-height)] text-secondary";
export const toggleOffClass =
  "rounded-input border border-border-input px-3 h-[var(--density-control-height)] text-secondary text-text-muted hover:text-text-primary";
