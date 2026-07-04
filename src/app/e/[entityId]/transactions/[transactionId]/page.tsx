import Link from "next/link";
import { notFound } from "next/navigation";
import { DeleteTransactionButton } from "@/components/delete-transaction-button";
import { formatDate, formatImpliedRate, formatMinor } from "@/lib/format";
import { resolveRonRate } from "@/lib/fx";
import { getTransactionDetail } from "@/lib/ledger/queries";

export const dynamic = "force-dynamic";

export default async function TransactionDetailPage({
  params,
}: {
  params: Promise<{ entityId: string; transactionId: string }>;
}) {
  const { entityId, transactionId } = await params;
  const detail = await getTransactionDetail(transactionId);
  if (!detail) notFound();
  const { transaction, postings, tagNames, accruals } = detail;

  // BNR rates applied at the transaction date, one per non-RON currency.
  const currencies = [...new Set(postings.map((p) => p.currency).filter((c) => c !== "RON"))];
  const appliedRates = await Promise.all(
    currencies.map(async (currency) => ({
      currency,
      ...(await resolveRonRate(transaction.date, currency as "EUR" | "USD")),
    })),
  );

  const postingById = new Map(postings.map((p) => [p.id, p]));

  return (
    <div className="flex flex-col gap-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <Link
          href={`/e/${entityId}/transactions`}
          className="text-sm text-accent hover:underline"
        >
          ← Transactions
        </Link>
        <div className="flex items-center gap-2">
          {(transaction.kind === "standard" || transaction.kind === "transfer") && (
            <Link
              href={`/e/${entityId}/transactions/${transaction.id}/edit`}
              className="rounded-md bg-surface-raised border border-edge px-3 py-1.5 text-sm text-fg hover:border-accent"
            >
              Edit
            </Link>
          )}
          <DeleteTransactionButton transactionId={transaction.id} entityId={entityId} />
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">{transaction.description}</h1>
        <div className="text-sm text-fg-muted">
          {formatDate(transaction.date)} · {transaction.kind}
          {tagNames.length > 0 && <> · tags: {tagNames.join(", ")}</>}
        </div>
        {transaction.notes && <p className="text-sm text-fg-muted">{transaction.notes}</p>}
        {appliedRates.length > 0 && (
          <div className="text-sm text-fg-muted">
            Applied FX rate{appliedRates.length > 1 ? "s" : ""}:{" "}
            {appliedRates
              .map((r) => `1 ${r.currency} = ${r.rate} RON (BNR ${r.rateDate})`)
              .join(" · ")}
          </div>
        )}
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-fg-muted">
          Postings
        </h2>
        <div className="overflow-x-auto rounded-md border border-edge">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface text-left text-xs uppercase tracking-wider text-fg-muted">
                <th className="px-3 py-2 font-medium">Account</th>
                <th className="px-3 py-2 font-medium">Category</th>
                <th className="px-3 py-2 font-medium">Counterparty</th>
                <th className="px-3 py-2 font-medium text-right">Amount</th>
                <th className="px-3 py-2 font-medium text-right">RON</th>
                <th className="px-3 py-2 font-medium text-right">Rate</th>
              </tr>
            </thead>
            <tbody>
              {postings.map((posting) => (
                <tr key={posting.id} className="border-t border-edge">
                  <td className="px-3 py-2">{posting.accountName}</td>
                  <td className="px-3 py-2 text-fg-muted">{posting.categoryName ?? "—"}</td>
                  <td className="px-3 py-2 text-fg-muted">{posting.counterparty ?? "—"}</td>
                  <td
                    className={`px-3 py-2 text-right whitespace-nowrap font-mono ${
                      posting.amount < 0 ? "text-negative" : "text-positive"
                    }`}
                  >
                    {formatMinor(posting.amount, posting.currency)}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap font-mono text-fg-muted">
                    {formatMinor(posting.amountRon, "RON")}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap font-mono text-fg-muted">
                    {posting.currency === "RON"
                      ? "—"
                      : formatImpliedRate(posting.amount, posting.amountRon)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {accruals.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-fg-muted">
            Tax accruals
          </h2>
          <div className="overflow-x-auto rounded-md border border-edge">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-surface text-left text-xs uppercase tracking-wider text-fg-muted">
                  <th className="px-3 py-2 font-medium">Rule</th>
                  <th className="px-3 py-2 font-medium">Rate</th>
                  <th className="px-3 py-2 font-medium">Period</th>
                  <th className="px-3 py-2 font-medium text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {accruals.map((accrual) => {
                  const posting = postingById.get(accrual.postingId);
                  return (
                    <tr key={accrual.id} className="border-t border-edge">
                      <td className="px-3 py-2">
                        {accrual.ruleType}
                        {accrual.ruleType === "cass_dividend" && (
                          <span className="ml-2 rounded px-1.5 py-0.5 text-xs bg-surface-raised text-warning">
                            ESTIMATE
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-fg-muted">
                        {(accrual.rateBps / 100).toFixed(2)}%
                      </td>
                      <td className="px-3 py-2 text-fg-muted">
                        {accrual.year}
                        {accrual.quarter ? ` Q${accrual.quarter}` : ""}
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap font-mono text-fg-muted">
                        {posting ? formatMinor(posting.amountRon, "RON") : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
