/**
 * Opening balances — booked, never set.
 *
 * A company's opening bank balance is pre-tracking OWNER EQUITY: the funds
 * accumulated before the ledger started tracking. It is a two-leg entry like
 * any other (bank +X / owner equity −X) and MUST route through the single
 * write path so the RON zero-sum invariant is enforced — this module never
 * writes a balance directly.
 *
 * This helper is shared by the seed (reproducible across resets) and the
 * one-off live-mirror script, so both book the IDENTICAL transaction by
 * construction rather than two hand-copied call sites that could drift.
 *
 * TX-SEAM NOTE: createTransaction validates accounts via the POOL, not a
 * passed tx handle, so the referenced accounts must already be COMMITTED when
 * this runs. The seed therefore calls this AFTER its main transaction commits.
 */
import { and, eq, isNull } from "drizzle-orm";
import { db } from "./index";
import { accounts } from "./schema";
import { createTransaction } from "@/lib/ledger/service";

/** Skyline Studio SRL — fixed entity id (see seed). */
export const SKYLINE_ENTITY_ID = "e6bd79dd-d499-44db-9780-919e8ad4f629";

/**
 * 40,988.95 RON — the opening balance printed on Skyline's June 2026 ING
 * statement (batch f9929a4a, opening_balance_minor). Dated the day before the
 * statement's 02.06 opening so the import's booked movements flow from it and
 * the closing 59,012.95 becomes a true ledger balance.
 */
export const SKYLINE_OPENING_BALANCE_MINOR = 4_098_895;
export const SKYLINE_OPENING_BALANCE_DATE = "2026-06-01";

async function accountId(entityId: string, name: string): Promise<string> {
  const [row] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(
      and(
        eq(accounts.entityId, entityId),
        eq(accounts.name, name),
        isNull(accounts.deletedAt),
      ),
    );
  if (!row) {
    throw new Error(`Opening balance: account "${name}" not found for entity ${entityId}`);
  }
  return row.id;
}

/**
 * Book Skyline's bank opening balance through createTransaction. Returns the
 * new transaction id. Idempotency is NOT built in: the seed runs once against
 * an empty DB, and the live mirror is a deliberate one-off — running it twice
 * would book a second opening balance.
 */
export async function bookSkylineOpeningBalance(): Promise<string> {
  const companyBankId = await accountId(SKYLINE_ENTITY_ID, "Company bank");
  const ownerEquityId = await accountId(SKYLINE_ENTITY_ID, "Owner equity");
  return createTransaction({
    entityId: SKYLINE_ENTITY_ID,
    date: SKYLINE_OPENING_BALANCE_DATE,
    kind: "opening_balance",
    description: "Opening balance — Company bank (statement CSV 02.06.2026)",
    postings: [
      // Bank +40,988.95 / Owner equity −40,988.95; both RON, so amountRon
      // mirrors amount and the pair sums to zero. Uncategorized: an opening
      // balance is not tracked-period P&L.
      { accountId: companyBankId, amount: SKYLINE_OPENING_BALANCE_MINOR },
      { accountId: ownerEquityId, amount: -SKYLINE_OPENING_BALANCE_MINOR },
    ],
  });
}
