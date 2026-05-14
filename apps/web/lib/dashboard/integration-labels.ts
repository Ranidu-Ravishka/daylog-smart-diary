import { INTEGRATION_PROVIDER_META } from "@repo/ui/lib/constants";

export function getIntegrationProviderLabelMap(): Record<string, string> {
  return {
    location: "Location (coarse foreground)",
    ...Object.fromEntries(
      Object.entries(INTEGRATION_PROVIDER_META).map(([provider, meta]) => [
        provider,
        meta.label,
      ]),
    ),
  };
}
