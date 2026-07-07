/**
 * Per-entity import knowledge that cannot come from the statement itself.
 * Keyed by ENTITY ID (same rule as PROFILES — never by name).
 */
import { ENTITY_IDS } from "@/lib/profiles";

/**
 * Owner names as the bank prints them on transfer counterparty lines —
 * feeds the classifier's owner_transfer rule. Andra's printed form is
 * unknown until her first DRMX statement; an empty list only means her
 * owner transfers classify as low-confidence transfers for human review,
 * never that they book wrongly.
 */
export const OWNER_BANK_NAMES: Record<string, string[]> = {
  [ENTITY_IDS.skyline]: ["Grigore Filimon"],
  [ENTITY_IDS.drmx]: [],
};

/**
 * Default category SUGGESTION per classifier kind (by category name+kind in
 * the entity's own category set). Suggestions only — the inbox shows them
 * editable and nothing books without explicit confirmation. card_purchase
 * and unknown deliberately have none: the user must pick.
 */
export const SUGGESTED_CATEGORY_BY_KIND: Record<
  string,
  { name: string; kind: "income" | "expense" } | undefined
> = {
  revenue: { name: "Revenue", kind: "income" },
  professional_services: { name: "Services", kind: "expense" },
  subscription: { name: "Software subscriptions", kind: "expense" },
  bank_fee: { name: "Bank fees", kind: "expense" },
};
