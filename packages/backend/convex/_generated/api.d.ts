/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as admin from "../admin.js";
import type * as authz from "../authz.js";
import type * as cascadeCleanup from "../cascadeCleanup.js";
import type * as content from "../content.js";
import type * as crons from "../crons.js";
import type * as dashboardMetrics from "../dashboardMetrics.js";
import type * as days from "../days.js";
import type * as env from "../env.js";
import type * as featureFlags from "../featureFlags.js";
import type * as http from "../http.js";
import type * as integrationHealth from "../integrationHealth.js";
import type * as integrationPlugins from "../integrationPlugins.js";
import type * as integrationProviders from "../integrationProviders.js";
import type * as integrationSecretsCrypto from "../integrationSecretsCrypto.js";
import type * as integrations from "../integrations.js";
import type * as memories from "../memories.js";
import type * as observability from "../observability.js";
import type * as observabilityIngestRateLimiter from "../observabilityIngestRateLimiter.js";
import type * as observabilityIngestion from "../observabilityIngestion.js";
import type * as observabilityIngestionSecurity from "../observabilityIngestionSecurity.js";
import type * as planLimits from "../planLimits.js";
import type * as providerAdapters from "../providerAdapters.js";
import type * as retention from "../retention.js";
import type * as runtimeConfig from "../runtimeConfig.js";
import type * as sensitiveDataCrypto from "../sensitiveDataCrypto.js";
import type * as sensitiveDataFields from "../sensitiveDataFields.js";
import type * as sensitiveDataMigration from "../sensitiveDataMigration.js";
import type * as summaries from "../summaries.js";
import type * as summaryGeneration from "../summaryGeneration.js";
import type * as summaryQuality from "../summaryQuality.js";
import type * as unsupportedProviders from "../unsupportedProviders.js";
import type * as userPreferences from "../userPreferences.js";
import type * as users from "../users.js";
import type * as validators from "../validators.js";
import type * as webhooks from "../webhooks.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  authz: typeof authz;
  cascadeCleanup: typeof cascadeCleanup;
  content: typeof content;
  crons: typeof crons;
  dashboardMetrics: typeof dashboardMetrics;
  days: typeof days;
  env: typeof env;
  featureFlags: typeof featureFlags;
  http: typeof http;
  integrationHealth: typeof integrationHealth;
  integrationPlugins: typeof integrationPlugins;
  integrationProviders: typeof integrationProviders;
  integrationSecretsCrypto: typeof integrationSecretsCrypto;
  integrations: typeof integrations;
  memories: typeof memories;
  observability: typeof observability;
  observabilityIngestRateLimiter: typeof observabilityIngestRateLimiter;
  observabilityIngestion: typeof observabilityIngestion;
  observabilityIngestionSecurity: typeof observabilityIngestionSecurity;
  planLimits: typeof planLimits;
  providerAdapters: typeof providerAdapters;
  retention: typeof retention;
  runtimeConfig: typeof runtimeConfig;
  sensitiveDataCrypto: typeof sensitiveDataCrypto;
  sensitiveDataFields: typeof sensitiveDataFields;
  sensitiveDataMigration: typeof sensitiveDataMigration;
  summaries: typeof summaries;
  summaryGeneration: typeof summaryGeneration;
  summaryQuality: typeof summaryQuality;
  unsupportedProviders: typeof unsupportedProviders;
  userPreferences: typeof userPreferences;
  users: typeof users;
  validators: typeof validators;
  webhooks: typeof webhooks;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
