/**
 * Pure trade rules shared across the client/server boundary.
 *
 * The trade-entry form derives and DISPLAYS the implied broker rate live, so
 * this module must stay free of any runtime import that reaches the DB
 * (investments/service.ts → db → pg → node:dns cannot bundle for the
 * browser — the booking-rules.ts lesson). Imports here are themselves pure:
 * fx/convert is BigInt arithmetic, ledger/types only type-imports schema.
 */
import { convertMinorToRon } from "@/lib/fx/convert";
import { LedgerValidationError } from "@/lib/ledger/types";

/** numeric(20,8) share quantities as integers of 1e-8 shares. */
const QTY_SCALE = 100_000_000n;

export function parseQuantity(text: string): bigint {
  const m = text.trim().match(/^(\d+)(?:\.(\d{1,8}))?$/);
  if (!m) throw new LedgerValidationError("investments.invalidShareQuantity", { quantity: text });
  const scaled = BigInt(m[1]) * QTY_SCALE + BigInt((m[2] ?? "").padEnd(8, "0"));
  if (scaled <= 0n) throw new LedgerValidationError("investments.shareQuantityPositive");
  return scaled;
}

export function formatQuantity(scaled: bigint): string {
  return `${scaled / QTY_SCALE}.${(scaled % QTY_SCALE).toString().padStart(8, "0")}`;
}

/** Trim trailing zeros for display: "15.00000000" → "15". */
export function displayQuantity(quantity: string | bigint): string {
  const text = typeof quantity === "bigint" ? formatQuantity(quantity) : quantity;
  return text.includes(".") ? text.replace(/\.?0+$/, "") : text;
}

/**
 * Market value of a holding: price × quantity with a SINGLE round-half-up
 * at the end (BigInt, positive domain) — the same one-rounding-per-figure
 * family as the cumulative-floor basis allocation and convertMinorToRon.
 */
export function valueAtPrice(priceMinor: number, quantityScaled: bigint): number {
  if (!Number.isSafeInteger(priceMinor) || priceMinor < 0) {
    throw new LedgerValidationError("investments.invalidPrice", { price: priceMinor });
  }
  const product = BigInt(priceMinor) * quantityScaled;
  const rounded = (product + QTY_SCALE / 2n) / QTY_SCALE;
  const result = Number(rounded);
  if (!Number.isSafeInteger(result)) {
    throw new LedgerValidationError("investments.holdingValueUnsafe");
  }
  return result;
}

/**
 * The broker's applied rate, derived from the entered pair at 6 dp
 * (round half up) — the user never types a rate (Stage-2 rate rule).
 */
export function deriveRateToRon(totalRonMinor: number, totalMinor: number): string {
  const scaled =
    (2n * BigInt(totalRonMinor) * 1_000_000n + BigInt(totalMinor)) / (2n * BigInt(totalMinor));
  return `${scaled / 1_000_000n}.${(scaled % 1_000_000n).toString().padStart(6, "0")}`;
}

/**
 * The form's pre-check mirror of the service's hard reject: the derived rate
 * must reproduce the entered RON within 1 ban, else one amount is mistyped.
 * The service re-checks authoritatively at booking.
 */
export function impliedRate(
  totalRonMinor: number,
  totalMinor: number,
): { rate: string; reconciles: boolean } {
  const rate = deriveRateToRon(totalRonMinor, totalMinor);
  return {
    rate,
    reconciles: Math.abs(convertMinorToRon(totalMinor, rate) - totalRonMinor) <= 1,
  };
}
