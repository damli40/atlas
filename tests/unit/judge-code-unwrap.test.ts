// The judges' code was published as "[atlas_…]". POST /invite takes one pair of wrapping brackets, quotes or
// backticks (and spaces) off before checking; anything else is checked exactly as typed.
import { describe, expect, it } from "vitest";
import { unwrapCode } from "../../server/access/gate";

const CODE = "atlas_" + "A".repeat(16) + "b-_9".repeat(4);

describe("unwrapCode", () => {
  it("keeps a plain code, and trims spaces", () => {
    expect(unwrapCode(CODE)).toBe(CODE);
    expect(unwrapCode(`  ${CODE}\n`)).toBe(CODE);
  });
  it("takes one pair of brackets, quotes, backticks or angle brackets off", () => {
    for (const w of [`[${CODE}]`, `[ ${CODE} ]`, `"${CODE}"`, `'${CODE}'`, `\`${CODE}\``, `<${CODE}>`]) expect(unwrapCode(w)).toBe(CODE);
  });
  it("leaves anything that isn't a wrapped code as typed (so it is refused as before)", () => {
    expect(unwrapCode(`[${CODE}`)).toBe(`[${CODE}`);
    expect(unwrapCode(`[[${CODE}]]`)).toBe(`[[${CODE}]]`);
    expect(unwrapCode(`[not a code]`)).toBe(`[not a code]`);
    expect(unwrapCode(`[${CODE}x]`)).toBe(`[${CODE}x]`);
    expect(unwrapCode("")).toBe("");
  });
});
