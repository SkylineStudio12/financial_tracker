import { DividendFlow } from "@/components/flows/dividend-flow";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
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
  const t = await getTranslations("flows");
  const { isCompany, personalAccounts } = await getFlowPageData(entityId);

  if (!isCompany) {
    return <p className="text-secondary text-text-muted">{t("dividendCompaniesOnly")}</p>;
  }
  return (
    <div className="density-compact flex flex-col gap-[var(--density-section-gap)]">
      <h1 className="text-title text-text-primary">{t("dividendTitle")}</h1>
      <DividendFlow companyId={entityId} personalAccounts={personalAccounts} />
    </div>
  );
}
