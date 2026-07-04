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
