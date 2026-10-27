import { describe, expect, it } from "vitest";
import { chainlinkTo1e18, formatUsd1e18, parseExactDecimal, toUsd1e18, usdToUsd1e18 } from "../../src/units";

const E18 = 10n ** 18n;

describe("usdToUsd1e18 (no float drift)", () => {
  it("converts whole and decimal USD exactly", () => {
    expect(usdToUsd1e18(2200)).toBe(2200n * E18);
    expect(usdToUsd1e18(2205.05)).toBe(2205050000000000000000n);
    expect(usdToUsd1e18("2205.05")).toBe(2205050000000000000000n);
    expect(usdToUsd1e18(1.12)).toBe(1120000000000000000n);
    expect(usdToUsd1e18(0.1)).toBe(100000000000000000n);
    expect(usdToUsd1e18("1e3")).toBe(1000n * E18);
    expect(usdToUsd1e18(-1)).toBe(-E18);
  });

  it("does not equal the floating-point product where that drifts", () => {
    // 2205.05 * 1e18 in floating point is not 2205050000000000000000.
    expect(BigInt(Math.round(2205.05 * 1e18))).not.toBe(usdToUsd1e18(2205.05));
  });

  it("rejects NaN, Infinity, junk and more than 18 decimal places", () => {
    expect(() => usdToUsd1e18(Number.NaN)).toThrow();
    expect(() => usdToUsd1e18(Number.POSITIVE_INFINITY)).toThrow();
    expect(() => usdToUsd1e18("abc")).toThrow();
    expect(() => usdToUsd1e18("")).toThrow();
    expect(() => usdToUsd1e18("0.0000000000000000001")).toThrow();
  });
});

describe("toUsd1e18 (oracle raw price → USD 1e18)", () => {
  it("brings a 6-decimal stablecoin raw price of about 1e30 to about 1e18", () => {
    const rawUsdc = 1_000_100_000_000_000_000_000_000_000_000n; // ≈ 1.0001e30
    expect(toUsd1e18(rawUsdc, 6)).toBe(1_000_100_000_000_000_000n);
  });
  it("leaves an 18-decimal token unchanged", () => {
    expect(toUsd1e18(2205n * E18, 18)).toBe(2205n * E18);
  });
  it("rejects nonsense decimals", () => {
    expect(() => toUsd1e18(1n, -1)).toThrow();
    expect(() => toUsd1e18(1n, 1.5)).toThrow();
  });
});

describe("chainlinkTo1e18", () => {
  it("scales an 8-decimal answer by 10^10", () => {
    expect(chainlinkTo1e18(220505000000n, 8)).toBe(2205050000000000000000n);
  });
  it("leaves an 18-decimal answer unchanged", () => {
    expect(chainlinkTo1e18(1_070_000_000_000_000_000n, 18)).toBe(1_070_000_000_000_000_000n);
  });
});

describe("formatUsd1e18", () => {
  it("formats with thousands separators and cents", () => {
    expect(formatUsd1e18(2205050000000000000000n)).toBe("$2,205.05");
    expect(formatUsd1e18(1120000000000000000n)).toBe("$1.12");
    expect(formatUsd1e18(0n)).toBe("$0.00");
    expect(formatUsd1e18(1_234_567n * E18)).toBe("$1,234,567.00");
    expect(formatUsd1e18(-E18)).toBe("-$1.00");
  });
  it("rounds half a cent up", () => {
    expect(formatUsd1e18(1_005_000_000_000_000_000n)).toBe("$1.01");
    expect(formatUsd1e18(1_004_999_999_999_999_999n)).toBe("$1.00");
  });
});

describe("parseExactDecimal", () => {
  it("reads exponent forms that String(number) produces", () => {
    expect(parseExactDecimal(1e21)).toEqual({ digits: 10n ** 21n, scale: 0 });
    expect(parseExactDecimal(1.5e-7)).toEqual({ digits: 15n, scale: 8 });
  });
});
