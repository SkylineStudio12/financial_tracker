import Link from "next/link";
import { transactionKind } from "@/db/schema";
import { formatDate, formatMinor } from "@/lib/format";
import {
  getFilterOptions,
  listTransactions,
  type TransactionFilters,
} from "@/lib/ledger/queries";
import type { TransactionKind } from "@/lib/ledger";
import { RowLink } from "@/components/row-link";

export const dynamic = "force-dynamic";

type SearchParams = { [key: string]: string | string[] | undefined };

const single = (value: string | string[] | undefined) =>
  typeof value === "string" && value !== "" ? value : undefined;

function parseFilters(searchParams: SearchParams): TransactionFilters {
  const kind = single(searchParams.kind);
  return {
    from: single(searchParams.from),
    to: single(searchParams.to),
    accountId: single(searchParams.account),
    categoryId: single(searchParams.category),
    kind: (transactionKind.enumValues as readonly string[]).includes(kind ?? "")
      ? (kind as TransactionKind)
      : undefined,
    tagId: single(searchParams.tag),
    search: single(searchParams.q),
  };
}

function pageHref(searchParams: SearchParams, page: number): string {
  const params = new URLSearchParams();
  for (const key of ["from", "to", "account", "category", "kind", "tag", "q"]) {
    const value = single(searchParams[key]);
    if (value) params.set(key, value);
  }
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `?${query}` : "?";
}

export default async function TransactionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ entityId: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { entityId } = await params;
  const query = await searchParams;
  const filters = parseFilters(query);
  const page = Math.max(1, Number(single(query.page)) || 1);

  const [{ rows, total, pageSize }, options] = await Promise.all([
    listTransactions(entityId, filters, page),
    getFilterOptions(entityId),
  ]);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  const selectClass =
    "bg-surface border border-border-input rounded-input px-2 h-[var(--density-control-height)] text-secondary text-text-primary";
  const labelClass = "flex flex-col gap-1 text-caption text-text-muted";
  const cellClass = "px-[var(--density-row-padding-x)] py-[var(--density-row-padding-y)]";

  return (
    <div className="density-compact flex flex-col gap-[var(--density-section-gap)]">
      <div className="flex items-center justify-between">
        <h1 className="text-title text-text-primary">Transactions</h1>
        <Link
          href={`/e/${entityId}/transactions/new`}
          className="inline-flex items-center rounded-input bg-accent text-accent-foreground px-4 h-[var(--density-control-height)] text-secondary hover:bg-accent-hover"
        >
          New transaction
        </Link>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3">
        <label className={labelClass}>
          From
          <input type="date" name="from" defaultValue={filters.from} className={selectClass} />
        </label>
        <label className={labelClass}>
          To
          <input type="date" name="to" defaultValue={filters.to} className={selectClass} />
        </label>
        <label className={labelClass}>
          Account
          <select name="account" defaultValue={filters.accountId ?? ""} className={selectClass}>
            <option value="">All</option>
            {options.accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          Category
          <select name="category" defaultValue={filters.categoryId ?? ""} className={selectClass}>
            <option value="">All</option>
            {options.categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          Kind
          <select name="kind" defaultValue={filters.kind ?? ""} className={selectClass}>
            <option value="">All</option>
            {transactionKind.enumValues.map((kind) => (
              <option key={kind} value={kind}>
                {kind}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          Tag
          <select name="tag" defaultValue={filters.tagId ?? ""} className={selectClass}>
            <option value="">All</option>
            {options.tags.map((tag) => (
              <option key={tag.id} value={tag.id}>
                {tag.name}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          Search
          <input
            type="text"
            name="q"
            defaultValue={filters.search}
            placeholder="Description…"
            className={selectClass}
          />
        </label>
        <button
          type="submit"
          className="rounded-input bg-accent text-accent-foreground px-4 h-[var(--density-control-height)] text-secondary hover:bg-accent-hover"
        >
          Apply
        </button>
        <Link
          href="?"
          className="inline-flex items-center px-2 h-[var(--density-control-height)] text-secondary text-text-muted hover:text-text-primary"
        >
          Reset
        </Link>
      </form>

      <div className="overflow-x-auto rounded-card border border-border-hairline bg-surface">
        <table className="w-full text-secondary">
          <thead>
            <tr className="text-left text-micro uppercase text-text-muted">
              <th className={`${cellClass} font-normal`}>Date</th>
              <th className={`${cellClass} font-normal`}>Description</th>
              <th className={`${cellClass} font-normal`}>Category</th>
              <th className={`${cellClass} font-normal`}>Tags</th>
              <th className={`${cellClass} font-normal`}>Account</th>
              <th className={`${cellClass} font-normal text-right`}>Amount</th>
              <th className={`${cellClass} font-normal text-right`}>RON</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className={`${cellClass} py-8 text-center text-text-muted`}>
                  No transactions match.
                </td>
              </tr>
            )}
            {rows.map((row) => (
              <RowLink
                key={row.id}
                href={`/e/${entityId}/transactions/${row.id}`}
                className="cursor-pointer border-t border-border-hairline hover:bg-canvas"
              >
                <td className={`${cellClass} whitespace-nowrap text-text-muted`}>
                  {formatDate(row.date)}
                </td>
                <td className={`${cellClass} text-text-primary`}>{row.description}</td>
                <td className={`${cellClass} text-text-secondary`}>{row.category ?? "—"}</td>
                <td className={`${cellClass} text-text-secondary`}>
                  {row.tagNames.join(", ") || "—"}
                </td>
                <td className={`${cellClass} text-text-secondary`}>{row.accountName}</td>
                <td
                  className={`${cellClass} text-right whitespace-nowrap font-numeric tabular-nums ${
                    row.amount < 0 ? "text-status-negative-text" : "text-status-positive-text"
                  }`}
                >
                  {formatMinor(row.amount, row.currency)}
                </td>
                <td
                  className={`${cellClass} text-right whitespace-nowrap font-numeric tabular-nums text-text-muted`}
                >
                  {formatMinor(row.amountRon, "RON")}
                </td>
              </RowLink>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-3 text-secondary text-text-muted">
        <span>
          {total} transaction{total === 1 ? "" : "s"} · page {page} of {pageCount}
        </span>
        {page > 1 && (
          <Link href={pageHref(query, page - 1)} className="text-accent hover:underline">
            ← Newer
          </Link>
        )}
        {page < pageCount && (
          <Link href={pageHref(query, page + 1)} className="text-accent hover:underline">
            Older →
          </Link>
        )}
      </div>
    </div>
  );
}
