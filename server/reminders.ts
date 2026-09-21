import { storage } from "./storage";
import { sendRenewalReminderEmail } from "./email";
import { renewUrlFor } from "./config";
import type { ReminderKind } from "@shared/schema";

// Renewal reminders at 30 days, 7 days and on expiry.
//
// The sweep is safe to run as often as we like: each reminder is stamped on
// the member's row once sent, so a restart, a redeploy or a double run never
// produces a duplicate email. Only paid members are reminded — someone who
// never completed payment gets the sign-up flow instead, not a renewal nudge.

const KINDS: ReminderKind[] = ["reminder30", "reminder7", "reminderExpiry"];

export async function runReminderSweep(
  log: (message: string) => void = () => {},
): Promise<{ sent: number; failed: number }> {
  const now = new Date();
  let sent = 0;
  let failed = 0;

  for (const kind of KINDS) {
    let due: Awaited<ReturnType<typeof storage.findDueReminders>>;
    try {
      due = await storage.findDueReminders(kind, now);
    } catch (err) {
      log(`reminder sweep could not query ${kind}: ${(err as Error).message}`);
      continue;
    }

    for (const member of due) {
      try {
        await sendRenewalReminderEmail({
          to: member.primaryEmail,
          name: member.primaryFullName,
          membershipNumber: member.membershipNumber,
          membershipType: member.membershipType,
          expiryDate: member.membershipExpiryDate,
          kind,
          renewUrl: renewUrlFor(member.membershipNumber),
        });
        await storage.markReminderSent(member.id, kind);
        sent++;
      } catch (err) {
        // Left unstamped on purpose, so the next sweep retries it.
        failed++;
        log(`failed ${kind} for ${member.membershipNumber}: ${(err as Error).message}`);
      }
    }
  }

  if (sent || failed) {
    log(`reminder sweep finished: ${sent} sent, ${failed} failed`);
  }
  return { sent, failed };
}

const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000; // every 6 hours

export function startReminderScheduler(log: (message: string) => void): void {
  const tick = () => {
    runReminderSweep(log).catch((err) => log(`reminder sweep crashed: ${err.message}`));
  };
  // First run shortly after boot, once the database is warm.
  setTimeout(tick, 30_000);
  const timer = setInterval(tick, SWEEP_INTERVAL_MS);
  timer.unref?.();
  log("renewal reminder scheduler started (30-day, 7-day and expiry emails)");
}
