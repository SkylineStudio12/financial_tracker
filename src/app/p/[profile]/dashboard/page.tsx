import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
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
import { valueHoldings, type ValuationResult } from "@/lib/investments/valuation";
import {
  AllocationCard,
  InvestmentSummaryCard,
  OwnerCard,
} from "@/components/investments/dashboard-cards";

export const dynamic = "force-dynamic";

const ESTIMATE_RULES: string[] = ["cass_dividend"];

const amountClass = (value: number) =>
  `px-[var(--density-row-padding-x)] py-[var(--density-row-padding-y)] text-right whitespace-nowrap font-numeric tabular-nums ${
    value < 0 ? "text-status-negative-text" : "text-text-primary"
  }`;

/** Stable React key for a period — display labels are catalog messages. */
function periodKey(group: Pick<AccrualGroup, "year" | "quarter">): string {
  return `${group.year}-${group.quarter ?? "annual"}`;
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

  const locale = await getLocale();
  const t = await getTranslations("dashboard");
  const tCommon = await getTranslations("common");
  const balances = await getAccountBalances(entityId, owner);
  // The all-entities net cash consolidation belongs to the SHARED household
  // view only; personal profiles show just that person's balances.
  const netCash = profile.slug === "household" ? await getNetCashPosition() : null;
  const accrualGroups = entity.type === "company" ? await getTaxAccrualGroups(entityId) : [];

  const today = new Date().toISOString().slice(0, 10);
  const currentYear = yearOf(today);
  const currentQuarter = quarterOf(today);

  // Investment cards (Stage 5): presentation over the proven valuation
  // service — one call, cards render its result verbatim. Failure degrades
  // to an honest error line, never a silent zero.
  let valuation: ValuationResult | null = null;
  let valuationError: string | null = null;
  if (profile.investments) {
    try {
      valuation = await valueHoldings({ entityId, owner, date: today });
    } catch (error) {
      valuationError = error instanceof Error ? error.message : "Valuation failed";
    }
  }
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
      <h1 className="text-title text-text-primary">{t("title", { name: profile.label })}</h1>

      <section className="flex flex-col gap-2">
        <h2 className="text-micro uppercase text-text-muted">
          {t("accountBalances")}
        </h2>
        <div className="overflow-x-auto rounded-card border border-border-hairline bg-surface">
          <table className="w-full text-secondary">
            <thead>
              <tr className="text-left text-micro uppercase text-text-muted">
                <th className="px-[var(--density-row-padding-x)] py-[var(--density-row-padding-y)] font-normal">{t("colAccount")}</th>
                <th className="px-[var(--density-row-padding-x)] py-[var(--density-row-padding-y)] font-normal">{t("colType")}</th>
                <th className="px-[var(--density-row-padding-x)] py-[var(--density-row-padding-y)] font-normal text-right">{t("colBalance")}</th>
                <th className="px-[var(--density-row-padding-x)] py-[var(--density-row-padding-y)] font-normal text-right">RON</th>
              </tr>
            </thead>
            <tbody>
              {balances.map((account) => (
                <tr key={account.accountId} className="border-t border-border-hairline">
                  <td className="px-[var(--density-row-padding-x)] py-[var(--density-row-padding-y)] text-text-primary">{account.name}</td>
                  <td className="px-[var(--density-row-padding-x)] py-[var(--density-row-padding-y)] text-text-secondary">{account.type}</td>
                  <td className={amountClass(account.balance)}>
                    {formatMinor(account.balance, account.currency, locale)}
                  </td>
                  <td className={amountClass(account.balanceRon)}>
                    {formatMinor(account.balanceRon, "RON", locale)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {profile.investments && (
        <section className="flex flex-col gap-2">
          <h2 className="text-micro uppercase text-text-muted">{tCommon("investments")}</h2>
          {valuation ? (
            <div className="grid grid-cols-1 gap-[var(--density-section-gap)] sm:grid-cols-2">
              <InvestmentSummaryCard
                result={valuation}
                investmentsHref={`/p/${profile.slug}/investments`}
                locale={locale}
              />
              <AllocationCard result={valuation} locale={locale} />
              {profile.slug === "household" && <OwnerCard result={valuation} locale={locale} />}
            </div>
          ) : (
            <p className="text-secondary text-status-warning-text">
              {t("valuationFailed", { error: valuationError ?? "" })}
            </p>
          )}
        </section>
      )}

      {netCash && (
        <section className="flex flex-col gap-2">
          <h2 className="text-micro uppercase text-text-muted">
            {t("netCashPosition")}
          </h2>
          <div className="rounded-card border border-border-hairline bg-surface">
            <table className="w-full text-secondary">
              <tbody>
                {netCash.cashByEntity.map((row) => (
                  <tr key={row.entityName} className="border-t border-border-hairline first:border-t-0">
                    <td className="px-[var(--density-row-padding-x)] py-[var(--density-row-padding-y)] text-text-secondary">{t("cashEntity", { name: row.entityName })}</td>
                    <td className={amountClass(row.cashRon)}>
                      {formatMinor(row.cashRon, "RON", locale)}
                    </td>
                  </tr>
                ))}
                <tr className="border-t border-border-hairline">
                  <td className="px-[var(--density-row-padding-x)] py-[var(--density-row-padding-y)] text-text-secondary">{t("totalCash")}</td>
                  <td className={amountClass(netCash.totalCashRon)}>
                    {formatMinor(netCash.totalCashRon, "RON", locale)}
                  </td>
                </tr>
                <tr className="border-t border-border-hairline">
                  <td className="px-[var(--density-row-padding-x)] py-[var(--density-row-padding-y)] text-text-secondary">{t("accruedTaxLiabilities")}</td>
                  <td className={amountClass(netCash.accruedTaxRon)}>
                    {formatMinor(netCash.accruedTaxRon, "RON", locale)}
                  </td>
                </tr>
                <tr className="border-t border-border-hairline">
                  <td className="px-[var(--density-row-padding-x)] py-[var(--density-row-padding-y)] text-body text-text-primary">{t("netCash")}</td>
                  <td className={`${amountClass(netCash.netRon)} text-body`}>
                    {formatMinor(netCash.netRon, "RON", locale)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-caption text-text-muted">
            {t("netCashNote")}
          </p>
        </section>
      )}

      {entity.type === "company" && (
        <section className="flex flex-col gap-2">
          <h2 className="text-micro uppercase text-text-muted">
            {t("taxPanel", { year: currentYear, quarter: currentQuarter })}
          </h2>
          <div className="rounded-card border border-border-hairline bg-surface">
            <table className="w-full text-secondary">
              <tbody>
                {currentQuarterGroups.length === 0 && (
                  <tr>
                    <td className="px-[var(--density-row-padding-x)] py-8 text-center text-text-muted" colSpan={2}>
                      {t("nothingAccrued")}
                    </td>
                  </tr>
                )}
                {currentQuarterGroups.map((group) => (
                  <tr key={group.ruleType} className="border-t border-border-hairline first:border-t-0">
                    <td className="px-[var(--density-row-padding-x)] py-[var(--density-row-padding-y)] text-text-primary">
                      {group.ruleType}
                      {ESTIMATE_RULES.includes(group.ruleType) && (
                        <span className="ml-2 rounded-badge px-1.5 py-0.5 text-micro uppercase bg-surface-inactive text-status-warning-text">
                          {tCommon("estimate")}
                        </span>
                      )}
                    </td>
                    <td className={amountClass(group.accruedRon)}>
                      {formatMinor(group.accruedRon, "RON", locale)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2 className="mt-2 text-micro uppercase text-text-muted">
            {t("accrualsByPeriod")}
          </h2>
          <div className="rounded-card border border-border-hairline bg-surface">
            <table className="w-full text-secondary">
              <tbody>
                {periods.size === 0 && (
                  <tr>
                    <td className="px-[var(--density-row-padding-x)] py-8 text-center text-text-muted" colSpan={2}>
                      {t("noAccruals")}
                    </td>
                  </tr>
                )}
                {[...periods.values()].map((period) => (
                  <tr
                    key={periodKey(period)}
                    className="border-t border-border-hairline first:border-t-0"
                  >
                    <td className="px-[var(--density-row-padding-x)] py-[var(--density-row-padding-y)] text-text-secondary">
                      {period.quarter === null
                        ? t("periodAnnual", { year: period.year })
                        : t("periodQuarter", { year: period.year, quarter: period.quarter })}
                      {period.hasEstimate && (
                        <span className="ml-2 rounded-badge px-1.5 py-0.5 text-micro uppercase bg-surface-inactive text-status-warning-text">
                          {t("includesEstimates")}
                        </span>
                      )}
                    </td>
                    <td className={amountClass(period.totalRon)}>
                      {formatMinor(period.totalRon, "RON", locale)}
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
