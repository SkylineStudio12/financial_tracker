import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { accounts, postings } from "@/db/schema";
import { minorToInput } from "@/lib/format";
import { getTransactionDetail } from "@/lib/ledger/queries";
import { getFormOptions } from "@/lib/ledger/form-options";
import { StandardForm, type StandardFormInitial } from "@/components/forms/standard-form";
import { TransferForm, type TransferFormInitial } from "@/components/forms/transfer-form";

export const dynamic = "force-dynamic";

/**
 * Maps a stored transaction back into form values. Only transactions the
 * forms can produce are editable here (standard with one real leg, transfers
 * with two legs); guided-flow transactions get edited via their own flows.
 */
export default async function EditTransactionPage({
  params,
}: {
  params: Promise<{ entityId: string; transactionId: string }>;
}) {
  const { entityId, transactionId } = await params;
  const detail = await getTransactionDetail(transactionId);
  if (!detail) notFound();
  const { transaction, tagNames } = detail;

  const options = await getFormOptions(entityId);

  // Need account ids per posting (detail query returns display fields only).
  const legs = await db
    .select({
      accountId: postings.accountId,
      accountType: accounts.type,
      amount: postings.amount,
      amountRon: postings.amountRon,
      categoryId: postings.categoryId,
      counterparty: postings.counterparty,
    })
    .from(postings)
    .innerJoin(accounts, eq(accounts.id, postings.accountId))
    .where(and(eq(postings.transactionId, transactionId), isNull(postings.deletedAt)));

  const back = (
    <Link
      href={`/e/${entityId}/transactions/${transactionId}`}
      className="text-sm text-accent hover:underline"
    >
      ← Back to detail
    </Link>
  );

  if (transaction.kind === "transfer" && legs.length === 2) {
    const from = legs.find((l) => l.amount < 0);
    const to = legs.find((l) => l.amount > 0);
    if (!from || !to) notFound();
    const initial: TransferFormInitial = {
      transactionId,
      fromAccountId: from.accountId,
      toAccountId: to.accountId,
      date: transaction.date,
      amount: minorToInput(from.amount),
      received: minorToInput(to.amount),
      note: transaction.notes ?? "",
    };
    return (
      <div className="flex flex-col gap-4">
        {back}
        <h1 className="text-lg font-semibold">Edit transfer</h1>
        <TransferForm entityId={entityId} options={options} initial={initial} />
      </div>
    );
  }

  const realLegs = legs.filter((l) => l.accountType !== "equity");
  const equityLegs = legs.filter((l) => l.accountType === "equity");
  if (transaction.kind !== "standard" || realLegs.length !== 1 || equityLegs.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        {back}
        <p className="text-sm text-fg-muted">
          This transaction&apos;s posting shape (guided flow or auto tax accrual) cannot be
          edited with the standard form. Delete and re-create it instead.
        </p>
      </div>
    );
  }

  const bankLeg = realLegs[0];
  const direction = bankLeg.amount < 0 ? "expense" : "income";
  const total = Math.abs(bankLeg.amount);
  // Equity legs store RON; map them back to account-currency split amounts
  // proportionally (identical when the account is RON), fixing the last
  // split so the sum matches the total exactly.
  const equityRonTotal = equityLegs.reduce((sum, l) => sum + Math.abs(l.amountRon), 0);
  const splitAmounts = equityLegs.map((l) =>
    equityRonTotal === 0 ? 0 : Math.round((total * Math.abs(l.amountRon)) / equityRonTotal),
  );
  if (splitAmounts.length > 0) {
    const allocated = splitAmounts.slice(0, -1).reduce((sum, v) => sum + v, 0);
    splitAmounts[splitAmounts.length - 1] = total - allocated;
  }

  const initial: StandardFormInitial = {
    transactionId,
    accountId: bankLeg.accountId,
    date: transaction.date,
    description: transaction.description,
    direction,
    total: minorToInput(total),
    splits: equityLegs.map((leg, index) => ({
      categoryId: leg.categoryId ?? "",
      amount: minorToInput(splitAmounts[index]),
    })),
    tagNames,
    counterparty: bankLeg.counterparty ?? "",
  };

  return (
    <div className="flex flex-col gap-4">
      {back}
      <h1 className="text-lg font-semibold">Edit transaction</h1>
      <StandardForm entityId={entityId} options={options} initial={initial} />
    </div>
  );
}
