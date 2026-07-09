import { notFound } from "next/navigation";
import { getLocale } from "next-intl/server";
import { getProfile } from "@/lib/profiles";
import {
  listBrokerageAccounts,
  listHoldings,
  listSecurities,
} from "@/lib/investments/service";
import { listLatestSnapshots } from "@/lib/investments/prices";
import { valueHoldings, type ValuationResult } from "@/lib/investments/valuation";
import { HoldingsTable } from "@/components/investments/holdings-table";
import { PriceSnapshotForm } from "@/components/investments/price-snapshot-form";
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

  const locale = await getLocale();
  const accounts = await listBrokerageAccounts(profile.entityId, profile.owner);
  const securities = await listSecurities();
  const cashAccounts = accounts.filter((a) => a.type === "brokerage");
  const holdingsByAccount = Object.fromEntries(
    await Promise.all(
      cashAccounts.map(async (a) => [a.id, await listHoldings(a.id)] as const),
    ),
  );
  const latestSnapshots = await listLatestSnapshots(securities.map((s) => s.id));
  const today = new Date().toISOString().slice(0, 10);

  // Valuation may legitimately fail (e.g. BNR unreachable for today's rate)
  // — the page degrades to an honest error line, never a silent zero.
  let valuation: ValuationResult | null = null;
  let valuationError: string | null = null;
  try {
    valuation = await valueHoldings({
      entityId: profile.entityId,
      owner: profile.owner,
      date: today,
    });
  } catch (error) {
    valuationError = error instanceof Error ? error.message : "Valuation failed";
  }

  return (
    <div className="density-compact flex flex-col gap-[var(--density-section-gap)]">
      <h1 className="text-title text-text-primary">Investments</h1>

      <section className="flex flex-col gap-2">
        <h2 className="text-card-title text-text-primary">Holdings</h2>
        {valuation ? (
          <HoldingsTable result={valuation} locale={locale} />
        ) : (
          <p className="text-secondary text-status-warning-text">
            Holdings could not be valued: {valuationError}
          </p>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-card-title text-text-primary">Record a trade</h2>
        <p className="text-secondary text-text-muted">
          Enter the trade or dividend as Revolut printed it — the {`security's`} amount
          and the RON amount; the rate is derived, never typed. A sell previews the
          exact FIFO lots it will consume before you book it; a dividend shows a
          display-only tax indication that books nothing.
        </p>
        <TradeForm
          profileSlug={profile.slug}
          entityId={profile.entityId}
          accounts={accounts}
          securities={securities}
          holdingsByAccount={holdingsByAccount}
          today={today}
        />
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-card-title text-text-primary">Price snapshots</h2>
        <p className="text-caption text-text-muted">
          Manual entry is the price source for now (the daily sync endpoint exists;
          an API source gets picked once real tickers prove coverage).
        </p>
        <PriceSnapshotForm
          profileSlug={profile.slug}
          entityId={profile.entityId}
          securities={securities.map((s) => ({
            ...s,
            latest: latestSnapshots.get(s.id),
          }))}
          today={today}
        />
      </section>
    </div>
  );
}
