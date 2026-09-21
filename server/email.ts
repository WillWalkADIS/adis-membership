import { execFile } from "node:child_process";

// Email transport.
//
// Live: set RESEND_API_KEY and MAIL_FROM (e.g. "ADIS Membership
// <membership@joinadis.com>") and everything goes out through Resend over
// the verified joinadis.com domain.
//
// Preview/dev: with no RESEND_API_KEY we fall back to the connected Gmail
// bridge, which only exists inside the development sandbox. That fallback is
// for testing only and is never used once the production variables are set.

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const MAIL_FROM = process.env.MAIL_FROM || "ADIS Membership <membership@joinadis.com>";
const MAIL_REPLY_TO = process.env.MAIL_REPLY_TO || undefined;

// MAIL_DRY_RUN=true logs each email instead of sending it, so the full
// sign-up and reminder flows can be exercised without mailing real people.
const DRY_RUN = process.env.MAIL_DRY_RUN === "true";

export const emailTransport = DRY_RUN
  ? "dry-run"
  : RESEND_API_KEY
    ? "resend"
    : "gmail-preview-bridge";

interface Message {
  to: string;
  subject: string;
  text: string;
  html: string;
}

async function sendViaResend(msg: Message): Promise<void> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: MAIL_FROM,
      to: [msg.to],
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
      ...(MAIL_REPLY_TO ? { reply_to: MAIL_REPLY_TO } : {}),
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Resend rejected the email (${res.status}): ${detail}`);
  }
}

async function sendViaPreviewBridge(msg: Message): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    execFile(
      "pplx",
      [
        "connector",
        "call",
        "gcal",
        "send_email",
        "--input",
        JSON.stringify({
          action: "send",
          to: [msg.to],
          cc: [],
          bcc: [],
          subject: msg.subject,
          body: msg.text,
          html_body: msg.html,
        }),
      ],
      { timeout: 30000 },
      (error, _stdout, stderr) => {
        if (error) {
          console.error("Preview email bridge failed:", stderr?.toString() || error.message);
          reject(error);
          return;
        }
        resolve();
      },
    );
  });
}

async function sendEmail(msg: Message): Promise<void> {
  if (DRY_RUN) {
    console.log(`[email:dry-run] to=${msg.to} subject="${msg.subject}"`);
  } else if (RESEND_API_KEY) {
    await sendViaResend(msg);
  } else {
    await sendViaPreviewBridge(msg);
  }
}

// ---------------------------------------------------------------------------
// Shared presentation
// ---------------------------------------------------------------------------

const GREEN = "#12663f";

function layout(headline: string, bodyHtml: string): string {
  return `
<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f4f5f3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#1c1f1d;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e3e6e2;">
      <tr>
        <td style="background:${GREEN};padding:20px 28px;">
          <div style="color:#ffffff;font-size:17px;font-weight:600;letter-spacing:0.2px;">Abu Dhabi Irish Society</div>
        </td>
      </tr>
      <tr>
        <td style="padding:28px;">
          <h1 style="margin:0 0 16px;font-size:19px;line-height:1.35;font-weight:600;">${escapeHtml(headline)}</h1>
          ${bodyHtml}
        </td>
      </tr>
      <tr>
        <td style="padding:18px 28px;background:#fafbfa;border-top:1px solid #e3e6e2;font-size:12px;line-height:1.6;color:#6b736d;">
          Abu Dhabi Irish Society &middot; <a href="https://www.joinadis.com" style="color:${GREEN};">joinadis.com</a><br/>
          You are receiving this because you registered for ADIS membership.
        </td>
      </tr>
    </table>
  </body>
</html>`.trim();
}

function button(href: string, label: string): string {
  return `<p style="margin:22px 0;"><a href="${href}" style="display:inline-block;background:${GREEN};color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;font-size:15px;">${escapeHtml(label)}</a></p>`;
}

function p(text: string): string {
  return `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;">${text}</p>`;
}

function typeLabelFor(membershipType: string): string {
  return membershipType === "family" ? "Family Membership" : "Single Membership";
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

// ---------------------------------------------------------------------------
// 1. Registration received (sent immediately on sign-up)
// ---------------------------------------------------------------------------

export async function sendRegistrationReceivedEmail(params: {
  to: string;
  name: string;
  membershipNumber: string;
  membershipType: string;
  amountDue: number;
  paymentStatus: string;
}): Promise<void> {
  const { to, name, membershipNumber, membershipType, amountDue, paymentStatus } = params;
  const typeLabel = typeLabelFor(membershipType);
  // "declared" = paid through the hosted payment link, awaiting reconciliation.
  const awaitingPayment = paymentStatus !== "paid" && paymentStatus !== "declared";

  const subject = `We've received your ADIS membership registration — ${membershipNumber}`;

  const text = [
    `Dia dhuit ${name},`,
    ``,
    `Thank you for registering with the Abu Dhabi Irish Society.`,
    ``,
    `Membership number: ${membershipNumber}`,
    `Membership type: ${typeLabel}`,
    `Fee: AED ${amountDue}`,
    ``,
    awaitingPayment
      ? `Your membership is confirmed once your payment has been received. As soon as it is, we'll email your digital membership card.`
      : `Your payment has been received. Your digital membership card is on its way in a separate email.`,
    ``,
    `Slán,`,
    `The ADIS Committee`,
  ].join("\n");

  const html = layout(
    `Thanks for registering, ${name.split(" ")[0]}`,
    [
      p(`Thank you for registering with the Abu Dhabi Irish Society. Here are your details:`),
      detailTable([
        ["Membership number", membershipNumber],
        ["Membership type", typeLabel],
        ["Fee", `AED ${amountDue}`],
      ]),
      p(
        awaitingPayment
          ? `Your membership is confirmed once your payment has been received. As soon as it is, we'll email your digital membership card.`
          : `Your payment has been received. Your digital membership card is on its way in a separate email.`,
      ),
      p(`Slán,<br/>The ADIS Committee`),
    ].join(""),
  );

  await sendEmail({ to, subject, text, html });
}

// ---------------------------------------------------------------------------
// 2. Digital membership card
// ---------------------------------------------------------------------------

export async function sendMembershipCardEmail(params: {
  to: string;
  name: string;
  membershipNumber: string;
  membershipType: string;
  cardUrl: string;
  expiryDate?: string;
}): Promise<void> {
  const { to, name, membershipNumber, membershipType, cardUrl, expiryDate } = params;
  const typeLabel = typeLabelFor(membershipType);

  const subject = `Your ADIS digital membership card — ${membershipNumber}`;

  const text = [
    `Dia dhuit ${name},`,
    ``,
    `Welcome to the Abu Dhabi Irish Society! Your digital membership card is ready:`,
    cardUrl,
    ``,
    `Membership number: ${membershipNumber}`,
    `Membership type: ${typeLabel}`,
    ...(expiryDate ? [`Valid until: ${formatDate(expiryDate)}`] : []),
    ``,
    `Important: the QR code on your card refreshes every 5 minutes and is unique to you. Please open the link live to show your card — a screenshot or forwarded image will stop working after a few minutes and cannot be used by anyone else.`,
    ``,
    `Tip: save the link to your phone's home screen so it's always to hand at events.`,
    ``,
    `Slán,`,
    `The ADIS Committee`,
  ].join("\n");

  const html = layout(
    `Fáilte, ${name.split(" ")[0]} — your membership card is ready`,
    [
      p(`Welcome to the Abu Dhabi Irish Society. Your digital membership card is ready to use.`),
      button(cardUrl, "View your membership card"),
      detailTable([
        ["Membership number", membershipNumber],
        ["Membership type", typeLabel],
        ...(expiryDate ? ([["Valid until", formatDate(expiryDate)]] as [string, string][]) : []),
      ]),
      p(
        `<strong>Important:</strong> the QR code on your card refreshes every 5 minutes and is unique to you. Open the link live to show your card — a screenshot or forwarded image stops working after a few minutes and cannot be used by anyone else.`,
      ),
      p(`Tip: save the link to your phone's home screen so it's always to hand at events.`),
      p(`Slán,<br/>The ADIS Committee`),
    ].join(""),
  );

  await sendEmail({ to, subject, text, html });
}

// ---------------------------------------------------------------------------
// 3. Renewal reminders
// ---------------------------------------------------------------------------

export async function sendRenewalReminderEmail(params: {
  to: string;
  name: string;
  membershipNumber: string;
  membershipType: string;
  expiryDate: string;
  kind: "reminder30" | "reminder7" | "reminderExpiry";
  renewUrl: string;
}): Promise<void> {
  const { to, name, membershipNumber, membershipType, expiryDate, kind, renewUrl } = params;
  const expiry = formatDate(expiryDate);
  const firstName = name.split(" ")[0];

  const copy = {
    reminder30: {
      subject: `Your ADIS membership expires on ${expiry}`,
      headline: `${firstName}, your membership renews soon`,
      lead: `Your Abu Dhabi Irish Society membership expires on <strong>${escapeHtml(expiry)}</strong> — about a month from now. Renewing takes a couple of minutes and keeps your membership card active without a break.`,
      leadText: `Your ADIS membership expires on ${expiry} — about a month from now. Renewing takes a couple of minutes and keeps your membership card active without a break.`,
      cta: "Renew my membership",
    },
    reminder7: {
      subject: `One week left on your ADIS membership`,
      headline: `${firstName}, one week left`,
      lead: `Your Abu Dhabi Irish Society membership expires on <strong>${escapeHtml(expiry)}</strong>, just a week away. Renew now and your membership card keeps working without interruption.`,
      leadText: `Your ADIS membership expires on ${expiry}, just a week away. Renew now and your membership card keeps working without interruption.`,
      cta: "Renew my membership",
    },
    reminderExpiry: {
      subject: `Your ADIS membership has expired`,
      headline: `${firstName}, your membership has expired`,
      lead: `Your Abu Dhabi Irish Society membership expired on <strong>${escapeHtml(expiry)}</strong> and your membership card will no longer verify at events. You're very welcome back any time — renewing restores your card straight away.`,
      leadText: `Your ADIS membership expired on ${expiry} and your membership card will no longer verify at events. You're very welcome back any time — renewing restores your card straight away.`,
      cta: "Rejoin ADIS",
    },
  }[kind];

  const text = [
    `Dia dhuit ${name},`,
    ``,
    copy.leadText,
    ``,
    renewUrl,
    ``,
    `Membership number: ${membershipNumber}`,
    `Membership type: ${typeLabelFor(membershipType)}`,
    ``,
    `Slán,`,
    `The ADIS Committee`,
  ].join("\n");

  const html = layout(
    copy.headline,
    [
      p(copy.lead),
      button(renewUrl, copy.cta),
      detailTable([
        ["Membership number", membershipNumber],
        ["Membership type", typeLabelFor(membershipType)],
        ["Expiry date", expiry],
      ]),
      p(`Slán,<br/>The ADIS Committee`),
    ].join(""),
  );

  await sendEmail({ to, subject: copy.subject, text, html });
}

// ---------------------------------------------------------------------------

function detailTable(rows: [string, string][]): string {
  const cells = rows
    .map(
      ([label, value]) =>
        `<tr>
           <td style="padding:7px 0;font-size:13px;color:#6b736d;width:170px;">${escapeHtml(label)}</td>
           <td style="padding:7px 0;font-size:14px;font-weight:600;">${escapeHtml(value)}</td>
         </tr>`,
    )
    .join("");
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 6px;border-top:1px solid #e3e6e2;border-bottom:1px solid #e3e6e2;width:100%;">${cells}</table>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
