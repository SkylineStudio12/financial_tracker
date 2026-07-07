/**
 * The BASIC holdings table (Stage 4 scope: prove the numbers; the dashboard
 * presentation is Stage 5). Server component — renders a ValuationResult.
 * Unpriced holdings show "no price" (never zero) and the totals row names
 * how many were excluded; stale prices carry their real date.
 */
import { formatMinor } from "@/lib/format";
import { displayQuantity } from "@/lib/investments/trade-rules";
import type { ValuationResult } from "@/lib/investments/valuation";

const num = "text-right font-numeric tabular-nums";
const cell = "px-[var(--density-row-padding-x)] py-[var(--density-row-padding-y)]";

export function HoldingsTable({ result }: { result: ValuationResult }) {
  if (result.holdings.length === 0) {
    return (
      <p className="text-secondary text-text-muted">
        No open holdings yet — book a buy and it appears here.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <table className="w-full text-secondary">
        <thead>
          <tr className="border-b border-border-hairline text-caption text-text-muted">
            <th className={`${cell} text-left font-normal`}>Holding</th>
            <th className={`${cell} text-right font-normal`}>Qty</th>
            <th className={`${cell} text-right font-normal`}>Cost basis</th>
            <th className={`${cell} text-right font-normal`}>Price</th>
            <th className={`${cell} text-right font-normal`}>Value</th>
            <th className={`${cell} text-right font-normal`}>Unrealized</th>
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
                {formatMinor(h.basisMinor, h.currency)}
                <span className="block text-caption text-text-muted">
                  {formatMinor(h.basisRonMinor, "RON")}
                </span>
              </td>
              <td className={`${cell} ${num}`}>
                {h.price ? (
                  <>
                    {formatMinor(h.price.priceMinor, h.currency)}
                    <span
                      className={`block text-caption ${
                        h.price.stale ? "text-status-warning-text" : "text-text-muted"
                      }`}
                    >
                      {h.price.stale ? `stale — as of ${h.price.priceDate}` : h.price.priceDate}
                    </span>
                  </>
                ) : (
                  <span className="text-status-warning-text">no price — not valued</span>
                )}
              </td>
              <td className={`${cell} ${num}`}>
                {h.valueMinor !== null ? (
                  <>
                    {formatMinor(h.valueMinor, h.currency)}
                    <span className="block text-caption text-text-muted">
                      {formatMinor(h.valueRonMinor!, "RON")}
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
                    {formatMinor(Math.abs(h.unrealizedMinor), h.currency)}
                    <span className="block text-caption">
                      {h.unrealizedRonMinor! >= 0 ? "+" : "−"}
                      {formatMinor(Math.abs(h.unrealizedRonMinor!), "RON")}
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
            <td className={cell}>Total (RON, priced holdings)</td>
            <td className={cell} />
            <td className={`${cell} ${num}`}>{formatMinor(result.totals.valuedBasisRonMinor, "RON")}</td>
            <td className={cell} />
            <td className={`${cell} ${num}`}>{formatMinor(result.totals.valueRonMinor, "RON")}</td>
            <td className={`${cell} ${num}`}>
              <span
                className={
                  result.totals.unrealizedRonMinor >= 0
                    ? "text-status-positive-text"
                    : "text-status-negative-text"
                }
              >
                {result.totals.unrealizedRonMinor >= 0 ? "+" : "−"}
                {formatMinor(Math.abs(result.totals.unrealizedRonMinor), "RON")}
              </span>
            </td>
          </tr>
        </tfoot>
      </table>
      <p className="text-caption text-text-muted">
        Valued {result.date}
        {result.totals.unpricedCount > 0 &&
          ` — excludes ${result.totals.unpricedCount} unpriced holding${
            result.totals.unpricedCount > 1 ? "s" : ""
          } (basis ${formatMinor(
            result.totals.basisRonMinor - result.totals.valuedBasisRonMinor,
            "RON",
          )})`}
        . Prices are manual snapshots for now; positions are shown at market where priced.
      </p>
    </div>
  );
}
