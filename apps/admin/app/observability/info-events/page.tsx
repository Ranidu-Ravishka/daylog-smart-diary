"use client";

import AdminGuard from "@/components/admin-guard";
import { api } from "@repo/backend/convex";
import { makeFunctionReference } from "convex/server";
import { useConvexAuth, usePaginatedQuery, useQuery } from "convex/react";
import Link from "next/link";
import { useMemo, useState } from "react";

type SurfaceFilter = "all" | "web" | "mobile";

type TransportHealthSlice = {
  ingestedCount: number;
  estimatedAttemptedCount: number;
  estimatedDroppedCount: number;
  estimatedDropRate: number;
  averageSampleRate: number | null;
  lastReceivedAt: number | null;
};

type TransportHealthSummary = {
  windowHours: number;
  windowStartAt: number;
  evaluatedRows: number;
  truncated: boolean;
  filters: {
    eventName: string | null;
    sourceEnvironment: string | null;
  };
  overall: TransportHealthSlice;
  bySurface: {
    web: TransportHealthSlice;
    mobile: TransportHealthSlice;
  };
  topEvents: Array<{
    event: string;
    ingestedCount: number;
    webCount: number;
    mobileCount: number;
    lastReceivedAt: number | null;
    shareOfIngested: number;
  }>;
};

type RateLimitMinuteBucket = {
  epochMinute: number;
  allowedRequests: number;
  blockedRequests: number;
  burstAttempts: number;
};

type RateLimitMetricsSummary = {
  windowMinutes: number;
  windowStartMinute: number;
  nowMinute: number;
  evaluatedRows: number;
  truncated: boolean;
  totals: {
    totalRequests: number;
    allowedRequests: number;
    blockedRequests: number;
    burstAttempts: number;
    blockedRate: number;
  };
  minuteBuckets: RateLimitMinuteBucket[];
};

type RateLimitChartBucket = {
  startEpochMinute: number;
  endEpochMinute: number;
  allowedRequests: number;
  blockedRequests: number;
  burstAttempts: number;
  totalRequests: number;
};

type InfoEventRow = {
  _id: string;
  surface: "web" | "mobile";
  event: string;
  sampleRate: number;
  sourceEnvironment?: string;
  receivedAt: number;
  emittedAt: number;
  contextJson?: string;
};

const WINDOW_OPTIONS = [1, 6, 24, 72, 168] as const;
const RATE_LIMIT_WINDOW_OPTIONS_MINUTES = [
  15, 60, 180, 360, 720, 1440,
] as const;
const RATE_LIMIT_MAX_CHART_BARS = 48;
const RATE_LIMIT_MINUTE_CSV_COLUMNS = [
  "epochMinute",
  "minuteStartIso",
  "allowedRequests",
  "blockedRequests",
  "burstAttempts",
  "totalRequests",
  "blockedRate",
] as const;
const RATE_LIMIT_CHART_CSV_COLUMNS = [
  "startEpochMinute",
  "startMinuteIso",
  "endEpochMinute",
  "endMinuteIso",
  "allowedRequests",
  "blockedRequests",
  "burstAttempts",
  "totalRequests",
  "blockedRate",
] as const;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function formatPercent(value: number): string {
  return `${(clamp01(value) * 100).toFixed(1)}%`;
}

function formatWindowMinutes(value: number): string {
  if (value % 60 === 0) {
    return `${value / 60}h`;
  }

  return `${value}m`;
}

function formatEpochMinuteIso(value: number): string {
  return new Date(value * 60_000).toISOString();
}

function csvColumnsTooltip(columns: readonly string[]): string {
  return `Columns: ${columns.join(", ")}`;
}

function toRateLimitMetricsCsv(rows: RateLimitMinuteBucket[]): string {
  const header = RATE_LIMIT_MINUTE_CSV_COLUMNS.join(",");

  const lines = rows.map((row) => {
    const totalRequests = row.allowedRequests + row.blockedRequests;
    const blockedRate =
      totalRequests > 0 ? row.blockedRequests / totalRequests : 0;

    return [
      String(row.epochMinute),
      formatEpochMinuteIso(row.epochMinute),
      String(row.allowedRequests),
      String(row.blockedRequests),
      String(row.burstAttempts),
      String(totalRequests),
      blockedRate.toFixed(6),
    ].join(",");
  });

  return [header, ...lines].join("\n");
}

function toRateLimitChartCsv(rows: RateLimitChartBucket[]): string {
  const header = RATE_LIMIT_CHART_CSV_COLUMNS.join(",");

  const lines = rows.map((row) => {
    const blockedRate =
      row.totalRequests > 0 ? row.blockedRequests / row.totalRequests : 0;

    return [
      String(row.startEpochMinute),
      formatEpochMinuteIso(row.startEpochMinute),
      String(row.endEpochMinute),
      formatEpochMinuteIso(row.endEpochMinute),
      String(row.allowedRequests),
      String(row.blockedRequests),
      String(row.burstAttempts),
      String(row.totalRequests),
      blockedRate.toFixed(6),
    ].join(",");
  });

  return [header, ...lines].join("\n");
}

function downloadCsvFile(fileNamePrefix: string, csv: string): void {
  const blob = new Blob([csv], {
    type: "text/csv;charset=utf-8;",
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const fileStamp = new Date().toISOString().replace(/[.:]/g, "-");

  link.href = url;
  link.download = `${fileNamePrefix}-${fileStamp}.csv`;

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  URL.revokeObjectURL(url);
}

function formatSampleRate(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "—";
  }

  return `${(clamp01(value) * 100).toFixed(1)}%`;
}

function formatTimestamp(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "—";
  }

  return new Date(value).toLocaleString();
}

function estimatedDropRateFromSampleRate(sampleRate: number): number {
  const normalized = clamp01(sampleRate);
  return 1 - normalized;
}

function contextPreview(contextJson: string | undefined): string {
  if (!contextJson) {
    return "—";
  }

  if (contextJson.length <= 120) {
    return contextJson;
  }

  return `${contextJson.slice(0, 117)}...`;
}

function compactRateLimitBuckets(
  minuteBuckets: RateLimitMinuteBucket[],
): RateLimitChartBucket[] {
  if (minuteBuckets.length === 0) {
    return [];
  }

  const chunkSize = Math.max(
    1,
    Math.ceil(minuteBuckets.length / RATE_LIMIT_MAX_CHART_BARS),
  );

  const compacted: RateLimitChartBucket[] = [];

  for (let index = 0; index < minuteBuckets.length; index += chunkSize) {
    const chunk = minuteBuckets.slice(index, index + chunkSize);
    if (chunk.length === 0) {
      continue;
    }

    let allowedRequests = 0;
    let blockedRequests = 0;
    let burstAttempts = 0;

    for (const row of chunk) {
      allowedRequests += row.allowedRequests;
      blockedRequests += row.blockedRequests;
      burstAttempts += row.burstAttempts;
    }

    const first = chunk[0];
    const last = chunk[chunk.length - 1];

    if (!first || !last) {
      continue;
    }

    compacted.push({
      startEpochMinute: first.epochMinute,
      endEpochMinute: last.epochMinute,
      allowedRequests,
      blockedRequests,
      burstAttempts,
      totalRequests: allowedRequests + blockedRequests,
    });
  }

  return compacted;
}

export default function ObservabilityInfoEventsPage() {
  const listInfoEventsPaginatedRef = makeFunctionReference<"query">(
    "observabilityIngestion:listObservabilityInfoEventsPaginated",
  );
  const transportHealthRef = makeFunctionReference<"query">(
    "observabilityIngestion:getObservabilityInfoTransportHealth",
  );
  const rateLimitMetricsRef = makeFunctionReference<"query">(
    "observabilityIngestion:getObservabilityIngestRateLimitMetrics",
  );

  const { isAuthenticated } = useConvexAuth();
  const [surfaceFilter, setSurfaceFilter] = useState<SurfaceFilter>("all");
  const [windowHours, setWindowHours] = useState<number>(24);
  const [rateLimitWindowMinutes, setRateLimitWindowMinutes] =
    useState<number>(60);
  const [eventNameFilter, setEventNameFilter] = useState("");
  const [environmentFilter, setEnvironmentFilter] = useState("all");

  const normalizedEventNameFilter = eventNameFilter.trim().toLowerCase();

  const isAdmin = useQuery(
    api.users.isCurrentUserAdmin,
    isAuthenticated ? {} : "skip",
  );

  const transportHealth = useQuery(
    transportHealthRef,
    isAdmin
      ? {
          windowHours,
          eventName:
            normalizedEventNameFilter.length > 0
              ? normalizedEventNameFilter
              : undefined,
          sourceEnvironment:
            environmentFilter === "all" ? undefined : environmentFilter,
        }
      : "skip",
  ) as TransportHealthSummary | undefined;

  const rateLimitMetrics = useQuery(
    rateLimitMetricsRef,
    isAdmin
      ? {
          windowMinutes: rateLimitWindowMinutes,
        }
      : "skip",
  ) as RateLimitMetricsSummary | undefined;

  const {
    results: infoEvents,
    status: infoEventsStatus,
    loadMore: loadMoreInfoEvents,
  } = usePaginatedQuery(
    listInfoEventsPaginatedRef,
    isAdmin
      ? {
          surface: surfaceFilter === "all" ? undefined : surfaceFilter,
        }
      : "skip",
    {
      initialNumItems: 30,
    },
  );

  const healthRows = useMemo(
    () => [
      {
        key: "overall",
        label: transportHealth
          ? `Overall (last ${transportHealth.windowHours}h)`
          : "Overall",
        row: transportHealth?.overall,
      },
      {
        key: "web",
        label: "Web",
        row: transportHealth?.bySurface.web,
      },
      {
        key: "mobile",
        label: "Mobile",
        row: transportHealth?.bySurface.mobile,
      },
    ],
    [transportHealth],
  );

  const availableEnvironments = useMemo(() => {
    return [
      ...new Set(
        (infoEvents as InfoEventRow[])
          .map((row) => row.sourceEnvironment?.trim())
          .filter((value): value is string => Boolean(value)),
      ),
    ].sort((left, right) => left.localeCompare(right));
  }, [infoEvents]);

  const filteredInfoEvents = useMemo(() => {
    const normalizedEnvironment =
      environmentFilter === "all" ? undefined : environmentFilter.toLowerCase();

    return (infoEvents as InfoEventRow[]).filter((row) => {
      if (
        normalizedEventNameFilter.length > 0 &&
        !row.event.toLowerCase().includes(normalizedEventNameFilter)
      ) {
        return false;
      }

      if (normalizedEnvironment) {
        const rowEnvironment = row.sourceEnvironment?.toLowerCase() ?? "";
        if (rowEnvironment !== normalizedEnvironment) {
          return false;
        }
      }

      return true;
    });
  }, [infoEvents, normalizedEventNameFilter, environmentFilter]);

  const rateLimitChartBuckets = useMemo(
    () => compactRateLimitBuckets(rateLimitMetrics?.minuteBuckets ?? []),
    [rateLimitMetrics],
  );

  const rateLimitChartMaxTotal = useMemo(() => {
    return rateLimitChartBuckets.reduce((max, row) => {
      return row.totalRequests > max ? row.totalRequests : max;
    }, 0);
  }, [rateLimitChartBuckets]);

  const rateLimitCsv = useMemo(() => {
    return toRateLimitMetricsCsv(rateLimitMetrics?.minuteBuckets ?? []);
  }, [rateLimitMetrics]);

  const rateLimitChartCsv = useMemo(() => {
    return toRateLimitChartCsv(rateLimitChartBuckets);
  }, [rateLimitChartBuckets]);

  const firstRateLimitChartBucket =
    rateLimitChartBuckets.length > 0 ? rateLimitChartBuckets[0] : null;
  const lastRateLimitChartBucket =
    rateLimitChartBuckets.length > 0
      ? rateLimitChartBuckets[rateLimitChartBuckets.length - 1]
      : null;

  const rateLimitLastUpdatedAt =
    rateLimitMetrics && Number.isFinite(rateLimitMetrics.nowMinute)
      ? rateLimitMetrics.nowMinute * 60_000
      : null;

  const onDownloadRateLimitCsv = () => {
    if (!rateLimitMetrics || rateLimitMetrics.minuteBuckets.length === 0) {
      return;
    }

    downloadCsvFile("observability-rate-limit-minute", rateLimitCsv);
  };

  const onDownloadRateLimitChartCsv = () => {
    if (rateLimitChartBuckets.length === 0) {
      return;
    }

    downloadCsvFile("observability-rate-limit-chart", rateLimitChartCsv);
  };

  const overall = transportHealth?.overall;

  return (
    <AdminGuard>
      <div className="min-h-screen bg-gray-50 py-10">
        <div className="mx-auto max-w-6xl px-6">
          <div className="mb-6 flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold text-gray-900">
                Info Transport Health
              </h1>
              <p className="mt-1 text-sm text-gray-500">
                Inspect sampled durable info events and monitor ingestion
                health.
              </p>
            </div>
            <Link
              href="/admin/dashboard"
              className="inline-flex items-center rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-700 shadow-sm transition hover:bg-gray-50"
            >
              Back to Dashboard
            </Link>
          </div>

          <div className="mb-4 grid gap-3 rounded-xl border border-gray-200 bg-white p-4 sm:grid-cols-2 lg:grid-cols-7">
            <label className="text-xs text-gray-600">
              Health Window
              <select
                className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm"
                value={windowHours}
                onChange={(event) => setWindowHours(Number(event.target.value))}
              >
                {WINDOW_OPTIONS.map((hours) => (
                  <option key={hours} value={hours}>
                    Last {hours}h
                  </option>
                ))}
              </select>
            </label>

            <label className="text-xs text-gray-600 sm:col-span-1 lg:col-span-2">
              Event Name Contains
              <input
                value={eventNameFilter}
                onChange={(event) => setEventNameFilter(event.target.value)}
                placeholder="screen_opened"
                className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm"
              />
            </label>

            <label className="text-xs text-gray-600 sm:col-span-1 lg:col-span-2">
              Environment
              <select
                value={environmentFilter}
                onChange={(event) => setEnvironmentFilter(event.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm"
              >
                <option value="all">All environments</option>
                {availableEnvironments.map((environment) => (
                  <option key={environment} value={environment}>
                    {environment}
                  </option>
                ))}
              </select>
            </label>

            <div className="sm:col-span-1 lg:col-span-2">
              <p className="text-xs text-gray-600">Event Stream Filter</p>
              <div className="mt-1 flex flex-wrap gap-2">
                {(["all", "web", "mobile"] as const).map((surface) => (
                  <button
                    key={surface}
                    onClick={() => setSurfaceFilter(surface)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${surfaceFilter === surface ? "bg-blue-600 text-white" : "border border-gray-200 bg-white text-gray-700 hover:bg-gray-50"}`}
                  >
                    {surface}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              label={`Ingested (${transportHealth?.windowHours ?? windowHours}h)`}
              value={overall ? overall.ingestedCount.toLocaleString() : "—"}
            />
            <MetricCard
              label="Estimated Drop Rate"
              value={overall ? formatPercent(overall.estimatedDropRate) : "—"}
            />
            <MetricCard
              label="Last Received"
              value={overall ? formatTimestamp(overall.lastReceivedAt) : "—"}
            />
            <MetricCard
              label="Rows Evaluated"
              value={
                transportHealth
                  ? transportHealth.evaluatedRows.toLocaleString()
                  : "—"
              }
            />
          </div>

          <div className="mb-6 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-gray-100 px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold text-gray-900">
                  Ingest Rate Limit Activity
                </h2>
                <p className="mt-0.5 text-xs text-gray-500">
                  Allowed versus blocked requests over the selected time window.
                </p>
              </div>

              <label className="text-xs text-gray-600">
                Rate Limit Window
                <select
                  className="mt-1 w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm"
                  value={rateLimitWindowMinutes}
                  onChange={(event) =>
                    setRateLimitWindowMinutes(Number(event.target.value))
                  }
                >
                  {RATE_LIMIT_WINDOW_OPTIONS_MINUTES.map((minutes) => (
                    <option key={minutes} value={minutes}>
                      Last {formatWindowMinutes(minutes)}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {!rateLimitMetrics ? (
              <div className="p-6 text-sm text-gray-600">
                Loading rate-limit metrics…
              </div>
            ) : (
              <div className="p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-gray-500">
                    Last updated: {formatTimestamp(rateLimitLastUpdatedAt)}
                  </p>

                  <div className="inline-flex flex-wrap items-center gap-2">
                    <div className="inline-flex items-center gap-1">
                      <button
                        onClick={onDownloadRateLimitCsv}
                        disabled={rateLimitMetrics.minuteBuckets.length === 0}
                        className="inline-flex items-center rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 shadow-sm transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Download Minute CSV
                      </button>
                      <span
                        title={csvColumnsTooltip(RATE_LIMIT_MINUTE_CSV_COLUMNS)}
                        aria-label={csvColumnsTooltip(
                          RATE_LIMIT_MINUTE_CSV_COLUMNS,
                        )}
                        className="inline-flex size-4 items-center justify-center rounded-full border border-gray-300 bg-white text-[10px] font-semibold text-gray-600 cursor-help"
                      >
                        i
                      </span>
                    </div>

                    <div className="inline-flex items-center gap-1">
                      <button
                        onClick={onDownloadRateLimitChartCsv}
                        disabled={rateLimitChartBuckets.length === 0}
                        className="inline-flex items-center rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 shadow-sm transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Download Chart CSV
                      </button>
                      <span
                        title={csvColumnsTooltip(RATE_LIMIT_CHART_CSV_COLUMNS)}
                        aria-label={csvColumnsTooltip(
                          RATE_LIMIT_CHART_CSV_COLUMNS,
                        )}
                        className="inline-flex size-4 items-center justify-center rounded-full border border-gray-300 bg-white text-[10px] font-semibold text-gray-600 cursor-help"
                      >
                        i
                      </span>
                    </div>
                  </div>
                </div>

                <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                  <MetricCard
                    label={`Total (${formatWindowMinutes(rateLimitMetrics.windowMinutes)})`}
                    value={rateLimitMetrics.totals.totalRequests.toLocaleString()}
                  />
                  <MetricCard
                    label="Allowed"
                    value={rateLimitMetrics.totals.allowedRequests.toLocaleString()}
                  />
                  <MetricCard
                    label="Blocked"
                    value={rateLimitMetrics.totals.blockedRequests.toLocaleString()}
                  />
                  <MetricCard
                    label="Burst Attempts"
                    value={rateLimitMetrics.totals.burstAttempts.toLocaleString()}
                  />
                  <MetricCard
                    label="Blocked Rate"
                    value={formatPercent(rateLimitMetrics.totals.blockedRate)}
                  />
                </div>

                {rateLimitMetrics.truncated && (
                  <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    Rate-limit summary is capped to the newest{" "}
                    {rateLimitMetrics.evaluatedRows.toLocaleString()} metric
                    rows in the selected window.
                  </div>
                )}

                {rateLimitChartBuckets.length === 0 ? (
                  <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">
                    No rate-limit activity in the selected window.
                  </div>
                ) : (
                  <>
                    <div className="h-44 rounded-lg border border-gray-200 bg-gray-50 p-2">
                      <div className="flex h-full items-end gap-1">
                        {rateLimitChartBuckets.map((bucket, index) => {
                          const heightRatio =
                            rateLimitChartMaxTotal > 0
                              ? bucket.totalRequests / rateLimitChartMaxTotal
                              : 0;

                          const blockedShare =
                            bucket.totalRequests > 0
                              ? bucket.blockedRequests / bucket.totalRequests
                              : 0;

                          const barHeight = Math.max(heightRatio * 100, 2);
                          const barKey = `${bucket.startEpochMinute}-${bucket.endEpochMinute}-${String(index)}`;

                          return (
                            <div
                              key={barKey}
                              className="group relative h-full flex-1"
                            >
                              <div className="absolute bottom-0 left-0 right-0">
                                <div
                                  className="overflow-hidden rounded-sm"
                                  style={{ height: `${barHeight}%` }}
                                >
                                  <div
                                    className="bg-rose-500"
                                    style={{ height: `${blockedShare * 100}%` }}
                                  />
                                  <div
                                    className="bg-emerald-500"
                                    style={{
                                      height: `${(1 - blockedShare) * 100}%`,
                                    }}
                                  />
                                </div>
                              </div>

                              <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 text-[10px] text-white shadow group-hover:block">
                                {bucket.allowedRequests} allowed •{" "}
                                {bucket.blockedRequests} blocked •{" "}
                                {bucket.burstAttempts} burst
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <div className="mt-2 flex items-center justify-between text-[11px] text-gray-500">
                      <span>
                        {firstRateLimitChartBucket
                          ? new Date(
                              firstRateLimitChartBucket.startEpochMinute *
                                60_000,
                            ).toLocaleTimeString()
                          : "—"}
                      </span>
                      <span>{rateLimitChartBuckets.length} bars</span>
                      <span>
                        {lastRateLimitChartBucket
                          ? new Date(
                              lastRateLimitChartBucket.endEpochMinute * 60_000,
                            ).toLocaleTimeString()
                          : "—"}
                      </span>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-gray-600">
                      <span className="inline-flex items-center gap-1">
                        <span className="size-2 rounded-full bg-emerald-500" />
                        Allowed
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <span className="size-2 rounded-full bg-rose-500" />
                        Blocked
                      </span>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {transportHealth?.truncated && (
            <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              Health summary capped to the newest{" "}
              {transportHealth.evaluatedRows.toLocaleString()} events in the
              selected window.
            </div>
          )}

          <div className="mb-6 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-100 px-4 py-3">
              <h2 className="text-sm font-semibold text-gray-900">
                Transport Health Breakdown
              </h2>
            </div>

            {!transportHealth ? (
              <div className="p-6 text-sm text-gray-600">
                Loading transport health…
              </div>
            ) : (
              <>
                <div className="overflow-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-gray-50 text-gray-600">
                      <tr>
                        <th className="px-4 py-3 text-left font-medium">
                          Scope
                        </th>
                        <th className="px-4 py-3 text-left font-medium">
                          Ingested
                        </th>
                        <th className="px-4 py-3 text-left font-medium">
                          Estimated Attempted
                        </th>
                        <th className="px-4 py-3 text-left font-medium">
                          Estimated Dropped
                        </th>
                        <th className="px-4 py-3 text-left font-medium">
                          Estimated Drop Rate
                        </th>
                        <th className="px-4 py-3 text-left font-medium">
                          Avg Sample Rate
                        </th>
                        <th className="px-4 py-3 text-left font-medium">
                          Last Received
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {healthRows.map((row) => (
                        <tr key={row.key} className="hover:bg-gray-50">
                          <td className="px-4 py-3 font-medium text-gray-900">
                            {row.label}
                          </td>
                          <td className="px-4 py-3 text-gray-700">
                            {row.row
                              ? row.row.ingestedCount.toLocaleString()
                              : "—"}
                          </td>
                          <td className="px-4 py-3 text-gray-700">
                            {row.row
                              ? row.row.estimatedAttemptedCount.toFixed(2)
                              : "—"}
                          </td>
                          <td className="px-4 py-3 text-gray-700">
                            {row.row
                              ? row.row.estimatedDroppedCount.toFixed(2)
                              : "—"}
                          </td>
                          <td className="px-4 py-3 text-gray-700">
                            {row.row
                              ? formatPercent(row.row.estimatedDropRate)
                              : "—"}
                          </td>
                          <td className="px-4 py-3 text-gray-700">
                            {row.row
                              ? formatSampleRate(row.row.averageSampleRate)
                              : "—"}
                          </td>
                          <td className="px-4 py-3 text-gray-700">
                            {row.row
                              ? formatTimestamp(row.row.lastReceivedAt)
                              : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="border-t border-gray-100 p-4">
                  <h3 className="text-sm font-semibold text-gray-900">
                    Top Events by Volume
                  </h3>
                  <p className="mt-1 text-xs text-gray-500">
                    Ranked within the selected health window and filters.
                  </p>

                  {transportHealth.topEvents.length === 0 ? (
                    <div className="mt-3 text-sm text-gray-600">
                      No events found for the selected health filters.
                    </div>
                  ) : (
                    <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {transportHealth.topEvents.map((eventRow) => (
                        <div
                          key={eventRow.event}
                          className="rounded-lg border border-gray-200 bg-gray-50 p-3"
                        >
                          <p className="truncate text-sm font-semibold text-gray-900">
                            {eventRow.event}
                          </p>
                          <p className="mt-1 text-xs text-gray-600">
                            {eventRow.ingestedCount.toLocaleString()} ingested •{" "}
                            {formatPercent(eventRow.shareOfIngested)} share
                          </p>
                          <p className="mt-1 text-xs text-gray-600">
                            web {eventRow.webCount} • mobile{" "}
                            {eventRow.mobileCount}
                          </p>
                          <p className="mt-1 text-xs text-gray-500">
                            last {formatTimestamp(eventRow.lastReceivedAt)}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-100 px-4 py-3">
              <h2 className="text-sm font-semibold text-gray-900">
                Recent Ingested Info Events
              </h2>
              <p className="mt-0.5 text-xs text-gray-500">
                Stream filtered by surface={surfaceFilter}, event name contains=
                {normalizedEventNameFilter || "any"}, environment=
                {environmentFilter}
              </p>
            </div>

            {infoEventsStatus === "LoadingFirstPage" ? (
              <div className="p-6 text-sm text-gray-600">
                Loading info events…
              </div>
            ) : infoEvents.length === 0 ? (
              <div className="p-6 text-sm text-gray-600">
                No ingested info events match the selected filter.
              </div>
            ) : filteredInfoEvents.length === 0 ? (
              <div className="p-6 text-sm text-gray-600">
                No currently loaded rows match event/environment filters. Load
                more rows or broaden filters.
              </div>
            ) : (
              <>
                <div className="overflow-auto">
                  <table className="min-w-full text-sm">
                    <thead className="bg-gray-50 text-gray-600">
                      <tr>
                        <th className="px-4 py-3 text-left font-medium">
                          Received
                        </th>
                        <th className="px-4 py-3 text-left font-medium">
                          Surface
                        </th>
                        <th className="px-4 py-3 text-left font-medium">
                          Event
                        </th>
                        <th className="px-4 py-3 text-left font-medium">
                          Sample Rate
                        </th>
                        <th className="px-4 py-3 text-left font-medium">
                          Est. Drop
                        </th>
                        <th className="px-4 py-3 text-left font-medium">
                          Environment
                        </th>
                        <th className="px-4 py-3 text-left font-medium">
                          Context
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {filteredInfoEvents.map((row) => (
                        <tr key={row._id} className="hover:bg-gray-50">
                          <td className="px-4 py-3 text-gray-700">
                            {new Date(row.receivedAt).toLocaleString()}
                          </td>
                          <td className="px-4 py-3 text-gray-700">
                            {row.surface}
                          </td>
                          <td className="px-4 py-3 font-medium text-gray-900">
                            {row.event}
                          </td>
                          <td className="px-4 py-3 text-gray-700">
                            {formatSampleRate(row.sampleRate)}
                          </td>
                          <td className="px-4 py-3 text-gray-700">
                            {formatPercent(
                              estimatedDropRateFromSampleRate(row.sampleRate),
                            )}
                          </td>
                          <td className="px-4 py-3 text-gray-700">
                            {row.sourceEnvironment ?? "—"}
                          </td>
                          <td className="max-w-sm px-4 py-3 font-mono text-xs text-gray-600">
                            {contextPreview(row.contextJson)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {infoEventsStatus === "CanLoadMore" && (
                  <div className="border-t border-gray-100 p-4">
                    <button
                      onClick={() => loadMoreInfoEvents(30)}
                      className="inline-flex items-center rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 shadow-sm transition hover:bg-gray-50"
                    >
                      Load more events
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </AdminGuard>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="mt-1 text-lg font-semibold text-gray-900">{value}</p>
    </div>
  );
}
