/**
 * Seed script for local development. Run with: npm run db:seed
 *
 * Seeds entities, accounts, starter categories, and placeholder tax rules.
 * Refuses to run against a non-empty database — drop and re-migrate (or
 * delete the rows) if you need a fresh seed. fx_rates are intentionally not
 * seeded; the BNR sync arrives in a later phase.
 */
import "dotenv/config";
import { db, pool } from "./index";
import { accounts, entities, categories, taxRules } from "./schema";

const PLACEHOLDER_NOTE =
  "PLACEHOLDER — rate must be confirmed against current Romanian legislation before any tax calculation is trusted.";

async function main() {
  const existing = await db.select({ id: entities.id }).from(entities).limit(1);
  if (existing.length > 0) {
    throw new Error("Database already contains entities; refusing to re-seed.");
  }

  await db.transaction(async (tx) => {
    // --- Entities -----------------------------------------------------------
    // Fixed UUIDs: the PROFILES config (src/lib/profiles) resolves companies
    // by entity id, so a fresh seed must reproduce the same ids the config
    // was written against. Do not change these.
    const [household, companyA, companyB] = await tx
      .insert(entities)
      .values([
        {
          id: "428c897c-42b9-401e-845a-8a6a796044a5",
          name: "Household",
          type: "household" as const,
        },
        {
          id: "e6bd79dd-d499-44db-9780-919e8ad4f629",
          name: "Skyline Studio SRL", // Greg's company
          type: "company" as const,
        },
        {
          id: "c831d56d-8fe8-4817-b225-6bb76879d6eb",
          name: "DRMX Digital SRL", // Andra's company
          type: "company" as const,
        },
      ])
      .returning();

    // --- Accounts -----------------------------------------------------------
    // Every entity gets an equity account so opening balances have a
    // counter-leg; each company gets a tax_liability account for accruals.
    // Every real Household account belongs to exactly one person (no joint
    // accounts) — owner is the view filter for the personal profiles, not a
    // bookkeeping split. The structural equity account and company accounts
    // carry no owner.
    await tx.insert(accounts).values([
      { entityId: household.id, name: "Greg — bank", type: "bank", currency: "RON", owner: "greg" as const },
      { entityId: household.id, name: "Greg — cash", type: "cash", currency: "RON", owner: "greg" as const },
      { entityId: household.id, name: "Greg — Revolut brokerage", type: "brokerage", currency: "USD", owner: "greg" as const },
      { entityId: household.id, name: "Andra — bank", type: "bank", currency: "RON", owner: "andra" as const },
      { entityId: household.id, name: "Andra — savings", type: "bank", currency: "RON", owner: "andra" as const },
      // Two SINGLE-currency brokerage accounts (owner decision, Phase 4
      // Stage 1) — not one multi-currency account, consistent with the
      // single-currency + RON-mirror posting model.
      { entityId: household.id, name: "Andra — Revolut brokerage USD", type: "brokerage", currency: "USD", owner: "andra" as const },
      { entityId: household.id, name: "Andra — Revolut brokerage EUR", type: "brokerage", currency: "EUR", owner: "andra" as const },
      { entityId: household.id, name: "Opening equity", type: "equity", currency: "RON" },
      ...[companyA, companyB].flatMap((company) => [
        { entityId: company.id, name: "Company bank", type: "bank" as const, currency: "RON" as const },
        { entityId: company.id, name: "Tax liability", type: "tax_liability" as const, currency: "RON" as const },
        { entityId: company.id, name: "Owner equity", type: "equity" as const, currency: "RON" as const },
      ]),
    ]);

    // --- Categories ---------------------------------------------------------
    // Top-level expense categories (two-level nesting is available but the
    // starter tree is flat). Household categories are scoped to Household;
    // company categories are duplicated per company so each company can
    // rename or extend its own tree independently.
    const householdCategories = [
      "Groceries",
      "Dining",
      "Transport",
      "Housing",
      "Utilities",
      "Health",
      "Leisure",
      "Subscriptions",
      "Travel",
    ];
    const companyCategories = [
      "Software subscriptions",
      "Services",
      "Bank fees",
      "Salaries",
      "Taxes",
    ];

    await tx.insert(categories).values([
      ...householdCategories.map((name) => ({
        entityId: household.id,
        name,
        kind: "expense" as const,
      })),
      ...[companyA, companyB].flatMap((company) =>
        companyCategories.map((name) => ({
          entityId: company.id,
          name,
          kind: "expense" as const,
        })),
      ),
    ]);

    // --- Tax rules (placeholders) -------------------------------------------
    await tx.insert(taxRules).values([
      {
        ruleType: "micro_revenue_tax" as const,
        rateBps: 100,
        notes: `${PLACEHOLDER_NOTE} Micro-enterprise revenue tax; 1% or 3% depending on conditions. Revenue ceiling threshold also unconfirmed.`,
      },
      {
        ruleType: "dividend_tax" as const,
        rateBps: 1600,
        notes: `${PLACEHOLDER_NOTE} Dividend income tax (16% from 2026 per OUG, confirm).`,
      },
      {
        ruleType: "cass_dividend" as const,
        rateBps: 1000,
        notes: `${PLACEHOLDER_NOTE} CASS on dividend income; base is capped in minimum-wage multiples (6/12/24) — thresholds not modeled yet, confirm.`,
      },
      {
        ruleType: "salary_income_tax" as const,
        rateBps: 1000,
        notes: `${PLACEHOLDER_NOTE} Salary income tax (10%).`,
      },
      {
        ruleType: "salary_cas" as const,
        rateBps: 2500,
        notes: `${PLACEHOLDER_NOTE} CAS pension contribution (25%).`,
      },
      {
        ruleType: "salary_cass" as const,
        rateBps: 1000,
        notes: `${PLACEHOLDER_NOTE} CASS health contribution (10%).`,
      },
      {
        ruleType: "cam" as const,
        rateBps: 225,
        notes: `${PLACEHOLDER_NOTE} CAM employer work insurance contribution (2.25%).`,
      },
    ].map((rule) => ({ ...rule, validFrom: "2026-01-01" })));
  });

  const summary = await Promise.all([
    db.$count(entities),
    db.$count(accounts),
    db.$count(categories),
    db.$count(taxRules),
  ]);
  console.log(
    `Seeded: ${summary[0]} entities, ${summary[1]} accounts, ${summary[2]} categories, ${summary[3]} tax rules.`,
  );
}

main()
  .then(() => pool.end())
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
    return pool.end();
  });
