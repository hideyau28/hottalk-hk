/**
 * Cron request verification — accepts QStash signature OR CRON_SECRET bearer token.
 *
 * QStash signs every request with `Upstash-Signature` header.
 * Vercel Cron uses `Authorization: Bearer <CRON_SECRET>`.
 * This helper accepts either so both triggers work.
 */

import { NextRequest } from "next/server";

const CRON_SECRET = process.env.CRON_SECRET ?? "";
const QSTASH_CURRENT_SIGNING_KEY = process.env.QSTASH_CURRENT_SIGNING_KEY ?? "";
const QSTASH_NEXT_SIGNING_KEY = process.env.QSTASH_NEXT_SIGNING_KEY ?? "";

/**
 * Verify a cron request came from QStash or Vercel Cron.
 * Returns null if valid, or an error string if invalid.
 */
export async function verifyCronRequest(
  request: NextRequest,
): Promise<string | null> {
  // Path 1: Vercel Cron — Bearer token
  const authHeader = request.headers.get("authorization");
  if (authHeader === `Bearer ${CRON_SECRET}` && CRON_SECRET) {
    return null; // valid
  }

  // Path 2: QStash signature
  const signature = request.headers.get("upstash-signature");
  if (signature && QSTASH_CURRENT_SIGNING_KEY) {
    const isValid = await verifyQStashSignature(request, signature);
    if (isValid) return null; // valid
    return "Invalid QStash signature";
  }

  return "Unauthorized — no valid CRON_SECRET or QStash signature";
}

async function verifyQStashSignature(
  request: NextRequest,
  signature: string,
): Promise<boolean> {
  // QStash JWT verification using Web Crypto API
  // The signature is a JWT signed with the signing key
  try {
    const body = await request.clone().text();

    // Try current key first, then next key (for key rotation)
    for (const key of [QSTASH_CURRENT_SIGNING_KEY, QSTASH_NEXT_SIGNING_KEY]) {
      if (!key) continue;
      if (await verifyJWT(signature, key, body, request.url)) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

async function verifyJWT(
  token: string,
  signingKey: string,
  expectedBody: string,
  expectedUrl: string,
): Promise<boolean> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return false;

    const [headerB64, payloadB64, signatureB64] = parts;

    // Verify HMAC-SHA256 signature
    const encoder = new TextEncoder();
    const keyData = encoder.encode(signingKey);
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      keyData,
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );

    const signedContent = encoder.encode(`${headerB64}.${payloadB64}`);
    const signatureBytes = base64UrlDecode(signatureB64);

    const valid = await crypto.subtle.verify(
      "HMAC",
      cryptoKey,
      signatureBytes,
      signedContent,
    );

    if (!valid) return false;

    // Decode and validate payload
    const payload = JSON.parse(
      new TextDecoder().decode(base64UrlDecode(payloadB64)),
    );

    // Check expiry
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) return false;

    // Check not-before
    if (payload.nbf && payload.nbf > now) return false;

    // Check body hash if present
    if (payload.body) {
      const bodyHash = await sha256Base64Url(expectedBody);
      if (payload.body !== bodyHash) return false;
    }

    return true;
  } catch {
    return false;
  }
}

function base64UrlDecode(str: string): Uint8Array {
  const base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function sha256Base64Url(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const hash = await crypto.subtle.digest("SHA-256", encoder.encode(data));
  const bytes = new Uint8Array(hash);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
