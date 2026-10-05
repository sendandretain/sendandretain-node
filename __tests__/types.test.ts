import { describe, expectTypeOf, it } from "vitest";

import { SendAndRetain, type ApiError, type WebhookEvent } from "../src/index.js";
import type { components, paths } from "../src/index.js";

/**
 * Checked by `npm run typecheck` (this directory is in tsconfig's `include`),
 * not only by vitest — `expectTypeOf` compiles to a no-op at runtime. The job
 * is to catch the facade widening to `any` because a generated `paths` entry
 * moved, which would silently un-type every caller.
 */

const offlineFetch = (async () =>
  new Response(JSON.stringify({ object: "list", data: [], has_more: false, next_cursor: null }), {
    headers: { "content-type": "application/json" },
  })) as typeof fetch;

const client = new SendAndRetain({ apiKey: "aem_test", fetch: offlineFetch });

type SendResult = components["schemas"]["SendResult"];
type SendBody = NonNullable<paths["/api/v1/emails"]["post"]["requestBody"]>["content"]["application/json"];

describe("generated types resolve through the facade", () => {
  it("the send body is the spec's, not a widened record", () => {
    expectTypeOf<SendBody>().not.toBeAny();
    expectTypeOf<SendBody>().toHaveProperty("to");
    expectTypeOf<SendBody>().toHaveProperty("template");
  });

  it("a send resolves to SendResult | ApiError, discriminated on error", async () => {
    const result = await client.emails.send({ to: "a@b.com", template: "welcome" });
    if (result.error) {
      expectTypeOf(result.error).toEqualTypeOf<ApiError>();
      expectTypeOf(result.data).toEqualTypeOf<null>();
    } else {
      expectTypeOf(result.data).toEqualTypeOf<SendResult>();
      expectTypeOf(result.data.status).toEqualTypeOf<"sent" | "queued" | "scheduled">();
    }
  });

  it("lists carry the envelope, and iterate yields rows", async () => {
    const page = await client.contacts.list();
    if (!page.error) {
      expectTypeOf(page.data.object).toEqualTypeOf<"list">();
      expectTypeOf(page.data.next_cursor).toEqualTypeOf<string | null>();
    }
    for await (const contact of client.contacts.list.iterate()) {
      expectTypeOf(contact).not.toBeAny();
      break;
    }
  });

  it("webhook events narrow on type", () => {
    const narrow = (event: WebhookEvent) => {
      if (event.type === "email.bounced") {
        expectTypeOf(event.type).toEqualTypeOf<"email.bounced">();
      }
    };
    expectTypeOf(narrow).toBeFunction();
  });
});
