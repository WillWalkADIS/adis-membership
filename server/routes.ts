import type { Express, Request, Response, NextFunction } from "express";
import type { Server } from "node:http";
import rateLimit from "express-rate-limit";
import { storage } from "./storage";
import { insertRegistrationSchema } from "@shared/schema";
import { currentOtp, verifyOtp, OTP_PERIOD_SECONDS } from "./otp";
import {
  sendMembershipCardEmail,
  sendRegistrationReceivedEmail,
  emailTransport,
} from "./email";
import { runReminderSweep } from "./reminders";
import { ADMIN_EMAIL, verifyAdminPassword, cardUrlFor } from "./config";

// Cards are issued once a payment exists: the member has been through the
// hosted payment link during sign-up ("declared"), or a committee member has
// recorded a cash/bank transfer ("paid"). Set ISSUE_CARD_ON_REGISTRATION=true
// to issue on sign-up regardless of payment.
const ISSUE_CARD_ON_REGISTRATION = process.env.ISSUE_CARD_ON_REGISTRATION === "true";

// Statuses that count as an active membership.
const ACTIVE_PAYMENT_STATUSES = ["paid", "declared"];

// The OTP secret must never leave the server, not even to the authenticated
// committee admin dashboard — it is the literal key that generates a valid
// membership QR code. cardToken is left in place for the admin/CSV views
// since it is only useful in combination with the (server-only) secret.
function omitOtpSecret<T extends { otpSecret?: string }>(row: T) {
  const { otpSecret, ...rest } = row;
  return rest;
}

declare module "express-session" {
  interface SessionData {
    isAdmin?: boolean;
    adminEmail?: string;
  }
}

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.session?.isAdmin) return next();
  return res.status(401).json({ message: "Not authenticated" });
}

// Brute-forcing the committee password is the most valuable attack on this
// site, since the dashboard holds every member's contact details and the
// children's dates of birth. Five attempts per 15 minutes per IP.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { message: "Too many sign-in attempts. Please try again in 15 minutes." },
});

// Stops a script filling the member list (and the email quota) with junk.
const registrationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { message: "Too many registrations from this connection. Please try again later." },
});

// Verification is scanned repeatedly at an event door, so this is generous —
// it exists only to stop someone guessing codes at machine speed.
const verifyLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { valid: false, message: "Too many verification attempts. Please wait a moment." },
});

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  // Admin: log in to the committee dashboard
  app.post("/api/admin/login", loginLimiter, (req, res) => {
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (email !== ADMIN_EMAIL || !verifyAdminPassword(password)) {
      return res.status(401).json({ message: "Incorrect email or password" });
    }
    req.session.isAdmin = true;
    req.session.adminEmail = email;
    res.json({ email });
  });

  // Admin: log out of the committee dashboard
  app.post("/api/admin/logout", (req, res) => {
    req.session.destroy(() => {
      res.json({ ok: true });
    });
  });

  // Admin: check current session
  app.get("/api/admin/me", (req, res) => {
    if (req.session?.isAdmin) {
      return res.json({ email: req.session.adminEmail, emailTransport });
    }
    return res.status(401).json({ message: "Not authenticated" });
  });

  // Create a new membership registration
  app.post("/api/registrations", registrationLimiter, async (req, res) => {
    const parsed = insertRegistrationSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid registration data", errors: parsed.error.flatten() });
    }
    if (!parsed.data.consentTerms || !parsed.data.consentPrivacy) {
      return res.status(400).json({ message: "Required consents were not accepted" });
    }
    const registration = await storage.createRegistration(parsed.data);

    // Acknowledgement email. Never block the response on it — a member who
    // just paid should not see an error because an email provider was slow.
    try {
      await sendRegistrationReceivedEmail({
        to: registration.primaryEmail,
        name: registration.primaryFullName,
        membershipNumber: registration.membershipNumber,
        membershipType: registration.membershipType,
        amountDue: registration.amountDue,
        paymentStatus: registration.paymentStatus,
      });
      await storage.markWelcomeEmailSent(registration.id);
    } catch (err) {
      console.error("Could not send registration acknowledgement:", err);
    }

    let cardEmailSent = false;
    if (ISSUE_CARD_ON_REGISTRATION || ACTIVE_PAYMENT_STATUSES.includes(registration.paymentStatus)) {
      cardEmailSent = await issueCard(registration);
    }

    const { cardToken, ...publicRegistration } = omitOtpSecret(registration);
    res.status(201).json({ ...publicRegistration, cardEmailSent });
  });

  // Public: fetch a member's digital card by its unguessable card token.
  // Returns a fresh rotating code each time so the QR on the card page can
  // refresh itself every 5 minutes.
  app.get("/api/card/:cardToken", async (req, res) => {
    const registration = await storage.getRegistrationByCardToken(req.params.cardToken);
    if (!registration) return res.status(404).json({ message: "Card not found" });

    const { code, expiresAt } = currentOtp(registration.otpSecret);
    res.json({
      primaryFullName: registration.primaryFullName,
      membershipNumber: registration.membershipNumber,
      membershipType: registration.membershipType,
      paymentStatus: registration.paymentStatus,
      membershipStartDate: registration.membershipStartDate,
      membershipExpiryDate: registration.membershipExpiryDate,
      otpCode: code,
      otpExpiresAt: expiresAt,
      otpPeriodSeconds: OTP_PERIOD_SECONDS,
    });
  });

  // Public: verify a scanned card code, e.g. at an event door. This is what
  // the QR code's URL points to.
  app.get("/api/verify", verifyLimiter, async (req, res) => {
    const cardToken = typeof req.query.token === "string" ? req.query.token : "";
    const code = typeof req.query.code === "string" ? req.query.code : "";
    const registration = cardToken ? await storage.getRegistrationByCardToken(cardToken) : undefined;

    if (!registration) {
      return res.status(404).json({ valid: false, message: "Membership card not recognised." });
    }

    if (!verifyOtp(registration.otpSecret, code)) {
      return res.json({
        valid: false,
        message:
          "This code has expired or is invalid. Ask the member to open their card link live and show the current QR code.",
      });
    }

    // An expired membership must not verify, even with a valid live code.
    if (new Date(registration.membershipExpiryDate) < new Date()) {
      return res.json({
        valid: false,
        message: "This membership has expired and needs to be renewed.",
        membershipNumber: registration.membershipNumber,
        name: registration.primaryFullName,
      });
    }

    return res.json({
      valid: true,
      name: registration.primaryFullName,
      membershipNumber: registration.membershipNumber,
      membershipType: registration.membershipType,
      paymentStatus: registration.paymentStatus,
      membershipExpiryDate: registration.membershipExpiryDate,
      message: "Valid ADIS membership.",
    });
  });

  // Admin: resend a member's digital card email (e.g. if they lost it)
  app.post("/api/registrations/:id/resend-card", requireAdmin, async (req, res) => {
    const registration = await storage.getRegistration(Number(req.params.id));
    if (!registration) return res.status(404).json({ message: "Not found" });

    const ok = await issueCard(registration);
    if (!ok) return res.status(502).json({ message: "The email could not be sent. Please try again." });
    res.json({ ok: true });
  });

  // List all registrations (committee admin view)
  app.get("/api/registrations", requireAdmin, async (_req, res) => {
    const registrations = await storage.listRegistrations();
    res.json(registrations.map(omitOtpSecret));
  });

  // Export registrations as CSV for the committee
  app.get("/api/registrations/export.csv", requireAdmin, async (_req, res) => {
    const registrations = await storage.listRegistrations();
    const headers = [
      "Membership Number",
      "Primary Member Name",
      "Second Adult Name",
      "Email",
      "Mobile",
      "Number of Children",
      "Membership Type",
      "New / Renewal",
      "Amount Paid",
      "Payment Status",
      "Payment Reference",
      "Registration Date",
      "Membership Start Date",
      "Membership Expiry Date",
    ];
    const escape = (v: string) => `"${(v ?? "").replace(/"/g, '""')}"`;
    const rows = registrations.map((r) =>
      [
        r.membershipNumber,
        r.primaryFullName,
        r.secondAdultFirstName ? `${r.secondAdultFirstName} ${r.secondAdultSurname ?? ""}`.trim() : "",
        r.primaryEmail,
        r.primaryMobile,
        String(r.children.length),
        r.membershipType === "family" ? "Family" : "Single",
        r.memberStatus === "renewal" ? "Renewal" : "New",
        String(r.amountDue),
        r.paymentStatus,
        r.paymentReference ?? "",
        r.registrationDate,
        r.membershipStartDate,
        r.membershipExpiryDate,
      ]
        .map(escape)
        .join(",")
    );
    const csv = [headers.map(escape).join(","), ...rows].join("\r\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="adis-membership-export.csv"`);
    res.send(csv);
  });

  // Get a single registration
  app.get("/api/registrations/:id", requireAdmin, async (req, res) => {
    const registration = await storage.getRegistration(Number(req.params.id));
    if (!registration) return res.status(404).json({ message: "Not found" });
    res.json(omitOtpSecret(registration));
  });

  // Admin: manually reconcile a payment (e.g. bank transfer / cash received at
  // an event). Once the gateway's keys are connected, its webhook will call the
  // same code path so both routes to "paid" behave identically — including
  // issuing the member's card.
  app.patch("/api/registrations/:id/mark-paid", requireAdmin, async (req, res) => {
    const id = Number(req.params.id);
    const existing = await storage.getRegistration(id);
    if (!existing) return res.status(404).json({ message: "Not found" });

    // Keep whatever reference the member gave at sign-up when confirming a
    // payment-link registration; only invent one for cash/bank transfers.
    const paymentReference =
      typeof req.body?.paymentReference === "string" && req.body.paymentReference.trim()
        ? req.body.paymentReference.trim()
        : existing.paymentReference || `MANUAL-${Date.now().toString(36).toUpperCase()}`;
    const updated = await storage.markPaid(id, paymentReference);

    // Only email a card if they did not already get one (e.g. a cash payment
    // being recorded for the first time), so confirming a payment-link member
    // does not send them a duplicate.
    let cardEmailSent = false;
    if (updated && !existing.cardEmailSentAt) {
      cardEmailSent = await issueCard(updated);
    }

    res.json(updated ? { ...omitOtpSecret(updated), cardEmailSent } : updated);
  });

  // Admin: run the renewal reminder sweep on demand, so the committee can
  // test the reminder emails without waiting for the schedule.
  app.post("/api/admin/run-reminders", requireAdmin, async (_req, res) => {
    const result = await runReminderSweep((m) => console.log(`[reminders] ${m}`));
    res.json(result);
  });

  return httpServer;
}

async function issueCard(registration: {
  id: number;
  primaryEmail: string;
  primaryFullName: string;
  membershipNumber: string;
  membershipType: string;
  cardToken: string;
  membershipExpiryDate: string;
}): Promise<boolean> {
  try {
    await sendMembershipCardEmail({
      to: registration.primaryEmail,
      name: registration.primaryFullName,
      membershipNumber: registration.membershipNumber,
      membershipType: registration.membershipType,
      cardUrl: cardUrlFor(registration.cardToken),
      expiryDate: registration.membershipExpiryDate,
    });
    await storage.markCardEmailSent(registration.id);
    return true;
  } catch (err) {
    console.error("Could not send membership card email:", err);
    return false;
  }
}
