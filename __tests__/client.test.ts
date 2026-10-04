import { describe, expect, it } from "vitest";

import { createClient, DEFAULT_BASE_URL } from "../src/index.js";

/**
 * A recording `fetch`. openapi-fetch hands its `fetch` a fully-built `Request`,
 * so capturing that object is enough to assert on the URL, method, headers and
 * body the facade actually produced — no network, no mocking library.
 */
function recordingFetch(respond: () => Response) {
  const calls: Request[] = [];
  const fake = (async (input: RequestInfo | URL) => {
    calls.push(input as Request);
    return respond();
  }) as typeof fetch;
  return { calls, fetch: fake };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const API_KEY = "aem_live_abc123";

describe("createClient — request construction", () => {
  it("defaults to the production origin and sends the aem_ key as a bearer token", async () => {
    const { calls, fetch } = recordingFetch(() => json({ id: "msg_1", status: "sent" }));
    const client = createClient({ apiKey: API_KEY, fetch });

    await client.emails.send({ to: "jane@acme.com", template: "welcome" });

    expect(DEFAULT_BASE_URL).toBe("https://sendandretain.com");
    expect(calls).toHaveLength(1);

    const req = calls[0]!;
    expect(req.url).toBe("https://sendandretain.com/api/v1/emails");
    expect(req.method).toBe("POST");
    expect(req.headers.get("authorization")).toBe(`Bearer ${API_KEY}`);
    expect(req.headers.get("content-type")).toContain("application/json");
    await expect(req.json()).resolves.toEqual({ to: "jane@acme.com", template: "welcome" });
  });

  it("honours a custom baseUrl", async () => {
    const { calls, fetch } = recordingFetch(() => json({ id: "msg_1", status: "queued" }));
    const client = createClient({
      apiKey: API_KEY,
      baseUrl: "http://localhost:3000",
      fetch,
    });

    await client.emails.send({ to: "jane@acme.com", template: "welcome" });

    expect(calls[0]!.url).toBe("http://localhost:3000/api/v1/emails");
  });

  it("sends Idempotency-Key only when one is supplied", async () => {
    const { calls, fetch } = recordingFetch(() => json({ id: "msg_1", status: "sent" }));
    const client = createClient({ apiKey: API_KEY, fetch });

    await client.emails.send(
      { to: "jane@acme.com", template: "welcome" },
      { idempotencyKey: "welcome-jane-1" }
    );
    await client.emails.send({ to: "jane@acme.com", template: "welcome" });

    expect(calls[0]!.headers.get("idempotency-key")).toBe("welcome-jane-1");
    expect(calls[1]!.headers.get("idempotency-key")).toBeNull();
  });

  it("interpolates path params rather than appending them", async () => {
    const { calls, fetch } = recordingFetch(() => json({ id: "msg_3aF9c1", status: "sent" }));
    const client = createClient({ apiKey: API_KEY, fetch });

    await client.emails.get("msg_3aF9c1");

    expect(calls[0]!.url).toBe("https://sendandretain.com/api/v1/emails/msg_3aF9c1");
    expect(calls[0]!.method).toBe("GET");
  });

  it("URL-encodes path params instead of splicing them in raw", async () => {
    const { calls, fetch } = recordingFetch(() => json({ slug: "welcome drip" }));
    const client = createClient({ apiKey: API_KEY, fetch });

    await client.templates.get("welcome drip");

    expect(calls[0]!.url).toBe("https://sendandretain.com/api/v1/templates/welcome%20drip");
  });

  it("serialises query params, and omits the query string entirely when none are given", async () => {
    const { calls, fetch } = recordingFetch(() => json({ metrics: {} }));
    const client = createClient({ apiKey: API_KEY, fetch });

    await client.metrics.get({ since: "2026-07-01", until: "2026-07-31" });
    await client.metrics.get();

    const withQuery = new URL(calls[0]!.url);
    expect(withQuery.pathname).toBe("/api/v1/metrics");
    expect(withQuery.searchParams.get("since")).toBe("2026-07-01");
    expect(withQuery.searchParams.get("until")).toBe("2026-07-31");

    expect(calls[1]!.url).toBe("https://sendandretain.com/api/v1/metrics");
  });

  it("uses the right verb for each facade method", async () => {
    const { calls, fetch } = recordingFetch(() => json({ ok: true }));
    const client = createClient({ apiKey: API_KEY, fetch });

    await client.emails.reschedule("msg_1", { scheduled_at: "2026-08-01T09:00:00Z" });
    await client.emails.cancel("msg_1");
    await client.automations.steps.update({
      automation: "welcome",
      position: 2,
      patch: { subject: "Welcome aboard" },
    });
    await client.suppressions.remove({ email: "jane@acme.com" });

    expect(calls.map((c) => `${c.method} ${new URL(c.url).pathname}`)).toEqual([
      "PATCH /api/v1/emails/msg_1",
      "DELETE /api/v1/emails/msg_1",
      "PUT /api/v1/automations/steps",
      "DELETE /api/v1/suppressions",
    ]);
    expect(new URL(calls[3]!.url).searchParams.get("email")).toBe("jane@acme.com");
  });

  it("exposes the raw openapi-fetch client for uncovered endpoints", async () => {
    const { calls, fetch } = recordingFetch(() => json({ templates: [] }));
    const client = createClient({ apiKey: API_KEY, fetch });

    await client.http.GET("/api/v1/templates");

    expect(calls[0]!.url).toBe("https://sendandretain.com/api/v1/templates");
    expect(calls[0]!.headers.get("authorization")).toBe(`Bearer ${API_KEY}`);
  });
});

describe("createClient — response handling", () => {
  it("returns the parsed payload as `data` on success", async () => {
    const { fetch } = recordingFetch(() => json({ id: "msg_3aF9c1", status: "sent" }));
    const client = createClient({ apiKey: API_KEY, fetch });

    const { data, error, response } = await client.emails.send({
      to: "jane@acme.com",
      template: "welcome",
    });

    expect(error).toBeUndefined();
    expect(data).toEqual({ id: "msg_3aF9c1", status: "sent" });
    expect(response.status).toBe(200);
  });

  it("maps a non-2xx onto the { error: { code, message } } envelope without throwing", async () => {
    const { fetch } = recordingFetch(() =>
      json({ error: { code: "template_not_found", message: "No template 'welcome'." } }, 404)
    );
    const client = createClient({ apiKey: API_KEY, fetch });

    const { data, error, response } = await client.emails.send({
      to: "jane@acme.com",
      template: "welcome",
    });

    expect(data).toBeUndefined();
    expect(response.status).toBe(404);
    expect(error?.error.code).toBe("template_not_found");
    expect(error?.error.message).toBe("No template 'welcome'.");
  });

  it("surfaces a 403 scope rejection as an error, not a rejected promise", async () => {
    const { fetch } = recordingFetch(() =>
      json(
        {
          error: {
            code: "forbidden",
            message: "This endpoint requires 'admin' scope — this key has 'write' scope.",
          },
        },
        403
      )
    );
    const client = createClient({ apiKey: API_KEY, fetch });

    const result = await client.settings.get();

    expect(result.data).toBeUndefined();
    expect(result.response.status).toBe(403);
    expect(result.error).toBeDefined();
  });
});
