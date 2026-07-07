import Link from "next/link";
import { notFound } from "next/navigation";
import { getProfile } from "@/lib/profiles";
import { formatDate } from "@/lib/format";
import { getImportFormOptions, listImportBatches } from "@/lib/import/queries";
import { ImportPasteForm } from "@/components/import/import-paste-form";

export const dynamic = "force-dynamic";

export default async function ImportsPage({
  params,
}: {
  params: Promise<{ profile: string }>;
}) {
  const { profile: slug } = await params;
  const profile = getProfile(slug);
  // Imports are a company-books feature; gate on the same flag as the flows.
  if (!profile || !profile.companyFlows) notFound();

  const { bankAccounts } = await getImportFormOptions(profile.entityId);
  const batches = await listImportBatches(profile.entityId);

  return (
    <div className="density-compact flex flex-col gap-[var(--density-section-gap)]">
      <h1 className="text-title text-text-primary">Import statement</h1>

      <ImportPasteForm
        profileSlug={profile.slug}
        entityId={profile.entityId}
        bankAccounts={bankAccounts}
      />

      <section className="flex flex-col gap-2">
        <h2 className="text-card-title text-text-primary">Recent imports</h2>
        {batches.length === 0 ? (
          <p className="text-secondary text-text-muted">No statements imported yet.</p>
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
                    {formatDate(batch.periodStart)}–{formatDate(batch.periodEnd)} ·{" "}
                    {batch.pendingCount} of {batch.rowCount} pending
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
