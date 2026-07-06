import { DividendFlow } from "@/components/flows/dividend-flow";
import { notFound } from "next/navigation";
import { getFlowPageData } from "@/lib/ledger/flow-page-data";
import { getProfile } from "@/lib/profiles";

export const dynamic = "force-dynamic";

export default async function DividendFlowPage({
  params,
}: {
  params: Promise<{ profile: string }>;
}) {
  const { profile: slug } = await params;
  const profile = getProfile(slug);
  // Visibility derives from the PROFILES config: company profiles only.
  if (!profile || !profile.companyFlows) notFound();
  const entityId = profile.entityId;
  const { isCompany, personalAccounts } = await getFlowPageData(entityId);

  if (!isCompany) {
    return <p className="text-secondary text-text-muted">Dividend entry is available for companies only.</p>;
  }
  return (
    <div className="density-compact flex flex-col gap-[var(--density-section-gap)]">
      <h1 className="text-title text-text-primary">New dividend</h1>
      <DividendFlow companyId={entityId} personalAccounts={personalAccounts} />
    </div>
  );
}
