/**
 * The single place where integer minor units become display strings.
 * Nothing else in the app divides by 100 or formats amounts.
 */
const amountFormatter = new Intl.NumberFormat("ro-RO", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** 1234567 minor units + "RON" → "12.345,67 RON" */
export function formatMinor(amountMinor: number, currency: string): string {
  return `${amountFormatter.format(amountMinor / 100)} ${currency}`;
}

/** Effective FX rate implied by a posting's stored amounts (display only). */
export function formatImpliedRate(amountMinor: number, amountRonMinor: number): string {
  if (amountMinor === 0) return "–";
  return (amountRonMinor / amountMinor).toFixed(4);
}

/** Dates are displayed as their ISO form (YYYY-MM-DD) for now. */
export function formatDate(isoDate: string): string {
  return isoDate;
}

/**
 * Parse user-typed major units into integer minor units without float math.
 * Accepts "1234.56", "1234,56", "1234". Returns null when not parseable.
 */
export function parseAmountToMinor(input: string): number | null {
  const normalized = input.trim().replace(/\s/g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  const [whole, fraction = ""] = normalized.split(".");
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, "0") || "0");
  return Number.isSafeInteger(minor) ? minor : null;
}

/** Minor units → "1234,56" for prefilling form inputs (no separators). */
export function minorToInput(amountMinor: number): string {
  const abs = Math.abs(amountMinor);
  return `${Math.floor(abs / 100)},${String(abs % 100).padStart(2, "0")}`;
}
