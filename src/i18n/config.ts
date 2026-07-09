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

/**
 * Romanian by default (owner ruling, i18n Stage 2): number/date FORMATTING
 * is complete in both locales, so the no-cookie view keeps today's exact
 * money look (12.345,67 / DD.MM.YYYY); en STRINGS fall back readably until
 * Stages 3–4 fill the ro catalog.
 */
export const DEFAULT_LOCALE: Locale = "ro";

export const LOCALE_COOKIE = "locale";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}
