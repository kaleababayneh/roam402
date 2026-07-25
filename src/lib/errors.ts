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
    readonly code: string
  ) {
    super(message);
    this.name = "GatewayError";
  }
}

export const killSwitchError = () =>
  new GatewayError("Gateway temporarily paused by operator", 503, "kill_switch");

export const breakerOpenError = (route: string) =>
  new GatewayError(`Origin for ${route} is failing — route paused`, 503, "origin_unhealthy");

export const originError = (status: number) =>
  new GatewayError(`Origin service failed (upstream ${status})`, 502, "origin_error");

export const spendCapError = (priceUsd: number, capUsd: number) =>
  new GatewayError(
    `Origin price $${priceUsd} exceeds per-request cap $${capUsd}`,
    503,
    "spend_cap"
  );
