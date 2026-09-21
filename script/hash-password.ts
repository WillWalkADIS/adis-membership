// Usage: npm run hash-password -- "your new password"
// Prints the value to paste into the ADMIN_PASSWORD_HASH variable on Railway.
import { hashPassword } from "../server/config";

const password = process.argv[2];
if (!password) {
  console.error('Usage: npm run hash-password -- "your new password"');
  process.exit(1);
}
console.log(hashPassword(password));
