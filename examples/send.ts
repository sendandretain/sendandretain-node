/**
 * Send one email from a published template.
 *
 *   SENDANDRETAIN_API_KEY=aem_… npx tsx examples/send.ts
 */
import { SendAndRetain } from "@sendandretain/sdk";

const sendandretain = new SendAndRetain();

const { data, error } = await sendandretain.emails.send(
  { to: "jane@acme.com", template: "welcome", props: { firstName: "Jane" } },
  // Tie the key to what you are sending, so a retry can never send twice.
  { idempotencyKey: "welcome/user_42" }
);

if (error) {
  // Branch on `code`, quote `request_id` to support.
  console.error(`${error.code}: ${error.message} (${error.request_id})`);
  process.exit(1);
}
console.log(`queued ${data.id} (${data.status})`);
