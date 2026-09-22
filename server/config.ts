import crypto from "node:crypto";

export const isProduction = process.env.NODE_ENV === "production";

// ---------------------------------------------------------------------------
// Public site address
// ---------------------------------------------------------------------------
// Emailed card and renewal links must point at the real public address, not
// at whatever host the Node process happens to be listening on. In production
// this is set to https://www.joinadis.com.
const DEFAULT_SITE_URL = isProduction
  ? "https://www.joinadis.com"
  : "http://localhost:5000";

export const SITE_BASE_URL = (process.env.SITE_BASE_URL || DEFAULT_SITE_URL).replace(/\/$/, "");

// Email clients (notably Outlook and some link-tracking proxies) strip the
// "#..." fragment from URLs, which used to leave members on the home page
// instead of their card. So emails link to a plain path that the server
// redirects to the in-app card route.
export function cardUrlFor(cardToken: string): string {
  return `${SITE_BASE_URL}/c/${cardToken}`;
}

export function renewUrlFor(membershipNumber: string): string {
  return `${SITE_BASE_URL}/r/${encodeURIComponent(membershipNumber)}`;
}

// ---------------------------------------------------------------------------
// Committee admin login
// ---------------------------------------------------------------------------
// The password is never compared in plain text. ADMIN_PASSWORD_HASH holds a
// scrypt hash in the form "scrypt:<salt-hex>:<hash-hex>", generated with
// `npm run hash-password`. ADMIN_PASSWORD is accepted for local development
// only and refused in production.

export const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "will@edn-investments.com")
  .trim()
  .toLowerCase();

const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH;
const ADMIN_PASSWORD_PLAIN = process.env.ADMIN_PASSWORD;

export function hashPassword(password: string, salt?: string): string {
  const useSalt = salt || crypto.randomBytes(16).toString("hex");
  const derived = crypto.scryptSync(password, useSalt, 64).toString("hex");
  return `scrypt:${useSalt}:${derived}`;
}

export function verifyAdminPassword(password: string): boolean {
  if (ADMIN_PASSWORD_HASH) {
    const [scheme, salt, expected] = ADMIN_PASSWORD_HASH.split(":");
    if (scheme !== "scrypt" || !salt || !expected) return false;
    const actual = crypto.scryptSync(password, salt, 64).toString("hex");
    // Constant-time comparison so response timing cannot leak the password.
    const a = Buffer.from(actual, "hex");
    const b = Buffer.from(expected, "hex");
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  if (ADMIN_PASSWORD_PLAIN && !isProduction) {
    const a = Buffer.from(password);
    const b = Buffer.from(ADMIN_PASSWORD_PLAIN);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  return false;
}

// ---------------------------------------------------------------------------
// Session secret
// ---------------------------------------------------------------------------
// A predictable secret would let anyone forge a committee session cookie, so
// production refuses to start without one rather than falling back silently.

export function resolveSessionSecret(): string {
  const fromEnv = process.env.SESSION_SECRET;
  if (fromEnv && fromEnv.length >= 16) return fromEnv;
  if (isProduction) {
    throw new Error(
      "SESSION_SECRET must be set to a random string of at least 16 characters in production.",
    );
  }
  return crypto.randomBytes(32).toString("hex");
}

// Startup checks, logged as warnings so a misconfigured deploy is obvious in
// the Railway logs rather than failing quietly at the first login attempt.
export function reportConfigWarnings(log: (message: string) => void): void {
  if (isProduction) {
    if (!ADMIN_PASSWORD_HASH) {
      log(
        "WARNING: ADMIN_PASSWORD_HASH is not set — nobody can sign in to the committee dashboard. Run `npm run hash-password` and set the value.",
      );
    }
    if (!process.env.RESEND_API_KEY) {
      log("WARNING: RESEND_API_KEY is not set — membership card and reminder emails cannot be sent.");
    }
    if (!process.env.DATABASE_URL) {
      log("WARNING: DATABASE_URL is not set — running against a local database that will not persist.");
    }
  }
}
