// Runs the renewal reminder sweep once and exits. Useful for a scheduled job
// or for checking the reminder emails by hand.
import "dotenv/config";
import { initDb } from "../server/db";
import { runReminderSweep } from "../server/reminders";

(async () => {
  await initDb();
  const result = await runReminderSweep((m) => console.log(`[reminders] ${m}`));
  console.log(JSON.stringify(result));
  process.exit(0);
})();
