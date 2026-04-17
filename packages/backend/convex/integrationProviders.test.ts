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
    expect(assertIntegrationProvider("notion")).toBe("notion");
    expect(assertIntegrationProvider("slack")).toBe("slack");
    expect(assertIntegrationProvider("strava")).toBe("strava");
    expect(assertIntegrationProvider("todoist")).toBe("todoist");
    expect(assertIntegrationProvider("apple_calendar")).toBe("apple_calendar");
    expect(assertIntegrationProvider("gmail_summary")).toBe("gmail_summary");
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
    expect(assertDailyDataProvider("fitness")).toBe("fitness");
    expect(assertDailyDataProvider("calendar")).toBe("calendar");
    expect(assertDailyDataProvider("activity_summary")).toBe(
      "activity_summary",
    );
  });

  it("rejects unknown daily-data providers", () => {
    expect(() => assertDailyDataProvider("unknown_provider")).toThrow(
      /Unsupported daily data provider/,
    );
  });
});

describe("provider parsing helpers", () => {
  it("parses integration providers and rejects contextual-only ones", () => {
    expect(asIntegrationProvider("google_calendar")).toBe("google_calendar");
    expect(asIntegrationProvider("notion")).toBe("notion");
    expect(asIntegrationProvider("strava")).toBe("strava");
    expect(asIntegrationProvider("location")).toBeNull();
  });

  it("parses oauth-refresh providers", () => {
    expect(asOAuthRefreshProvider("spotify")).toBe("spotify");
    expect(asOAuthRefreshProvider("gmail_summary")).toBe("gmail_summary");
    expect(asOAuthRefreshProvider("strava")).toBe("strava");
    expect(asOAuthRefreshProvider("notion")).toBeNull();
    expect(asOAuthRefreshProvider("slack")).toBeNull();
    expect(asOAuthRefreshProvider("todoist")).toBeNull();
    expect(asOAuthRefreshProvider("apple_health")).toBeNull();
  });
});
