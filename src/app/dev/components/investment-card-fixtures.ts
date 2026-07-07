/**
 * Fixture ValuationResults for the gallery's investment-card demos — the
 * PERMANENT visual + regression reference for the Stage-5 honesty rules
 * (owner-approved verification path: fixtures, never seeded holdings, so
 * real accounts and batch data are untouched by construction).
 *
 * Each fixture exercises a rule: no-bar-for-unpriced, exclusion-line-
 * present, stale-date-shown, never-a-zero-for-absence. Figures are
 * internally consistent (value − basis = unrealized; totals = sums over
 * priced holdings) so the cards render exactly what the service would emit.
 */
import type { ValuationResult } from "@/lib/investments/valuation";

const DATE = "2026-07-07";

const holding = (
  over: Partial<ValuationResult["holdings"][number]> &
    Pick<ValuationResult["holdings"][number], "securityId" | "ticker">,
): ValuationResult["holdings"][number] => ({
  cashAccountId: "fixture-cash",
  cashAccountName: "Greg — Revolut brokerage",
  owner: "greg",
  securityName: over.ticker,
  currency: "USD",
  quantity: "10.00000000",
  basisMinor: 0,
  basisRonMinor: 0,
  price: null,
  valueMinor: null,
  valueRonMinor: null,
  unrealizedMinor: null,
  unrealizedRonMinor: null,
  ...over,
});

/** Day one: nothing held. Card 1 shows the invite; cards 2/3 render nothing. */
export const EMPTY: ValuationResult = {
  date: DATE,
  holdings: [],
  totals: {
    basisRonMinor: 0,
    valuedBasisRonMinor: 0,
    valueRonMinor: 0,
    unrealizedRonMinor: 0,
    unpricedCount: 0,
  },
};

/** The realistic early state: 2 holdings, 1 unpriced — one 100%-of-priced
 * bar, the other NAMED as excluded; the exclusion line carries its basis. */
export const SPARSE_ONE_UNPRICED: ValuationResult = {
  date: DATE,
  holdings: [
    holding({
      securityId: "fx-vuaa",
      ticker: "VUAA",
      securityName: "Vanguard S&P 500 UCITS",
      quantity: "5.00000000",
      basisMinor: 6_000,
      basisRonMinor: 30_600,
      price: { priceMinor: 1_600, priceDate: DATE, stale: false },
      valueMinor: 8_000,
      valueRonMinor: 40_000,
      unrealizedMinor: 2_000,
      unrealizedRonMinor: 9_400,
    }),
    holding({
      securityId: "fx-nkd",
      ticker: "NKD",
      securityName: "Unpriced Example",
      quantity: "3.00000000",
      basisMinor: 600,
      basisRonMinor: 2_760,
    }),
  ],
  totals: {
    basisRonMinor: 33_360,
    valuedBasisRonMinor: 30_600,
    valueRonMinor: 40_000,
    unrealizedRonMinor: 9_400,
    unpricedCount: 1,
  },
};

/** A grown portfolio with one STALE price — the summary names the oldest
 * stale date; the allocation row carries its own "as of". Owners mixed so
 * the household By-owner card shows both. */
export const POPULATED_WITH_STALE: ValuationResult = {
  date: DATE,
  holdings: [
    holding({
      securityId: "fx-vuaa2",
      ticker: "VUAA",
      securityName: "Vanguard S&P 500 UCITS",
      basisMinor: 100_000,
      basisRonMinor: 460_000,
      price: { priceMinor: 11_000, priceDate: "2026-06-27", stale: true },
      valueMinor: 110_000,
      valueRonMinor: 550_000,
      unrealizedMinor: 10_000,
      unrealizedRonMinor: 90_000,
    }),
    holding({
      securityId: "fx-aapl",
      ticker: "AAPL",
      securityName: "Apple Inc.",
      quantity: "3.50000000",
      basisMinor: 50_000,
      basisRonMinor: 230_000,
      price: { priceMinor: 12_857, priceDate: DATE, stale: false },
      valueMinor: 45_000,
      valueRonMinor: 225_000,
      unrealizedMinor: -5_000,
      unrealizedRonMinor: -5_000,
    }),
    holding({
      securityId: "fx-eunl",
      ticker: "EUNL",
      securityName: "iShares Core MSCI World",
      cashAccountName: "Andra — Revolut brokerage EUR",
      owner: "andra",
      currency: "EUR",
      basisMinor: 80_000,
      basisRonMinor: 404_000,
      price: { priceMinor: 8_800, priceDate: DATE, stale: false },
      valueMinor: 88_000,
      valueRonMinor: 444_400,
      unrealizedMinor: 8_000,
      unrealizedRonMinor: 40_400,
    }),
  ],
  totals: {
    basisRonMinor: 1_094_000,
    valuedBasisRonMinor: 1_094_000,
    valueRonMinor: 1_219_400,
    unrealizedRonMinor: 125_400,
    unpricedCount: 0,
  },
};

/** Holdings exist, nothing priced: the portfolio has a real cost basis and
 * no market value — the card says exactly that, never a clean 0.00 RON. */
export const ALL_UNPRICED: ValuationResult = {
  date: DATE,
  holdings: [
    holding({
      securityId: "fx-a",
      ticker: "VUAA",
      securityName: "Vanguard S&P 500 UCITS",
      basisMinor: 10_000,
      basisRonMinor: 46_000,
    }),
    holding({
      securityId: "fx-b",
      ticker: "EUNL",
      securityName: "iShares Core MSCI World",
      owner: "andra",
      currency: "EUR",
      basisMinor: 8_000,
      basisRonMinor: 40_400,
    }),
  ],
  totals: {
    basisRonMinor: 86_400,
    valuedBasisRonMinor: 0,
    valueRonMinor: 0,
    unrealizedRonMinor: 0,
    unpricedCount: 2,
  },
};
