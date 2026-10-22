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

// Every ADIS membership ends on 30 September, whenever it was paid for.
// Anyone joining from 1 August onwards is given the following year's
// 30 September, so late joiners are not sold a membership that ends within
// weeks. Months are read in UAE time (UTC+4), and the membership runs to
// 23:59:59 UAE time on the 30th.
export const MEMBERSHIP_ROLLOVER_MONTH = 7; // 0-based: 7 = August

export function membershipExpiryFor(joined: Date): string {
  const uae = new Date(joined.getTime() + 4 * 60 * 60 * 1000);
  const year =
    uae.getUTCMonth() >= MEMBERSHIP_ROLLOVER_MONTH ? uae.getUTCFullYear() + 1 : uae.getUTCFullYear();
  return new Date(Date.UTC(year, 8, 30, 19, 59, 59, 999)).toISOString();
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

function verifyScryptHash(password: string, stored: string): boolean {
  const [scheme, salt, expected] = stored.split(":");
  if (scheme !== "scrypt" || !salt || !expected) return false;
  const actual = crypto.scryptSync(password, salt, 64).toString("hex");
  // Constant-time comparison so response timing cannot leak the password.
  const a = Buffer.from(actual, "hex");
  const b = Buffer.from(expected, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function verifyAdminPassword(password: string): boolean {
  if (ADMIN_PASSWORD_HASH) return verifyScryptHash(password, ADMIN_PASSWORD_HASH);

  if (ADMIN_PASSWORD_PLAIN && !isProduction) {
    const a = Buffer.from(password);
    const b = Buffer.from(ADMIN_PASSWORD_PLAIN);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  return false;
}

// Additional committee logins, each with its own email and password and the
// same full access as the main account. Only scrypt hashes are stored here —
// the passwords themselves are long and random, so the hashes are safe to
// keep in the repository. To change one of these passwords, run
// `npm run hash-password -- "new password"` and replace the hash, or set
// COMMITTEE_ACCOUNTS on Railway ("email=scrypt:...;email=scrypt:...") which
// overrides the entry for any email it lists.
const BUILT_IN_COMMITTEE_ACCOUNTS: Record<string, string> = {
  // Ailise — ADIS Secretary
  "secretary@adirishsociety.com":
    "scrypt:c631259c31c59f50bec65178de146196:6d739154c1cd2d28ae79c614d62ff147ce7690f879da426ef5c13cb17c44cb9cd356900e8f2c549d0e7c21a0513ebd449839e73739638297c73940dc01316bc9",
  // Mrs Niamh Breen — ADIS President
  "president@adirishsociety.com":
    "scrypt:2e8732cbf43ded6a474a92c76396507f:ce629a4269875ee90466b250cfd80ac9b7680b27a59fad0017d7400eb89e81dbcbb6ce0ba1ecadd62c2fd14c222c1a2ae3e9bd87d783166bb525fc639d2ced9a",
};

function loadCommitteeAccounts(): Record<string, string> {
  const accounts: Record<string, string> = { ...BUILT_IN_COMMITTEE_ACCOUNTS };
  for (const entry of (process.env.COMMITTEE_ACCOUNTS || "").split(";")) {
    const i = entry.indexOf("=");
    if (i <= 0) continue;
    const email = entry.slice(0, i).trim().toLowerCase();
    const hash = entry.slice(i + 1).trim();
    if (email && hash) accounts[email] = hash;
  }
  return accounts;
}

const COMMITTEE_ACCOUNTS = loadCommitteeAccounts();

// Checks an email + password pair against every committee login. Returns
// true only for a known email with the matching password.
export function verifyCommitteeLogin(email: string, password: string): boolean {
  const normalised = email.trim().toLowerCase();
  if (normalised === ADMIN_EMAIL) return verifyAdminPassword(password);
  const stored = COMMITTEE_ACCOUNTS[normalised];
  if (!stored) {
    // Still do the hashing work so an unknown email takes as long as a known one.
    verifyScryptHash(password, "scrypt:00:00");
    return false;
  }
  return verifyScryptHash(password, stored);
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
