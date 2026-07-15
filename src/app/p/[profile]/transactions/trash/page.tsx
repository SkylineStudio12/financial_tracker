import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { formatDate, formatDateTime, formatMinor } from "@/lib/format";
import { listDeletedTransactions } from "@/lib/ledger/queries";
import { getProfile } from "@/lib/profiles";
import { TrashRowActions } from "@/components/trash-row-actions";

export const dynamic = "force-dynamic";

export default async function TransactionTrashPage({
  params,
}: {
  params: Promise<{ profile: string }>;
}) {
  const { profile: slug } = await params;
  const profile = getProfile(slug);
  if (!profile) notFound();
  const [rows, locale, t] = await Promise.all([
    listDeletedTransactions(profile.entityId, profile.owner),
    getLocale(),
    getTranslations("transactions"),
  ]);
  const cell = "px-[var(--density-row-padding-x)] py-[var(--density-row-padding-y)]";

  return (
    <div className="density-compact flex flex-col gap-[var(--density-section-gap)]">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-1">
          <Link href={`/p/${profile.slug}/transactions`} className="text-secondary text-accent hover:underline">
            {t("backToList")}
          </Link>
          <h1 className="text-title text-text-primary">{t("trashTitle")}</h1>
        </div>
        <span className="text-secondary text-text-muted">{profile.label}</span>
      </div>
      <div className="overflow-x-auto rounded-card border border-border-hairline bg-surface">
        <table className="w-full text-secondary">
          <thead>
            <tr className="text-left text-micro uppercase text-text-muted">
              <th className={`${cell} font-normal`}>{t("colDate")}</th>
              <th className={`${cell} font-normal`}>{t("colDescription")}</th>
              <th className={`${cell} font-normal`}>{t("colAccount")}</th>
              <th className={`${cell} font-normal`}>{t("deletedAt")}</th>
              <th className={`${cell} font-normal text-right`}>{t("colAmount")}</th>
              <th className={`${cell} font-normal text-right`}>{t("colActions")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className={`${cell} py-8 text-center text-text-muted`}>
                  {t("trashEmpty")}
                </td>
              </tr>
            )}
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-border-hairline">
                <td className={`${cell} whitespace-nowrap text-text-muted`}>{formatDate(row.date, locale)}</td>
                <td className={`${cell} text-text-primary`}>
                  <div>{row.description}</div>
                  {row.importSourceLabel && (
                    <div className="text-caption text-text-muted">{row.importSourceLabel}</div>
                  )}
                </td>
                <td className={`${cell} text-text-muted`}>{row.accountName}</td>
                <td className={`${cell} whitespace-nowrap text-text-muted`}>{formatDateTime(row.deletedAt, locale)}</td>
                <td className={`${cell} whitespace-nowrap text-right font-numeric tabular-nums text-text-muted`}>
                  {formatMinor(row.amount, row.currency, locale)}
                </td>
                <td className={`${cell} w-44`}>
                  <TrashRowActions
                    transactionId={row.id}
                    expectedRevision={row.currentRevision}
                    crudAvailable={row.crudAvailable}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
