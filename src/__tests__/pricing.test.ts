import { describe, it, expect } from "vitest";
import { roamPriceUsd, usdString } from "../pricing";

describe("pricing (traction mode: parity)", () => {
  it("charges exactly the origin price", () => {
    expect(roamPriceUsd(0.0001)).toBe(0.0001);
    expect(roamPriceUsd(0.03)).toBe(0.03);
    expect(roamPriceUsd(1)).toBe(1);
  });

  it("rounds UP to a µUSDC so rounding can never lose money", () => {
    expect(roamPriceUsd(0.0000001)).toBe(0.000001);
    expect(roamPriceUsd(0.00000149)).toBe(0.000002);
  });

  it("formats USD the way x402 route configs expect", () => {
    expect(usdString(0.0365)).toBe("$0.0365");
    expect(usdString(0.0001)).toBe("$0.0001");
    expect(usdString(1)).toBe("$1");
    expect(usdString(0.2)).toBe("$0.2");
  });
});
