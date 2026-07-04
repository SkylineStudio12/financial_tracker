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
    return <p className="text-sm text-fg-muted">Salary entry is available for companies only.</p>;
  }
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">New salary</h1>
      <SalaryFlow companyId={entityId} personalAccounts={personalAccounts} />
    </div>
  );
}
