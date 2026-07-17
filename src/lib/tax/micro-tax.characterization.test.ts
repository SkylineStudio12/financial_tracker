/**
 * CHARACTERIZATION TEST for the micro-tax accrual extraction (Stage 4,
 * amendment 4 step 1). Proves the shared helper produces output identical
 * to the OLD inline block in saveStandardTransaction — the reference below
 * is a FROZEN VERBATIM COPY of that pre-refactor code (same queries, same
 * rounding, same shapes). If the two ever diverge, the refactor changed
 * behavior and this fails.
 *
 * Runs against the dev DB (real seed: Skyline company, Household, the
 * seeded micro_revenue_tax rule). Read-only — no writes.
 * Run: npx tsx src/lib/tax/micro-tax.characterization.test.ts
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { and, eq, isNull } from "drizzle-orm";
import { db, pool } from "@/db";
import { accounts, categories, entities } from "@/db/schema";
import { LedgerValidationError, type AccrualInput, type PostingInput } from "@/lib/ledger/types";
import { parseIngStatement } from "@/lib/import/ing/parse";
import { ENTITY_IDS } from "@/lib/profiles";
import { requireTestDatabase } from "@/lib/test-database-sentinel";
import { planMicroTaxAccrual } from "./micro-tax";
import { getActiveRule, quarterOf, yearOf } from "./rules";

/**
 * FROZEN pre-refactor implementation, copied verbatim from
 * saveStandardTransaction (src/lib/ledger/actions.ts, commit 25aa91d) with
 * only the surrounding variables turned into parameters. DO NOT "improve"
 * this copy — its whole value is staying byte-identical to the old code.
 */
async function frozenReference(params: {
  entityId: string;
  date: string;
  totalRon: number;
  equityId: string;
  basePostingIndex: number;
}): Promise<{ postings: PostingInput[]; accruals: AccrualInput[] }> {
  const postingInputs: PostingInput[] = [];
  const accruals: AccrualInput[] = [];
  const [entity] = await db
    .select({ type: entities.type })
    .from(entities)
    .where(eq(entities.id, params.entityId));
  if (entity?.type === "company") {
    const microRule = await getActiveRule("micro_revenue_tax", params.date);
    const totalRon = params.totalRon;
    const microTax = Math.round((totalRon * microRule.rateBps) / 10_000);
    if (microTax > 0) {
      const [taxAccount] = await db
        .select({ id: accounts.id })
        .from(accounts)
        .where(
          and(
            eq(accounts.entityId, params.entityId),
            eq(accounts.type, "tax_liability"),
            eq(accounts.isActive, true),
            isNull(accounts.deletedAt),
          ),
        );
      if (!taxAccount) {
        throw new LedgerValidationError("tax.companyTaxLiabilityMissing");
      }
      const [taxesCategory] = await db
        .select({ id: categories.id })
        .from(categories)
        .where(
          and(
            eq(categories.entityId, params.entityId),
            eq(categories.name, "Taxes"),
            isNull(categories.deletedAt),
          ),
        );
      if (!taxesCategory) {
        throw new LedgerValidationError("tax.taxesCategoryMissing");
      }
      accruals.push({
        postingIndex: params.basePostingIndex,
        taxRuleId: microRule.id,
        year: yearOf(params.date),
        quarter: quarterOf(params.date),
      });
      postingInputs.push(
        { accountId: taxAccount.id, amount: -microTax },
        { accountId: params.equityId, amount: microTax, categoryId: taxesCategory.id },
      );
    }
  }
  return { postings: postingInputs, accruals };
}

async function main() {
  if (!(await requireTestDatabase(pool, "micro-tax characterization"))) return;
  const [skylineEquity] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(
      and(
        eq(accounts.entityId, ENTITY_IDS.skyline),
        eq(accounts.type, "equity"),
        isNull(accounts.deletedAt),
      ),
    );
  assert.ok(skylineEquity, "Skyline equity account not found in dev DB");

  // The real revenue amount from the committed fixture (HolyCode credit),
  // plus rounding edges around the accrual threshold and a large value.
  const fixture = readFileSync(
    join(import.meta.dirname, "../import/ing/fixtures", "skyline-2026-06.txt"),
    "utf8",
  );
  const stmt = parseIngStatement(fixture);
  const revenueRow = stmt.rows.find((r) => r.direction === "credit");
  assert.ok(revenueRow, "fixture has no credit row");

  const amounts = [revenueRow.amountMinor, 1, 49, 50, 51, 100, 999_999_999];
  let checks = 0;

  for (const amount of amounts) {
    for (const basePostingIndex of [2, 5]) {
      const args = {
        entityId: ENTITY_IDS.skyline,
        date: revenueRow.bookDate,
        equityAccountId: skylineEquity.id,
        revenueRonMinor: amount,
        basePostingIndex,
      };
      const expected = await frozenReference({
        entityId: args.entityId,
        date: args.date,
        totalRon: amount,
        equityId: args.equityAccountId,
        basePostingIndex,
      });
      const actual = await planMicroTaxAccrual(args);
      assert.deepEqual(
        actual,
        expected,
        `divergence at revenueRonMinor=${amount}, basePostingIndex=${basePostingIndex}`,
      );
      checks += 1;
    }
  }
  console.log(
    `  ✓ helper output identical to frozen pre-refactor code for ${amounts.length} amounts × 2 indices (incl. fixture revenue ${revenueRow.amountMinor} bani)`,
  );

  // Non-company entity: both paths must produce NO accrual.
  const household = await planMicroTaxAccrual({
    entityId: ENTITY_IDS.household,
    date: revenueRow.bookDate,
    revenueRonMinor: 100_000,
    equityAccountId: skylineEquity.id,
    basePostingIndex: 2,
  });
  const householdRef = await frozenReference({
    entityId: ENTITY_IDS.household,
    date: revenueRow.bookDate,
    totalRon: 100_000,
    equityId: skylineEquity.id,
    basePostingIndex: 2,
  });
  assert.deepEqual(household, { postings: [], accruals: [] });
  assert.deepEqual(household, householdRef);
  checks += 1;
  console.log("  ✓ household (non-company): no accrual from either implementation");

  // Amendment 5 evidence: the rate is DB-sourced, not a literal anywhere.
  const rule = await getActiveRule("micro_revenue_tax", revenueRow.bookDate);
  console.log(
    `  ✓ rate source: tax_rules row ${rule.id} — ${rule.rateBps} bps (${(rule.rateBps / 100).toFixed(2)}%)${rule.notes?.includes("PLACEHOLDER") ? " [seeded placeholder, accountant-unconfirmed]" : ""}`,
  );
  checks += 1;

  console.log(`\nAll ${checks} characterization checks passed.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
