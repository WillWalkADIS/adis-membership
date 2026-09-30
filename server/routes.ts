import type { Express, Request, Response, NextFunction } from "express";
import type { Server } from "node:http";
import rateLimit from "express-rate-limit";
import { storage, normaliseOrderRef } from "./storage";
import { insertRegistrationSchema } from "@shared/schema";
import { currentOtp, verifyOtp, OTP_PERIOD_SECONDS } from "./otp";
import {
  sendMembershipCardEmail,
  sendWelcomeEmail,
  emailTransport,
} from "./email";
import { runReminderSweep } from "./reminders";
import { ADMIN_EMAIL, verifyAdminPassword, cardUrlFor } from "./config";

// Membership cards are only ever emailed once a committee member has marked
// the registration as paid in the dashboard. Ticking "I have paid" on the form
// is recorded as "declared" but never releases a card on its own.

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
    // Details are submitted before payment now, so an Order # is optional here
    // and is normally added afterwards via /api/registrations/payment.
    // One payment, one membership: an Order # can only ever be used once.
    const earlyRef = (parsed.data.paymentReference ?? "").trim();
    if (earlyRef && (await storage.isPaymentReferenceUsed(earlyRef))) {
      return res.status(400).json({
        message:
          "This Order # has already been used for another membership. If you have just paid, please check the Order # on your payment confirmation or contact the ADIS committee.",
      });
    }
    if (parsed.data.membershipType === "family") {
      const partnerEmail = (parsed.data.secondAdultEmail ?? "").trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(partnerEmail)) {
        return res
          .status(400)
          .json({ message: "A valid email address for the second adult is required for a family membership" });
      }
    }
    const registration = await storage.createRegistration(parsed.data);

    // Welcome email to each adult straight away. It deliberately contains no
    // card. Never block the response on email — a member should not see an
    // error because an email provider was slow.
    await sendWelcomeEmails(registration);

    const { cardToken, ...publicRegistration } = omitOtpSecret(registration);
    // paymentToken lets this browser attach the Order # after paying. It is
    // the member's own card token; the card stays inactive until the
    // committee confirms payment, so it grants nothing extra.
    res.status(201).json({ ...publicRegistration, paymentToken: cardToken, cardEmailSent: false });
  });

  // Member returns from the PRJCT shop and enters their Order #.
  app.post("/api/registrations/payment", registrationLimiter, async (req, res) => {
    const token = typeof req.body?.paymentToken === "string" ? req.body.paymentToken : "";
    const rawRef = typeof req.body?.paymentReference === "string" ? req.body.paymentReference : "";
    // Stored cleaned up ("#99j9z1" -> "99J9Z1") so the committee can match it.
    const ref = normaliseOrderRef(rawRef);
    if (!token) return res.status(400).json({ message: "Missing registration" });
    if (ref.length < 5 || ref.length > 20) {
      return res
        .status(400)
        .json({ message: "Enter the Order # shown on your PRJCT payment confirmation (e.g. AB12CD)" });
    }
    const found = await storage.findCardHolder(token);
    if (!found || found.holder !== "primary") return res.status(404).json({ message: "Registration not found" });
    const registration = found.registration;
    if (registration.paymentStatus === "paid") {
      return res.json({ ok: true, membershipNumber: registration.membershipNumber });
    }
    if (await storage.isPaymentReferenceUsed(ref, registration.id)) {
      return res.status(400).json({
        message:
          "This Order # has already been used for another membership. Please check the Order # on your payment confirmation or contact the ADIS committee.",
      });
    }
    await storage.declarePayment(registration.id, ref);
    res.json({ ok: true, membershipNumber: registration.membershipNumber });
  });

  // Short, fragment-free links used in emails. Email clients often drop
  // everything after "#", so these redirect to the in-app hash routes.
  app.get("/c/:cardToken", (req, res) => {
    const token = String(req.params.cardToken).replace(/[^a-zA-Z0-9]/g, "");
    res.redirect(302, `/#/card/${token}`);
  });

  app.get("/r/:membershipNumber", (req, res) => {
    const membershipNumber = String(req.params.membershipNumber).replace(/[^a-zA-Z0-9-]/g, "");
    res.redirect(302, `/?renew=${encodeURIComponent(membershipNumber)}`);
  });

  // Public: fetch a member's digital card by its unguessable card token.
  // Returns a fresh rotating code each time so the QR on the card page can
  // refresh itself every 5 minutes.
  app.get("/api/card/:cardToken", async (req, res) => {
    const found = await storage.findCardHolder(req.params.cardToken);
    if (!found) return res.status(404).json({ message: "Card not found" });
    const { registration, name, otpSecret } = found;

    const { code, expiresAt } = currentOtp(otpSecret);
    res.json({
      // Name of whoever holds this particular card (either adult on a family).
      primaryFullName: name,
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
    const found = cardToken ? await storage.findCardHolder(cardToken) : undefined;

    if (!found) {
      return res.status(404).json({ valid: false, message: "Membership card not recognised." });
    }

    const { registration, name } = found;

    if (!verifyOtp(found.otpSecret, code)) {
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
        name,
      });
    }

    // Only a membership the committee has confirmed as paid is valid.
    if (registration.paymentStatus !== "paid") {
      return res.json({
        valid: false,
        message: "This membership has not been confirmed as paid yet.",
        membershipNumber: registration.membershipNumber,
        name,
      });
    }

    return res.json({
      valid: true,
      name,
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

    if (registration.paymentStatus !== "paid") {
      return res
        .status(400)
        .json({ message: "Mark this member as paid first — cards only go to confirmed members." });
    }
    const { primarySent, partnerSent } = await issueCards(registration.id, { force: true });
    if (!primarySent) return res.status(502).json({ message: "The email could not be sent. Please try again." });
    res.json({ ok: true, partnerSent });
  });

  // Admin: permanently remove a registration (tests, duplicates). Its card
  // links stop working immediately.
  app.delete("/api/registrations/:id", requireAdmin, async (req, res) => {
    const ok = await storage.deleteRegistration(Number(req.params.id));
    if (!ok) return res.status(404).json({ message: "Not found" });
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
    // One pair of columns per child, as many as the largest family has.
    const maxChildren = Math.max(1, ...registrations.map((r) => r.children.length));
    const uaeDate = (iso?: string | null) => {
      if (!iso) return "";
      const d = new Date(iso);
      return isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-GB", { timeZone: "Asia/Dubai" });
    };
    const dob = (v: string) => {
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v ?? "");
      return m ? `${m[3]}/${m[2]}/${m[1]}` : v ?? "";
    };
    const yesNo = (v: boolean | null | undefined) => (v ? "Yes" : "No");
    const statusLabel: Record<string, string> = {
      pending: "No payment yet",
      declared: "Paid - to verify",
      paid: "Verified paid",
      failed: "Failed",
    };
    const headers = [
      "Membership Number",
      "Membership Type",
      "New / Renewal",
      "Primary Member Name",
      "Primary Email",
      "Primary Mobile",
      "Nationality",
      "Emirate",
      "Second Adult First Name",
      "Second Adult Surname",
      "Second Adult Email",
      "Second Adult Mobile",
      "Number of Adults",
      "Number of Children",
      ...Array.from({ length: maxChildren }, (_, i) => [
        `Child ${i + 1} First Name`,
        `Child ${i + 1} Surname`,
        `Child ${i + 1} Date of Birth`,
      ]).flat(),
      "Communication Preference",
      "Join WhatsApp Community",
      "Receive Marketing",
      "Agreed Terms",
      "Agreed Privacy",
      "Membership Fee (AED)",
      "Payment Status",
      "Order # / Payment Reference",
      "Payment Submitted",
      "Registration Date",
      "Membership Start Date",
      "Membership Expiry Date",
      "Welcome Email Sent",
      "Card Emailed (Primary)",
      "Card Emailed (Second Adult)",
    ];
    const escape = (v: string) => `"${(v ?? "").replace(/"/g, '""')}"`;
    const rows = registrations.map((r) => {
      const isFamily = r.membershipType === "family";
      const kids = Array.from({ length: maxChildren }, (_, i) => {
        const c = r.children[i];
        return c ? [c.firstName, c.surname, dob(c.dob)] : ["", "", ""];
      }).flat();
      return [
        r.membershipNumber,
        isFamily ? "Family" : "Single",
        r.memberStatus === "renewal" ? "Renewal" : "New",
        r.primaryFullName,
        r.primaryEmail,
        r.primaryMobile,
        r.nationality,
        r.emirate,
        r.secondAdultFirstName ?? "",
        r.secondAdultSurname ?? "",
        r.secondAdultEmail ?? "",
        r.secondAdultMobile ?? "",
        String(isFamily && r.secondAdultFirstName ? 2 : 1),
        String(r.children.length),
        ...kids,
        r.communicationPreference,
        yesNo(r.joinWhatsappCommunity),
        yesNo(r.receiveMarketing),
        yesNo(r.consentTerms),
        yesNo(r.consentPrivacy),
        String(r.amountDue),
        statusLabel[r.paymentStatus] ?? r.paymentStatus,
        r.paymentReference ?? "",
        uaeDate(r.paymentDeclaredAt),
        uaeDate(r.registrationDate),
        uaeDate(r.membershipStartDate),
        uaeDate(r.membershipExpiryDate),
        uaeDate(r.welcomeEmailSentAt),
        uaeDate(r.cardEmailSentAt),
        uaeDate(r.partnerCardEmailSentAt),
      ]
        .map(escape)
        .join(",");
    });
    const csv = [headers.map(escape).join(","), ...rows].join("\r\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="adis-membership-export.csv"`);
    res.send("\uFEFF" + csv);
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
  app.patch("/api/registrations/:id/unmark-paid", requireAdmin, async (req, res) => {
    const updated = await storage.unmarkPaid(Number(req.params.id));
    if (!updated) return res.status(404).json({ message: "Not found" });
    res.json(omitOtpSecret(updated));
  });

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
    // This is the only thing that releases membership cards. Anyone who
    // already has one (e.g. a card re-confirmed later) is not emailed again.
    let cardEmailSent = false;
    let partnerCardEmailSent = false;
    if (updated) {
      const result = await issueCards(updated.id, { force: false });
      cardEmailSent = result.primarySent;
      partnerCardEmailSent = result.partnerSent;
    }

    res.json(updated ? { ...omitOtpSecret(updated), cardEmailSent, partnerCardEmailSent } : updated);
  });

  // Admin: run the renewal reminder sweep on demand, so the committee can
  // test the reminder emails without waiting for the schedule.
  app.post("/api/admin/run-reminders", requireAdmin, async (_req, res) => {
    const result = await runReminderSweep((m) => console.log(`[reminders] ${m}`));
    res.json(result);
  });

  return httpServer;
}

function partnerNameOf(r: { secondAdultFirstName: string | null; secondAdultSurname: string | null }) {
  return `${r.secondAdultFirstName ?? ""} ${r.secondAdultSurname ?? ""}`.trim();
}

async function sendWelcomeEmails(registration: Awaited<ReturnType<typeof storage.getRegistration>> & {}) {
  const common = {
    membershipNumber: registration.membershipNumber,
    membershipType: registration.membershipType,
    expiryDate: registration.membershipExpiryDate,
  };
  try {
    await sendWelcomeEmail({ to: registration.primaryEmail, name: registration.primaryFullName, ...common });
    await storage.markWelcomeEmailSent(registration.id);
  } catch (err) {
    console.error("Could not send welcome email:", err);
  }
  if (registration.membershipType === "family" && registration.secondAdultEmail) {
    try {
      await sendWelcomeEmail({ to: registration.secondAdultEmail, name: partnerNameOf(registration), ...common });
      await storage.markPartnerWelcomeEmailSent(registration.id);
    } catch (err) {
      console.error("Could not send partner welcome email:", err);
    }
  }
}

// Emails each adult their own card. Only called once a registration is paid.
async function issueCards(
  id: number,
  { force }: { force: boolean },
): Promise<{ primarySent: boolean; partnerSent: boolean }> {
  const registration = await storage.ensurePartnerCard(id);
  if (!registration || registration.paymentStatus !== "paid") {
    return { primarySent: false, partnerSent: false };
  }
  const common = {
    membershipNumber: registration.membershipNumber,
    membershipType: registration.membershipType,
    expiryDate: registration.membershipExpiryDate,
  };

  let primarySent = false;
  if (force || !registration.cardEmailSentAt) {
    try {
      await sendMembershipCardEmail({
        to: registration.primaryEmail,
        name: registration.primaryFullName,
        cardUrl: cardUrlFor(registration.cardToken),
        ...common,
      });
      await storage.markCardEmailSent(registration.id);
      primarySent = true;
    } catch (err) {
      console.error("Could not send membership card email:", err);
    }
  }

  let partnerSent = false;
  if (
    registration.membershipType === "family" &&
    registration.secondAdultEmail &&
    registration.partnerCardToken &&
    (force || !registration.partnerCardEmailSentAt)
  ) {
    try {
      await sendMembershipCardEmail({
        to: registration.secondAdultEmail,
        name: partnerNameOf(registration),
        cardUrl: cardUrlFor(registration.partnerCardToken),
        ...common,
      });
      await storage.markPartnerCardEmailSent(registration.id);
      partnerSent = true;
    } catch (err) {
      console.error("Could not send partner membership card email:", err);
    }
  }

  return { primarySent, partnerSent };
}
