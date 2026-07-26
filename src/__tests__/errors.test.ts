import { describe, it, expect } from "vitest";
import {
  killSwitchError,
  breakerOpenError,
  originError,
  originUnreachable,
  originTimeout,
  spendCapError,
} from "../lib/errors";

describe("error taxonomy — retryability is a money-safety contract", () => {
  it("pre-payment refusals are retryable (nothing was charged)", () => {
    expect(killSwitchError().retryable).toBe(true);
    expect(breakerOpenError("x").retryable).toBe(true);
    expect(originUnreachable().retryable).toBe(true);
    expect(originTimeout().retryable).toBe(true);
  });

  it("post-payment origin failures are NEVER retryable (double-pay risk)", () => {
    expect(originError(500).retryable).toBe(false);
    expect(originError(502).retryable).toBe(false);
    expect(originError(404).retryable).toBe(false);
  });

  it("carries machine-readable codes and correct statuses", () => {
    expect(killSwitchError().code).toBe("kill_switch");
    expect(originTimeout().status).toBe(504);
    expect(spendCapError(2, 1).code).toBe("spend_cap");
  });
});
