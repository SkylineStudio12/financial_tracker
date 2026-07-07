import { notFound } from "next/navigation";
import { getProfile } from "@/lib/profiles";
import {
  listBrokerageAccounts,
  listHoldings,
  listSecurities,
} from "@/lib/investments/service";
import { TradeForm } from "@/components/investments/trade-form";

export const dynamic = "force-dynamic";

export default async function InvestmentsPage({
  params,
}: {
  params: Promise<{ profile: string }>;
}) {
  const { profile: slug } = await params;
  const profile = getProfile(slug);
  // Gated by the investments capability flag (config, not DB) — household +
  // personal profiles own the brokerage accounts; the SRLs don't trade.
  if (!profile || !profile.investments) notFound();

  const accounts = await listBrokerageAccounts(profile.entityId, profile.owner);
  const securities = await listSecurities();
  const holdingsByAccount = Object.fromEntries(
    await Promise.all(
      accounts.map(async (a) => [a.id, await listHoldings(a.id)] as const),
    ),
  );
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="density-compact flex flex-col gap-[var(--density-section-gap)]">
      <h1 className="text-title text-text-primary">Record a trade</h1>
      <p className="text-secondary text-text-muted">
        Enter the trade as Revolut printed it — the {`security's`} total and the RON
        total; the rate is derived, never typed. A sell previews the exact FIFO
        lots it will consume before you book it.
      </p>
      <TradeForm
        profileSlug={profile.slug}
        entityId={profile.entityId}
        accounts={accounts}
        securities={securities}
        holdingsByAccount={holdingsByAccount}
        today={today}
      />
    </div>
  );
}
