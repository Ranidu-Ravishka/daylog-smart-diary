/**
 * Convex `httpRouter` routes (convex/http.ts) are served on the deployment's
 * **.convex.site** origin. The React/Convex client uses **NEXT_PUBLIC_CONVEX_URL**,
 * which is the **.convex.cloud** URL — that host does not serve HTTP actions, so
 * calling it returns 404 for paths like `/integrations/oauth/connect`.
 *
 * @see https://docs.convex.dev/functions/http-actions
 */
export function resolveConvexHttpSiteOrigin(): string {
  const override =
    process.env.CONVEX_HTTP_SITE_URL?.trim() ||
    process.env.NEXT_PUBLIC_CONVEX_HTTP_SITE_URL?.trim();

  if (override) {
    return override.replace(/\/$/, "");
  }

  const cloud = process.env.NEXT_PUBLIC_CONVEX_URL?.trim();
  if (!cloud) {
    throw new Error("Missing NEXT_PUBLIC_CONVEX_URL");
  }

  const base = cloud.replace(/\/$/, "");

  let hostname: string;
  try {
    hostname = new URL(base).hostname;
  } catch {
    throw new Error("NEXT_PUBLIC_CONVEX_URL is not a valid URL");
  }

  if (hostname.endsWith(".convex.site")) {
    return base;
  }

  if (hostname.endsWith(".convex.cloud")) {
    return base.replace(/\.convex\.cloud$/i, ".convex.site");
  }

  // Local / custom host (e.g. tests): use as-is; set CONVEX_HTTP_SITE_URL if needed.
  return base;
}
