import { AuthConfig } from "convex/server";
import { convexServerEnv } from "./env";

export default {
  providers: [
    {
      // Set CLERK_JWT_ISSUER_DOMAIN on the Convex Dashboard
      // (e.g. "https://your-app.clerk.accounts.dev")
      // See https://docs.convex.dev/auth/clerk#configuring-dev-and-prod-instances
      domain: convexServerEnv.clerkJwtIssuerDomain,
      applicationID: "convex",
    },
  ],
} satisfies AuthConfig;
