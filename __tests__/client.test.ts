import { readFileSync } from "node:fs";

import { Webhook } from "standardwebhooks";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createClient,
  DEFAULT_BASE_URL,
  SendAndRetain,
  VERSION,
  WebhookVerificationError,
  verifyWebhook,
} from "../src/index.js";

/**
 * A scripted `fetch`. Each call takes the next response off the queue (the
 * last one repeats), and every `Request` the transport built is recorded, so
 * tests assert on exactly what went over the wire — no network, no mocks.
 */
function scripted(...responses: Array<() => Response | Promise<Response>>) {
  const calls: Request[] = [];
  const fake = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(new Request(input, init));
    const next = responses[Math.min(calls.length - 1, responses.length - 1)]!;
    return next();
  }) as typeof fetch;
  return { calls, fetch: fake };
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

const API_KEY = "aem_live_abc123";
const client = (fetchImpl: typeof globalThis.fetch, extra: Record<string, unknown> = {}) =>
  new SendAndRetain({ apiKey: API_KEY, fetch: fetchImpl, ...extra });

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("construction", () => {
  it("reads the key from SENDANDRETAIN_API_KEY", async () => {
    vi.stubEnv("SENDANDRETAIN_API_KEY", API_KEY);
    const { calls, fetch } = scripted(() => json({ object: "list", data: [] }));
    await new SendAndRetain({ fetch }).templates.list();
    expect(calls[0]!.headers.get("authorization")).toBe(`Bearer ${API_KEY}`);
  });

  it("accepts the key as the first argument, like other SDKs", async () => {
    const { calls, fetch } = scripted(() => json({}));
    await new SendAndRetain(API_KEY, { fetch }).settings.get();
    expect(calls[0]!.headers.get("authorization")).toBe(`Bearer ${API_KEY}`);
  });

  it("throws only for a missing or malformed key", () => {
    vi.stubEnv("SENDANDRETAIN_API_KEY", "");
    expect(() => new SendAndRetain()).toThrow(/SENDANDRETAIN_API_KEY/);
    expect(() => new SendAndRetain("sk_live_wrong")).toThrow(/aem_/);
  });

  it("keeps createClient as an alias", () => {
    expect(createClient({ apiKey: API_KEY })).toBeInstanceOf(SendAndRetain);
  });

  it("reports the package version", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    expect(VERSION).toBe(pkg.version);
  });
});

describe("request construction", () => {
  it("defaults to production and identifies itself", async () => {
    const { calls, fetch } = scripted(() => json({ id: "msg_1", status: "queued" }, 202));
    await client(fetch).emails.send({ to: "jane@acme.com", template: "welcome" });

    const req = calls[0]!;
    expect(DEFAULT_BASE_URL).toBe("https://sendandretain.com");
    expect(req.url).toBe("https://sendandretain.com/api/v1/emails");
    expect(req.method).toBe("POST");
    expect(req.headers.get("user-agent")).toBe(`sendandretain-node:${VERSION}`);
    await expect(req.json()).resolves.toEqual({ to: "jane@acme.com", template: "welcome" });
  });

  it("honours baseUrl and SENDANDRETAIN_BASE_URL", async () => {
    const a = scripted(() => json({}));
    await client(a.fetch, { baseUrl: "http://localhost:3000/" }).settings.get();
    expect(a.calls[0]!.url).toBe("http://localhost:3000/api/v1/settings");

    vi.stubEnv("SENDANDRETAIN_BASE_URL", "https://staging.example.test");
    const b = scripted(() => json({}));
    await client(b.fetch).settings.get();
    expect(b.calls[0]!.url).toBe("https://staging.example.test/api/v1/settings");
  });

  it("uses the caller's Idempotency-Key, and generates one for every POST otherwise", async () => {
    const { calls, fetch } = scripted(() => json({ id: "msg_1", status: "queued" }, 202));
    const c = client(fetch);
    await c.emails.send({ to: "a@x.com", template: "t" }, { idempotencyKey: "welcome/42" });
    await c.emails.send({ to: "a@x.com", template: "t" });
    await c.templates.list();

    expect(calls[0]!.headers.get("idempotency-key")).toBe("welcome/42");
    expect(calls[1]!.headers.get("idempotency-key")).toMatch(/[0-9a-f-]{36}/);
    expect(calls[2]!.headers.get("idempotency-key")).toBeNull();
  });

  it("does not invent a key when retries are off", async () => {
    const { calls, fetch } = scripted(() => json({}, 202));
    await client(fetch, { maxRetries: 0 }).emails.send({ to: "a@x.com", template: "t" });
    expect(calls[0]!.headers.get("idempotency-key")).toBeNull();
  });

  it("refuses an over-long key before any request", () => {
    const { fetch } = scripted(() => json({}));
    expect(() =>
      client(fetch).emails.send({ to: "a@x.com", template: "t" }, { idempotencyKey: "x".repeat(257) })
    ).toThrow(/256/);
  });

  it("encodes path params and serialises queries", async () => {
    const { calls, fetch } = scripted(() => json({ object: "list", data: [], has_more: false, next_cursor: null }));
    const c = client(fetch);
    await c.templates.get("a/b c");
    await c.emails.list({ status: "bounced", limit: 10 });
    await c.suppressions.remove("jane@acme.com");

    expect(calls[0]!.url).toBe("https://sendandretain.com/api/v1/templates/a%2Fb%20c");
    expect(calls[1]!.url).toBe("https://sendandretain.com/api/v1/emails?status=bounced&limit=10");
    expect(calls[2]!.url).toBe("https://sendandretain.com/api/v1/suppressions?email=jane%40acme.com");
    expect(calls[2]!.method).toBe("DELETE");
  });

  it("passes caller headers through", async () => {
    const { calls, fetch } = scripted(() => json({}));
    await client(fetch).settings.get({ headers: { "X-Request-Id": "trace-1" } });
    expect(calls[0]!.headers.get("x-request-id")).toBe("trace-1");
  });
});

describe("results", () => {
  it("resolves success to { data, error: null, headers }", async () => {
    const { fetch } = scripted(() => json({ id: "msg_1", status: "queued" }, 202, { "X-Request-Id": "req_1" }));
    const res = await client(fetch).emails.send({ to: "a@x.com", template: "t" });
    expect(res.error).toBeNull();
    expect(res.data).toEqual({ id: "msg_1", status: "queued" });
    expect(res.headers?.get("X-Request-Id")).toBe("req_1");
  });

  it("resolves an API error to a flat error with code, status and request_id — never throws", async () => {
    const { fetch } = scripted(() =>
      json({ error: { code: "not_found", message: "No template.", request_id: "req_9" } }, 404)
    );
    const res = await client(fetch).templates.get("nope");
    expect(res.data).toBeNull();
    expect(res.error).toEqual({ code: "not_found", message: "No template.", status: 404, request_id: "req_9" });
  });

  it("keeps extra error fields (required_scope on a 403)", async () => {
    const { fetch } = scripted(() =>
      json({ error: { code: "forbidden", message: "Needs admin.", required_scope: "admin", key_scope: "write" } }, 403)
    );
    const res = await client(fetch).settings.get();
    expect(res.error).toMatchObject({ code: "forbidden", status: 403, required_scope: "admin" });
  });

  it("resolves a network failure to network_error", async () => {
    const fetch = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof globalThis.fetch;
    const res = await client(fetch, { maxRetries: 0 }).settings.get();
    expect(res.error).toMatchObject({ code: "network_error", status: null });
    expect(res.headers).toBeNull();
  });
});

describe("retries", () => {
  it("retries a 429 after Retry-After, then succeeds", async () => {
    const { calls, fetch } = scripted(
      () => json({ error: { code: "rate_limited", message: "slow down" } }, 429, { "Retry-After": "0" }),
      () => json({ ok: 1 })
    );
    const res = await client(fetch).settings.get();
    expect(calls).toHaveLength(2);
    expect(res.error).toBeNull();
  });

  it("retries a keyed POST with the SAME key, so the server can replay it", async () => {
    const { calls, fetch } = scripted(
      () => json({ error: { code: "internal", message: "x" } }, 503, { "Retry-After": "0" }),
      () => json({ id: "msg_1", status: "queued" }, 202)
    );
    await client(fetch).emails.send({ to: "a@x.com", template: "t" });
    expect(calls).toHaveLength(2);
    expect(calls[1]!.headers.get("idempotency-key")).toBe(calls[0]!.headers.get("idempotency-key"));
    await expect(calls[1]!.json()).resolves.toEqual({ to: "a@x.com", template: "t" });
  });

  it("never retries a sending quota", async () => {
    const { calls, fetch } = scripted(() =>
      json({ error: { code: "daily_cap", message: "cap" } }, 429, { "Retry-After": "0" })
    );
    const res = await client(fetch).emails.send({ to: "a@x.com", template: "t" });
    expect(calls).toHaveLength(1);
    expect(res.error?.code).toBe("daily_cap");
  });

  it("gives up after maxRetries and returns the last error", async () => {
    const { calls, fetch } = scripted(() =>
      json({ error: { code: "internal", message: "x" } }, 500, { "Retry-After": "0" })
    );
    const res = await client(fetch, { maxRetries: 3 }).settings.get();
    expect(calls).toHaveLength(4);
    expect(res.error).toMatchObject({ code: "internal", status: 500 });
  });

  it("does not retry a 4xx that retrying cannot fix", async () => {
    const { calls, fetch } = scripted(() => json({ error: { code: "invalid_request", message: "x" } }, 400));
    await client(fetch).settings.get();
    expect(calls).toHaveLength(1);
  });

  it("retries a network error on an idempotent request", async () => {
    let n = 0;
    const fetch = (async () => {
      if (n++ === 0) throw new TypeError("socket hang up");
      return json({ ok: 1 });
    }) as typeof globalThis.fetch;
    const res = await client(fetch).settings.get();
    expect(res.error).toBeNull();
    expect(n).toBe(2);
  });
});

describe("pagination", () => {
  it("walks every page through next_cursor", async () => {
    const { calls, fetch } = scripted(
      () => json({ object: "list", data: [{ id: "a" }, { id: "b" }], has_more: true, next_cursor: "c1" }),
      () => json({ object: "list", data: [{ id: "c" }], has_more: false, next_cursor: null })
    );
    const ids: string[] = [];
    for await (const email of client(fetch).emails.list.iterate({ status: "bounced" })) {
      ids.push(String(email.id));
    }
    expect(ids).toEqual(["a", "b", "c"]);
    expect(new URL(calls[1]!.url).searchParams.get("cursor")).toBe("c1");
    expect(new URL(calls[1]!.url).searchParams.get("status")).toBe("bounced");
  });

  it("pages lists under a resource too", async () => {
    const { calls, fetch } = scripted(() => json({ object: "list", data: [{ id: "d1" }], has_more: false, next_cursor: null }));
    const seen = [];
    for await (const d of client(fetch).webhooks.deliveries.list.iterate("whe_1")) seen.push(d);
    expect(seen).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://sendandretain.com/api/v1/webhooks/whe_1/deliveries");
  });

  it("throws from the iterator when a page fails", async () => {
    const { fetch } = scripted(() => json({ error: { code: "forbidden", message: "x" } }, 403));
    const walk = async () => {
      for await (const _ of client(fetch).contacts.list.iterate()) void _;
    };
    await expect(walk()).rejects.toMatchObject({ error: { code: "forbidden" } });
  });
});

describe("webhooks", () => {
  const secret = "whsec_" + Buffer.from("a-32-byte-secret-for-the-tests!!").toString("base64");
  const event = {
    id: "del_1",
    type: "email.bounced",
    version: "1",
    created_at: "2026-10-05T10:00:00.000Z",
    occurred_at: "2026-10-05T09:59:58.000Z",
    data: { event_id: "ev_1", message: null, detail: { type: "hard" } },
  };

  function signed(body: string) {
    const ts = new Date();
    const sig = new Webhook(secret).sign("del_1", ts, body);
    return {
      "webhook-id": "del_1",
      "webhook-timestamp": String(Math.floor(ts.getTime() / 1000)),
      "webhook-signature": sig,
    };
  }

  it("verifies a genuine delivery and returns the typed event", () => {
    const body = JSON.stringify(event);
    const verified = verifyWebhook({ payload: body, headers: signed(body), secret });
    expect(verified.type).toBe("email.bounced");
    expect(client(scripted(() => json({})).fetch).webhooks.verify).toBe(verifyWebhook);
  });

  it("accepts a Headers object and a Uint8Array body", () => {
    const body = JSON.stringify(event);
    const verified = verifyWebhook({
      payload: new TextEncoder().encode(body),
      headers: new Headers(signed(body)),
      secret,
    });
    expect(verified.id).toBe("del_1");
  });

  it("throws on a tampered body", () => {
    const body = JSON.stringify(event);
    const headers = signed(body);
    expect(() => verifyWebhook({ payload: body.replace("hard", "soft"), headers, secret })).toThrow(
      WebhookVerificationError
    );
  });
});

describe("coverage", () => {
  it("has a method for every operation in openapi.json", () => {
    const spec = JSON.parse(readFileSync(new URL("../openapi.json", import.meta.url), "utf8")) as {
      paths: Record<string, Record<string, unknown>>;
    };
    const src = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
    const missing: string[] = [];
    for (const [path, methods] of Object.entries(spec.paths)) {
      for (const method of Object.keys(methods)) {
        if (method === "parameters") continue;
        if (!src.includes(`http.${method.toUpperCase()}("${path}"`)) missing.push(`${method.toUpperCase()} ${path}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
