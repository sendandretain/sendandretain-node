/**
 * A Next.js App Router route handler (app/api/webhooks/sendandretain/route.ts).
 * Read the body with `req.text()` — never `req.json()` — so the signature is
 * checked against the exact bytes we signed.
 */
import { SendAndRetain, WebhookVerificationError } from "@sendandretain/sdk";

const sendandretain = new SendAndRetain();

export async function POST(req: Request): Promise<Response> {
  let event;
  try {
    event = sendandretain.webhooks.verify({
      payload: await req.text(),
      headers: req.headers,
      secret: process.env.SENDANDRETAIN_WEBHOOK_SECRET!,
    });
  } catch (err) {
    if (err instanceof WebhookVerificationError) return new Response(null, { status: 400 });
    throw err;
  }

  if (event.type === "email.bounced") {
    // Deliveries are at-least-once: dedupe on event.id before acting.
    console.log("bounced", event.data.message?.to, event.data.detail);
  }
  return new Response(null, { status: 204 });
}
