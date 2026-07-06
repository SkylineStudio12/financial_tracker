import { notFound } from "next/navigation";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { entities } from "@/db/schema";
import { formatMinor } from "@/lib/format";
import {
  getAccountBalances,
  getNetCashPosition,
  getTaxAccrualGroups,
  type AccrualGroup,
} from "@/lib/ledger/dashboard";
import { getProfile } from "@/lib/profiles";
import { quarterOf, yearOf } from "@/lib/tax/rules";

export const dynamic = "force-dynamic";

const ESTIMATE_RULES: string[] = ["cass_dividend"];

const amountClass = (value: number) =>
  `px-[var(--density-row-padding-x)] py-[var(--density-row-padding-y)] text-right whitespace-nowrap font-numeric tabular-nums ${
    value < 0 ? "text-status-negative-text" : "text-text-primary"
  }`;

function periodLabel(group: Pick<AccrualGroup, "year" | "quarter">): string {
  return group.quarter === null ? `${group.year} annual` : `${group.year} Q${group.quarter}`;
}

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ profile: string }>;
}) {
  const { profile: slug } = await params;
  const profile = getProfile(slug);
  if (!profile) notFound();
  const { entityId, owner } = profile;
  const [entity] = await db
    .select({ name: entities.name, type: entities.type })
    .from(entities)
    .where(and(eq(entities.id, entityId), isNull(entities.deletedAt)));
  if (!entity) notFound();

  const balances = await getAccountBalances(entityId, owner);
  // The all-entities net cash consolidation belongs to the SHARED household
  // view only; personal profiles show just that person's balances.
  const netCash = profile.slug === "household" ? await getNetCashPosition() : null;
  const accrualGroups = entity.type === "company" ? await getTaxAccrualGroups(entityId) : [];

  const today = new Date().toISOString().slice(0, 10);
  const currentYear = yearOf(today);
  const currentQuarter = quarterOf(today);
  const currentQuarterGroups = accrualGroups.filter(
    (g) => g.year === currentYear && g.quarter === currentQuarter,
  );

  // Quarter list: aggregate rule groups per period, newest first.
  const periods = new Map<string, { year: number; quarter: number | null; totalRon: number; hasEstimate: boolean }>();
  for (const group of accrualGroups) {
    const key = `${group.year}-${group.quarter ?? "annual"}`;
    const period = periods.get(key) ?? {
      year: group.year,
      quarter: group.quarter,
      totalRon: 0,
      hasEstimate: false,
    };
    period.totalRon += group.accruedRon;
    period.hasEstimate ||= ESTIMATE_RULES.includes(group.ruleType);
    periods.set(key, period);
  }

  return (
    <div className="flex flex-col gap-[var(--density-section-gap)] max-w-4xl">
      <h1 className="text-title text-text-primary">Dashboard — {profile.label}</h1>

      <section className="flex flex-col gap-2">
        <h2 className="text-micro uppercase text-text-muted">
          Account balances
        </h2>
        <div className="overflow-x-auto rounded-card border border-border-hairline bg-surface">
          <table className="w-full text-secondary">
            <thead>
              <tr className="text-left text-micro uppercase text-text-muted">
                <th className="px-[var(--density-row-padding-x)] py-[var(--density-row-padding-y)] font-normal">Account</th>
                <th className="px-[var(--density-row-padding-x)] py-[var(--density-row-padding-y)] font-normal">Type</th>
                <th className="px-[var(--density-row-padding-x)] py-[var(--density-row-padding-y)] font-normal text-right">Balance</th>
                <th className="px-[var(--density-row-padding-x)] py-[var(--density-row-padding-y)] font-normal text-right">RON</th>
              </tr>
            </thead>
            <tbody>
              {balances.map((account) => (
                <tr key={account.accountId} className="border-t border-border-hairline">
                  <td className="px-[var(--density-row-padding-x)] py-[var(--density-row-padding-y)] text-text-primary">{account.name}</td>
                  <td className="px-[var(--density-row-padding-x)] py-[var(--density-row-padding-y)] text-text-secondary">{account.type}</td>
                  <td className={amountClass(account.balance)}>
                    {formatMinor(account.balance, account.currency)}
                  </td>
                  <td className={amountClass(account.balanceRon)}>
                    {formatMinor(account.balanceRon, "RON")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {netCash && (
        <section className="flex flex-col gap-2">
          <h2 className="text-micro uppercase text-text-muted">
            Net cash position (all entities)
          </h2>
          <div className="rounded-card border border-border-hairline bg-surface">
            <table className="w-full text-secondary">
              <tbody>
                {netCash.cashByEntity.map((row) => (
                  <tr key={row.entityName} className="border-t border-border-hairline first:border-t-0">
                    <td className="px-[var(--density-row-padding-x)] py-[var(--density-row-padding-y)] text-text-secondary">Cash — {row.entityName}</td>
                    <td className={amountClass(row.cashRon)}>
                      {formatMinor(row.cashRon, "RON")}
                    </td>
                  </tr>
                ))}
                <tr className="border-t border-border-hairline">
                  <td className="px-[var(--density-row-padding-x)] py-[var(--density-row-padding-y)] text-text-secondary">Total cash</td>
                  <td className={amountClass(netCash.totalCashRon)}>
                    {formatMinor(netCash.totalCashRon, "RON")}
                  </td>
                </tr>
                <tr className="border-t border-border-hairline">
                  <td className="px-[var(--density-row-padding-x)] py-[var(--density-row-padding-y)] text-text-secondary">Accrued tax liabilities</td>
                  <td className={amountClass(netCash.accruedTaxRon)}>
                    {formatMinor(netCash.accruedTaxRon, "RON")}
                  </td>
                </tr>
                <tr className="border-t border-border-hairline">
                  <td className="px-[var(--density-row-padding-x)] py-[var(--density-row-padding-y)] text-body text-text-primary">Net cash</td>
                  <td className={`${amountClass(netCash.netRon)} text-body`}>
                    {formatMinor(netCash.netRon, "RON")}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-caption text-text-muted">
            Bank and cash accounts only; brokerage balances excluded. RON values are
            historical-cost sums at transaction-date BNR rates.
          </p>
        </section>
      )}

      {entity.type === "company" && (
        <section className="flex flex-col gap-2">
          <h2 className="text-micro uppercase text-text-muted">
            Tax panel — accrued {currentYear} Q{currentQuarter}
          </h2>
          <div className="rounded-card border border-border-hairline bg-surface">
            <table className="w-full text-secondary">
              <tbody>
                {currentQuarterGroups.length === 0 && (
                  <tr>
                    <td className="px-[var(--density-row-padding-x)] py-8 text-center text-text-muted" colSpan={2}>
                      Nothing accrued this quarter.
                    </td>
                  </tr>
                )}
                {currentQuarterGroups.map((group) => (
                  <tr key={group.ruleType} className="border-t border-border-hairline first:border-t-0">
                    <td className="px-[var(--density-row-padding-x)] py-[var(--density-row-padding-y)] text-text-primary">
                      {group.ruleType}
                      {ESTIMATE_RULES.includes(group.ruleType) && (
                        <span className="ml-2 rounded-badge px-1.5 py-0.5 text-micro uppercase bg-surface-inactive text-status-warning-text">
                          ESTIMATE
                        </span>
                      )}
                    </td>
                    <td className={amountClass(group.accruedRon)}>
                      {formatMinor(group.accruedRon, "RON")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2 className="mt-2 text-micro uppercase text-text-muted">
            Accruals by period
          </h2>
          <div className="rounded-card border border-border-hairline bg-surface">
            <table className="w-full text-secondary">
              <tbody>
                {periods.size === 0 && (
                  <tr>
                    <td className="px-[var(--density-row-padding-x)] py-8 text-center text-text-muted" colSpan={2}>
                      No accruals yet.
                    </td>
                  </tr>
                )}
                {[...periods.values()].map((period) => (
                  <tr
                    key={periodLabel(period)}
                    className="border-t border-border-hairline first:border-t-0"
                  >
                    <td className="px-[var(--density-row-padding-x)] py-[var(--density-row-padding-y)] text-text-secondary">
                      {periodLabel(period)}
                      {period.hasEstimate && (
                        <span className="ml-2 rounded-badge px-1.5 py-0.5 text-micro uppercase bg-surface-inactive text-status-warning-text">
                          includes estimates
                        </span>
                      )}
                    </td>
                    <td className={amountClass(period.totalRon)}>
                      {formatMinor(period.totalRon, "RON")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
