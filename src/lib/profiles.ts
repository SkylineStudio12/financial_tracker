/**
 * PROFILES — the single source of truth for the sidebar profile switcher.
 *
 * A profile is a presentation-layer selector over the THREE entities, not a
 * bookkeeping unit: the two SRLs map 1:1 to their entity; the two personal
 * profiles are views of the Household entity filtered by account owner; the
 * Household profile is the shared consolidated view (no filter).
 *
 * Companies are resolved by ENTITY ID (owner decision 2026-07-06 — never by
 * name matching; names may change). The seed reproduces these fixed ids, so
 * the config stays valid across database rebuilds. Capability flags (e.g.
 * companyFlows) drive nav visibility — nothing is hardcoded per route.
 */

export type AccountOwner = "greg" | "andra";

export type ProfileSlug = "household" | "greg" | "skyline" | "andra" | "drmx";

export const ENTITY_IDS = {
  household: "428c897c-42b9-401e-845a-8a6a796044a5",
  skyline: "e6bd79dd-d499-44db-9780-919e8ad4f629", // Skyline Studio SRL (Greg's)
  drmx: "c831d56d-8fe8-4817-b225-6bb76879d6eb", // DRMX Digital SRL (Andra's)
} as const;

export interface Profile {
  slug: ProfileSlug;
  /** Display name in the switcher. */
  label: string;
  /** Small subtitle under the label: entity flavor. */
  subtitle: "Shared" | "Personal" | "SRL";
  /** The entity this profile scopes to. */
  entityId: string;
  /** Present only on personal profiles: Household view filtered by owner. */
  owner?: AccountOwner;
  /** Company-only features (salary/dividend flows, micro-tax behavior). */
  companyFlows: boolean;
}

/** Sidebar order fixed by owner decision: each person's personal + company together. */
export const PROFILES: readonly Profile[] = [
  {
    slug: "household",
    label: "Household",
    subtitle: "Shared",
    entityId: ENTITY_IDS.household,
    companyFlows: false,
  },
  {
    slug: "greg",
    label: "Greg",
    subtitle: "Personal",
    entityId: ENTITY_IDS.household,
    owner: "greg",
    companyFlows: false,
  },
  {
    slug: "skyline",
    label: "Skyline Studio SRL",
    subtitle: "SRL",
    entityId: ENTITY_IDS.skyline,
    companyFlows: true,
  },
  {
    slug: "andra",
    label: "Andra",
    subtitle: "Personal",
    entityId: ENTITY_IDS.household,
    owner: "andra",
    companyFlows: false,
  },
  {
    slug: "drmx",
    label: "DRMX Digital SRL",
    subtitle: "SRL",
    entityId: ENTITY_IDS.drmx,
    companyFlows: true,
  },
] as const;

export function getProfile(slug: string): Profile | undefined {
  return PROFILES.find((p) => p.slug === slug);
}
