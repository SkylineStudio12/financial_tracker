import { getLocale, getTranslations } from "next-intl/server";
import { formatBpsPercent, formatDate, formatMinor, formatMinorNumber } from "@/lib/format";
import type { TaxConfigViewRow } from "@/lib/tax/config-service";
import type { TaxConfigParameter } from "@/lib/tax/config-validation";

/** Read-only viewer over tax_config (U5 cutover): the parameters the app
 * actually computes from, with each window's status and source. Every value
 * is DB-sourced — nothing here is a literal. */
/** Which group each parameter renders under. Typed as an EXHAUSTIVE record over
 * TaxConfigParameter (the config-validation.ts:17 pattern) so a 10th enum member
 * becomes a tsc error here instead of a silently invisible row. */
const GROUP_BY_PARAMETER = {
  cas_employee_rate: "groupSalary",
  cass_employee_rate: "groupSalary",
  cam_employer_rate: "groupSalary",
  income_tax_rate: "groupSalary",
  dividend_tax_rate: "groupDividend",
  cass_investment_brackets: "groupDividend",
  micro_revenue_tax: "groupMicro",
  minimum_wage: "groupReference",
  personal_deduction: "groupReference",
} as const satisfies Record<TaxConfigParameter, GroupTitle>;

type GroupTitle = "groupSalary" | "groupDividend" | "groupMicro" | "groupReference";

const GROUP_ORDER: GroupTitle[] = [
  "groupSalary",
  "groupDividend",
  "groupMicro",
  "groupReference",
];

const groups: Array<{ title: GroupTitle; parameters: TaxConfigParameter[] }> = GROUP_ORDER.map(
  (title) => ({
    title,
    parameters: (Object.keys(GROUP_BY_PARAMETER) as TaxConfigParameter[]).filter(
      (parameter) => GROUP_BY_PARAMETER[parameter] === title,
    ),
  }),
);

function StatusBadge({ status, label }: { status: "confirmed" | "estimate"; label: string }) {
  // Estimate is the loud state: a provisional figure must never read as final.
  const tone =
    status === "estimate"
      ? "bg-status-warning-bg text-status-warning-text"
      : "bg-status-info-bg text-status-info-text";
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-caption font-medium ${tone}`}>
      {label}
    </span>
  );
}

export async function TaxConfigSection({ rows }: { rows: TaxConfigViewRow[] }) {
  const locale = await getLocale();
  const t = await getTranslations("taxConfig");
  // Safe to collapse to one row per parameter: the tax_config_no_overlapping_windows
  // GiST exclusion forbids two windows covering one date for one parameter in
  // committed state, and that invariant is pinned by the overlap test in
  // config-service.e2e.test.ts. So this Map can never silently drop a real row.
  const byParameter = new Map(rows.map((row) => [row.parameter, row]));
  // Rows that no group claims (a parameter added to the enum without a group, or
  // a filtered subset): surfaced, never silently dropped (L-0027).
  const groupedParameters = new Set(groups.flatMap((group) => group.parameters));
  const renderableRows = rows.filter((row) => groupedParameters.has(row.parameter)).length;

  function value(row: TaxConfigViewRow): string | null {
    if (row.valueKind === "rate_bps" && row.rateBps !== null) {
      return formatBpsPercent(row.rateBps, locale);
    }
    if (row.valueKind === "amount_minor" && row.amountMinor !== null) {
      return formatMinor(row.amountMinor, "RON", locale);
    }
    return null; // bracket_set carries its value in the bands below
  }

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-card-title text-text-primary">{t("title")}</h2>
      {rows.length === 0 ? (
        <p className="text-secondary text-text-muted">{t("empty")}</p>
      ) : renderableRows === 0 ? (
        // Rows exist but none render: state it rather than leaving a bare heading.
        <p className="text-secondary text-text-muted">{t("noneGrouped", { count: rows.length })}</p>
      ) : (
        groups.map((group) => {
          const groupRows = group.parameters
            .map((parameter) => byParameter.get(parameter))
            .filter((row): row is TaxConfigViewRow => Boolean(row));
          if (groupRows.length === 0) return null;

          return (
            <div
              key={group.title}
              className="overflow-hidden rounded-card border border-border-hairline bg-surface"
            >
              <h3 className="border-b border-border-hairline px-2 py-2 text-secondary font-medium text-text-primary">
                {t(group.title)}
              </h3>
              <div className="divide-y divide-border-hairline">
                {groupRows.map((row) => {
                  const formatted = value(row);
                  return (
                    <div
                      key={row.parameter}
                      className="grid gap-2 px-2 py-2 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-start"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-secondary text-text-primary">
                            {t(`label.${row.parameter}`)}
                          </p>
                          <StatusBadge status={row.status} label={t(`status.${row.status}`)} />
                        </div>
                        <p className="mt-1 text-caption text-text-muted">
                          {t("source")}: {row.source}
                        </p>
                        {row.bands.length > 0 && (
                          <dl className="mt-1">
                            <dt className="text-caption text-text-muted">{t("bands")}</dt>
                            {row.bands.map((band) => (
                              <dd
                                key={band.ordinal}
                                className="text-caption font-numeric tabular-nums text-text-muted"
                              >
                                {band.upperMinor === null
                                  ? `${formatMinorNumber(band.lowerMinor, locale)} ${t("bandOpenTop")}`
                                  : `${formatMinorNumber(band.lowerMinor, locale)}–${formatMinorNumber(band.upperMinor, locale)}`}
                                {" → "}
                                {formatMinor(band.cassMinor, "RON", locale)}
                              </dd>
                            ))}
                          </dl>
                        )}
                      </div>
                      {formatted && (
                        <dl className="text-caption text-text-muted sm:text-right">
                          <dt>{t("value")}</dt>
                          <dd className="font-numeric tabular-nums text-secondary text-text-primary">
                            {formatted}
                          </dd>
                        </dl>
                      )}
                      <dl className="text-caption text-text-muted sm:text-right">
                        <dt>{t("effectiveFrom")}</dt>
                        <dd className="font-numeric tabular-nums text-secondary text-text-primary">
                          {formatDate(row.validFrom, locale)}
                        </dd>
                        {row.validTo !== null && (
                          <>
                            <dt className="mt-1">{t("until")}</dt>
                            <dd className="font-numeric tabular-nums text-secondary text-text-primary">
                              {formatDate(row.validTo, locale)}
                            </dd>
                          </>
                        )}
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
