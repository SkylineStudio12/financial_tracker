/**
 * DEV-ONLY TOOL — schema verification, not part of the application.
 *
 * Proves the schema works end to end: creates a sample salary transaction
 * with three postings (company bank out, personal bank in, tax accrual on
 * the tax_liability account) plus its tax_accruals link inside a single DB
 * transaction, reads everything back, prints the zero-sum check, then
 * deletes the sample so the script is re-runnable and leaves no residue.
 *
 * Run with: npm run db:verify
 * Requires a seeded database (npm run db:seed).
 */
import "dotenv/config";
import { and, eq } from "drizzle-orm";
import { db, pool } from "./index";
import {
  accounts,
  entities,
  postings,
  taxAccruals,
  taxRules,
  transactions,
} from "./schema";

// Sample amounts in bani. Gross 10,000.00 RON: net 5,850.00 to the employee,
// 4,375.00 accrued as taxes (CAS+CASS+income tax+CAM, illustrative only),
// 10,225.00 total out of the company bank. -1_022_500 + 585_000 + 437_500 = 0.
const COMPANY_OUT = -1_022_500;
const NET_IN = 585_000;
const TAXES_ACCRUED = 437_500;

async function requireAccount(entityId: string, name: string) {
  const [account] = await db
    .select()
    .from(accounts)
    .where(and(eq(accounts.entityId, entityId), eq(accounts.name, name)));
  if (!account) throw new Error(`Account "${name}" not found — run db:seed first.`);
  return account;
}

async function main() {
  const [companyA] = await db.select().from(entities).where(eq(entities.name, "Company A"));
  const [household] = await db.select().from(entities).where(eq(entities.name, "Household"));
  if (!companyA || !household) throw new Error("Entities not found — run db:seed first.");

  const companyBank = await requireAccount(companyA.id, "Company bank");
  const taxLiability = await requireAccount(companyA.id, "Tax liability");
  const personalBank = await requireAccount(household.id, "Personal bank");

  const [incomeTaxRule] = await db
    .select()
    .from(taxRules)
    .where(eq(taxRules.ruleType, "salary_income_tax"));
  if (!incomeTaxRule) throw new Error("salary_income_tax rule not found — run db:seed first.");

  // --- Write: one salary transaction, three postings, one accrual link -----
  const transactionId = await db.transaction(async (tx) => {
    const [salary] = await tx
      .insert(transactions)
      .values({
        entityId: companyA.id,
        date: "2026-07-01",
        description: "Sample salary payment (schema verification)",
        kind: "salary",
      })
      .returning();

    const [, , taxPosting] = await tx
      .insert(postings)
      .values([
        {
          transactionId: salary.id,
          accountId: companyBank.id,
          amount: COMPANY_OUT,
          currency: "RON",
          amountRon: COMPANY_OUT,
          counterparty: "Employee",
        },
        {
          transactionId: salary.id,
          accountId: personalBank.id,
          amount: NET_IN,
          currency: "RON",
          amountRon: NET_IN,
          counterparty: "Company A",
        },
        {
          transactionId: salary.id,
          accountId: taxLiability.id,
          amount: TAXES_ACCRUED,
          currency: "RON",
          amountRon: TAXES_ACCRUED,
        },
      ])
      .returning();

    await tx.insert(taxAccruals).values({
      transactionId: salary.id,
      postingId: taxPosting.id,
      taxRuleId: incomeTaxRule.id,
      year: 2026,
      quarter: 3,
    });

    return salary.id;
  });

  // --- Read back ------------------------------------------------------------
  const rows = await db
    .select({
      account: accounts.name,
      amountRon: postings.amountRon,
      counterparty: postings.counterparty,
    })
    .from(postings)
    .innerJoin(accounts, eq(accounts.id, postings.accountId))
    .where(eq(postings.transactionId, transactionId));

  const accrual = await db
    .select({ year: taxAccruals.year, quarter: taxAccruals.quarter })
    .from(taxAccruals)
    .where(eq(taxAccruals.transactionId, transactionId));

  console.log(`Transaction ${transactionId} read back with ${rows.length} postings:`);
  for (const row of rows) {
    const ron = (row.amountRon / 100).toFixed(2).padStart(12);
    console.log(`  ${row.account.padEnd(15)} ${ron} RON  ${row.counterparty ?? ""}`);
  }
  console.log(`Tax accrual link: year ${accrual[0]?.year}, quarter ${accrual[0]?.quarter}`);

  const sum = rows.reduce((total, row) => total + row.amountRon, 0);
  console.log(`Zero-sum check: sum(amount_ron) = ${sum} → ${sum === 0 ? "PASS" : "FAIL"}`);
  if (sum !== 0) process.exitCode = 1;

  // --- Clean up (postings and accrual cascade with the transaction) --------
  await db.delete(transactions).where(eq(transactions.id, transactionId));
  console.log("Sample transaction deleted; database left as it was.");
}

main()
  .then(() => pool.end())
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
    return pool.end();
  });
