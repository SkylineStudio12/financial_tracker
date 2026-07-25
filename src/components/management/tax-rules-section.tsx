import { getLocale, getTranslations } from "next-intl/server";
import { formatBpsPercent, formatDate, formatMinor } from "@/lib/format";
import type { ActiveTaxRule, TaxRuleType } from "@/lib/tax/rules";

const groups: Array<{
  title: "groupSalary" | "groupDividend" | "groupMicro";
  ruleTypes: TaxRuleType[];
}> = [
  {
    title: "groupSalary",
    ruleTypes: ["salary_cas", "salary_cass", "salary_income_tax", "cam"],
  },
  { title: "groupDividend", ruleTypes: ["dividend_tax", "cass_dividend"] },
  { title: "groupMicro", ruleTypes: ["micro_revenue_tax"] },
];

function formatThreshold(rule: ActiveTaxRule, locale: "en" | "ro") {
  if (rule.thresholdMin === null && rule.thresholdMax === null) return null;
  if (rule.thresholdMin !== null && rule.thresholdMax !== null) {
    return `${formatMinor(rule.thresholdMin, "RON", locale)}–${formatMinor(rule.thresholdMax, "RON", locale)}`;
  }
  if (rule.thresholdMin !== null) return `≥ ${formatMinor(rule.thresholdMin, "RON", locale)}`;
  return `≤ ${formatMinor(rule.thresholdMax!, "RON", locale)}`;
}

export async function TaxRulesSection({ rules }: { rules: ActiveTaxRule[] }) {
  const locale = await getLocale();
  const t = await getTranslations("taxRules");
  const rulesByType = new Map(rules.map((rule) => [rule.ruleType, rule]));

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-card-title text-text-primary">{t("title")}</h2>
      {rules.length === 0 ? (
        <p className="text-secondary text-text-muted">{t("empty")}</p>
      ) : (
        groups.map((group) => {
          const groupRules = group.ruleTypes
            .map((ruleType) => rulesByType.get(ruleType))
            .filter((rule): rule is ActiveTaxRule => Boolean(rule));
          if (groupRules.length === 0) return null;

          return (
            <div key={group.title} className="overflow-hidden rounded-card border border-border-hairline bg-surface">
              <h3 className="border-b border-border-hairline px-2 py-2 text-secondary font-medium text-text-primary">
                {t(group.title)}
              </h3>
              <div className="divide-y divide-border-hairline">
                {groupRules.map((rule) => {
                  const threshold = formatThreshold(rule, locale);
                  return (
                    <div key={rule.ruleType} className="grid gap-2 px-2 py-2 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-start">
                      <div className="min-w-0">
                        <p className="text-secondary text-text-primary">{t(`label.${rule.ruleType}`)}</p>
                        {rule.notes && <p className="mt-1 text-caption text-text-muted">{rule.notes}</p>}
                        {threshold && <p className="mt-1 text-caption font-numeric tabular-nums text-text-muted">{threshold}</p>}
                      </div>
                      <dl className="text-caption text-text-muted sm:text-right">
                        <dt>{t("rate")}</dt>
                        <dd className="font-numeric tabular-nums text-secondary text-text-primary">
                          {formatBpsPercent(rule.rateBps, locale)}
                        </dd>
                      </dl>
                      <dl className="text-caption text-text-muted sm:text-right">
                        <dt>{t("effectiveFrom")}</dt>
                        <dd className="font-numeric tabular-nums text-secondary text-text-primary">
                          {formatDate(rule.validFrom, locale)}
                        </dd>
                      </dl>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })
      )}
    </section>
  );
}
