import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { transactionKind } from "@/db/schema";
import { getProfile } from "@/lib/profiles";
import { formatDate, formatMinor, formatMinorNumber } from "@/lib/format";
import {
  getFilterOptions,
  listTransactions,
  type TransactionFilters,
} from "@/lib/ledger/queries";
import { getFormOptions } from "@/lib/ledger/form-options";
import type { TransactionKind } from "@/lib/ledger";
import { NewTransactionDialog } from "@/components/new-transaction-dialog";
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

/**
 * Money color by MEANING, read from the stored kind/sign (display only):
 * a transfer is a movement, not a loss — it renders neutral, never red.
 */
function amountTone(kind: TransactionKind, amount: number): string {
  if (kind === "transfer") return "text-status-neutral-text";
  return amount < 0 ? "text-status-negative-text" : "text-status-positive-text";
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
  params: Promise<{ profile: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { profile: slug } = await params;
  const profile = getProfile(slug);
  if (!profile) notFound();
  const { entityId, owner } = profile;
  const locale = await getLocale();
  const t = await getTranslations("transactions");
  const tEnums = await getTranslations("enums");
  const query = await searchParams;
  const filters = parseFilters(query);
  const page = Math.max(1, Number(single(query.page)) || 1);

  const [{ rows, total, pageSize }, options, formOptions] = await Promise.all([
    listTransactions(entityId, filters, page, owner),
    getFilterOptions(entityId, owner),
    getFormOptions(entityId, owner),
  ]);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  // Compact pill filters: quiet by default so the data stays the focus;
  // a pill asserts itself on interaction (focus ring, search grows) and
  // keeps the stronger input border while its filter is applied.
  const pill = (active: boolean) =>
    `flex items-center gap-1.5 rounded-pill border bg-surface pl-3 pr-2 h-[var(--density-control-height)] text-caption transition-colors focus-within:border-border-input focus-within:ring-2 focus-within:ring-focus-ring ${
      active ? "border-border-input text-text-secondary" : "border-border-hairline text-text-muted"
    }`;
  const pillControl = "bg-transparent text-secondary text-text-primary outline-none";
  const cellClass = "px-[var(--density-row-padding-x)] py-[var(--density-row-padding-y)]";

  return (
    <div className="density-compact flex flex-col gap-[var(--density-section-gap)]">
      <div className="flex items-center justify-between">
        <h1 className="text-title text-text-primary">{t("title")}</h1>
        <NewTransactionDialog entityId={entityId} profileSlug={profile.slug} options={formOptions} />
      </div>

      <form method="get" className="flex flex-wrap items-center gap-2">
        <label className={pill(Boolean(filters.from))}>
          {t("filterFrom")}
          <input type="date" name="from" defaultValue={filters.from} className={pillControl} />
        </label>
        <label className={pill(Boolean(filters.to))}>
          {t("filterTo")}
          <input type="date" name="to" defaultValue={filters.to} className={pillControl} />
        </label>
        <label className={pill(Boolean(filters.accountId))}>
          {t("filterAccount")}
          <select name="account" defaultValue={filters.accountId ?? ""} className={pillControl}>
            <option value="">{t("all")}</option>
            {options.accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
        </label>
        <label className={pill(Boolean(filters.categoryId))}>
          {t("filterCategory")}
          <select name="category" defaultValue={filters.categoryId ?? ""} className={pillControl}>
            <option value="">{t("all")}</option>
            {options.categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>
        <label className={pill(Boolean(filters.kind))}>
          {t("filterKind")}
          <select name="kind" defaultValue={filters.kind ?? ""} className={pillControl}>
            <option value="">{t("all")}</option>
            {transactionKind.enumValues.map((kind) => (
              <option key={kind} value={kind}>
                {tEnums(`transactionKind.${kind}`)}
              </option>
            ))}
          </select>
        </label>
        <label className={pill(Boolean(filters.tagId))}>
          {t("filterTag")}
          <select name="tag" defaultValue={filters.tagId ?? ""} className={pillControl}>
            <option value="">{t("all")}</option>
            {options.tags.map((tag) => (
              <option key={tag.id} value={tag.id}>
                {tag.name}
              </option>
            ))}
          </select>
        </label>
        <label className={pill(Boolean(filters.search))}>
          {t("filterSearch")}
          <input
            type="text"
            name="q"
            defaultValue={filters.search}
            placeholder={t("searchPlaceholder")}
            className={`${pillControl} w-24 transition-[width] duration-200 focus:w-48`}
          />
        </label>
        <button
          type="submit"
          className="rounded-pill bg-accent text-accent-foreground px-4 h-[var(--density-control-height)] text-secondary hover:bg-accent-hover"
        >
          {t("apply")}
        </button>
        <Link
          href="?"
          className="inline-flex items-center px-2 h-[var(--density-control-height)] text-secondary text-text-muted hover:text-text-primary"
        >
          {t("reset")}
        </Link>
      </form>

      <div className="overflow-x-auto rounded-card border border-border-hairline bg-surface">
        <table className="w-full text-secondary">
          <thead>
            <tr className="text-left text-micro uppercase text-text-muted">
              <th className={`${cellClass} font-normal`}>{t("colDate")}</th>
              <th className={`${cellClass} font-normal`}>{t("colDescription")}</th>
              <th className={`${cellClass} font-normal`}>{t("colCategory")}</th>
              <th className={`${cellClass} font-normal`}>{t("colTags")}</th>
              <th className={`${cellClass} font-normal`}>{t("colAccount")}</th>
              <th className={`${cellClass} font-normal text-right`}>{t("colAmount")}</th>
              <th className={`${cellClass} font-normal text-right`}>RON</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className={`${cellClass} py-8 text-center text-text-muted`}>
                  {t("noMatch")}
                </td>
              </tr>
            )}
            {rows.map((row) => (
              <RowLink
                key={row.id}
                href={`/p/${profile.slug}/transactions/${row.id}`}
                className="cursor-pointer border-t border-border-hairline hover:bg-canvas"
              >
                {/* Number-first hierarchy: the amount anchors the row; date,
                    category, tags, and account are muted metadata. */}
                <td className={`${cellClass} whitespace-nowrap text-text-muted`}>
                  {formatDate(row.date, locale)}
                </td>
                <td className={`${cellClass} text-text-primary`}>{row.description}</td>
                <td className={`${cellClass} text-text-muted`}>
                  {row.splitCount ? t("split", { count: row.splitCount }) : (row.category ?? "—")}
                </td>
                <td className={`${cellClass} text-text-muted`}>
                  {row.tagNames.join(", ") || "—"}
                </td>
                <td className={`${cellClass} text-text-muted`}>{row.accountName}</td>
                <td
                  className={`${cellClass} text-right whitespace-nowrap font-numeric tabular-nums font-medium ${amountTone(row.kind, row.amount)}`}
                >
                  {formatMinorNumber(row.amount, locale)}
                  <span className="ml-1 font-normal text-text-muted">{row.currency}</span>
                </td>
                <td
                  className={`${cellClass} text-right whitespace-nowrap font-numeric tabular-nums text-text-muted`}
                >
                  {formatMinor(row.amountRon, "RON", locale)}
                </td>
              </RowLink>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-3 text-secondary text-text-muted">
        <span>
          {t("pagination", { total, page, pageCount })}
        </span>
        {page > 1 && (
          <Link href={pageHref(query, page - 1)} className="text-accent hover:underline">
            {t("newer")}
          </Link>
        )}
        {page < pageCount && (
          <Link href={pageHref(query, page + 1)} className="text-accent hover:underline">
            {t("older")}
          </Link>
        )}
      </div>
    </div>
  );
}
