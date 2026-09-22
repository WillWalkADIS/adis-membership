import { execFile } from "node:child_process";
import { SITE_BASE_URL } from "./config";

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
    // MAIL_PREVIEW_DIR writes each dry-run email to disk so the HTML can be
    // eyeballed in a browser before anything is sent for real.
    if (process.env.MAIL_PREVIEW_DIR) {
      const { writeFileSync, mkdirSync } = await import("node:fs");
      mkdirSync(process.env.MAIL_PREVIEW_DIR, { recursive: true });
      const slug = msg.subject.replace(/[^a-z0-9]+/gi, "-").slice(0, 60);
      writeFileSync(`${process.env.MAIL_PREVIEW_DIR}/${slug}.html`, msg.html);
    }
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
const GOLD = "#b08a3e";
const CREAM = "#f8f5ee";

// Society links, supplied by the committee. Kept here so they can be changed in
// one place; each can also be overridden with an environment variable.
const LINKS = {
  instagram: process.env.ADIS_INSTAGRAM_URL || "https://www.instagram.com/adirishsoc/",
  facebook: process.env.ADIS_FACEBOOK_URL || "https://www.facebook.com/groups/irishinabudhabi/",
  linkedin: process.env.ADIS_LINKEDIN_URL || "https://www.linkedin.com/in/adirishsoc/",
  tiktok:
    process.env.ADIS_TIKTOK_URL ||
    "https://www.tiktok.com/@adirishsoc?_r=1&_t=ZS-992nHUPhMZA",
  whatsapp:
    process.env.ADIS_WHATSAPP_URL || "https://chat.whatsapp.com/Gc7WegWpdt5Gyz0lUfHRjI",
  linktree: process.env.ADIS_LINKTREE_URL || "https://linktr.ee/adirishsoc",
  mccaffertys:
    process.env.ADIS_MCCAFFERTYS_URL ||
    "https://docs.google.com/forms/d/e/1FAIpQLSeReYDa7lLmqglquCZStRiEVRpf1fAEvH5erbT2kIFZwDxghQ/viewform",
  volunteer: process.env.ADIS_VOLUNTEER_URL || "",
};

const PRESIDENT_NAME = process.env.ADIS_PRESIDENT_NAME || "Niamh Breen";
const PRESIDENT_EMAIL = process.env.ADIS_PRESIDENT_EMAIL || "president@adirishsociety.ae";


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

// The welcome email follows the committee's approved design: logo lockup,
// green headings on cream, a social row, the McCafferty's discount and the
// president's contact details.
function welcomeLayout(bodyHtml: string): string {
  const logoUrl = `${SITE_BASE_URL}/adis-logo.jpg`;
  return `
<!doctype html>
<html>
  <body style="margin:0;padding:0;background:${CREAM};">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${CREAM};">
      <tr>
        <td align="center" style="padding:28px 12px 40px;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:620px;background:${CREAM};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#26302a;">
            <tr>
              <td align="center" style="padding:8px 28px 22px;">
                <img src="${logoUrl}" width="260" alt="Abu Dhabi Irish Society" style="display:block;width:260px;max-width:78%;height:auto;border:0;" />
                <div style="border-top:1px solid ${GREEN};margin-top:20px;"></div>
              </td>
            </tr>
            <tr>
              <td style="padding:0 28px;">
                ${bodyHtml}
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:26px 28px 0;">
                <div style="border-top:1px solid ${GREEN};padding-top:14px;color:${GREEN};font-size:16px;">&#9752;</div>
                <div style="margin-top:10px;font-size:12px;line-height:1.6;color:#79837b;">
                  Abu Dhabi Irish Society &middot; <a href="${SITE_BASE_URL}" style="color:${GREEN};">joinadis.com</a><br/>
                  You are receiving this because you registered for ADIS membership.
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`.trim();
}

function h2(text: string): string {
  return `<h2 style="margin:26px 0 12px;font-size:21px;line-height:1.3;font-weight:700;color:${GREEN};">${escapeHtml(text)}</h2>`;
}

function detailRow(label: string, valueHtml: string): string {
  return `<tr>
      <td style="padding:4px 14px 4px 0;font-size:14px;font-weight:700;color:${GREEN};white-space:nowrap;vertical-align:top;">${escapeHtml(label)}</td>
      <td style="padding:4px 0;font-size:14px;color:#26302a;vertical-align:top;">${valueHtml}</td>
    </tr>`;
}

function socialRow(): string {
  // [link label, href, icon file]. The label under WhatsApp is shortened to
  // "Community" so every tile is the same width and the row stays even.
  const items: [string, string, string][] = [
    ["Instagram", LINKS.instagram, "instagram"],
    ["LinkedIn", LINKS.linkedin, "linkedin"],
    ["TikTok", LINKS.tiktok, "tiktok"],
    ["Community", LINKS.whatsapp, "whatsapp"],
    ["Facebook", LINKS.facebook, "facebook"],
  ];
  if (LINKS.linktree) items.push(["Linktree", LINKS.linktree, "linktree"]);

  // Fixed-width cells keep the icons evenly spaced regardless of label length.
  const cells = items
    .map(
      ([label, href, slug]) => `<td align="center" valign="top" width="84" style="width:84px;padding:0;">
        <a href="${href}" style="text-decoration:none;color:${GREEN};">
          <img src="${SITE_BASE_URL}/email/${slug}.png" width="44" height="44" alt="${escapeHtml(label)}" style="display:block;margin:0 auto 7px;width:44px;height:44px;border:0;border-radius:10px;" />
          <span style="font-size:11px;font-weight:700;color:${GREEN};text-decoration:underline;white-space:nowrap;">${escapeHtml(label)}</span>
        </a>
      </td>`,
    )
    .join("");

  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:12px 0 8px;border-collapse:collapse;">
      <tr>${cells}</tr>
    </table>`;
}

function wideButton(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:18px 0;">
      <tr>
        <td align="center" style="background:${GREEN};border:2px solid ${GOLD};border-radius:8px;">
          <a href="${href}" style="display:block;padding:14px 18px;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;letter-spacing:0.6px;">${escapeHtml(label)}</a>
        </td>
      </tr>
    </table>`;
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

  const subject = `Fáilte chuig Abu Dhabi Irish Society — ${membershipNumber}`;

  const text = [
    `A Chairde,`,
    ``,
    `Fáilte chuig Abu Dhabi Irish Society! Thanks for joining up.`,
    ``,
    `We are delighted to welcome you to our community - your home away from home, right here in Abu Dhabi.`,
    ``,
    `MEMBERSHIP DETAILS`,
    `Membership number: ${membershipNumber}`,
    `Membership type: ${typeLabel}`,
    ...(expiryDate ? [`Valid until: ${formatDate(expiryDate)}`] : []),
    `Your membership card: ${cardUrl}`,
    ``,
    `Your membership card is unique to you and includes a personal QR code. Please show your QR code to participating discount partners to avail of exclusive member benefits (redemption rules apply).`,
    ``,
    `Please note: your QR code is unique to your membership and cannot be shared with anyone else. It refreshes every 5 minutes, so open the link live rather than sending a screenshot.`,
    ``,
    `STAY CONNECTED`,
    `Instagram: ${LINKS.instagram}`,
    `LinkedIn: ${LINKS.linkedin}`,
    `TikTok: ${LINKS.tiktok}`,
    `WhatsApp Community: ${LINKS.whatsapp}`,
    `Facebook: ${LINKS.facebook}`,
    ...(LINKS.linktree ? [`Linktree: ${LINKS.linktree}`] : []),
    ``,
    `Sponsors and discount partners: ${LINKS.linktree}`,
    ``,
    `Activate your 20% McCafferty's discount: ${LINKS.mccaffertys}`,
    ``,
    `BECOME A VOLUNTEER`,
    `Email the President to express your interest in becoming a Society volunteer: ${PRESIDENT_EMAIL}`,
    ``,
    `GET IN TOUCH`,
    `We'd love to hear from you. Please reach out to our President, ${PRESIDENT_NAME}: ${PRESIDENT_EMAIL}`,
    ``,
    `We look forward to welcoming you to our upcoming events and to having you as part of our vibrant Irish community in Abu Dhabi.`,
    ``,
    `Míle buíochas,`,
    `Abu Dhabi Irish Society Committee`,
  ].join("\n");

  const volunteerHref = LINKS.volunteer
    ? LINKS.volunteer
    : `mailto:${PRESIDENT_EMAIL}?subject=${encodeURIComponent("I'd like to volunteer with ADIS")}`;

  const html = welcomeLayout(
    [
      `<p style="margin:0;font-size:16px;font-weight:700;color:${GREEN};">A Chairde,</p>`,
      `<h1 style="margin:4px 0 6px;font-size:26px;line-height:1.25;font-weight:700;color:${GREEN};">Fáilte chuig Abu Dhabi Irish Society!</h1>`,
      `<p style="margin:0 0 16px;font-size:16px;font-weight:700;color:${GOLD};">Thanks for joining up.</p>`,
      p(`We are delighted to welcome you to our community - your home away from home, right here in Abu Dhabi.`),

      h2("Membership Details"),
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 12px;">
        ${detailRow("Membership Number:", escapeHtml(membershipNumber))}
        ${detailRow("Membership Type:", escapeHtml(typeLabel))}
        ${expiryDate ? detailRow("Valid Until:", escapeHtml(formatDate(expiryDate))) : ""}
        ${detailRow(
          "Your membership card:",
          `<a href="${cardUrl}" style="color:${GREEN};font-weight:700;">Click here to view and download your membership card</a>`,
        )}
      </table>`,
      p(
        `Your membership card is unique to you and includes a personal QR code. Please show your QR code to participating discount partners to avail of exclusive member benefits (redemption rules apply).`,
      ),
      p(
        `<strong>Please note:</strong> your QR code is unique to your membership and cannot be shared with anyone else. It refreshes every 5 minutes, so open your card link live at events rather than sending a screenshot.`,
      ),

      `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;"><a href="${LINKS.linktree}" style="color:${GREEN};font-weight:700;text-decoration:underline;">Click the Linktree to find our sponsors and discount partners.</a></p>`,

      h2("Stay connected with the Abu Dhabi Irish Society"),
      p(`Keep up to date with our events, activities, member offers and community news by following us:`),
      socialRow(),

      `<p style="margin:20px 0 0;"><a href="${LINKS.mccaffertys}" style="color:${GREEN};font-weight:700;text-decoration:underline;">Click here to activate your 20% McCafferty's Discount</a></p>`,

      wideButton(volunteerHref, "BECOME A VOLUNTEER"),
      p(
        `Or email the President to express your interest in becoming a Society volunteer: <a href="mailto:${PRESIDENT_EMAIL}" style="color:${GREEN};font-weight:700;">${PRESIDENT_EMAIL}</a>`,
      ),

      h2("Get in touch"),
      p(`We'd love to hear from you. Please reach out to our President:`),
      `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 14px;">
        ${detailRow(
          "President",
          `${escapeHtml(PRESIDENT_NAME)} &nbsp;&nbsp; <a href="mailto:${PRESIDENT_EMAIL}" style="color:${GREEN};font-weight:700;">${PRESIDENT_EMAIL}</a>`,
        )}
      </table>`,
      p(
        `We look forward to welcoming you to our upcoming events and to having you as part of our vibrant Irish community in Abu Dhabi.`,
      ),
      `<p style="margin:18px 0 2px;font-size:16px;font-weight:700;color:${GREEN};">Míle buíochas,</p>`,
      `<p style="margin:0;font-size:15px;font-weight:700;">Abu Dhabi Irish Society Committee</p>`,
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
