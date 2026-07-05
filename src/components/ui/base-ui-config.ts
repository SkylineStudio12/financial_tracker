"use client";

/**
 * Base UI's animations-finished wait hangs on popup unmount in this
 * environment (verified: popups never unmount even with zero animations on
 * the element). This flag makes Base UI skip that wait — CSS entry
 * animations still play; exits are instant (exit classes removed).
 *
 * Module-level side effect: runs when any Base UI popup component loads,
 * before the first interaction. Imported by dialog.tsx and select.tsx.
 */
if (typeof globalThis !== "undefined") {
  (globalThis as { BASE_UI_ANIMATIONS_DISABLED?: boolean }).BASE_UI_ANIMATIONS_DISABLED = true;
}

export {};
