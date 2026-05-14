import { test, expect } from "@playwright/test";

/** 64-char hex string (Convex mobile handoff shape). */
const VALID_HANDOFF = `${"ab".repeat(32)}`;

test.describe("OAuth proxy + mobile handoff (HTTP)", () => {
  test("start with mobileHandoff is not redirected to /sign-in by Clerk proxy", async ({
    request,
  }) => {
    const url = `/api/integrations/oauth/google/start?returnTo=${encodeURIComponent(
      "/dashboard/settings",
    )}&mobileHandoff=${VALID_HANDOFF}`;
    const res = await request.get(url, { maxRedirects: 0 });
    expect(res.status()).toBeGreaterThanOrEqual(300);
    expect(res.status()).toBeLessThan(400);
    const loc = res.headers()["location"] ?? "";
    expect(loc, `unexpected redirect target: ${loc}`).not.toMatch(
      /\/sign-in(\/|\?|$)/,
    );
  });

  test("start without Clerk session or handoff redirects toward sign-in", async ({
    request,
  }) => {
    const res = await request.get(
      "/api/integrations/oauth/google/start?returnTo=/dashboard/settings",
      { maxRedirects: 0 },
    );
    expect(res.status()).toBeGreaterThanOrEqual(300);
    expect(res.status()).toBeLessThan(400);
    const loc = res.headers()["location"] ?? "";
    expect(loc).toMatch(/sign-in/);
  });

  test("callback route is reachable without Clerk session (handler validates state)", async ({
    request,
  }) => {
    const res = await request.get(
      "/api/integrations/oauth/google/callback?state=x&code=y",
      { maxRedirects: 0 },
    );
    expect(res.status()).toBeGreaterThanOrEqual(300);
    expect(res.status()).toBeLessThan(400);
    const loc = res.headers()["location"] ?? "";
    expect(loc).not.toMatch(/\/sign-in(\/|\?|$)/);
  });
});
