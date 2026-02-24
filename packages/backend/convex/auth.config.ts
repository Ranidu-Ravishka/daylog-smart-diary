import { AuthConfig } from "convex/server";

export default {
  providers: [
    {
      // Set CLERK_JWT_ISSUER_DOMAIN on the Convex Dashboard
      // (e.g. "https://your-app.clerk.accounts.dev")
      // See https://docs.convex.dev/auth/clerk#configuring-dev-and-prod-instances
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN!,
      applicationID: "convex",
    },
  ],
} satisfies AuthConfig;
