import { registrations } from "@shared/schema";
import type {
  Registration,
  InsertRegistration,
  RegistrationWithChildren,
  ReminderKind,
} from "@shared/schema";
import { desc, eq, sql, and, or, isNull, gte, lte, lt } from "drizzle-orm";
import { getDb } from "./db";
import { membershipExpiryFor } from "./config";
import { generateCardToken, generateOtpSecret } from "./otp";

function generateMembershipNumber(year: number, sequence: number): string {
  return `ADIS-${year}-${String(sequence).padStart(4, "0")}`;
}

function toWithChildren(r: Registration): RegistrationWithChildren {
  const { childrenJson, ...rest } = r;
  let children: { firstName: string; surname: string; dob: string }[] = [];
  try {
    children = JSON.parse(childrenJson);
  } catch {
    children = [];
  }
  return { ...rest, children };
}

const reminderColumn = {
  reminder30: registrations.reminder30SentAt,
  reminder7: registrations.reminder7SentAt,
  reminderExpiry: registrations.reminderExpirySentAt,
} as const;

export interface IStorage {
  createRegistration(data: InsertRegistration): Promise<RegistrationWithChildren>;
  listRegistrations(): Promise<RegistrationWithChildren[]>;
  getRegistration(id: number): Promise<RegistrationWithChildren | undefined>;
  getRegistrationByCardToken(cardToken: string): Promise<RegistrationWithChildren | undefined>;
  markPaid(id: number, paymentReference: string): Promise<RegistrationWithChildren | undefined>;
  markCardEmailSent(id: number): Promise<void>;
  markWelcomeEmailSent(id: number): Promise<void>;
  markReminderSent(id: number, kind: ReminderKind): Promise<void>;
  findDueReminders(kind: ReminderKind, now: Date): Promise<RegistrationWithChildren[]>;
}

export class DatabaseStorage implements IStorage {
  async createRegistration(data: InsertRegistration): Promise<RegistrationWithChildren> {
    const db = getDb();
    const now = new Date();
    const year = now.getFullYear();

    // Next number is one above the highest ever used this year, not the
    // count of rows — otherwise deleting a record would hand out a number
    // that already belongs to someone.
    const maxRows = await db
      .select({ m: sql<number>`coalesce(max(cast(substring(${registrations.membershipNumber} from 11) as int)), 0)::int` })
      .from(registrations)
      .where(sql`${registrations.membershipNumber} LIKE ${`ADIS-${year}-%`}`);
    const sequence = (maxRows[0]?.m ?? 0) + 1;
    const membershipNumber = generateMembershipNumber(year, sequence);

    const registrationDate = now.toISOString();
    const membershipStartDate = registrationDate;
    const membershipExpiryDate = membershipExpiryFor(now);
    const isFamily = data.membershipType === "family";

    const { children, paymentDeclared, paymentReference, ...rest } = data;

    const [row] = await db
      .insert(registrations)
      .values({
        ...rest,
        membershipNumber,
        childrenJson: JSON.stringify(children ?? []),
        // A ticked payment is only a claim until the committee confirms it.
        paymentStatus: paymentDeclared ? "declared" : "pending",
        paymentReference: paymentReference?.trim() || null,
        paymentDeclaredAt: paymentDeclared ? now.toISOString() : null,
        registrationDate,
        membershipStartDate,
        membershipExpiryDate,
        cardToken: generateCardToken(),
        otpSecret: generateOtpSecret(),
        partnerCardToken: isFamily ? generateCardToken() : null,
        partnerOtpSecret: isFamily ? generateOtpSecret() : null,
      })
      .returning();

    return toWithChildren(row);
  }

  async getRegistrationByCardToken(cardToken: string): Promise<RegistrationWithChildren | undefined> {
    const [row] = await getDb()
      .select()
      .from(registrations)
      .where(eq(registrations.cardToken, cardToken))
      .limit(1);
    return row ? toWithChildren(row) : undefined;
  }

  // Looks up a card by either adult's token and says whose card it is.
  async findCardHolder(
    token: string,
  ): Promise<
    | { registration: RegistrationWithChildren; holder: "primary" | "partner"; name: string; otpSecret: string }
    | undefined
  > {
    const [row] = await getDb()
      .select()
      .from(registrations)
      .where(or(eq(registrations.cardToken, token), eq(registrations.partnerCardToken, token)))
      .limit(1);
    if (!row) return undefined;
    const registration = toWithChildren(row);
    if (row.partnerCardToken && row.partnerCardToken === token && row.partnerOtpSecret) {
      const name = `${row.secondAdultFirstName ?? ""} ${row.secondAdultSurname ?? ""}`.trim();
      return { registration, holder: "partner", name, otpSecret: row.partnerOtpSecret };
    }
    return { registration, holder: "primary", name: row.primaryFullName, otpSecret: row.otpSecret };
  }

  // Family registrations made before partner cards existed get one on demand.
  async ensurePartnerCard(id: number): Promise<RegistrationWithChildren | undefined> {
    const existing = await this.getRegistration(id);
    if (!existing || existing.membershipType !== "family" || existing.partnerCardToken) return existing;
    const [row] = await getDb()
      .update(registrations)
      .set({ partnerCardToken: generateCardToken(), partnerOtpSecret: generateOtpSecret() })
      .where(eq(registrations.id, id))
      .returning();
    return row ? toWithChildren(row) : undefined;
  }

  async markPartnerCardEmailSent(id: number): Promise<void> {
    await getDb()
      .update(registrations)
      .set({ partnerCardEmailSentAt: new Date().toISOString() })
      .where(eq(registrations.id, id));
  }

  async markPartnerWelcomeEmailSent(id: number): Promise<void> {
    await getDb()
      .update(registrations)
      .set({ partnerWelcomeEmailSentAt: new Date().toISOString() })
      .where(eq(registrations.id, id));
  }

  async deleteRegistration(id: number): Promise<boolean> {
    const rows = await getDb().delete(registrations).where(eq(registrations.id, id)).returning({ id: registrations.id });
    return rows.length > 0;
  }

  async markCardEmailSent(id: number): Promise<void> {
    await getDb()
      .update(registrations)
      .set({ cardEmailSentAt: new Date().toISOString() })
      .where(eq(registrations.id, id));
  }

  async markWelcomeEmailSent(id: number): Promise<void> {
    await getDb()
      .update(registrations)
      .set({ welcomeEmailSentAt: new Date().toISOString() })
      .where(eq(registrations.id, id));
  }

  async markReminderSent(id: number, kind: ReminderKind): Promise<void> {
    const stamp = new Date().toISOString();
    const patch =
      kind === "reminder30"
        ? { reminder30SentAt: stamp }
        : kind === "reminder7"
          ? { reminder7SentAt: stamp }
          : { reminderExpirySentAt: stamp };
    await getDb().update(registrations).set(patch).where(eq(registrations.id, id));
  }

  // Finds members whose membership crosses the reminder threshold and who have
  // not already had that particular reminder. Expiry dates are ISO strings, so
  // a plain string comparison is also a chronological one.
  async findDueReminders(kind: ReminderKind, now: Date): Promise<RegistrationWithChildren[]> {
    const db = getDb();
    const at = (days: number) => {
      const d = new Date(now);
      d.setDate(d.getDate() + days);
      return d.toISOString();
    };

    const notYetSent = isNull(reminderColumn[kind]);
 // The committee wants every registration reminded, paid or not.

    let window;
    if (kind === "reminder30") {
      // Anything expiring inside the next 30 days that has not been warned yet.
      window = and(gte(registrations.membershipExpiryDate, now.toISOString()), lte(registrations.membershipExpiryDate, at(30)));
    } else if (kind === "reminder7") {
      window = and(gte(registrations.membershipExpiryDate, now.toISOString()), lte(registrations.membershipExpiryDate, at(7)));
    } else {
      window = lt(registrations.membershipExpiryDate, now.toISOString());
    }

    const rows = await db
      .select()
      .from(registrations)
      .where(and(notYetSent, window))
      .orderBy(registrations.membershipExpiryDate);
    return rows.map(toWithChildren);
  }

  async listRegistrations(): Promise<RegistrationWithChildren[]> {
    const rows = await getDb().select().from(registrations).orderBy(desc(registrations.id));
    return rows.map(toWithChildren);
  }

  async getRegistration(id: number): Promise<RegistrationWithChildren | undefined> {
    const [row] = await getDb().select().from(registrations).where(eq(registrations.id, id)).limit(1);
    return row ? toWithChildren(row) : undefined;
  }

  async markPaid(id: number, paymentReference: string): Promise<RegistrationWithChildren | undefined> {
    const [row] = await getDb()
      .update(registrations)
      .set({ paymentStatus: "paid", paymentReference })
      .where(eq(registrations.id, id))
      .returning();
    return row ? toWithChildren(row) : undefined;
  }

  // Moves a paid member back to "paid — to verify". Their card stops working
  // at the door until the committee confirms them again. Card-sent stamps are
  // kept, so re-confirming does not email a duplicate card.
  async unmarkPaid(id: number): Promise<RegistrationWithChildren | undefined> {
    const [row] = await getDb()
      .update(registrations)
      .set({ paymentStatus: "declared" })
      .where(eq(registrations.id, id))
      .returning();
    return row ? toWithChildren(row) : undefined;
  }
}

export const storage = new DatabaseStorage();
