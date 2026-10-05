/**
 * Up to 100 distinct emails in one call. Entries succeed and fail on their own,
 * so read every result rather than the status code.
 */
import { SendAndRetain } from "@sendandretain/sdk";

const sendandretain = new SendAndRetain();

const receipts = [
  { to: "a@acme.com", order: "1001" },
  { to: "b@acme.com", order: "1002" },
];

const { data, error } = await sendandretain.emails.batch.send(
  { emails: receipts.map((r) => ({ to: r.to, template: "receipt", props: { order: r.order } })) },
  { idempotencyKey: "receipts/2026-10-05" }
);

if (error) throw new Error(`${error.code}: ${error.message}`);
for (const result of data.data ?? []) {
  console.log(result);
}
