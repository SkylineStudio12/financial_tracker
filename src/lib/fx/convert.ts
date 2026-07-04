/**
 * Exact conversion of integer minor units by a decimal rate string.
 * Done in BigInt (rate scaled to 6 decimals, matching numeric(18,6)) so no
 * float ever touches a money amount; rounds half away from zero.
 */
export function convertMinorToRon(amountMinor: number, rate: string): number {
  if (!Number.isSafeInteger(amountMinor)) {
    throw new Error(`Amount must be an integer in minor units, got ${amountMinor}`);
  }
  const match = rate.match(/^(\d+)(?:\.(\d+))?$/);
  if (!match) throw new Error(`Invalid rate: ${rate}`);
  const scaledRate = BigInt(match[1] + (match[2] ?? "").padEnd(6, "0").slice(0, 6));

  const product = BigInt(amountMinor) * scaledRate;
  const abs = product < 0n ? -product : product;
  const rounded = (abs + 500_000n) / 1_000_000n;
  const result = product < 0n ? -rounded : rounded;

  if (result > BigInt(Number.MAX_SAFE_INTEGER) || result < -BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`Converted amount out of safe range: ${result}`);
  }
  return Number(result);
}
