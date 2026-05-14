import { describe, expect, it } from "vitest";
import { createRouteMatcher } from "@clerk/nextjs/server";
import { NextRequest } from "next/server";

import { webProxyPublicRoutePatterns } from "./web-proxy-public-routes";

const isPublicRoute = createRouteMatcher([...webProxyPublicRoutePatterns]);

function req(pathname: string): NextRequest {
  return new NextRequest(new URL(pathname, "https://app.daylog.test"));
}

describe("web proxy public routes", () => {
  it("allows OAuth start without depending on Clerk (mobile handoff path)", () => {
    expect(isPublicRoute(req("/api/integrations/oauth/google/start"))).toBe(
      true,
    );
    expect(isPublicRoute(req("/api/integrations/oauth/spotify/start"))).toBe(
      true,
    );
  });

  it("allows OAuth callback without a web Clerk session (mobile handoff path)", () => {
    expect(isPublicRoute(req("/api/integrations/oauth/google/callback"))).toBe(
      true,
    );
    expect(
      isPublicRoute(
        req("/api/integrations/oauth/google/callback?code=x&state=y"),
      ),
    ).toBe(true);
  });

  it("still protects dashboard and unrelated API routes", () => {
    expect(isPublicRoute(req("/dashboard"))).toBe(false);
    expect(isPublicRoute(req("/api/observability/token"))).toBe(false);
  });

  it("keeps marketing and auth pages public", () => {
    expect(isPublicRoute(req("/"))).toBe(true);
    expect(isPublicRoute(req("/sign-in"))).toBe(true);
    expect(isPublicRoute(req("/privacy"))).toBe(true);
  });
});
