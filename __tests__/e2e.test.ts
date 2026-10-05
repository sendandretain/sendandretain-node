/**
 * Live smoke test against a real deployment. Skipped unless
 * SENDANDRETAIN_E2E_API_KEY is set — a separate variable from the one the SDK
 * reads, so a key in your shell never turns `npm test` into network traffic.
 * Read-only: it never sends, creates or changes anything.
 *
 *   SENDANDRETAIN_E2E_API_KEY=aem_… [SENDANDRETAIN_E2E_BASE_URL=…] npm test
 */
import { describe, expect, it } from "vitest";

import { SendAndRetain } from "../src/index.js";

const key = process.env.SENDANDRETAIN_E2E_API_KEY;

describe.skipIf(!key)("live API", () => {
  // Built lazily: a skipped describe still runs its body during collection.
  const live = () =>
    new SendAndRetain({ apiKey: key, baseUrl: process.env.SENDANDRETAIN_E2E_BASE_URL });

  it("authenticates and answers with a request id", async () => {
    const res = await live().setup.onboarding();
    expect(res.error).toBeNull();
    expect(res.headers?.get("X-Request-Id")).toBeTruthy();
  });

  it("refuses an unknown template with not_found", async () => {
    const res = await live().templates.get(`does-not-exist-${Date.now()}`);
    expect(res.error?.code).toBe("not_found");
    expect(res.error?.status).toBe(404);
  });
});
