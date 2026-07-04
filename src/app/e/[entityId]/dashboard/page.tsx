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
import { quarterOf, yearOf } from "@/lib/tax/rules";

export const dynamic = "force-dynamic";

const ESTIMATE_RULES: string[] = ["cass_dividend"];

const amountClass = (value: number) =>
  `px-3 py-2 text-right whitespace-nowrap font-mono ${
    value < 0 ? "text-negative" : "text-fg"
  }`;

function periodLabel(group: Pick<AccrualGroup, "year" | "quarter">): string {
  return group.quarter === null ? `${group.year} annual` : `${group.year} Q${group.quarter}`;
}

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ entityId: string }>;
}) {
  const { entityId } = await params;
  const [entity] = await db
    .select({ name: entities.name, type: entities.type })
    .from(entities)
    .where(and(eq(entities.id, entityId), isNull(entities.deletedAt)));
  if (!entity) notFound();

  const balances = await getAccountBalances(entityId);
  const isHousehold = entity.type === "household";
  const netCash = isHousehold ? await getNetCashPosition() : null;
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
    <div className="flex flex-col gap-6 max-w-4xl">
      <h1 className="text-lg font-semibold">Dashboard — {entity.name}</h1>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-fg-muted">
          Account balances
        </h2>
        <div className="overflow-x-auto rounded-md border border-edge">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-surface text-left text-xs uppercase tracking-wider text-fg-muted">
                <th className="px-3 py-2 font-medium">Account</th>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium text-right">Balance</th>
                <th className="px-3 py-2 font-medium text-right">RON</th>
              </tr>
            </thead>
            <tbody>
              {balances.map((account) => (
                <tr key={account.accountId} className="border-t border-edge">
                  <td className="px-3 py-2">{account.name}</td>
                  <td className="px-3 py-2 text-fg-muted">{account.type}</td>
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
          <h2 className="text-sm font-semibold uppercase tracking-wider text-fg-muted">
            Net cash position (all entities)
          </h2>
          <div className="rounded-md border border-edge">
            <table className="w-full text-sm">
              <tbody>
                {netCash.cashByEntity.map((row) => (
                  <tr key={row.entityName} className="border-t border-edge first:border-t-0">
                    <td className="px-3 py-2 text-fg-muted">Cash — {row.entityName}</td>
                    <td className={amountClass(row.cashRon)}>
                      {formatMinor(row.cashRon, "RON")}
                    </td>
                  </tr>
                ))}
                <tr className="border-t border-edge">
                  <td className="px-3 py-2 text-fg-muted">Total cash</td>
                  <td className={amountClass(netCash.totalCashRon)}>
                    {formatMinor(netCash.totalCashRon, "RON")}
                  </td>
                </tr>
                <tr className="border-t border-edge">
                  <td className="px-3 py-2 text-fg-muted">Accrued tax liabilities</td>
                  <td className={amountClass(netCash.accruedTaxRon)}>
                    {formatMinor(netCash.accruedTaxRon, "RON")}
                  </td>
                </tr>
                <tr className="border-t border-edge bg-surface">
                  <td className="px-3 py-2 font-medium">Net cash</td>
                  <td className={`${amountClass(netCash.netRon)} font-medium`}>
                    {formatMinor(netCash.netRon, "RON")}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-xs text-fg-muted">
            Bank and cash accounts only; brokerage balances excluded. RON values are
            historical-cost sums at transaction-date BNR rates.
          </p>
        </section>
      )}

      {entity.type === "company" && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-fg-muted">
            Tax panel — accrued {currentYear} Q{currentQuarter}
          </h2>
          <div className="rounded-md border border-edge">
            <table className="w-full text-sm">
              <tbody>
                {currentQuarterGroups.length === 0 && (
                  <tr>
                    <td className="px-3 py-4 text-center text-fg-muted" colSpan={2}>
                      Nothing accrued this quarter.
                    </td>
                  </tr>
                )}
                {currentQuarterGroups.map((group) => (
                  <tr key={group.ruleType} className="border-t border-edge first:border-t-0">
                    <td className="px-3 py-2">
                      {group.ruleType}
                      {ESTIMATE_RULES.includes(group.ruleType) && (
                        <span className="ml-2 rounded px-1.5 py-0.5 text-xs bg-surface-raised text-warning">
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

          <h2 className="mt-2 text-sm font-semibold uppercase tracking-wider text-fg-muted">
            Accruals by period
          </h2>
          <div className="rounded-md border border-edge">
            <table className="w-full text-sm">
              <tbody>
                {periods.size === 0 && (
                  <tr>
                    <td className="px-3 py-4 text-center text-fg-muted" colSpan={2}>
                      No accruals yet.
                    </td>
                  </tr>
                )}
                {[...periods.values()].map((period) => (
                  <tr
                    key={periodLabel(period)}
                    className="border-t border-edge first:border-t-0"
                  >
                    <td className="px-3 py-2 text-fg-muted">
                      {periodLabel(period)}
                      {period.hasEstimate && (
                        <span className="ml-2 rounded px-1.5 py-0.5 text-xs bg-surface-raised text-warning">
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
