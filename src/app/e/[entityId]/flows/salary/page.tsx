import { SalaryFlow } from "@/components/flows/salary-flow";
import { getFlowPageData } from "@/lib/ledger/flow-page-data";

export const dynamic = "force-dynamic";

export default async function SalaryFlowPage({
  params,
}: {
  params: Promise<{ entityId: string }>;
}) {
  const { entityId } = await params;
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
