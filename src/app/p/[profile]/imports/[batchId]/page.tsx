import Link from "next/link";
import { notFound } from "next/navigation";
import { getProfile } from "@/lib/profiles";
import { formatDate, formatMinor } from "@/lib/format";
import { getImportBatch } from "@/lib/import/queries";
import type { ClassifiedRow } from "@/lib/import/ing/classify";
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

  const data = await getImportBatch(batchId, profile.entityId);
  if (!data) notFound();
  const { batch, rows, categories } = data;

  const inboxRows = rows.map((r) => {
    const classified = r.payload as ClassifiedRow;
    return {
      id: r.id,
      lineNo: r.lineNo,
      kind: r.kind,
      confidence: r.confidence,
      reason: r.reason,
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
          ← All imports
        </Link>
        <h1 className="text-title text-text-primary">{batch.statementNumber}</h1>
        <p className="text-caption text-text-muted">
          {batch.accountName} · {formatDate(batch.periodStart)}–{formatDate(batch.periodEnd)} ·
          opening {formatMinor(batch.openingBalanceMinor, "RON")} → closing{" "}
          {formatMinor(batch.closingBalanceMinor, "RON")} (net{" "}
          {movement >= 0 ? "+" : "−"}
          {formatMinor(Math.abs(movement), "RON")})
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
