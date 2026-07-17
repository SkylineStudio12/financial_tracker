import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { TransactionRowActions } from "@/components/transaction-row-actions";
import { formatBpsPercent, formatDate, formatImpliedRate, formatMinor } from "@/lib/format";
import { resolveRonRate } from "@/lib/fx";
import { getFormOptions } from "@/lib/ledger/form-options";
import { getTransactionDetail } from "@/lib/ledger/queries";
import { getProfile } from "@/lib/profiles";

export const dynamic = "force-dynamic";

export default async function TransactionDetailPage({
  params,
}: {
  params: Promise<{ profile: string; transactionId: string }>;
}) {
  const { profile: slug, transactionId } = await params;
  const profile = getProfile(slug);
  if (!profile) notFound();
  // Non-UUID segments (e.g. a stale /transactions/new URL) must 404 rather
  // than reach Postgres as an invalid uuid.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(transactionId)) {
    notFound();
  }
  const locale = await getLocale();
  const t = await getTranslations("transactions");
  const tEnums = await getTranslations("enums");
  const tCommon = await getTranslations("common");
  const detail = await getTransactionDetail(transactionId, profile);
  if (!detail) notFound();
  const { transaction, postings, tagNames, accruals, crudAvailable, importLink } = detail;
  const formOptions = await getFormOptions(profile.entityId, profile.owner);

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
    <div className="density-compact flex flex-col gap-[var(--density-section-gap)] max-w-4xl">
      <div className="flex items-center justify-between">
        <Link
          href={`/p/${profile.slug}/transactions`}
          className="text-secondary text-accent hover:underline"
        >
          {t("backToList")}
        </Link>
        <TransactionRowActions
          transactionId={transaction.id}
          entityId={profile.entityId}
          profileSlug={profile.slug}
          crudAvailable={crudAvailable}
          importBatchId={importLink?.sourceBatchId ?? null}
          importSourceLabel={importLink?.sourceLabel ?? null}
          options={formOptions}
        />
      </div>

      <div className="flex flex-col gap-1">
        <h1 className="text-card-title text-text-primary">{transaction.description}</h1>
        <div className="text-secondary text-text-muted">
          {formatDate(transaction.date, locale)} · {tEnums(`transactionKind.${transaction.kind}`)}
          {tagNames.length > 0 && <> · {t("detailTags", { names: tagNames.join(", ") })}</>}
        </div>
        {transaction.notes && <p className="text-secondary text-text-muted">{transaction.notes}</p>}
        {appliedRates.length > 0 && (
          <div className="text-secondary text-text-muted">
            {t("appliedRates", { count: appliedRates.length })}{" "}
            {appliedRates
              .map((r) =>
                t("bnrRate", { currency: r.currency, rate: r.rate, date: formatDate(r.rateDate, locale) }),
              )
              .join(" · ")}
          </div>
        )}
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-micro uppercase text-text-muted">
          {t("postings")}
        </h2>
        <div className="overflow-x-auto rounded-card border border-border-hairline bg-surface">
          <table className="w-full text-secondary">
            <thead>
              <tr className="text-left text-micro uppercase text-text-muted">
                <th className="px-[var(--density-row-padding-x)] py-[var(--density-row-padding-y)] font-normal">{t("colAccount")}</th>
                <th className="px-[var(--density-row-padding-x)] py-[var(--density-row-padding-y)] font-normal">{t("colCategory")}</th>
                <th className="px-[var(--density-row-padding-x)] py-[var(--density-row-padding-y)] font-normal">{t("colCounterparty")}</th>
                <th className="px-[var(--density-row-padding-x)] py-[var(--density-row-padding-y)] font-normal text-right">{t("colAmount")}</th>
                <th className="px-[var(--density-row-padding-x)] py-[var(--density-row-padding-y)] font-normal text-right">RON</th>
                <th className="px-[var(--density-row-padding-x)] py-[var(--density-row-padding-y)] font-normal text-right">{t("colRate")}</th>
              </tr>
            </thead>
            <tbody>
              {postings.map((posting) => (
                <tr key={posting.id} className="border-t border-border-hairline">
                  <td className="px-[var(--density-row-padding-x)] py-[var(--density-row-padding-y)] text-text-primary">{posting.accountName}</td>
                  <td className="px-[var(--density-row-padding-x)] py-[var(--density-row-padding-y)] text-text-secondary">{posting.categoryName ?? "—"}</td>
                  <td className="px-[var(--density-row-padding-x)] py-[var(--density-row-padding-y)] text-text-secondary">{posting.counterparty ?? "—"}</td>
                  <td
                    className={`px-[var(--density-row-padding-x)] py-[var(--density-row-padding-y)] text-right whitespace-nowrap font-numeric tabular-nums ${
                      posting.amount < 0 ? "text-status-negative-text" : "text-status-positive-text"
                    }`}
                  >
                    {formatMinor(posting.amount, posting.currency, locale)}
                  </td>
                  <td className="px-[var(--density-row-padding-x)] py-[var(--density-row-padding-y)] text-right whitespace-nowrap font-numeric tabular-nums text-text-muted">
                    {formatMinor(posting.amountRon, "RON", locale)}
                  </td>
                  <td className="px-[var(--density-row-padding-x)] py-[var(--density-row-padding-y)] text-right whitespace-nowrap font-numeric tabular-nums text-text-muted">
                    {posting.currency === "RON"
                      ? "—"
                      : formatImpliedRate(posting.amount, posting.amountRon, locale)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {accruals.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-micro uppercase text-text-muted">
            {t("taxAccruals")}
          </h2>
          <div className="overflow-x-auto rounded-card border border-border-hairline bg-surface">
            <table className="w-full text-secondary">
              <thead>
                <tr className="text-left text-micro uppercase text-text-muted">
                  <th className="px-[var(--density-row-padding-x)] py-[var(--density-row-padding-y)] font-normal">{t("colRule")}</th>
                  <th className="px-[var(--density-row-padding-x)] py-[var(--density-row-padding-y)] font-normal">{t("colRate")}</th>
                  <th className="px-[var(--density-row-padding-x)] py-[var(--density-row-padding-y)] font-normal">{t("colPeriod")}</th>
                  <th className="px-[var(--density-row-padding-x)] py-[var(--density-row-padding-y)] font-normal text-right">{t("colAmount")}</th>
                </tr>
              </thead>
              <tbody>
                {accruals.map((accrual) => {
                  const posting = postingById.get(accrual.postingId);
                  return (
                    <tr key={accrual.id} className="border-t border-border-hairline">
                      <td className="px-[var(--density-row-padding-x)] py-[var(--density-row-padding-y)] text-text-primary">
                        {tEnums(`taxRuleType.${accrual.ruleType}`)}
                        {accrual.ruleType === "cass_dividend" && (
                          <span className="ml-2 rounded-badge px-1.5 py-0.5 text-micro uppercase bg-surface-inactive text-status-warning-text">
                            {tCommon("estimate")}
                          </span>
                        )}
                      </td>
                      <td className="px-[var(--density-row-padding-x)] py-[var(--density-row-padding-y)] text-text-secondary">
                        {formatBpsPercent(accrual.rateBps, locale, { minFractionDigits: 2 })}
                      </td>
                      <td className="px-[var(--density-row-padding-x)] py-[var(--density-row-padding-y)] text-text-secondary">
                        {accrual.quarter
                          ? tCommon("periodQuarter", { year: accrual.year, quarter: accrual.quarter })
                          : accrual.year}
                      </td>
                      <td className="px-[var(--density-row-padding-x)] py-[var(--density-row-padding-y)] text-right whitespace-nowrap font-numeric tabular-nums text-text-muted">
                        {posting ? formatMinor(posting.amountRon, "RON", locale) : "—"}
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
