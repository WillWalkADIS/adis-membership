import crypto from "node:crypto";

// A minimal time-based one-time code (RFC 6238 style) implementation.
// Used to drive the rotating QR code on each member's digital card so a
// screenshot or forwarded image stops working after the time window closes.

export const OTP_PERIOD_SECONDS = 300; // 5 minutes
const OTP_DIGITS = 6;
// Allow the immediately previous window too, to tolerate clock drift and
// the brief gap between scanning a QR and the verification request landing.
const WINDOW_TOLERANCE = 1;

export function generateOtpSecret(): string {
  return crypto.randomBytes(20).toString("hex");
}

export function generateCardToken(): string {
  return crypto.randomBytes(24).toString("hex");
}

function counterAt(timestampMs: number): number {
  return Math.floor(timestampMs / 1000 / OTP_PERIOD_SECONDS);
}

function codeForCounter(secretHex: string, counter: number): string {
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigInt64BE(BigInt(counter));
  const hmac = crypto.createHmac("sha1", Buffer.from(secretHex, "hex"));
  hmac.update(counterBuffer);
  const digest = hmac.digest();
  const offset = digest[digest.length - 1] & 0xf;
  const binCode =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  const otp = binCode % 10 ** OTP_DIGITS;
  return otp.toString().padStart(OTP_DIGITS, "0");
}

export function currentOtp(secretHex: string, now: number = Date.now()): { code: string; expiresAt: number } {
  const counter = counterAt(now);
  const expiresAt = (counter + 1) * OTP_PERIOD_SECONDS * 1000;
  return { code: codeForCounter(secretHex, counter), expiresAt };
}

export function verifyOtp(secretHex: string, code: string, now: number = Date.now()): boolean {
  const counter = counterAt(now);
  for (let i = -WINDOW_TOLERANCE; i <= 0; i++) {
    if (codeForCounter(secretHex, counter + i) === code) return true;
  }
  return false;
}
