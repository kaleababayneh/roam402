/**
 * scripts/new-receipt-key.ts — generate the Ed25519 receipt-signing key.
 *
 *   pnpm receipt:key
 *
 * Prints the private JWK (set as the RECEIPT_SIGNING_JWK secret / .dev.vars)
 * and the public did:jwk kid that verifiers will see. Writes nothing to disk.
 */

export {};

const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
const priv = (await crypto.subtle.exportKey("jwk", pair.privateKey)) as JsonWebKey;

const b64url = (s: string): string =>
  Buffer.from(s).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const kid = `did:jwk:${b64url(JSON.stringify({ kty: priv.kty, crv: priv.crv, x: priv.x }))}#0`;

console.log("RECEIPT_SIGNING_JWK (secret — wrangler secret put / .dev.vars):");
console.log(JSON.stringify({ kty: priv.kty, crv: priv.crv, x: priv.x, d: priv.d }));
console.log("\npublic kid (safe to share):");
console.log(kid);
