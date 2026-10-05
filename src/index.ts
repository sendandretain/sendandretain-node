import createOpenApiClient from "openapi-fetch";
import { Webhook, WebhookVerificationError } from "standardwebhooks";

import {
  createTransport,
  DEFAULT_BASE_URL,
  DEFAULT_MAX_RETRIES,
  DEFAULT_TIMEOUT_MS,
  idempotency,
  paginate,
  resolveApiKey,
  resolveBaseUrl,
  type ListPage,
} from "./runtime.js";
import type { components, paths } from "./schema.js";

/** Kept in step with package.json by `__tests__/client.test.ts`. */
export const VERSION = "0.2.0";

// ── Types derived from the spec ────────────────────────────────────────────
//
// Every payload and return type is projected from `paths` in the generated
// `schema.d.ts`, so this facade carries no hand-maintained request/response
// types and cannot drift from the API.

type Op<P extends keyof paths, M extends keyof paths[P]> = paths[P][M];
type Body<P extends keyof paths, M extends keyof paths[P]> =
  Op<P, M> extends { requestBody?: { content: { "application/json": infer B } } } ? B : never;
type Query<P extends keyof paths, M extends keyof paths[P]> =
  Op<P, M> extends { parameters: { query?: infer Q } } ? NonNullable<Q> : never;

/** Any event we deliver to your webhook endpoint. Discriminate on `type`. */
export type WebhookEvent = components["schemas"]["WebhookEvent"];

export interface ClientOptions {
  /** A per-project API key (`aem_…`). Defaults to `SENDANDRETAIN_API_KEY`. Server-side only. */
  apiKey?: string;
  /** API origin. Defaults to `SENDANDRETAIN_BASE_URL`, then {@link DEFAULT_BASE_URL}. */
  baseUrl?: string;
  /** Retries on 408/429/5xx and network errors, with backoff. Default 2; 0 disables. */
  maxRetries?: number;
  /** Per-attempt timeout in milliseconds. Default 60 000. */
  timeout?: number;
  /** Bring your own fetch (tests, proxies). Defaults to the global one. */
  fetch?: typeof fetch;
}

export interface RequestOptions {
  /**
   * Makes a create safe to retry (1–256 chars, kept 24h). The same key and body
   * replays the first result; a different body is a `conflict` error. When you
   * pass none, the SDK generates one per call so its own retries are safe.
   */
  idempotencyKey?: string;
  /** Extra headers for this request, e.g. your own `X-Request-Id`. */
  headers?: Record<string, string>;
  /** Cancel the request. */
  signal?: AbortSignal;
  /** Overall timeout for this call in milliseconds, retries included. */
  timeout?: number;
}

/** What every failed call returns in `error`. */
export interface ApiError {
  /** Stable code to branch on: `not_found`, `rate_limited`, `suppressed`, … */
  code: string;
  /** Human-readable; may change. Do not branch on it. */
  message: string;
  /** HTTP status, or null when no response arrived (`network_error`, `aborted`). */
  status: number | null;
  /** Quote this in a support request. */
  request_id: string | null;
  [field: string]: unknown;
}

/** Every method resolves to this. Nothing throws for an API or network failure. */
export type Result<T> =
  | { data: T; error: null; headers: Headers }
  | { data: null; error: ApiError; headers: Headers | null };

type FetchResult = { data?: unknown; error?: unknown; response: Response };
type DataOf<P> = NonNullable<Awaited<P> extends { data?: infer D } ? D : never>;

function toApiError(raw: unknown, response: Response): ApiError {
  const envelope = (raw as { error?: Record<string, unknown> } | undefined)?.error;
  const requestId = response.headers.get("X-Request-Id");
  return {
    ...(envelope ?? {}),
    code: typeof envelope?.code === "string" ? envelope.code : `http_${response.status}`,
    message:
      typeof envelope?.message === "string"
        ? envelope.message
        : `${response.status} ${response.statusText}`.trim(),
    status: response.status,
    request_id: (envelope?.request_id as string | undefined) ?? requestId,
  };
}

async function run<P extends Promise<FetchResult>>(call: P): Promise<Result<DataOf<P>>> {
  try {
    const { data, error, response } = await call;
    if (error !== undefined || !response.ok) {
      return { data: null, error: toApiError(error, response), headers: response.headers };
    }
    return { data: (data ?? null) as DataOf<P>, error: null, headers: response.headers };
  } catch (thrown) {
    const aborted = thrown instanceof Error && (thrown.name === "AbortError" || thrown.name === "TimeoutError");
    return {
      data: null,
      error: {
        code: aborted ? "aborted" : "network_error",
        message: thrown instanceof Error ? thrown.message : String(thrown),
        status: null,
        request_id: null,
      },
      headers: null,
    };
  }
}

function init(options?: RequestOptions) {
  const headers: Record<string, string> = { ...options?.headers, ...idempotency(options)?.header };
  const signals = [
    options?.signal,
    options?.timeout === undefined ? undefined : AbortSignal.timeout(options.timeout),
  ].filter((s): s is AbortSignal => s !== undefined);
  return {
    headers,
    ...(signals.length === 0 ? {} : { signal: signals.length === 1 ? signals[0] : AbortSignal.any(signals) }),
  };
}

type Page = ListPage<unknown>;
type Item<D> = D extends { data: Array<infer I> } ? I : never;

/** Turn one page into an async iterator over every row of every page. */
function walk<D extends Page>(fetchPage: (cursor: string | undefined) => Promise<Result<D>>) {
  return paginate<Item<D>>(async (cursor) => {
    const page = await fetchPage(cursor);
    return page.error ? { error: page.error } : { data: page.data as unknown as ListPage<Item<D>> };
  });
}

// ── Webhooks ───────────────────────────────────────────────────────────────

export { WebhookVerificationError };

export interface VerifyWebhookInput {
  /** The RAW request body — before any JSON parsing. */
  payload: string | Uint8Array;
  /** The request headers: a `Headers` object or a plain record (Express, Node). */
  headers: Headers | Record<string, string | string[] | undefined>;
  /** The endpoint's `whsec_…` signing secret. */
  secret: string;
}

/**
 * Verify a delivery's Standard Webhooks signature and return the typed event.
 * Throws {@link WebhookVerificationError} on a bad signature or a timestamp more
 * than five minutes off — answer those with a 400 and do nothing else.
 */
export function verifyWebhook({ payload, headers, secret }: VerifyWebhookInput): WebhookEvent {
  const flat: Record<string, string> = {};
  if (headers instanceof Headers) {
    headers.forEach((value, key) => (flat[key.toLowerCase()] = value));
  } else {
    for (const [key, value] of Object.entries(headers)) {
      if (value !== undefined) flat[key.toLowerCase()] = Array.isArray(value) ? value.join(",") : value;
    }
  }
  const body = typeof payload === "string" ? payload : new TextDecoder().decode(payload);
  return new Webhook(secret).verify(body, flat) as WebhookEvent;
}

// ── The client ─────────────────────────────────────────────────────────────

function resources(options: ClientOptions) {
  const http = createOpenApiClient<paths>({
    baseUrl: resolveBaseUrl(options.baseUrl),
    fetch: createTransport({
      apiKey: resolveApiKey(options.apiKey),
      version: VERSION,
      maxRetries: options.maxRetries ?? DEFAULT_MAX_RETRIES,
      timeoutMs: options.timeout ?? DEFAULT_TIMEOUT_MS,
      fetch: options.fetch,
    }),
  });

  const emailsList = (query?: Query<"/api/v1/emails", "get">, o?: RequestOptions) =>
    run(http.GET("/api/v1/emails", { params: { query }, ...init(o) }));
  const contactsList = (query?: Query<"/api/v1/contacts", "get">, o?: RequestOptions) =>
    run(http.GET("/api/v1/contacts", { params: { query }, ...init(o) }));
  const suppressionsList = (query?: Query<"/api/v1/suppressions", "get">, o?: RequestOptions) =>
    run(http.GET("/api/v1/suppressions", { params: { query }, ...init(o) }));
  const contactEvents = (
    id: string,
    query?: Query<"/api/v1/contacts/{id}/events", "get">,
    o?: RequestOptions
  ) => run(http.GET("/api/v1/contacts/{id}/events", { params: { path: { id }, query }, ...init(o) }));
  const automationRuns = (
    id: string,
    query?: Query<"/api/v1/automations/{id}/runs", "get">,
    o?: RequestOptions
  ) => run(http.GET("/api/v1/automations/{id}/runs", { params: { path: { id }, query }, ...init(o) }));
  const webhookDeliveries = (
    id: string,
    query?: Query<"/api/v1/webhooks/{id}/deliveries", "get">,
    o?: RequestOptions
  ) =>
    run(http.GET("/api/v1/webhooks/{id}/deliveries", { params: { path: { id }, query }, ...init(o) }));

  return {
    /** The underlying openapi-fetch client — every path, fully typed, no facade. */
    http,

    emails: {
      /**
       * Queue one email from a published template. Answers `202` with the
       * message id; delivery outcomes arrive by webhook. Needs `write` **and**
       * the send grant.
       */
      send: (body: Body<"/api/v1/emails", "post">, o?: RequestOptions) =>
        run(http.POST("/api/v1/emails", { body, ...init(o) })),
      /** A message's status and event timeline. */
      get: (id: string, o?: RequestOptions) =>
        run(http.GET("/api/v1/emails/{id}", { params: { path: { id } }, ...init(o) })),
      /** Sent messages, newest first. `.iterate()` walks every page. */
      list: Object.assign(emailsList, {
        iterate: (query?: Omit<Query<"/api/v1/emails", "get">, "cursor" | "before">, o?: RequestOptions) =>
          walk((cursor) => emailsList({ ...query, cursor }, o)),
      }),
      /** Move a still-scheduled send. Needs the send grant. */
      reschedule: (id: string, body: Body<"/api/v1/emails/{id}", "patch">, o?: RequestOptions) =>
        run(http.PATCH("/api/v1/emails/{id}", { params: { path: { id } }, body, ...init(o) })),
      /** Cancel a still-scheduled send. */
      cancel: (id: string, o?: RequestOptions) =>
        run(http.DELETE("/api/v1/emails/{id}", { params: { path: { id } }, ...init(o) })),
      batch: {
        /**
         * Up to 100 distinct emails in one call. Entries succeed and fail
         * independently — read `data[i]`, not the status code.
         */
        send: (body: Body<"/api/v1/emails/batch", "post">, o?: RequestOptions) =>
          run(http.POST("/api/v1/emails/batch", { body, ...init(o) })),
      },
    },

    contacts: {
      /** Create or update a contact by email; attributes shallow-merge. */
      upsert: (body: Body<"/api/v1/contacts", "post">, o?: RequestOptions) =>
        run(http.POST("/api/v1/contacts", { body, ...init(o) })),
      list: Object.assign(contactsList, {
        iterate: (query?: Omit<Query<"/api/v1/contacts", "get">, "cursor" | "before">, o?: RequestOptions) =>
          walk((cursor) => contactsList({ ...query, cursor }, o)),
      }),
      get: (id: string, o?: RequestOptions) =>
        run(http.GET("/api/v1/contacts/{id}", { params: { path: { id } }, ...init(o) })),
      /** Hard-delete. Does not suppress — add a suppression if they asked not to be emailed. */
      delete: (id: string, o?: RequestOptions) =>
        run(http.DELETE("/api/v1/contacts/{id}", { params: { path: { id } }, ...init(o) })),
      /** Bulk upsert, up to 1000 per call. Partial success — check `failed`. */
      import: (body: Body<"/api/v1/contacts/import", "post">, o?: RequestOptions) =>
        run(http.POST("/api/v1/contacts/import", { body, ...init(o) })),
      /** A contact's event timeline — the first place to look when an automation did not fire. */
      events: Object.assign(contactEvents, {
        iterate: (id: string, query?: Omit<Query<"/api/v1/contacts/{id}/events", "get">, "cursor">, o?: RequestOptions) =>
          walk((cursor) => contactEvents(id, { ...query, cursor }, o)),
      }),
    },

    events: {
      /** Record a contact event; matching automations enrol in the background. */
      emit: (body: Body<"/api/v1/events", "post">, o?: RequestOptions) =>
        run(http.POST("/api/v1/events", { body, ...init(o) })),
    },

    suppressions: {
      list: Object.assign(suppressionsList, {
        iterate: (query?: Omit<Query<"/api/v1/suppressions", "get">, "cursor">, o?: RequestOptions) =>
          walk((cursor) => suppressionsList({ ...query, cursor }, o)),
      }),
      add: (body: Body<"/api/v1/suppressions", "post">, o?: RequestOptions) =>
        run(http.POST("/api/v1/suppressions", { body, ...init(o) })),
      /** Complaint suppressions are permanent and refuse removal. */
      remove: (email: string, o?: RequestOptions) =>
        run(http.DELETE("/api/v1/suppressions", { params: { query: { email } }, ...init(o) })),
      /** Bulk-import existing unsubscribes — ideally before the first send. */
      import: (body: Body<"/api/v1/suppressions/import", "post">, o?: RequestOptions) =>
        run(http.POST("/api/v1/suppressions/import", { body, ...init(o) })),
    },

    /**
     * Template authoring: create → render → test → publish. Drafts cannot send
     * and published versions are immutable, so every edit is a new draft.
     */
    templates: {
      create: (body: Body<"/api/v1/templates", "post">, o?: RequestOptions) =>
        run(http.POST("/api/v1/templates", { body, ...init(o) })),
      list: (o?: RequestOptions) => run(http.GET("/api/v1/templates", { ...init(o) })),
      get: (slug: string, version?: number, o?: RequestOptions) =>
        run(
          http.GET("/api/v1/templates/{slug}", {
            params: { path: { slug }, query: version === undefined ? undefined : { version } },
            ...init(o),
          })
        ),
      /** A NEW draft version — never changes what is sending now. */
      update: (slug: string, body: Body<"/api/v1/templates/{slug}", "patch">, o?: RequestOptions) =>
        run(http.PATCH("/api/v1/templates/{slug}", { params: { path: { slug } }, body, ...init(o) })),
      archive: (slug: string, o?: RequestOptions) =>
        run(http.DELETE("/api/v1/templates/{slug}", { params: { path: { slug } }, ...init(o) })),
      /** Subject, preview text, sender — auto-published when the template is live. */
      updateMeta: (slug: string, body: Body<"/api/v1/templates/{slug}/meta", "patch">, o?: RequestOptions) =>
        run(http.PATCH("/api/v1/templates/{slug}/meta", { params: { path: { slug } }, body, ...init(o) })),
      listVersions: (slug: string, o?: RequestOptions) =>
        run(http.GET("/api/v1/templates/{slug}/versions", { params: { path: { slug } }, ...init(o) })),
      publish: (slug: string, body: Body<"/api/v1/templates/{slug}/versions", "post"> = {}, o?: RequestOptions) =>
        run(http.POST("/api/v1/templates/{slug}/versions", { params: { path: { slug } }, body, ...init(o) })),
      /** Take a live template out of service; sends refuse until you publish again. */
      unpublish: (slug: string, o?: RequestOptions) =>
        run(http.DELETE("/api/v1/templates/{slug}/versions", { params: { path: { slug } }, ...init(o) })),
      /** Compile and render with no side effects. Errors carry the diagnostics. */
      render: (slug: string, body: Body<"/api/v1/templates/{slug}/render", "post"> = {}, o?: RequestOptions) =>
        run(http.POST("/api/v1/templates/{slug}/render", { params: { path: { slug } }, body, ...init(o) })),
      /** Send a `[TEST]` copy — works on drafts. Needs the send grant. */
      test: (slug: string, body: Body<"/api/v1/templates/{slug}/test", "post">, o?: RequestOptions) =>
        run(http.POST("/api/v1/templates/{slug}/test", { params: { path: { slug } }, body, ...init(o) })),
      addTranslation: (
        slug: string,
        body: Body<"/api/v1/templates/{slug}/translations", "post">,
        o?: RequestOptions
      ) =>
        run(http.POST("/api/v1/templates/{slug}/translations", { params: { path: { slug } }, body, ...init(o) })),
    },

    /**
     * Event-triggered automations. `id` is an automation id or its exact name.
     * Always created paused — `setStatus` is the only call that starts sending.
     */
    automations: {
      create: (body: Body<"/api/v1/automations", "post">, o?: RequestOptions) =>
        run(http.POST("/api/v1/automations", { body, ...init(o) })),
      list: (o?: RequestOptions) => run(http.GET("/api/v1/automations", { ...init(o) })),
      get: (id: string, o?: RequestOptions) =>
        run(http.GET("/api/v1/automations/{id}", { params: { path: { id } }, ...init(o) })),
      update: (id: string, body: Body<"/api/v1/automations/{id}", "patch">, o?: RequestOptions) =>
        run(http.PATCH("/api/v1/automations/{id}", { params: { path: { id } }, body, ...init(o) })),
      archive: (id: string, o?: RequestOptions) =>
        run(http.DELETE("/api/v1/automations/{id}", { params: { path: { id } }, ...init(o) })),
      /** Activating requires `{ status: "active", confirm: true }`. */
      setStatus: (id: string, body: Body<"/api/v1/automations/{id}/status", "post">, o?: RequestOptions) =>
        run(http.POST("/api/v1/automations/{id}/status", { params: { path: { id } }, body, ...init(o) })),
      duplicate: (id: string, o?: RequestOptions) =>
        run(http.POST("/api/v1/automations/{id}/duplicate", { params: { path: { id } }, ...init(o) })),
      /** Enrol contacts whose trigger event arrived before the automation went live. */
      backfill: (id: string, body: Body<"/api/v1/automations/{id}/backfill", "post">, o?: RequestOptions) =>
        run(http.POST("/api/v1/automations/{id}/backfill", { params: { path: { id } }, body, ...init(o) })),
      /** Dry run of everything activation validates. */
      preflight: (id: string, o?: RequestOptions) =>
        run(http.GET("/api/v1/automations/{id}/preflight", { params: { path: { id } }, ...init(o) })),
      runs: Object.assign(automationRuns, {
        iterate: (id: string, query?: Omit<Query<"/api/v1/automations/{id}/runs", "get">, "cursor">, o?: RequestOptions) =>
          walk((cursor) => automationRuns(id, { ...query, cursor }, o)),
      }),
      metrics: (id: string, query?: Query<"/api/v1/automations/{id}/metrics", "get">, o?: RequestOptions) =>
        run(http.GET("/api/v1/automations/{id}/metrics", { params: { path: { id }, query }, ...init(o) })),
      setAbTest: (id: string, body: Body<"/api/v1/automations/{id}/ab-test", "post">, o?: RequestOptions) =>
        run(http.POST("/api/v1/automations/{id}/ab-test", { params: { path: { id } }, body, ...init(o) })),
      promoteAbWinner: (id: string, body: Body<"/api/v1/automations/{id}/ab-test", "patch">, o?: RequestOptions) =>
        run(http.PATCH("/api/v1/automations/{id}/ab-test", { params: { path: { id } }, body, ...init(o) })),
      /** Step editing. Appending is safe on a live automation; inserting is not. */
      steps: {
        add: (body: Body<"/api/v1/automations/steps", "post">, o?: RequestOptions) =>
          run(http.POST("/api/v1/automations/steps", { body, ...init(o) })),
        update: (body: Body<"/api/v1/automations/steps", "put">, o?: RequestOptions) =>
          run(http.PUT("/api/v1/automations/steps", { body, ...init(o) })),
        remove: (body: Body<"/api/v1/automations/steps", "delete">, o?: RequestOptions) =>
          run(http.DELETE("/api/v1/automations/steps", { body, ...init(o) })),
        move: (body: Body<"/api/v1/automations/steps/move", "post">, o?: RequestOptions) =>
          run(http.POST("/api/v1/automations/steps/move", { body, ...init(o) })),
        /** Bulk-refresh props overrides across send steps. */
        syncProps: (body: Body<"/api/v1/automations/steps", "patch">, o?: RequestOptions) =>
          run(http.PATCH("/api/v1/automations/steps", { body, ...init(o) })),
      },
    },

    segments: {
      create: (body: Body<"/api/v1/segments", "post">, o?: RequestOptions) =>
        run(http.POST("/api/v1/segments", { body, ...init(o) })),
      list: (o?: RequestOptions) => run(http.GET("/api/v1/segments", { ...init(o) })),
      update: (id: string, body: Body<"/api/v1/segments/{id}", "patch">, o?: RequestOptions) =>
        run(http.PATCH("/api/v1/segments/{id}", { params: { path: { id } }, body, ...init(o) })),
      delete: (id: string, o?: RequestOptions) =>
        run(http.DELETE("/api/v1/segments/{id}", { params: { path: { id } }, ...init(o) })),
      refreshCount: (id: string, o?: RequestOptions) =>
        run(http.POST("/api/v1/segments/{id}/refresh", { params: { path: { id } }, ...init(o) })),
    },

    /** Sending domains. `admin` scope. */
    domains: {
      /** Returns the DNS records to publish. */
      create: (body: Body<"/api/v1/domains", "post">, o?: RequestOptions) =>
        run(http.POST("/api/v1/domains", { body, ...init(o) })),
      list: (o?: RequestOptions) => run(http.GET("/api/v1/domains", { ...init(o) })),
      /** Poll after publishing DNS — `verified: false` just means not yet. */
      verify: (domain: string, o?: RequestOptions) =>
        run(http.POST("/api/v1/domains/{domain}/verify", { params: { path: { domain } }, ...init(o) })),
      delete: (domain: string, o?: RequestOptions) =>
        run(http.DELETE("/api/v1/domains/{domain}", { params: { path: { domain } }, ...init(o) })),
    },

    /** Sender identities. `admin` scope. */
    senders: {
      create: (body: Body<"/api/v1/senders", "post">, o?: RequestOptions) =>
        run(http.POST("/api/v1/senders", { body, ...init(o) })),
      list: (o?: RequestOptions) => run(http.GET("/api/v1/senders", { ...init(o) })),
      update: (id: string, body: Body<"/api/v1/senders/{id}", "patch">, o?: RequestOptions) =>
        run(http.PATCH("/api/v1/senders/{id}", { params: { path: { id } }, body, ...init(o) })),
      delete: (id: string, o?: RequestOptions) =>
        run(http.DELETE("/api/v1/senders/{id}", { params: { path: { id } }, ...init(o) })),
    },

    /** Endpoints that receive email events, and their delivery history. `admin` scope. */
    webhooks: {
      /** The response carries the signing `secret` exactly once — store it. */
      create: (body: Body<"/api/v1/webhooks", "post">, o?: RequestOptions) =>
        run(http.POST("/api/v1/webhooks", { body, ...init(o) })),
      list: (o?: RequestOptions) => run(http.GET("/api/v1/webhooks", { ...init(o) })),
      get: (id: string, o?: RequestOptions) =>
        run(http.GET("/api/v1/webhooks/{id}", { params: { path: { id } }, ...init(o) })),
      update: (id: string, body: Body<"/api/v1/webhooks/{id}", "patch">, o?: RequestOptions) =>
        run(http.PATCH("/api/v1/webhooks/{id}", { params: { path: { id } }, body, ...init(o) })),
      delete: (id: string, o?: RequestOptions) =>
        run(http.DELETE("/api/v1/webhooks/{id}", { params: { path: { id } }, ...init(o) })),
      /** Mint a new secret; the old one keeps verifying for the grace window. */
      rotateSecret: (
        id: string,
        body: Body<"/api/v1/webhooks/{id}/rotate-secret", "post"> = {},
        o?: RequestOptions
      ) => run(http.POST("/api/v1/webhooks/{id}/rotate-secret", { params: { path: { id } }, body, ...init(o) })),
      /** Queue a signed `webhook.test` delivery. */
      test: (id: string, o?: RequestOptions) =>
        run(http.POST("/api/v1/webhooks/{id}/test", { params: { path: { id } }, ...init(o) })),
      deliveries: {
        list: Object.assign(webhookDeliveries, {
          iterate: (
            id: string,
            query?: Omit<Query<"/api/v1/webhooks/{id}/deliveries", "get">, "cursor" | "before">,
            o?: RequestOptions
          ) => walk((cursor) => webhookDeliveries(id, { ...query, cursor }, o)),
        }),
        /** Re-send a past delivery with the same payload and `webhook-id`. */
        replay: (id: string, deliveryId: string, o?: RequestOptions) =>
          run(
            http.POST("/api/v1/webhooks/{id}/deliveries/{deliveryId}/replay", {
              params: { path: { id, deliveryId } },
              ...init(o),
            })
          ),
      },
      /** Verify a delivery's signature and return the typed event. Throws on a bad one. */
      verify: verifyWebhook,
    },

    /** Delivery funnel, daily trends and queue health. */
    metrics: {
      get: (query?: Query<"/api/v1/metrics", "get">, o?: RequestOptions) =>
        run(http.GET("/api/v1/metrics", { params: { query }, ...init(o) })),
      trends: (query?: Query<"/api/v1/metrics/trends", "get">, o?: RequestOptions) =>
        run(http.GET("/api/v1/metrics/trends", { params: { query }, ...init(o) })),
      /** A rising backlog means mail is late. Worth alerting on. */
      queueHealth: (o?: RequestOptions) => run(http.GET("/api/v1/queue/health", { ...init(o) })),
    },

    /** Project guardrails and the brand kit. `admin` scope. */
    settings: {
      get: (o?: RequestOptions) => run(http.GET("/api/v1/settings", { ...init(o) })),
      /** Pausing requires `{ sends_paused: true, confirm: true }`. */
      update: (body: Body<"/api/v1/settings", "patch">, o?: RequestOptions) =>
        run(http.PATCH("/api/v1/settings", { body, ...init(o) })),
      getBrand: (o?: RequestOptions) => run(http.GET("/api/v1/brand", { ...init(o) })),
      updateBrand: (body: Body<"/api/v1/brand", "patch">, o?: RequestOptions) =>
        run(http.PATCH("/api/v1/brand", { body, ...init(o) })),
    },

    /** Onboarding state and the provider connection. */
    setup: {
      /** How far through setup this project is. The one `read`-scope call. */
      onboarding: (o?: RequestOptions) => run(http.GET("/api/v1/setup/onboarding", { ...init(o) })),
      /** "Can this project send right now?" in one call. */
      connection: (o?: RequestOptions) => run(http.GET("/api/v1/connection", { ...init(o) })),
      /** Point the delivery provider's event webhook at us. Idempotent. */
      registerProviderWebhook: (o?: RequestOptions) =>
        run(http.POST("/api/v1/setup/provider-webhook", { ...init(o) })),
      /** @deprecated Use {@link registerProviderWebhook}. Sunsets 2027-02-10. */
      registerWebhooks: (o?: RequestOptions) => run(http.POST("/api/v1/webhooks/register", { ...init(o) })),
    },
  };
}

type Resources = ReturnType<typeof resources>;

// Declaration merging: the instance carries every resource, typed.
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface SendAndRetain extends Resources {}

/**
 * The Send & Retain client.
 *
 * ```ts
 * const sendandretain = new SendAndRetain(); // reads SENDANDRETAIN_API_KEY
 * const { data, error } = await sendandretain.emails.send({
 *   to: "jane@acme.com",
 *   template: "welcome",
 * });
 * if (error) console.error(error.code, error.request_id);
 * ```
 *
 * Methods never throw for an API or network failure: they resolve to
 * `{ data, error, headers }`. The constructor throws only on a missing or
 * malformed key.
 */
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export class SendAndRetain {
  constructor(apiKeyOrOptions?: string | ClientOptions, options: ClientOptions = {}) {
    const resolved =
      typeof apiKeyOrOptions === "string" ? { ...options, apiKey: apiKeyOrOptions } : (apiKeyOrOptions ?? options);
    Object.assign(this, resources(resolved));
  }
}

/** Functional alias for `new SendAndRetain(options)`. */
export function createClient(options: ClientOptions = {}): SendAndRetain {
  return new SendAndRetain(options);
}

export { DEFAULT_BASE_URL, DEFAULT_MAX_RETRIES, DEFAULT_TIMEOUT_MS, rateLimit, requestId, suggestedAction } from "./runtime.js";
export type { ListPage, RateLimit } from "./runtime.js";
export type { components, operations, paths, webhooks } from "./schema.js";
