import { pgTable, text, integer, boolean, serial } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const registrations = pgTable("registrations", {
  id: serial("id").primaryKey(),
  membershipNumber: text("membership_number").notNull().unique(),

  membershipType: text("membership_type").notNull(), // "single" | "family"

  primaryFullName: text("primary_full_name").notNull(),
  primaryEmail: text("primary_email").notNull(),
  primaryMobile: text("primary_mobile").notNull(),
  nationality: text("nationality").notNull(),
  emirate: text("emirate").notNull(),
  memberStatus: text("member_status").notNull(), // "new" | "renewal"
  previousMember: boolean("previous_member").notNull().default(false),

  secondAdultFirstName: text("second_adult_first_name"),
  secondAdultSurname: text("second_adult_surname"),
  secondAdultEmail: text("second_adult_email"),
  secondAdultMobile: text("second_adult_mobile"),

  childrenJson: text("children_json").notNull().default("[]"), // JSON array of {firstName, surname, dob}

  communicationPreference: text("communication_preference").notNull(), // "email" | "whatsapp" | "both"
  joinWhatsappCommunity: boolean("join_whatsapp_community").notNull().default(false),
  receiveMarketing: boolean("receive_marketing").notNull().default(false),

  consentTerms: boolean("consent_terms").notNull().default(false),
  consentPrivacy: boolean("consent_privacy").notNull().default(false),

  amountDue: integer("amount_due").notNull(),
  // "pending"  – no payment recorded
  // "declared" – member ticked that they paid through the payment link; awaiting
  //              committee confirmation. No card is issued in this state.
  // "paid"     – a committee member has matched it to the payment dashboard
  // "failed"   – payment could not be found
  paymentStatus: text("payment_status").notNull().default("pending"),
  paymentReference: text("payment_reference"),
  paymentDeclaredAt: text("payment_declared_at"),

  registrationDate: text("registration_date").notNull(),
  membershipStartDate: text("membership_start_date").notNull(),
  membershipExpiryDate: text("membership_expiry_date").notNull(),

  // Digital membership card: cardToken is the public, unguessable id used to
  // load the card page; otpSecret is server-side only and drives the
  // rotating QR code so a screenshot of the card cannot be reused.
  cardToken: text("card_token").notNull().unique(),
  otpSecret: text("otp_secret").notNull(),
  cardEmailSentAt: text("card_email_sent_at"),

  // Family memberships: the second adult gets their own card under the same
  // membership number, with their own token and QR secret so both adults can
  // be scanned in independently at the same event.
  partnerCardToken: text("partner_card_token").unique(),
  partnerOtpSecret: text("partner_otp_secret"),
  partnerCardEmailSentAt: text("partner_card_email_sent_at"),
  partnerWelcomeEmailSentAt: text("partner_welcome_email_sent_at"),

  // Lifecycle email bookkeeping. Each column records the ISO timestamp the
  // message was sent so a restart or a second run of the daily scheduler can
  // never send the same reminder twice.
  welcomeEmailSentAt: text("welcome_email_sent_at"),
  reminder30SentAt: text("reminder_30_sent_at"),
  reminder7SentAt: text("reminder_7_sent_at"),
  reminderExpirySentAt: text("reminder_expiry_sent_at"),
});

export const childSchema = z.object({
  firstName: z.string().min(1),
  surname: z.string().min(1),
  dob: z.string().min(1),
});

export const insertRegistrationSchema = createInsertSchema(registrations)
  .omit({
    id: true,
    membershipNumber: true,
    paymentStatus: true,
    paymentReference: true,
    registrationDate: true,
    membershipStartDate: true,
    membershipExpiryDate: true,
    childrenJson: true,
    cardToken: true,
    otpSecret: true,
    cardEmailSentAt: true,
    partnerCardToken: true,
    partnerOtpSecret: true,
    partnerCardEmailSentAt: true,
    partnerWelcomeEmailSentAt: true,
    paymentDeclaredAt: true,
    welcomeEmailSentAt: true,
    reminder30SentAt: true,
    reminder7SentAt: true,
    reminderExpirySentAt: true,
  })
  .extend({
    children: z.array(childSchema).default([]),
    // Set when the member has been through the hosted payment link before
    // submitting the form. The reference is whatever receipt number the
    // payment page gave them, used by the committee to reconcile.
    paymentDeclared: z.boolean().default(false),
    paymentReference: z.string().max(120).optional(),
  });

export type InsertRegistration = z.infer<typeof insertRegistrationSchema>;
export type Registration = typeof registrations.$inferSelect;

export interface RegistrationWithChildren extends Omit<Registration, "childrenJson"> {
  children: { firstName: string; surname: string; dob: string }[];
}

export type ReminderKind = "reminder30" | "reminder7" | "reminderExpiry";
