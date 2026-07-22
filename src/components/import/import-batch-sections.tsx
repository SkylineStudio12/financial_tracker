import Link from "next/link";
import { Inbox } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { formatDate } from "@/lib/format";

const ICON_PROPS = { absoluteStrokeWidth: true, strokeWidth: 1.5 } as const;

export interface ImportBatchSummary {
  id: string;
  statementNumber: string;
  accountName: string;
  periodStart: string;
  periodEnd: string;
  createdAt: Date;
  pendingCount: number;
  rowCount: number;
}

export function partitionImportBatches(batches: ImportBatchSummary[]) {
  return {
    pending: batches
      .filter((batch) => batch.pendingCount > 0)
      .toSorted((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
    closed: batches
      .filter((batch) => batch.pendingCount === 0)
      .toSorted((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
  };
}

function BatchRows({
  batches,
  profileSlug,
}: {
  batches: ImportBatchSummary[];
  profileSlug: string;
}) {
  const locale = useLocale();
  const t = useTranslations("imports");

  return (
    <ul className="flex flex-col">
      {batches.map((batch) => (
        <li key={batch.id} className="border-b border-border-hairline last:border-b-0">
          <Link
            href={`/p/${profileSlug}/imports/${batch.id}`}
            className="flex items-baseline justify-between gap-3 py-2 outline-none hover:text-accent focus-visible:ring-3 focus-visible:ring-focus-ring"
          >
            <span className="text-secondary text-text-primary">
              {batch.statementNumber} · {batch.accountName}
            </span>
            <span className="text-caption text-text-muted">
              {formatDate(batch.periodStart, locale)}–{formatDate(batch.periodEnd, locale)} ·{" "}
              {t("pendingOfTotal", { pending: batch.pendingCount, total: batch.rowCount })}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function ImportBatchSections({
  batches,
  profileSlug,
}: {
  batches: ImportBatchSummary[];
  profileSlug: string;
}) {
  const t = useTranslations("imports");
  const { pending, closed } = partitionImportBatches(batches);

  return (
    <div className="flex flex-col gap-[var(--density-section-gap)]">
      {pending.length === 0 ? (
        <section className="flex items-start gap-3 py-2" data-testid="import-empty-state">
          <Inbox
            className="size-6 shrink-0 text-text-muted"
            {...ICON_PROPS}
            aria-hidden="true"
            focusable="false"
          />
          <div className="flex flex-col gap-0.5">
            <h2 className="text-card-title text-text-primary">{t("emptyTitle")}</h2>
            <p className="text-secondary text-text-muted">{t("emptyBody")}</p>
          </div>
        </section>
      ) : (
        <section className="flex flex-col gap-2" data-testid="import-pending-batches">
          <h2 className="text-card-title text-text-primary">{t("needsReview")}</h2>
          <BatchRows batches={pending} profileSlug={profileSlug} />
        </section>
      )}

      {closed.length > 0 && (
        <details className="border-t border-border-hairline pt-2">
          <summary className="w-fit cursor-pointer text-secondary text-text-primary outline-none focus-visible:ring-3 focus-visible:ring-focus-ring">
            {t("closedBatches", { count: closed.length })}
          </summary>
          <div className="pt-2">
            <BatchRows batches={closed} profileSlug={profileSlug} />
          </div>
        </details>
      )}
    </div>
  );
}
