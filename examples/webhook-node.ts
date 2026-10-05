/**
 * Receive webhooks with plain node:http. Verify against the RAW body — parse
 * only after the signature checks out.
 *
 *   SENDANDRETAIN_WEBHOOK_SECRET=whsec_… npx tsx examples/webhook-node.ts
 */
import { createServer } from "node:http";

import { verifyWebhook, WebhookVerificationError } from "@sendandretain/sdk";

const secret = process.env.SENDANDRETAIN_WEBHOOK_SECRET!;

createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);

  try {
    const event = verifyWebhook({ payload: Buffer.concat(chunks), headers: req.headers, secret });
    switch (event.type) {
      case "email.bounced":
      case "email.complained":
        console.log(`stop emailing ${event.data.message?.to}`);
        break;
      case "email.delivered":
        console.log(`delivered ${event.data.message?.id}`);
        break;
    }
    res.writeHead(204).end();
  } catch (err) {
    if (err instanceof WebhookVerificationError) return void res.writeHead(400).end();
    throw err;
  }
}).listen(3000);
