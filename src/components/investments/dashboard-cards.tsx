/**
 * Investment dashboard cards (Phase 4 Stage 5) — PRESENTATION ONLY over a
 * ValuationResult. Hook-free and pure so the same components render on the
 * server dashboard and in the gallery's fixture demos.
 *
 * THE THREE HONESTY RULES (acceptance bar — presentation must never undo
 * Stage 4's care):
 * 1. Cards NEVER recompute — totals and per-holding figures render verbatim
 *    from the valuation service.
 * 2. unpricedCount is surfaced verbatim: an excluded holding is named and
 *    counted, never silently absorbed into a clean total.
 * 3. Stale prices are surfaced WITH their date; absence renders as absence
 *    ("no holdings", an invite, an em-dash) — NEVER as "0.00 RON".
 */
import Link from "next/link";
import { formatMinor } from "@/lib/format";
import type { ValuationResult } from "@/lib/investments/valuation";

const card = "flex flex-col gap-2 rounded-card border border-border-hairline bg-surface p-4";
const cardTitle = "text-micro uppercase text-text-muted";
const num = "font-numeric tabular-nums";

const signed = (minor: number, currency: string) =>
  `${minor >= 0 ? "+" : "−"}${formatMinor(Math.abs(minor), currency)}`;
const signClass = (minor: number) =>
  minor >= 0 ? "text-status-positive-text" : "text-status-negative-text";

function oldestStaleDate(result: ValuationResult): string | null {
  const staleDates = result.holdings
    .filter((h) => h.price?.stale)
    .map((h) => h.price!.priceDate)
    .sort();
  return staleDates[0] ?? null;
}

function HonestyLines({ result }: { result: ValuationResult }) {
  const stale = oldestStaleDate(result);
  const excludedBasis = result.totals.basisRonMinor - result.totals.valuedBasisRonMinor;
  return (
    <>
      {result.totals.unpricedCount > 0 && (
        <p className="text-caption text-status-warning-text">
          Excludes {result.totals.unpricedCount} unpriced holding
          {result.totals.unpricedCount > 1 ? "s" : ""} (basis{" "}
          <span className={num}>{formatMinor(excludedBasis, "RON")}</span>).
        </p>
      )}
      {stale && (
        <p className="text-caption text-status-warning-text">
          Includes prices as old as {stale}.
        </p>
      )}
    </>
  );
}

/** Card 1 — the headline; the only card that exists on day one. */
export function InvestmentSummaryCard({
  result,
  investmentsHref,
}: {
  result: ValuationResult;
  investmentsHref: string;
}) {
  // Day one: no holdings at all — an honest invite, never a zero.
  if (result.holdings.length === 0) {
    return (
      <div className={card}>
        <h3 className={cardTitle}>Portfolio value</h3>
        <p className="text-secondary text-text-muted">
          No holdings yet. Record your first trade and portfolio value, unrealized
          gain, and allocation appear here.
        </p>
        <Link
          href={investmentsHref}
          className="self-start text-secondary text-text-primary underline underline-offset-4 outline-none focus-visible:ring-3 focus-visible:ring-focus-ring"
        >
          Record a trade
        </Link>
      </div>
    );
  }

  const priced = result.holdings.filter((h) => h.valueRonMinor !== null);
  // Holdings exist but NONE are priced: the portfolio has a real cost basis
  // and no market value — show that fact, never a clean 0.00 total.
  if (priced.length === 0) {
    return (
      <div className={card}>
        <h3 className={cardTitle}>Portfolio value</h3>
        <p className="text-secondary text-text-primary">
          {result.holdings.length} holding{result.holdings.length > 1 ? "s" : ""}, none
          priced yet — cost basis{" "}
          <span className={num}>{formatMinor(result.totals.basisRonMinor, "RON")}</span>.
        </p>
        <p className="text-caption text-text-muted">
          Add a price snapshot on the investments page to value them.
        </p>
      </div>
    );
  }

  // Per-currency subtotals of the priced holdings (original currencies).
  const byCurrency = new Map<string, number>();
  for (const h of priced) {
    byCurrency.set(h.currency, (byCurrency.get(h.currency) ?? 0) + h.valueMinor!);
  }

  return (
    <div className={card}>
      <h3 className={cardTitle}>Portfolio value</h3>
      <p className={`text-number-lg text-text-primary ${num}`}>
        {formatMinor(result.totals.valueRonMinor, "RON")}
      </p>
      <p className="text-secondary">
        <span className={`${num} ${signClass(result.totals.unrealizedRonMinor)}`}>
          {signed(result.totals.unrealizedRonMinor, "RON")}
        </span>{" "}
        <span className="text-text-muted">
          unrealized on{" "}
          <span className={num}>{formatMinor(result.totals.valuedBasisRonMinor, "RON")}</span>{" "}
          basis
        </span>
      </p>
      <p className="text-caption text-text-muted">
        {[...byCurrency.entries()]
          .map(([currency, value]) => `${formatMinor(value, currency)}`)
          .join(" · ")}{" "}
        — valued {result.date}
      </p>
      <HonestyLines result={result} />
    </div>
  );
}

/** Card 2 — allocation. Hidden until at least one holding exists; unpriced
 * holdings never get a bar (a bar implies a share of a total they aren't
 * in) — they are named beneath. */
export function AllocationCard({ result }: { result: ValuationResult }) {
  if (result.holdings.length === 0) return null;
  const priced = result.holdings.filter((h) => h.valueRonMinor !== null);
  const unpriced = result.holdings.filter((h) => h.valueRonMinor === null);
  const total = result.totals.valueRonMinor;

  return (
    <div className={card}>
      <h3 className={cardTitle}>Allocation</h3>
      {priced.length === 0 ? (
        <p className="text-secondary text-text-muted">
          Nothing priced yet — allocation appears once holdings have prices.
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {priced.map((h) => {
            const pct = total > 0 ? Math.round(((h.valueRonMinor ?? 0) / total) * 100) : 0;
            return (
              <li key={`${h.cashAccountId}-${h.securityId}`} className="flex flex-col gap-0.5">
                <div className="flex items-baseline justify-between gap-2 text-secondary">
                  <span className="text-text-primary">
                    {h.ticker}
                    {h.price?.stale && (
                      <span className="text-caption text-status-warning-text">
                        {" "}
                        as of {h.price.priceDate}
                      </span>
                    )}
                  </span>
                  <span className={`${num} text-text-muted`}>
                    {formatMinor(h.valueRonMinor!, "RON")} · {pct}%
                  </span>
                </div>
                <div className="h-1.5 w-full rounded-badge bg-surface-inactive">
                  <div
                    className="h-1.5 rounded-badge bg-accent"
                    style={{ width: `${Math.max(pct, 2)}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {unpriced.length > 0 && (
        <p className="text-caption text-status-warning-text">
          Not valued: {unpriced.map((h) => `${h.ticker} (no price)`).join(", ")}.
        </p>
      )}
    </div>
  );
}

/** Card 3 — by owner (household profile only). An owner with no holdings
 * reads "no holdings" — never 0.00 RON. */
export function OwnerCard({ result }: { result: ValuationResult }) {
  if (result.holdings.length === 0) return null;
  const owners = ["greg", "andra"] as const;
  const label: Record<(typeof owners)[number], string> = { greg: "Greg", andra: "Andra" };

  return (
    <div className={card}>
      <h3 className={cardTitle}>By owner</h3>
      <ul className="flex flex-col gap-1.5">
        {owners.map((owner) => {
          const theirs = result.holdings.filter((h) => h.owner === owner);
          const priced = theirs.filter((h) => h.valueRonMinor !== null);
          const value = priced.reduce((s, h) => s + (h.valueRonMinor ?? 0), 0);
          const unrealized = priced.reduce((s, h) => s + (h.unrealizedRonMinor ?? 0), 0);
          return (
            <li key={owner} className="flex items-baseline justify-between gap-2 text-secondary">
              <span className="text-text-primary">{label[owner]}</span>
              {theirs.length === 0 ? (
                <span className="text-text-muted">no holdings</span>
              ) : priced.length === 0 ? (
                <span className="text-text-muted">
                  {theirs.length} holding{theirs.length > 1 ? "s" : ""}, unpriced
                </span>
              ) : (
                <span className={num}>
                  <span className="text-text-primary">{formatMinor(value, "RON")}</span>{" "}
                  <span className={signClass(unrealized)}>{signed(unrealized, "RON")}</span>
                  {priced.length < theirs.length && (
                    <span className="text-caption text-status-warning-text">
                      {" "}
                      +{theirs.length - priced.length} unpriced
                    </span>
                  )}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
