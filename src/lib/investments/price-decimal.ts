const DECIMAL_RE = /^(0|[1-9]\d*)(?:\.(\d+))?$/;

export function parsePositivePriceDecimal(value: string, label = "Price") {
  const match = value.match(DECIMAL_RE);
  if (!match) throw new Error(`${label}: invalid decimal "${value}"`);
  const fraction = match[2] ?? "";
  const numerator = BigInt(match[1] + fraction);
  if (numerator <= 0n) throw new Error(`${label}: value must be positive`);
  return { numerator, denominator: 10n ** BigInt(fraction.length), fractionDigits: fraction.length };
}

export function validateNonNegativePriceDecimal(value: string, label: string) {
  if (!DECIMAL_RE.test(value)) throw new Error(`${label}: invalid decimal "${value}"`);
}

export function priceDecimalsEqual(left: string, right: string) {
  const a = parsePositivePriceDecimal(left, "Left price");
  const b = parsePositivePriceDecimal(right, "Right price");
  return a.numerator * b.denominator === b.numerator * a.denominator;
}

function formatExactDecimal(numerator: bigint, denominator: bigint, digits: number): string {
  const whole = numerator / denominator;
  const remainder = numerator % denominator;
  if (remainder === 0n) return whole.toString();
  const fraction = remainder.toString().padStart(digits, "0").replace(/0+$/, "");
  return `${whole}.${fraction}`;
}

/** Apply integer split factors first, then round half-up exactly once to cents. */
export function scalePriceToMinor(value: string, factor = 1) {
  if (!Number.isSafeInteger(factor) || factor <= 0) {
    throw new Error(`Invalid split factor ${factor}`);
  }
  const decimal = parsePositivePriceDecimal(value);
  const numerator = decimal.numerator * BigInt(factor);
  const roundedMinor = (2n * numerator * 100n + decimal.denominator) / (2n * decimal.denominator);
  const priceMinor = Number(roundedMinor);
  if (!Number.isSafeInteger(priceMinor) || priceMinor <= 0) {
    throw new Error(`Price ${value} exceeds safe minor-unit range`);
  }
  return {
    scaled: formatExactDecimal(numerator, decimal.denominator, decimal.fractionDigits),
    priceMinor,
  };
}
