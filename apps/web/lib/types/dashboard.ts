export type DashboardSummaryMetrics = {
  steps?: number;
  sleepMinutes?: number;
  screenTimeMinutes?: number;
  spendingTotal?: number;
};

export type DashboardSummary = {
  story: string;
  highlights: string[];
  sourcesUsed?: string[];
  metrics?: DashboardSummaryMetrics;
  generatedAt: number;
} | null;

export type DashboardDay = {
  rating?: number;
  manualNotes?: string[];
  peopleTags?: string[];
} | null;

export type DashboardIntegrationSource = {
  provider: string;
  dayKey: string;
  syncedAt: number;
  summary?: string;
  signals?: string[];
};

export type GenerateSummaryForDayResult = {
  success: boolean;
  message?: string;
};
