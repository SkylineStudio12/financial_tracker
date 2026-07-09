/**
 * The BASIC holdings table (Stage 4 scope: prove the numbers; the dashboard
 * presentation is Stage 5). Server component — renders a ValuationResult.
 * Unpriced holdings show "no price" (never zero) and the totals row names
 * how many were excluded; stale prices carry their real date.
 */
import { useTranslations } from "next-intl";
import type { Locale } from "@/i18n/config";
import { formatDate, formatMinor } from "@/lib/format";
import { displayQuantity } from "@/lib/investments/trade-rules";
import type { ValuationResult } from "@/lib/investments/valuation";

const num = "text-right font-numeric tabular-nums";
const cell = "px-[var(--density-row-padding-x)] py-[var(--density-row-padding-y)]";

export function HoldingsTable({ result, locale }: { result: ValuationResult; locale: Locale }) {
  const t = useTranslations("investments");
  if (result.holdings.length === 0) {
    return (
      <p className="text-secondary text-text-muted">
        {t("noOpenHoldings")}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <table className="w-full text-secondary">
        <thead>
          <tr className="border-b border-border-hairline text-caption text-text-muted">
            <th className={`${cell} text-left font-normal`}>{t("colHolding")}</th>
            <th className={`${cell} text-right font-normal`}>{t("colQty")}</th>
            <th className={`${cell} text-right font-normal`}>{t("colCostBasis")}</th>
            <th className={`${cell} text-right font-normal`}>{t("colPrice")}</th>
            <th className={`${cell} text-right font-normal`}>{t("colValue")}</th>
            <th className={`${cell} text-right font-normal`}>{t("colUnrealized")}</th>
          </tr>
        </thead>
        <tbody>
          {result.holdings.map((h) => (
            <tr key={`${h.cashAccountId}-${h.securityId}`} className="border-b border-border-hairline last:border-b-0">
              <td className={cell}>
                <span className="text-text-primary">{h.ticker}</span>{" "}
                <span className="text-caption text-text-muted">
                  {h.securityName} · {h.cashAccountName}
                </span>
              </td>
              <td className={`${cell} ${num}`}>{displayQuantity(h.quantity)}</td>
              <td className={`${cell} ${num}`}>
                {formatMinor(h.basisMinor, h.currency, locale)}
                <span className="block text-caption text-text-muted">
                  {formatMinor(h.basisRonMinor, "RON", locale)}
                </span>
              </td>
              <td className={`${cell} ${num}`}>
                {h.price ? (
                  <>
                    {formatMinor(h.price.priceMinor, h.currency, locale)}
                    <span
                      className={`block text-caption ${
                        h.price.stale ? "text-status-warning-text" : "text-text-muted"
                      }`}
                    >
                      {h.price.stale
                        ? t("staleAsOf", { date: formatDate(h.price.priceDate, locale) })
                        : formatDate(h.price.priceDate, locale)}
                    </span>
                  </>
                ) : (
                  <span className="text-status-warning-text">{t("noPriceNotValued")}</span>
                )}
              </td>
              <td className={`${cell} ${num}`}>
                {h.valueMinor !== null ? (
                  <>
                    {formatMinor(h.valueMinor, h.currency, locale)}
                    <span className="block text-caption text-text-muted">
                      {formatMinor(h.valueRonMinor!, "RON", locale)}
                    </span>
                  </>
                ) : (
                  "—"
                )}
              </td>
              <td className={`${cell} ${num}`}>
                {h.unrealizedMinor !== null ? (
                  <span
                    className={
                      h.unrealizedRonMinor! >= 0
                        ? "text-status-positive-text"
                        : "text-status-negative-text"
                    }
                  >
                    {h.unrealizedMinor >= 0 ? "+" : "−"}
                    {formatMinor(Math.abs(h.unrealizedMinor), h.currency, locale)}
                    <span className="block text-caption">
                      {h.unrealizedRonMinor! >= 0 ? "+" : "−"}
                      {formatMinor(Math.abs(h.unrealizedRonMinor!), "RON", locale)}
                    </span>
                  </span>
                ) : (
                  "—"
                )}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="text-text-primary">
            <td className={cell}>{t("totalPricedRow")}</td>
            <td className={cell} />
            <td className={`${cell} ${num}`}>{formatMinor(result.totals.valuedBasisRonMinor, "RON", locale)}</td>
            <td className={cell} />
            <td className={`${cell} ${num}`}>{formatMinor(result.totals.valueRonMinor, "RON", locale)}</td>
            <td className={`${cell} ${num}`}>
              <span
                className={
                  result.totals.unrealizedRonMinor >= 0
                    ? "text-status-positive-text"
                    : "text-status-negative-text"
                }
              >
                {result.totals.unrealizedRonMinor >= 0 ? "+" : "−"}
                {formatMinor(Math.abs(result.totals.unrealizedRonMinor), "RON", locale)}
              </span>
            </td>
          </tr>
        </tfoot>
      </table>
      <p className="text-caption text-text-muted">
        {t("valued", { date: formatDate(result.date, locale) })}
        {result.totals.unpricedCount > 0 &&
          ` — ${t("excludesUnpriced", {
            count: result.totals.unpricedCount,
            basis: formatMinor(
              result.totals.basisRonMinor - result.totals.valuedBasisRonMinor,
              "RON",
              locale,
            ),
          })}`}
        {". "}
        {t("pricesManualNote")}
      </p>
    </div>
  );
}
