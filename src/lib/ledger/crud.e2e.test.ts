import "dotenv/config";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, pool } from "@/db";
import {
  accounts,
  auditLog,
  categories,
  importRows,
  importSourceClaims,
  postings,
  taxAccruals,
  taxRules,
  transactionImportLinks,
  transactions,
} from "@/db/schema";
import {
  createTransaction,
  LedgerValidationError,
  purgeTransaction,
  restoreTransaction,
  softDeleteNonInvestmentTransaction,
  softDeleteTransaction,
  updateTransaction,
  type TransactionInput,
} from "@/lib/ledger";
import {
  deleteTransactionAction,
  saveOpeningBalanceTransaction,
  saveStandardTransaction,
} from "@/lib/ledger/actions";
import { saveDividend, saveSalary } from "@/lib/ledger/flow-actions";
import { getTransactionEditDraft } from "@/lib/ledger/edit-drafts";
import { getTransactionDetail, hasLikelyRestoreCollision } from "@/lib/ledger/queries";
import { bookImportRow, createImportBatch } from "@/lib/import/service";
import { setupImportTestEntity, teardownImportTestEntity } from "@/lib/import/test-support";
import { executeTrade } from "@/lib/investments/service";
import { setupTradeTestEntity, teardownTradeTestEntity } from "@/lib/investments/test-support";

const ingFixture = readFileSync(
  join(import.meta.dirname, "..", "import", "ing", "fixtures", "skyline-2026-06.txt"),
  "utf8",
);

let fixtures = 0;
const fixture = async (name: string, work: () => Promise<void>) => {
  await work();
  fixtures += 1;
  console.log(`PASS fixture ${fixtures}: ${name}`);
};

async function expectCode(
  work: Promise<unknown>,
  code: ConstructorParameters<typeof LedgerValidationError>[0],
): Promise<void> {
  await assert.rejects(
    work,
    (error) => error instanceof LedgerValidationError && error.code === code,
  );
}

function expenseInput(
  entityId: string,
  bankAccountId: string,
  equityAccountId: string,
  categoryId: string,
  description: string,
  amount = 1_000,
  date = "2026-06-10",
): TransactionInput {
  return {
    entityId,
    date,
    description,
    kind: "standard",
    postings: [
      { accountId: bankAccountId, amount: -amount },
      { accountId: equityAccountId, amount, categoryId },
    ],
  };
}

async function currentPostingState(transactionId: string) {
  const [transaction] = await db.select().from(transactions).where(eq(transactions.id, transactionId));
  const rows = await db
    .select()
    .from(postings)
    .where(eq(postings.transactionId, transactionId))
    .orderBy(postings.id);
  return { transaction, rows };
}

async function restorableSnapshot(transactionId: string) {
  const { transaction, rows } = await currentPostingState(transactionId);
  const accrualRows = await db
    .select()
    .from(taxAccruals)
    .where(
      and(
        eq(taxAccruals.transactionId, transactionId),
        eq(taxAccruals.revision, transaction.currentRevision),
      ),
    )
    .orderBy(taxAccruals.id);
  const [link] = await db
    .select()
    .from(transactionImportLinks)
    .where(eq(transactionImportLinks.transactionId, transactionId));
  return {
    transaction: {
      id: transaction.id,
      revision: transaction.currentRevision,
      date: transaction.date,
      description: transaction.description,
      kind: transaction.kind,
      notes: transaction.notes,
    },
    postings: rows.map((row) => ({
      id: row.id,
      transactionId: row.transactionId,
      accountId: row.accountId,
      amount: row.amount,
      currency: row.currency,
      amountRon: row.amountRon,
      categoryId: row.categoryId,
      counterparty: row.counterparty,
      counterpartyIban: row.counterpartyIban,
      externalRef: row.externalRef,
      revision: row.revision,
    })),
    accruals: accrualRows.map((row) => ({
      id: row.id,
      transactionId: row.transactionId,
      postingId: row.postingId,
      taxRuleId: row.taxRuleId,
      year: row.year,
      quarter: row.quarter,
      revision: row.revision,
    })),
    import: link
      ? {
          provider: link.provider,
          sourceBatchId: link.sourceBatchId,
          sourceRowId: link.sourceRowId,
          lifecycle: link.lifecycle,
          modifiedAfterImport: link.modifiedAfterImport,
          releasedAt: link.releasedAt,
        }
      : null,
  };
}

async function main(): Promise<void> {
  const databaseName = decodeURIComponent(new URL(process.env.DATABASE_URL!).pathname.slice(1));
  assert.match(databaseName, /_test$/);
  const env = await setupImportTestEntity();
  const fixtureTransactionIds = new Set<string>();
  const track = (id: string) => (fixtureTransactionIds.add(id), id);
  const [secondBank, usdBank] = await db
    .insert(accounts)
    .values([
      { entityId: env.entityId, name: "TEST Second RON", type: "bank", currency: "RON" },
      { entityId: env.entityId, name: "TEST USD", type: "bank", currency: "USD" },
    ])
    .returning();
  const servicesCategory = env.categoryId("Services|expense");
  const softwareCategory = env.categoryId("Software subscriptions|expense");
  const revenueCategory = env.categoryId("Revenue|income");

  try {
    await fixture("description is optional, blank values persist as NULL, and text survives", async () => {
      for (const description of ["", "   ", null, undefined]) {
        const input = expenseInput(
          env.entityId,
          env.bankAccountId,
          env.equityAccountId,
          servicesCategory,
          "placeholder",
        );
        input.description = description;
        const id = track(await createTransaction(input));
        const [transaction] = await db
          .select({ description: transactions.description })
          .from(transactions)
          .where(eq(transactions.id, id));
        assert.equal(transaction.description, null);
      }

      const describedId = track(
        await createTransaction(
          expenseInput(
            env.entityId,
            env.bankAccountId,
            env.equityAccountId,
            servicesCategory,
            "Existing description",
          ),
        ),
      );
      const detail = await getTransactionDetail(describedId);
      assert.equal(detail?.transaction.description, "Existing description");
    });

    await fixture("revenue edit rebuilds micro-tax legs and period through the shared path", async () => {
      const description = "Revenue accrual edit fixture";
      const initialAmount = 1_000_000;
      assert.deepEqual(
        await saveStandardTransaction({
          stay: true,
          entityId: env.entityId,
          accountId: env.bankAccountId,
          date: "2026-07-24",
          description,
          direction: "income",
          totalMinor: initialAmount,
          splits: [{ categoryId: revenueCategory, amountMinor: initialAmount }],
          tagNames: [],
          counterparty: "Fixture client",
        }),
        { ok: true },
      );
      const [revenue] = await db
        .select()
        .from(transactions)
        .where(eq(transactions.description, description));
      track(revenue.id);

      const accrualState = (revision: number) =>
        db
          .select({
            taxRuleId: taxAccruals.taxRuleId,
            rateBps: taxRules.rateBps,
            amount: postings.amount,
            year: taxAccruals.year,
            quarter: taxAccruals.quarter,
          })
          .from(taxAccruals)
          .innerJoin(taxRules, eq(taxRules.id, taxAccruals.taxRuleId))
          .innerJoin(postings, eq(postings.id, taxAccruals.postingId))
          .where(
            and(
              eq(taxAccruals.transactionId, revenue.id),
              eq(taxAccruals.revision, revision),
              isNull(taxAccruals.deletedAt),
            ),
          );
      const postingState = (revision: number) =>
        db
          .select({
            accountType: accounts.type,
            categoryName: categories.name,
            amount: postings.amount,
            amountRon: postings.amountRon,
          })
          .from(postings)
          .innerJoin(accounts, eq(accounts.id, postings.accountId))
          .leftJoin(categories, eq(categories.id, postings.categoryId))
          .where(
            and(
              eq(postings.transactionId, revenue.id),
              eq(postings.revision, revision),
              isNull(postings.deletedAt),
            ),
          );

      const [createdAccrual] = await accrualState(1);
      assert.ok(createdAccrual);
      const createdTax = Math.round((initialAmount * createdAccrual.rateBps) / 10_000);
      assert.equal(createdAccrual.amount, -createdTax);
      const createdRows = await postingState(1);
      assert.equal(createdRows.length, 4);
      assert.equal(
        createdRows.find((row) => row.accountType === "bank")?.amount,
        initialAmount,
      );
      assert.equal(
        createdRows.find((row) => row.categoryName === "Revenue")?.amount,
        -initialAmount,
      );
      assert.equal(
        createdRows.find((row) => row.accountType === "tax_liability")?.amount,
        -createdTax,
      );
      assert.equal(
        createdRows.find((row) => row.categoryName === "Taxes")?.amount,
        createdTax,
      );
      assert.equal(createdRows.reduce((sum, row) => sum + row.amountRon, 0), 0);

      const draft = await getTransactionEditDraft(revenue.id, env.entityId);
      assert.equal(draft.type, "standard");
      if (draft.type !== "standard") throw new Error("expected standard revenue draft");
      assert.equal(draft.direction, "income");
      assert.equal(draft.counterparty, "Fixture client");
      assert.deepEqual(draft.splits, [{ categoryId: revenueCategory, amount: "10000,00" }]);

      const editedAmount = 2_000_000;
      assert.deepEqual(
        await saveStandardTransaction({
          transactionId: revenue.id,
          expectedRevision: 1,
          stay: true,
          entityId: env.entityId,
          accountId: env.bankAccountId,
          date: "2026-10-05",
          description: "",
          direction: "income",
          totalMinor: editedAmount,
          splits: [{ categoryId: revenueCategory, amountMinor: editedAmount }],
          tagNames: [],
          counterparty: "Fixture client",
        }),
        { ok: true },
      );

      const [editedAccrual] = await accrualState(2);
      assert.ok(editedAccrual);
      const editedTax = Math.round((editedAmount * editedAccrual.rateBps) / 10_000);
      assert.equal(editedAccrual.taxRuleId, createdAccrual.taxRuleId);
      assert.equal(editedAccrual.amount, -editedTax);
      assert.equal(editedAccrual.year, 2026);
      assert.equal(editedAccrual.quarter, 4);

      const editedRows = await postingState(2);
      assert.equal(editedRows.length, 4);
      assert.equal(
        editedRows.find((row) => row.accountType === "bank")?.amount,
        editedAmount,
      );
      assert.equal(
        editedRows.find((row) => row.categoryName === "Revenue")?.amount,
        -editedAmount,
      );
      assert.equal(
        editedRows.find((row) => row.accountType === "tax_liability")?.amount,
        -editedTax,
      );
      assert.equal(
        editedRows.find((row) => row.categoryName === "Taxes")?.amount,
        editedTax,
      );
      assert.equal(editedRows.reduce((sum, row) => sum + row.amountRon, 0), 0);
      const [editedTransaction] = await db
        .select()
        .from(transactions)
        .where(eq(transactions.id, revenue.id));
      assert.equal(editedTransaction.currentRevision, 2);
      assert.equal(editedTransaction.description, null);
    });

    await fixture("standard edit matcher still rejects multiple asset legs", async () => {
      const unsupportedId = track(
        await createTransaction({
          entityId: env.entityId,
          date: "2026-07-25",
          description: "Unsupported edit shape",
          kind: "standard",
          postings: [
            { accountId: env.bankAccountId, amount: -1_000 },
            { accountId: secondBank.id, amount: -500 },
            {
              accountId: env.equityAccountId,
              amount: 1_500,
              categoryId: servicesCategory,
            },
          ],
        }),
      );
      await expectCode(
        getTransactionEditDraft(unsupportedId, env.entityId),
        "ledger.transactionShapeUnsupported",
      );
    });

    await fixture("manual expense delete is balanced, tombstoned, audited, and absent", async () => {
      const id = track(
        await createTransaction(
          expenseInput(env.entityId, env.bankAccountId, env.equityAccountId, servicesCategory, "delete me"),
        ),
      );
      const before = await db.execute<{ account_id: string; balance: number }>(sql`
        select account_id, coalesce(sum(amount_ron), 0)::int balance
        from postings where transaction_id = ${id} and deleted_at is null group by account_id
      `);
      await softDeleteNonInvestmentTransaction(id);
      const { transaction, rows } = await currentPostingState(id);
      assert.ok(transaction.deletedAt);
      assert.ok(rows.every((row) => row.deletedAt?.getTime() === transaction.deletedAt?.getTime()));
      assert.equal((await getTransactionDetail(id)), null);
      assert.equal(
        (await db.select().from(auditLog).where(and(eq(auditLog.rowId, id), eq(auditLog.action, "delete")))).length,
        1,
      );
      assert.equal(before.rows.length, 2);
      assert.equal(rows.reduce((sum, row) => sum + row.amountRon, 0), 0);
    });

    const batch = await createImportBatch({
      entityId: env.entityId,
      bankAccountId: env.bankAccountId,
      text: ingFixture,
      ownerNames: ["Grigore Filimon"],
    });
    const batchRows = await db.select().from(importRows).where(eq(importRows.batchId, batch.batchId));
    const byLine = (lineNo: string) => batchRows.find((row) => row.lineNo === lineNo)!;

    let importedRestoreId = "";
    await fixture("batch-owned ING row retains source ownership and blocks duplicate imports", async () => {
      const booked = await bookImportRow({ rowId: byLine("1462").id });
      assert.equal(booked.status, "booked");
      importedRestoreId = track(booked.transactionId!);
      await softDeleteNonInvestmentTransaction(importedRestoreId);
      const [row] = await db.select().from(importRows).where(eq(importRows.id, byLine("1462").id));
      const [link] = await db
        .select()
        .from(transactionImportLinks)
        .where(eq(transactionImportLinks.transactionId, importedRestoreId));
      const [claim] = await db
        .select()
        .from(importSourceClaims)
        .where(eq(importSourceClaims.sourceBatchId, batch.batchId));
      assert.equal(row.status, "trashed");
      assert.equal(link.lifecycle, "trashed");
      assert.equal(claim.releasedAt, null);
      await expectCode(
        createImportBatch({
          entityId: env.entityId,
          bankAccountId: env.bankAccountId,
          text: ingFixture,
          ownerNames: ["Grigore Filimon"],
        }),
        "imports.statementTextAlreadyImported",
      );
      const changedExtraction = await createImportBatch({
        entityId: env.entityId,
        bankAccountId: env.bankAccountId,
        text: `${ingFixture}\n`,
        ownerNames: ["Grigore Filimon"],
      });
      assert.ok(changedExtraction.duplicates >= 1);
    });

    await fixture("amount, date, category, and account edits create clean revisions", async () => {
      const cases = [
        { label: "amount", accountId: env.bankAccountId, date: "2026-06-10", amount: 1_250, category: servicesCategory },
        { label: "date", accountId: usdBank.id, date: "2026-06-11", amount: 1_000, category: servicesCategory },
        { label: "category", accountId: env.bankAccountId, date: "2026-06-10", amount: 1_000, category: softwareCategory },
        { label: "account", accountId: secondBank.id, date: "2026-06-10", amount: 1_000, category: servicesCategory },
      ];
      for (const edit of cases) {
        const initialAccount = edit.label === "date" ? usdBank.id : env.bankAccountId;
        const id = track(
          await createTransaction({
            ...expenseInput(env.entityId, initialAccount, env.equityAccountId, servicesCategory, `edit ${edit.label}`),
            postings:
              edit.label === "date"
                ? [
                    { accountId: usdBank.id, amount: -1_000, amountRon: -4_600 },
                    { accountId: env.equityAccountId, amount: 4_600, amountRon: 4_600, categoryId: servicesCategory },
                  ]
                : expenseInput(env.entityId, initialAccount, env.equityAccountId, servicesCategory, `edit ${edit.label}`).postings,
          }),
        );
        const result = await saveStandardTransaction({
          transactionId: id,
          expectedRevision: 1,
          stay: true,
          entityId: env.entityId,
          accountId: edit.accountId,
          date: edit.date,
          description: `edited ${edit.label}`,
          direction: "expense",
          totalMinor: edit.amount,
          splits: [{ categoryId: edit.category, amountMinor: edit.amount }],
          tagNames: [],
        });
        assert.deepEqual(result, { ok: true });
        const { transaction, rows } = await currentPostingState(id);
        assert.equal(transaction.currentRevision, 2);
        assert.equal(rows.filter((row) => row.revision === 1 && row.deletedAt !== null).length, 2);
        assert.equal(rows.filter((row) => row.revision === 2 && row.deletedAt === null).length, 2);
        assert.equal(
          rows.filter((row) => row.revision === 2).reduce((sum, row) => sum + row.amountRon, 0),
          0,
        );
        assert.equal(
          (await db.select().from(auditLog).where(and(eq(auditLog.rowId, id), eq(auditLog.action, "update")))).length,
          1,
        );
      }
    });

    await fixture("guided and special-form adapters preserve shape and accrual links", async () => {
      const [personal] = await db
        .select({ id: accounts.id })
        .from(accounts)
        .where(and(eq(accounts.owner, "greg"), inArray(accounts.type, ["bank", "cash"]), isNull(accounts.deletedAt)))
        .limit(1);
      assert.ok(personal);
      assert.deepEqual(
        await saveSalary({
          stay: true,
          companyId: env.entityId,
          employeeName: "CRUD Employee",
          payMonth: "2026-05",
          paymentDate: "2026-06-10",
          grossMinor: 450_000,
          casMinor: 112_500,
          cassMinor: 45_000,
          incomeTaxMinor: 23_000,
          camMinor: 10_100,
          netMinor: 269_500,
          personalDeductionMinor: 45_000,
          personalAccountId: personal.id,
        }),
        { ok: true },
      );
      const [salary] = await db
        .select()
        .from(transactions)
        .where(eq(transactions.description, "Salary CRUD Employee 2026-05"));
      track(salary.id);
      const salaryBefore = await db.select().from(taxAccruals).where(eq(taxAccruals.transactionId, salary.id));
      assert.deepEqual(
        await saveSalary({
          transactionId: salary.id,
          expectedRevision: 1,
          stay: true,
          companyId: env.entityId,
          employeeName: "CRUD Employee",
          payMonth: "2026-05",
          paymentDate: "2026-06-10",
          grossMinor: 460_000,
          casMinor: 115_000,
          cassMinor: 46_000,
          incomeTaxMinor: 24_000,
          camMinor: 10_300,
          netMinor: 275_000,
          personalDeductionMinor: 45_000,
          personalAccountId: personal.id,
        }),
        { ok: true },
      );
      const salaryAfter = await db.select().from(taxAccruals).where(eq(taxAccruals.transactionId, salary.id));
      assert.ok(salaryBefore.every((row) => salaryAfter.find((next) => next.id === row.id)?.deletedAt));
      assert.ok(salaryAfter.filter((row) => row.revision === 2).every((row) => row.deletedAt === null));

      assert.deepEqual(
        await saveDividend({
          stay: true,
          companyId: env.entityId,
          date: "2026-06-15",
          grossMinor: 100_000,
          personalAccountId: personal.id,
        }),
        { ok: true },
      );
      const [dividend] = await db
        .select()
        .from(transactions)
        .where(eq(transactions.description, "Dividend distribution 2026-06-15"));
      track(dividend.id);
      assert.deepEqual(
        await saveDividend({
          transactionId: dividend.id,
          expectedRevision: 1,
          stay: true,
          companyId: env.entityId,
          date: "2026-06-15",
          grossMinor: 110_000,
          personalAccountId: personal.id,
        }),
        { ok: true },
      );
      const salaryDraft = await getTransactionEditDraft(salary.id, env.entityId);
      assert.equal(salaryDraft.type, "salary");
      if (salaryDraft.type !== "salary") throw new Error("expected salary draft");
      assert.deepEqual(
        {
          payMonth: salaryDraft.payMonth,
          paymentDate: salaryDraft.paymentDate,
          gross: salaryDraft.gross,
          cas: salaryDraft.cas,
          cass: salaryDraft.cass,
          incomeTax: salaryDraft.incomeTax,
          cam: salaryDraft.cam,
          net: salaryDraft.net,
        },
        {
          payMonth: "2026-05",
          paymentDate: "2026-06-10",
          gross: "4600,00",
          cas: "1150,00",
          cass: "460,00",
          incomeTax: "240,00",
          cam: "103,00",
          net: "2750,00",
        },
      );
      assert.equal((await getTransactionEditDraft(dividend.id, env.entityId)).type, "dividend");

      const openingId = track(
        await createTransaction({
          entityId: env.entityId,
          date: "2026-01-01",
          description: "Opening fixture",
          kind: "opening_balance",
          postings: [
            { accountId: env.bankAccountId, amount: 10_000 },
            { accountId: env.equityAccountId, amount: -10_000 },
          ],
        }),
      );
      assert.deepEqual(
        await saveOpeningBalanceTransaction({
          transactionId: openingId,
          expectedRevision: 1,
          entityId: env.entityId,
          accountId: env.bankAccountId,
          date: "2026-01-01",
          description: "Opening fixture edited",
          amountMinor: 11_000,
        }),
        { ok: true },
      );
      assert.equal((await getTransactionEditDraft(openingId, env.entityId)).type, "opening_balance");

      const custodyId = track(
        await createTransaction({
          ...expenseInput(env.entityId, env.bankAccountId, env.equityAccountId, servicesCategory, "Custody fee"),
          kind: "trade",
        }),
      );
      const custodyDraft = await getTransactionEditDraft(custodyId, env.entityId);
      assert.equal(custodyDraft.type, "standard");
      assert.equal(custodyDraft.type === "standard" && custodyDraft.storedKind, "trade");
    });

    let importedEditedId = "";
    await fixture("imported edit keeps ownership and marks provenance modified", async () => {
      const booked = await bookImportRow({ rowId: byLine("1464").id });
      importedEditedId = track(booked.transactionId!);
      const before = await db
        .select()
        .from(transactionImportLinks)
        .where(eq(transactionImportLinks.transactionId, importedEditedId));
      const current = await currentPostingState(importedEditedId);
      await updateTransaction(
        importedEditedId,
        {
          entityId: env.entityId,
          date: current.transaction.date,
          description: "Imported, owner corrected",
          kind: current.transaction.kind,
          postings: current.rows
            .filter((row) => row.deletedAt === null)
            .map((row) => ({
              accountId: row.accountId,
              amount: row.amount,
              amountRon: row.amountRon,
              categoryId: row.categoryId,
            })),
        },
        1,
      );
      const [after] = await db
        .select()
        .from(transactionImportLinks)
        .where(eq(transactionImportLinks.transactionId, importedEditedId));
      const [staging] = await db.select().from(importRows).where(eq(importRows.id, byLine("1464").id));
      assert.equal(after.id, before[0].id);
      assert.equal(after.transactionId, importedEditedId);
      assert.ok(after.modifiedAfterImport);
      assert.equal(staging.status, "booked");
      assert.equal(staging.modifiedAfterImport, true);
    });

    await fixture("restore reactivates the exact stored semantic state", async () => {
      await restoreTransaction(importedRestoreId, 1);
      const before = await restorableSnapshot(importedRestoreId);
      await softDeleteNonInvestmentTransaction(importedRestoreId);
      await restoreTransaction(importedRestoreId, 1);
      assert.deepEqual(await restorableSnapshot(importedRestoreId), before);

      const changedTopology = track(
        await createTransaction(
          expenseInput(env.entityId, env.bankAccountId, env.equityAccountId, servicesCategory, "restore topology"),
        ),
      );
      await softDeleteNonInvestmentTransaction(changedTopology);
      await db.insert(postings).values({
        transactionId: changedTopology,
        accountId: env.bankAccountId,
        amount: 1,
        currency: "RON",
        amountRon: 1,
        revision: 1,
        deletedAt: new Date(0),
      });
      await expectCode(
        restoreTransaction(changedTopology, 1),
        "ledger.transactionRestoreTopologyChanged",
      );
    });

    await fixture("restore collision warns but explicit restore succeeds", async () => {
      const input = expenseInput(
        env.entityId,
        env.bankAccountId,
        env.equityAccountId,
        servicesCategory,
        "collision fixture",
      );
      const original = track(await createTransaction(input));
      await softDeleteNonInvestmentTransaction(original);
      track(await createTransaction(input));
      assert.equal(await hasLikelyRestoreCollision(original), true);
      await restoreTransaction(original, 1);
      assert.equal((await currentPostingState(original)).transaction.deletedAt, null);
    });

    await fixture("permanent delete releases ownership and permits deliberate re-import", async () => {
      const first = await bookImportRow({ rowId: byLine("1466").id });
      const survivor = await bookImportRow({ rowId: byLine("1461").id, categoryId: servicesCategory });
      const purgedId = track(first.transactionId!);
      track(survivor.transactionId!);
      await expectCode(purgeTransaction(purgedId), "ledger.transactionPurgeRequiresTrash");
      await softDeleteNonInvestmentTransaction(purgedId);
      await purgeTransaction(purgedId);
      fixtureTransactionIds.delete(purgedId);
      assert.equal((await db.select().from(transactions).where(eq(transactions.id, purgedId))).length, 0);
      const [released] = await db
        .select()
        .from(transactionImportLinks)
        .where(eq(transactionImportLinks.transactionId, purgedId));
      assert.equal(released, undefined);
      const reimport = await createImportBatch({
        entityId: env.entityId,
        bankAccountId: env.bankAccountId,
        text: ingFixture,
        ownerNames: ["Grigore Filimon"],
      });
      assert.notEqual(reimport.batchId, batch.batchId);
      const rows = await db.select().from(importRows).where(eq(importRows.batchId, reimport.batchId));
      assert.equal(rows.find((row) => row.lineNo === "1461")?.status, "duplicate");
      assert.equal(rows.find((row) => row.lineNo === "1466")?.status, "pending");
      const rebooked = await bookImportRow({ rowId: rows.find((row) => row.lineNo === "1466")!.id });
      assert.equal(rebooked.status, "booked");
      track(rebooked.transactionId!);
    });

    await fixture("investment rows are disabled in queries and CRUD-1 actions", async () => {
      const tradeEnv = await setupTradeTestEntity();
      try {
        const buy = await executeTrade({
          kind: "buy",
          accountId: tradeEnv.cashAccountId,
          positionAccountId: tradeEnv.positionAccountId,
          securityId: tradeEnv.securityId,
          date: "2032-01-01",
          quantity: "2",
          priceMinor: 1_000,
          totalMinor: 2_000,
          totalRonMinor: 9_200,
        });
        const sell = await executeTrade({
          kind: "sell",
          accountId: tradeEnv.cashAccountId,
          securityId: tradeEnv.securityId,
          date: "2032-01-02",
          quantity: "1",
          priceMinor: 1_100,
          totalMinor: 1_100,
          totalRonMinor: 5_060,
        });
        for (const id of [buy.transactionId, sell.transactionId]) {
          assert.equal((await getTransactionDetail(id))?.crudAvailable, false);
          const result = await deleteTransactionAction(id, tradeEnv.entityId, undefined, true);
          assert.equal(result && "error" in result && result.error.code, "ledger.investmentCrudUnavailable");
          await expectCode(
            updateTransaction(id, expenseInput(tradeEnv.entityId, tradeEnv.cashAccountId, tradeEnv.equityAccountId, tradeEnv.categoryId("Brokerage fees"), "blocked", 100)),
            "ledger.investmentCrudUnavailable",
          );
        }
        await softDeleteTransaction(sell.transactionId);
        await expectCode(restoreTransaction(sell.transactionId, 1), "ledger.investmentCrudUnavailable");
        await softDeleteTransaction(buy.transactionId);
      } finally {
        await teardownTradeTestEntity(tradeEnv);
      }
    });

    await fixture("concurrent edits and edit/delete serialize to one complete state", async () => {
      const first = track(
        await createTransaction(
          expenseInput(env.entityId, env.bankAccountId, env.equityAccountId, servicesCategory, "concurrent edit"),
        ),
      );
      const [a, b] = await Promise.allSettled([
        updateTransaction(first, expenseInput(env.entityId, env.bankAccountId, env.equityAccountId, servicesCategory, "winner a", 1_100), 1),
        updateTransaction(first, expenseInput(env.entityId, env.bankAccountId, env.equityAccountId, servicesCategory, "winner b", 1_200), 1),
      ]);
      assert.equal([a, b].filter((result) => result.status === "fulfilled").length, 1);
      const rejected = [a, b].find((result) => result.status === "rejected") as PromiseRejectedResult;
      assert.equal(rejected.reason.code, "ledger.transactionRevisionConflict");
      const firstState = await currentPostingState(first);
      assert.equal(firstState.rows.filter((row) => row.deletedAt === null).length, 2);

      const second = track(
        await createTransaction(
          expenseInput(env.entityId, env.bankAccountId, env.equityAccountId, servicesCategory, "edit delete race"),
        ),
      );
      await Promise.allSettled([
        updateTransaction(second, expenseInput(env.entityId, env.bankAccountId, env.equityAccountId, servicesCategory, "edited race", 1_300), 1),
        softDeleteNonInvestmentTransaction(second),
      ]);
      const secondState = await currentPostingState(second);
      const currentRows = secondState.rows.filter(
        (row) => row.revision === secondState.transaction.currentRevision,
      );
      assert.ok(
        (secondState.transaction.deletedAt === null && currentRows.every((row) => row.deletedAt === null)) ||
          (secondState.transaction.deletedAt !== null && currentRows.every((row) => row.deletedAt !== null)),
      );
      assert.equal(currentRows.reduce((sum, row) => sum + row.amountRon, 0), 0);
    });

    assert.equal(fixtures, 13);
  } finally {
    const ids = [...fixtureTransactionIds];
    if (ids.length > 0) {
      await db.delete(auditLog).where(and(eq(auditLog.tableName, "transactions"), inArray(auditLog.rowId, ids)));
    }
    await teardownImportTestEntity(env.entityId);
    const residue = await db.select({ count: sql<number>`count(*)::int` }).from(transactions).where(eq(transactions.entityId, env.entityId));
    assert.equal(residue[0].count, 0);
  }
  console.log("PASS fixtures 1-13 and zero fixture residue");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
