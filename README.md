# Send & Retain Node.js SDK

The official Node.js SDK for the [Send & Retain](https://sendandretain.com) email API — send email,
sync contacts, emit events that drive automations, and verify webhooks. Every request and response
type is generated from the [OpenAPI spec](./openapi.json).

```bash
npm install @sendandretain/sdk
```

Node 20 or later. ESM and CommonJS. Server-side only — never ship an API key to a browser.

## Quickstart

Create a key in the dashboard under **Settings → API keys** and set it as
`SENDANDRETAIN_API_KEY`.

```ts
import { SendAndRetain } from "@sendandretain/sdk";

const sendandretain = new SendAndRetain(); // reads SENDANDRETAIN_API_KEY

const { data, error } = await sendandretain.emails.send({
  to: "jane@acme.com",
  template: "welcome",
  props: { firstName: "Jane" },
});

if (error) {
  console.error(error.code, error.message, error.request_id);
} else {
  console.log(data.id); // queued — delivery is reported by webhook
}
```

Sending needs a key with the `write` scope **and** the send grant (the dashboard's
**Send + manage**). A send is accepted with `202` and delivered in the background; follow it with
`emails.get(id)` or, better, a [webhook](#webhooks).

## Responses and errors

Every method resolves to `{ data, error, headers }` and never throws for an API or network failure:

```ts
const { data, error, headers } = await sendandretain.templates.get("welcome");

if (error) {
  switch (error.code) {
    case "not_found": // 404
      break;
    case "rate_limited": // already retried for you; this is after the last attempt
      break;
    case "network_error": // no response arrived — status is null
      break;
  }
  console.error(`support reference: ${error.request_id}`);
}
```

`error` is `{ code, message, status, request_id, ...extra }`. Branch on `code` — the full list is in
the [error reference](https://sendandretain.com/docs/api/errors). A 403 also carries
`required_scope` or `required_grant`. The constructor is the only thing that throws: on a missing or
malformed key.

## Idempotency

Pass an `idempotencyKey` on any create to make it safe to retry:

```ts
await sendandretain.emails.send(
  { to: "jane@acme.com", template: "welcome" },
  { idempotencyKey: "welcome/user_42" }
);
```

The same key and body replays the first result (`Idempotency-Replay: true`) instead of sending
again; a different body with the same key is a `conflict` error. Keys live 24 hours. When you pass
none, the SDK generates one per call, so its own retries can never send twice.

## Retries and timeouts

Requests that fail with `408`, `429` or `5xx`, or never get a response, are retried twice with
exponential backoff and jitter, honouring `Retry-After`. Only safe requests are retried: reads,
updates, deletes, and creates carrying an idempotency key — which is all of them, by default. A
`429` `daily_cap` / `monthly_cap` is a sending quota, not a throttle, and is returned at once.

```ts
const sendandretain = new SendAndRetain({ maxRetries: 4, timeout: 10_000 });

// Per call: cancel, cap the whole call, or add headers.
await sendandretain.contacts.list({ limit: 100 }, { signal, timeout: 5_000 });
```

## Pagination

Lists answer `{ object: "list", data, has_more, next_cursor }`. `iterate()` walks every page:

```ts
for await (const email of sendandretain.emails.list.iterate({ status: "bounced" })) {
  console.log(email.to);
}

// Or page by hand.
const page = await sendandretain.contacts.list({ limit: 100 });
const next = page.data?.next_cursor
  ? await sendandretain.contacts.list({ limit: 100, cursor: page.data.next_cursor })
  : null;
```

## Webhooks

Subscribe an endpoint, store the secret it returns (shown once), and verify every delivery against
the **raw** body:

```ts
const { data } = await sendandretain.webhooks.create({
  url: "https://acme.com/api/webhooks/sendandretain",
  event_types: ["email.delivered", "email.bounced", "email.complained"],
});
// data.secret → SENDANDRETAIN_WEBHOOK_SECRET

// In your handler:
import { verifyWebhook, WebhookVerificationError } from "@sendandretain/sdk";

const event = verifyWebhook({
  payload: await req.text(), // the raw body, not req.json()
  headers: req.headers,
  secret: process.env.SENDANDRETAIN_WEBHOOK_SECRET!,
});

if (event.type === "email.bounced") {
  // event is narrowed to the bounced payload
}
```

`verifyWebhook` throws `WebhookVerificationError` on a bad signature or a stale timestamp — answer
`400`. Deliveries are [Standard Webhooks](https://www.standardwebhooks.com), at-least-once and
unordered: dedupe on `event.id`, order on `event.occurred_at`. Missed one? `webhooks.deliveries.replay(id, deliveryId)`.

See [`examples/`](./examples) for a plain Node server and a Next.js route handler.

## Resources

| Resource | Methods |
| --- | --- |
| `emails` | `send`, `get`, `list` (`.iterate`), `reschedule`, `cancel`, `batch.send` |
| `contacts` | `upsert`, `get`, `list` (`.iterate`), `delete`, `import`, `events` (`.iterate`) |
| `events` | `emit` |
| `suppressions` | `list` (`.iterate`), `add`, `remove`, `import` |
| `templates` | `create`, `list`, `get`, `update`, `updateMeta`, `archive`, `listVersions`, `publish`, `unpublish`, `render`, `test`, `addTranslation` |
| `automations` | `create`, `list`, `get`, `update`, `archive`, `setStatus`, `duplicate`, `backfill`, `preflight`, `runs` (`.iterate`), `metrics`, `setAbTest`, `promoteAbWinner`, `steps.{add,update,remove,move,syncProps}` |
| `segments` | `create`, `list`, `update`, `delete`, `refreshCount` |
| `domains` | `create`, `list`, `verify`, `delete` |
| `senders` | `create`, `list`, `update`, `delete` |
| `webhooks` | `create`, `list`, `get`, `update`, `delete`, `rotateSecret`, `test`, `deliveries.list` (`.iterate`), `deliveries.replay`, `verify` |
| `metrics` | `get`, `trends`, `queueHealth` |
| `settings` | `get`, `update`, `getBrand`, `updateBrand` |
| `setup` | `onboarding`, `connection`, `registerProviderWebhook` |

Every operation in the API has a method — a test fails if one is missing. `sendandretain.http` is
the underlying [openapi-fetch](https://openapi-ts.dev/openapi-fetch/) client if you need the raw
response.

## TypeScript

Request bodies, queries and responses are all typed from the spec. The generated types are exported
for your own use:

```ts
import type { components, paths, WebhookEvent } from "@sendandretain/sdk";

type Contact = components["schemas"]["ContactResult"];
```

## Configuration

| Option | Env var | Default |
| --- | --- | --- |
| `apiKey` | `SENDANDRETAIN_API_KEY` | — (required) |
| `baseUrl` | `SENDANDRETAIN_BASE_URL` | `https://sendandretain.com` |
| `maxRetries` | | `2` |
| `timeout` | | `60000` ms per attempt |
| `fetch` | | global `fetch` |

## Development

```bash
npm ci
npm run gen      # regenerate src/schema.d.ts from openapi.json
npm run verify   # fail if they drifted
npm test
npm run build
```

`openapi.json`, `src/runtime.ts`, `LICENSE` and `.github/` are synced from the Send & Retain source
tree and overwritten on every sync — change them there, not here. Everything else in this repo is
hand-written.

## Links

- [API reference](https://sendandretain.com/docs/api)
- [OpenAPI spec](https://sendandretain.com/openapi.json)
- [Python SDK](https://github.com/sendretain/sendandretain-py)
- [Claude Code plugin](https://github.com/sendretain/sendandretain-plugin)

## License

MIT
