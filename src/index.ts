import createOpenApiClient from "openapi-fetch";

import type { paths } from "./schema.js";

/**
 * Every payload and return type below is derived from `paths` in the generated
 * `schema.d.ts` (itself generated from the API's OpenAPI spec), so this client
 * has no hand-maintained request/response types and cannot drift from the API.
 */
type Json<Body> = Body extends { content: { "application/json": infer T } } ? T : never;

type SendEmailBody = Json<NonNullable<paths["/api/v1/emails"]["post"]["requestBody"]>>;
type ListEmailsQuery = NonNullable<paths["/api/v1/emails"]["get"]["parameters"]["query"]>;
type RescheduleEmailBody = Json<NonNullable<paths["/api/v1/emails/{id}"]["patch"]["requestBody"]>>;

type UpsertContactBody = Json<NonNullable<paths["/api/v1/contacts"]["post"]["requestBody"]>>;
type ListContactsQuery = NonNullable<paths["/api/v1/contacts"]["get"]["parameters"]["query"]>;

type EmitEventBody = Json<NonNullable<paths["/api/v1/events"]["post"]["requestBody"]>>;

type ListSuppressionsQuery = NonNullable<
  paths["/api/v1/suppressions"]["get"]["parameters"]["query"]
>;
type AddSuppressionBody = Json<NonNullable<paths["/api/v1/suppressions"]["post"]["requestBody"]>>;
type RemoveSuppressionQuery = paths["/api/v1/suppressions"]["delete"]["parameters"]["query"];
type ImportSuppressionsBody = Json<
  NonNullable<paths["/api/v1/suppressions/import"]["post"]["requestBody"]>
>;
type ImportContactsBody = Json<
  NonNullable<paths["/api/v1/contacts/import"]["post"]["requestBody"]>
>;

type CreateTemplateBody = Json<NonNullable<paths["/api/v1/templates"]["post"]["requestBody"]>>;
type UpdateTemplateBody = Json<
  NonNullable<paths["/api/v1/templates/{slug}"]["patch"]["requestBody"]>
>;
type UpdateTemplateMetaBody = Json<
  NonNullable<paths["/api/v1/templates/{slug}/meta"]["patch"]["requestBody"]>
>;
type PublishVersionBody = Json<
  NonNullable<paths["/api/v1/templates/{slug}/versions"]["post"]["requestBody"]>
>;
type RenderTemplateBody = Json<
  NonNullable<paths["/api/v1/templates/{slug}/render"]["post"]["requestBody"]>
>;
type TestTemplateBody = Json<
  NonNullable<paths["/api/v1/templates/{slug}/test"]["post"]["requestBody"]>
>;
type AddTranslationBody = Json<
  NonNullable<paths["/api/v1/templates/{slug}/translations"]["post"]["requestBody"]>
>;

type CreateAutomationBody = Json<NonNullable<paths["/api/v1/automations"]["post"]["requestBody"]>>;
type UpdateAutomationBody = Json<
  NonNullable<paths["/api/v1/automations/{id}"]["patch"]["requestBody"]>
>;
type SetStatusBody = Json<
  NonNullable<paths["/api/v1/automations/{id}/status"]["post"]["requestBody"]>
>;
type AddStepsBody = Json<NonNullable<paths["/api/v1/automations/steps"]["post"]["requestBody"]>>;
type UpdateStepBody = Json<NonNullable<paths["/api/v1/automations/steps"]["put"]["requestBody"]>>;
type RemoveStepBody = Json<
  NonNullable<paths["/api/v1/automations/steps"]["delete"]["requestBody"]>
>;
type MoveStepBody = Json<
  NonNullable<paths["/api/v1/automations/steps/move"]["post"]["requestBody"]>
>;
type SyncStepPropsBody = Json<
  NonNullable<paths["/api/v1/automations/steps"]["patch"]["requestBody"]>
>;
type SetAbTestBody = Json<
  NonNullable<paths["/api/v1/automations/{id}/ab-test"]["post"]["requestBody"]>
>;
type PromoteAbWinnerBody = Json<
  NonNullable<paths["/api/v1/automations/{id}/ab-test"]["patch"]["requestBody"]>
>;
type ListRunsQuery = NonNullable<
  paths["/api/v1/automations/{id}/runs"]["get"]["parameters"]["query"]
>;

type CreateDomainBody = Json<NonNullable<paths["/api/v1/domains"]["post"]["requestBody"]>>;
type CreateSenderBody = Json<NonNullable<paths["/api/v1/senders"]["post"]["requestBody"]>>;
type UpdateSenderBody = Json<NonNullable<paths["/api/v1/senders/{id}"]["patch"]["requestBody"]>>;

type CreateSegmentBody = Json<NonNullable<paths["/api/v1/segments"]["post"]["requestBody"]>>;
type UpdateSegmentBody = Json<NonNullable<paths["/api/v1/segments/{id}"]["patch"]["requestBody"]>>;

type MetricsQuery = NonNullable<paths["/api/v1/metrics"]["get"]["parameters"]["query"]>;
type TrendsQuery = NonNullable<paths["/api/v1/metrics/trends"]["get"]["parameters"]["query"]>;

type UpdateSettingsBody = Json<NonNullable<paths["/api/v1/settings"]["patch"]["requestBody"]>>;
type UpdateBrandBody = Json<NonNullable<paths["/api/v1/brand"]["patch"]["requestBody"]>>;

/**
 * Default production origin — the `servers` entry of the committed
 * `openapi.json`. Overridable per client via `baseUrl` (or the
 * `SENDANDRETAIN_BASE_URL` env var in your own code) for previews and
 * self-hosted deployments.
 */
export const DEFAULT_BASE_URL = "https://sendandretain.com";

export interface ClientOptions {
  /** A per-project API key (`aem_...`). Server-side only — never ship it to the browser. */
  apiKey: string;
  /** API origin. Defaults to {@link DEFAULT_BASE_URL}. */
  baseUrl?: string;
  /** Inject a custom fetch (tests, edge runtimes). Defaults to the global `fetch`. */
  fetch?: typeof fetch;
}

export interface SendOptions {
  /** Unique per logical send (≤256 chars). A repeat returns the original result with `deduplicated: true`. */
  idempotencyKey?: string;
}

/**
 * Create a typed client for the Send & Retain API.
 *
 * ```ts
 * const emails = createClient({ apiKey: process.env.SENDANDRETAIN_API_KEY! });
 * const { data, error } = await emails.emails.send(
 *   { to: "jane@acme.com", template: "welcome", props: { firstName: "Jane" } },
 *   { idempotencyKey: "welcome-jane-1" },
 * );
 * ```
 *
 * Every method returns openapi-fetch's `{ data, error, response }` union: on a
 * non-2xx response `error` holds the typed `{ error: { code, message } }`
 * envelope and `data` is undefined.
 */
export function createClient(opts: ClientOptions) {
  const http = createOpenApiClient<paths>({
    baseUrl: opts.baseUrl ?? DEFAULT_BASE_URL,
    fetch: opts.fetch,
    headers: { Authorization: `Bearer ${opts.apiKey}` },
  });

  return {
    /** The underlying openapi-fetch client, for endpoints not covered by the facade. */
    http,

    emails: {
      /** Send a transactional email from a published template. Needs a `write`-scope key. */
      send: (body: SendEmailBody, options?: SendOptions) =>
        http.POST("/api/v1/emails", {
          body,
          params: options?.idempotencyKey
            ? { header: { "Idempotency-Key": options.idempotencyKey } }
            : undefined,
        }),
      /** Look up a message's status + event timeline. Needs a `write`-scope key. */
      get: (id: string) => http.GET("/api/v1/emails/{id}", { params: { path: { id } } }),
      /** List messages newest-first. Needs a `write`-scope key. */
      list: (query?: ListEmailsQuery) => http.GET("/api/v1/emails", { params: { query } }),
      /** Reschedule a scheduled send. */
      reschedule: (id: string, body: RescheduleEmailBody) =>
        http.PATCH("/api/v1/emails/{id}", { params: { path: { id } }, body }),
      /** Cancel a scheduled send. */
      cancel: (id: string) => http.DELETE("/api/v1/emails/{id}", { params: { path: { id } } }),
    },

    contacts: {
      /** Create or update a contact (attributes shallow-merge). Needs a `write`-scope key. */
      upsert: (body: UpsertContactBody) => http.POST("/api/v1/contacts", { body }),
      /** List contacts. Needs a `write`-scope key. */
      list: (query?: ListContactsQuery) => http.GET("/api/v1/contacts", { params: { query } }),
      /** Get one contact + its subscription state. Needs a `write`-scope key. */
      get: (id: string) => http.GET("/api/v1/contacts/{id}", { params: { path: { id } } }),
      /** Hard-delete a contact. Needs a `write`-scope key. */
      delete: (id: string) => http.DELETE("/api/v1/contacts/{id}", { params: { path: { id } } }),
      /** Bulk upsert, up to 1000 per call. Partial success — check `failed`. */
      import: (body: ImportContactsBody) => http.POST("/api/v1/contacts/import", { body }),
      /** Event timeline — the first place to look when an automation didn't fire. */
      events: (id: string) =>
        http.GET("/api/v1/contacts/{id}/events", { params: { path: { id } } }),
    },

    events: {
      /** Emit a contact event (enrolls matching automations). Needs a `write`-scope key. */
      emit: (body: EmitEventBody) => http.POST("/api/v1/events", { body }),
    },

    suppressions: {
      /** List suppressions. Needs a `write`-scope key. */
      list: (query?: ListSuppressionsQuery) =>
        http.GET("/api/v1/suppressions", { params: { query } }),
      /** Add a manual suppression. Needs a `write`-scope key. */
      add: (body: AddSuppressionBody) => http.POST("/api/v1/suppressions", { body }),
      /** Remove a suppression (complaint suppressions are permanent). Needs a `write`-scope key. */
      remove: (query: RemoveSuppressionQuery) =>
        http.DELETE("/api/v1/suppressions", { params: { query } }),
      /** Bulk-import existing unsubscribes, ideally before your first send. */
      import: (body: ImportSuppressionsBody) => http.POST("/api/v1/suppressions/import", { body }),
    },

    /**
     * Template authoring. The loop is create → render → test → publish:
     * drafts can't send, and published versions are immutable, so every edit
     * produces a new draft you publish deliberately. All need `write` scope.
     */
    templates: {
      create: (body: CreateTemplateBody) => http.POST("/api/v1/templates", { body }),
      list: () => http.GET("/api/v1/templates"),
      get: (slug: string, version?: number) =>
        http.GET("/api/v1/templates/{slug}", {
          params: { path: { slug }, query: version === undefined ? undefined : { version } },
        }),
      /** Creates a NEW draft version — never mutates what's currently sending. */
      update: (slug: string, body: UpdateTemplateBody) =>
        http.PATCH("/api/v1/templates/{slug}", { params: { path: { slug } }, body }),
      archive: (slug: string) =>
        http.DELETE("/api/v1/templates/{slug}", { params: { path: { slug } } }),
      /** Subject / preview text / sender, auto-published if the template is live. */
      updateMeta: (slug: string, body: UpdateTemplateMetaBody) =>
        http.PATCH("/api/v1/templates/{slug}/meta", { params: { path: { slug } }, body }),
      listVersions: (slug: string) =>
        http.GET("/api/v1/templates/{slug}/versions", { params: { path: { slug } } }),
      publish: (slug: string, body?: PublishVersionBody) =>
        http.POST("/api/v1/templates/{slug}/versions", {
          params: { path: { slug } },
          body: body ?? {},
        }),
      /** Compile + render with no side effects. Errors carry the diagnostics. */
      render: (slug: string, body?: RenderTemplateBody) =>
        http.POST("/api/v1/templates/{slug}/render", {
          params: { path: { slug } },
          body: body ?? {},
        }),
      /** Send a `[TEST]` copy — works on unpublished drafts. */
      test: (slug: string, body: TestTemplateBody) =>
        http.POST("/api/v1/templates/{slug}/test", { params: { path: { slug } }, body }),
      addTranslation: (slug: string, body: AddTranslationBody) =>
        http.POST("/api/v1/templates/{slug}/translations", { params: { path: { slug } }, body }),
    },

    /**
     * Event-triggered sequences. `id` accepts an automation id or its exact
     * name. Automations are always created paused — `setStatus` is the only
     * call that starts real sending, and it requires `confirm: true`.
     */
    automations: {
      create: (body: CreateAutomationBody) => http.POST("/api/v1/automations", { body }),
      list: () => http.GET("/api/v1/automations"),
      get: (id: string) => http.GET("/api/v1/automations/{id}", { params: { path: { id } } }),
      update: (id: string, body: UpdateAutomationBody) =>
        http.PATCH("/api/v1/automations/{id}", { params: { path: { id } }, body }),
      archive: (id: string) =>
        http.DELETE("/api/v1/automations/{id}", { params: { path: { id } } }),
      /** Activating requires `{ status: "active", confirm: true }`. */
      setStatus: (id: string, body: SetStatusBody) =>
        http.POST("/api/v1/automations/{id}/status", { params: { path: { id } }, body }),
      duplicate: (id: string) =>
        http.POST("/api/v1/automations/{id}/duplicate", { params: { path: { id } } }),
      /** Read-only dry run of everything activation would validate. */
      preflight: (id: string) =>
        http.GET("/api/v1/automations/{id}/preflight", { params: { path: { id } } }),
      listRuns: (id: string, query?: ListRunsQuery) =>
        http.GET("/api/v1/automations/{id}/runs", { params: { path: { id }, query } }),
      metrics: (id: string, since?: string) =>
        http.GET("/api/v1/automations/{id}/metrics", {
          params: { path: { id }, query: since === undefined ? undefined : { since } },
        }),
      setAbTest: (id: string, body: SetAbTestBody) =>
        http.POST("/api/v1/automations/{id}/ab-test", { params: { path: { id } }, body }),
      promoteAbWinner: (id: string, body: PromoteAbWinnerBody) =>
        http.PATCH("/api/v1/automations/{id}/ab-test", { params: { path: { id } }, body }),

      /** Step editing. Steps are addressed by their `position`. */
      steps: {
        /** Appending is safe on a live automation; inserting is not. */
        add: (body: AddStepsBody) => http.POST("/api/v1/automations/steps", { body }),
        update: (body: UpdateStepBody) => http.PUT("/api/v1/automations/steps", { body }),
        remove: (body: RemoveStepBody) => http.DELETE("/api/v1/automations/steps", { body }),
        move: (body: MoveStepBody) => http.POST("/api/v1/automations/steps/move", { body }),
        /** Bulk-refresh props_overrides across send steps, by position. */
        syncProps: (body: SyncStepPropsBody) => http.PATCH("/api/v1/automations/steps", { body }),
      },
    },

    /**
     * Segments. Need `write` scope.
     *
     * There is deliberately no `topics` here. An earlier draft of this client
     * exposed `list`/`upsert`/`delete` against `/api/v1/topics`, which the API
     * does not implement — those paths appear nowhere in `openapi.json`, so
     * every call would have 404'd. Restore this block in the same change that
     * adds the routes to the spec, not before.
     */
    audience: {
      segments: {
        create: (body: CreateSegmentBody) => http.POST("/api/v1/segments", { body }),
        list: () => http.GET("/api/v1/segments"),
        update: (id: string, body: UpdateSegmentBody) =>
          http.PATCH("/api/v1/segments/{id}", { params: { path: { id } }, body }),
        delete: (id: string) => http.DELETE("/api/v1/segments/{id}", { params: { path: { id } } }),
        refreshCount: (id: string) =>
          http.POST("/api/v1/segments/{id}/refresh", { params: { path: { id } } }),
      },
    },

    /**
     * Sending infrastructure. Needs an `admin`-scope key. Provider API keys
     * can NOT be set here — they only enter through the dashboard.
     */
    setup: {
      /** One call for "can this project send right now?". */
      connection: () => http.GET("/api/v1/connection"),
      /** Idempotent; safe to call on every deploy. */
      registerWebhooks: () => http.POST("/api/v1/webhooks/register"),
      domains: {
        /** Returns the DNS records a human must publish. */
        create: (body: CreateDomainBody) => http.POST("/api/v1/domains", { body }),
        list: () => http.GET("/api/v1/domains"),
        /** Poll after publishing DNS — `verified: false` just means not yet. */
        verify: (domain: string) =>
          http.POST("/api/v1/domains/{domain}/verify", { params: { path: { domain } } }),
      },
      senders: {
        create: (body: CreateSenderBody) => http.POST("/api/v1/senders", { body }),
        list: () => http.GET("/api/v1/senders"),
        update: (id: string, body: UpdateSenderBody) =>
          http.PATCH("/api/v1/senders/{id}", { params: { path: { id } }, body }),
      },
    },

    /** Delivery funnel, daily trends, and worker-queue health. `write` scope. */
    metrics: {
      /** Exact, windowed, per-template. Defaults to the last 7 days. */
      get: (query?: MetricsQuery) => http.GET("/api/v1/metrics", { params: { query } }),
      /** Fast, coarse daily series from the rollup — for charting. */
      trends: (query?: TrendsQuery) => http.GET("/api/v1/metrics/trends", { params: { query } }),
      /** Rising backlog here means mail is late. Worth alerting on. */
      queueHealth: () => http.GET("/api/v1/queue/health"),
    },

    /** Project guardrails and brand kit. Need an `admin`-scope key. */
    settings: {
      get: () => http.GET("/api/v1/settings"),
      /** Pausing requires `{ sends_paused: true, confirm: true }`. */
      update: (body: UpdateSettingsBody) => http.PATCH("/api/v1/settings", { body }),
      getBrand: () => http.GET("/api/v1/brand"),
      updateBrand: (body: UpdateBrandBody) => http.PATCH("/api/v1/brand", { body }),
    },
  };
}

export type EmailsClient = ReturnType<typeof createClient>;

export type { paths, components, operations } from "./schema.js";
