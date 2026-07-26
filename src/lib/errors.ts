/**
 * src/lib/errors.ts — typed gateway errors → honest HTTP responses.
 *
 * Invariant: a buyer is never charged for a failed origin call. Errors thrown
 * BEFORE settle abort the payment; the classes here name the reason.
 */

export class GatewayError extends Error {
  constructor(
    message: string,
    /** HTTP status returned to the caller. */
    readonly status: number,
    /** Machine-readable reason for agents. */
    readonly code: string,
    /** Hint for agents: is retrying this request sensible? */
    readonly retryable: boolean = false
  ) {
    super(message);
    this.name = "GatewayError";
  }
}

export const killSwitchError = () =>
  new GatewayError("Gateway temporarily paused by operator", 503, "kill_switch", true);

export const breakerOpenError = (route: string) =>
  new GatewayError(`Origin for ${route} is failing — route paused`, 503, "origin_unhealthy", true);

export const originError = (status: number) =>
  // Post-payment failure: the origin was already paid — auto-retrying would
  // double-spend, so this is never retryable at the protocol level.
  new GatewayError(`Origin service failed (upstream ${status})`, 502, "origin_error", false);

export const originUnreachable = () =>
  new GatewayError("Origin service unreachable (network error)", 502, "origin_unreachable", true);

export const originTimeout = () =>
  new GatewayError("Origin service timed out", 504, "origin_timeout", true);

export const spendCapError = (priceUsd: number, capUsd: number) =>
  new GatewayError(
    `Origin price $${priceUsd} exceeds per-request cap $${capUsd}`,
    503,
    "spend_cap"
  );
