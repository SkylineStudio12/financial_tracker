/**
 * Locale constants shared across the client/server boundary.
 *
 * The sidebar locale toggle (client) and the request config / cookie action
 * (server) both import from here, so this module must stay dependency-free —
 * no next/headers, no DB, nothing that can't bundle for the browser (same
 * rule as import/booking-rules).
 */

export const LOCALES = ["en", "ro"] as const;
export type Locale = (typeof LOCALES)[number];

/** English until the ro catalog is complete (owner decision, i18n Stage 0). */
export const DEFAULT_LOCALE: Locale = "en";

export const LOCALE_COOKIE = "locale";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}
