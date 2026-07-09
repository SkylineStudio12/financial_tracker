import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { getProfile } from "@/lib/profiles";
import { formatDate, formatMinor } from "@/lib/format";
import { getImportBatch } from "@/lib/import/queries";
import {
  parseStoredClassifyReason,
  type ClassifiedRow,
  type ClassifyReason,
  type Confidence,
  type ImportKind,
} from "@/lib/import/ing/classify";
import { ImportInbox } from "@/components/import/import-inbox";

export const dynamic = "force-dynamic";

export default async function ImportBatchPage({
  params,
}: {
  params: Promise<{ profile: string; batchId: string }>;
}) {
  const { profile: slug, batchId } = await params;
  const profile = getProfile(slug);
  if (!profile || !profile.companyFlows) notFound();

  const locale = await getLocale();
  const t = await getTranslations("imports");
  const data = await getImportBatch(batchId, profile.entityId);
  if (!data) notFound();
  const { batch, rows, categories } = data;

  const inboxRows = rows.map((r) => {
    const classified = r.payload as ClassifiedRow;
    return {
      id: r.id,
      lineNo: r.lineNo,
      kind: r.kind as ImportKind,
      confidence: r.confidence as Confidence,
      reason:
        parseStoredClassifyReason(r.reason) ??
        parseStoredClassifyReason(classified.reason) ??
        ({ code: "noClassificationRule" } satisfies ClassifyReason),
      status: r.status,
      overlapSuspect: r.overlapSuspect,
      resolvedExternalRef: r.resolvedExternalRef,
      suggestedCategoryId: r.suggestedCategoryId,
      transactionId: r.transactionId,
      bookDate: classified.row.bookDate,
      direction: classified.row.direction,
      amountMinor: classified.row.amountMinor,
      counterpartyName: classified.row.counterpartyName,
    };
  });

  const movement = batch.closingBalanceMinor - batch.openingBalanceMinor;

  return (
    <div className="density-compact flex flex-col gap-[var(--density-section-gap)]">
      <div className="flex flex-col gap-1">
        <Link
          href={`/p/${profile.slug}/imports`}
          className="w-fit text-caption text-text-muted outline-none hover:text-accent focus-visible:ring-3 focus-visible:ring-focus-ring"
        >
          {t("allImports")}
        </Link>
        <h1 className="text-title text-text-primary">{batch.statementNumber}</h1>
        <p className="text-caption text-text-muted">
          {t("batchSummary", {
            account: batch.accountName,
            start: formatDate(batch.periodStart, locale),
            end: formatDate(batch.periodEnd, locale),
            opening: formatMinor(batch.openingBalanceMinor, "RON", locale),
            closing: formatMinor(batch.closingBalanceMinor, "RON", locale),
            sign: movement >= 0 ? "+" : "−",
            net: formatMinor(Math.abs(movement), "RON", locale),
          })}
        </p>
      </div>

      <ImportInbox
        profileSlug={profile.slug}
        entityId={profile.entityId}
        batchId={batch.id}
        rows={inboxRows}
        categories={categories}
      />
    </div>
  );
}
