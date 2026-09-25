import { membershipExpiryFor } from "./config";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";

// Postgres in every environment, so what we test is what runs live.
//
// Production (Railway) supplies DATABASE_URL and we talk to managed Postgres
// over the network. Without DATABASE_URL we fall back to PGlite, a real
// Postgres engine running in-process against a local directory — same SQL
// dialect, no server to install. The important consequence of both paths
// being Postgres is that the member list lives in a managed database with
// its own backups, rather than in a file a redeploy can discard.

export const isManagedDatabase = Boolean(process.env.DATABASE_URL);

let dbInstance: NodePgDatabase | undefined;

export function getDb(): NodePgDatabase {
  if (!dbInstance) {
    throw new Error("Database used before initDb() completed");
  }
  return dbInstance;
}

export async function initDb(): Promise<void> {
  if (dbInstance) return;

  if (isManagedDatabase) {
    const { Pool } = await import("pg");
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      // Railway's managed Postgres terminates TLS with its own certificate
      // chain, which Node does not ship as a trusted root.
      ssl: process.env.DATABASE_SSL === "disable" ? undefined : { rejectUnauthorized: false },
      max: 5,
    });
    dbInstance = drizzlePg(pool);
  } else {
    const { PGlite } = await import("@electric-sql/pglite");
    const { drizzle: drizzlePglite } = await import("drizzle-orm/pglite");
    const client = new PGlite(process.env.LOCAL_DB_DIR || "./.pgdata");
    dbInstance = drizzlePglite(client) as unknown as NodePgDatabase;
  }

  await migrate();
}

// Schema creation runs on every boot and is idempotent, so a fresh Railway
// database builds itself on first deploy with no manual SQL step.
async function migrate(): Promise<void> {
  const db = getDb();

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS registrations (
      id SERIAL PRIMARY KEY,
      membership_number TEXT NOT NULL UNIQUE,
      membership_type TEXT NOT NULL,
      primary_full_name TEXT NOT NULL,
      primary_email TEXT NOT NULL,
      primary_mobile TEXT NOT NULL,
      nationality TEXT NOT NULL,
      emirate TEXT NOT NULL,
      member_status TEXT NOT NULL,
      previous_member BOOLEAN NOT NULL DEFAULT FALSE,
      second_adult_first_name TEXT,
      second_adult_surname TEXT,
      second_adult_email TEXT,
      second_adult_mobile TEXT,
      children_json TEXT NOT NULL DEFAULT '[]',
      communication_preference TEXT NOT NULL,
      join_whatsapp_community BOOLEAN NOT NULL DEFAULT FALSE,
      receive_marketing BOOLEAN NOT NULL DEFAULT FALSE,
      consent_terms BOOLEAN NOT NULL DEFAULT FALSE,
      consent_privacy BOOLEAN NOT NULL DEFAULT FALSE,
      amount_due INTEGER NOT NULL,
      payment_status TEXT NOT NULL DEFAULT 'pending',
      payment_reference TEXT,
      payment_declared_at TEXT,
      registration_date TEXT NOT NULL,
      membership_start_date TEXT NOT NULL,
      membership_expiry_date TEXT NOT NULL,
      card_token TEXT NOT NULL UNIQUE,
      otp_secret TEXT NOT NULL,
      card_email_sent_at TEXT,
      partner_card_token TEXT UNIQUE,
      partner_otp_secret TEXT,
      partner_card_email_sent_at TEXT,
      partner_welcome_email_sent_at TEXT,
      welcome_email_sent_at TEXT,
      reminder_30_sent_at TEXT,
      reminder_7_sent_at TEXT,
      reminder_expiry_sent_at TEXT
    );
  `);

  // Columns added after the first production deploy go here. Postgres
  // supports IF NOT EXISTS on ADD COLUMN, so this is safe to re-run.
  for (const column of [
    "payment_declared_at",
    "partner_card_token",
    "partner_otp_secret",
    "partner_card_email_sent_at",
    "partner_welcome_email_sent_at",
    "welcome_email_sent_at",
    "reminder_30_sent_at",
    "reminder_7_sent_at",
    "reminder_expiry_sent_at",
  ]) {
    await db.execute(sql.raw(`ALTER TABLE registrations ADD COLUMN IF NOT EXISTS ${column} TEXT`));
  }

  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS registrations_expiry_idx ON registrations(membership_expiry_date)`,
  );
  await db.execute(
    sql`CREATE UNIQUE INDEX IF NOT EXISTS registrations_partner_card_idx ON registrations(partner_card_token)`,
  );

  // Move anyone registered under the old "one year from joining" rule onto the
  // fixed 30 September end date. Rows already ending on 30 September are left
  // alone, so this is a no-op after the first run.
  const legacy = await db.execute(
    sql`SELECT id, registration_date FROM registrations WHERE membership_expiry_date NOT LIKE '%-09-30T19:59:59.999Z'`,
  );
  const rows = ((legacy as any).rows ?? legacy) as { id: number; registration_date: string }[];
  for (const row of rows) {
    const expiry = membershipExpiryFor(new Date(row.registration_date));
    await db.execute(
      sql`UPDATE registrations SET membership_expiry_date = ${expiry} WHERE id = ${row.id}`,
    );
  }
}
