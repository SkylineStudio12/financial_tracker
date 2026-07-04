import { DividendFlow } from "@/components/flows/dividend-flow";
import { getFlowPageData } from "@/lib/ledger/flow-page-data";

export const dynamic = "force-dynamic";

export default async function DividendFlowPage({
  params,
}: {
  params: Promise<{ entityId: string }>;
}) {
  const { entityId } = await params;
  const { isCompany, personalAccounts } = await getFlowPageData(entityId);

  if (!isCompany) {
    return <p className="text-sm text-fg-muted">Dividend entry is available for companies only.</p>;
  }
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">New dividend</h1>
      <DividendFlow companyId={entityId} personalAccounts={personalAccounts} />
    </div>
  );
}
