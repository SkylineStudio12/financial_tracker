import { SalaryFlow } from "@/components/flows/salary-flow";
import { notFound } from "next/navigation";
import { getFlowPageData } from "@/lib/ledger/flow-page-data";
import { getProfile } from "@/lib/profiles";

export const dynamic = "force-dynamic";

export default async function SalaryFlowPage({
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
    return <p className="text-secondary text-text-muted">Salary entry is available for companies only.</p>;
  }
  return (
    <div className="density-compact flex flex-col gap-[var(--density-section-gap)]">
      <h1 className="text-title text-text-primary">New salary</h1>
      <SalaryFlow companyId={entityId} personalAccounts={personalAccounts} />
    </div>
  );
}
