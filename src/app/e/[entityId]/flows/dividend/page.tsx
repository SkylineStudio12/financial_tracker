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
    return <p className="text-secondary text-text-muted">Dividend entry is available for companies only.</p>;
  }
  return (
    <div className="density-compact flex flex-col gap-[var(--density-section-gap)]">
      <h1 className="text-title text-text-primary">New dividend</h1>
      <DividendFlow companyId={entityId} personalAccounts={personalAccounts} />
    </div>
  );
}
