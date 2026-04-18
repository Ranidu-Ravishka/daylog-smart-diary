import { AuthConfig } from "convex/server";

function readClerkIssuerDomain(): string {
  const value = process.env.CLERK_JWT_ISSUER_DOMAIN?.trim() ?? "";

  if (!value) {
    throw new Error(
      "[auth.config] CLERK_JWT_ISSUER_DOMAIN is required in Convex environment variables.",
    );
  }

  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") {
      throw new Error(
        "[auth.config] CLERK_JWT_ISSUER_DOMAIN must be an https URL.",
      );
    }
  } catch {
    throw new Error(
      "[auth.config] CLERK_JWT_ISSUER_DOMAIN must be a valid https URL.",
    );
  }

  return value;
}

const clerkJwtIssuerDomain = readClerkIssuerDomain();

export default {
  providers: [
    {
      // Set CLERK_JWT_ISSUER_DOMAIN on the Convex Dashboard
      // (e.g. "https://your-app.clerk.accounts.dev")
      // See https://docs.convex.dev/auth/clerk#configuring-dev-and-prod-instances
      domain: clerkJwtIssuerDomain,
      applicationID: "convex",
    },
  ],
} satisfies AuthConfig;
