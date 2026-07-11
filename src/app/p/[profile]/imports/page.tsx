import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { getProfile } from "@/lib/profiles";
import { formatDate } from "@/lib/format";
import { getImportFormOptions, listImportBatches } from "@/lib/import/queries";
import { ImportPasteForm } from "@/components/import/import-paste-form";
import { RevolutUploadForm } from "@/components/import/revolut-upload-form";
import { listRevolutImportBatches } from "@/lib/import/revolut/brokerage-queries";

export const dynamic = "force-dynamic";

export default async function ImportsPage({
  params,
}: {
  params: Promise<{ profile: string }>;
}) {
  const { profile: slug } = await params;
  const profile = getProfile(slug);
  if (!profile || (!profile.companyFlows && profile.owner !== "greg")) notFound();

  const locale = await getLocale();
  const t = await getTranslations("imports");
  const isRevolut = profile.owner === "greg";
  const { bankAccounts } = isRevolut
    ? { bankAccounts: [] }
    : await getImportFormOptions(profile.entityId);
  const batches = isRevolut ? [] : await listImportBatches(profile.entityId);
  const revolutBatches = isRevolut
    ? await listRevolutImportBatches(profile.entityId, "greg")
    : [];

  return (
    <div className="density-compact flex flex-col gap-[var(--density-section-gap)]">
      <h1 className="text-title text-text-primary">
        {isRevolut ? t("revolut.title") : t("title")}
      </h1>

      {isRevolut ? (
        <RevolutUploadForm profileSlug={profile.slug} entityId={profile.entityId} />
      ) : (
        <ImportPasteForm
          profileSlug={profile.slug}
          entityId={profile.entityId}
          bankAccounts={bankAccounts}
        />
      )}

      <section className="flex flex-col gap-2">
        <h2 className="text-card-title text-text-primary">
          {isRevolut ? t("revolut.recent") : t("recentImports")}
        </h2>
        {(isRevolut ? revolutBatches : batches).length === 0 ? (
          <p className="text-secondary text-text-muted">
            {isRevolut ? t("revolut.none") : t("noStatements")}
          </p>
        ) : isRevolut ? (
          <ul className="flex flex-col">
            {revolutBatches.map((batch) => (
              <li key={batch.id} className="border-b border-border-hairline last:border-b-0">
                <Link
                  href={`/p/${profile.slug}/imports/${batch.id}`}
                  className="flex items-baseline justify-between gap-3 py-2 outline-none hover:text-accent focus-visible:ring-3 focus-visible:ring-focus-ring"
                >
                  <span className="text-secondary text-text-primary">{batch.sourceFileName}</span>
                  <span className="text-caption text-text-muted">
                    {batch.bookedAt
                      ? t("revolut.batchBooked")
                      : t("revolut.batchPending", {
                          pending: batch.pendingCount,
                          excluded: batch.excludedCount,
                          total: batch.rowCount,
                        })}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <ul className="flex flex-col">
            {batches.map((batch) => (
              <li key={batch.id} className="border-b border-border-hairline last:border-b-0">
                <Link
                  href={`/p/${profile.slug}/imports/${batch.id}`}
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
        )}
      </section>
    </div>
  );
}
