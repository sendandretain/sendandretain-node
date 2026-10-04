# @sendandretain/sdk

A thin, fully-typed Node/TypeScript client for the **Send & Retain** API — send
transactional and lifecycle email, sync contacts, emit the events that drive
automations, and manage templates, segments, suppressions and sending setup.

Every request and response type is generated from the API's OpenAPI spec
(committed here as [`openapi.json`](./openapi.json)), so field names and shapes
match the live API and there is nothing hand-maintained to drift. CI fails if
the committed spec and the generated types disagree.

## Install

```bash
npm install @sendandretain/sdk
```

Requires Node 18+ (it uses the platform `fetch`). ESM-only.

## Quickstart

```ts
import { createClient } from "@sendandretain/sdk";

const emails = createClient({ apiKey: process.env.SENDANDRETAIN_API_KEY! });

const { data, error } = await emails.emails.send(
  { to: "jane@acme.com", template: "welcome", props: { firstName: "Jane" } },
  { idempotencyKey: "welcome-jane-1" }
);

if (error) throw new Error(`${error.error.code}: ${error.error.message}`);
console.log(data); // { id: "msg_…", status: "sent" }
```

Every method returns openapi-fetch's `{ data, error, response }` union: on a
non-2xx response `error` holds the typed `{ error: { code, message } }`
envelope and `data` is `undefined`. **No exceptions are thrown for API errors** —
only for transport failures. `error.error.code` is a stable, machine-readable
string (`template_not_found`, `suppressed`, `sends_paused`, `daily_cap`,
`rate_limited`, `provider_error`, …); branch on it rather than on the message.

## Configuration

```ts
createClient({ apiKey, baseUrl?, fetch? });
```

- `apiKey` — a per-project API key (`aem_…`), created in the dashboard under
  **Settings → API keys**. **Server-side only** — never ship it to the browser.
  In Next.js, call this from Route Handlers or Server Actions, not Client
  Components.
- `baseUrl` — API origin. Defaults to `https://sendandretain.com` (exported as
  `DEFAULT_BASE_URL`); override for a preview or self-hosted deployment, e.g.
  `createClient({ apiKey, baseUrl: process.env.SENDANDRETAIN_BASE_URL })`.
- `fetch` — inject a custom `fetch` for tests or non-Node runtimes.

## Scopes

A key carries exactly one scope, and the scopes are **ranked** — a key satisfies
any requirement at or below its own tier:

| Scope     | Can do                                                                                                                                        |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `read`    | Read-only. Never changes anything, and **cannot send**.                                                                                       |
| `write`   | Everything `read` does, **plus sending email** and managing contacts, templates, automations, segments and suppressions.                       |
| `admin`   | Everything `write` does, plus sending _configuration_: domains, senders, webhook registration, the kill switch, the daily cap, and the brand kit. |

**Sending requires `write`.** So does everything under `emails`, `contacts`,
`events`, `suppressions`, `templates`, `automations`, `audience` and `metrics`.
`setup.*` and `settings.*` require `admin`. Give your application the lowest
tier that works — for most applications that is `write`.

A valid key with an insufficient scope gets `403 forbidden` (not `401`); the
message names the tier the endpoint wanted and the tier the key has. `401` means
the key is missing, malformed, or revoked.

Provider API keys (Resend / SendGrid) can **not** be set over the API at any
scope — they only enter through the dashboard.

## API surface

The facade mirrors the REST API groups:

| Group                | Methods                                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `emails`             | `send`, `get`, `list`, `reschedule`, `cancel`                                                                      |
| `contacts`           | `upsert`, `list`, `get`, `delete`, `import`, `events`                                                               |
| `events`             | `emit`                                                                                                              |
| `suppressions`       | `list`, `add`, `remove`, `import`                                                                                   |
| `templates`          | `create`, `list`, `get`, `update`, `archive`, `updateMeta`, `listVersions`, `publish`, `render`, `test`, `addTranslation` |
| `automations`        | `create`, `list`, `get`, `update`, `archive`, `setStatus`, `duplicate`, `preflight`, `listRuns`, `metrics`, `setAbTest`, `promoteAbWinner` |
| `automations.steps`  | `add`, `update`, `remove`, `move`, `syncProps`                                                                      |
| `audience.segments`  | `create`, `list`, `update`, `delete`, `refreshCount`                                                                |
| `setup`              | `connection`, `registerWebhooks`, `domains.*`, `senders.*` (`admin`)                                                |
| `metrics`            | `get`, `trends`, `queueHealth`                                                                                      |
| `settings`           | `get`, `update`, `getBrand`, `updateBrand` (`admin`)                                                                |
| `http`               | the underlying `openapi-fetch` client, for anything not on the facade                                               |

The exported `paths`, `components` and `operations` types give you the raw
generated shapes when you need them:

```ts
import type { components } from "@sendandretain/sdk";

type SendResult = components["schemas"]["SendResult"];
```

### Things worth knowing before you call

- **Idempotency.** `emails.send` takes an optional `idempotencyKey` (≤256 chars,
  unique per logical send). A repeat returns the original result with
  `deduplicated: true` instead of sending twice.
- **One recipient per send.** There are no bulk campaigns; broad sending happens
  through event-triggered automations you explicitly enable.
- **Templates are create → render → test → publish.** Drafts cannot send, and
  published versions are immutable — every edit produces a new draft you publish
  deliberately.
- **Automations are always created paused.** `automations.setStatus` is the only
  call that starts real sending, and activating requires
  `{ status: "active", confirm: true }`.
- **Complaint suppressions are permanent.** `suppressions.remove` will not lift
  them.

## Development

```bash
npm install
npm run gen        # openapi.json -> src/schema.d.ts (committed)
npm run verify     # fail if src/schema.d.ts is stale vs openapi.json
npm run typecheck
npm test
npm run build      # tsup -> dist/
```

`openapi-typescript` is pinned to an exact version because its output varies
across releases; an unpinned range would turn a routine install into phantom
drift. To pick up an API change: replace `openapi.json`, run `npm run gen`, and
commit both files in the same change.

## License

MIT — see [LICENSE](./LICENSE).
