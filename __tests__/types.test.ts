import { describe, expectTypeOf, it } from "vitest";

import { createClient, type EmailsClient } from "../src/index.js";
import type { components, paths } from "../src/index.js";

/**
 * These assertions are checked by `npm run typecheck` (this directory is in
 * tsconfig's `include`), not only by vitest — `expectTypeOf` compiles to a
 * no-op at runtime. Their job is to catch the failure mode a runtime test
 * cannot see: the facade widening to `any` because a generated `paths` entry
 * moved or disappeared, which would silently un-type every caller.
 */

/** Never let a type test touch the network — it awaits real calls. */
const offlineFetch = (async () =>
  new Response("{}", { headers: { "content-type": "application/json" } })) as typeof fetch;

const client: EmailsClient = createClient({ apiKey: "aem_test", fetch: offlineFetch });

type SendResult = components["schemas"]["SendResult"];
type ApiError = components["schemas"]["Error"];
type SendBody = NonNullable<
  paths["/api/v1/emails"]["post"]["requestBody"]
>["content"]["application/json"];

describe("generated types resolve through the facade", () => {
  it("sendEmail's request body is the spec's, not a widened record", () => {
    expectTypeOf<SendBody>().not.toBeAny();
    expectTypeOf<SendBody>().toHaveProperty("to");
    expectTypeOf<SendBody>().toHaveProperty("template");
    // `to` and `template` are required; everything else is optional.
    expectTypeOf<SendBody["to"]>().not.toBeUndefined();
    expectTypeOf<SendBody["template"]>().not.toBeUndefined();
  });

  it("sendEmail resolves to the SendResult / Error union, and status is the literal enum", async () => {
    const result = await client.emails.send({ to: "a@b.com", template: "welcome" });

    expectTypeOf(result.data).toEqualTypeOf<SendResult | undefined>();
    expectTypeOf(result.error).toEqualTypeOf<ApiError | undefined>();
    expectTypeOf(result.response).toEqualTypeOf<Response>();

    expectTypeOf<SendResult["status"]>().toEqualTypeOf<"sent" | "queued" | "scheduled">();
    expectTypeOf<SendResult["id"]>().toEqualTypeOf<string>();
  });

  it("the error envelope carries a machine-readable code", () => {
    expectTypeOf<ApiError["error"]["message"]>().toEqualTypeOf<string>();
    expectTypeOf<ApiError["error"]["code"]>().not.toBeAny();
    expectTypeOf<ApiError["error"]["code"]>().toMatchTypeOf<string>();
    expectTypeOf<"template_not_found">().toMatchTypeOf<ApiError["error"]["code"]>();
  });

  it("path-param helpers keep their argument types", () => {
    expectTypeOf(client.emails.get).parameter(0).toEqualTypeOf<string>();
    expectTypeOf(client.templates.get).parameter(0).toEqualTypeOf<string>();
    expectTypeOf(client.templates.get).parameter(1).toEqualTypeOf<number | undefined>();
  });

  it("rejects a body field the spec does not define", () => {
    // @ts-expect-error `subject_line` is not part of the send schema.
    void client.emails.send({ to: "a@b.com", template: "welcome", subject_line: "hi" });
  });

  it("rejects a missing required field", () => {
    // @ts-expect-error `template` is required.
    void client.emails.send({ to: "a@b.com" });
  });
});
