import { describe, expect, it } from "vitest";
import {
  asIntegrationProvider,
  asOAuthRefreshProvider,
  assertDailyDataProvider,
  assertIntegrationProvider,
} from "./integrationProviders";

describe("assertIntegrationProvider", () => {
  it("normalizes supported integration providers", () => {
    expect(assertIntegrationProvider("  GOOGLE_FIT  ")).toBe("google_fit");
    expect(assertIntegrationProvider("spotify")).toBe("spotify");
  });

  it("rejects unsupported providers with a clear error", () => {
    expect(() => assertIntegrationProvider("location")).toThrow(
      /Unsupported integration provider/,
    );
  });
});

describe("assertDailyDataProvider", () => {
  it("accepts contextual daily-data providers", () => {
    expect(assertDailyDataProvider(" location ")).toBe("location");
  });

  it("rejects unknown daily-data providers", () => {
    expect(() => assertDailyDataProvider("calendar")).toThrow(
      /Unsupported daily data provider/,
    );
  });
});

describe("provider parsing helpers", () => {
  it("parses integration providers and rejects contextual-only ones", () => {
    expect(asIntegrationProvider("google_calendar")).toBe("google_calendar");
    expect(asIntegrationProvider("location")).toBeNull();
  });

  it("parses oauth-refresh providers", () => {
    expect(asOAuthRefreshProvider("spotify")).toBe("spotify");
    expect(asOAuthRefreshProvider("apple_health")).toBeNull();
  });
});
