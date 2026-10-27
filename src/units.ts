// Unit conversions. This is the ONLY file in Atlas that changes the scale of a number.
//
// "USD 1e18" means a US-dollar amount stored as a whole number of 10^-18 dollars,
// so $1 is 1000000000000000000n. Every on-chain price Atlas shows passes through here.
//
// Nothing here uses floating point for the conversion itself: numbers are turned into
// their shortest decimal text first and then parsed digit by digit, so 2205.05 becomes
// exactly 2205050000000000000000n (2205.05 * 1e18 in floating point would not).

const USD_DECIMALS = 18;

/** An exact decimal: the value is digits / 10^scale. */
export interface ExactDecimal {
  digits: bigint;
  scale: number;
}

const DECIMAL_RE = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/;

/**
 * Parse a finite number or a decimal string ("2205.05", "-1", "1e3", "1.5e-7") into an
 * exact decimal. Throws on NaN, Infinity, empty strings and anything that is not a plain
 * decimal. A JS number is read through its shortest round-trip text, so the result is
 * the number the person typed, not its binary approximation.
 */
export function parseExactDecimal(input: number | string): ExactDecimal {
  let text: string;
  if (typeof input === "number") {
    if (!Number.isFinite(input)) throw new RangeError(`not a finite number: ${input}`);
    text = String(input);
  } else if (typeof input === "string") {
    text = input.trim();
  } else {
    throw new TypeError("expected a number or a decimal string");
  }
  const m = DECIMAL_RE.exec(text);
  if (!m) throw new RangeError(`not a decimal number: "${text}"`);
  const [, sign, intPart = "", fracPart = "", expPart] = m;
  if (intPart === "" && fracPart === "") throw new RangeError(`not a decimal number: "${text}"`);
  const exp = expPart === undefined ? 0 : Number(expPart);
  if (!Number.isSafeInteger(exp) || Math.abs(exp) > 1000) {
    throw new RangeError(`exponent out of range: "${text}"`);
  }
  let digits = BigInt((intPart + fracPart) || "0");
  let scale = fracPart.length - exp;
  if (scale < 0) {
    digits *= 10n ** BigInt(-scale);
    scale = 0;
  }
  if (sign === "-") digits = -digits;
  return { digits, scale };
}

/** Bring two exact decimals to the same scale so their digits can be compared directly. */
export function alignDecimals(a: ExactDecimal, b: ExactDecimal): [bigint, bigint, number] {
  const scale = Math.max(a.scale, b.scale);
  return [
    a.digits * 10n ** BigInt(scale - a.scale),
    b.digits * 10n ** BigInt(scale - b.scale),
    scale,
  ];
}

function checkDecimals(name: string, d: number): void {
  if (!Number.isInteger(d) || d < 0 || d > 77) {
    throw new RangeError(`${name} must be a whole number from 0 to 77, got ${d}`);
  }
}

/** Multiply or divide by a power of ten. Division truncates toward zero (bigint division). */
function shiftDecimal(value: bigint, places: number): bigint {
  if (places >= 0) return value * 10n ** BigInt(places);
  return value / 10n ** BigInt(-places);
}

/**
 * A lending-market oracle's `getUnderlyingPrice` returns the price scaled by
 * 10^(36 − tokenDecimals), so a 6-decimal stablecoin reads about 1e30 for $1.
 * This brings it back to USD 1e18: raw / 10^(18 − tokenDecimals).
 */
export function toUsd1e18(rawUnderlyingPrice: bigint, tokenDecimals: number): bigint {
  checkDecimals("tokenDecimals", tokenDecimals);
  return shiftDecimal(rawUnderlyingPrice, tokenDecimals - USD_DECIMALS);
}

/**
 * A Chainlink answer with `feedDecimals` decimals (8 for USD feeds, 18 for ETH ratio
 * feeds), brought to 18 decimals: answer × 10^(18 − feedDecimals).
 */
export function chainlinkTo1e18(answer: bigint, feedDecimals: number): bigint {
  checkDecimals("feedDecimals", feedDecimals);
  return shiftDecimal(answer, USD_DECIMALS - feedDecimals);
}

/**
 * A USD 1e18 price times a ratio with 18 decimals (for example cbETH/ETH), as USD 1e18:
 * usd1e18 × ratio1e18 / 10^18. Division truncates toward zero. Used for the cbETH reference
 * (ETH/USD × cbETH/ETH), so the one rescaling step lives here.
 */
export function usdTimesRatio1e18(usd1e18: bigint, ratio1e18: bigint): bigint {
  return (usd1e18 * ratio1e18) / 10n ** BigInt(USD_DECIMALS);
}

/**
 * A USD amount a person or model typed (2200, 2205.05, "1.12") as USD 1e18.
 * Throws if it has more than 18 decimal places, because that cannot be stored exactly.
 */
export function usdToUsd1e18(usd: number | string): bigint {
  const { digits, scale } = parseExactDecimal(usd);
  if (scale > USD_DECIMALS) {
    const extra = 10n ** BigInt(scale - USD_DECIMALS);
    if (digits % extra !== 0n) {
      throw new RangeError(`more than ${USD_DECIMALS} decimal places: ${String(usd)}`);
    }
    return digits / extra;
  }
  return digits * 10n ** BigInt(USD_DECIMALS - scale);
}

/** USD 1e18 as "$2,205.05" (rounded to the cent, halves away from zero; "-$1.00" when negative). */
export function formatUsd1e18(value: bigint): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const centUnit = 10n ** BigInt(USD_DECIMALS - 2);
  let cents = abs / centUnit;
  if ((abs % centUnit) * 2n >= centUnit) cents += 1n;
  const whole = (cents / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = (cents % 100n).toString().padStart(2, "0");
  return `${negative && cents !== 0n ? "-" : ""}$${whole}.${frac}`;
}

// ---------- the unit of every measured field ----------
//
// One place that says what each measured field counts in. The judge refuses (can't check) any bet
// whose unit is not the field's unit, so "12 s" is never compared with 12000 ms, and "2205" is never
// compared with a price stored in USD 1e18. A field missing from this table has no known unit, and
// the judge will not compare a bet with it.

/** "count" = a whole number of things; "ms" = milliseconds (virtual); "USD" = a price stored as USD 1e18; "enum" = one word from a fixed list. */
export type MeasuredUnit = "count" | "ms" | "USD" | "enum";

/** The outcome words, exactly as the TS harness writes them. Bets on `outcome` must use these. */
export const OUTCOME_OPTIONS = ["returns", "throws", "pending"] as const;

/**
 * The ONE name of the settle-time field: the TS runner measures it (runners/ts/harness.ts writes
 * `settledAtMs`, virtual ms from the call to when it returned or threw) and the settle-time question
 * measures the same field (src/gate.ts). A run that never settles leaves it in notMeasured with why.
 */
export const SETTLE_FIELD = "settledAtMs" as const;

const PRICE_FIELD_PREFIX = "priceUsd1e18:";

const FIELD_UNITS: Readonly<Record<string, MeasuredUnit>> = {
  calls: "count",
  waitCount: "count",
  logCount: "count",
  thrownFromCall: "count",
  totalWaitMs: "ms",
  settledAtMs: "ms",
  outcome: "enum",
};

/** The fixed list of words an enum field can hold. */
export const ENUM_FIELD_OPTIONS: Readonly<Record<string, readonly string[]>> = {
  outcome: OUTCOME_OPTIONS,
};

/** The unit of a measured field, or undefined when Atlas has none on file for it. */
export function measuredUnit(field: string): MeasuredUnit | undefined {
  if (field.startsWith(PRICE_FIELD_PREFIX)) return "USD";
  return Object.prototype.hasOwnProperty.call(FIELD_UNITS, field) ? FIELD_UNITS[field] : undefined;
}
