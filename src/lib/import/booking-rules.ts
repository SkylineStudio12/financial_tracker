/**
 * Pure booking rules shared across the client/server boundary.
 *
 * The review-inbox client component needs bookingNeedsCategory to decide
 * whether to render the category picker — so this module must stay free of
 * ANY runtime import that reaches the DB (booking.ts → micro-tax.ts →
 * db/index.ts → pg → node:dns, which cannot bundle for the browser).
 * Keep it dependency-free: rules only, no construction, no writes.
 */

/** Kinds whose booking REQUIRES a category on the equity leg. */
const CATEGORY_REQUIRED = new Set([
  "revenue",
  "professional_services",
  "subscription",
  "card_purchase",
  "bank_fee",
  "unknown",
]);

export function bookingNeedsCategory(kind: string): boolean {
  return CATEGORY_REQUIRED.has(kind);
}
