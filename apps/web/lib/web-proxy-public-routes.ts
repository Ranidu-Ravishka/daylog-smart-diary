/**
 * Public pathname patterns for `apps/web/proxy.ts` (Next.js 16 Clerk proxy).
 *
 * OAuth `/api/integrations/oauth/.../start` and `.../callback` must bypass
 * the Clerk session gate: mobile uses an embedded browser without the web
 * user's Clerk cookies, while route handlers authenticate via Clerk **or**
 * a Convex-issued `mobileHandoff` (see OAuth start/callback routes).
 */
export const webProxyPublicRoutePatterns = [
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/privacy",
  "/terms",
  "/about",
  "/contact",
  "/developers",
  "/faq",
  "/pricing",
  "/integrations/oauth/complete",
  "/api/integrations/oauth/(.*)/start",
  "/api/integrations/oauth/(.*)/callback",
] as const;
